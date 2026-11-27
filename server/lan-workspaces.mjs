import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createLanHostStore, jumpRoute, publicHost } from './lan-host-store.mjs';
import { authorizeWorkspace, fullAccess, managedRequest } from './managed-workspace.mjs';
import { connectSsh, openSshShell, runSshCommand, sshCall } from './lan-ssh.mjs';
import { requestSsh } from './ssh-management.mjs';
import { shareTransport, sshTransport } from './lan-transports.mjs';
import { diagnoseHost } from './lan-diagnostics.mjs';
import { openFtp, useFtp } from './lan-ftp.mjs';
import { openTelnet, openSerial, serialDevices } from './lan-console.mjs';
import { localChild, localFiles } from './sftp-local.mjs';
import { useSftp } from './lan-sftp.mjs';
import { discoverHosts, lanInterfaces } from './lan-discovery.mjs';
import { hostTarget, withDeadline } from './lan-probe.mjs';
import { createVncSockets } from './lan-vnc.mjs';
import { wakeHost } from './lan-power.mjs';

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
  const relayClients = new Map();
  const desktopSession = randomUUID();
  let terminalGeneration = 0, openingTerminals = 0, scan, closed = false;
  const find = id => store.list().find(item => item.id === id);
  const vnc = createVncSockets(find);
  function sameSshHost(host) {
    const current = find(host.id);
    return current?.mode === host.mode && ['ssh', 'sftp'].includes(host.mode) && ['address', 'port', 'user', 'platform', 'fingerprint', 'auth', 'keyPath', 'secret', 'encryptedKey', 'explicitKeyOnly', 'jumpHostId'].every(key => current[key] === host[key]);
  }
  const routeCurrent = route => route.every(sameSshHost);
  function rdpTarget(id) {
    const host = find(id);
    if (host?.mode === 'vnc' || host?.mode === 'rdp') return { address: host.address, port: host.port, protocol: host.mode };
    const port = host?.rdpPort || (host?.mode === 'ssh' && host.platform === 'win32' ? 3389 : null);
    if (!port) throw Object.assign(new Error('请选择已配置远程桌面的主机。'), { status: 404 });
    const { address } = hostTarget(host);
    return { address, port };
  }
  async function connectSaved(host, options) {
    if (options.verifyOnly) return connectSsh(host, '', options);
    const [password, privateKey] = await Promise.all([store.password(host), store.privateKey(host)]);
    return connectSsh(host, password, { ...options, privateKey });
  }
  async function openHost(host, { verifyOnly = false, password } = {}, route = jumpRoute(host, find)) {
    const clients = [];
    let socket, target = host;
    function cleanup() { for (const client of clients.reverse()) client.destroy(); }
    try {
      for (const [index, jump] of route.entries()) {
        target = jump;
        if (!jump.fingerprint) throw new Error('请先测试该跳板机并确认它的指纹。');
        const client = await connectSaved(jump, { socket });
        clients.push(client);
        const next = route[index + 1] || host;
        socket = await withDeadline(sshCall(client, 'forwardOut', '127.0.0.1', 0, next.address, next.port), 12000, '跳板机连接下一级地址超时。');
        socket.on('error', () => {});
      }
      target = host;
      const client = password === undefined ? await connectSaved(host, { verifyOnly, socket }) : await connectSsh(host, password, { socket });
      client.once('close', cleanup);
      return client;
    } catch (error) {
      cleanup();
      if (target !== host) throw Object.assign(new Error(`跳板机 ${target.name} · ${error.message}`), { jump: true, fingerprint: error.fingerprint });
      throw error;
    }
  }
  function connection(host, session) {
    const key = host.mode === 'share' ? `${host.id}:${session}` : host.id;
    let entry = connections.get(key);
    if (entry && (entry.host !== host || !routeCurrent(entry.route) || entry.transport?.closed?.())) { entry.transport?.close(); connections.delete(key); entry = null; }
    if (!entry) {
      entry = { host, session, route: jumpRoute(host, find), phase: 'connecting' };
      entry.open = store.password(host).then(password => transports[host.mode](host, password, () => openHost(host, {}, entry.route), phase => { entry.phase = phase; })).then(transport => {
        entry.transport = transport;
        entry.phase = 'reading';
        if (connections.get(key) !== entry) { transport.close(); throw new Error('连接档案已更新。'); }
        return transport;
      }).catch(error => { if (connections.get(key) === entry) connections.delete(key); throw error; });
      connections.set(key, entry);
    }
    return entry.open;
  }
  function release(session) {
    if (scan?.owner === session) scan.controller.abort();
    for (const [id, entry] of terminals) if (entry.owner === session) closeTerminal(id);
    for (const [key, entry] of cache) if (entry.session === session) cache.delete(key);
    for (const [key, entry] of connections) {
      if (entry.host.mode === 'share' && entry.session === session) {
        connections.delete(key); entry.transport?.close();
      } else if (entry.transport?.release) void entry.transport.release(session).catch(() => {});
    }
  }
  function invalidate() {
    vnc.invalidate();
    for (const [client, route] of relayClients) if (!routeCurrent(route)) client.destroy();
    for (const [key, entry] of connections) if (find(entry.host.id) !== entry.host || !routeCurrent(entry.route)) { connections.delete(key); entry.transport?.close(); }
    for (const [key, entry] of cache) if (find(entry.host.id) !== entry.host) cache.delete(key);
    for (const [id, terminal] of terminals) if (!terminalCurrent(terminal.host, terminal.route)) closeTerminal(id);
  }
  async function remote(host, module, action, payload, access, session) {
    const transport = await connection(host, session);
    return transport.request(module, action, payload, access, session);
  }
  async function request(manager, module, action, payload = {}, access = fullAccess, session = desktopSession) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('请求参数无效。');
    const { scope, scopeAccess, hostId: explicit, ...value } = payload;
    if (scope === 'local' && scopeAccess) access = { backend: access.backend === true && scopeAccess.backend === true, edit: access.edit && scopeAccess.edit === true, control: access.control && scopeAccess.control === true };
    authorizeWorkspace(module, action, access);
    const local = (name, data) => managedRequest(manager, module, name, data, access, session === desktopSession ? undefined : session);
    if (['inventory', 'inventory-local', 'inventory-host', 'inventory-progress'].includes(scope) && ['get', 'statuses'].includes(action)) {
      const hosts = store.list().filter(host => host.modules[module]);
      const cacheKey = host => `${host.id}:${module}:${session}:${access.edit}:${access.control}:${!!access.backend}`;
      const phaseFor = host => connections.get(host.mode === 'share' ? `${host.id}:${session}` : host.id)?.phase || 'connecting';
      const pendingGroup = host => ({ id: host.id, name: host.name, platform: host.platform || '', revision: 0, edit: false, control: false, phase: phaseFor(host), checkedAt: cache.get(cacheKey(host))?.group.checkedAt });
      const localGroup = base => ({ id: '', name: session === desktopSession ? '本机' : '共享主机', platform: base.platform, revision: base.revision, backendTypes: base.backendTypes, backendChecks: base.backendChecks, supportsScripts: base.supportsScripts, supportsNodePath: base.supportsNodePath, runtimeDiscovery: base.runtimeDiscovery, fileReplacement: base.fileReplacement, backupRestore: base.backupRestore, edit: access.edit, control: access.control });
      if (scope === 'inventory-progress') return hosts.map(pendingGroup);
      if (scope === 'inventory-local') {
        const base = await local(action, value);
        if (action === 'statuses') return base;
        return { ...base, groups: [localGroup(base), ...hosts.map(pendingGroup)] };
      }
      async function readHost(host) {
        const key = cacheKey(host);
        try {
          const transport = await connection(host, session);
          const result = await transport.request(module, action, value, access, session);
          if (action === 'statuses') return { statuses: result.map(item => tag(item, host.id)) };
          const limits = await transport.capabilities?.(module) || fullAccess;
          const permissions = { edit: access.edit && limits.edit, control: access.control && limits.control };
          const state = stateFor(module, result, host.id, permissions);
          const group = { id: host.id, name: host.name, platform: state.platform, revision: state.revision, backendTypes: state.backendTypes === true && access.backend === true, backendChecks: state.backendChecks === true && access.backend === true, supportsScripts: state.supportsScripts === true && access.backend === true, supportsNodePath: state.supportsNodePath === true && access.backend === true, runtimeDiscovery: state.runtimeDiscovery === true, fileReplacement: state.fileReplacement === true, backupRestore: state.backupRestore === true, ...permissions, phase: 'ready', checkedAt: new Date().toISOString() };
          cache.set(key, { host, session, state: stateFor(module, result, host.id, { edit: false }), group });
          return { state, group };
        } catch (error) {
          const previous = cache.get(key);
          const message = host.mode === 'ssh' && !host.fingerprint ? '请在桌面端确认 SSH 主机指纹。' : error.message;
          if (action === 'statuses') {
            if (scope === 'inventory-host') throw new Error(message, { cause: error });
            return { statuses: (previous?.state.instances || []).map(item => ({ id: item.id, state: 'unknown', detail: message, checkedAt: new Date().toISOString(), pidPath: '', logPath: '' })) };
          }
          return { state: previous?.state, group: { ...pendingGroup(host), ...previous?.group, edit: false, control: false, phase: 'failed', error: message } };
        }
      }
      if (scope === 'inventory-host') {
        const host = hosts.find(item => item.id === explicit);
        if (!host) throw new Error('目标主机已移除或未开放此栏目。');
        const result = await readHost(host);
        return action === 'statuses' ? result.statuses : { ...result.state, instances: result.state?.instances || [], groups: [result.group] };
      }
      const [base, others] = await Promise.all([local(action, value), Promise.all(hosts.map(readHost))]);
      if (action === 'statuses') return [...base, ...others.flatMap(item => item.statuses)];
      const groups = [localGroup(base), ...others.map(item => item.group)];
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
    if (entry) { terminals.delete(id); clearTimeout(entry.idle); entry.transfer?.controller.abort(); entry.dispose(); }
  }
  function ownedTerminal(id, owner) {
    const entry = terminals.get(id);
    if (!entry || entry.owner !== owner) throw Object.assign(new Error('会话已断开或不可用，请重新连接。'), { status: 404 });
    bumpIdle(id, entry);
    return entry;
  }
  function bumpIdle(id, entry) {
    if (entry.owner === desktopSession) return;
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => closeTerminal(id), 45_000);
    entry.idle.unref();
  }
  function terminalCurrent(host, route) {
    if (!['ssh','sftp'].includes(host.mode)) {
      const current = find(host.id);
      return current && ['mode','address','port','secret','user','ftpSecurity','startDirectory','terminalType','lineEnding','baudRate','dataBits','stopBits','parity','flowControl'].every(key => host[key] === current[key]);
    }
    return sameSshHost(host) && routeCurrent(route);
  }
  const dimensions = value => ({ cols: Math.max(2, Math.min(500, Math.trunc(Number(value?.cols)) || 80)), rows: Math.max(2, Math.min(300, Math.trunc(Number(value?.rows)) || 24)) });
  async function hostRequest(action, value, localFile, web) {
    const owner = web?.token || desktopSession;
    web?.ensureCurrent();
    if (action.startsWith('vnc-') && !web) return vnc.request(action, value);
    if (action === 'serial-list' && !web) return serialDevices();
    if (action === 'list') return store.list().map(publicHost);
    if (action === 'routing-fingerprint' || action === 'routing-enroll') {
      if (web) throw Object.assign(new Error('请在 DevKit 桌面端补录管理档案。'), { status:403 });
      const host = store.routingDraft(value), route = jumpRoute(host, find);
      const checkIdentity = fingerprint => {
        if (closed || !routeCurrent(route) || value.id && find(value.id) !== host) throw new Error('管理连接已变化，请重新核对指纹。');
        const conflict = store.list().some(item => item.mode === 'ssh' && item.address === host.address && item.port === host.port &&
          item.jumpHostId === host.jumpHostId && item.fingerprint && item.fingerprint !== fingerprint);
        if (conflict) throw new Error('SSH 主机指纹与同一端点的已信任记录不一致。');
      };
      if (action === 'routing-fingerprint') {
        try { (await openHost(host, { verifyOnly:true }, route)).end(); }
        catch (error) {
          if (!error.fingerprint || error.jump) throw error;
          checkIdentity(error.fingerprint);
          return { fingerprint:error.fingerprint };
        }
        throw new Error('未收到 SSH 主机指纹。');
      }
      const password = value.password || (value.id && await store.password(host));
      if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(value.fingerprint) || typeof password !== 'string' || !password || password.length > 4096)
        throw new Error('请确认 SSH 指纹并填写密码。');
      checkIdentity(value.fingerprint);
      const client = await openHost({ ...host, fingerprint:value.fingerprint }, { password }, route);
      client.end();
      const result = await store.enrollRouting(host, password, value.fingerprint, () => checkIdentity(value.fingerprint));
      invalidate();
      return result;
    }
    if (action === 'scan-interfaces') return lanInterfaces();
    if (action === 'scan-cancel') { if (scan?.owner === owner && scan.id === value?.id) scan.controller.abort(); return true; }
    if (action === 'scan-start') {
      if (scan) throw new Error('已有扫描正在运行。');
      const source = lanInterfaces().find(item => item.address === value?.address && item.name === value?.name);
      if (!source || !identity.test(value?.id || '')) throw new Error('所选网卡已不可用。');
      scan = { id: value.id, owner, controller: new AbortController() };
      try { return await discoverHosts(source, value.range, value.port, scan.controller.signal); }
      finally { scan = undefined; }
    }
    if (action === 'import-preview') return store.previewImport(value, !!web);
    if (action === 'import-connections') { const result = await store.importConnections(value, web); invalidate(); return result; }
    if (['save', 'import', 'remove'].includes(action)) { const result = await store[action](value, web); invalidate(); return result; }
    if (action === 'file-status') { const entry = ownedTerminal(value?.id, owner); return { closed: entry.closed || (entry.host.mode === 'ftp' && entry.client.closed), transfer: entry.transfer && { id: entry.transfer.id, bytes: entry.transfer.bytes } }; }
    if (action === 'terminal-close') {
      if (terminals.get(value?.id)?.owner === owner) closeTerminal(value.id);
      return true;
    }
    if (!web && action.startsWith('local-')) {
      const entry = ownedTerminal(value?.id, owner);
      if (!['ssh', 'sftp'].includes(entry.host.mode) || entry.closed) throw new Error('SFTP 会话已断开。');
      return localFiles(action, value);
    }
    const nativeCopy = !web && ['sftp-upload', 'sftp-download'].includes(action);
    if (nativeCopy || ['file-list', 'file-upload', 'file-download', 'file-mkdir', 'file-remove', 'file-rename', 'file-cancel'].includes(action)) {
      const terminal = ownedTerminal(value?.id, owner);
      if (terminal.closed) throw new Error('会话已断开，请重新连接。');
      if (action === 'file-cancel') {
        if (terminal.transfer?.id && terminal.transfer.id === value.transferId) terminal.transfer.controller.abort();
        return true;
      }
      if (terminal.host.mode === 'ftp') {
        if (!['file-list', 'file-upload', 'file-download'].includes(action)) throw new Error('请选择 SFTP 会话。');
        if (terminal.fileBusy) throw new Error('FTP 会话正在处理文件操作。');
        terminal.fileBusy = true;
        try { return await useFtp(terminal, action, value, localFile); }
        finally { terminal.fileBusy = false; }
      }
      if (!['sftp', 'ssh'].includes(terminal.host.mode)) throw new Error('此终端不提供文件服务。');
      if (nativeCopy) {
        localFile = localChild(value.localDirectory, value.localName);
        action = action === 'sftp-upload' ? 'file-upload' : 'file-download';
      }
      if (['file-list', 'file-rename', 'file-remove', 'file-mkdir'].includes(action)) return useSftp(terminal.client, action, value, terminal.host, localFile);
      if (terminal.fileBusy) throw new Error('当前会话正在传输文件。');
      terminal.fileBusy = true;
      const transfer = nativeCopy || value.transferId ? { id: value.transferId || randomUUID(), bytes: 0, controller: new AbortController() } : undefined;
      terminal.transfer = transfer;
      try { return await useSftp(terminal.client, action, value, terminal.host, localFile, transfer); }
      finally { terminal.fileBusy = false; terminal.transfer = undefined; }
    }
    if (['terminal-read', 'terminal-input', 'terminal-resize'].includes(action)) {
      const terminal = ownedTerminal(value?.id, owner);
      if (!terminal.stream) throw new Error('此会话仅支持文件操作。');
      if (action === 'terminal-read') {
        const data = Buffer.concat(terminal.output).toString('base64');
        terminal.output = []; terminal.bytes = 0; if (!terminal.closed) terminal.stream.resume();
        return { data, closed: terminal.closed };
      }
      if (terminal.closed) return false;
      if (action === 'terminal-input' && typeof value.text === 'string' && Buffer.byteLength(value.text) <= 524288) { if (terminal.input) await terminal.input(value.text); else terminal.stream.write(value.text); }
      if (action === 'terminal-resize') { const size = dimensions(value); if (terminal.resize) terminal.resize(size); else terminal.stream.setWindow?.(size.rows, size.cols, 0, 0); }
      return true;
    }
    const host = find(value?.id);
    if (!host) throw new Error('找不到已保存的主机连接。');
    if (host.mode === 'serial' && (web || action !== 'terminal-open')) throw new Error('请选择桌面端串口会话。');
    if (action === 'wake') return wakeHost(host);
    if (action === 'rdp-target') {
      if (host.mode === 'vnc') throw new Error('请选择 RDP 连接。');
      const { address, port } = rdpTarget(host.id);
      return `${address.includes(':') ? `[${address}]` : address}:${port}`;
    }
    if (action === 'diagnose') return diagnoseHost(host, {
      openSsh: options => openHost(host, options),
      openShare: () => connection(host, owner),
    });
    if (action === 'legacy-import' && host.mode === 'ssh') {
      const { module, target } = value;
      if (!['jar', 'nginx'].includes(module) || !host.modules[module] || !identity.test(target?.id)) throw new Error('请先启用目标主机的对应栏目。');
      const platform = (await connection(host, desktopSession)).platform || host.platform;
      const fsPath = platform === 'win32' ? path.win32 : path.posix;
      const key = filename => platform === 'win32' ? fsPath.normalize(filename).toLowerCase() : fsPath.normalize(filename);
      const state = await remote(host, module, 'get', {}, fullAccess, desktopSession);
      if (state.instances.some(item => item.id === target.id)) return true;
      const filename = await remote(host, module, 'resolve-legacy-path', { path: target.path }, fullAccess, desktopSession);
      if (state.instances.some(item => (module !== 'jar' || item.jar) && key(module === 'jar' ? item.jar : item.main) === key(filename))) return true;
      if (module === 'jar') {
        const status = await requestSsh({ host: { ...host, platform }, module, action: 'status', target }, async (_args, command, input) => runSshCommand(await openHost(host), command, input));
        if (status !== 'stopped') throw new Error(`${target.name} 仍由旧版 SSH 管理（${status}）。请停止后再导入。`);
      }
      const { id, name, executable } = target;
      const instance = module === 'jar'
        ? { id, name, executable, jar: target.path, appArgs: target.args, logMode: 'file' }
        : { name, executable, main: target.path, files: target.files, prefix: target.prefix || fsPath.dirname(target.path), platform };
      await remote(host, module, 'upsert', { revision: state.revision, instance }, fullAccess, desktopSession);
      return true;
    }
    if (action === 'reset-trust' && ['ssh', 'sftp'].includes(host.mode)) { const result = await store.trust(host, '', true, web?.ensureCurrent); invalidate(); return result; }
    if (action === 'test' && ['ssh', 'sftp', 'share'].includes(host.mode)) {
      if (host.mode === 'share') {
        const transport = await connection(host, owner);
        const module = host.modules.jar ? 'jar' : host.modules.nginx ? 'nginx' : null;
        if (module) await transport.request(module, 'get', {});
        else await transport.capabilities('jar');
        return { message: 'DevKit 共享已连接。' };
      }
      try {
        if (!host.fingerprint || value.fingerprint) {
          let offered;
          try { await openHost(host, { verifyOnly: true }); } catch (error) { if (!error.fingerprint || error.jump) throw error; offered = error.fingerprint; }
          if (!value.fingerprint) return { fingerprint: offered };
          if (value.fingerprint !== offered) throw new Error('SSH 主机指纹在验证期间发生变化。');
          web?.ensureCurrent();
          await store.trust(host, offered, false, web?.ensureCurrent); invalidate();
        }
        const client = await openHost(find(host.id));
        client.end();
        return { message: 'SSH 登录成功。' };
      } catch (error) { if (error.fingerprint) throw new Error(`${error.message} 当前指纹：${error.fingerprint}`); throw error; }
    }
    if ((action === 'terminal-open' && ['ssh', 'telnet', 'serial'].includes(host.mode)) || (action === 'file-open' && ['sftp', 'ftp'].includes(host.mode))) {
      if (['ssh','sftp'].includes(host.mode) && !host.fingerprint) throw new Error('请先测试连接并确认 SSH 主机指纹。');
      if (terminals.size + openingTerminals >= 16) throw new Error('最多同时打开 16 个终端。');
      const generation = terminalGeneration;
      const route = jumpRoute(host, find);
      openingTerminals++;
      let opened;
      try {
        if (host.mode === 'telnet') opened = await openTelnet(host, dimensions(value));
        else if (host.mode === 'serial') opened = await openSerial(host);
        else if (host.mode === 'ftp') opened = await openFtp(host, await store.password(host));
        else {
          const client = await openHost(host, {}, route);
          opened = action === 'file-open' ? { client } : await openSshShell(client, dimensions(value));
        }
        opened.dispose ??= () => opened.client.destroy();
        web?.ensureCurrent();
        if (closed || owner === desktopSession && terminalGeneration !== generation || !terminalCurrent(host, route)) throw new Error('终端已关闭或连接档案已更新。');
      } catch (error) { opened?.dispose?.(); throw error; }
      finally { openingTerminals--; }
      const { client, stream } = opened;
      const id = randomUUID(), terminal = { owner, host, route, ...opened, output: [], bytes: 0, closed: false };
      terminals.set(id, terminal);
      bumpIdle(id, terminal);
      stream?.on('data', data => { terminal.output.push(data); terminal.bytes += data.length; if (terminal.bytes >= 256000) stream.pause(); });
      const onClosed = () => { if (!terminal.closed) { terminal.closed = true; terminal.dispose(); } };
      stream?.on('error', onClosed); stream?.once('close', onClosed); client.once?.('close', onClosed);
      return { id };
    }
    throw new Error('未知局域网主机操作。');
  }
  return {
    request, hostRequest, release, rdpTarget,
    async routingSession(id) {
      const host = find(id);
      if (host?.mode !== 'ssh' || !host.fingerprint) throw new Error('请选择已确认指纹的 SSH 管理档案。');
      const client = await openHost(host);
      return { client, platform: host.platform };
    },
    async openRelay(hostname, port, user) {
      const matches = store.list().filter(host => host.mode === 'ssh' && host.address.toLowerCase() === hostname.toLowerCase() && host.port === port && (!user || host.user === user));
      if (matches.length !== 1) throw new Error(matches.length ? '多个档案匹配，请填写 A 的 SSH 用户名。' : '请在局域网主机登记 A 的 SSH 地址、账号并确认指纹。');
      const host = matches[0], route = jumpRoute(host, find);
      if (!host.fingerprint) throw new Error('请在局域网主机核对并确认 A 的 SSH 指纹。');
      const client = await openHost(host, {}, route);
      const chain = [...route, host];
      if (closed || !routeCurrent(chain)) { client.destroy(); throw new Error('SSH 档案已更新。'); }
      relayClients.set(client, chain);
      client.once('close', () => relayClients.delete(client));
      return client;
    },
    sharedHosts: (logAccess, access) => store.list().filter(host => host.mode !== 'serial').map(host => {
      const { id, name, address, mode, port, group, tags, pinned, modules, platform, auth, user, jumpHostId, visitor, mac, rdpPort, fingerprint, explicitKeyOnly } = host;
      return {
        id, name, address, mode, port, group, tags, pinned,
        hasLogs: logAccess.enabled && (logAccess.jar && modules.jar || logAccess.nginx && modules.nginx),
        ...(access.edit ? { ftpSecurity: host.ftpSecurity, startDirectory: host.startDirectory, terminalType: host.terminalType, lineEnding: host.lineEnding, modules, platform, auth, user, jumpHostId, visitor, mac, rdpPort, explicitKeyOnly, revision: host.revision || '', hasStoredKey: !!(host.keyPath || host.encryptedKey), hasPassword: !!host.secret } : {}),
        ...(access.diagnose || access.terminal || access.edit ? { fingerprint } : {}),
        ...(access.wake ? { canWake: !!mac } : {}),
        ...(access.rdp ? { canRdp: mode === 'rdp' || mode === 'vnc' || !!rdpPort || mode === 'ssh' && platform === 'win32' } : {}),
      };
    }),
    async monitorJarSources(session = desktopSession, backend = true) {
      const hosts = store.list().filter(host => host.modules.jar);
      const results = await Promise.allSettled(hosts.map(async host => {
        const transport = await connection(host, session);
        if (transport.capabilities && !(await transport.capabilities('jar')).control) return [];
        const state = await transport.request('jar', 'get', {}, { edit: false, control: true, backend }, session);
        return state.instances.filter(item => ['http', 'tcp'].includes(item.health?.type)).map(item => ({
          label: `目标主机 · ${host.name} / ${item.name}`, source: { type: 'jar', id: qualified(host.id, item.id) },
        }));
      }));
      return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    },
    async monitorJar(id, timeout) {
      const [hostId, instanceId, extra] = id.split(':'), host = find(hostId);
      if (extra || !identity.test(instanceId || '') || !host?.modules.jar) throw new Error('关联的远程应用服务已移除或不可用。');
      return remote(host, 'jar', 'monitor-probe', { id: instanceId, timeout }, { edit: false, control: true }, desktopSession);
    },
    hostName: id => find(id)?.name,
    logTargets: () => store.list().filter(host => host.modules.jar || host.modules.nginx).map(({ id, name, modules }) => ({ id, name, modules })),
    async logs(hostId, action, payload, access, session = desktopSession) {
      const host = find(hostId);
      if (!host || !host.modules.jar && !host.modules.nginx) throw new Error('日志来源主机已移除或停用。');
      const permissions = { jar: host.modules.jar && access.jar !== false, nginx: host.modules.nginx && access.nginx !== false, export: access.export !== false, raw: access.raw === true };
      return remote(host, 'logs', action, { ...payload, logAccess: permissions }, permissions, session);
    },
    monitorTargets: () => store.list().filter(host => host.mode !== 'serial').map(host => ({ id: host.id, name: host.name, ...hostTarget(host) })),
    closeTerminals() { vnc.close(); terminalGeneration++; for (const [id, entry] of terminals) if (entry.owner === desktopSession) closeTerminal(id); },
    close() { vnc.close(); closed = true; for (const client of relayClients.keys()) client.destroy(); scan?.controller.abort(); for (const id of terminals.keys()) closeTerminal(id); for (const entry of connections.values()) entry.transport?.close(); connections.clear(); cache.clear(); },
  };
}
