import { mkdir, readFile, writeFile, rename, unlink, open, stat, realpath, lstat } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireProjectLock } from './project-lock.mjs';
import { detectJava, inspectJava, launchJar, signalJava, pathKey } from './jar-process.mjs';
import { normalizePolicies, effectiveEnvironment, probeHealth } from './jar-policies.mjs';
import { supervisorPath, supervisorRequest, launchSupervisor } from './jar-supervisor-client.mjs';
import { createJarAutostart } from './jar-autostart.mjs';
import { jarConfigs } from './jar-configs.mjs';

import { isJar, serviceEntry, serviceDirectory, projectScripts, validScript, launchSpec, matchesService, launchIdentity, jobRunner } from './backend-launch.mjs';

const message = error => error.message || String(error);
function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 12000 || /[\0\r\n]/.test(value)) throw new Error(`${label}需要本机绝对路径。`);
  return path.resolve(value);
}
function fileName(value, fallback, extension) {
  const name = value || fallback;
  if (typeof name !== 'string' || name.length > 200 || /[\\/:*?"<>|\x00-\x1f]/.test(name) || !name.toLowerCase().endsWith(extension) || /[. ]$/.test(name)) throw new Error(`请输入同目录下的 ${extension} 文件名。`);
  return name;
}
function argumentsList(value, jvm = false) {
  if (!Array.isArray(value) || value.length > 200 || value.some(arg => typeof arg !== 'string' || arg.length > 8000 || /[\0\r\n]/.test(arg))) throw new Error('启动参数需要字符串列表，每项一个参数。');
  if (jvm && value.some(arg => !arg.startsWith('-') || /^(?:-jar|-cp|-classpath|--class-path|--module|-m|--source|--$|--?version|--?help|-[h?]$)/.test(arg))) throw new Error('JVM 参数仅填写 -Xmx、-D 等选项，不含 -jar、类路径、主类或退出选项。');
  return value;
}
function normalize(item) {
  if (!item || typeof item !== 'object' || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) throw new Error('请填写 1–120 字的显示名称。');
  const id = item.id || randomUUID();
  const kind = item.kind ?? 'jar';
  let source, stem;
  if (kind === 'jar') {
    const jar = absolute(item.jar, 'JAR 路径');
    if (path.extname(jar).toLowerCase() !== '.jar') throw new Error('请选择 .jar 文件。');
    source = { jar }; stem = path.basename(jar, path.extname(jar));
  } else if (kind === 'npm') {
    if (!validScript(item.script)) throw new Error('请选择有效的 npm 脚本。');
    source = { kind, workDir: absolute(item.workDir, '项目目录'), script: item.script };
  } else if (kind === 'program') {
    const program = absolute(item.program, '程序路径');
    if (process.platform === 'win32' && path.extname(program).toLowerCase() !== '.exe') throw new Error('请选择 Windows .exe 程序。');
    source = { kind, program, workDir: absolute(item.workDir || path.dirname(program), '工作目录') };
  } else throw new Error('未知服务类型。');
  stem ??= 'devkit-' + id;
  const pidName = fileName(item.pidName, `${stem}.pid`, '.pid'), logName = fileName(item.logName, `${stem}.log`, '.log');
  if (!['file', 'silent', 'console'].includes(item.logMode)) throw new Error('请选择文件日志、控制台或静默模式。');
  const stopTimeout = Number(item.stopTimeout ?? 15);
  if (!Number.isInteger(stopTimeout) || stopTimeout < 1 || stopTimeout > 120) throw new Error('停止等待时间为 1–120 秒。');
  return { id, name: item.name.trim(), ...source, executable: kind === 'jar' && item.executable ? absolute(item.executable, 'Java 路径') : '', jvmArgs: kind === 'jar' ? argumentsList(item.jvmArgs || [], true) : [], appArgs: argumentsList(item.appArgs || []), logMode: item.logMode, pidName, logName, stopTimeout, ...normalizePolicies(item) };
}
export { normalize as normalizeJar };
export function jarPaths(item) {
  const directory = serviceDirectory(item);
  return { directory, pidPath: path.join(directory, item.pidName), logPath: path.join(directory, item.logName), identityPath: path.join(directory, `${item.pidName}.devkit.json`), supervisorPath: supervisorPath(item) };
}
function validatePaths(instances) {
  const entries = new Set(instances.map(item => pathKey(serviceEntry(item))));
  const jars = new Set(), files = new Set();
  for (const item of instances) {
    if (isJar(item)) {
      if (jars.has(pathKey(item.jar))) throw new Error('JAR 已登记。');
      jars.add(pathKey(item.jar));
    }
    const { pidPath, logPath, identityPath, supervisorPath } = jarPaths(item);
    for (const filename of [pidPath, logPath, identityPath, supervisorPath]) {
      const key = pathKey(filename);
      if (entries.has(key) || files.has(key)) throw new Error('服务入口或运行文件路径冲突。');
      files.add(key);
    }
  }
}
async function regular(filename) {
  try { if (!(await lstat(filename)).isFile()) throw new Error(`运行文件不是普通文件，拒绝操作：${filename}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function atomic(filename, data) {
  const temp = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, filename); break; }
      catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error; await delay(40 * (attempt + 1)); }
    }
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function optional(filename, json = false) {
  await regular(filename);
  try {
    if ((await stat(filename)).size > 65536) throw new Error('运行记录文件过大。');
    const text = await readFile(filename, 'utf8'); return json ? JSON.parse(text) : text.trim();
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function createJarManager(directory, dependencies = {}) {
  const runtime = { detect: detectJava, inspect: inspectJava, launch: launchJar, signal: signalJava, delay, supervised: true, captureLogs: false, ...dependencies };
  const folder = path.join(directory, 'jar'); await mkdir(folder, { recursive: true });
  const unlock = await acquireProjectLock(folder), filename = path.join(folder, 'instances.json');
  const autostart = dependencies.autostart || createJarAutostart(filename);
  let state;
  try {
    try {
      state = JSON.parse(await readFile(filename, 'utf8'));
      if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.instances) || state.instances.length > 100) throw new Error('服务注册表格式无效。');
      const ids = new Set();
      for (const item of state.instances) {
        if (!/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id)) throw new Error('服务标识无效或重复。');
        Object.assign(item, normalize(item)); ids.add(item.id);
      }
      validatePaths(state.instances);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { schemaVersion: 1, revision: 0, instances: [] }; await atomic(filename, state);
    }
  } catch (error) { await unlock(); throw error; }
  let queue = Promise.resolve(), closed = false;
  const children = new Map(), samples = new Map();
  const snapshot = () => ({ ...structuredClone(state), backendTypes: true, platform: process.platform, directory: folder });
  function find(id) { const item = state.instances.find(item => item.id === id); if (!item) throw new Error('服务记录不存在，请刷新列表。'); return item; }
  async function commit(instances, options) {
    const next = { ...state, revision: state.revision + 1, instances };
    await atomic(filename, next); state = next; return request('get', {}, options);
  }
  async function status(item) {
    const paths = jarPaths(item), base = { id: item.id, ...paths, checkedAt: new Date().toISOString() };
    try {
      if (runtime.supervised) {
        const supervisor = await supervisorRequest(item);
        if (supervisor) { base.supervision = supervisor.supervision; base.health = supervisor.health; }
        else base.health = { state: item.health.type === 'none' ? 'disabled' : 'unknown', detail: '启动或重启后启用独立健康监视' };
      }
      let fileInfo;
      try { fileInfo = await stat(serviceEntry(item)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      base.size = fileInfo?.size; base.fileMissing = !fileInfo?.isFile();
      const raw = await optional(paths.pidPath), identity = await optional(paths.identityPath, true);
      if (raw === null) {
        if (identity?.pid && !identity.stopped) {
          const info = await runtime.inspect(identity.pid);
          if (info) return { ...base, state: 'unknown', pid: identity.pid, detail: 'PID 文件丢失，但记录的进程仍存在；请核对文件后再操作。' };
        }
        return { ...base, state: identity && !identity.stopped ? 'exited' : 'stopped', detail: identity && !identity.stopped ? '进程已退出；请查看日志排查。' : '未运行' };
      }
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 1) return { ...base, state: 'unknown', detail: 'PID 文件无效，拒绝运行操作。' };
      const pid = Number(raw), info = await runtime.inspect(pid);
      if (!info) {
        if (identity?.business) {
          const live = await runtime.inspect(identity.business.pid);
          if (live && (live.unknown || live.created === identity.business.created))
            return { ...base, state: 'unknown', detail: '启动进程已退出，业务进程仍存在。请核实后再启动。' };
        }
        const exit = children.get(item.id)?.exit();
        return { ...base, state: identity?.stopped ? 'stopped' : 'exited', pid, exitCode: exit?.code, detail: `PID 对应的进程已退出${exit ? `（退出码 ${exit.code ?? exit.signal}）` : ''}；PID 文件已失效。` };
      }
      if (!matchesService(item, info, identity)) return { ...base, state: 'unknown', pid, detail: '进程身份不匹配或无法核实（旧脚本 PID、权限不足或 PID 复用），拒绝启动和终止。' };
      const business = identity.business && await runtime.inspect(identity.business.pid);
      const sample = identity.business ? (business?.created === identity.business.created ? business : {}) : info;
      const previous = samples.get(item.id), now = Date.now();
      let cpu;
      if (previous && previous.created === sample.created && now > previous.at && Number.isFinite(sample.cpuSeconds)) cpu = Math.max(0, (sample.cpuSeconds - previous.seconds) / ((now - previous.at) / 1000) * 100);
      samples.set(item.id, { at: now, created: sample.created, seconds: sample.cpuSeconds });
      return { ...base, state: 'running', pid, uptime: info.uptime, memory: sample.memory, cpu, businessPid: sample.pid, executable: sample.executable, startedAt: identity.startedAt, detail: '服务进程身份已确认；业务是否就绪请检查应用日志。' };
    } catch (error) { return { ...base, state: 'unknown', detail: message(error) }; }
  }
  async function log(item) {
    const { logPath } = jarPaths(item); await regular(logPath);
    let handle;
    try {
      handle = await open(logPath, 'r'); const info = await handle.stat();
      const length = Math.min(info.size, 128 * 1024), start = info.size - length, bytes = Buffer.alloc(length);
      const { bytesRead } = await handle.read(bytes, 0, length, start);
      let text = bytes.subarray(0, bytesRead).toString('utf8');
      if (start > 0) { const line = text.indexOf('\n'); if (line >= 0) text = text.slice(line + 1); }
      return { path: logPath, text, size: info.size, truncated: start > 0 };
    } catch (error) {
      if (error.code === 'ENOENT') return { path: logPath, text: '', size: 0, truncated: false };
      throw error;
    } finally { await handle?.close(); }
  }
  async function start(item) {
    const current = await status(item);
    if (!['stopped', 'exited'].includes(current.state)) throw new Error(current.state === 'running' ? '此服务已在运行。' : current.detail);
    if (runtime.supervised) {
      if (!isJar(item)) await launchSpec(item, runtime.detect);
      const result = await launchSupervisor(filename, item, runtime.launchDetached);
      return { output: result.output, status: await status(item) };
    }
    const target = await launchSpec(item, runtime.detect);
    const job = !isJar(item);
    const spec = job ? { executable: await realpath(process.execPath), args: [jobRunner, item.id, target.executable, ...target.args] } : target;
    const identityFields = launchIdentity(item, spec);
    const paths = jarPaths(item);
    for (const target of [paths.pidPath, paths.identityPath, ...(item.logMode === 'file' ? [paths.logPath] : [])]) await regular(target);
    // Only a PID proven absent may be cleared. Reserve with wx across managers.
    if (await optional(paths.pidPath) !== null) await unlink(paths.pidPath);
    const reservation = await open(paths.pidPath, 'wx', 0o600);
    let output, child, identity;
    try {
      if (item.logMode === 'file' && !runtime.captureLogs) output = await open(paths.logPath, 'a', 0o600);
      child = await runtime.launch(spec.executable, spec.args, paths.directory, output?.fd, effectiveEnvironment(item), job);
      children.set(item.id, child);
      await reservation.writeFile(String(child.pid));
      await reservation.sync();
      const startedAt = new Date().toISOString();
      // Replace any previous successful-stop record even when the new JVM exits immediately.
      await atomic(paths.identityPath, { pid: child.pid, ...identityFields, executable: spec.executable, created: null, startedAt, stopped: false });
      for (let attempt = 0; attempt < 12; attempt++) {
        const info = await runtime.inspect(child.pid);
        if (info && !info.unknown) {
          identity = { pid: child.pid, ...identityFields, executable: spec.executable, created: info.created, startedAt, stopped: false };
          if (!matchesService(item, info, identity)) throw new Error('启动的进程身份不符。');
          break;
        }
        if (child.exit()) break;
        await runtime.delay(150);
      }
      if (!identity) throw new Error('启动后进程已退出或无法核实身份，请检查服务入口、启动参数和日志。');
      if (child.businessPid) {
        const business = await runtime.inspect(child.businessPid);
        if (business?.created) identity.business = { pid: child.businessPid, created: business.created };
      }
      await atomic(paths.identityPath, identity);
      await runtime.delay(700);
      const result = await status(item);
      if (result.state !== 'running') throw new Error(`启动未能保持运行：${result.detail}`);
      return { status: result, output: `已启动 PID ${child.pid}。进程存活不代表业务就绪。` };
    } catch (error) {
      // Never kill an unidentified PID. Retain evidence for manual recovery.
      if (child) {
        const info = await runtime.inspect(child.pid);
        if (identity && matchesService(item, info, identity)) {
          await runtime.signal(child.pid, true, identity.created, !isJar(item)).catch(() => {});
        }
      } else await unlink(paths.pidPath).catch(() => {});
      throw error;
    } finally { await output?.close(); await reservation.close(); }
  }
  async function stop(item, force) {
    if (runtime.supervised) {
      const supervised = await supervisorRequest(item, force ? 'force-stop' : 'stop', 150000);
      if (supervised) return { status: await status(item), output: supervised.output };
    }
    const current = await status(item);
    if (['stopped', 'exited'].includes(current.state)) return { status: current, output: '进程已停止。' };
    if (current.state !== 'running') throw new Error(current.detail);
    const paths = jarPaths(item), identity = await optional(paths.identityPath, true);
    const info = await runtime.inspect(current.pid);
    if (!matchesService(item, info, identity)) throw new Error('操作前进程身份已变化，已取消。');
    await runtime.signal(current.pid, force, identity.created, !isJar(item));
    const deadline = Date.now() + item.stopTimeout * 1000;
    for (let attempt = 0; attempt < item.stopTimeout * 4 && Date.now() < deadline; attempt++) {
      const live = await runtime.inspect(current.pid);
      if (!live || (!live.unknown && live.created !== identity.created)) {
        identity.stopped = true; identity.stoppedAt = new Date().toISOString(); await atomic(paths.identityPath, identity);
        if (await optional(paths.pidPath) === String(current.pid)) await unlink(paths.pidPath);
        samples.delete(item.id);
        return { status: await status(item), output: force ? '已强制终止进程。' : '进程已停止。' };
      }
      if (!matchesService(item, live, identity)) throw new Error('等待停止时进程身份无法核实，保留 PID 文件。');
      await runtime.delay(250);
    }
    throw new Error(`等待 ${item.stopTimeout} 秒仍未退出；可核对日志后选择“强制终止”。`);
  }
  const sessionKey = value => createHash('sha256').update(value || 'desktop').digest('hex');
  async function releaseConsoleSession(session) {
    if (!runtime.supervised) return;
    await Promise.all(state.instances.filter(item => item.logMode === 'console').map(item => supervisorRequest(item, 'console-revoke', 3000, { session: sessionKey(session) }).catch(() => {})));
  }
  async function request(action, value = {}, options = {}) {
    if (['command', 'detect', 'health-check', 'monitor-probe', 'startup-install', 'startup-remove', 'console-claim', 'console-input', 'console-eof', 'console-release'].includes(action) && options.allowControl === false) throw new Error('未授予服务运行管理权限。');
    if (['upsert', 'remove'].includes(action) && options.allowEdit === false) throw new Error('未授予服务编辑权限。');
    const selected = state.instances.find(item => item.id === (action === 'upsert' ? value.instance?.id : value.id));
    if (options.allowBackend === false && (action === 'npm-scripts' || action === 'upsert' && !isJar(value.instance || {}) ||
        selected && !isJar(selected) && !['log-tail', 'console-read', 'startup-get', 'monitor-probe'].includes(action))) {
      throw Object.assign(new Error('未授予 npm 与可执行程序管理权限。'), { status: 403 });
    }
    if (action === 'npm-scripts') {
      if (options.allowEdit === false) throw new Error('未授予编辑权限。');
      return projectScripts(absolute(value.directory, '项目目录'));
    }
    if (action === 'get') {
      const result = snapshot();
      result.backendTypes = options.allowBackend !== false;
      if (!result.backendTypes) result.instances = result.instances.filter(isJar);
      for (const item of result.instances) if (options.allowEdit === false) { item.env = {}; item.profiles = item.profiles.map(profile => ({ ...profile, env: {} })); item.jvmArgs = []; item.appArgs = []; }
      return result;
    }
    if (action.startsWith('console-')) {
      const item = find(value.id);
      if (item.logMode !== 'console') throw new Error('此应用未使用 console 模式。');
      if (!['console-read', 'console-claim', 'console-input', 'console-eof', 'console-release'].includes(action)) throw new Error('未知控制台操作。');
      if (typeof value.clientId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.clientId)) throw new Error('控制台客户端标识无效。');
      const owner = `${sessionKey(options.session)}:${value.clientId}`;
      const result = await supervisorRequest(item, action, 8000, { cursor: value.cursor, generation: value.generation, text: value.text, owner, label: `${options.session ? '共享客户端' : '本机客户端'} ${value.clientId.slice(0, 6)}`, renew: options.allowControl !== false });
      if (!result) return { available: false, lease: null, inputOpen: false };
      if (result.lease) { const { owner: holder, ...lease } = result.lease; result.lease = { ...lease, mine: holder === owner }; }
      return { available: true, ...result };
    }
    if (action === 'detect') return runtime.detect({ executable: value.executable ? absolute(value.executable, 'Java 路径') : '' });
    if (action === 'statuses') {
      const visible = options.allowBackend === false ? state.instances.filter(isJar) : state.instances;
      const result = []; for (const item of visible) result.push(await status(item)); return result;
    }
    if (action === 'log-tail') return log(find(value.id));
    if (['config-list', 'config-read', 'config-save', 'config-backup'].includes(action)) {
      if (options.allowEdit === false) throw new Error('未授予服务编辑权限。');
      return jarConfigs(folder, find(value.id), action, value);
    }
    if (action === 'upsert' || action === 'remove') {
      if (value.revision !== state.revision) throw new Error('列表已被修改，请刷新后重试。');
      if (action === 'remove') {
        const item = find(value.id), current = await status(item);
        if (!['stopped', 'exited'].includes(current.state) || current.supervision?.active) throw new Error('请先停止并确认进程状态后再移除。');
        const startup = await autostart.get(item);
        if (startup.enabled || startup.target || startup.error) throw new Error('请先关闭此服务的系统自启，再移除记录。');
        return commit(state.instances.filter(item => item.id !== value.id), options);
      }
      const item = normalize(value.instance), existing = state.instances.find(old => old.id === item.id);
      if (!/^[a-f0-9-]{36}$/.test(item.id)) throw new Error('服务标识无效。');
      if (existing && (existing.kind || 'jar') !== (item.kind || 'jar')) throw new Error('已登记服务不能更换启动方式。');
      const previous = existing ? await status(existing) : null;
      if (existing && (!['stopped', 'exited'].includes(previous.state) || previous.supervision?.active)) {
        const { name: a, ...before } = existing, { name: b, ...after } = item;
        if (!isDeepStrictEqual(before, after)) throw new Error('运行中或状态未确认时仅可修改显示名称，请先停止。');
      }
      if (!existing && state.instances.length >= 100) throw new Error('最多登记 100 个服务。');
      if (isJar(item)) item.jar = await realpath(item.jar);
      else {
        item.workDir = await realpath(item.workDir);
        if (!(await stat(item.workDir)).isDirectory()) throw new Error('工作目录无效。');
        if (item.kind === 'program') item.program = await realpath(item.program);
        if (item.kind === 'npm' && !(await projectScripts(item.workDir)).includes(item.script)) throw new Error('package.json 中找不到所选 npm 脚本。');
      }
      if (!(await stat(serviceEntry(item))).isFile()) throw new Error('服务入口不是普通文件。');
      validatePaths([...state.instances.filter(old => old.id !== item.id), item]);
      return commit(existing ? state.instances.map(old => old.id === item.id ? item : old) : [...state.instances, item], options);
    }
    if (action === 'command') {
      const item = find(value.id);
      if (value.command === 'start') return start(item);
      if (value.command === 'stop') return stop(item, false);
      if (value.command === 'force-stop') return stop(item, true);
      if (value.command === 'restart') { await stop(item, false); return start(item); }
      throw new Error('未知服务命令。');
    }
    if (action === 'health-check') {
      const item = find(value.id), current = await status(item);
      if (runtime.supervised) {
        const result = await supervisorRequest(item, 'health-check', (item.health.timeout + 10) * 1000);
        if (result) return result.health;
      }
      return current.state === 'running' ? probeHealth(item.health) : { state: 'stopped', detail: '服务进程未运行' };
    }
    if (action === 'monitor-probe') {
      const { health } = find(value.id);
      if (health.type === 'none') throw new Error('请先为关联服务配置 HTTP/TCP 健康检查。');
      const timeout = Number.isInteger(value.timeout) ? Math.max(1, Math.min(60, value.timeout)) : health.timeout;
      return probeHealth({ ...health, timeout });
    }
    if (action === 'startup-get') return autostart.get(find(value.id));
    if (action === 'startup-install') {
      const item = find(value.id);
      const spec = await launchSpec(item, runtime.detect);
      return autostart.install(isJar(item) ? { ...item, executable: spec.executable } : item, value.mode);
    }
    if (action === 'startup-remove') return autostart.remove(find(value.id));
    throw new Error('未知服务操作。');
  }
  return {
    request(action, value, options) {
      if (closed) return Promise.reject(new Error('后端管理器已关闭。'));
      if (action.startsWith('console-')) return request(action, value, options);
      const pending = queue.then(() => request(action, value, options)); queue = pending.catch(() => {}); return pending;
    },
    releaseConsoleSession,
    async close() { closed = true; await queue; await releaseConsoleSession(); await unlock(); },
  };
}
