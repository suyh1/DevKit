import { isIPv4, isIPv6 } from 'node:net';
import { checkRevision, fail, newRecord } from './collab-record.mjs';

const roles = ['A', 'B', 'C'];

function topology(rows) {
  return roles.map((role, index) => rows.find(node => node.role === role) ?? {
    role, revision: 0, address: '10.77.0.' + (index + 1), publicKey: '',
    ...(role === 'A' ? { listenPort: 51820 } : { endpoint: '' }),
  });
}

function validEndpoint(endpoint) {
  const match = /^(\[[a-fA-F0-9:.]+\]|[a-zA-Z0-9.-]+):([1-9]\d{0,4})$/.exec(endpoint);
  if (!match || Number(match[2]) > 65535) return false;
  const host = match[1];
  if (host.startsWith('[')) return isIPv6(host.slice(1, -1));
  if (/^[\d.]+$/.test(host)) return isIPv4(host);
  return host.length <= 253 && host.split('.').every(label => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
}

function updatedNode(input, nodes) {
  const current = nodes.find(node => node.role === input.role);
  if (!current) fail(400, '请选择 A、B 或 C。');
  checkRevision(current, input.revision);
  const address = String(input.address ?? '').trim();
  const publicKey = String(input.publicKey ?? '').trim();
  const key = publicKey.length === 44 ? Buffer.from(publicKey, 'base64') : null;
  if (key?.length !== 32 || key.toString('base64') !== publicKey || !key.some(Boolean))
    fail(400, '请填写此设备的 WireGuard 公钥（32 字节的 Base64）。');
  if (!isIPv4(address) || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address))
    fail(400, '请为隧道选择一个独立的私网 IPv4 地址。');
  if (nodes.some(node => node.role !== current.role && (node.address === address || node.publicKey === publicKey)))
    fail(400, '三台设备须使用不同的隧道 IP 和公钥。');
  const node = { id: current.id ?? newRecord().id, role: current.role, revision: current.revision + 1, address, publicKey };
  if (node.role === 'A') {
    const { listenPort } = input;
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) fail(400, 'UDP 监听端口应在 1 到 65535 之间。');
    node.listenPort = listenPort;
  } else {
    const endpoint = String(input.endpoint ?? '').trim();
    if (!validEndpoint(endpoint)) fail(400, '请填写从此设备可达的 A 地址和 UDP 端口，例如 relay.example.org:51820。');
    node.endpoint = endpoint;
  }
  const next = nodes.map(other => other.role === node.role ? node : other);
  const addresses = new Set(next.map(peer => peer.address));
  if (next.some(peer => peer.endpoint && addresses.has(peer.endpoint.split(':')[0])))
    fail(400, 'A 的连接入口与隧道 IP 冲突，请使用隧道外可达的入口。');
  return node;
}

function configuration(node, nodes, linux) {
  if (!nodes.every(peer => peer.publicKey)) return '';
  const hub = nodes[0];
  const others = nodes.filter(peer => peer.role !== node.role);
  const lines = ['[Interface]', linux ? 'PostUp = wg set %i private-key /etc/wireguard/%i.key' : 'PrivateKey = <本机已有的私钥>', 'Address = ' + node.address + '/32'];
  if (node.role === 'A') {
    lines.push('ListenPort = ' + hub.listenPort);
    if (linux) lines.push('PostUp = sysctl -w net.ipv4.conf.%i.forwarding=1');
    for (const peer of others) lines.push('', '# ' + peer.role, '[Peer]', 'PublicKey = ' + peer.publicKey, 'AllowedIPs = ' + peer.address + '/32');
  } else {
    lines.push('', '# A', '[Peer]', 'PublicKey = ' + hub.publicKey, 'Endpoint = ' + node.endpoint,
      'AllowedIPs = ' + others.map(peer => peer.address + '/32').join(', '), 'PersistentKeepalive = 25');
  }
  return lines.join('\n') + '\n';
}

export async function wireguardRequest({ rows, commit, action, input }) {
  const nodes = topology(rows);
  if (action === 'list') return nodes.map(node => ({ ...node, config: configuration(node, nodes, false), linuxConfig: configuration(node, nodes, true) }));
  if (action !== 'save') fail(404, '未知的组网操作。');
  const updated = updatedNode(input, nodes);
  await commit([...rows.filter(node => node.role !== updated.role), updated]);
  return { revision: updated.revision };
}
