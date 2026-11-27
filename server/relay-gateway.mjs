import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { fail } from './collab-record.mjs';
import { routingAddress } from './relay-routing.mjs';
import { routingManagementSession } from './relay-routing-apply.mjs';

const number = ip => ip.split('.').reduce((n, octet) => n * 256 + Number(octet), 0);
export const ipv4 = n => [24, 16, 8, 0].map(bits => (n >>> bits) & 255).join('.');
export function block(value) {
  const parts = typeof value === 'string' ? value.split('/') : [];
  if (parts.length !== 2 || !isIPv4(parts[0]) || !/^(?:[1-9]|[12]\d|3[0-2])$/.test(parts[1])) return;
  const prefix = Number(parts[1]), size = 2 ** (32 - prefix);
  const start = Math.floor(number(parts[0]) / size) * size;
  return { start, end: start + size - 1, cidr: ipv4(start) + '/' + prefix };
}
export const overlaps = (a, b) => a.start <= b.end && b.start <= a.end;
const reserved = ['0.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '224.0.0.0/4', '240.0.0.0/4'].map(block);
function usable(cidr) {
  const range = block(cidr);
  return range && !reserved.some(r => overlaps(r, range)) ? range : undefined;
}
export function gatewayNetworks(values) {
  if (!Array.isArray(values) || values.length > 4096) fail(400, '单份配置最多支持 4096 条 IPv4 前缀。');
  return [...new Set(values.map(value => {
    const range = usable(value);
    if (!range || range.cidr !== value) fail(400, '请填写规范的单播 IPv4 网段，例如 192.168.20.0/24。');
    return value;
  }))];
}

async function inventory(host) {
  if (host.platform === 'win32') {
    const json = await host.run(`
      $up=@((Get-NetIPInterface -AddressFamily IPv4 | Where-Object ConnectionState -eq Connected).InterfaceIndex)
      $ips=@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceIndex -in $up -and $_.AddressState -eq 'Preferred' } | ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength)" })
      $routes=@(Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore | Where-Object { $_.InterfaceIndex -in $up -and $_.Protocol -ne 'Local' } | Select-Object -ExpandProperty DestinationPrefix)
      @{ addresses=$ips; routes=$routes } | ConvertTo-Json -Compress`);
    return JSON.parse(json);
  }
  const links = JSON.parse(await host.run('ip -j -4 address show up'));
  const addresses = links.flatMap(link => (link.addr_info || []).filter(a => a.family === 'inet' && a.scope === 'global')
    .map(a => a.local + '/' + a.prefixlen));
  const routes = JSON.parse(await host.run('ip -j -4 route show table main'));
  return { addresses, routes: routes.filter(r => (!r.type || r.type === 'unicast') && !r.flags?.includes('linkdown'))
    .map(r => isIPv4(r.dst) ? r.dst + '/32' : r.dst) };
}

export async function discoverGateway(input, lan, access, interfaces = networkInterfaces(), connect = routingManagementSession) {
  if (!access.desktopAdmin && !access.routingDiscovery) fail(403, '读取 A 的网段需要编辑和检测权限。');
  const a = routingAddress(input.a, ' A ');
  const local = Object.values(interfaces).some(records => records?.some(r => r.address === a));
  let profile;
  if (!local) {
    if (!access.desktopAdmin && !access.sshAllowed) fail(403, '读取远程 A 的路由表需要局域网主机的 SSH 终端权限。');
    const matches = (await lan?.hostRequest('list') || []).filter(h => h.mode === 'ssh' && h.address === a && h.fingerprint);
    profile = input.profile && access.desktopAdmin ? matches.find(h => h.id === input.profile) : matches.length === 1 && matches[0];
    if (!profile) {
      if (!access.desktopAdmin) fail(409, '请在桌面为 A 确认唯一的 SSH 管理档案。');
      return { profiles: matches.map(({ id, name, user, port }) => ({ id, label: name + ' · ' + user + ':' + port })) };
    }
  }
  access.authorize?.();
  const host = await connect(lan, profile?.id, { elevated: false, maxOutput: 2 * 1024 * 1024 });
  try {
    const { addresses, routes } = await inventory(host);
    const links = [...new Set(addresses)].filter(cidr => usable(cidr)).map(cidr => ({
      address: cidr.split('/')[0], network: block(cidr).cidr,
    }));
    const networks = [...new Set([...links.map(l => l.network), ...routes.map(cidr => usable(cidr)?.cidr).filter(Boolean)])];
    access.authorize?.();
    return { a, links, networks: gatewayNetworks(networks) };
  } finally { host.close(); }
}
