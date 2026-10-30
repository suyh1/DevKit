import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, stat, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { normalizePolicies, effectiveEnvironment, probeHealth, retryDecision } from './jar-policies.mjs';
import { createJarLogWriter } from './jar-log-writer.mjs';
import { createJarAutostart, startupDefinition } from './jar-autostart.mjs';

test('HTTP/TCP probes distinguish response codes, redirects, timeouts and closed ports', async () => {
  let status = 200;
  const server = http.createServer((request, response) => {
    if (request.url === '/hang') return;
    response.writeHead(status, status === 302 ? { Location: '/healthy' } : {}); response.end('body is not buffered');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const config = normalizePolicies({ health: { type: 'http', url: `http://127.0.0.1:${port}/`, timeout: 1 } }).health;
  try {
    assert.equal((await probeHealth(config)).state, 'healthy');
    status = 503; assert.match((await probeHealth(config)).detail, /503/);
    status = 302; assert.equal((await probeHealth(config)).state, 'unhealthy');
    assert.match((await probeHealth({ ...config, url: `http://127.0.0.1:${port}/hang` })).detail, /超时/);
    assert.equal((await probeHealth({ ...config, type: 'tcp', host: '127.0.0.1', port })).state, 'healthy');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  assert.equal((await probeHealth({ ...config, type: 'tcp', host: '127.0.0.1', port })).state, 'unhealthy');
});
test('profiles override inherited and shared variables without mutating global environment', () => {
  const policies = normalizePolicies({ env: { APP_MODE: 'base', EMPTY: '' }, profiles: [{ id: 'test', name: '测试', env: { APP_MODE: 'test', TOKEN: 'a=b $x' } }], profile: 'test' });
  const original = { APP_MODE: 'inherited', INHERITED: 'yes' };
  assert.deepEqual({ ...effectiveEnvironment(policies, original) }, { APP_MODE: 'test', EMPTY: '', TOKEN: 'a=b $x', INHERITED: 'yes' });
  assert.equal(original.APP_MODE, 'inherited');
  assert.throws(() => normalizePolicies({ profiles: policies.profiles, profile: 'missing' }), /不存在/);
  assert.throws(() => normalizePolicies({ env: { 'NOT=VALID': 'x' } }), /无效/);
  assert.throws(() => normalizePolicies({ health: { type: 'http', url: 'file:///etc/passwd' } }), /HTTP/);
});
test('restart budget uses exponential backoff, caps delay, resets after stable uptime and excludes clean exits', () => {
  const policy = normalizePolicies({ restart: { enabled: true, delay: 2, maxDelay: 5, maxRetries: 3 } }).restart;
  assert.deepEqual(retryDecision(policy, 0, { code: 7 }, 0, 1000), { state: 'backoff', attempts: 1, nextRetryAt: 3000 });
  assert.equal(retryDecision(policy, 1, { signal: 'SIGKILL' }, 0, 1000).nextRetryAt, 5000);
  assert.equal(retryDecision(policy, 2, { code: 7 }, 0, 1000).nextRetryAt, 6000);
  assert.equal(retryDecision(policy, 3, { code: 7 }, 0, 1000).state, 'exhausted');
  assert.equal(retryDecision(policy, 3, { code: 7 }, 0, 61000).attempts, 1);
  assert.equal(retryDecision(policy, 0, { code: 0 }, 0, 1000).state, 'exited');
});
test('rotation preserves every byte across concurrent writes and bounds each active/archive file', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-log-')), file = path.join(folder, '应用.log');
  const chunks = [Buffer.from('A'.repeat(701)), Buffer.from('B'.repeat(930)), Buffer.from('中文'.repeat(200))];
  const writer = await createJarLogWriter(file, { enabled: true, maxBytes: 500, files: 20, days: 7 });
  try {
    await Promise.all(chunks.map(chunk => writer.write(chunk))); await writer.close();
    const files = (await readdir(folder)).filter(name => name !== '应用.log').sort(); files.push('应用.log');
    const bytes = [];
    for (const name of files) { const target = path.join(folder, name); assert.ok((await stat(target)).size <= 500); bytes.push(await readFile(target)); }
    assert.deepEqual(Buffer.concat(bytes), Buffer.concat(chunks));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test('retention only prunes this log owned archives by days and count, preserving unrelated files', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-log-retain-')), file = path.join(folder, 'app.log');
  const old = `app.log.devkit-1000000000000-00000000-0000-0000-0000-000000000000.log`;
  await writeFile(path.join(folder, old), 'expired'); await utimes(path.join(folder, old), 1, 1);
  await writeFile(path.join(folder, 'other.log'), 'preserve'); await writeFile(path.join(folder, 'app.log.manual.log'), 'preserve');
  const writer = await createJarLogWriter(file, { enabled: true, maxBytes: 100, files: 2, days: 1 });
  try {
    await writer.write(Buffer.alloc(1000, 65)); await writer.close();
    const names = await readdir(folder);
    assert.equal(names.includes(old), false); assert.equal(names.filter(name => name.startsWith('app.log.devkit-')).length, 2);
    assert.equal(await readFile(path.join(folder, 'other.log'), 'utf8'), 'preserve');
    assert.equal(await readFile(path.join(folder, 'app.log.manual.log'), 'utf8'), 'preserve');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test('startup definitions keep exact paths and lifecycle ownership, including special characters', () => {
  const item = { id: '00000000-0000-0000-0000-000000000001', stopTimeout: 15 };
  const win = startupDefinition('D:\\apps\\用户 $x\\instances.json', item, 'boot', 'win32', "C:\\Apps\\O'Brien\\devkit.exe", 'D:\\worker.mjs');
  const decoded = Buffer.from(win.taskArguments.split(' ').pop(), 'base64').toString('utf16le');
  assert.match(decoded, /O''Brien/); assert.match(decoded, /ELECTRON_RUN_AS_NODE/); assert.match(decoded, /用户 \$x/);
  const linux = startupDefinition('/home/test/100% $value/instances.json', item, 'login', 'linux', '/opt/Dev Kit/devkit', '/opt/worker.mjs');
  assert.match(linux.unit, /100%% \$\$value/); assert.match(linux.unit, /KillMode=mixed/); assert.match(linux.unit, /Restart=no/);
});
test('Linux install, mode change, disable and error propagation use owned user units only', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-startup-')), registry = path.join(folder, 'instances.json');
  const item = { id: '00000000-0000-0000-0000-000000000001', stopTimeout: 15 }, calls = [];
  const tool = createJarAutostart(registry, { platform: 'linux', configHome: path.join(folder, 'home'), execute: async (cmd, args) => { calls.push([cmd, ...args]); return { stdout: args.includes('is-enabled') ? 'enabled\n' : '' }; } });
  try {
    assert.equal((await tool.get(item)).enabled, false);
    const enabled = await tool.install(item, 'login'); assert.equal(enabled.enabled, true);
    assert.match(await readFile(enabled.target, 'utf8'), /Managed by DevKit/);
    await tool.install(item, 'boot'); assert.ok(calls.some(call => call[0] === 'loginctl' && call[1] === 'enable-linger'));
    await tool.remove(item); assert.equal((await tool.get(item)).enabled, false);
    const bad = createJarAutostart(registry, { platform: 'linux', configHome: path.join(folder, 'other'), execute: async () => { throw new Error('systemd unavailable'); } });
    await assert.rejects(bad.install(item, 'login'), /unavailable/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
