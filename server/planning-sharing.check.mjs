import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, realpath, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { createFileShares } from './file-shares.mjs';
import { createProjectHost } from './project-host.mjs';
import { createProjectStore } from './project-store.mjs';
import { createProjectTodos } from './project-todos.mjs';
import { emptySharingServices, sharingServices } from '../shared/sharing.mjs';

async function fixture(work) {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(path.join(temp, 'devkit-planning-sharing-'));
  try { await work(root); }
  finally {
    assert.equal(path.dirname(root), temp);
    assert.ok(path.basename(root).startsWith('devkit-planning-sharing-'));
    await rm(root, { recursive: true, force: true });
  }
}
async function bind() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { port, close: () => new Promise(resolve => server.close(resolve)) };
}
async function freePort() {
  const server = await bind();
  await server.close();
  return server.port;
}
function zipContents(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map();
  while (offset < end) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    const length = bytes.readUInt16LE(offset + 28);
    const local = bytes.readUInt32LE(offset + 42);
    const data = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert.equal(bytes.readUInt16LE(local + 8), 0);
    entries.set(bytes.toString('utf8', offset + 46, offset + 46 + length), bytes.toString('utf8', data, data + bytes.readUInt32LE(offset + 20)));
    offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return entries;
}

test('file shares persist independently, scope browsing and stream valid folder ZIPs', async () => fixture(async root => {
  const files = path.join(root, '资料'), outside = path.join(root, 'private'), configs = path.join(files, 'configs');
  await mkdir(path.join(files, '空目录'), { recursive: true });
  await mkdir(configs);
  await mkdir(outside);
  await writeFile(path.join(files, '报告 #1.txt'), 'shared document');
  await writeFile(path.join(outside, 'secret.txt'), 'private document');
  await writeFile(path.join(configs, 'private.txt'), 'configuration');
  await symlink(outside, path.join(files, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
  let shares = await createFileShares(configs);
  const occupied = await bind();
  try {
    const value = { name: '共享资料', paths: [files, path.join(files, '报告 #1.txt')], enabled: true, published: true, port: await freePort() };
    const result = await shares.request('save', { revision: 0, value });
    const first = result.shares[0], [link] = first.links;
    const second = (await shares.request('save', { revision: result.revision, value: { ...value, name: '另一个共享', port: await freePort(), published: false } })).shares[1];
    assert.equal((await fetch(new URL('/', link))).status, 404);
    assert.match(await (await fetch(link)).text(), /共享资料/);
    const listing = await (await fetch(link + '0/')).text();
    assert.match(listing, /报告 #1\.txt/);
    assert.doesNotMatch(listing, /outside-link|configs/);
    const attachment = await fetch(link + '0/' + encodeURIComponent('报告 #1.txt'));
    assert.match(attachment.headers.get('content-disposition'), /^attachment/);
    assert.equal(await attachment.text(), 'shared document');
    assert.equal(await (await fetch(link + '1')).text(), 'shared document');
    assert.equal((await fetch(link + '0/outside-link/secret.txt')).status, 404);
    assert.equal((await fetch(link + '0/configs/private.txt')).status, 404);
    const zip = await fetch(link + '0/?zip=1');
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    assert.deepEqual(zipContents(Buffer.from(await zip.arrayBuffer())), new Map([
      ['资料/', ''], ['资料/空目录/', ''], ['资料/报告 #1.txt', 'shared document'],
    ]));
    const replaced = path.join(files, '报告 #1.txt');
    await unlink(replaced);
    await mkdir(replaced);
    assert.equal((await fetch(link + '1/?zip=1')).status, 404);
    await rmdir(replaced);
    await writeFile(replaced, 'shared document');
    const revision = shares.get().revision;
    await assert.rejects(shares.request('save', { revision, id: first.id, value: { ...value, port: occupied.port } }), /已被占用/);
    assert.equal(shares.get().revision, revision);
    assert.equal((await fetch(link)).status, 200);
    await shares.request('toggle', { id: first.id, revision, enabled: false });
    assert.equal((await fetch(second.links[0])).status, 200);
    await assert.rejects(fetch(link));
    await shares.close();
    shares = await createFileShares(configs);
    assert.deepEqual(shares.get().shares.map(share => share.running), [false, true]);
    assert.equal((await fetch(second.links[0])).status, 200);
  } finally {
    await shares.close();
    await occupied.close();
  }
}));

test('portal grants download and TODO access independently and serializes concurrent edits', async () => fixture(async root => {
  const configs = path.join(root, 'configs'), dist = path.join(root, 'dist'), file = path.join(root, 'readme.txt');
  await mkdir(path.join(dist, '.vite'), { recursive: true });
  await writeFile(path.join(dist, '.vite/manifest.json'), JSON.stringify({ 'portal.html': { file: 'portal.html' } }));
  await writeFile(file, 'portal download');
  const store = await createProjectStore(configs);
  const todos = await createProjectTodos(configs), files = await createFileShares(configs);
  const host = await createProjectHost(store, dist, { fileShares: () => files, projectTodos: () => todos });
  try {
    const { shares: [share] } = await files.request('save', { revision: 0, value: {
      name: '访客共享', paths: [file], port: await freePort(), enabled: true, published: true,
    } });
    const { selectedId: hiddenId } = await todos.request('save-project', { value: { name: '私有' } });
    const { selectedId: publishedId } = await todos.request('save-project', { value: { name: '合作', published: true } });
    const services = emptySharingServices(), viewer = emptySharingServices();
    services['project-todos'] = { enabled: true, edit: true };
    services['file-shares'].enabled = true;
    viewer['project-todos'].enabled = true;
    const legacy = { ...services };
    delete legacy['project-todos'];
    delete legacy['file-shares'];
    assert.deepEqual(sharingServices({ services: legacy })['project-todos'], { enabled: false, edit: false });
    const { addresses: [address] } = await host.start({ host: '127.0.0.1', port: await freePort(), password: 'owner-test-only', services,
      visitors: [{ name: 'viewer', password: 'viewer-test-only', services: viewer }],
    });
    const origin = new URL(address).origin;
    const post = (route, value, cookie = '') => fetch(origin + '/api/' + route, {
      method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(value),
    });
    async function login(password, visitor = '') {
      const response = await post('sharing/login', { password, visitor });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    }
    const readOnly = await login('viewer-test-only', 'viewer');
    const editor = await login('owner-test-only');
    const browse = origin + '/api/file-shares/browse/' + share.id + '/';
    assert.equal((await fetch(browse)).status, 401);
    assert.equal((await fetch(browse, { headers: { Cookie: readOnly } })).status, 404);
    const published = (await (await post('file-shares/get', {}, editor)).json()).shares[0];
    assert.deepEqual(published.roots, [{ label: 'readme.txt', directory: false }]);
    assert.equal(await (await fetch(browse + '0', { headers: { Cookie: editor } })).text(), 'portal download');
    assert.equal((await post('file-shares/remove', { id: share.id }, editor)).status, 404);
    assert.deepEqual((await (await post('project-todos/get', {}, readOnly)).json()).projects.map(item => item.id), [publishedId]);
    assert.equal((await post('project-todos/save-project', { value: { name: '未授权' } }, readOnly)).status, 403);
    assert.equal((await post('project-todos/delete-project', { projectId: hiddenId, revision: 1 }, editor)).status, 404);
    const task = { projectId: publishedId, revision: 1, value: { title: '共同待办', status: 'doing', priority: 'high', due: '2028-02-29' } };
    const writes = await Promise.all([post('project-todos/save-task', task, editor), post('project-todos/save-task', task, editor)]);
    assert.deepEqual(writes.map(result => result.status).sort(), [200, 409]);
    const reloaded = await createProjectTodos(configs);
    const projects = (await reloaded.request('get')).projects;
    assert.equal(projects.find(item => item.id === publishedId).tasks[0].title, '共同待办');
    assert.equal(projects.find(item => item.id === hiddenId).published, false);
    await post('sharing/logout', {}, editor);
    assert.equal((await fetch(browse, { headers: { Cookie: editor } })).status, 401);
  } finally {
    await host.stop();
    await files.close();
    await todos.close();
    await store.close();
  }
}));
