import { remoteRequest, remoteResponse } from './workspace-remote';
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
  private controller = new AbortController();
  constructor(private hostId: string, private report: (message: string) => void, private portal = false) {}

  async connect() {
    try {
      if (this.portal) { await this.readPortal(); return; }
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

  private async readPortal() {
    const response = await remoteResponse('/api/lan-hosts/vnc-open', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: this.hostId }), signal: this.controller.signal,
    });
    this.id = response.headers.get('X-DevKit-RDP-Session') || '';
    if (!this.id || !response.body) throw new Error('VNC 显示通道不可用。');
    if (this.controller.signal.aborted) return;
    const reader = response.body.getReader();
    this.readyState = 'open';
    this.onopen();
    try {
      while (this.readyState === 'open') {
        const { done, value } = await reader.read();
        if (done) { this.close(); break; }
        if (this.readyState === 'open') this.onmessage({ data: value.slice().buffer });
      }
    } finally { reader.releaseLock(); }
  }

  send(bytes: Uint8Array) {
    if (this.readyState !== 'open') return;
    if (this.queued + bytes.length > 44 * 1024 * 1024) { this.fail(new Error('VNC 输入积压，请重新连接。')); return; }
    // noVNC reuses its 10 KiB send buffer as soon as send returns.
    const data = bytes.slice().buffer, size = bytes.byteLength;
    this.queued += size;
    this.writes = this.writes.then(async () => {
      if (this.readyState !== 'open') return;
      if (this.portal) {
        const encoded = btoa(String.fromCharCode(...new Uint8Array(data)));
        await remoteRequest('lan-hosts', 'vnc-input', { id: this.id, data: encoded }, this.controller.signal);
      } else await lanRequest('vnc-write', { id: this.id, data });
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
    this.controller.abort();
    if (!this.portal && this.id) void lanRequest('vnc-close', { id: this.id }).catch(() => {});
    queueMicrotask(() => this.onclose({ code: 1000, reason: '', wasClean: true }));
  }
}
