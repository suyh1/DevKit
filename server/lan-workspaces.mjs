import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createLanHostStore, publicHost } from './lan-host-store.mjs';
import { authorizeWorkspace, fullAccess, managedRequest } from './managed-workspace.mjs';
import { connectSsh, openSshShell, runSshCommand } from './lan-ssh.mjs';
import { requestSsh } from './ssh-management.mjs';
import { shareTransport, sshTransport } from './lan-transports.mjs';

const identity = /^[a-f0-9-]{36}$/;
const qualified = (hostId, id) => hostId ? `${hostId}:${id}` : id;
const tag = (item, hostId) => ({ ...item, id: qualified(hostId, item.id), ...(hostId ? { hostId } : {}) });
function stateFor(module, state, hostId, access) {
  return { ...state, instances: state.instances.map(item => {
    const value = tag(item, hostId);
    if (module === 'jar' && !access.edit) Object.assign(value, { env: {}, jvmArgs: [], appArgs: [], profiles: item.profiles.map(profile => ({ ...profile, env: {} })) });
    return value;
  }) };
}

export async function createLanWorkspaces(directory, transports = { share: shareTransport, ssh: sshTransport }) {
  const store = await createLanHostStore(directory);
  const connections = new Map(), cache = new Map(), terminals = new Map();
  const desktopSession = randomUUID();
  let terminalGeneration = 0;
  const find = id => store.list().find(item => item.id === id);
  function connection(host, session) {
    const key = host.mode === 'share' ? `${host.id}:${session}` : host.id;
    let entry = connections.get(key);
    if (entry && (entry.host !== host || entry.transport?.closed?.())) { entry.transport?.close(); connections.delete(key); entry = null; }
    if (!entry) {
      entry = { host, session };
      entry.open = store.password(host).then(password => transports[host.mode](host, password)).then(transport => {
        entry.transport = transport;
        if (connections.get(key) !== entry) { transport.close(); throw new Error('连接档案已更新。'); }
        return transport;
      }).catch(error => { if (connections.get(key) === entry) connections.delete(key); throw error; });
      connections.set(key, entry);
    }
    return entry.open;
  }
  function release(session) {
    for (const [key, entry] of cache) if (entry.session === session) cache.delete(key);
    for (const [key, entry] of connections) {
      if (entry.host.mode === 'share' && entry.session === session) {
        connections.delete(key); entry.transport?.close();
      } else if (entry.transport?.release) void entry.transport.release(session).catch(() => {});
    }
  }
  function invalidate() {
    for (const [key, entry] of connections) if (find(entry.host.id) !== entry.host) { connections.delete(key); entry.transport?.close(); }
    for (const [key, entry] of cache) if (find(entry.host.id) !== entry.host) cache.delete(key);
    for (const [id, terminal] of terminals) if (find(terminal.host.id)?.fingerprint !== terminal.host.fingerprint) closeTerminal(id);
  }
  async function remote(host, module, action, payload, access, session) {
    const transport = await connection(host, session);
    return transport.request(module, action, payload, access, session);
  }
  async function request(manager, module, action, payload = {}, access = fullAccess, session = desktopSession) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('请求参数无效。');
    const { scope, scopeAccess, hostId: explicit, ...value } = payload;
    if (scope === 'local' && scopeAccess) access = { edit: access.edit && scopeAccess.edit === true, control: access.control && scopeAccess.control === true };
    authorizeWorkspace(module, action, access);
    const local = (name, data) => managedRequest(manager, module, name, data, access, session === desktopSession ? undefined : session);
    if (scope === 'inventory' && ['get', 'statuses'].includes(action)) {
      const hosts = store.list().filter(host => host.modules[module]);
      const results = hosts.map(async host => {
        const key = `${host.id}:${module}:${session}:${access.edit}:${access.control}`;
        try {
          const transport = await connection(host, session);
          const result = await transport.request(module, action, value, access, session);
          if (action === 'statuses') return { statuses: result.map(item => tag(item, host.id)) };
          const limits = await transport.capabilities?.(module) || fullAccess;
          const permissions = { edit: access.edit && limits.edit, control: access.control && limits.control };
          const state = stateFor(module, result, host.id, permissions);
          const group = { id: host.id, name: host.name, platform: state.platform, revision: state.revision, ...permissions };
          cache.set(key, { host, session, state: stateFor(module, result, host.id, { edit: false }), group });
          return { state, group };
        } catch (error) {
          const previous = cache.get(key);
          const message = host.mode === 'ssh' && !host.fingerprint ? '请在桌面端确认 SSH 主机指纹。' : error.message;
          if (action === 'statuses') return { statuses: (previous?.state.instances || []).map(item => ({ id: item.id, state: 'unknown', detail: message, checkedAt: new Date().toISOString(), pidPath: '', logPath: '' })) };
          return { state: previous?.state, group: { id: host.id, name: host.name, platform: host.platform || '', ...previous?.group, edit: false, control: false, error: message } };
        }
      });
      const [base, others] = await Promise.all([local(action, value), Promise.all(results)]);
      if (action === 'statuses') return [...base, ...others.flatMap(item => item.statuses)];
      const groups = [{ id: '', name: session === desktopSession ? '本机' : '共享主机', platform: base.platform, revision: base.revision, edit: access.edit, control: access.control }, ...others.map(item => item.group)];
      return { ...base, instances: [...base.instances, ...others.flatMap(item => item.state?.instances || [])], groups };
    }
    const identifier = value.id ?? value.instance?.id;
    let hostId = explicit || '';
    if (typeof identifier === 'string' && identifier.includes(':')) {
      const [qualifiedHost, id, extra] = identifier.split(':');
      if (extra !== undefined || !identity.test(id) || !identity.test(qualifiedHost) || hostId && hostId !== qualifiedHost) throw new Error('远程实例标识无效。');
      hostId = qualifiedHost;
      if (value.id !== undefined) value.id = id;
      if (value.instance?.id !== undefined) value.instance = { ...value.instance, id };
    }
    if (!hostId) return local(action, value);
    const host = scope !== 'local' && find(hostId);
    if (!host?.modules?.[module]) throw new Error('目标主机已移除或未开放此栏目。');
    const result = await remote(host, module, action, value, access, session);
    if (['get', 'upsert', 'remove', 'create'].includes(action)) return stateFor(module, result, host.id, access);
    if (action === 'command' && result.status) return { ...result, status: tag(result.status, host.id) };
    if (action === 'review') return { ...result, impacts: result.impacts.map(item => tag(item, host.id)) };
    return result;
  }

  function closeTerminal(id) {
    const entry = terminals.get(id);
    if (entry) { terminals.delete(id); entry.client.destroy(); }
  }
  const dimensions = value => ({ cols: Math.max(2, Math.min(500, Math.trunc(Number(value?.cols)) || 80)), rows: Math.max(2, Math.min(300, Math.trunc(Number(value?.rows)) || 24)) });
  async function hostRequest(action, value) {
    if (action === 'list') return store.list().map(publicHost);
    if (['save', 'import', 'remove'].includes(action)) { const result = await store[action](value); invalidate(); return result; }
    if (action === 'terminal-close') { closeTerminal(value?.id); return true; }
    if (['terminal-read', 'terminal-input', 'terminal-resize'].includes(action)) {
      const terminal = terminals.get(value?.id);
      if (!terminal) throw new Error('终端会话已关闭。');
      if (action === 'terminal-read') {
        const data = Buffer.concat(terminal.output).toString('base64');
        terminal.output = []; terminal.bytes = 0; if (!terminal.closed) terminal.stream.resume();
        return { data, closed: terminal.closed };
      }
      if (terminal.closed) return false;
      if (action === 'terminal-input' && typeof value.text === 'string' && Buffer.byteLength(value.text) <= 524288) terminal.stream.write(value.text);
      if (action === 'terminal-resize') { const { rows, cols } = dimensions(value); terminal.stream.setWindow(rows, cols, 0, 0); }
      return true;
    }
    const host = find(value?.id);
    if (!host) throw new Error('找不到已保存的主机连接。');
    if (action === 'legacy-import' && host.mode === 'ssh') {
      const { module, target } = value;
      if (!['jar', 'nginx'].includes(module) || !host.modules[module] || !identity.test(target?.id)) throw new Error('请先启用目标主机的对应栏目。');
      const fsPath = host.platform === 'win32' ? path.win32 : path.posix;
      const key = filename => host.platform === 'win32' ? fsPath.normalize(filename).toLowerCase() : fsPath.normalize(filename);
      const state = await remote(host, module, 'get', {}, fullAccess, desktopSession);
      if (state.instances.some(item => item.id === target.id || key(module === 'jar' ? item.jar : item.main) === key(target.path))) return true;
      if (module === 'jar') {
        const password = await store.password(host);
        const status = await requestSsh({ host, module, action: 'status', target }, (_args, command, input) => runSshCommand(host, password, command, input));
        if (status !== 'stopped') throw new Error(`${target.name} 仍由旧版 SSH 管理（${status}）。请停止后再导入。`);
      }
      const { id, name, executable } = target;
      const instance = module === 'jar'
        ? { id, name, executable, jar: target.path, appArgs: target.args, logMode: 'file' }
        : { name, executable, main: target.path, files: target.files, prefix: target.prefix || fsPath.dirname(target.path), platform: host.platform };
      await remote(host, module, 'upsert', { revision: state.revision, instance }, fullAccess, desktopSession);
      return true;
    }
    if (action === 'reset-trust' && host.mode === 'ssh') { const result = await store.trust(host, '', true); invalidate(); return result; }
    if (action === 'test') {
      if (host.mode === 'share') {
        const transport = await connection(host, desktopSession);
        const module = host.modules.jar ? 'jar' : host.modules.nginx ? 'nginx' : null;
        if (module) await transport.request(module, 'get', {});
        else await transport.capabilities('jar');
        return { message: 'DevKit 共享已连接。' };
      }
      try {
        if (!host.fingerprint || value.fingerprint) {
          let offered;
          try { await connectSsh(host, '', { verifyOnly: true }); } catch (error) { if (!error.fingerprint) throw error; offered = error.fingerprint; }
          if (!value.fingerprint) return { fingerprint: offered };
          if (value.fingerprint !== offered) throw new Error('SSH 主机指纹在验证期间发生变化。');
          await store.trust(host, offered); invalidate();
        }
        const client = await connectSsh(find(host.id), await store.password(host));
        client.end();
        return { message: 'SSH 登录成功。' };
      } catch (error) { if (error.fingerprint) throw new Error(`${error.message} 当前指纹：${error.fingerprint}`); throw error; }
    }
    if (action === 'terminal-open' && host.mode === 'ssh') {
      if (!host.fingerprint) throw new Error('请先测试连接并确认 SSH 主机指纹。');
      if (terminals.size >= 16) throw new Error('最多同时打开 16 个终端。');
      const generation = terminalGeneration;
      const { client, stream } = await openSshShell(host, await store.password(host), dimensions(value));
      if (terminalGeneration !== generation || find(host.id)?.fingerprint !== host.fingerprint) { client.destroy(); throw new Error('终端已关闭或连接档案已更新。'); }
      const id = randomUUID(), terminal = { host, client, stream, output: [], bytes: 0, closed: false };
      terminals.set(id, terminal);
      stream.on('data', data => { terminal.output.push(data); terminal.bytes += data.length; if (terminal.bytes >= 256000) stream.pause(); });
      const closed = () => { terminal.closed = true; client.end(); };
      stream.on('error', closed); stream.once('close', closed); client.once('close', closed);
      return { id };
    }
    throw new Error('未知局域网主机操作。');
  }
  return {
    request, hostRequest, release,
    closeTerminals() { terminalGeneration++; for (const id of terminals.keys()) closeTerminal(id); },
    close() { for (const id of terminals.keys()) closeTerminal(id); for (const entry of connections.values()) entry.transport?.close(); connections.clear(); cache.clear(); },
  };
}
