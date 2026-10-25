import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { parseNginx, flattenNginx, editNginxArgs, insertNginx } from '../shared/nginx.mjs';
import { createNginxManager, discoverIncludes } from './nginx-manager.mjs';
import { detectNginx, nginxArgs, processMatches } from './nginx-process.mjs';
import { createNginxConfigSet, nginxStarter } from './nginx-create.mjs';
import { prepareNginxDirectories } from './nginx-directories.mjs';

async function fixture(run, dependencies = {}) {
  // Windows runners may expose TEMP as an 8.3 alias (RUNNER~1). Match the
  // canonical paths returned by the manager, including in process fixtures.
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-nginx-')));
  await mkdir(path.join(dir, 'logs')); await mkdir(path.join(dir, 'conf.d'));
  const main = path.join(dir, 'main.conf'), common = path.join(dir, 'common.conf');
  await writeFile(main, '\uFEFF# 原样保留\r\npid logs/one.pid;\r\nevents { worker_connections 64; }\r\nhttp { server { listen 19081; include common.conf; } }\r\n');
  await writeFile(common, 'location /api/ { proxy_pass http://127.0.0.1:9000; proxy_set_header Host $host; }\n');
  const executable = path.join(dir, process.platform === 'win32' ? 'nginx.exe' : 'nginx');
  await writeFile(executable, 'test fixture');
  const manager = await createNginxManager(path.join(dir, 'configs'), { detect: async () => ({ found: true, executable, pid: 'logs/nginx.pid', output: 'nginx version: nginx/test' }), inspect: async () => null, ...dependencies });
  const add = async (values = {}) => {
    const state = await manager.request('get');
    return manager.request('upsert', { revision: state.revision, instance: { name: '测试实例', main, prefix: dir, files: [common], executable, platform: process.platform, ...values } });
  };
  try { await run({ dir, main, common, executable, manager, add }); }
  finally { await manager.close(); assert.equal(path.dirname(dir), await realpath(tmpdir())); assert.ok(path.basename(dir).startsWith('devkit-nginx-')); await rm(dir, { recursive: true, force: true }); }
}

