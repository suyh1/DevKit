import { mkdir, mkdtemp, rm, readFile, writeFile, realpath, stat, glob, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseNginx, flattenNginx, MAX_CONFIG_SIZE } from '../shared/nginx.mjs';
import { acquireProjectLock } from './project-lock.mjs';
import { atomicFile as atomic } from './atomic-file.mjs';
import { createNginxConfigSet } from './nginx-create.mjs';
import { inspectNginx, tailNginxLog } from './nginx-inspection.mjs';
import { prepareNginxDirectories, withDirectoryReport } from './nginx-directories.mjs';
import { stageNginxDraft } from './nginx-draft.mjs';
import { detectNginx, nginxArgs, runNginx, launchNginx, inspectNginxProcess, inspectNginxWorkers, processMatches, pathKey } from './nginx-process.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const message = error => error.message || String(error);
const identityDirectives = content => flattenNginx(parseNginx(content)).filter(node => node.name === 'pid' || node.name === 'include').map(node => `${node.name} ${node.args}`).join('\n');
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
  return { path: await realpath(filename), content, hash: digest(bytes) };
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
  const runtime = { detect: detectNginx, run: runNginx, launch: launchNginx, inspect: inspectNginxProcess, workers: inspectNginxWorkers, ...dependencies };
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
  let allowExecution = true;
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
    if (!allowExecution) throw new Error('未授予运行管理权限，未执行程序检测；运行状态未确认。');
    const detected = await runtime.detect(instance);
    if (!detected.found) throw new Error(detected.output);
    versions.set(key, detected); return detected;
  }
  async function configuredPid(instance) {
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
    return pidNodes[0] ? path.resolve(instance.prefix, pidNodes[0].values[0]) : '';
  }
  async function effective(instance) {
    const detected = await binary(instance);
    const pidPath = await configuredPid(instance) || path.resolve(instance.prefix, detected.pid || 'logs/nginx.pid');
    return { ...instance, executable: detected.executable, pidPath };
  }
  async function validateDirectories(instance, bound) {
    let preparation;
    try {
      preparation = await prepareNginxDirectories(bound, { readConfig: readDocument, buildInfo: (await binary(instance)).output });
      let result;
      for (let attempt = 0; attempt < 12; attempt++) {
        result = await runtime.run(bound.executable, nginxArgs(bound, 'test'), bound.prefix);
        try { if (!await preparation.repairMissing(result.output)) break; }
        catch (error) {
          if (!result.ok) throw error;
          preparation.directoryWarnings.push(`配置检查已通过，但默认启动日志目录未能补齐：${message(error)}`); break;
        }
      }
      return { result, preparation };
    } catch (error) {
      return { result: { ok: false, output: `运行目录准备失败，未启动或重载。\n${message(error)}` }, preparation: preparation || error };
    }
  }
  async function status(instance, priorPath) {
    if (instance.platform !== 'any' && instance.platform !== process.platform) return { id: instance.id, state: 'platform', detail: '此配置属于其他操作系统，可编辑但不能在本机运行。' };
    try {
      const bound = await effective(instance);
      if (priorPath) bound.pidPath = priorPath;
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
  async function signalReload(instance, current, bound) {
    const before = await runtime.workers(current.pid, bound.executable);
    const latest = await status(instance);
    if (latest.state !== 'running' || latest.pid !== current.pid || latest.pidPath !== current.pidPath) return { ok: false, status: latest, output: '目标进程已变化，未发送重载信号。' };
    const sent = await runtime.run(bound.executable, nginxArgs(bound, 'reload'), bound.prefix);
    if (!sent.ok) return { ...sent, status: await status(instance) };
    if (before?.length) {
      let observed = new Set();
      const deadline = performance.now() + 4500;
      do {
        const workers = await runtime.workers(current.pid, bound.executable);
        if (!workers) break;
        const replaced = workers.length > 0 && workers.every(pid => !before.includes(pid));
        if (replaced && workers.some(pid => observed.has(pid))) {
          const after = await status(instance);
          if (after.state === 'running' && after.pid === current.pid && after.pidPath === current.pidPath)
            return { ...sent, status: after, reloadState: 'confirmed', output: '已确认 Nginx 工作进程换代。' };
          break;
        }
        observed = new Set(replaced ? workers : []);
        await delay(180);
      } while (performance.now() < deadline);
    }
    return { ...sent, ok: false, status: await status(instance), reloadState: 'unconfirmed', output: '重载信号已发送，尚未确认工作进程换代。请核对错误日志和服务响应。' };
  }
  async function collectChanges(instance, changes) {
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
    return pending;
  }
  async function saveFiles(instance, changes, recovery) {
    const pending = await collectChanges(instance, changes);
    // A live master must keep its PID address stable so that -s quit still reaches it.
    const identityChanges = new Set(pending.filter(change => identityDirectives(change.content) !== identityDirectives(change.before.content)).map(change => pathKey(change.path)));
    for (const affected of state.instances.filter(item => !recovery && [item.main, ...item.files].some(file => identityChanges.has(pathKey(file))))) {
      const beforeStatus = await status(affected);
      if (beforeStatus.state === 'running' || beforeStatus.state === 'unknown') throw new Error(`实例“${affected.name}”运行状态未确认停止，请先停止实例并由有运行权限的管理者确认，再修改共享文件中的 pid / include。`);
    }
    const backupId = `${Date.now()}-${randomUUID()}`;
    const backupDir = path.join(folder, 'backups', backupId);
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify({ instanceId: instance.id, createdAt: new Date().toISOString(), ...recovery, files: pending.map((item, index) => ({ path: item.path, file: `${index}.conf`, hash: item.before.hash, savedHash: digest(Buffer.from(item.content)) })) }, null, 2), { mode: 0o600 });
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
    return { ...await documents(instance), backup: backupDir, backupId };
  }
  async function affectedInstances(instance, paths, previousIds = []) {
    const result = [];
    for (const item of state.instances) {
      if (item.id === instance.id || previousIds.includes(item.id)) { result.push(item); continue; }
      const current = await inspectNginx(item, readDocument);
      if (current.documents.some(doc => paths.has(pathKey(doc.path)))) result.push(item);
    }
    return result;
  }
  async function backupRecord(instance, id) {
    if (typeof id !== 'string' || !/^\d+-[a-f0-9-]+$/.test(id)) throw new Error('备份编号无效。');
    const directory = path.join(folder, 'backups', id);
    const backup = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (backup.instanceId !== instance.id) throw new Error('备份不属于当前实例。');
    return { directory, backup };
  }
  async function restoreBackup(instance, payload) {
    const { directory, backup } = await backupRecord(instance, payload.backupId);
    const changes = [];
    let identityChanged = false;
    for (const [index, file] of backup.files.entries()) {
      const current = await readDocument(file.path);
      if (current.hash === file.hash) continue;
      if (current.hash !== file.savedHash) throw new Error(`文件自应用后已改变，请对比备份并手动合并：${file.path}`);
      const content = await readFile(path.join(directory, `${index}.conf`), 'utf8');
      if (digest(Buffer.from(content)) !== file.hash) throw new Error(`备份内容已改变：${file.path}`);
      if (!identityChanged) {
        try { identityChanged = identityDirectives(content) !== identityDirectives(current.content); }
        catch { identityChanged = true; }
      }
      changes.push({ path: file.path, hash: current.hash, content });
    }
    const items = await affectedInstances(instance, new Set(backup.files.map(file => pathKey(file.path))));
    const affected = items.map(item => ({ id: item.id, name: item.name }));
    if (!changes.length) return { ok: true, phase: '恢复磁盘文件', output: '磁盘文件已与备份一致。可在备份列表查看之前的恢复记录。', affected, ...await documents(instance) };
    if (payload.confirmed !== true) return { ok: true, phase: '恢复磁盘文件', output: `将恢复 ${changes.length} 个磁盘文件。`, affected };
    // Backups may need to restore the former PID directive while the process is unknown.
    // Keep the preceding PID locations for the separate process verification.
    const priorPids = identityChanged ? Object.fromEntries(await Promise.all(items.map(async item => [
      item.id, await configuredPid(item).catch(() => null),
    ]))) : {};
    const saved = await saveFiles(instance, changes, {
      restoredFrom: payload.backupId, affectedIds: affected.map(item => item.id), priorPids,
      restoredFiles: backup.files.map(({ path, hash }) => ({ path, hash })),
    });
    return { ok: true, phase: '恢复磁盘文件', output: '已恢复磁盘文件。请单独确认运行进程后重载。', affected, ...saved, recoveryId: saved.backupId };
  }
  async function reloadRestored(instance, payload) {
    const { backup } = await backupRecord(instance, payload.backupId);
    if (!backup.restoredFrom || !Array.isArray(backup.affectedIds) || !Array.isArray(backup.restoredFiles)) throw new Error('请选择已完成磁盘恢复的记录。');
    const phase = '确认进程并重载';
    const items = await affectedInstances(instance, new Set(backup.restoredFiles.map(file => pathKey(file.path))), backup.affectedIds);
    const affected = [];
    const running = [];
    const issues = [];
    for (const item of items) {
      const current = await status(item);
      const prior = backup.priorPids?.[item.id];
      if (prior !== undefined && ['stopped', 'running'].includes(current.state)) {
        const priorPath = prior === '' ? path.resolve(item.prefix, (await binary(item)).pid || 'logs/nginx.pid') : prior;
        if (priorPath === null || (pathKey(priorPath) !== pathKey(current.pidPath) && (await status(item, priorPath)).state !== 'stopped')) {
          current.state = 'unknown';
          current.detail = '请核实恢复前 PID 文件对应的进程。';
        }
      }
      affected.push({ id: item.id, name: item.name, state: current.state, pid: current.pid, pidPath: current.pidPath });
      if (current.state === 'running') running.push({ item, current });
      if (current.state === 'unknown' || current.state === 'platform') issues.push(`${item.name}：${current.detail}`);
    }
    const report = (ok, output, extra = {}) => ({ ok, phase, output, affected, ...extra });
    if (issues.length) return report(false, issues.join('\n'));
    for (const file of backup.restoredFiles) {
      if ((await readDocument(file.path)).hash !== file.hash) return report(false, `恢复后的磁盘文件已变化：${file.path}`);
    }
    if (payload.confirmed !== true) return report(true, '已核实受影响实例的运行状态。');
    if (JSON.stringify(payload.affected) !== JSON.stringify(affected)) return report(false, '受影响的实例或进程已变化，请重新确认。');
    const checked = [];
    for (const { item, current } of running) {
      const bound = await effective(item), { result } = await validateDirectories(item, bound);
      if (!result.ok) return report(false, `${item.name}\n${result.output}`);
      checked.push({ item, current, bound });
    }
    for (const file of backup.restoredFiles) {
      if ((await readDocument(file.path)).hash !== file.hash) return report(false, `校验期间恢复后的磁盘文件已变化：${file.path}`);
    }
    const reloaded = [];
    for (const { item, current, bound } of checked) {
      const result = await signalReload(item, current, bound);
      if (!result.ok) return report(false, `${item.name}\n${result.output}`, { reloaded, reloadState: result.reloadState });
      reloaded.push(item.name);
    }
    return report(true, reloaded.length ? '已确认运行中实例的 Nginx 工作进程换代。' : '受影响的实例均已停止。', { reloaded });
  }
  async function applyDraft(instance, payload) {
    let phase = '检查草稿', saved, affected = [];
    const report = (ok, output, extra = {}) => ({ ok, phase, output, affected, ...saved, ...extra });
    const temporary = await mkdtemp(path.join(folder, 'draft-'));
    try {
      const pending = await collectChanges(instance, payload.files);
      const changes = new Map(pending.map(item => [pathKey(item.path), item]));
      const stagedDocs = new Map();
      for (const item of await affectedInstances(instance, changes)) {
        const currentStatus = await status(item);
        affected.push({ id: item.id, name: item.name, state: currentStatus.state, pid: currentStatus.pid, pidPath: currentStatus.pidPath });
        if (['unknown', 'platform'].includes(currentStatus.state)) throw new Error(`${item.name}：${currentStatus.detail}`);
        const work = await mkdtemp(path.join(temporary, 'instance-'));
        const staged = await stageNginxDraft(item, changes, work, readDocument);
        for (const doc of staged.sources) stagedDocs.set(doc.path, doc.hash);
        const bound = { ...item, main: staged.main, executable: (await binary(item)).executable };
        const result = await runtime.run(bound.executable, nginxArgs(bound, 'test'), bound.prefix);
        if (!result.ok) throw new Error(`${item.name}\n${result.output}`);
      }
      if (!payload.confirmed) return report(true, '临时草稿检查通过。');
      if (JSON.stringify(payload.affected) !== JSON.stringify(affected)) throw new Error('受影响的实例或进程已变动，请重新检查和确认。');
      phase = '保存配置';
      for (const [filename, hash] of stagedDocs) if ((await readDocument(filename)).hash !== hash) throw new Error(`检查期间配置被修改：${filename}`);
      saved = await saveFiles(instance, payload.files);
      phase = '重载实例';
      const reloaded = [];
      for (const before of affected.filter(item => item.state === 'running')) {
        const item = find(before.id), latest = await status(item);
        if (latest.state !== 'running' || latest.pid !== before.pid || latest.pidPath !== before.pidPath) return report(false, `${item.name} 的运行状态已变化，未发送重载信号。`, { reloaded });
        const bound = await effective(item);
        const result = await signalReload(item, latest, bound);
        if (!result.ok) return report(false, `${item.name}\n${result.output}`, { reloaded, reloadState: result.reloadState });
        reloaded.push(item.name);
      }
      return report(true, reloaded.length ? '配置已保存，已确认运行中实例的 Nginx 工作进程换代。' : '配置已保存，受影响的实例均已停止。', { reloaded });
    } catch (error) { return report(false, message(error)); }
    finally { await rm(temporary, { recursive: true, force: true, maxRetries: 3 }); }
  }
  let queue = Promise.resolve(), closed = false;
  async function upsertInstance(input, revision) {
    checkRevision(revision);
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !['win32', 'linux', 'any'].includes(input.platform)) throw new Error('实例名称或目标系统无效。');
    const old = input.id ? find(input.id) : null;
    if (!old && state.instances.length >= 100) throw new Error('最多管理 100 个实例。');
    const main = await configFile(input.main);
    let prefix = absolute(input.prefix, '运行目录');
    try {
      prefix = await realpath(prefix);
      if (!(await stat(prefix)).isDirectory()) throw new Error('运行目录不是文件夹。');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
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
  async function request(action, payload = {}, options = {}) {
    if (closed) throw new Error('Nginx 管理器已关闭。');
    const promise = queue.then(async () => {
      allowExecution = options.allowExecution !== false;
      if (!allowExecution && ['detect', 'command', 'apply-draft', 'restore-backup', 'restore-disk', 'reload-restored'].includes(action)) throw new Error('未授予运行管理权限。');
      switch (action) {
        case 'get': return { ...structuredClone(state), platform: process.platform, directory: folder };
        case 'detect': versions.clear(); return runtime.detect(payload);
        case 'discover': return discoverIncludes(payload.main);
        case 'statuses': {
          const results = [];
          // Avoid spawning one PowerShell process per instance at the same time.
          for (let offset = 0; offset < state.instances.length; offset += 3) results.push(...await Promise.all(state.instances.slice(offset, offset + 3).map(instance => status(instance))));
          return results;
        }
        case 'documents': return documents(find(payload.id));
        case 'inspect': {
          const instance = find(payload.id), scan = await inspectNginx(instance, readDocument);
          return { logs: scan.logs, references: scan.references, warnings: scan.warnings };
        }
        case 'log-tail': {
          const scan = await inspectNginx(find(payload.id), readDocument);
          const log = scan.logs.find(log => log.path === payload.path);
          if (!log) throw new Error('只能读取当前实例生效配置中显式指定的文件日志。');
          return tailNginxLog(log.path, payload);
        }
        case 'review': {
          const instance = find(payload.id), current = await documents(instance);
          const impacts = [], warnings = [...current.warnings];
          const keys = new Set(current.files.map(doc => pathKey(doc.path)));
          for (const item of state.instances) {
            const scan = await inspectNginx(item, readDocument);
            if (scan.documents.some(doc => keys.has(pathKey(doc.path)))) {
              impacts.push({ id: item.id, name: item.name, files: scan.documents.filter(doc => keys.has(pathKey(doc.path))).map(doc => doc.path), references: scan.references.filter(ref => keys.has(pathKey(ref.to))) });
            }
            warnings.push(...scan.warnings.map(warning => `${item.name}：${warning}`));
          }
          return { files: current.files, impacts, warnings: [...new Set(warnings)].slice(0, 100) };
        }
        case 'save-files': return saveFiles(find(payload.id), payload.files);
        case 'apply-draft': {
          if (options.allowEdit === false) throw new Error('未授予编辑权限。');
          return applyDraft(find(payload.id), payload);
        }
        case 'restore-backup':
        case 'restore-disk': {
          if (options.allowEdit === false) throw new Error('未授予编辑权限。');
          return restoreBackup(find(payload.id), payload);
        }
        case 'reload-restored': return reloadRestored(find(payload.id), payload);
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
          if (payload.command === 'test') {
            const { result, preparation } = await validateDirectories(instance, bound);
            return withDirectoryReport({ ...result, command, status: await status(instance) }, preparation);
          }
          const current = await status(instance);
          if (payload.command === 'start' && current.state !== 'stopped') throw new Error(current.state === 'running' ? '此实例已在运行。' : current.detail);
          if (payload.command !== 'start' && current.state !== 'running') throw new Error(`无法确认运行中的此实例：${current.detail}`);
          let preparation;
          if (payload.command !== 'stop') {
            const checked = await validateDirectories(instance, bound); preparation = checked.preparation;
            if (!checked.result.ok) return withDirectoryReport({ ...checked.result, command, output: `配置检查未通过，未${payload.command === 'start' ? '启动' : '重载'}。\n${checked.result.output}`, status: current }, preparation);
          }
          if (payload.command === 'reload') return withDirectoryReport({ ...await signalReload(instance, current, bound), command }, preparation);
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
          return withDirectoryReport({ ok, command, status: after, output: ok ? (payload.command === 'start' ? 'Nginx 已启动，主进程身份已确认。' : 'Nginx 已优雅停止。') : `命令已发送，尚未确认目标状态（优雅退出可能仍在等待连接）。${after.detail}` }, preparation);
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
