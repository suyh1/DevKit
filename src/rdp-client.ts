import Guacamole from './vendor/guacamole.js';
import { remoteRequest, remoteResponse } from './workspace-remote';

export type RdpCredentials = { username: string; password: string; domain: string; trustCertificate: boolean };

export function openRemoteDesktop(viewport: HTMLElement, hostId: string, credentials: RdpCredentials, onConnect: () => void, onError: (message: string) => void) {
  const controller = new AbortController(), tunnel = new Guacamole.Tunnel();
  const client = new Guacamole.Client(tunnel), parser = new Guacamole.Parser();
  const display = client.getDisplay(), screen = display.getElement();
  viewport.replaceChildren(screen);
  let sessionId = '', disposed = false, sending = false, timer: ReturnType<typeof setTimeout> | undefined;
  const messages: string[][] = [];
  const resize = new ResizeObserver(fit);
  resize.observe(viewport);
  display.onresize = fit;

  function fit() {
    const width = display.getWidth(), height = display.getHeight();
    if (!width || !height || !viewport.clientWidth || !viewport.clientHeight) return;
    display.scale(Math.min(viewport.clientWidth / width, viewport.clientHeight / height, 1));
  }

  // Input is sent in order on one request at a time. Batching keeps mouse motion responsive.
  async function send() {
    timer = undefined;
    if (disposed || sending || !sessionId || !messages.length) return;
    sending = true;
    try {
      await remoteRequest('lan-hosts', 'rdp-input', { id: sessionId, messages: messages.splice(0, 256) }, controller.signal);
    } catch (error) { if (!disposed) fail((error as Error).message); }
    finally {
      sending = false;
      if (!disposed && messages.length) void send();
    }
  }

  function close() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    clearTimeout(timer);
    resize.disconnect();
    display.onresize = null;
    viewport.replaceChildren();
    if (sessionId) void remoteRequest('lan-hosts', 'rdp-close', { id: sessionId }).catch(() => {});
    tunnel.setState(Guacamole.Tunnel.State.CLOSED);
  }

  function fail(message: string) {
    close();
    client.disconnect();
    onError(message);
  }

  async function read() {
    try {
      const response = await remoteResponse('/api/lan-hosts/rdp-open', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ id: hostId, ...credentials, width: viewport.clientWidth || window.innerWidth - 48, height: viewport.clientHeight || window.innerHeight - 170 }),
      });
      if (disposed) return;
      sessionId = response.headers.get('X-DevKit-RDP-Session') || '';
      if (!sessionId || !response.body) throw new Error('远程桌面显示通道不可用。');
      tunnel.setState(Guacamole.Tunnel.State.OPEN);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      try {
        while (!disposed) {
          const item = await reader.read();
          if (item.done) break;
          parser.receive(item.value);
        }
      } finally { reader.releaseLock(); }
      if (!disposed) fail('远程桌面已断开。');
    } catch (error) { if (!disposed) fail((error as Error).message); }
    finally { credentials.password = ''; }
  }

  tunnel.connect = () => {
    tunnel.setState(Guacamole.Tunnel.State.CONNECTING);
    void read();
    credentials.password = '';
  };
  tunnel.disconnect = close;
  tunnel.sendMessage = (...elements) => {
    if (disposed || !sessionId || elements[0] === 'disconnect') return;
    if (messages.length >= 1024) { fail('远程桌面输入积压，请重新连接。'); return; }
    messages.push(elements.map(String));
    if (!sending && !timer) timer = setTimeout(() => void send(), 16);
  };
  parser.oninstruction = (opcode, parameters) => tunnel.oninstruction?.(opcode, parameters);
  client.onstatechange = state => {
    if (!disposed && state === Guacamole.Client.State.CONNECTED) { fit(); screen.focus({ preventScroll: true }); onConnect(); }
  };
  client.onerror = status => {
    const help = status.code === 0x0301 || status.code === 0x0303
      ? '目标拒绝登录，请检查远程桌面凭据和账户权限。'
      : '目标远程桌面连接失败，请检查目标端口、登录权限和证书。';
    fail(help);
  };
  // Bind the keyboard to the screen for this session, leaving dialog controls and inputs alone.
  screen.tabIndex = 0;
  const keyboard = new Guacamole.Keyboard(screen);
  const press = (keysym: number) => client.sendKeyEvent(1, keysym);
  const release = (keysym: number) => client.sendKeyEvent(0, keysym);
  keyboard.onkeydown = keysym => { press(keysym); return false; };
  keyboard.onkeyup = release;
  screen.addEventListener('blur', () => keyboard.reset());
  screen.addEventListener('pointerdown', () => screen.focus({ preventScroll: true }));
  for (const pointer of [new Guacamole.Mouse(screen), new Guacamole.Mouse.Touchscreen(screen)]) {
    pointer.onEach(['mousedown', 'mousemove', 'mouseup'], ({ state }) => client.sendMouseState(state, true));
  }
  client.connect();
  return {
    close() { close(); client.disconnect(); },
    secureAttention() {
      screen.focus({ preventScroll: true });
      const keys = [0xffe3, 0xffe9, 0xffff];
      keys.forEach(press);
      keys.reverse().forEach(release);
    },
  };
}
