import { createConnection } from 'node:net';
import { once } from 'node:events';
import { Transform } from 'node:stream';

const IAC = 255, SB = 250, SE = 240, WILL = 251, WONT = 252, DO = 253, DONT = 254;
const escapeData = bytes => Buffer.from([...bytes].flatMap(byte => byte === IAC ? [IAC, IAC] : [byte]));

export async function openTelnet(host, size) {
  const socket = createConnection({ host: host.address, port: host.port });
  socket.setTimeout(12000, () => socket.destroy(new Error('Telnet 连接超时。')));
  await once(socket, 'connect');
  socket.setTimeout(0); socket.setNoDelay(true);
  let state = 'data', verb = 0, sub = [], cr = false;
  const local = new Set(), remote = new Set();
  function resize(next) {
    size = next;
    if (!local.has(31)) return;
    const bytes = Buffer.alloc(4);
    bytes.writeUInt16BE(size.cols); bytes.writeUInt16BE(size.rows, 2);
    socket.write(Buffer.concat([Buffer.from([IAC, SB, 31]), escapeData(bytes), Buffer.from([IAC, SE])]));
  }
  function negotiate(option) {
    const us = verb === DO || verb === DONT, options = us ? local : remote;
    const enable = verb === DO || verb === WILL, supported = (us ? [3, 24, 31] : [1, 3]).includes(option);
    if (enable && !supported) { socket.write(Buffer.from([IAC, us ? WONT : DONT, option])); return; }
    if (options.has(option) === enable) return;
    if (enable) options.add(option); else options.delete(option);
    socket.write(Buffer.from([IAC, us ? (enable ? WILL : WONT) : (enable ? DO : DONT), option]));
    if (us && enable && option === 31) resize(size);
  }
  const stream = new Transform({ transform(chunk, _encoding, done) {
    const output = [];
    for (const byte of chunk) {
      if (state === 'data') {
        if (byte === IAC) { state = 'iac'; continue; }
        if (!(cr && byte === 0)) output.push(byte);
        cr = byte === 13;
      } else if (state === 'iac') {
        if (byte === SB) { sub = []; state = 'sub'; }
        else if ([DO,DONT,WILL,WONT].includes(byte)) { verb = byte; state = 'option'; }
        else { if (byte === IAC) output.push(byte); state = 'data'; }
      } else if (state === 'option') { negotiate(byte); state = 'data'; }
      else if (state === 'sub') { if (byte === IAC) state = 'sub-iac'; else if (sub.length < 3) sub.push(byte); }
      else if (byte === SE) {
        if (local.has(24) && sub.length === 2 && sub[0] === 24 && sub[1] === 1) {
          socket.write(Buffer.concat([Buffer.from([IAC,SB,24,0]), Buffer.from(host.terminalType), Buffer.from([IAC,SE])]));
        }
        state = 'data';
      } else { if (sub.length < 3) sub.push(byte); state = 'sub'; }
    }
    done(null, Buffer.from(output));
  } });
  socket.on('error', error => stream.destroy(error));
  socket.pipe(stream);
  return { client: socket, stream, resize, input(text) {
    const wire = text.replace(/\r\n|\r/g, host.lineEnding === 'cr' ? '\r\0' : '\r\n');
    return new Promise((resolve, reject) => socket.write(Buffer.from(wire), error => error ? reject(error) : resolve()));
  } };
}

async function serialBinding() {
  const { autoDetect } = await import('@serialport/bindings-cpp');
  return autoDetect();
}
export async function serialDevices() {
  return (await (await serialBinding()).list()).map(({ path, manufacturer }) => ({ path, manufacturer }));
}
export async function openSerial(host, binding) {
  binding ??= await serialBinding();
  if (!(await binding.list()).some(port => port.path === host.address)) throw new Error('未发现此串口，请接入设备并刷新端口列表。');
  const { SerialPortStream } = await import('@serialport/stream');
  const { baudRate, dataBits, stopBits, parity, flowControl } = host;
  const stream = new SerialPortStream({ binding, path: host.address, baudRate, dataBits, stopBits, parity,
    rtscts: flowControl === 'hardware', xon: flowControl === 'software', xoff: flowControl === 'software', autoOpen: false });
  await new Promise((resolve, reject) => stream.open(error => error ? reject(error) : resolve()));
  const dispose = () => { if (stream.isOpen) stream.close(() => {}); };
  return { client: stream, stream, dispose, input(text) {
    const ending = { cr: '\r', lf: '\n', crlf: '\r\n' }[host.lineEnding];
    return new Promise((resolve, reject) => stream.write(text.replace(/\r\n|\r/g, ending), error => error ? reject(error) : resolve()));
  } };
}
