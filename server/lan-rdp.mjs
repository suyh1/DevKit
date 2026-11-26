import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createConnection, isIP } from 'node:net';
import { connect as connectTls } from 'node:tls';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const bounded = (value, min, max, fallback) => Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;

function instruction(...values) {
  return values.map(value => {
    const text = String(value);
    return `${Array.from(text).length}.${text}`;
  }).join(',') + ';';
}

// guacd uses Unicode code point lengths, including when a character spans TCP reads.
function firstInstruction(text) {
  const values = [];
  let offset = 0;
  for (;;) {
    const dot = text.indexOf('.', offset);
    if (dot < 0) return undefined;
    const length = text.slice(offset, dot);
    if (!/^\d{1,5}$/.test(length)) throw new Error('Invalid Guacamole length');
    const start = dot + 1;
    offset = start;
    for (let index = 0; index < Number(length); index++) {
      const code = text.codePointAt(offset);
      if (code === undefined) return undefined;
      offset += code > 0xffff ? 2 : 1;
    }
    if (offset >= text.length) return undefined;
    values.push(text.slice(start, offset));
    const separator = text[offset++];
    if (separator === ';') return { values, rest: text.slice(offset) };
    if (separator !== ',') throw new Error('Invalid Guacamole delimiter');
  }
}

function gateway(env) {
  const host = env.DEVKIT_GUACD_HOST || '127.0.0.1';
  const port = Number(env.DEVKIT_GUACD_PORT || 4822);
  if ((!isIP(host) && !/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(host)) || !Number.isInteger(port) || port < 1 || port > 65535 || ![undefined, 'true', 'false'].includes(env.DEVKIT_GUACD_TLS)) {
    fail(503, '远程桌面网关地址、端口或 TLS 设置无效，请联系共享主机管理员。');
  }
  return { host, port, tls: env.DEVKIT_GUACD_TLS === 'true' };
}

function optionsFor(target, input) {
  const credentials = {};
  for (const [key, max] of [['username', 256], ['password', 1024], ['domain', 256]]) {
    const value = input?.[key] ?? '';
    if (typeof value !== 'string' || value.length > max || /[\x00-\x1f]/.test(value)) fail(400, '远程桌面登录资料无效。');
    credentials[key] = value;
  }
  if (target.protocol !== 'vnc' && !credentials.username.trim()) fail(400, '请填写远程桌面用户名。');
  return {
    hostname: target.address, port: target.port, ...credentials,
    width: bounded(input.width, 640, 2560, 1280), height: bounded(input.height, 480, 1600, 800), dpi: 96,
    'cert-tofu': target.protocol !== 'vnc' && input.trustCertificate === true ? 'true' : '',
    'resize-method': 'display-update', 'disable-audio': 'true', 'disable-copy': 'true', 'disable-paste': 'true',
  };
}

async function connectGateway(endpoint, options, signal, protocol) {
  // A fixed deadline covers TCP/TLS and the Guacamole handshake.
  const { host, port, tls } = endpoint;
  const socket = tls ? connectTls({ host, port, ...(isIP(host) ? {} : { servername: host }) }) : createConnection({ host, port });
  const timeout = setTimeout(() => socket.destroy(new Error('Guacamole handshake timed out')), 12_000);
  timeout.unref();
  const abort = () => socket.destroy();
  signal.addEventListener('abort', abort, { once: true });
  // The stream iterator handles reads after connect. Keep an error listener across the transition.
  socket.on('error', () => {});
  let connected = false;
  try {
    signal.throwIfAborted();
    await once(socket, tls ? 'secureConnect' : 'connect', { signal });
    connected = true;
    socket.setNoDelay(true).setEncoding('utf8');
    const read = socket.iterator({ destroyOnReturn: false });
    let buffer = '';
    async function nextInstruction() {
      for (;;) {
        const current = firstInstruction(buffer);
        if (current) { buffer = current.rest; return current.values; }
        const { done, value } = await read.next();
        if (done || buffer.length + value.length > 128 * 1024) throw new Error('Invalid Guacamole handshake');
        buffer += value;
      }
    }
    socket.write(instruction('select', protocol));
    const [opcode, ...args] = await nextInstruction();
    if (opcode !== 'args' || !args.includes('hostname') || !args.includes('port')) throw new Error('RDP arguments unavailable');
    if (options['cert-tofu'] && !args.includes('cert-tofu')) fail(502, '当前 guacd 不支持首次证书信任，请使用 guacd 1.6 或配置受信任的目标证书。');
    const versioned = /^VERSION_\d+_\d+_\d+$/.test(args[0] || '');
    const version = versioned ? args[0].slice(8).split('_').map(Number) : [1, 0, 0];
    const timezone = version[0] > 1 || version[0] === 1 && version[1] >= 1;
    const name = version[0] > 1 || version[0] === 1 && version[1] >= 5;
    socket.write([
      instruction('size', options.width, options.height, options.dpi), instruction('audio'), instruction('video'),
      instruction('image', 'image/png', 'image/jpeg', 'image/webp'),
      timezone ? instruction('timezone', 'UTC') : '', name ? instruction('name', 'DevKit') : '',
      instruction('connect', ...args.map((argument, index) => {
        if (index === 0 && versioned) return name ? 'VERSION_1_5_0' : timezone ? 'VERSION_1_1_0' : 'VERSION_1_0_0';
        return Object.hasOwn(options, argument) ? options[argument] : '';
      })),
    ].join(''));
    options.password = '';
    const [ready] = await nextInstruction();
    if (ready !== 'ready') throw new Error('RDP handshake rejected');
    return { socket, async *display() {
      if (buffer) yield buffer;
      for await (const chunk of read) yield chunk;
    } };
  } catch (error) {
    socket.destroy();
    if (signal.aborted || error.status) throw error;
    if (!connected) fail(502, '无法连接远程桌面网关，请确认 guacd 已运行并可从共享主机访问。');
    fail(502, `远程桌面网关握手失败，请确认 guacd 已启用 ${protocol.toUpperCase()} 支持。`);
  } finally {
    options.password = '';
    signal.removeEventListener('abort', abort);
    clearTimeout(timeout);
  }
}

