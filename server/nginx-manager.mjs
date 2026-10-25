import { mkdir, readFile, writeFile, rename, unlink, realpath, stat, open, glob, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseNginx, flattenNginx, MAX_CONFIG_SIZE } from '../shared/nginx.mjs';
import { acquireProjectLock } from './project-lock.mjs';
import { createNginxConfigSet } from './nginx-create.mjs';
import { detectNginx, nginxArgs, runNginx, launchNginx, inspectNginxProcess, processMatches, pathKey } from './nginx-process.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const message = error => error.message || String(error);
function absolute(value, label) {
  if (typeof value !== 'string' || !value || value.length > 12000 || /[\0\r\n]/.test(value) || !path.isAbsolute(value)) throw new Error(`${label}需要本机绝对路径。`);
  return path.resolve(value);
}
async function configFile(filename) {
  const resolved = await realpath(absolute(filename, '配置文件'));
  const info = await stat(resolved);
  if (!info.isFile() || info.size > MAX_CONFIG_SIZE * 3) throw new Error('配置文件过大或不是普通文件。');
  return resolved;
}
async function readDocument(filename) {
  const bytes = await readFile(await configFile(filename));
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`仅支持 UTF-8 配置文件，请先转换编码：${filename}`); }
  if (content.includes('\0') || content.length > MAX_CONFIG_SIZE) throw new Error(`文件不是有效的文本配置：${filename}`);
  return { path: filename, content, hash: digest(bytes) };
}
async function atomic(filename, bytes, mode = 0o600) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', mode);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
export async function discoverIncludes(main) {
  main = await configFile(main);
  const files = [], warnings = [], visited = new Set([pathKey(main)]);
  const confPrefix = path.dirname(main);
  async function visit(filename, depth) {
    if (depth > 32) { warnings.push(`include 嵌套超过 32 层：${filename}`); return; }
    let nodes;
    try { nodes = parseNginx((await readDocument(filename)).content); }
    catch (error) { warnings.push(`${filename}：${message(error)}`); return; }
    for (const node of flattenNginx(nodes).filter(node => node.name === 'include')) {
      if (node.values.length !== 1 || node.values[0].includes('$')) { warnings.push(`无法自动解析 include：${node.args}`); continue; }
      const pattern = path.resolve(confPrefix, node.values[0]).replaceAll('\\', '/');
      try {
        let matches = 0;
        for await (const match of glob(pattern)) {
          if (++matches > 100 || visited.size >= 100) { warnings.push('附属文件扫描上限为 100 个，请缩小 include 范围。'); break; }
          const resolved = await configFile(match);
          if (visited.has(pathKey(resolved))) continue;
          visited.add(pathKey(resolved)); files.push(resolved); await visit(resolved, depth + 1);
        }
        if (!matches) warnings.push(`include 未匹配文件：${node.values[0]}`);
      } catch (error) { warnings.push(`include ${node.args}：${message(error)}`); }
    }
  }
  await visit(main, 0);
  return { main, files, warnings };
}

