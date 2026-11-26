import { networkInterfaces } from 'node:os';
import { fail } from './collab-record.mjs';
import { routingAddress } from './relay-routing.mjs';
import { routingManagementSession } from './relay-routing-apply.mjs';

const roles = ['A', 'B', 'C'];
const manual = reason => ({ reason });
const ipNumber = ip => ip.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);

async function interfaceToward(host, peer, endpoints) {
  try {
    let source, prefix;
    if (host.platform === 'linux') {
      const routes = JSON.parse(await host.run('ip -j -4 route get ' + peer));
      const [route] = routes;
      if (routes.length !== 1 || !route?.dev || route.gateway || route.via || route.type && route.type !== 'unicast')
        return manual('到该设备的选路不是唯一的直连路由，请核对中间网关。');
      source = routingAddress(route.prefsrc);
      const fib = JSON.parse(await host.run('ip -j -4 route get fibmatch ' + peer));
      if (fib.length !== 1 || fib[0].nhid || fib[0].nexthops?.length || fib[0].multipath?.length)
        return manual('路由包含多条路径或下一跳组，请确认入口。');
      const addresses = await host.run('ip -o -4 addr show to ' + source + '/32');
      const lines = addresses.trim().split('\n');
      const [, device, family, cidr] = lines[0].trim().split(/\s+/);
      if (lines.length !== 1 || device?.split('@')[0] !== route.dev || family !== 'inet' || cidr?.split('/')[0] !== source)
        return manual('选路源地址与接口上的 IPv4 不一致。');
      prefix = Number(cidr.split('/')[1]);
    } else {
      const found = JSON.parse(await host.run(`
        $selection=@(Find-NetRoute -RemoteIPAddress '${peer}')
        $r=@($selection | Where-Object { $_.PSObject.Properties['NextHop'] })
        $s=@($selection | Where-Object { $_.PSObject.Properties['IPAddress'] })
        if ($r.Count -ne 1 -or $s.Count -ne 1 -or $r[0].InterfaceIndex -ne $s[0].InterfaceIndex -or $r[0].NextHop -ne '0.0.0.0') { '{}' }
        else { @{ ip=$s[0].IPAddress; prefix=[int]$s[0].PrefixLength } | ConvertTo-Json -Compress }`));
      if (!found.ip) return manual('Windows 未选出唯一的直连接口，请核对中间网关。');
      source = routingAddress(found.ip);
      prefix = found.prefix;
    }
    if (endpoints.includes(source) || !Number.isInteger(prefix) || prefix < 1 || prefix > 32 ||
        Math.floor(ipNumber(source) / 2 ** (32-prefix)) !== Math.floor(ipNumber(peer) / 2 ** (32-prefix)))
      return manual('出口地址与对端不在已确认的直连前缀内。');
    return { ip:source };
  } catch { return manual('未能读取到该设备的直连路由和源地址。'); }
}

export async function discoverRouting(input, lan, localInterfaces = networkInterfaces(), connect = routingManagementSession) {
  const ips = { A:routingAddress(input.a), B:routingAddress(input.b), C:routingAddress(input.c) };
  if (new Set(Object.values(ips)).size !== 3) fail(400, 'A、B、C 须使用不同地址。');
  if (input.role && !roles.includes(input.role)) fail(400, '安装位置无效。');
  const local = new Set(Object.values(localInterfaces).flat().map(item => item?.address));
  const matches = roles.filter(role => local.has(ips[role]));
  const role = input.role || (matches.length === 1 ? matches[0] : undefined);
  if (!role) return { reason:'本机接口未能唯一匹配三台设备，请选择 DevKit 所在位置后重新检测。' };
  let trusted = [];
  try { trusted = ((await lan?.hostRequest('list')) || []).filter(h => h.mode === 'ssh' && h.fingerprint); }
  catch { /* A local route lookup can still proceed without the management inventory. */ }
  const profiles = {}, candidates = trusted.filter(h => h.address === ips.A);
  for (const key of roles.filter(key => key !== role)) {
    const found = trusted.filter(h => h.address === ips[key]);
    if (found.length === 1) profiles[key] = found[0].id;
  }
  if (input.profileA && candidates.some(h => h.id === input.profileA)) profiles.A = input.profileA;
  if (role !== 'A' && !profiles.A && candidates.length > 1)
    return { role, candidates:candidates.map(({ id, name, user, port }) => ({ id, label:name + ' · ' + user + ':' + port })) };
  let host;
  try {
    if (role !== 'A' && !profiles.A) throw new Error('没有与 A 地址匹配且已确认指纹的 SSH 档案。');
    host = await connect(lan, role === 'A' ? undefined : profiles.A, { elevated:false });
    const endpoints = [ips.B, ips.C];
    const [ab, ac] = await Promise.all(endpoints.map(ip => interfaceToward(host, ip, endpoints)));
    return { role, profiles, ab, ac };
  } catch (error) {
    const missing = manual('无法读取 A 的选路：' + error.message);
    return { role, profiles, ab:missing, ac:missing };
  } finally { host?.close(); }
}
