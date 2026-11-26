import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { sshCall } from './ssh-exec.mjs';
import { withDeadline } from './lan-probe.mjs';

const timeout = 4500;
export async function tcp(host, port) {
  const socket = net.createConnection({ host, port, allowHalfOpen: true });
  try { await withDeadline(once(socket, 'connect'), timeout, 'TCP 连接超时'); return socket; }
  catch (error) { socket.destroy(); throw error; }
}
async function httpTunnel(rule, port) {
  const authority = (net.isIPv6(rule.target) ? '[' + rule.target + ']' : rule.target) + ':' + port;
  const req = http.request({ method: 'CONNECT', hostname: rule.hub, port: rule.httpPort, path: authority,
    headers: { Host: authority }, agent: false, maxHeaderSize: 16384 });
  const connected = once(req, 'connect');
  req.end();
  try {
    const [response, socket, head] = await withDeadline(connected, timeout, 'HTTP CONNECT 握手超时');
    if (response.statusCode < 200 || response.statusCode >= 300) {
      socket.destroy();
      throw new Error(response.statusCode === 407 ? '代理要求认证（407）。' : '代理拒绝 CONNECT（HTTP ' + response.statusCode + '）。');
    }
    if (head.length) socket.unshift(head);
    return socket;
  } catch (error) { req.destroy(); throw error; }
}
export async function openDestination(rule, mode, port, client) {
  if (mode === 'http') return httpTunnel(rule, port);
  if (mode === 'socks') {
    const { SocksClient } = await import('socks');
    return (await SocksClient.createConnection({ proxy: { host: rule.hub, port: rule.socksPort, type: 5 },
      command: 'connect', destination: { host: rule.target, port }, timeout })).socket;
  }
  if (mode !== 'ssh') return tcp(rule.target, port);
  // Close a channel even if the connection was granted after our deadline.
  let expired = false;
  try {
    return await withDeadline(sshCall(client, 'forwardOut', '127.0.0.1', 0, rule.target, port).then(stream => {
      if (expired) stream.destroy();
      return stream;
    }), timeout, 'A 未及时响应 SSH 转发请求。');
  } catch (error) { expired = true; throw error; }
}
export async function sshBanner(rule) {
  const socket = await tcp(rule.hub, rule.sshPort);
  let data = '';
  try {
    await withDeadline(new Promise((resolve, reject) => {
      socket.on('data', chunk => {
        data += chunk.toString('ascii');
        if (/^SSH-(?:2\.0|1\.99)-[^\r\n]+/m.test(data)) resolve();
        else if (data.length > 2048) reject(new Error('未收到 SSH 标识。'));
      });
      socket.once('error', reject);
      socket.once('close', () => reject(new Error('连接关闭，未收到 SSH 标识。')));
    }), timeout, '未收到 SSH 标识。');
  } finally { socket.destroy(); }
}
export async function listen(server, bind, port) {
  const ready = once(server, 'listening');
  server.listen({ host: bind, port, exclusive: true });
  await ready;
}
