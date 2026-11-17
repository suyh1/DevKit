import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestSsh } from './ssh-management.mjs';
import { detectJava } from './jar-process.mjs';

function run(file, args, input = '', env = process.env) {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { env, windowsHide: true, timeout: 25_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || stdout || error.message));
      else resolve(stdout);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
const host = { address: '192.168.1.40', user: 'operator', port: 22, platform: process.platform };

test('SSH rejects command/host injection and bounds JAR file access before spawning', async () => {
  const bad = () => assert.fail('invalid request reached OpenSSH');
  await assert.rejects(requestSsh({ host: { ...host, address: '-oProxyCommand=something' }, module: 'jar', action: 'check' }, bad), /主机地址/);
  await assert.rejects(requestSsh({ host: { ...host, user: 'a\nb' }, module: 'jar', action: 'check' }, bad), /用户名/);
  await assert.rejects(requestSsh({ host: { ...host, platform: 'linux' }, module: 'jar', action: 'config-read', target: { path: '/app.jar' }, payload: { name: '../outside.yml' } }, bad), /同目录/);
  assert.equal(await requestSsh({ host: { ...host, platform: 'linux' }, module: 'jar', action: 'check' }, (args, command) => {
    assert.equal(command, 'sh -s');
    assert.ok(args.includes('StrictHostKeyChecking=yes') && args.includes('BatchMode=yes'));
    return 'devkit-ssh\n';
  }), 'SSH 已连接。');
});

test('the SSH payload works in the target shell, preserves file backups, and launches Java outside the command', { timeout: 90_000 }, async context => {
  if (!['win32', 'linux'].includes(process.platform)) return context.skip('Windows or Linux target required');
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-ssh-test-')));
  const home = path.join(folder, 'profile');
  await mkdir(home);
  const windows = process.platform === 'win32';
  const target = { path: path.join(folder, 'test app.jar'), args: ['argument with spaces', "apostrophe'and&symbol"] };
  const execute = async (_args, command, input) => {
    if (!windows) return run('sh', ['-s'], input, { ...process.env, HOME: home });
    const request = JSON.parse(input);
    const testHome = Buffer.from(home).toString('base64');
    request.script = request.script.replace('param($Request)', `param($Request)\nSet-Variable -Name HOME -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${testHome}'))) -Force\n`);
    const [program, ...args] = command.split(' ');
    return run(program, args, JSON.stringify(request));
  };
  const call = (action, payload) => requestSsh({ host, module: 'jar', action, target, payload }, execute);
  const fixture = path.join(folder, 'application.yml');
  try {
    await writeFile(target.path, '');
    await writeFile(fixture, '\uFEFFport: 9000\r\n');
    assert.equal(await call('check'), 'SSH 已连接。');
    assert.equal(await call('validate'), '操作完成。');
    assert.deepEqual((await call('config-list')).files, ['application.yml']);
    const name = 'application.yml';
    const original = await call('config-read', { name });
    assert.equal(original.content, '\uFEFFport: 9000\r\n');
    const saved = await call('config-save', { name, hash: original.hash, content: 'port: 9010\n' });
    assert.equal(await readFile(fixture, 'utf8'), saved.content);
    assert.equal((await call('config-backup', { name })).content, original.content);
    await assert.rejects(call('config-save', { name, hash: original.hash, content: 'nope' }), /Configuration changed/);

    const nginx = { path: fixture, files: [path.join(folder, 'defaults.conf')], prefix: folder };
    await writeFile(nginx.files[0], 'worker_processes 1;');
    const nginxCall = (action, payload) => requestSsh({ host, module: 'nginx', action, target: nginx, payload }, execute);
    assert.deepEqual((await nginxCall('config-list')).files, [nginx.path, ...nginx.files]);
    await assert.rejects(nginxCall('config-read', { name: target.path }), /先登记/);
    assert.equal((await nginxCall('config-read', { name: nginx.files[0] })).content, 'worker_processes 1;');

    const java = await detectJava();
    if (!java.found) { context.diagnostic('Java runtime unavailable, configuration operations verified'); return; }
    const javaBin = path.dirname(java.executable), suffix = windows ? '.exe' : '';
    try { await run(path.join(javaBin, `javac${suffix}`), ['-version']); }
    catch { context.diagnostic('JDK unavailable, configuration operations verified'); return; }
    const source = path.join(folder, 'SshFixture.java');
    await writeFile(source, 'public class SshFixture { public static void main(String[] args) throws Exception { System.out.println(String.join("|", args)); while (true) Thread.sleep(100); } }');
    await run(path.join(javaBin, `javac${suffix}`), ['--release', '8', source]);
    await run(path.join(javaBin, `jar${suffix}`), ['cfe', target.path, 'SshFixture', '-C', folder, 'SshFixture.class']);
    target.executable = java.executable;
    const started = await call('start');
    assert.match(started, /^PID \d+$/);
    assert.equal(await call('status'), started);
    assert.match(await call('log'), /argument with spaces\|apostrophe'and&symbol/);
    await assert.rejects(call('start'), /already running/i);
    assert.notEqual(await call('restart'), started);
    assert.equal(await call('stop'), 'stopped');
    assert.equal(await call('status'), 'stopped');
  } finally {
    if (target.executable) await call('stop').catch(() => {});
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