test('span editing preserves BOM, CRLF, comments, repeated directives, quoted delimiters and variables', () => {
  const original = '\uFEFF# header\r\nhttp { # keep\r\n server { listen 80; location ~ "^/a{2}#b;" {\r\n proxy_pass http://${backend}/; # comment\r\n proxy_set_header Host $host; proxy_set_header X-Test "a;#{}";\r\n } }\r\n}\r\n';
  const nodes = flattenNginx(parseNginx(original));
  const target = nodes.find(node => node.name === 'proxy_pass');
  const changed = editNginxArgs(original, target, 'http://127.0.0.1:9001/');
  assert.equal(changed, original.replace('http://${backend}/', 'http://127.0.0.1:9001/'));
  assert.equal(nodes.filter(node => node.name === 'proxy_set_header').length, 2);
  assert.equal(nodes.find(node => node.name === 'location').values[1], '^/a{2}#b;');
  assert.throws(() => editNginxArgs(original, target, 'http://safe; include /tmp/other'), /字段只填写参数/);
  assert.throws(() => editNginxArgs(original, target, 'http://safe # discarded'), /字段只填写参数|分号/);
});
test('nested insertion and deletion retain unrelated syntax; malformed syntax never enters field mode', () => {
  const source = 'http {\n    server { listen 80; }\n}\n';
  const inserted = insertNginx(source, parseNginx(source)[0], 'server { listen 81; }');
  assert.equal(parseNginx(inserted)[0].children.length, 2);
  for (const invalid of ['http {', 'listen 80', 'http {} }', 'root "unclosed;', ';', 'a ${broken;']) assert.throws(() => parseNginx(invalid));
});
test('include discovery handles main-relative nested includes, globs, cycles and missing paths', async () => fixture(async ({ dir, main, common }) => {
  await writeFile(main, 'include conf.d/*.conf; include common.conf; include missing.conf;');
  await writeFile(path.join(dir, 'conf.d', 'a.conf'), 'include common.conf;');
  await writeFile(common, 'include main.conf;');
  const result = await discoverIncludes(main);
  assert.deepEqual(new Set(result.files), new Set([path.join(dir, 'conf.d', 'a.conf'), common]));
  assert.equal(result.warnings.length, 1); assert.match(result.warnings[0], /missing.conf/);
}));
test('registration, shared attachments, revision conflicts and restart persistence', async () => fixture(async ({ dir, main, manager, add }) => {
  const state = await add(), id = state.instances[0].id;
  await assert.rejects(add(), /已登记/);
  await assert.rejects(manager.request('remove', { id, revision: -1 }), /已改变/);
  await writeFile(path.join(dir, 'linux.conf'), 'events {}');
  const next = await add({ main: path.join(dir, 'linux.conf'), platform: process.platform === 'win32' ? 'linux' : 'win32' });
  const statuses = await manager.request('statuses');
  assert.equal(statuses.find(item => item.id !== id).state, 'platform');
  assert.equal(next.instances.length, 2);
  const persisted = JSON.parse(await readFile(path.join(dir, 'configs/nginx/instances.json'), 'utf8'));
  assert.equal(persisted.instances[0].main, main);
  await assert.rejects(createNginxManager(path.join(dir, 'configs')), /另一实例/);
}));
test('saving is restricted to registered files and rejects stale hashes before changing any file', async () => fixture(async ({ main, common, manager, add }) => {
  const state = await add(), id = state.instances[0].id;
  const { files } = await manager.request('documents', { id });
  await writeFile(common, '# external\n');
  await assert.rejects(manager.request('save-files', { id, files: files.map(doc => ({ ...doc, content: doc.content + '# changed\n' })) }), /外部修改/);
  assert.equal(await readFile(main, 'utf8'), files[0].content);
  await assert.rejects(manager.request('save-files', { id, files: [{ path: path.join(path.dirname(main), 'unregistered.conf'), content: 'events {}', hash: '' }] }), /已登记/);
  await assert.rejects(manager.request('save-files', { id, files: [{ ...files[0], content: 'http {' }] }), /缺少/);
  assert.equal(await readFile(main, 'utf8'), files[0].content);
}));
test('save backs up exact original bytes, supports preview recovery, and keeps unrelated files untouched', async () => fixture(async ({ main, common, manager, add }) => {
  const state = await add(), id = state.instances[0].id;
  const { files } = await manager.request('documents', { id });
  const changed = files[0].content.replace('19081', '19082');
  const result = await manager.request('save-files', { id, files: [{ ...files[0], content: changed }] });
  assert.equal(await readFile(main, 'utf8'), changed);
  assert.equal(await readFile(common, 'utf8'), files[1].content);
  assert.deepEqual(await readFile(path.join(result.backup, '0.conf')), Buffer.from(files[0].content));
  const backups = await manager.request('backups', { id }); assert.equal(backups.length, 1);
  const restored = await manager.request('backup-files', { id, backupId: backups[0].id });
  assert.equal(restored.files[0].content, files[0].content);
  await assert.rejects(manager.request('backup-files', { id, backupId: '../../outside' }), /编号无效/);
  assert.equal(result.files[0].hash.length, 64);
  assert.equal((await readdir(path.dirname(main))).some(file => file.endsWith('.tmp')), false);
}));
test('a failed config test prevents starting and reloading; shell fragments remain plain argv', async () => {
  let calls = [], launched = false;
  await fixture(async ({ manager, add }) => {
    const id = (await add()).instances[0].id;
    const result = await manager.request('command', { id, command: 'start' });
    assert.equal(result.ok, false); assert.equal(launched, false); assert.equal(calls.length, 1); assert.ok(calls[0].includes('-t'));
    await assert.rejects(manager.request('command', { id, command: 'evil' }), /未知/);
  }, { run: async (_exe, args) => { calls.push(args); return { ok: false, output: 'invalid nginx directive' }; }, launch: async () => { launched = true; } });
  const argv = nginxArgs({ main: 'D:/path with spaces/a & b.conf', prefix: 'D:/nginx prefix' }, 'stop');
  assert.deepEqual(argv, ['-p', 'D:/nginx prefix/', '-c', 'D:/path with spaces/a & b.conf', '-s', 'quit']);
});

