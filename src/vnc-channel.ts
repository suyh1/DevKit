import { lanRequest } from './lan-api';

// noVNC accepts a WebSocket-compatible ordered binary channel.
export class VncChannel {
  readyState = 'connecting';
  binaryType = 'arraybuffer';
  protocol = '';
  onopen = () => {};
  onmessage = (_event: { data: ArrayBuffer }) => {};
  onclose = (_event: { code: number; reason: string; wasClean: boolean }) => {};
  onerror = () => {};
  private id = '';
  private queued = 0;
  private writes = Promise.resolve();
  constructor(private hostId: string, private report: (message: string) => void) {}

  async connect() {
    try {
      const { id } = await lanRequest<{ id: string }>('vnc-open', { id: this.hostId });
      if (this.readyState === 'closed') { await lanRequest('vnc-close', { id }); return; }
      this.id = id;
      this.readyState = 'open';
      this.onopen();
      while (this.readyState === 'open') {
        const chunk = await lanRequest<ArrayBuffer | null>('vnc-read', { id });
        if (this.readyState !== 'open') break;
        if (chunk === null) { this.close(); break; }
        this.onmessage({ data: chunk });
      }
    } catch (error) { this.fail(error); }
  }

  send(bytes: Uint8Array) {
    if (this.readyState !== 'open') return;
    if (this.queued + bytes.length > 512 * 1024) { this.fail(new Error('VNC 输入积压，请重新连接。')); return; }
    // noVNC reuses its 10 KiB send buffer as soon as send returns.
    const data = bytes.slice().buffer, size = bytes.byteLength;
    this.queued += size;
    this.writes = this.writes.then(async () => {
      if (this.readyState === 'open') await lanRequest('vnc-write', { id: this.id, data });
    }).catch(error => this.fail(error)).finally(() => { this.queued -= size; });
  }

  private fail(error: unknown) {
    if (this.readyState === 'closed') return;
    this.report((error as Error).message);
    this.close();
  }

  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    if (this.id) void lanRequest('vnc-close', { id: this.id }).catch(() => {});
    queueMicrotask(() => this.onclose({ code: 1000, reason: '', wasClean: true }));
  }
}
