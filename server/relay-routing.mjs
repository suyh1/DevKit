import net from 'node:net';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fail, shortText } from './collab-record.mjs';

const exec = promisify(execFile);
export function routingAddress(ip) {
  if (!net.isIPv4(ip) || /^(0|127)\./.test(ip) || Number(ip.split('.')[0]) >= 224) fail(400, '请填写有效的单播 IPv4 地址。');
  return ip;
}
export function normalizeRouting(input) {
  if (!['A', 'B', 'C'].includes(input.role)) fail(400, '请选择 DevKit 的安装位置。');
  const plan = { kind: 'routing', name: shortText(input.name, 80, '方案名称'), role: input.role };
  for (const key of ['b', 'c', 'ab', 'ac']) {
    plan[key] = routingAddress(input[key]);
  }
  if (input.a) {
    plan.a = routingAddress(input.a);
    if ([plan.b, plan.c].includes(plan.a)) fail(400, 'A、B、C 须使用不同地址。');
  }
  if (plan.b === plan.c || [plan.b, plan.c].some(ip => ip === plan.ab || ip === plan.ac)) fail(400, 'B、C 和网关必须使用不同地址。');
  return plan;
}

function linuxInterface(ip) {
  return `$(ip -o -4 addr show to ${ip}/32 | awk 'NR==1 {sub(/@.*/, "", $2); print $2}')`;
}
function windowsIndex(ip) {
  return `(Get-NetIPAddress -AddressFamily IPv4 -IPAddress '${ip}' -ErrorAction Stop).InterfaceIndex`;
}
function endpoint(local, peer, gateway) {
  return {
    linux: `ip -4 route get ${gateway}\nip -4 route show exact ${peer}/32\nsudo ip -4 route add ${peer}/32 via ${gateway} src ${local}\nip -4 route get ${peer} from ${local}`,
    persist: `[Route]\nDestination=${peer}/32\nGateway=${gateway}\nPreferredSource=${local}`,
    nm: `+ipv4.routes "${peer}/32 ${gateway}"`,
    windows: `$ifIndex = ${windowsIndex(local)}\nGet-NetRoute -DestinationPrefix '${peer}/32' -ErrorAction SilentlyContinue\nNew-NetRoute -DestinationPrefix '${peer}/32' -InterfaceIndex $ifIndex -NextHop '${gateway}' -ErrorAction Stop\nFind-NetRoute -LocalIPAddress '${local}' -RemoteIPAddress '${peer}'`,
    undoLinux: `sudo ip -4 route del ${peer}/32 via ${gateway}`,
    undoWindows: `Remove-NetRoute -DestinationPrefix '${peer}/32' -InterfaceIndex ${windowsIndex(local)} -NextHop '${gateway}'`,
  };
}
export function routingSteps(plan) {
  const ips = [...new Set([plan.ab, plan.ac])];
  const selectors = ips.map(ip => linuxInterface(ip));
  return {
    A: {
      linux: selectors.map(selector => `dev="${selector}"\n[ -n "$dev" ] && sysctl "net/ipv4/conf/$dev/forwarding" && sudo sysctl -w "net/ipv4/conf/$dev/forwarding=1"`).join('\n'),
      persist: selectors.map(selector => `dev="${selector}"; [ -n "$dev" ] && printf 'net/ipv4/conf/%s/forwarding=1\\n' "$dev"`).join('\n'),
      windows: ips.map(ip => `$ifIndex = ${windowsIndex(ip)}\nGet-NetIPInterface -InterfaceIndex $ifIndex -AddressFamily IPv4 | Select-Object InterfaceAlias,Forwarding\nSet-NetIPInterface -InterfaceIndex $ifIndex -AddressFamily IPv4 -Forwarding Enabled -ErrorAction Stop`).join('\n'),
    },
    B: endpoint(plan.b, plan.c, plan.ab),
    C: endpoint(plan.c, plan.b, plan.ac),
  };
}

async function readNetworking(file, args) {
  const { stdout } = await exec(file, args, { timeout: 5000, windowsHide: true, maxBuffer: 65536 });
  return stdout.trim();
}
async function powershell(command) {
  return readNetworking('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; " + command]);
}
export async function inspectRouting(plan) {
  const interfaces = os.networkInterfaces();
  const gateway = plan.role === 'B' ? plan.ab : plan.ac;
  const local = plan.role === 'B' ? plan.b : plan.c;
  const peer = plan.role === 'B' ? plan.c : plan.b;
  const ips = plan.role === 'A' ? [...new Set([plan.ab, plan.ac])] : [local];
  const messages = [];
  for (const ip of ips) {
    const entry = Object.entries(interfaces).find(([, addresses]) => addresses?.some(record => record.address === ip));
    if (!entry) { messages.push('本机未找到 ' + ip + '，请核对安装位置和接口地址。'); continue; }
    const [device] = entry;
    messages.push(ip + ' 已绑定到本机接口 ' + device + '。');
    try {
      if (plan.role === 'A') {
        let enabled;
        if (process.platform === 'linux') enabled = (await readFile('/proc/sys/net/ipv4/conf/' + device + '/forwarding', 'utf8')).trim() === '1';
        else if (process.platform === 'win32') enabled = (await powershell(`(Get-NetIPInterface -AddressFamily IPv4 -InterfaceIndex ${windowsIndex(ip)}).Forwarding.ToString()`)) === 'Enabled';
        else { messages.push('请在系统网络设置核对 IPv4 转发。'); continue; }
        messages.push(device + (enabled ? ' 已开启 IPv4 转发。' : ' 尚未开启 IPv4 转发。'));
      } else {
        let nextHop;
        if (process.platform === 'linux') {
          const [route] = JSON.parse(await readNetworking('ip', ['-j', '-4', 'route', 'get', peer, 'from', local]));
          nextHop = route?.gateway;
        } else if (process.platform === 'win32') {
          nextHop = await powershell(`(Find-NetRoute -LocalIPAddress '${local}' -RemoteIPAddress '${peer}' | Where-Object { $_.PSObject.Properties['NextHop'] }).NextHop`);
        } else { messages.push('请使用本机路由表核对下一跳。'); continue; }
        messages.push(nextHop === gateway ? '到 ' + peer + ' 的下一跳与方案一致：' + gateway : '到 ' + peer + ' 的当前下一跳为 ' + (nextHop || '直连或未知') + '，方案要求 ' + gateway + '。');
      }
    } catch { messages.push('未能读取本机路由或转发状态，请按对应设备的步骤核对。'); }
  }
  return messages;
}
