import { execFile } from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { probePort } from './lan-probe.mjs';

const command = promisify(execFile);
export const ipv4Number = address => address.split('.').reduce((number, part) => number * 256 + Number(part), 0);
export const ipv4Text = value => [24, 16, 8, 0].map(shift => value >>> shift & 255).join('.');
const mask = bits => bits ? (0xffffffff << (32 - bits)) >>> 0 : 0;

export function lanInterfaces(interfaces = networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, addresses]) => (addresses || []).filter(item => item.family === 'IPv4' && !item.internal && item.cidr).map(item => {
    const bits = Number(item.cidr.split('/')[1]);
    const suggestedBits = Math.max(bits, 24);
    return { name, address: item.address, bits, network: ipv4Text((ipv4Number(item.address) & mask(bits)) >>> 0), suggestion: `${ipv4Text((ipv4Number(item.address) & mask(suggestedBits)) >>> 0)}/${suggestedBits}` };
  }));
}

export function scanRange(source, range) {
  if (typeof range !== 'string' || range.length > 45) throw new Error('请输入 IPv4 网段或起止地址。');
  let first, last;
  const cidr = /^(\S+)\/(\d{1,2})$/.exec(range.trim());
  const bounds = /^(\S+)\s*-\s*(\S+)$/.exec(range.trim());
  if (cidr && isIPv4(cidr[1]) && Number(cidr[2]) <= 32) {
    first = (ipv4Number(cidr[1]) & mask(Number(cidr[2]))) >>> 0;
    last = first + 2 ** (32 - Number(cidr[2])) - 1;
  } else if (bounds && isIPv4(bounds[1]) && isIPv4(bounds[2])) {
    first = ipv4Number(bounds[1]); last = ipv4Number(bounds[2]);
  } else if (isIPv4(range.trim())) first = last = ipv4Number(range.trim());
  else throw new Error('请输入 IPv4 网段或起止地址，例如 192.168.1.0/24。');
  if (last < first || last - first >= 256) throw new Error('每次扫描最多 256 个地址，并且结束地址须大于或等于起始地址。');
  const start = ipv4Number(source.network), end = start + 2 ** (32 - source.bits) - 1;
  if (first < start || last > end) throw new Error('扫描范围须位于所选网卡的直连网段内。');
  return Array.from({ length: last - first + 1 }, (_, index) => first + index).filter(value => source.bits >= 31 || value !== start && value !== end).map(ipv4Text);
}

async function neighborMacs(source, signal) {
  const macs = new Map();
  if (process.platform === 'win32') {
    const { stdout } = await command('arp.exe', ['-a', '-N', source.address], { windowsHide: true, timeout: 3000, signal });
    for (const [, address, mac] of stdout.matchAll(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s/gim)) macs.set(address, mac.replaceAll('-', ':').toLowerCase());
  } else if (process.platform === 'darwin') {
    const { stdout } = await command('arp', ['-an', '-i', source.name], { timeout: 3000, signal });
    for (const [, address, mac] of stdout.matchAll(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})\s/gi)) {
      macs.set(address, mac.toLowerCase().split(':').map(part => part.padStart(2, '0')).join(':'));
    }
  } else {
    for (const line of (await readFile('/proc/net/arp', 'utf8')).split('\n').slice(1)) {
      const [address, , flags, mac, , name] = line.trim().split(/\s+/);
      if (source.name === name && (Number(flags) & 2) && /^[\da-f]{2}(?::[\da-f]{2}){5}$/i.test(mac)) macs.set(address, mac.toLowerCase());
    }
  }
  return macs;
}

async function mapConcurrent(items, limit, signal, run) {
  const result = Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    while (next < items.length) {
      signal.throwIfAborted();
      const index = next++;
      result[index] = await run(items[index]);
    }
  }));
  return result;
}

export async function discoverHosts(source, range, port, signal, { probe = probePort, neighbors = neighborMacs, resolveNames = true } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 探测端口无效。');
  const addresses = scanRange(source, range);
  const results = await mapConcurrent(addresses, 24, signal, address => probe(address, port, { timeout: 750, localAddress: source.address, signal }));
  const macs = await neighbors(source, signal).catch(() => new Map());
  const devices = addresses.flatMap((address, index) => {
    const { ok, code, elapsed } = results[index], mac = macs.get(address);
    if (!ok && code !== 'ECONNREFUSED' && !mac) return [];
    return [{ address, mac, portOpen: ok, response: ok ? 'open' : code === 'ECONNREFUSED' ? 'refused' : 'neighbor', elapsed: ok ? elapsed : undefined }];
  });
  if (!resolveNames) return { scanned: addresses.length, devices };
  const resolver = new Resolver({ timeout: 350, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const named = await mapConcurrent(devices, 16, signal, async device => ({
      ...device, name: (await resolver.reverse(device.address).catch(() => []))[0],
    }));
    signal.throwIfAborted();
    return { scanned: addresses.length, devices: named };
  } finally { signal.removeEventListener('abort', cancel); }
}
