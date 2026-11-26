import Guacamole from './vendor/guacamole.js';
import { bindRemoteClipboard, copyScreen, downloadBlob } from './remote-clipboard';
import { checkText, gatewayTextLimit, transferLimit } from './clipboard-formats';
import { remoteRequest, remoteResponse } from './workspace-remote';

export type RdpCredentials = { username: string; password: string; domain: string; trustCertificate: boolean };

export function openRemoteDesktop(viewport: HTMLElement, hostId: string, credentials: RdpCredentials, {
  resizeDesktop, onConnect, onError, onClipboard, onNotice, onDrive,
}: { onDrive: (value: boolean) => void; resizeDesktop: boolean; onConnect: () => void; onError: (message: string) => void; onClipboard: (text: string) => void; onNotice: (message: string) => void }) {
  const controller = new AbortController(), tunnel = new Guacamole.Tunnel();
  const client = new Guacamole.Client(tunnel), parser = new Guacamole.Parser();
  const display = client.getDisplay(), screen = display.getElement();
  viewport.replaceChildren(screen);
  let sessionId = '', disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
  const messages: string[][] = [];
  let pendingInput: Promise<void> | undefined;
  let connected = false, resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWidth = 0, lastHeight = 0;
  async function paste(text: string) {
    // Deliver the previous paste keystroke before replacing the remote clipboard again.
    await send();
    if (disposed || !sessionId) throw new Error('会话已断开');
    await remoteRequest('lan-hosts', 'rdp-clipboard', { id: sessionId, text }, controller.signal);
  }
  let drivePermitted = false, drive = false;
  async function sendFiles(files: File[], usable = () => !disposed) {
    if (!drive) throw new Error(resizeDesktop ? '需要管理员开启 RDP 中转盘和文件传输权限。' : '网页 VNC 支持文本剪贴板，文件请通过 SFTP 或 FTP 传输。');
    if (!files.length) throw new Error('浏览器未提供文件，请使用「发送文件」。');
    for (const file of files) {
      if (!usable()) return false;
      if (file.size > transferLimit) throw new Error('单个文件最多 128 MiB。');
      const filename = file.type === 'image/png' && ['image.png', '截图.png'].includes(file.name) ? '截图-' + Date.now() + '.png' : file.name;
      onNotice('正在上传 ' + filename);
      const query = new URLSearchParams({ id: sessionId, name: filename });
      await remoteResponse('/api/lan-hosts/rdp-file-upload?' + query, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      if (!disposed) onNotice('已发送到远端 \\\\tsclient\\DevKit\\' + filename);
    }
    return false; // Drive uploads must not trigger a second paste in the focused remote app.
  }
  const clipboard = bindRemoteClipboard(viewport, {
    enabled: () => connected && !disposed,
    protocol: resizeDesktop ? 'web-rdp' : 'web-vnc', sendFiles,
    async sendLongText(text, usable) {
      if (!drive) throw new Error(checkText(text, resizeDesktop ? 'web-rdp' : 'web-vnc'));
      await sendFiles([new File([text], '剪贴板-' + Date.now() + '.txt', { type: 'text/plain;charset=utf-8' })], usable);
    },
    sendText: paste, key: (symbol, _code, down) => client.sendKeyEvent(Number(down), symbol), notice: onNotice,
  });
  function resizeViewport() {
    fit();
    if (!resizeDesktop || !connected || !viewport.clientWidth || !viewport.clientHeight) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const width = Math.min(2560, Math.max(640, viewport.clientWidth));
      const height = Math.min(1600, Math.max(480, viewport.clientHeight));
      if (width !== lastWidth || height !== lastHeight) {
        client.sendSize(width, height); lastWidth = width; lastHeight = height;
      }
    }, 120);
  }
  const resize = new ResizeObserver(resizeViewport);
  resize.observe(viewport);
  display.onresize = fit;

  function fit() {
    const width = display.getWidth(), height = display.getHeight();
    if (!width || !height || !viewport.clientWidth || !viewport.clientHeight) return;
    display.scale(Math.min(viewport.clientWidth / width, viewport.clientHeight / height));
  }

  // Input is sent in order on one request at a time. Batching keeps mouse motion responsive.
  function send(): Promise<void> {
    clearTimeout(timer); timer = undefined;
    if (pendingInput) return pendingInput;
    if (disposed || !sessionId || !messages.length) return Promise.resolve();
    pendingInput = (async () => {
      while (!disposed && messages.length) {
        await remoteRequest('lan-hosts', 'rdp-input', { id: sessionId, messages: messages.splice(0, 256) }, controller.signal);
      }
    })().catch(error => { if (!disposed) fail(error.message); })
      .finally(() => {
        pendingInput = undefined;
        if (!disposed && messages.length) void send();
      });
    return pendingInput;
  }

  function close() {
    if (disposed) return;
    disposed = true; clipboard.dispose();
    controller.abort();
    clearTimeout(timer);
    clearTimeout(resizeTimer);
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
      drivePermitted = response.headers.get('X-DevKit-RDP-Drive') === '1';
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
    if (!pendingInput && !timer) timer = setTimeout(() => void send(), elements[0] === 'ack' ? 0 : 16);
  };
  parser.oninstruction = (opcode, parameters) => tunnel.oninstruction?.(opcode, parameters);
  client.onstatechange = state => {
    if (!disposed && state === Guacamole.Client.State.CONNECTED) { connected = true; resizeViewport(); screen.focus({ preventScroll: true }); onConnect(); }
  };
  client.onclipboard = (stream, mime) => {
    if (mime.split(';')[0] !== 'text/plain') { stream.sendAck('Text only', 0x0100); return; }
    let size = 0, overflow = false;
    const decoder = new TextDecoder(), parts: string[] = [];
    stream.onblob = data => {
      if (overflow) return;
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      size += bytes.length;
      if (size >= gatewayTextLimit) { overflow = true; stream.sendAck('Text too long', 0x030d); return; }
      parts.push(decoder.decode(bytes, { stream: true }));
      stream.sendAck('OK', 0);
    };
    stream.onend = () => {
      if (disposed) return;
      if (overflow) { clipboard.reset(); onClipboard(''); onNotice('远端剪贴板文本超过网关的 256 KiB 缓冲区'); return; }
      const text = parts.join('') + decoder.decode();
      onClipboard(text); void clipboard.receive(text);
    };
  };
  client.onfilesystem = () => {
    if (drivePermitted && !disposed) { drive = true; onDrive(true); }
  };
  // Only one stream buffers file contents at a time. Other downloads wait for their initial ACK.
  const downloads = new Set<() => void>();
  client.onfile = (stream, mime, filename) => {
    if (!drive || downloads.size >= 64) { stream.sendAck('Drive unavailable or busy', 0x0308); onNotice('下载队列暂时无法接收新文件。'); return; }
    let receiving = false;
    const accept = () => { receiving = true; stream.sendAck('Ready', 0); };
    const finish = () => {
      downloads.delete(accept);
      if (receiving && !disposed) downloads.values().next().value?.();
      receiving = false;
    };
    const name = filename.split(/[\\/]/).pop()?.replace(/[<>:"|?*\x00-\x1f]/g, '_') || '远端文件';
    let size = 0, failed = false;
    const chunks: ArrayBuffer[] = [];
    stream.onblob = data => {
      if (failed || disposed) return;
      try {
        if (!receiving) throw new Error('远端提前发送了文件内容');
        if (data.length > 4 * 1024 * 1024) throw new Error('文件分块过大');
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        size += bytes.length;
        if (size > transferLimit) throw new Error('远端单个文件超过 128 MiB');
        chunks.push(bytes.buffer); stream.sendAck('OK', 0);
      } catch (error) {
        chunks.length = 0; failed = true; finish();
        stream.sendAck('File rejected', 0x030d); onNotice((error as Error).message);
      }
    };
    stream.onend = () => {
      if (failed) return;
      finish();
      if (!disposed) {
        downloadBlob(new Blob(chunks, { type: mime || 'application/octet-stream' }), name);
        onNotice('已向浏览器提交下载：' + name);
      }
      chunks.length = 0;
    };
    // guacd starts reading a redirected download only after the client accepts the file stream.
    downloads.add(accept);
    if (downloads.size === 1) accept();
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
    paste, sendFiles,
    capture() {
      const png = new Promise<Blob>((resolve, reject) => display.flatten().toBlob(blob => blob ? resolve(blob) : reject(), 'image/png'));
      void copyScreen(png, onNotice);
    },
    secureAttention() {
      screen.focus({ preventScroll: true });
      const keys = [0xffe3, 0xffe9, 0xffff];
      keys.forEach(press);
      keys.reverse().forEach(release);
    },
  };
}
