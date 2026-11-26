import RFB from '@novnc/novnc';
import Inflator from '../node_modules/@novnc/novnc/core/inflator.js';
import { bitmapLimit, desktopTextLimit } from './clipboard-formats';

const TEXT = 1, DIB = 8;
const CAPS = 1 << 24, REQUEST = 1 << 25, PEEK = 1 << 26, NOTIFY = 1 << 27, PROVIDE = 1 << 28;
const actions = [CAPS, REQUEST, PEEK, NOTIFY, PROVIDE];
const word = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);

async function providePacket(format, bytes) {
  const block = new Uint8Array(4 + bytes.length);
  new DataView(block.buffer).setUint32(0, bytes.length);
  block.set(bytes, 4);
  const stream = new Blob([block]).stream().pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  const packet = new Uint8Array(4 + compressed.length);
  new DataView(packet.buffer).setUint32(0, PROVIDE | format);
  packet.set(compressed, 4);
  return packet;
}

// noVNC 1.7 exposes text in its public API. Extend only its ServerCutText handler;
// framebuffer, authentication, key handling and classic clipboard stay upstream.
export default class ClipboardRFB extends RFB {
  clipboardPasteFrom(text, usable) {
    if (this._clipboardServerCapabilitiesFormats[TEXT] && this._clipboardServerCapabilitiesActions[PROVIDE]) {
      const bytes = new TextEncoder().encode(text.replace(/\r\n|\r|\n/g, '\r\n') + '\0');
      return this._offer(TEXT, bytes, usable);
    }
    this._offerToken = null; this._offerPacket = null;
    if (/[^\u0000-\u00ff]/u.test(text)) throw new Error('此 VNC 服务仅支持 Latin-1 文本，无法粘贴这些字符。');
    super.clipboardPasteFrom(text);
  }

  clipboardPasteDib(bytes, usable) {
    if (!this._clipboardServerCapabilitiesFormats[DIB] || !this._clipboardServerCapabilitiesActions[PROVIDE]) throw new Error('目标 VNC 服务未启用 DIB 位图剪贴板。');
    return this._offer(DIB, bytes, usable);
  }

  async _offer(format, bytes, usable = () => true) {
    const token = this._offerToken = {};
    const unsolicited = bytes.length <= this._unsolicitedSize[format];
    if (!unsolicited && !this._clipboardServerCapabilitiesActions[NOTIFY]) throw new Error('目标不接受此大小的剪贴板数据。');
    const packet = await providePacket(format, bytes);
    if (token !== this._offerToken || this._viewOnly || this._rfbConnectionState !== 'connected' || !usable()) throw new Error('剪贴板操作已取消。');
    this._offerPacket = packet;
    this._offerFormat = format;
    if (unsolicited) RFB.messages.clientCutText(this._sock, packet, true);
    else RFB.messages.extendedClipboardNotify(this._sock, [format]);
  }

  _handleServerCutText() {
    const sock = this._sock;
    if (sock.rQwait('clipboard header', 7, 1)) return false;
    const length = word(sock.rQpeekBytes(7, false).subarray(3)) | 0;
    if (Math.abs(length) + 8 > bitmapLimit) return this._fail('VNC clipboard packet exceeds receive limit');
    if (length > desktopTextLimit) {
      if (sock.rQwait('oversized clipboard', 7 + length, 1)) return false;
      sock.rQskipBytes(7 + length);
      if (!this._viewOnly) this.dispatchEvent(new CustomEvent('clipboarderror', { detail: '远端 VNC 文本超过 4 MiB。' }));
      return true;
    }
    if (length >= 0) return super._handleServerCutText();
    if (-length < 4) return this._fail('Invalid VNC clipboard header');
    if (sock.rQwait('extended clipboard', 7 - length, 1)) return false;
    sock.rQskipBytes(7);
    const flags = sock.rQshift32(), format = flags & 0xffff, action = flags & 0xff000000;
    const data = sock.rQshiftBytes(-length - 4, false);
    if (action & CAPS) {
      this._unsolicitedSize = {};
      let offset = 0;
      for (let bit = 1; bit <= 0x8000; bit <<= 1) {
        if (!(format & bit)) continue;
        if (offset + 4 > data.length) return this._fail('Invalid VNC clipboard capabilities');
        this._unsolicitedSize[bit] = word(data.subarray(offset)); offset += 4;
      }
      this._clipboardServerCapabilitiesFormats = { [TEXT]: !!(format & TEXT), [DIB]: !!(format & DIB) };
      this._clipboardServerCapabilitiesActions = Object.fromEntries(actions.map(a => [a, !!(action & a)]));
      RFB.messages.extendedClipboardCaps(sock, actions, { 0: 0, 3: 0 });
      return true;
    }
    if (this._viewOnly) return true;
    const can = this._clipboardServerCapabilitiesActions;
    const localFormat = this._offerPacket ? this._offerFormat : 0;
    try {
      if (action === NOTIFY && can[REQUEST]) {
        const preferred = format & DIB && this._clipboardServerCapabilitiesFormats[DIB] ? DIB : format & TEXT;
        if (preferred) RFB.messages.extendedClipboardRequest(sock, [preferred]);
      } else if (action === REQUEST && can[PROVIDE] && (localFormat & format)) {
        RFB.messages.clientCutText(sock, this._offerPacket, true);
      } else if (action === PEEK && can[NOTIFY]) {
        RFB.messages.extendedClipboardNotify(sock, localFormat ? [localFormat] : []);
      } else if (action === PROVIDE && (format & (TEXT | DIB))) {
        const inflater = new Inflator();
        inflater.setInput(data);
        let text, image, total = 0;
        for (let bit = 1; bit <= DIB; bit <<= 1) {
          if (!(bit & format)) continue;
          const size = word(inflater.inflate(4));
          total += size;
          if (total > bitmapLimit + 2 * desktopTextLimit + 1 || size > (bit === TEXT ? 2 * desktopTextLimit + 1 : bitmapLimit)) throw new Error('远端剪贴板数据超过容量限制。');
          const chunk = size ? inflater.inflate(size) : new Uint8Array();
          if (bit === TEXT) text = new TextDecoder().decode(chunk).replace(/\0$/, '').replaceAll('\r\n', '\n');
          if (bit === DIB && this._clipboardServerCapabilitiesFormats[DIB]) image = chunk.slice();
        }
        this._offerPacket = null; this._offerToken = null;
        if (image) this.dispatchEvent(new CustomEvent('clipboardimage', { detail: image }));
        else if (text !== undefined) this.dispatchEvent(new CustomEvent('clipboard', { detail: { text } }));
      }
    } catch (error) { this.dispatchEvent(new CustomEvent('clipboarderror', { detail: error.message })); }
    return true;
  }
}
