import net from 'node:net';
import { checkRevision, fail, newRecord, requireRecord, shortText } from './collab-record.mjs';
import { sshCall } from './ssh-exec.mjs';
import { withDeadline } from './lan-probe.mjs';
import { listen, openDestination, sshBanner, tcp } from './relay-transport.mjs';

import { normalizeRouting, inspectRouting, routingSteps } from './relay-routing.mjs';
import { applyRouting } from './relay-routing-apply.mjs';

const modes = { A: ['direct'], B: ['direct', 'ssh', 'http', 'socks'], C: ['reverse'] };
function port(value) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) fail(400, '端口须为 1 至 65535 的整数。');
  return value;
}
function hostname(value) {
  const host = shortText(value, 253, '主机地址');
  if (!net.isIP(host) && !host.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) fail(400, '请填写主机 IP 或域名。');
  return host;
}
function normalize(data) {
  if (!Object.hasOwn(modes, data.role)) fail(400, '请选择安装位置。');
  const rule = { role: data.role, name: shortText(data.name, 80, '服务名称'), target: hostname(data.target),
    targetPort: port(data.targetPort), listenPort: port(data.listenPort), bind: data.bind, source: data.source || '' };
  if (!net.isIPv4(rule.bind) || (rule.source && !net.isIPv4(rule.source))) fail(400, '监听 IP 和允许的来源须为 IPv4。');
  if (!rule.bind.startsWith('127.') && !rule.source) fail(400, '请指定允许接入此入口的客户端 IPv4。');
  if (rule.role === 'C' && (!rule.source || rule.bind.startsWith('127.'))) fail(400, '请填写 B 能访问的 A 监听 IP 和 B 的来源 IPv4。');
  if (rule.role !== 'A') Object.assign(rule, { hub: hostname(data.hub), sshPort: port(data.sshPort), user: String(data.user || '').trim().slice(0,128) });
  if (rule.role === 'B') Object.assign(rule, { httpPort: port(data.httpPort), socksPort: port(data.socksPort) });
  if (data.passive) {
    const range = /^(\d{1,5})-(\d{1,5})$/.exec(data.passive);
    if (!range) fail(400, 'FTP 被动端口示例：50000-50009。');
    const low = port(Number(range[1])), high = port(Number(range[2]));
    if (high < low || high - low >= 32 || [rule.listenPort, rule.targetPort].some(p => p >= low && p <= high)) fail(400, '被动范围最多 32 个端口，须与控制端口分开。');
    rule.passive = low + '-' + high;
  }
  return rule;
}
function ports(rule) {
  const pairs = [[rule.listenPort, rule.targetPort]];
  if (rule.passive) {
    const [low, high] = rule.passive.split('-').map(Number);
    for (let p = low; p <= high; p++) pairs.push([p,p]);
  }
  return pairs;
}
export function createRelay(lan, changed) {
  const runs = new Map();
  const lastError = new Map();
  async function connectHub(rule, access) {
    if (access.sshAllowed === false) fail(403, '使用 A 的 SSH 档案需要局域网主机终端权限。');
    if (!lan) fail(503, 'SSH 主机档案暂不可用。');
    access.authorize?.();
    return lan.openRelay(rule.hub, rule.sshPort, rule.user);
  }
  async function detect(rule, access) {
    async function check(mode) {
      let client;
      let stage = mode === 'direct' ? '目标服务' : mode === 'http' || mode === 'socks' ? 'A 的代理入口或代理至目标的路径' : 'A 的 SSH 入口';
      try {
        if (mode === 'ssh' || mode === 'reverse') {
          await sshBanner(rule);
          try { client = await connectHub(rule, access); }
          catch (error) { return { mode, ok: false, message: '已识别 SSH。' + error.message }; }
        }
        if (mode === 'reverse') {
          stage = 'C 至本地服务';
          (await tcp(rule.target, rule.targetPort)).destroy();
          stage = 'A 的反向监听';
          access.authorize?.();
          client.on('tcp connection', (_info, _accept, reject) => reject());
          await withDeadline(sshCall(client, 'forwardIn', rule.bind, rule.listenPort), 4500, 'A 未响应监听请求。');
          await withDeadline(sshCall(client, 'unforwardIn', rule.bind, rule.listenPort), 4500, '探测监听未能正常释放。');
        } else {
          if (mode === 'ssh') stage = 'A 至目标的 SSH 转发';
          (await openDestination(rule, mode, rule.targetPort, client)).destroy();
        }
        return { mode, ok: true, message: mode === 'reverse' ? '本机服务可达，A 已接受监听请求。仍需从 B 验证入口。' : '已通过此路径连接目标 TCP 端口。' };
      } catch (e) { return { mode, ok: false, message: stage + '：' + e.message }; }
      finally { client?.destroy(); }
    }
    return Promise.all(modes[rule.role].map(check));
  }
  function stop(run, reason = '') {
    if (run.closed) return;
    run.closed = true;
    runs.delete(run.id);
    for (const server of run.servers) server.close();
    for (const socket of run.sockets) socket.destroy();
    run.client?.destroy();
    if (reason) lastError.set(run.id, reason);
    changed();
  }
  async function start(rule, mode, access) {
    if (!modes[rule.role].includes(mode)) fail(400, '所选方式不适用于此安装位置。');
    const run = { id: rule.id, mode, owner: access.owner, servers: [], sockets: new Set(), closed: false, connected: false, ready: false };
    if (runs.has(run.id)) fail(409, '此规则正在运行。');
    runs.set(run.id, run);
    const allow = ip => rule.source ? ip === rule.source || ip === '::ffff:' + rule.source : ip?.startsWith('127.');
    async function bridge(source, destPort) {
      run.sockets.add(source);
      source.once('error', () => source.destroy());
      let dest;
      source.once('close', () => { run.sockets.delete(source); dest?.destroy(); });
      try {
        dest = await openDestination(rule, mode, destPort, run.client);
        if (run.closed || source.destroyed) { dest.destroy(); return; }
        dest.once('error', () => source.destroy());
        dest.once('close', () => source.destroy());
        if (!run.connected || lastError.has(run.id)) { run.connected = true; lastError.delete(run.id); changed(); }
        source.pipe(dest); dest.pipe(source);
      } catch (e) {
        if (!run.closed) { lastError.set(run.id, e.message); changed(); }
        source.destroy();
      }
    }
    try {
      if (['reverse', 'ssh'].includes(mode)) {
        const client = await connectHub(rule, access);
        if (run.closed) { client.destroy(); fail(409, '启动已取消。'); }
        run.client = client;
        client.once('close', () => stop(run, 'A 的 SSH 会话已关闭。'));
      }
      const mapping = new Map(ports(rule));
      if (mode === 'reverse') run.client.on('tcp connection', (info, accept, reject) => {
        if (!run.ready || !allow(info.srcIP) || !mapping.has(info.destPort) || run.sockets.size >= 128) return reject();
        void bridge(accept(), mapping.get(info.destPort));
      });
      for (const [local, remote] of mapping) {
        access.authorize?.();
        if (run.closed) fail(409, '连接已关闭。');
        if (mode === 'reverse') await withDeadline(sshCall(run.client, 'forwardIn', rule.bind, local), 4500, 'A 未响应监听请求。');
        else {
          const server = net.createServer({ allowHalfOpen: true }, socket => {
            if (!run.ready || !allow(socket.remoteAddress) || run.sockets.size >= 128) return socket.destroy();
            void bridge(socket, remote);
          });
          run.servers.push(server);
          await listen(server, rule.bind, local);
          server.on('error', e => stop(run, e.message));
        }
      }
      access.authorize?.();
      if (run.closed) fail(409, '启动已取消。');
      run.ready = true;
      lastError.delete(rule.id); changed();
    } catch (e) { stop(run, e.message); throw e; }
  }
  return {
    async request({ rows, commit, action, input, access }) {
      if (action === 'list') return rows.map(row => {
        if (row.kind === 'routing') return { ...row, steps: routingSteps(row) };
        const run = runs.get(row.id);
        return { ...row, mode: run?.mode, connected: !!run?.connected, error: lastError.get(row.id) || '' };
      });
      if (action === 'save') {
        const before = input.id ? requireRecord(rows, input.id) : null;
        if (before) checkRevision(before, input.revision);
        if (before && runs.has(before.id)) fail(409, '请先停止转发再修改规则。');
        if (!before && rows.length >= 64) fail(400, '最多保存 64 项服务规则。');
        if (before && (before.kind === 'routing') !== (input.kind === 'routing')) fail(400, '请保留原方案类型。');
        const settings = input.kind === 'routing' ? normalizeRouting(input) : normalize(input);
        const row = { ...(before ? { id: before.id, revision: before.revision + 1 } : newRecord()), ...settings };
        await commit(before ? rows.map(item => item.id === row.id ? row : item) : [...rows, row]);
        lastError.delete(row.id); return { id: row.id, revision: row.revision };
      }
      const rule = requireRecord(rows, input.id);
      checkRevision(rule, input.revision);
      if (rule.kind === 'routing' && action !== 'remove') {
        const plan = normalizeRouting(rule);
        if (action === 'detect') return inspectRouting(plan);
        if (action !== 'apply' || !access.desktopAdmin) fail(403, '一键配置仅限 DevKit 桌面主机。');
        return applyRouting(plan, input.profiles, lan);
      }
      switch (action) {
        case 'detect': return detect(rule, access);
        case 'start': await start(rule, input.mode, access); break;
        case 'stop': if (runs.has(rule.id)) stop(runs.get(rule.id)); break;
        case 'remove':
          if (runs.has(rule.id)) fail(409, '请先停止转发。');
          await commit(rows.filter(r => r.id !== rule.id)); lastError.delete(rule.id); break;
        default: fail(404, '未知转发操作。');
      }
      return {};
    },
    release(owner) { for (const run of runs.values()) if (run.owner === owner) stop(run); },
    close() { for (const run of runs.values()) stop(run); },
  };
}
