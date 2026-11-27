import { once } from 'node:events';
import { createServer } from 'node:net';

const encode = (...values) => values.map(value => `${[...String(value)].length}.${value}`).join(',') + ';';
const parameters = ['VERSION_1_5_0', 'hostname', 'port', 'username', 'password', 'domain', 'cert-tofu', 'resize-method', 'disable-audio', 'disable-copy', 'disable-paste', 'enable-drive', 'drive-name', 'drive-path'];

export async function rdpFixture() {
  const pastes = [], messages = [], connections = [], sockets = new Set();
  const downloads = new WeakMap();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = [], ctrl = false, clipboardBytes = [];
    socket.on('data', data => {
      buffer = buffer.concat(Array.from(data));
      while (buffer.length) {
        const values = [];
        let offset = 0, separator;
        do {
          const dot = buffer.indexOf('.', offset);
          if (dot < 0) return;
          const length = Number(buffer.slice(offset, dot).join(''));
          const end = dot + length + 1;
          if (!Number.isSafeInteger(length) || length < 0 || end >= buffer.length) return;
          values.push(buffer.slice(dot + 1, end).join(''));
          separator = buffer[end]; offset = end + 1;
        } while (separator === ',');
        buffer = buffer.slice(offset);
        messages.push(values);
        const [command, ...args] = values;
        if (command === 'select') {
          const reply = encode('args', ...parameters);
          socket.write(reply.slice(0, 9));
          setImmediate(() => { if (socket.writable) socket.write(reply.slice(9)); });
        } else if (command === 'ack' && args[0] === '12' && args[2] === '0' && downloads.has(socket)) {
          const bytes = downloads.get(socket);
          if (bytes) { downloads.set(socket, null); socket.write(encode('blob', 12, bytes.toString('base64'))); }
          else { downloads.delete(socket); socket.write(encode('end', 12)); }
        } else if (command === 'clipboard') clipboardBytes = [];
        else if (command === 'blob') clipboardBytes.push(Buffer.from(args[1], 'base64'));
        else if (command === 'key') {
          const down = args[1] === '1';
          if (args[0] === '65507') ctrl = down;
          if (ctrl && down && args[0] === '118') pastes.push(Buffer.concat(clipboardBytes).toString());
          if (ctrl && down && args[0] === '99') socket.write(encode('clipboard', 8, 'text/plain') +
            encode('blob', 8, Buffer.from('selected-remote'.repeat(3000)).toString('base64')) + encode('end', 8));
        } else if (command === 'connect') {
          connections.push(Object.fromEntries(parameters.map((parameter, index) => [parameter, args[index]])));
          socket.write([
            encode('ready', '$fixture'), connections.at(-1)['enable-drive'] === 'true' ? encode('filesystem', 0, 'Shared Drive') : '', encode('size', 0, 640, 480), encode('rect', 0, 0, 0, 640, 480),
            encode('cfill', 14, 0, 40, 100, 150, 255), encode('sync', 1000),
            encode('clipboard', 7, 'text/plain'), encode('blob', 7, Buffer.from('远端文本').toString('base64')), encode('end', 7),
          ].join(''));
        }
      }
    });
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: server.address().port, pastes, messages, connections, sockets, sendClipboardBlob(encoded) {
    [...sockets].at(-1).write(encode('clipboard', 8, 'text/plain') + encode('blob', 8, encoded) + encode('end', 8));
  }, sendFile(name, bytes) {
    const socket = [...sockets].at(-1);
    downloads.set(socket, bytes);
    socket.write(encode('file', 12, 'application/octet-stream', name));
  }, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  } };
}