export async function createNginxManager(directory, dependencies = {}) {
  const runtime = { detect: detectNginx, run: runNginx, launch: launchNginx, inspect: inspectNginxProcess, ...dependencies };
  const folder = path.join(directory, 'nginx');
  await mkdir(folder, { recursive: true });
  const unlock = await acquireProjectLock(folder);
  const filename = path.join(folder, 'instances.json');
  let state;
  try {
    try {
      state = JSON.parse(await readFile(filename, 'utf8'));
      if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.instances) || state.instances.length > 100) throw new Error('实例注册表格式无效');
      const ids = new Set();
      for (const item of state.instances) {
        if (typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id) || typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.files) || item.files.length > 100 || !['win32', 'linux', 'any'].includes(item.platform)) throw new Error('实例定义无效');
        ids.add(item.id); absolute(item.main, '主文件'); absolute(item.prefix, '运行目录');
        if (item.executable) absolute(item.executable, 'nginx 路径');
        item.files.forEach(file => absolute(file, '附属文件'));
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Nginx 注册表无法读取，原文件已保留：${message(error)}`);
      state = { schemaVersion: 1, revision: 0, instances: [] };
      await atomic(filename, JSON.stringify(state, null, 2));
    }
  } catch (error) { await unlock(); throw error; }
  const versions = new Map();
  const find = id => { const item = state.instances.find(item => item.id === id); if (!item) throw new Error('Nginx 实例不存在，请刷新。'); return item; };
  function checkRevision(revision) { if (revision !== state.revision) throw new Error('实例设置已改变，请刷新后重试。'); }
  async function commit(instances) {
    const next = { ...state, revision: state.revision + 1, instances };
    await atomic(filename, JSON.stringify(next, null, 2)); state = next;
    return structuredClone(state);
  }
  async function binary(instance) {
    const key = `${instance.executable}|${instance.prefix}|${instance.main}`;
    if (versions.has(key)) return versions.get(key);
    const detected = await runtime.detect(instance);
    if (!detected.found) throw new Error(detected.output);
    versions.set(key, detected); return detected;
  }
  async function effective(instance) {
    const detected = await binary(instance);
    const expanded = new Set();
    async function roots(file, depth = 0) {
      if (depth > 32 || expanded.size > 100) throw new Error('顶层 include 过深或过多。');
      if (expanded.has(pathKey(file))) return [];
      expanded.add(pathKey(file));
      const nodes = parseNginx((await readDocument(file)).content), result = [];
      for (const node of nodes) {
        if (node.name !== 'include') { result.push(node); continue; }
        if (node.values.length !== 1 || node.values[0].includes('$')) throw new Error('无法确定顶层 include，不能安全定位 PID。');
        for await (const match of glob(path.resolve(path.dirname(instance.main), node.values[0]).replaceAll('\\', '/'))) result.push(...await roots(await configFile(match), depth + 1));
      }
      return result;
    }
    const pidNodes = (await roots(instance.main)).filter(node => node.name === 'pid');
    if (pidNodes.length > 1 || pidNodes.some(node => node.values.length !== 1 || node.values[0].includes('$'))) throw new Error('无法确定唯一 PID 文件，请检查顶层 pid 指令。');
    return { ...instance, executable: detected.executable, pidPath: path.resolve(instance.prefix, pidNodes[0]?.values[0] || detected.pid || 'logs/nginx.pid') };
  }
  async function status(instance) {
    if (instance.platform !== 'any' && instance.platform !== process.platform) return { id: instance.id, state: 'platform', detail: '此配置属于其他操作系统，可编辑但不能在本机运行。' };
    try {
      const bound = await effective(instance);
      let raw;
      try { raw = (await readFile(bound.pidPath, 'utf8')).trim(); }
      catch (error) { if (error.code === 'ENOENT') return { id: instance.id, state: 'stopped', detail: '未发现 PID 文件', pidPath: bound.pidPath }; throw error; }
      // nginx -t may create an empty pid file even though it never starts a master.
      if (!raw) return { id: instance.id, state: 'stopped', detail: 'PID 文件为空（配置检查可能创建空文件）', pidPath: bound.pidPath };
      if (!/^\d+$/.test(raw) || Number(raw) <= 1 || !Number.isSafeInteger(Number(raw))) return { id: instance.id, state: 'unknown', detail: 'PID 文件内容无效，拒绝操作。', pidPath: bound.pidPath };
      const info = await runtime.inspect(Number(raw));
      if (!info) return { id: instance.id, state: 'stopped', detail: 'PID 对应的进程已退出', pidPath: bound.pidPath };
      if (!processMatches(bound, info)) return { id: instance.id, state: 'unknown', pid: Number(raw), pidPath: bound.pidPath, detail: 'PID 对应进程与当前 nginx 路径 / 主配置不匹配，或无权限读取，拒绝操作。' };
      return { id: instance.id, state: 'running', pid: Number(raw), pidPath: bound.pidPath, detail: '主进程身份已确认' };
    } catch (error) { return { id: instance.id, state: 'unknown', detail: message(error) }; }
  }
  async function documents(instance) {
    const files = [], warnings = [];
    for (const file of [instance.main, ...instance.files]) {
      try { files.push(await readDocument(file)); } catch (error) { warnings.push(`${file}：${message(error)}`); }
    }
    return { files, warnings };
  }
  async function saveFiles(instance, changes) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new Error('没有需要保存的文件。');
    const allowed = new Set([instance.main, ...instance.files].map(pathKey)), seen = new Set(), pending = [];
    for (const change of changes) {
      if (!change || typeof change.path !== 'string' || !allowed.has(pathKey(change.path)) || seen.has(pathKey(change.path))) throw new Error('只能保存当前实例中已登记且不重复的配置文件。');
      seen.add(pathKey(change.path));
      const target = await configFile(change.path);
      if (pathKey(target) !== pathKey(change.path)) throw new Error('文件链接目标已变化，请重新添加。');
      if (typeof change.content !== 'string' || change.content.includes('\0')) throw new Error('配置内容无效。');
      parseNginx(change.content);
      const before = await readDocument(target);
      if (before.hash !== change.hash) throw new Error(`文件已被外部修改，请重新读取并合并：${target}`);
      pending.push({ path: target, before, content: change.content, info: await stat(target) });
    }
    // A live master must keep its PID address stable so that -s quit still reaches it.
    const identityDirectives = content => flattenNginx(parseNginx(content)).filter(node => node.name === 'pid' || node.name === 'include').map(node => `${node.name} ${node.args}`).join('\n');
    const identityChanges = new Set(pending.filter(change => identityDirectives(change.content) !== identityDirectives(change.before.content)).map(change => pathKey(change.path)));
    for (const affected of state.instances.filter(item => [item.main, ...item.files].some(file => identityChanges.has(pathKey(file))))) {
      const beforeStatus = await status(affected);
      if (beforeStatus.state === 'running' || beforeStatus.state === 'unknown' && beforeStatus.pid) throw new Error(`实例“${affected.name}”运行状态未确认停止，请先停止实例再修改共享文件中的 pid / include。`);
    }
    const backupId = `${Date.now()}-${randomUUID()}`;
    const backupDir = path.join(folder, 'backups', backupId);
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify({ instanceId: instance.id, createdAt: new Date().toISOString(), files: pending.map((item, index) => ({ path: item.path, file: `${index}.conf`, hash: item.before.hash })) }, null, 2), { mode: 0o600 });
    for (let index = 0; index < pending.length; index++) await writeFile(path.join(backupDir, `${index}.conf`), pending[index].before.content, { mode: 0o600 });
    const saved = [];
    try {
      for (const change of pending) {
        if ((await readDocument(change.path)).hash !== change.before.hash) throw new Error(`保存期间文件被修改：${change.path}`);
        // Preserve ownership and mode on Unix; a different owner requires an explicit OS-level fix.
        if (process.platform !== 'win32' && typeof process.getuid === 'function' && change.info.uid !== process.getuid()) throw new Error(`文件不属于当前用户，拒绝改变所有者：${change.path}`);
        await atomic(change.path, change.content, change.info.mode & 0o777); saved.push(change);
      }
    } catch (error) {
      const failures = [];
      for (const change of saved.reverse()) {
        try {
          if ((await readDocument(change.path)).hash !== digest(Buffer.from(change.content))) throw new Error('文件再次被外部修改');
          await atomic(change.path, change.before.content, change.info.mode & 0o777);
        } catch (failure) { failures.push(`${change.path}：${message(failure)}`); }
      }
      throw new Error(`${message(error)}；原文件备份位于 ${backupDir}${failures.length ? `；部分回滚失败：${failures.join('；')}` : '；本次已写入文件已回滚'}`);
    }
    return { ...await documents(instance), backup: backupDir };
  }
  let queue = Promise.resolve(), closed = false;
  async function upsertInstance(input, revision) {
    checkRevision(revision);
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !['win32', 'linux', 'any'].includes(input.platform)) throw new Error('实例名称或目标系统无效。');
    const old = input.id ? find(input.id) : null;
    if (!old && state.instances.length >= 100) throw new Error('最多管理 100 个实例。');
    const main = await configFile(input.main);
    const prefix = await realpath(absolute(input.prefix, '运行目录'));
    if (!(await stat(prefix)).isDirectory()) throw new Error('运行目录不是文件夹。');
    if (!Array.isArray(input.files) || input.files.length > 99) throw new Error('附属文件最多 99 个。');
    const files = [...new Set(await Promise.all(input.files.map(configFile)))].filter(file => pathKey(file) !== pathKey(main));
    let executable = '';
    if (input.executable) executable = await realpath(absolute(input.executable, 'nginx 路径'));
    const instance = { id: old?.id || randomUUID(), name: input.name.trim(), main, prefix, executable, files, platform: input.platform };
    if (state.instances.some(item => item.id !== instance.id && pathKey(item.main) === pathKey(main))) throw new Error('此主配置已登记为另一个实例。');
    if (old && ['main', 'prefix', 'executable', 'platform'].some(key => old[key] !== instance[key])) {
      const oldStatus = await status(old);
      if (oldStatus.state === 'running' || oldStatus.state === 'unknown' && oldStatus.pid) throw new Error('请先确认实例停止，再修改主文件、运行目录、程序或系统。');
    }
    versions.clear();
    return commit(old ? state.instances.map(item => item.id === old.id ? instance : item) : [...state.instances, instance]);
  }
  async function request(action, payload = {}) {
    if (closed) throw new Error('Nginx 管理器已关闭。');
    const promise = queue.then(async () => {
      switch (action) {
        case 'get': return { ...structuredClone(state), platform: process.platform, directory: folder };
        case 'detect': versions.clear(); return runtime.detect(payload);
        case 'discover': return discoverIncludes(payload.main);
        case 'statuses': {
          const results = [];
          // Avoid spawning one PowerShell process per instance at the same time.
          for (let offset = 0; offset < state.instances.length; offset += 3) results.push(...await Promise.all(state.instances.slice(offset, offset + 3).map(status)));
          return results;
        }
        case 'documents': return documents(find(payload.id));
        case 'save-files': return saveFiles(find(payload.id), payload.files);
        case 'create': {
          checkRevision(payload.revision);
          if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 100 || !['win32', 'linux', 'any'].includes(payload.platform)) throw new Error('实例名称或目标系统无效。');
          if (state.instances.length >= 100) throw new Error('最多管理 100 个实例。');
          let executable = '';
          if (payload.executable) executable = await realpath(absolute(payload.executable, 'nginx 路径'));
          return createNginxConfigSet(payload.directory, payload, paths => upsertInstance({ name: payload.name, platform: payload.platform, executable, ...paths }, payload.revision));
        }
        case 'upsert': return upsertInstance(payload.instance, payload.revision);
        case 'remove': {
          checkRevision(payload.revision); const instance = find(payload.id);
          const current = await status(instance);
          if (!['stopped', 'platform'].includes(current.state) && !payload.forgetOnly) throw new Error('实例仍在运行或状态不明，请停止后移除，或明确选择仅取消登记。');
          return commit(state.instances.filter(item => item.id !== instance.id));
        }
        case 'command': {
          const instance = find(payload.id);
          if (!['test', 'start', 'reload', 'stop'].includes(payload.command)) throw new Error('未知 Nginx 操作。');
          if (instance.platform !== 'any' && instance.platform !== process.platform) throw new Error('当前操作系统与实例目标系统不一致。');
          const bound = await effective(instance);
          const args = nginxArgs(bound, payload.command);
          const command = [bound.executable, ...args].map(value => JSON.stringify(value)).join(' ');
          if (payload.command === 'test') return { ...await runtime.run(bound.executable, args, bound.prefix), command, status: await status(instance) };
          const current = await status(instance);
          if (payload.command === 'start' && current.state !== 'stopped') throw new Error(current.state === 'running' ? '此实例已在运行。' : current.detail);
          if (payload.command !== 'start' && current.state !== 'running') throw new Error(`无法确认运行中的此实例：${current.detail}`);
          if (payload.command !== 'stop') {
            const checked = await runtime.run(bound.executable, nginxArgs(bound, 'test'), bound.prefix);
            if (!checked.ok) return { ...checked, command, output: `配置检查未通过，未${payload.command === 'start' ? '启动' : '重载'}。\n${checked.output}`, status: current };
          }
          // Recheck after -t to avoid signaling a PID which changed during validation.
          const latest = await status(instance);
          if (latest.state !== current.state || latest.pid !== current.pid || latest.pidPath !== current.pidPath) throw new Error('实例状态在操作前发生变化，请刷新重试。');
          if (payload.command === 'start') await runtime.launch(bound.executable, args, bound.prefix);
          else {
            const result = await runtime.run(bound.executable, args, bound.prefix);
            if (!result.ok) return { ...result, command, status: await status(instance) };
          }
          let after;
          for (let attempt = 0; attempt < 16; attempt++) {
            after = await status(instance);
            if (payload.command === 'stop' ? after.state === 'stopped' : after.state === 'running') break;
            await delay(150);
          }
          const ok = payload.command === 'stop' ? after.state === 'stopped' : after.state === 'running';
          return { ok, command, status: after, output: ok ? ({ start: 'Nginx 已启动，主进程身份已确认。', reload: '重载信号已发送，主进程仍在运行；实际新配置启用情况请核对错误日志。', stop: 'Nginx 已优雅停止。' })[payload.command] : `命令已发送，尚未确认目标状态（优雅退出可能仍在等待连接）。${after.detail}` };
        }
        case 'backups': {
          const instance = find(payload.id), result = [];
          for (const entry of await readdir(path.join(folder, 'backups')).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
            if (!/^\d+-[a-f0-9-]+$/.test(entry)) continue;
            const backup = JSON.parse(await readFile(path.join(folder, 'backups', entry, 'manifest.json'), 'utf8'));
            if (backup.instanceId === instance.id) result.push({ id: entry, ...backup });
          }
          return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        }
        case 'backup-files': {
          const instance = find(payload.id);
          if (typeof payload.backupId !== 'string' || !/^\d+-[a-f0-9-]+$/.test(payload.backupId)) throw new Error('备份编号无效。');
          const dir = path.join(folder, 'backups', payload.backupId), backup = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
          if (backup.instanceId !== instance.id) throw new Error('备份不属于当前实例。');
          return { files: await Promise.all(backup.files.map(async (file, index) => ({ path: file.path, content: await readFile(path.join(dir, `${index}.conf`), 'utf8') }))) };
        }
        default: throw new Error('未知 Nginx 管理操作。');
      }
    });
    queue = promise.catch(() => {}); return promise;
  }
  return { request, close: async () => { closed = true; await queue; await unlock(); } };
}
