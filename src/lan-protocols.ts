import type { HostDraft } from './lan-api';
export const defaultPort = { ssh: 22, sftp: 22, vnc: 5900, rdp: 3389, ftp: 21, telnet: 23, serial: 0, share: 80 };
export const protocolName = { ssh: 'SSH', sftp: 'SFTP', vnc: 'VNC', rdp: 'RDP', telnet: 'Telnet', ftp: 'FTP', serial: '串口', share: 'DevKit 共享' };

export function sessionSeed(text: string): Partial<HostDraft> | undefined {
  const device = /^(?:serial:\/\/)?(COM[1-9]\d{0,4}|\/dev\/tty(?:USB|ACM|S)\d+)(?:\s+(\d{1,7}))?$/i.exec(text);
  if (device && (!device[2] || (+device[2] > 0 && +device[2] <= 4000000))) return { mode: 'serial', address: device[1], baudRate: Number(device[2] || 115200), port: 0 };
  const telnet = /^telnet\s+([a-z\d.:[\]-]+)(?:\s+(\d+))?$/i.exec(text);
  if (telnet) text = 'telnet://' + telnet[1] + (telnet[2] ? ':' + telnet[2] : '');
  if (/^(?:新建\s*)?(?:串口|serial)(?:\s*会话)?$/i.test(text)) return { mode: 'serial', port: 0 };
  const intent = /^(?:新建\s*)?(ssh|sftp|vnc|rdp|telnet|ftp|ftps)(?:\s*(?:会话|连接))?$/i.exec(text);
  if (intent) {
    if (intent[1].toLowerCase() === 'ftps') return { mode: 'ftp', port: 990, ftpSecurity: 'implicit' };
    const mode = intent[1].toLowerCase() as Exclude<HostDraft['mode'], 'serial' | 'share'>;
    return { mode, port: defaultPort[mode] };
  }
  const command = /^(ssh|sftp)\s+(?:-([pP])\s+(\d+)\s+)?([\w.@-]+@)?(\[[\da-f:]+\]|[\w.-]+)(?:\s+-([pP])\s+(\d+))?$/.exec(text);
  if (command) {
    const [, mode, before, firstPort, user, address, after, lastPort] = command;
    const option = before || after, port = firstPort || lastPort;
    if ((before && after) || (option && option !== (mode === 'ssh' ? 'p' : 'P'))) return;
    text = mode + '://' + (user || '') + address + (port ? ':' + port : '');
  }
  if (!/^(ssh|sftp|vnc|rdp|telnet|ftp|ftps):\/\//i.test(text) || /\s/.test(text)) return;
  try {
    const url = new URL(text), mode = (url.protocol === 'ftps:' ? 'ftp' : url.protocol.slice(0, -1)) as Exclude<HostDraft['mode'], 'serial' | 'share'>;
    const address = url.hostname.replace(/^\[|\]$/g, '').toLowerCase(), port = url.port ? Number(url.port) : url.protocol === 'ftps:' ? 990 : defaultPort[mode];
    if (!address || !port || url.search || url.hash || url.password || mode !== 'ftp' && !['', '/'].includes(url.pathname)) return;
    if (!url.hostname.startsWith('[') && !/^[a-z\d][a-z\d.-]{0,252}$/i.test(address)) return;
    const user = decodeURIComponent(url.username);
    if (user && (!['ssh', 'sftp', 'ftp'].includes(mode) || !/^[a-z\d_.@\\-]{1,120}$/i.test(user))) return;
    const startDirectory = decodeURIComponent(url.pathname);
    if (/[\x00-\x1f]/.test(startDirectory)) return;
    return { mode, address, port, ...(url.protocol === 'ftps:' && { ftpSecurity: 'implicit' }), ...(mode === 'ftp' && startDirectory && text.slice(text.indexOf('://') + 3).includes('/') && { startDirectory }), ...(user && { user }) };
  } catch { return; }
}