test('runtime preparation creates nested log, PID, temporary and cache directories from actual includes only', async () => fixture(async ({ dir, main, common, manager, add }) => {
  const external = path.join(dir, 'absolute logs');
  const quote = value => JSON.stringify(value.replaceAll('\\', '/'));
  await writeFile(main, `pid run/deep/master.pid; error_log ${quote(path.join(external, 'errors/deep/error.log'))}; events {} http { access_log logs/deep/access.log; include conf.d/runtime.conf; }`);
  await writeFile(path.join(dir, 'conf.d/runtime.conf'), 'client_body_temp_path temp/request/body; proxy_temp_path temp/proxy 1 2; proxy_cache_path cache/deep/proxy keys_zone=app:1m; include conf.d/nested.conf;');
  await writeFile(path.join(dir, 'conf.d/nested.conf'), 'server { include common.conf; }');
  await writeFile(common, 'location /api/ { fastcgi_temp_path temp/fastcgi; uwsgi_temp_path temp/uwsgi; scgi_temp_path temp/scgi; }');
  const unused = path.join(dir, 'unused.conf'); await writeFile(unused, 'error_log unused-should-not-exist/error.log;');
  const id = (await add({ files: [common, unused] })).instances[0].id;
  const result = await manager.request('command', { id, command: 'test' });
  assert.equal(result.ok, true); assert.match(result.output, /已自动创建运行目录/);
  for (const name of ['run/deep', 'logs/deep', 'temp/request/body', 'temp/proxy', 'cache/deep/proxy', 'temp/fastcgi', 'temp/uwsgi', 'temp/scgi']) assert.ok((await readdir(path.join(dir, name))).length === 0);
  assert.deepEqual(await readdir(path.join(external, 'errors/deep')), []);
  assert.equal((await readdir(dir)).includes('unused-should-not-exist'), false);
  const next = await manager.request('command', { id, command: 'test' }); assert.deepEqual(next.createdDirectories, []);
}, { run: async () => ({ ok: true, output: 'test ok' }) }));

test('runtime preparation preserves existing content and refuses directories occupied by files before launching', async () => {
  let calls = 0, launched = false;
  await fixture(async ({ dir, main, manager, add }) => {
    await writeFile(main, 'pid logs/one.pid; error_log logs/deep/error.log; events {} http { client_body_temp_path blocked/body; }');
    await writeFile(path.join(dir, 'logs/keep.log'), 'keep exact bytes'); await writeFile(path.join(dir, 'blocked'), 'not a directory');
    const id = (await add()).instances[0].id;
    const result = await manager.request('command', { id, command: 'start' });
    assert.equal(result.ok, false); assert.match(result.output, /无法自动创建运行目录/); assert.ok(result.output.includes(path.join(dir, 'blocked/body')));
    assert.equal(calls, 0); assert.equal(launched, false);
    assert.equal(await readFile(path.join(dir, 'blocked'), 'utf8'), 'not a directory');
    assert.equal(await readFile(path.join(dir, 'logs/keep.log'), 'utf8'), 'keep exact bytes');
    assert.ok(result.createdDirectories.includes(path.join(dir, 'logs/deep')));
  }, { run: async () => { calls++; return { ok: true }; }, launch: async () => { launched = true; } });
});

test('directory planning ignores non-file logs, dynamic paths, data maps, certificates and missing include inputs', async () => fixture(async ({ dir, main, manager, add }) => {
  const original = 'pid logs/one.pid; error_log stderr; events {} http { access_log off; map $host $dir { error_log map-is-data/error.log; } server { access_log "dynamic/$host/access.log"; ssl_certificate certs/missing.pem; root frontend/dist; } }';
  await writeFile(main, original); const id = (await add()).instances[0].id;
  const result = await manager.request('command', { id, command: 'test' });
  assert.equal(result.ok, false); assert.match(result.output, /含变量/);
  for (const name of ['off', 'stderr', 'map-is-data', 'dynamic', 'certs', 'frontend']) assert.equal((await readdir(dir)).includes(name), false);
  assert.equal(await readFile(main, 'utf8'), original);
  await writeFile(main, 'pid brand-new/run.pid; error_log planned/log/error.log; include missing/input.conf;');
  const missing = await manager.request('command', { id, command: 'test' }); assert.equal(missing.ok, false); assert.match(missing.output, /引用的配置文件不存在/);
  assert.equal((await readdir(dir)).includes('planned'), false); assert.equal((await readdir(dir)).includes('brand-new'), false);
}, { run: async () => ({ ok: false, output: 'missing certificate input' }) }));