const inputLengths = new Map([['sync', [1, 2]], ['key', [2]], ['mouse', [3, 4]], ['size', [2, 3]], ['ack', [3]], ['nop', [0]]]);
function encodeInput(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 256) fail(400, '远程桌面输入无效。');
  return messages.map(message => {
    if (!Array.isArray(message)) fail(400, '远程桌面输入无效。');
    const [opcode, ...values] = message;
    if (!inputLengths.get(opcode)?.includes(values.length) || values.some((value, index) => {
      if (typeof value !== 'string') return true;
      return opcode === 'ack' && index === 1 ? value.length > 120 || /[\x00-\x1f]/.test(value) : !/^-?\d{1,16}$/.test(value);
    })) fail(400, '远程桌面输入无效。');
    if (opcode === 'size') {
      values[0] = String(bounded(Number(values[0]), 640, 2560, 1280));
      values[1] = String(bounded(Number(values[1]), 480, 1600, 800));
    }
    return instruction(opcode, ...values);
  }).join('');
}

export function createRdpSessions(env = process.env) {
  const sessions = new Map();
  const owned = (id, token) => {
    const session = sessions.get(id);
    if (!session || session.token !== token) fail(404, '远程桌面会话已断开或不可用。');
    return session;
  };
  return {
    async open(target, payload, { token, verify, stream }) {
      if (sessions.size >= 8 || [...sessions.values()].filter(session => session.token === token).length >= 2) fail(429, '远程桌面连接数已达上限。');
      const protocol = target.protocol === 'vnc' ? 'vnc' : 'rdp';
      const endpoint = gateway(env), options = optionsFor(target, payload);
      payload.password = '';
      const id = randomUUID(), controller = new AbortController();
      const signal = AbortSignal.any([stream.signal, controller.signal]);
      const session = { token, controller, verify };
      sessions.set(id, session);
      const abort = () => session.socket?.destroy();
      signal.addEventListener('abort', abort, { once: true });
      let timer;
      try {
        const { socket, display } = await connectGateway(endpoint, options, signal, protocol);
        session.socket = socket;
        signal.throwIfAborted();
        verify();
        timer = setInterval(() => {
          try { verify(); }
          catch { controller.abort(); }
        }, 5000);
        timer.unref();
        await stream.write(id, display(), signal);
      } finally {
        clearInterval(timer);
        signal.removeEventListener('abort', abort);
        sessions.delete(id);
        session.socket?.destroy();
      }
    },
    input(payload, token) {
      const session = owned(payload?.id, token);
      try { session.verify(); }
      catch (error) { session.controller.abort(); throw error; }
      if (!session.socket?.writable) fail(404, '远程桌面会话已断开或不可用。');
      if (session.socket.writableLength > 256 * 1024) fail(429, '远程桌面暂时无法接收输入。');
      session.socket.write(encodeInput(payload.messages));
      return true;
    },
    disconnect(payload, token) { owned(payload?.id, token).controller.abort(); return true; },
    release(token) { for (const session of sessions.values()) if (session.token === token) session.controller.abort(); },
    close() { for (const session of sessions.values()) session.controller.abort(); },
  };
}
