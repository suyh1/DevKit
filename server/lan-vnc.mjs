import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createConnection } from 'node:net';

// A pull-based desktop IPC channel. The socket's high-water mark bounds unread frames.
export function createVncSockets(find) {
  const sessions = new Map();
  function close(id) {
    sessions.get(id)?.socket.destroy();
    sessions.delete(id);
  }
  async function request(action, value) {
    if (action === 'vnc-open') {
      const host = find(value?.id);
      if (host?.mode !== 'vnc') throw new Error('请选择已保存的 VNC 会话。');
      if (sessions.size >= 8) throw new Error('最多同时打开 8 个 VNC 会话。');
      const id = randomUUID(), socket = createConnection({ host: host.address, port: host.port });
      const entry = { host, socket };
      sessions.set(id, entry);
      const timeout = setTimeout(() => socket.destroy(new Error('VNC 连接超时。')), 12000);
      socket.on('error', () => {});
      try {
        await Promise.race([once(socket, 'connect'), once(socket, 'close').then(() => { throw new Error('VNC 连接已关闭。'); })]);
        socket.setNoDelay(true);
        entry.reader = socket[Symbol.asyncIterator]();
        return { id };
      } catch (error) {
        close(id);
        throw new Error('无法连接 VNC 服务，请检查主机与端口。' + (error.code || error.message));
      } finally { clearTimeout(timeout); }
    }
    const id = value?.id, entry = sessions.get(id);
    if (action === 'vnc-close') { close(id); return; }
    if (!entry?.reader) throw new Error('VNC 会话已关闭。');
    if (action === 'vnc-read') {
      if (entry.reading) throw new Error('显示通道正在读取。');
      entry.reading = true;
      try {
        const chunk = await entry.reader.next();
        if (chunk.done) { close(id); return null; }
        const bytes = chunk.value;
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      } finally { entry.reading = false; }
    }
    if (action === 'vnc-write' && value.data instanceof ArrayBuffer && value.data.byteLength <= 65536 && entry.socket.writable && entry.socket.writableLength < 262144) {
      await new Promise((resolve, reject) => entry.socket.write(Buffer.from(value.data), error => error ? reject(error) : resolve()));
      return true;
    }
    throw new Error('VNC 输入通道不可用。');
  }
  return { request, close() { for (const id of sessions.keys()) close(id); }, invalidate() {
    for (const [id, { host }] of sessions) if (find(host.id)?.mode !== 'vnc') close(id);
  } };
}