test('compiled default directory repair is demand-driven and rejects paths outside the known defaults', async () => {
  let calls = 0;
  await fixture(async ({ dir, main, manager, add }) => {
    await writeFile(main, 'pid logs/one.pid; events {} http { server { listen 18080; } }');
    const id = (await add()).instances[0].id;
    const result = await manager.request('command', { id, command: 'test' });
    assert.equal(result.ok, true); assert.equal(calls, 2); assert.deepEqual(await readdir(path.join(dir, 'build-default/temp/body')), []);
    assert.equal((await readdir(dir)).includes('unused-build-cache'), false);
  }, {
    detect: async ({ executable }) => ({ found: true, executable, pid: 'logs/one.pid', output: "configure arguments: --http-client-body-temp-path='build-default/temp/body' --http-proxy-temp-path=unused-build-cache/proxy" }),
    run: async (_exe, _args, prefix) => (++calls === 1 ? { ok: false, output: `nginx: [emerg] CreateDirectory() "${path.join(prefix, 'build-default/temp/body').replaceAll('\\', '/')}" failed (3: missing path)` } : { ok: true, output: 'ok' }),
  });
  await fixture(async ({ dir, manager, add }) => {
    const id = (await add()).instances[0].id;
    const result = await manager.request('command', { id, command: 'test' }); assert.equal(result.ok, false);
    assert.equal((await readdir(dir)).includes('unexpected'), false);
  }, { run: async (_exe, _args, prefix) => ({ ok: false, output: `nginx: [emerg] mkdir() "${path.join(prefix, 'unexpected/deep')}" failed (2: No such file)` }) });
});

test('directory permission failures identify the path and keep existing files and partial directory results', async () => fixture(async ({ dir, main }) => {
  await writeFile(main, 'pid logs/one.pid; error_log protected/deep/error.log; events {}');
  await assert.rejects(prepareNginxDirectories({ main, prefix: dir, pidPath: path.join(dir, 'logs/one.pid') }, {
    readConfig: async filename => ({ content: await readFile(filename, 'utf8') }),
    makeDirectory: async (directory, options) => {
      if (directory.includes(`${path.sep}protected${path.sep}`)) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return mkdir(directory, options);
    },
  }), error => error.message.includes(path.join(dir, 'protected/deep')) && error.message.includes('EACCES') && Array.isArray(error.createdDirectories));
  assert.equal((await readdir(dir)).includes('protected'), false);
}));
test('PID reuse or shared PID files never authorize signaling another config; changing identity while running is blocked', async () => {
  let info, calls = 0;
  await fixture(async ({ dir, main, executable, manager, add }) => {
    const state = await add(), instance = state.instances[0], id = instance.id;
    await writeFile(path.join(dir, 'logs/one.pid'), '4242');
    info = { pid: 4242, executable, commandLine: `"${executable}" -p "${dir}" -c "${path.join(dir, 'other.conf')}"` };
    assert.equal((await manager.request('statuses'))[0].state, 'unknown');
    await assert.rejects(manager.request('command', { id, command: 'stop' }), /无法确认/); assert.equal(calls, 0);
    info.commandLine = `"${executable}" -p "${dir}" -c "${main}"`;
    assert.equal((await manager.request('statuses'))[0].state, 'running');
    const files = (await manager.request('documents', { id })).files;
    await assert.rejects(manager.request('save-files', { id, files: [{ ...files[0], content: files[0].content.replace('one.pid', 'two.pid') }] }), /先停止/);
    await assert.rejects(manager.request('upsert', { revision: state.revision, instance: { ...instance, prefix: path.join(dir, 'logs') } }), /先确认实例停止/);
    const reload = await manager.request('command', { id, command: 'reload' });
    assert.equal(reload.ok, false); assert.equal(calls, 1);
    assert.equal(processMatches(instance, { ...info, commandLine: info.commandLine.replace(main, main + '.other') }), false);
  }, { inspect: async () => info, run: async () => { calls++; return { ok: false, output: 'test failed' }; } });
});
test('an unavailable executable can be corrected in instance settings', async () => fixture(async ({ executable, manager, add }) => {
  const state = await add({ executable: '' });
  const result = await manager.request('upsert', { revision: state.revision, instance: { ...state.instances[0], executable } });
  assert.equal(result.instances[0].executable, executable);
}, { detect: async () => ({ found: false, output: '未检测到 nginx' }) }));
test('identity edits to a shared attachment respect every registered instance using that file', async () => {
  let info;
  await fixture(async ({ dir, common, executable, manager, add }) => {
    const id = (await add()).instances[0].id;
    const secondMain = path.join(dir, 'second.conf'); await writeFile(secondMain, 'pid logs/two.pid; events {}');
    await add({ name: '共享文件的运行实例', main: secondMain });
    await writeFile(path.join(dir, 'logs/two.pid'), '4243');
    info = { pid: 4243, executable, commandLine: `"${executable}" -c "${secondMain}"` };
    const doc = (await manager.request('documents', { id })).files.find(doc => doc.path === common);
    await assert.rejects(manager.request('save-files', { id, files: [{ ...doc, content: doc.content + 'include more.conf;\n' }] }), /共享文件的运行实例/);
    assert.equal(await readFile(common, 'utf8'), doc.content);
  }, { inspect: async () => info });
});
test('UTF-16 and binary inputs are not silently rewritten as UTF-8', async () => fixture(async ({ main, manager, add }) => {
  const id = (await add()).instances[0].id;
  await writeFile(main, Buffer.from([0xff, 0xfe, 0x61, 0, 0x3b, 0]));
  const result = await manager.request('documents', { id });
  assert.ok(result.warnings.some(warning => warning.includes('UTF-8')));
}));
test('an empty PID file created by nginx -t is stopped; corrupt nonempty PID files remain blocked', async () => fixture(async ({ dir, manager, add }) => {
  await add(); const file = path.join(dir, 'logs/one.pid');
  await writeFile(file, ''); assert.equal((await manager.request('statuses'))[0].state, 'stopped');
  await writeFile(file, 'invalid'); assert.equal((await manager.request('statuses'))[0].state, 'unknown');
}));

