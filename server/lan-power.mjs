import { createSocket } from 'node:dgram';
import { isIPv4 } from 'node:net';
import { hostTarget, resolveAddress } from './lan-probe.mjs';
import { ipv4Number, ipv4Text, lanInterfaces } from './lan-discovery.mjs';

export function normalizeMac(value) {
  if (typeof value !== 'string') throw new Error('请输入有效的设备 MAC 地址。');
  const trimmed = value.trim();
  const mac = trimmed.replace(/[:-]/g, '').toLowerCase();
  if (!/^(?:[0-9a-f]{12}|[0-9a-f]{2}(?::[0-9a-f]{2}){5}|[0-9a-f]{2}(?:-[0-9a-f]{2}){5})$/i.test(trimmed) || /^0+$/.test(mac) || (Number.parseInt(mac.slice(0, 2), 16) & 1)) throw new Error('请输入有效的单播 MAC 地址。');
  return mac.match(/../g).join(':');
}

export function magicPacket(mac) {
  const bytes = Buffer.from(normalizeMac(mac).replaceAll(':', ''), 'hex');
  return Buffer.concat([Buffer.alloc(6, 255), ...Array(16).fill(bytes)]);
}

export function localBroadcast(addresses, interfaces) {
  const sorted = [...interfaces].sort((a, b) => b.bits - a.bits);
  for (const address of addresses.filter(isIPv4)) {
    const target = ipv4Number(address);
    for (const source of sorted) {
      if (source.bits > 30) continue;
      const network = ipv4Number(source.network), broadcast = network + 2 ** (32 - source.bits) - 1;
      if (target > network && target < broadcast) return { address: source.address, broadcast: ipv4Text(broadcast) };
    }
  }
  throw new Error('目标地址不在可用网卡的直连 IPv4 网段内。请检查目标 IP 和本机网络。');
}

export async function wakeHost(host) {
  if (!host.mac) throw new Error('请在主机档案填写 MAC 地址。');
  const data = magicPacket(host.mac);
  const { address, broadcast } = localBroadcast(await resolveAddress(hostTarget(host).address), lanInterfaces());
  await new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    let settled = false;
    const timer = setTimeout(() => finish(new Error('发送唤醒包超时。')), 4000);
    function finish(error) {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.close();
      if (error) reject(error); else resolve();
    }
    socket.once('error', finish);
    socket.bind(0, address, () => {
      if (settled) return;
      try { socket.setBroadcast(true); socket.send(data, 9, broadcast, finish); }
      catch (error) { finish(error); }
    });
  });
  return { broadcast };
}
