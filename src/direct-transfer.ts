import { collab } from './collab-api';
import { downloadBlob } from './files';

const blockSize = 512 * 1024;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
type Offer = { key: string; id: string; offer: string };
type Item = { id: string; name?: string; size: number };
const call = <T>(action: string, input: unknown) => collab<T>('transfer', action, input);

function peer() {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('当前浏览器不支持 WebRTC 直传。');
  return new RTCPeerConnection({ iceServers: [] });
}
async function description(pc: RTCPeerConnection, value: RTCSessionDescriptionInit) {
  await pc.setLocalDescription(value);
  const deadline = Date.now() + 5000;
  while (pc.iceGatheringState !== 'complete' && Date.now() < deadline && pc.signalingState !== 'closed')
    await sleep(50);
  const sdp = pc.localDescription?.sdp;
  if (!sdp || !sdp.includes('a=candidate:')) throw new Error('没有可用于局域网直连的网络地址。');
  return sdp;
}

// A receiver asks for the next block only after saving the previous one.
async function serve(pc: RTCPeerConnection, offer: Offer, file: File) {
  const deadline = setTimeout(() => pc.close(), 45_000);
  pc.ondatachannel = ({ channel }) => {
    let offset = 0,
      busy = false,
      done = false;
    let idle = deadline;
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => pc.close(), 90_000);
    };
    channel.onopen = touch;
    channel.onclose = () => {
      clearTimeout(idle);
      pc.close();
    };
    channel.onerror = () => pc.close();
    channel.onmessage = async ({ data }) => {
      if (done || busy || data !== 'next') {
        pc.close();
        return;
      }
      busy = true;
      touch();
      try {
        const bytes = await file.slice(offset, offset + blockSize).arrayBuffer();
        if (!bytes.byteLength && offset < file.size) throw new Error('源文件无法读取。');
        for (let start = 0; start < bytes.byteLength; start += 16384) channel.send(bytes.slice(start, start + 16384));
        offset += bytes.byteLength;
        done = offset === file.size;
        channel.send(done ? 'end' : 'block');
      } catch {
        pc.close();
      } finally {
        busy = false;
      }
    };
  };
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: offer.offer });
    const answer = await description(pc, await pc.createAnswer());
    await call('reply', { key: offer.key, answer });
  } catch {
    clearTimeout(deadline);
    pc.close();
  }
}

export class DirectSender {
  private files = new Map<string, File>();
  private peers = new Map<string, { id: string; pc: RTCPeerConnection }>();
  private timer?: ReturnType<typeof setTimeout>;
  private polling = false;
  add(id: string, file: File) {
    this.files.set(id, file);
    if (!this.polling && !this.timer) void this.poll();
  }
  remove(id: string) {
    this.files.delete(id);
    for (const [key, entry] of this.peers)
      if (entry.id === id) {
        entry.pc.close();
        this.peers.delete(key);
      }
  }
  close() {
    clearTimeout(this.timer);
    this.timer = undefined;
    for (const id of this.files.keys()) {
      this.remove(id);
      void call('remove', { id }).catch(() => {});
    }
  }
  private async poll() {
    this.timer = undefined;
    this.polling = true;
    const ids = [...this.files.keys()];
    try {
      const result = await call<{ ids: string[]; offers: Offer[] }>('presence', { ids });
      for (const id of ids) if (!result.ids.includes(id)) this.remove(id);
      for (const [key, entry] of this.peers) if (entry.pc.signalingState === 'closed') this.peers.delete(key);
      for (const offer of result.offers) {
        const file = this.files.get(offer.id);
        if (!file || this.peers.has(offer.key)) continue;
        const pc = peer();
        this.peers.set(offer.key, { id: offer.id, pc });
        void serve(pc, offer, file);
      }
    } catch (error) {
      if ([401, 403, 404].includes((error as { status?: number }).status ?? 0)) this.close();
    } finally {
      this.polling = false;
      if (this.files.size) this.timer = setTimeout(() => void this.poll(), 1500);
    }
  }
}