test('new sets create both editable configs, a valid include, page and local runtime directories on either target OS', async () => fixture(async ({ dir, manager }) => {
  for (const platform of ['win32', 'linux']) {
    const directory = path.join(dir, platform); await mkdir(directory);
    const state = await manager.request('create', { revision: (await manager.request('get')).revision, name: platform, platform, directory, mainName: 'main config.conf', commonName: 'common proxy.conf', port: 18080 });
    const instance = state.instances.at(-1);
    assert.equal(instance.prefix, directory); assert.equal(instance.platform, platform);
    assert.deepEqual(instance.files, [path.join(directory, 'common proxy.conf')]);
    const docs = await manager.request('documents', { id: instance.id }); assert.equal(docs.files.length, 2);
    assert.match(docs.files[0].content, /listen 127\.0\.0\.1:18080/); assert.doesNotThrow(() => docs.files.forEach(doc => parseNginx(doc.content)));
    assert.deepEqual((await discoverIncludes(instance.main)).files, instance.files);
    assert.match(await readFile(path.join(directory, 'html/index.html'), 'utf8'), /Nginx ready/);
    assert.ok((await readdir(directory)).includes('logs')); assert.ok((await readdir(directory)).includes('temp'));
  }
}));
test('creation refuses collisions, invalid names, directory traversal and stale revisions without touching existing content', async () => fixture(async ({ dir, manager }) => {
  const directory = path.join(dir, 'new'); await mkdir(directory);
  const base = { revision: 0, name: 'new', platform: process.platform, directory };
  await writeFile(path.join(directory, 'common_proxy.conf'), 'preserve');
  await assert.rejects(manager.request('create', base), /已存在/);
  assert.deepEqual(await readdir(directory), ['common_proxy.conf']);
  assert.equal(await readFile(path.join(directory, 'common_proxy.conf'), 'utf8'), 'preserve');
  for (const mainName of ['../outside.conf', 'x/y.conf', 'CON.conf', 'nginx.txt']) await assert.rejects(manager.request('create', { ...base, mainName }), /文件名/);
  assert.throws(() => nginxStarter({ mainName: 'SAME.conf', commonName: 'same.conf' }), /不能同名/);
  await assert.rejects(manager.request('create', { ...base, port: 65536 }), /监听端口/);
  await assert.rejects(manager.request('create', { ...base, revision: -1 }), /已改变/);
  assert.equal((await manager.request('get')).instances.length, 0);
}));
test('creation rollback removes only its own new files and preserves an existing homepage and unrelated content', async () => fixture(async ({ dir }) => {
  const directory = path.join(dir, 'rollback'); await mkdir(directory); await mkdir(path.join(directory, 'html'));
  await writeFile(path.join(directory, 'html/index.html'), 'existing page'); await writeFile(path.join(directory, 'keep.txt'), 'keep');
  await assert.rejects(createNginxConfigSet(directory, {}, async () => { throw new Error('registration failed'); }), /registration failed/);
  assert.deepEqual((await readdir(directory)).sort(), ['html', 'keep.txt']);
  assert.equal(await readFile(path.join(directory, 'html/index.html'), 'utf8'), 'existing page');
  await assert.rejects(createNginxConfigSet(directory, {}, async ({ main }) => { await writeFile(main, 'external change'); throw new Error('registration failed'); }), /已保留/);
  assert.equal(await readFile(path.join(directory, 'nginx.conf'), 'utf8'), 'external change');
}));
test('creation never writes through existing runtime directory links', async () => fixture(async ({ dir }) => {
  const directory = path.join(dir, 'link-root'), outside = path.join(dir, 'outside'); await mkdir(directory); await mkdir(outside);
  await symlink(outside, path.join(directory, 'html'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createNginxConfigSet(directory, {}, async () => {}), /链接占用/);
  assert.deepEqual(await readdir(outside), []); assert.deepEqual(await readdir(directory), ['html']);
}));

async function unusedPort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
test('real nginx: isolated prefix, syntax test, start, HTTP response, reload and graceful stop', { skip: !process.env.DEVKIT_NGINX_TEST_EXECUTABLE, timeout: 45000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-nginx-real-')));
  const executable = process.env.DEVKIT_NGINX_TEST_EXECUTABLE, main = path.join(dir, 'nginx.conf'), port = await unusedPort();
  const original = `worker_processes 1;\npid logs/real.pid;\nerror_log logs/error.log;\nevents { worker_connections 32; }\nhttp { access_log off; server { listen 127.0.0.1:${port}; location / { return 200 "before"; } } }\n`;
  await writeFile(main, original);
  const manager = await createNginxManager(path.join(dir, 'configs'));
  let id;
  try {
    assert.equal((await detectNginx({ executable })).found, true);
    const state = await manager.request('upsert', { revision: 0, instance: { name: 'real', main, prefix: dir, files: [], executable, platform: process.platform } }); id = state.instances[0].id;
    const checked = await manager.request('command', { id, command: 'test' }); assert.equal(checked.ok, true, JSON.stringify(checked));
    assert.ok(checked.createdDirectories.includes(path.join(dir, 'logs')));
    assert.ok((await readdir(dir)).includes('temp') || (await readdir(dir)).includes('client_body_temp'));
    const start = await manager.request('command', { id, command: 'start' }); assert.equal(start.ok, true, JSON.stringify(start));
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'before');
    const doc = (await manager.request('documents', { id })).files[0];
    await manager.request('save-files', { id, files: [{ ...doc, content: original.replace('before', 'after') }] });
    const reload = await manager.request('command', { id, command: 'reload' }); assert.equal(reload.ok, true, JSON.stringify(reload));
    let text;
    for (let index = 0; index < 40; index++) { text = await (await fetch(`http://127.0.0.1:${port}/`, { headers: { Connection: 'close' } })).text(); if (text === 'after') break; await delay(100); }
    assert.equal(text, 'after');
    const stop = await manager.request('command', { id, command: 'stop' }); assert.equal(stop.ok, true, JSON.stringify(stop));
    assert.equal((await manager.request('statuses'))[0].state, 'stopped');
  } finally {
    if (id && (await manager.request('statuses'))[0]?.state === 'running') await manager.request('command', { id, command: 'stop' });
    await manager.close(); assert.equal(path.dirname(dir), await realpath(tmpdir())); await rm(dir, { recursive: true, force: true });
  }
});

