import { once } from 'node:events';
import { createServer } from 'node:net';
import path from 'node:path';

export async function ftpFixture() {
  const files = new Map([['/incoming/readme.txt', Buffer.from('hello')]]);
  let user, login, current = '/', from, data;
  const sockets = new Set();
  const control = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    const reply = line => socket.write(line + '\r\n');
    reply('220 local fixture');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0,end);
        buffer = buffer.slice(end+2);
        const [cmd, ...args] = line.split(' '), arg = args.join(' ');
        switch (cmd) {
          case 'USER': user = arg; reply('331 Password'); break;
          case 'PASS': login = arg; reply('230 OK'); break;
          case 'CWD': current = arg; reply('250 OK'); break;
          case 'PWD': reply('257 "' + current + '"'); break;
          case 'FEAT': reply('211-Features\r\n MLST type*;size*;\r\n211 End'); break;
          case 'EPSV': {
            const server = createServer().listen(0, '127.0.0.1');
            data = once(server, 'connection').then(([conn]) => { server.close(); return conn; });
            server.on('listening', () => reply('229 (|||' + server.address().port + '|)'));
            break;
          }
          case 'MLSD': case 'RETR': case 'STOR':
            reply('150 Starting');
            void data.then(async conn => {
              if (cmd === 'STOR') {
                const chunks = [];
                for await (const chunk of conn) chunks.push(chunk);
                files.set(arg, Buffer.concat(chunks));
              } else {
                const ended = once(conn, 'close');
                conn.end(cmd === 'RETR' ? files.get(arg) : [...files].map(([file, content]) => 'type=file;size=' + content.length + '; ' + path.posix.basename(file) + '\r\n').join(''));
                await ended;
              }
              reply('226 Complete');
            });
            break;
          case 'RNFR': from = arg; reply('350 Ready'); break;
          case 'RNTO': files.set(arg, files.get(from)); files.delete(from); reply('250 OK'); break;
          case 'SIZE': reply('502 SIZE not supported'); break;
          case 'DELE': files.delete(arg); reply('250 OK'); break;
          case 'QUIT': socket.end(); break;
          default: reply('200 OK');
        }
      }
    });
  }).listen(0, '127.0.0.1');
  await once(control, 'listening');
  return { files, port: control.address().port, credentials: () => [user, login, current], async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => control.close(resolve));
  } };
}
