import type { HostDraft } from './lan-api';
export const defaultPort = { ssh: 22, sftp: 22, vnc: 5900, rdp: 3389, share: 80 };
export const protocolName = { ssh: 'SSH', sftp: 'SFTP', vnc: 'VNC', rdp: 'RDP', share: 'DevKit 共享' };

export function sessionSeed(text: string): Partial<HostDraft> | undefined {
  const intent = /^(?:新建\s*)?(ssh|sftp|vnc|rdp)(?:\s*(?:会话|连接))?$/i.exec(text);
  if (intent) {
    const mode = intent[1].toLowerCase() as 'ssh' | 'sftp' | 'vnc' | 'rdp';
    return { mode, port: defaultPort[mode] };
  }
  const command = /^(ssh|sftp)\s+(?:-([pP])\s+(\d+)\s+)?([\w.@-]+@)?(\[[\da-f:]+\]|[\w.-]+)(?:\s+-([pP])\s+(\d+))?$/.exec(text);
  if (command) {
    const [, mode, before, firstPort, user, address, after, lastPort] = command;
    const option = before || after, port = firstPort || lastPort;
    if ((before && after) || (option && option !== (mode === 'ssh' ? 'p' : 'P'))) return;
    text = mode + '://' + (user || '') + address + (port ? ':' + port : '');
  }
  if (!/^(ssh|sftp|vnc|rdp):\/\//i.test(text) || /\s/.test(text)) return;
  try {
    const url = new URL(text), mode = url.protocol.slice(0, -1) as 'ssh' | 'sftp' | 'vnc' | 'rdp';
    const address = url.hostname.replace(/^\[|\]$/g, '').toLowerCase(), port = url.port ? Number(url.port) : defaultPort[mode];
    if (!address || !port || url.search || url.hash || url.password || !['', '/'].includes(url.pathname)) return;
    if (!url.hostname.startsWith('[') && !/^[a-z\d][a-z\d.-]{0,252}$/i.test(address)) return;
    const user = decodeURIComponent(url.username);
    if (user && (!['ssh', 'sftp'].includes(mode) || !/^[a-z\d_.@\\-]{1,120}$/i.test(user))) return;
    return { mode, address, port, ...(user && { user }) };
  } catch { return; }
}