test('real nginx: a generated two-file set in a directory with spaces starts and serves its homepage', { skip: !process.env.DEVKIT_NGINX_TEST_EXECUTABLE, timeout: 45000 }, async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-nginx-new space-')));
  const manager = await createNginxManager(path.join(directory, 'configs'));
  let id;
  try {
    const port = await unusedPort();
    const result = await manager.request('create', { revision: 0, name: 'generated', platform: process.platform, executable: process.env.DEVKIT_NGINX_TEST_EXECUTABLE, directory, mainName: 'nginx main.conf', commonName: 'common proxy.conf', port });
    id = result.instances[0].id;
    const checked = await manager.request('command', { id, command: 'test' }); assert.equal(checked.ok, true, checked.output);
    const started = await manager.request('command', { id, command: 'start' }); assert.equal(started.ok, true, started.output);
    assert.match(await (await fetch(`http://127.0.0.1:${port}/`, { headers: { Connection: 'close' } })).text(), /Nginx ready/);
    assert.equal((await manager.request('command', { id, command: 'stop' })).ok, true);
  } finally {
    if (id && (await manager.request('statuses'))[0]?.state === 'running') await manager.request('command', { id, command: 'stop' });
    await manager.close(); assert.equal(path.dirname(directory), await realpath(tmpdir())); await rm(directory, { recursive: true, force: true });
  }
});

