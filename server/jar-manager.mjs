import { mkdir, readFile, writeFile, rename, unlink, open, stat, realpath, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireProjectLock } from './project-lock.mjs';
import { detectJava, inspectJava, launchJar, signalJava, matchesJar, pathKey } from './jar-process.mjs';
import { normalizePolicies, effectiveEnvironment, probeHealth } from './jar-policies.mjs';
import { supervisorPath, supervisorRequest, launchSupervisor } from './jar-supervisor-client.mjs';
import { createJarAutostart } from './jar-autostart.mjs';

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
  const jar = absolute(item.jar, 'JAR 路径');
  if (path.extname(jar).toLowerCase() !== '.jar') throw new Error('请选择 .jar 文件。');
  const stem = path.basename(jar, path.extname(jar));
  const pidName = fileName(item.pidName, `${stem}.pid`, '.pid'), logName = fileName(item.logName, `${stem}.log`, '.log');
  if (!['file', 'silent'].includes(item.logMode)) throw new Error('请选择文件日志或静默模式。');
  const stopTimeout = Number(item.stopTimeout ?? 15);
  if (!Number.isInteger(stopTimeout) || stopTimeout < 1 || stopTimeout > 120) throw new Error('停止等待时间为 1–120 秒。');
  return { id: item.id || randomUUID(), name: item.name.trim(), jar, executable: item.executable ? absolute(item.executable, 'Java 路径') : '', jvmArgs: argumentsList(item.jvmArgs || [], true), appArgs: argumentsList(item.appArgs || []), logMode: item.logMode, pidName, logName, stopTimeout, ...normalizePolicies(item) };
}
export { normalize as normalizeJar };
export function jarPaths(item) {
  const directory = path.dirname(item.jar);
  return { directory, pidPath: path.join(directory, item.pidName), logPath: path.join(directory, item.logName), identityPath: path.join(directory, `${item.pidName}.devkit.json`), supervisorPath: supervisorPath(item) };
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
      if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.instances) || state.instances.length > 100) throw new Error('JAR 注册表格式无效。');
      const ids = new Set(), paths = new Set();
      for (const item of state.instances) {
        if (!/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id)) throw new Error('JAR 标识无效或重复。');
        Object.assign(item, normalize(item)); ids.add(item.id);
        for (const target of [item.jar, ...Object.values(jarPaths(item)).slice(1)]) {
          if (paths.has(pathKey(target))) throw new Error('JAR 或运行文件路径重复。'); paths.add(pathKey(target));
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { schemaVersion: 1, revision: 0, instances: [] }; await atomic(filename, state);
    }
  } catch (error) { await unlock(); throw error; }
  let queue = Promise.resolve(), closed = false;
  const children = new Map(), samples = new Map();
  const snapshot = () => ({ ...structuredClone(state), platform: process.platform, directory: folder });
  function find(id) { const item = state.instances.find(item => item.id === id); if (!item) throw new Error('JAR 记录不存在，请刷新列表。'); return item; }
  async function commit(instances) {
    const next = { ...state, revision: state.revision + 1, instances };
    await atomic(filename, next); state = next; return snapshot();
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
      try { fileInfo = await stat(item.jar); } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
        const exit = children.get(item.id)?.exit();
        return { ...base, state: identity?.stopped ? 'stopped' : 'exited', pid, exitCode: exit?.code, detail: `PID 对应的进程已退出${exit ? `（退出码 ${exit.code ?? exit.signal}）` : ''}；PID 文件已失效。` };
      }
      if (!matchesJar(item, info, identity)) return { ...base, state: 'unknown', pid, detail: '进程身份不匹配或无法核实（旧脚本 PID、权限不足或 PID 复用），拒绝启动和终止。' };
      const previous = samples.get(item.id), now = Date.now();
      let cpu;
      if (previous?.created === info.created && now > previous.at && Number.isFinite(info.cpuSeconds)) cpu = Math.max(0, (info.cpuSeconds - previous.seconds) / ((now - previous.at) / 1000) * 100);
      samples.set(item.id, { at: now, created: info.created, seconds: info.cpuSeconds });
      return { ...base, state: 'running', pid, uptime: info.uptime, memory: info.memory, cpu, executable: info.executable, startedAt: identity.startedAt, detail: 'Java 进程身份已确认；业务是否就绪请检查应用日志。' };
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
    if (!['stopped', 'exited'].includes(current.state)) throw new Error(current.state === 'running' ? '此 JAR 已在运行。' : current.detail);
    if (runtime.supervised) {
      const result = await launchSupervisor(filename, item);
      return { output: result.output, status: await status(item) };
    }
    const jar = await realpath(item.jar);
    if (pathKey(jar) !== pathKey(item.jar) || !(await stat(jar)).isFile()) throw new Error('JAR 路径或链接目标已变化，请重新登记。');
    const java = await runtime.detect({ executable: item.executable, env: effectiveEnvironment(item) });
    if (!java.found) throw new Error(java.output);
    const paths = jarPaths(item);
    for (const target of [paths.pidPath, paths.identityPath, paths.logPath]) await regular(target);
    // Only a PID proven absent may be cleared. Reserve with wx across managers.
    if (await optional(paths.pidPath) !== null) await unlink(paths.pidPath);
    const reservation = await open(paths.pidPath, 'wx', 0o600);
    let output, child, identity;
    try {
      if (item.logMode === 'file' && !runtime.captureLogs) output = await open(paths.logPath, 'a', 0o600);
      child = await runtime.launch(java.executable, [...item.jvmArgs, '-jar', jar, ...item.appArgs], paths.directory, output?.fd, effectiveEnvironment(item));
      children.set(item.id, child);
      await reservation.writeFile(String(child.pid));
      await reservation.sync();
      const startedAt = new Date().toISOString();
      // Replace any previous successful-stop record even when the new JVM exits immediately.
      await atomic(paths.identityPath, { pid: child.pid, jar, executable: java.executable, created: null, startedAt, stopped: false });
      for (let attempt = 0; attempt < 12; attempt++) {
        const info = await runtime.inspect(child.pid);
        if (info && !info.unknown) {
          identity = { pid: child.pid, jar, executable: java.executable, created: info.created, startedAt, stopped: false };
          if (!matchesJar(item, info, identity)) throw new Error('启动的进程身份不符。');
          break;
        }
        if (child.exit()) break;
        await runtime.delay(150);
      }
      if (!identity) throw new Error('启动后进程已退出或无法核实身份，请检查 Java、启动参数和日志。');
      await atomic(paths.identityPath, identity);
      await runtime.delay(700);
      const result = await status(item);
      if (result.state !== 'running') throw new Error(`启动未能保持运行：${result.detail}`);
      return { status: result, output: `已启动 PID ${child.pid}。进程存活不代表业务就绪。` };
    } catch (error) {
      // Never kill an unidentified PID. Retain evidence for manual recovery.
      if (child) {
        const info = await runtime.inspect(child.pid);
        if (identity && matchesJar(item, info, identity)) {
          await runtime.signal(child.pid, true, identity.created).catch(() => {});
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
    if (!matchesJar(item, info, identity)) throw new Error('操作前进程身份已变化，已取消。');
    await runtime.signal(current.pid, force, identity.created);
    const deadline = Date.now() + item.stopTimeout * 1000;
    for (let attempt = 0; attempt < item.stopTimeout * 4 && Date.now() < deadline; attempt++) {
      const live = await runtime.inspect(current.pid);
      if (!live || (!live.unknown && live.created !== identity.created)) {
        identity.stopped = true; identity.stoppedAt = new Date().toISOString(); await atomic(paths.identityPath, identity);
        if (await optional(paths.pidPath) === String(current.pid)) await unlink(paths.pidPath);
        samples.delete(item.id);
        return { status: await status(item), output: force ? '已强制终止进程。' : '进程已停止。' };
      }
      if (!matchesJar(item, live, identity)) throw new Error('等待停止时进程身份无法核实，保留 PID 文件。');
      await runtime.delay(250);
    }
    throw new Error(`等待 ${item.stopTimeout} 秒仍未退出；可核对日志后选择“强制终止”。`);
  }
  async function request(action, value = {}) {
    if (action === 'get') return snapshot();
    if (action === 'detect') return runtime.detect({ executable: value.executable ? absolute(value.executable, 'Java 路径') : '' });
    if (action === 'statuses') {
      const result = []; for (const item of state.instances) result.push(await status(item)); return result;
    }
    if (action === 'log-tail') return log(find(value.id));
    if (action === 'upsert' || action === 'remove') {
      if (value.revision !== state.revision) throw new Error('列表已被修改，请刷新后重试。');
      if (action === 'remove') {
        const item = find(value.id), current = await status(item);
        if (!['stopped', 'exited'].includes(current.state) || current.supervision?.active) throw new Error('请先停止并确认进程状态后再移除。');
        const startup = await autostart.get(item);
        if (startup.enabled || startup.target || startup.error) throw new Error('请先关闭此 JAR 的系统自启，再移除记录。');
        return commit(state.instances.filter(item => item.id !== value.id));
      }
      const item = normalize(value.instance), existing = state.instances.find(old => old.id === item.id);
      if (!/^[a-f0-9-]{36}$/.test(item.id)) throw new Error('JAR 标识无效。');
      const previous = existing ? await status(existing) : null;
      if (existing && (!['stopped', 'exited'].includes(previous.state) || previous.supervision?.active)) {
        const { name: a, ...before } = existing, { name: b, ...after } = item;
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('运行中或状态未确认时仅可修改显示名称，请先停止。');
      }
      if (!existing && state.instances.length >= 100) throw new Error('最多登记 100 个 JAR。');
      item.jar = await realpath(item.jar);
      if (!(await stat(item.jar)).isFile()) throw new Error('JAR 不是普通文件。');
      const instances = [...state.instances.filter(old => old.id !== item.id), item];
      const paths = new Set();
      for (const entry of instances) for (const target of [entry.jar, ...Object.values(jarPaths(entry)).slice(1)]) {
        if (paths.has(pathKey(target))) throw new Error('JAR 已登记或 PID / 日志路径与其他记录冲突。'); paths.add(pathKey(target));
      }
      return commit(existing ? state.instances.map(old => old.id === item.id ? item : old) : [...state.instances, item]);
    }
    if (action === 'command') {
      const item = find(value.id);
      if (value.command === 'start') return start(item);
      if (value.command === 'stop') return stop(item, false);
      if (value.command === 'force-stop') return stop(item, true);
      if (value.command === 'restart') { await stop(item, false); return start(item); }
      throw new Error('未知 JAR 命令。');
    }
    if (action === 'health-check') {
      const item = find(value.id), current = await status(item);
      if (runtime.supervised) {
        const result = await supervisorRequest(item, 'health-check', (item.health.timeout + 10) * 1000);
        if (result) return result.health;
      }
      return current.state === 'running' ? probeHealth(item.health) : { state: 'stopped', detail: 'Java 进程未运行' };
    }
    if (action === 'startup-get') return autostart.get(find(value.id));
    if (action === 'startup-install') {
      const item = find(value.id);
      if (!(await stat(await realpath(item.jar))).isFile()) throw new Error('JAR 文件不可用。');
      const java = await runtime.detect({ executable: item.executable, env: effectiveEnvironment(item) });
      if (!java.found) throw new Error(java.output);
      return autostart.install({ ...item, executable: java.executable }, value.mode);
    }
    if (action === 'startup-remove') return autostart.remove(find(value.id));
    throw new Error('未知 JAR 操作。');
  }
  return {
    request(action, value) {
      if (closed) return Promise.reject(new Error('JAR 管理器已关闭。'));
      const pending = queue.then(() => request(action, value)); queue = pending.catch(() => {}); return pending;
    },
    async close() { closed = true; await queue; await unlock(); },
  };
}
