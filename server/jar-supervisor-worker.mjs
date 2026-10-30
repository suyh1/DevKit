import { readFile, writeFile, mkdir, unlink, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { createJarManager, jarPaths, normalizeJar } from './jar-manager.mjs';
import { createJarLogWriter } from './jar-log-writer.mjs';
import { effectiveEnvironment, probeHealth, retryDecision } from './jar-policies.mjs';
import { supervisorPath, supervisorRequest } from './jar-supervisor-client.mjs';
import { inspectJava, protectSupervisorFile, detectJava } from './jar-process.mjs';

const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const registry = option('--registry'), id = option('--id'), fallbackJava = option('--java');
if (!path.isAbsolute(registry || '') || !/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('守护启动参数无效。');
const source = JSON.parse(await readFile(registry, 'utf8'));
const selected = source.instances.find(item => item.id === id);
if (!selected) throw new Error('JAR 记录不存在。');
const item = normalizeJar(selected);
const endpointFile = supervisorPath(item), token = randomBytes(32).toString('hex');
if (await supervisorRequest(item)) process.exit(0);
const ownIdentity = await inspectJava(process.pid);
if (!ownIdentity || ownIdentity.unknown) throw new Error('无法核实守护进程身份。');
const endpoint = { pid: process.pid, port: 0, token, id, created: ownIdentity.created };
// Reserve before creating the shadow manager, so two launches cannot control one JAR.
await writeFile(endpointFile, JSON.stringify(endpoint), { flag: 'wx', mode: 0o600 });
let manager, writer, server, monitor, pruneTimer, retryTimer, currentChild, currentDrain, startPromise, operation = Promise.resolve();
let desired = true, terminating = false, attempts = 0, startedAt = 0, lastExit, retryAt, phase = 'starting', lastError = '', logError = '';
let health = { state: item.health?.type === 'none' ? 'disabled' : 'starting', detail: '等待启动' }, failures = 0, nextHealth = 0, probing = false;
const paths = jarPaths(item);
function info() { return { id, supervision: { active: true, state: phase, attempts, nextRetryAt: retryAt ? new Date(retryAt).toISOString() : undefined, lastError, logError, profile: item.profile || '', pid: process.pid }, health }; }
function serialize(action) { const result = operation.then(action); operation = result.catch(() => {}); return result; }
function cancelRetry() { clearTimeout(retryTimer); retryTimer = undefined; retryAt = undefined; }
function schedule(exit) {
  if (!desired || terminating) return;
  if (exit && exit.code !== 0) lastError = [lastError, exit.code !== null ? `Java 退出码：${exit.code}` : `Java 退出信号：${exit.signal}`].filter(Boolean).join('；');
  const decision = retryDecision(item.restart, attempts, exit, startedAt);
  attempts = decision.attempts; phase = decision.state; retryAt = decision.nextRetryAt;
  health = { state: item.health.type === 'none' ? 'disabled' : 'stopped', detail: 'Java 进程未运行' };
  if (phase === 'backoff') retryTimer = setTimeout(() => { retryTimer = undefined; retryAt = undefined; void serialize(() => attemptStart(false)).catch(error => { lastError = error.message; }); }, Math.max(0, retryAt - Date.now()));
}
async function attemptStart(manual) {
  if (startPromise) return startPromise;
  if (manual) { desired = true; attempts = 0; cancelRetry(); }
  const previous = (await manager.request('statuses'))[0];
  if (previous?.state === 'running') {
    if (currentChild?.pid === previous.pid) return { output: 'JAR 已在运行。', ...info() };
    phase = 'blocked'; desired = false; lastError = '检测到已有 Java 进程，需先停止再重新启动，以恢复日志接收和崩溃监视。';
    throw new Error(lastError);
  }
  startedAt = Date.now(); lastExit = undefined; phase = 'starting'; lastError = ''; failures = 0; nextHealth = 0;
  health = { state: item.health.type === 'none' ? 'disabled' : 'starting', detail: '启动宽限期内' };
  startPromise = (async () => {
    try {
      const result = await manager.request('command', { id, command: 'start' }); phase = 'running';
      return { ...result, ...info() };
    } catch (error) {
      lastError = error.message;
      const current = (await manager.request('statuses'))[0];
      if (current?.state === 'unknown') { phase = 'blocked'; desired = false; }
      else schedule(lastExit);
      if (phase === 'backoff') return { output: `启动失败，将按退避策略重试（${attempts}/${item.restart.maxRetries}）。`, ...info() };
      throw error;
    } finally { startPromise = undefined; }
  })();
  return startPromise;
}
async function closeAfterStop() {
  terminating = true; cancelRetry(); clearInterval(monitor); clearInterval(pruneTimer);
  if (currentDrain) {
    let timer;
    try { await Promise.race([currentDrain, new Promise(resolve => { timer = setTimeout(resolve, 5000); })]); } finally { clearTimeout(timer); }
  }
  await writer?.close(); await manager?.close();
  const record = JSON.parse(await readFile(endpointFile, 'utf8').catch(() => '{}'));
  if (record.token === token) await unlink(endpointFile);
  server.close(); server.closeIdleConnections?.();
}
async function handle(command) {
  if (command === 'status') return info();
  if (command === 'start-result') {
    if (phase === 'running' || phase === 'backoff') return { output: phase === 'running' ? 'JAR 已启动，独立守护已启用。' : `启动失败，等待第 ${attempts} 次重试。`, ...info() };
    throw new Error(lastError || 'JAR 未能启动。');
  }
  if (command === 'health-check') { await checkHealth(true); return info(); }
  if (command === 'start') return attemptStart(true);
  if (command === 'stop' || command === 'force-stop' || command === 'restart') {
    desired = false; cancelRetry(); phase = 'stopping';
    try {
      const result = await manager.request('command', { id, command: command === 'force-stop' ? 'force-stop' : 'stop' });
      phase = 'stopped';
      if (command === 'restart') return attemptStart(true);
      // Remove endpoint before replying, so subsequent edits cannot use an obsolete worker.
      await closeAfterStop(); return { ...result, id, supervision: { active: false, state: 'stopped', attempts }, health: { state: 'stopped', detail: '进程已停止' } };
    } catch (error) { phase = 'blocked'; lastError = error.message; throw error; }
  }
  throw new Error('未知守护命令。');
}
async function checkHealth(force = false) {
  if (probing || item.health.type === 'none' || phase !== 'running' || (!force && Date.now() < nextHealth)) return;
  if (Date.now() - startedAt < item.health.grace * 1000 && !force) return;
  probing = true; const generation = startedAt;
  try {
    const result = await probeHealth(item.health);
    if (generation !== startedAt || phase !== 'running') return;
    failures = result.state === 'healthy' ? 0 : failures + 1;
    health = { ...result, failures, state: result.state === 'unhealthy' && failures < item.health.failures ? 'degraded' : result.state };
    nextHealth = Date.now() + item.health.interval * 1000;
  } finally { probing = false; }
}
try {
  await protectSupervisorFile(endpointFile);
  const shadow = path.join(path.dirname(registry), 'runtime', id); await mkdir(shadow, { recursive: true });
  manager = await createJarManager(shadow, {
    supervised: false,
    captureLogs: true,
    detect: async options => {
      const detected = await detectJava(options);
      return detected.found || !fallbackJava || options.executable ? detected : detectJava({ executable: fallbackJava });
    },
    launch: async (executable, argv, cwd) => {
      if (!writer && item.logMode === 'file') writer = await createJarLogWriter(paths.logPath, item.rotation);
      const inherited = { ...process.env }; delete inherited.ELECTRON_RUN_AS_NODE;
      const child = spawn(executable, argv, { cwd, env: effectiveEnvironment(item, inherited), detached: true, windowsHide: true, shell: false, stdio: ['ignore', item.logMode === 'file' ? 'pipe' : 'ignore', item.logMode === 'file' ? 'pipe' : 'ignore'] });
      currentDrain = new Promise(resolve => child.once('close', resolve));
      let exit;
      for (const stream of [child.stdout, child.stderr].filter(Boolean)) stream.on('data', chunk => {
        stream.pause(); writer.write(chunk).then(() => stream.resume(), error => { logError = error.message; });
      });
      child.once('exit', (code, signal) => { exit = { code, signal }; lastExit = exit;
        if (phase === 'running' && desired) void serialize(async () => { if (currentChild === child && phase === 'running' && desired) schedule(exit); });
      });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      currentChild = child; return { pid: child.pid, exit: () => exit };
    },
  });
  const state = await manager.request('get'); await manager.request('upsert', { revision: state.revision, instance: item });
  // Read normalized policies for registries written before this feature existed.
  Object.assign(item, (await manager.request('get')).instances[0]);
  server = http.createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Connection', 'close');
    if (request.method !== 'POST' || request.url !== '/' || request.headers.authorization !== `Bearer ${token}`) { response.writeHead(403); response.end(JSON.stringify({ error: '拒绝未授权的守护请求。' })); return; }
    const chunks = []; let length = 0;
    try {
      for await (const chunk of request) { length += chunk.length; if (length > 4096) throw new Error('请求过大。'); chunks.push(chunk); }
      const { command } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = command === 'status' ? info() : await serialize(() => handle(command));
      response.end(JSON.stringify(result));
    } catch (error) { response.end(JSON.stringify({ id, error: error.message })); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  await writeFile(endpointFile, JSON.stringify({ ...endpoint, port: server.address().port }), { mode: 0o600 });
  monitor = setInterval(() => {
    if (phase === 'running' && lastExit && desired) { void serialize(async () => { if (phase === 'running' && lastExit && desired) schedule(lastExit); }); return; }
    if (phase === 'running' && startedAt && Date.now() - startedAt >= item.restart.stable * 1000) attempts = 0;
    void checkHealth().catch(error => { health = { state: 'unhealthy', detail: error.message }; });
  }, 1000);
  pruneTimer = setInterval(() => { void writer?.prune().catch(error => { logError = error.message; }); }, 3600000);
  // Autostart and interactive starts use the same serialized lifecycle.
  void serialize(() => attemptStart(false)).catch(error => { lastError = error.message; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void serialize(() => handle('stop')).catch(() => {}); });
} catch (error) {
  await manager?.close().catch(() => {}); await writer?.close().catch(() => {});
  await unlink(endpointFile).catch(() => {}); throw error;
}