test('real nginx: direct start and reload prepare absolute log parents and included temporary paths without changing configs', { skip: !process.env.DEVKIT_NGINX_TEST_EXECUTABLE, timeout: 45000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'devkit-nginx-dirs-')));
  const prefix = path.join(dir, 'runtime prefix'), config = path.join(dir, 'configuration'), logs = path.join(config, 'custom logs');
  await mkdir(config);
  const main = path.join(config, 'main.conf'), common = path.join(config, 'runtime.conf'), port = await unusedPort();
  const quote = value => JSON.stringify(value.replaceAll('\\', '/'));
  const original = `worker_processes 1; pid ${quote(path.join(logs, 'pid/master.pid'))}; error_log ${quote(path.join(logs, 'errors/error.log'))}; events { worker_connections 32; } http { include runtime.conf; server { listen 127.0.0.1:${port}; location / { return 200 "before"; } } }`;
  const included = `access_log ${quote(path.join(logs, 'access/access.log'))}; client_body_temp_path temp/nested/body; proxy_temp_path temp/nested/proxy;`;
  await writeFile(main, original); await writeFile(common, included);
  const manager = await createNginxManager(path.join(dir, 'configs'));
  let id;
  try {
    const state = await manager.request('upsert', { revision: 0, instance: { name: 'directory preparation', main, prefix, files: [common], executable: process.env.DEVKIT_NGINX_TEST_EXECUTABLE, platform: process.platform } });
    id = state.instances[0].id;
    assert.equal((await readdir(dir)).includes('runtime prefix'), false, 'Registration does not create the runtime directory');
    const started = await manager.request('command', { id, command: 'start' }); assert.equal(started.ok, true, started.output);
    assert.ok(started.createdDirectories.includes(prefix));
    assert.ok(started.createdDirectories.includes(path.join(logs, 'errors')));
    assert.ok(started.createdDirectories.includes(path.join(prefix, 'temp/nested/body')));
    assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'before');
    assert.equal(await readFile(main, 'utf8'), original); assert.equal(await readFile(common, 'utf8'), included);
    const docs = (await manager.request('documents', { id })).files;
    await manager.request('save-files', { id, files: docs.map(doc => ({ ...doc, content: doc.path === main ? original.replace('before', 'after') : included.replace('access/access.log', 'reload/deep/access.log') })) });
    const reloaded = await manager.request('command', { id, command: 'reload' }); assert.equal(reloaded.ok, true, reloaded.output);
    assert.ok(reloaded.createdDirectories.includes(path.join(logs, 'reload/deep')));
    let body;
    for (let attempt = 0; attempt < 40; attempt++) { body = await (await fetch(`http://127.0.0.1:${port}/`, { headers: { Connection: 'close' } })).text(); if (body === 'after') break; await delay(100); }
    assert.equal(body, 'after'); assert.equal((await manager.request('command', { id, command: 'stop' })).ok, true);
  } finally {
    if (id && (await manager.request('statuses'))[0]?.state === 'running') await manager.request('command', { id, command: 'stop' });
    await manager.close(); assert.equal(path.dirname(dir), await realpath(tmpdir())); assert.ok(path.basename(dir).startsWith('devkit-nginx-dirs-')); await rm(dir, { recursive: true, force: true });
  }
});