type SavePicker = (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
export async function receiveDirect(item: Item, ticket: string, signal: AbortSignal, progress: (text: string) => void) {
  const name = item.name || 'download';
  const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  // Browsers on ordinary LAN HTTP do not expose the native file picker. Hand completed Blob blocks to their download manager.
  if (typeof RTCPeerConnection === 'undefined') throw new Error('当前浏览器不支持 WebRTC 直传。');
  let writer: { write(block: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> } | undefined;
  if (window.devkitCollab) {
    const key = await call<string | null>('directsave', { name, size: item.size });
    if (!key) return '已取消取件';
    writer = {
      write: async (block) => call<void>('directwrite', { key, bytes: new Uint8Array(await block.arrayBuffer()) }),
      close: () => call<void>('directfinish', { key }),
      abort: () => call<void>('directabort', { key }),
    };
  } else if (picker && window.isSecureContext) {
    try {
      writer = await (await picker.call(window, { suggestedName: name })).createWritable();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return '已取消取件';
      throw error;
    }
  }
  let pc: RTCPeerConnection, channel: RTCDataChannel;
  try {
    pc = peer();
    channel = pc.createDataChannel('file', { ordered: true });
  } catch (error) {
    await writer?.abort().catch(() => {});
    throw error;
  }
  channel.binaryType = 'arraybuffer';
  const blobs: Blob[] = [];
  let pieces: ArrayBuffer[] = [],
    inBlock = 0,
    received = 0,
    last = Date.now(),
    finished = false;
  let finish!: () => void, fail!: (error: Error) => void;
  const complete = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const stop = () => fail(new Error('已取消直传。'));
  const timeout = setInterval(() => {
    if (Date.now() - last > 45_000) fail(new Error('直连超时，请保持发送页面在线，并确认两台设备可在局域网内互访。'));
  }, 1000);
  signal.addEventListener('abort', stop);
  channel.onopen = () => {
    last = Date.now();
    channel.send('next');
  };
  channel.onclose = channel.onerror = () => {
    if (!finished) fail(new Error('直连已中断，请重新取件。'));
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') fail(new Error('两台设备无法建立局域网直连。'));
  };
  let writing = false;
  channel.onmessage = async ({ data }) => {
    try {
      last = Date.now();
      if (finished || writing) throw new Error('直传数据顺序无效。');
      if (data instanceof ArrayBuffer) {
        if (
          !data.byteLength ||
          inBlock + data.byteLength > blockSize ||
          received + inBlock + data.byteLength > item.size
        )
          throw new Error('接收到的文件大小不符。');
        pieces.push(data);
        inBlock += data.byteLength;
        return;
      }
      if (data !== 'block' && data !== 'end') throw new Error('直传数据无效。');
      if ((data === 'block' && inBlock !== blockSize) || (data === 'end' && received + inBlock !== item.size))
        throw new Error('文件接收不完整。');
      writing = true;
      const block = new Blob(pieces);
      if (writer) await writer.write(block);
      else blobs.push(block);
      received += inBlock;
      inBlock = 0;
      pieces = [];
      writing = false;
      if (data === 'end') {
        finished = true;
        finish();
      } else {
        progress('正在直传 ' + name + ' · ' + Math.floor((received / item.size) * 100) + '%');
        channel.send('next');
      }
    } catch (error) {
      fail(error as Error);
    }
  };
  async function negotiate() {
    progress('正在连接发送方…');
    const offer = await description(pc, await pc.createOffer());
    signal.throwIfAborted();
    const { key } = await call<{ key: string }>('claim', { id: item.id, ticket, offer });
    while (pc.signalingState !== 'closed') {
      const { answer } = await call<{ answer?: string }>('answer', { key });
      if (answer) {
        await pc.setRemoteDescription({ type: 'answer', sdp: answer });
        return;
      }
      await sleep(450);
    }
  }
  try {
    signal.throwIfAborted();
    void negotiate().catch(fail);
    await complete;
    if (writer) {
      await writer.close();
      return '文件已保存';
    }
    return downloadBlob(new Blob(blobs), name);
  } catch (error) {
    await writer?.abort().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', stop);
    clearInterval(timeout);
    pc.close();
  }
}
