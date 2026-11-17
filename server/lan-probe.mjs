import { connect, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export function withDeadline(promise, timeout, message = '操作超时') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); })])
    .finally(() => clearTimeout(timer));
}

export function hostTarget(host) {
  if (host.mode === 'ssh') return { address: host.address, port: host.port };
  const url = new URL(host.address);
  return { address: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) };
}

export function probePort(address, port, { timeout = 2500, localAddress, signal } = {}) {
  const start = performance.now();
  return new Promise(resolve => {
    const socket = connect({ host: address, port, localAddress, signal });
    function finish(ok, code) {
      socket.destroy();
      resolve({ ok, code, elapsed: Math.round(performance.now() - start) });
    }
    socket.setTimeout(timeout, () => finish(false, 'ETIMEDOUT'));
    socket.once('connect', () => finish(true));
    socket.once('error', error => finish(false, error.code || 'ERROR'));
  });
}

export const portDetails = {
  ECONNREFUSED: '端口拒绝连接', ETIMEDOUT: '端口探测超时', EHOSTUNREACH: '主机不可达', ENETUNREACH: '网络不可达',
  ENOTFOUND: '主机名无法解析', EAI_AGAIN: '主机名解析暂时失败', ABORT_ERR: '探测已取消',
};

export async function resolveAddress(address) {
  if (isIP(address)) return [address];
  return (await withDeadline(lookup(address, { all: true }), 4000, '主机名解析超时')).map(item => item.address);
}
