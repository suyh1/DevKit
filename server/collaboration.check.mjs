import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createCollabStore } from './collab-store.mjs';
import { createDirectDirectory } from './direct-transfer.mjs';
import { createTransferLinks } from './transfer-links.mjs';
import { createProjectStore } from './project-store.mjs';
import { createProjectHost } from './project-host.mjs';
import { emptySharingServices } from '../shared/sharing.mjs';

test('a missed sender heartbeat removes its file and pending negotiation', () => {
  let changes = 0;
  const directory = createDirectDirectory(() => { changes++; });
  const now = Date.now();
  const { id } = directory.publish({ id: 'file', expires: now + 3600000 }, 'sender');
  const { key } = directory.claim({ id, offer: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' }, 'receiver');
  directory.sweep(now + 91000);
  assert.deepEqual(directory.rows(), []);
  assert.deepEqual(directory.presence({ ids: [id] }, 'sender'), { ids: [], offers: [] });
  assert.throws(() => directory.answer({ key }, 'receiver'), { status: 404 });
  assert.equal(changes, 2);
});

test('two LAN sessions exchange protected files in both directions, switch Mock scenarios and annotate concurrently', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-collaboration-'));
  let store, manager, host;
  try {
    const dist = path.join(folder, 'dist');
    await mkdir(path.join(dist, '.vite'), { recursive: true });
    await writeFile(path.join(dist, '.vite/manifest.json'), JSON.stringify({ 'portal.html': { file: 'portal.html' } }));
    store = await createProjectStore(folder);
    manager = await createCollabStore(folder);
    host = await createProjectHost(store, dist, { collab: () => manager });
    const services = emptySharingServices(),
      viewer = emptySharingServices();
    for (const module of ['transfer', 'mock', 'whiteboard']) {
      services[module] = { enabled: true, edit: true };
      viewer[module].enabled = true;
    }
    const socket = net.createServer();
    await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const settings = {
      host: '127.0.0.1',
      port,
      password: 'owner-test-only',
      services,
      visitors: [{ name: 'reader', password: 'viewer-test-only', services: viewer }],
    };
    const {
      addresses: [address],
    } = await host.start(settings);
    const origin = new URL(address).origin;
    const post = (route, payload = {}, cookie = '') =>
      fetch(origin + '/api/' + route, {
        method: 'POST',
        headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    const login = async (password, visitor = '') => {
      const res = await post('sharing/login', { visitor, password });
      assert.equal(res.status, 200);
      return res.headers.get('set-cookie').split(';')[0];
    };
    const first = await login(settings.password),
      second = await login(settings.password),
      reader = await login('viewer-test-only', 'reader');
    const ok = async (route, input, cookie = first) => {
      const res = await post(route, input, cookie);
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      return body;
    };
    for (const name of ['transfer', 'mock', 'whiteboard']) assert.equal((await post(name + '/list')).status, 401);
    assert.equal((await post('transfer/send', { text: 'blocked', hours: 1 }, reader)).status, 403);
    const initial = await ok('transfer/list', { sync: true }, reader);
    assert.deepEqual(initial.items, []);
    assert.deepEqual(await ok('transfer/list', { sync: true, version: initial.version }, reader), {
      version: initial.version,
    });
    const password = '取件-hello';
    const meta = { name: 'online.bin', size: 123, hours: 1 };
    assert.equal((await post('transfer/publish', meta)).status, 401);
    assert.equal((await post('transfer/publish', meta, first)).status, 400);
    assert.equal((await post('transfer/publish', { ...meta, password }, reader)).status, 403);
    const listed = await ok('transfer/publish', { ...meta, password });
    assert.equal((await ok('transfer/list', { sync: true, version: initial.version }, reader)).items[0].direct, true);
    assert.equal((await post('transfer/unlock', { ...listed, password: 'wrong' }, reader)).status, 403);
    const offer = 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
    assert.equal((await post('transfer/claim', { ...listed, offer }, reader)).status, 403);
    const pickup = await ok('transfer/unlock', { ...listed, password }, reader);
    assert.equal((await post('transfer/claim', { ...listed, ...pickup, offer }, second)).status, 403);
    const claim = await ok('transfer/claim', { ...listed, ...pickup, offer }, reader);
    assert.equal((await post('transfer/claim', { ...listed, ...pickup, offer }, reader)).status, 403);
    assert.deepEqual((await ok('transfer/presence', { ids: [listed.id] }, second)).offers, []);
    assert.equal((await ok('transfer/presence', { ids: [listed.id] })).offers[0].key, claim.key);
    assert.equal((await post('transfer/reply', { ...claim, answer: offer }, second)).status, 404);
    await ok('transfer/reply', { ...claim, answer: offer });
    assert.equal((await post('transfer/answer', claim, second)).status, 404);
    assert.equal((await ok('transfer/answer', claim, reader)).answer, offer);
    await ok('transfer/remove', listed);
    assert.equal((await post('transfer/answer', claim, reader)).status, 404);
    const departing = await login(settings.password);
    const withdrawn = await ok('transfer/publish', { ...meta, password }, departing);
    await ok('sharing/logout', {}, departing);
    assert.equal(
      (await ok('transfer/list', {}, reader)).some((item) => item.id === withdrawn.id),
      false,
    );
    for (const content of ['only-after-unlock', 'https://example.test/secret-link']) {
      const { id } = await ok('transfer/send', { text: content, hours: 1, password });
      const list = await ok('transfer/list', {}, reader);
      assert.equal(list[0].locked, true);
      assert.doesNotMatch(JSON.stringify(list), /only-after-unlock|secret-link|取件-hello|salt|hash/);
      assert.equal((await post('transfer/unlock', { id, password: 'wrong' }, second)).status, 403);
      assert.deepEqual(await ok('transfer/unlock', { id, password }, reader), { text: content });
    }
    for (const [sender, recipient] of [
      [first, second],
      [second, first],
    ]) {
      const bytes = randomBytes(1024 * 1024 + 17);
      const { id } = await ok(
        'transfer/begin',
        { name: 'from-PC.bin', size: bytes.length, hours: 24, password },
        sender,
      );
      assert.equal((await post('transfer/finish', { id }, recipient)).status, 404);
      assert.equal((await post('transfer/finish', { id }, sender)).status, 409);
      const chunks = [bytes.subarray(0, 1048576), bytes.subarray(1048576)];
      for (const [index, chunk] of chunks.entries())
        await ok('transfer/part', { id, offset: index * 1048576, data: chunk.toString('base64') }, sender);
      await ok('transfer/finish', { id }, sender);
      assert.equal((await post('transfer/read', { id, offset: 0 }, recipient)).status, 403);
      const { ticket } = await ok('transfer/unlock', { id, password }, recipient);
      assert.equal((await post('transfer/read', { id, offset: 0, ticket }, sender)).status, 403);
      const download = (cookie, key) =>
        fetch(origin + '/api/transfer/download/' + id + (key ? '?ticket=' + key : ''), { headers: { Cookie: cookie } });
      assert.equal((await download('', ticket)).status, 401);
      assert.equal((await download(recipient)).status, 403);
      assert.equal((await download(sender, ticket)).status, 403);
      const attachment = await download(recipient, ticket);
      assert.equal(attachment.status, 200);
      assert.equal(attachment.headers.get('content-length'), String(bytes.length));
      assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), bytes);
      for (const [index, chunk] of chunks.entries()) {
        const data = await ok('transfer/read', { id, offset: index * 1048576, ticket }, recipient);
        assert.deepEqual(Buffer.from(data, 'base64'), chunk);
      }
    }
    assert.doesNotMatch(await readFile(path.join(folder, 'collaboration/transfer.json'), 'utf8'), /取件-hello/);
    const bigSize = 513 * 1048576;
    const big = await ok('transfer/begin', { name: 'large.bin', size: bigSize, hours: 1, password });
    if (process.env.DEVKIT_TEST_LARGE_TRANSFER === '1') {
      const chunk = randomBytes(1048576),
        data = chunk.toString('base64');
      const sent = createHash('sha256'),
        received = createHash('sha256');
      for (let offset = 0; offset < bigSize; offset += chunk.length) {
        await ok('transfer/part', { id: big.id, offset, data });
        sent.update(chunk);
      }
      await ok('transfer/finish', big);
      const { ticket } = await ok('transfer/unlock', { ...big, password }, reader);
      const response = await fetch(origin + '/api/transfer/download/' + big.id + '?ticket=' + ticket, {
        headers: { Cookie: reader },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-length'), String(bigSize));
      for await (const piece of response.body) received.update(piece);
      assert.equal(received.digest('hex'), sent.digest('hex'));
      await ok('transfer/remove', big);
    } else await ok('transfer/cancel', big);
    await assert.rejects(readFile(path.join(folder, 'collaboration', 'transfer-' + big.id + '.bin')), {
      code: 'ENOENT',
    });
    const args = {
      name: 'Order',
      method: 'POST',
      path: '/orders/:id',
      active: 0,
      published: true,
      cors: true,
      scenarios: [
        { name: 'fresh', status: 201, delay: 0, body: '{"ok":true}', format: 'json' },
        { name: 'busy', status: 503, delay: 20, queryKey: 'mode', queryValue: 'fail', body: 'retry', format: 'text' },
      ],
    };
    assert.equal((await post('mock/create', args, reader)).status, 403);
    const mock = await ok('mock/create', args);
    const url = origin + '/mock/' + mock.key + '/orders/42';
    const external = await fetch(url, { method: 'POST', headers: { Origin: 'https://example.test' } });
    assert.equal(external.status, 201);
    assert.deepEqual(await external.json(), { ok: true });
    assert.equal(external.headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await fetch(url + '?mode=fail', { method: 'POST' })).status, 503);
    const updated = await ok('mock/save', { ...mock, active: 1 }, second);
    assert.equal((await post('mock/save', mock, first)).status, 409);
    const busy = await fetch(url, { method: 'POST' });
    assert.equal(busy.status, 503);
    assert.equal(await busy.text(), 'retry');
    assert.equal((await ok('mock/read', { id: mock.id }, reader)).history.length, 3);
    await ok('mock/rotate', updated);
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
    const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==';
    const snapshot = await ok('whiteboard/create', { name: 'Screenshot', width: 1, height: 1, image });
    assert.equal(await ok('whiteboard/image', snapshot, reader), image);
    const board = await ok('whiteboard/create', { name: 'Flow', width: 800, height: 600 });
    const mark = {
      tool: 'arrow',
      color: '#ff0000',
      width: 2,
      points: [
        [10, 10],
        [20, 20],
      ],
    };
    await Promise.all([first, second].map((cookie) => ok('whiteboard/mark', { id: board.id, mark }, cookie)));
    const current = await ok('whiteboard/read', { id: board.id }, reader);
    assert.equal(current.marks.length, 2);
    assert.equal((await post('whiteboard/erase', { id: board.id, markId: current.marks[0].id }, reader)).status, 403);
    await ok('whiteboard/erase', { id: board.id, markId: current.marks[0].id });
    assert.equal((await post('whiteboard/remove', board, second)).status, 409);
    await manager.close();
    manager = await createCollabStore(folder);
    assert.equal((await ok('whiteboard/read', { id: board.id })).marks.length, 1);
    assert.equal(
      (await ok('transfer/list', {}, reader)).every((item) => item.locked),
      true,
    );
    assert.equal((await ok('mock/read', { id: mock.id })).active, 1);
  } finally {
    await host?.stop();
    await manager?.close();
    await store?.close();
    await rm(folder, { recursive: true, force: true });
  }
});

test('quick links isolate ports and clients while serving the desktop inbox without the portal', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'devkit-quick-links-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = path.join(directory, 'dist');
  await mkdir(path.join(dist, '.vite'), { recursive: true });
  await writeFile(path.join(dist, '.vite/manifest.json'), JSON.stringify({ 'transfer.html': { file: 'transfer.js' } }));
  await writeFile(path.join(dist, 'transfer.html'), 'quick page');
  await writeFile(path.join(dist, 'transfer.js'), 'quick script');
  const store = await createCollabStore(directory);
  let links = await createTransferLinks(directory, dist, store);
  t.after(async () => { await links.close(); await store.close(); });
  assert.deepEqual(links.status(), []);
  const sockets = await Promise.all(Array.from({ length: 4 }, async () => {
    const socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    return socket;
  }));
  const ports = sockets.map(socket => socket.address().port);
  const busy = sockets.pop();
  t.after(() => new Promise(resolve => busy.close(resolve)));
  await Promise.all(sockets.map(socket => new Promise(resolve => socket.close(resolve))));
  const [portA, portB, unused, occupied] = ports;
  for (const invalid of [[0], [65536], [1.5], [portA, portA]]) await assert.rejects(links.save(invalid), { status: 400 });
  const configured = await links.save([portA, portB]);
  const [a, b] = configured.map(link => {
    const url = new URL(link.addresses[0]);
    url.hostname = '127.0.0.1';
    return url;
  });
  const client = async url => {
    const page = await fetch(url);
    assert.equal(await page.text(), 'quick page');
    return page.headers.get('set-cookie').split(';')[0];
  };
  const alice = await client(a), bob = await client(b), eve = await client(a);
  const post = (url, cookie, action, input = {}, origin = url.origin) => fetch(new URL('api/transfer/' + action, url), {
    method: 'POST', headers: { cookie, origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const ok = async (...args) => {
    const res = await post(...args);
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data;
  };
  assert.equal((await fetch(new URL('transfer.js', a))).status, 200);
  for (const route of ['/', '/api/sharing/session', 'portal.html', 'api/projects/state', 'api/whiteboard/list'])
    assert.equal((await fetch(new URL(route, a), { headers: { cookie: alice } })).status, 404);
  assert.equal((await fetch(new URL(a.pathname, b.origin))).status, 404);
  assert.equal((await post(a, '', 'list')).status, 401);
  assert.equal((await post(a, alice, 'send', { text: 'blocked', hours: 1 }, b.origin)).status, 403);
  const { id } = await ok(a, alice, 'send', { text: 'secret', hours: 1, password: 'pickup' });
  assert.equal((await store.request('transfer', 'list'))[0].id, id);
  assert.equal((await ok(b, bob, 'list'))[0].text, undefined);
  assert.equal((await post(b, bob, 'unlock', { id, password: 'wrong' })).status, 403);
  assert.deepEqual(await ok(b, bob, 'unlock', { id, password: 'pickup' }), { text: 'secret' });
  assert.equal((await post(a, alice, 'remove', { id })).status, 403);
  const direct = await ok(a, alice, 'publish', { name: 'direct', size: 8, hours: 1, password: 'pickup' });
  assert.equal((await post(a, eve, 'remove', direct)).status, 403);
  assert.equal((await post(b, bob, 'remove', direct)).status, 403);
  assert.equal((await post(a, alice, 'remove', direct)).status, 200);
  for (const action of ['links-save', 'links-get', 'sweep']) assert.equal((await post(a, alice, action)).status, 404);
  await assert.rejects(links.save([portB, unused, occupied]), /已被占用/);
  assert.deepEqual(links.status(), configured);
  await assert.rejects(fetch('http://127.0.0.1:' + unused));
  assert.equal((await ok(a, alice, 'list')).length, 1);
  await links.close();
  links = await createTransferLinks(directory, dist, store);
  assert.deepEqual(links.status(), configured);
  assert.equal((await ok(b, await client(b), 'list'))[0].id, id);
  await links.save([portB]);
  await assert.rejects(fetch(a));
  await links.save([portA, portB]);
  assert.equal((await fetch(a)).status, 404);
  assert.equal(await (await fetch(b)).text(), 'quick page');
  await links.save([]);
  await assert.rejects(fetch(b));
});
