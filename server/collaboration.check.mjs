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
    for (const module of ['transfer', 'mock', 'whiteboard', 'relay']) {
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
    for (const name of ['transfer', 'mock', 'whiteboard', 'relay']) assert.equal((await post(name + '/list')).status, 401);
    const sample = { role: 'A', name: '测试服务', target: '127.0.0.1', targetPort: port, bind: '127.0.0.1', listenPort: 23456 };
    assert.equal((await post('relay/save', sample, reader)).status, 403);
    const rule = await ok('relay/save', sample);
    assert.equal((await post('relay/detect', rule, first)).status, 403);
    assert.equal((await post('relay/start', { ...rule, mode: 'direct' }, reader)).status, 403);
    assert.equal((await post('relay/save', { ...sample, ...rule, revision: 0 }, second)).status, 409);
    await ok('relay/remove', rule);
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
      const upload = { name: 'from-PC.bin', size: bytes.length, hours: 24, password, resumeToken: randomBytes(32).toString('hex'), sha256: createHash('sha256').update(bytes).digest('hex') };
      const { id } = await ok('transfer/begin', upload, sender);
      assert.equal((await post('transfer/finish', { id }, recipient)).status, 404);
      assert.equal((await post('transfer/finish', { id }, sender)).status, 409);
      const chunks = [bytes.subarray(0, 1048576), bytes.subarray(1048576)];
      await ok('transfer/part', { id, offset: 0, data: chunks[0].toString('base64') }, sender);
      const resumed = await ok('transfer/begin', upload, sender);
      assert.equal(resumed.id, id);
      assert.equal(resumed.offset, chunks[0].length);
      assert.equal((await post('transfer/begin', { ...upload, password: 'wrong' }, sender)).status, 409);
      await ok('transfer/part', { id, offset: resumed.offset, data: chunks[1].toString('base64') }, sender);
      await ok('transfer/finish', { id }, sender);
      assert.equal((await ok('transfer/begin', upload, sender)).complete, true);
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
        { name: 'orders', status: 200, delay: 0, queryKey: 'mode', queryValue: 'generate', body: '', format: 'generated',
          template: '{"items":[{"id":"{{uuid}}","number":"{{index}}","value":"{{price}}"}],"ok":true}', count: 3 },
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
    assert.equal((await ok('mock/read', { id: mock.id }, reader)).history.filter(call => call.status !== 405).length, 3);
    async function generatedOrders() {
      const response = await fetch(url + '?mode=generate', { method: 'POST' });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /application\/json/);
      const { items, ok } = await response.json();
      assert.equal(ok, true);
      assert.deepEqual(items.map(item => item.number), [1, 2, 3]);
      assert.equal(typeof items[0].value, 'number');
      return items[0].id;
    }
    assert.notEqual(await generatedOrders(), await generatedOrders());
    for (const invalid of [{ count: 101 }, { template: '"{{missing}}"' }, { template: '[' }]) {
      assert.equal((await post('mock/save', { ...updated, active: 0, scenarios: [{ ...args.scenarios[2], ...invalid }] }, second)).status, 400);
    }
    const project = '商城';
    const schema = {$defs:{recordId:{type:'integer',minimum:1}},type:'object', properties:{
      id:{$ref:'#/$defs/recordId','x-devkit-request':'request.path.id'}, status:{enum:['new','paid']},
      dates:{type:'array',items:{type:'string',format:'date'},minItems:2,maxItems:2}
    }};
    const selected = await ok('mock/create', {...args, project, scenarios:[
      {...args.scenarios[0], format:'schema', schema:JSON.stringify(schema)},
      {...args.scenarios[0], name:'empty', rules:[{source:'query',key:'mode',value:'empty'}], body:'[]'},
      {...args.scenarios[0], name:'echo', format:'generated', rules:[
        {source:'header',key:'X-Mode',value:'test'}, {source:'body',key:'order.qty',value:'0'}
      ], template:'{"id":"{{request.path.id}}","qty":"{{request.body.order.qty}}","page":"{{request.query.page}}"}',count:1}
    ]});
    const base = origin + '/mock/' + selected.projectKey;
    const endpoint = base + '/orders/42';
    const generated = await (await fetch(endpoint,{method:'POST'})).json();
    assert.equal(generated.id,42);
    assert.ok(['new','paid'].includes(generated.status));
    assert.equal(generated.dates.length,2);
    assert.deepEqual(await (await fetch(endpoint+'?mode=empty',{method:'POST'})).json(),[]);
    const defaultLog = (await ok('mock/read',selected)).history[1];
    assert.match(defaultLog.reason,/mode 未提供/);
    assert.ok(defaultLog.elapsed >= 0);
    const call = await fetch(endpoint+'?page=3&token=private',{method:'POST',headers:{'Content-Type':'application/json','X-Mode':'test',Authorization:'private'},body:'{"order":{"qty":0},"password":"private"}'});
    assert.deepEqual(await call.json(),{id:'42',qty:0,page:'3'});
    const [echo] = (await ok('mock/read',selected)).history;
    assert.equal(echo.path,'/orders/42?page=3');
    assert.equal(echo.headers['x-mode'],'test');
    assert.equal(echo.body,'{"order":{"qty":0}}');
    assert.ok(echo.omitted && echo.replayable);
    assert.ok(!JSON.stringify(echo).includes('private'));

    const dataset = await ok('mock/create',{...args, method:'GET',project,path:'/products',
      dataset:{template:'[{"id":"{{index}}","name":"{{product}}"}]',count:2,writable:true}});
    assert.equal(dataset.projectKey,selected.projectKey);
    const products = base+'/products';
    const seeds = await (await fetch(products)).json();
    assert.equal(seeds.length,2);
    assert.deepEqual(await (await fetch(products+'/2')).json(),seeds[1]);
    const write = (path,method,data) => fetch(products+path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const writes = await Promise.all([write('','POST',{id:3}),write('','POST',{id:4})]);
    assert.deepEqual(writes.map(res=>res.status),[201,201]);
    assert.equal((await write('','POST',{id:3})).status,409);
    assert.equal((await write('/2','PATCH',{price:0})).status,200);
    assert.equal((await (await fetch(products+'/2')).json()).price,0);
    assert.equal((await write('/4','PUT',{stock:8})).status,200);
    assert.equal((await fetch(products+'/3',{method:'DELETE'})).status,204);
    assert.equal((await fetch(products+'/3')).status,404);
    assert.equal((await post('mock/reset',dataset,reader)).status,403);
    assert.equal((await post('mock/create',{...args,project,path:'/products/:id'},first)).status,409);
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
    assert.deepEqual(await (await fetch(products+'/4')).json(),{id:4,stock:8});
    await ok('mock/reset',dataset);
    assert.deepEqual(await (await fetch(products)).json(),seeds);
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
  let store = await createCollabStore(directory);
  let links = await createTransferLinks(directory, dist, store);
  t.after(async () => { await links.close(); await store.close(); });
  assert.deepEqual(links.status(), []);
  const sockets = await Promise.all(Array.from({ length: 4 }, async () => {
    const socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '0.0.0.0', resolve));
    return socket;
  }));
  const ports = sockets.map(socket => socket.address().port);
  const busy = sockets.pop();
  t.after(() => new Promise(resolve => busy.close(resolve)));
  await Promise.all(sockets.map(socket => new Promise(resolve => socket.close(resolve))));
  const [portA, portB, unused, occupied] = ports;
  await links.close();
  // Model a pre-upgrade installation. Saving another port must preserve its existing access mode.
  await writeFile(path.join(directory, 'sharing', 'transfer-links.json'), JSON.stringify([{ port: portB, token: randomBytes(24).toString('hex') }]));
  links = await createTransferLinks(directory, dist, store);
  for (const invalid of [[0], [65536], [1.5], [portA, portA]]) await assert.rejects(links.save(invalid), { status: 400 });
  const configured = await links.save({ ports: [portA, portB], shorten: [] });
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
  assert.equal(configured[0].addresses[0], new URL(configured[0].addresses[0]).origin);
  assert.equal(a.pathname, '/');
  assert.match(b.pathname, /^\/t\/[a-f0-9]{48}\/$/);
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
  for (const route of ['/api/sharing/session', 'portal.html', 'api/projects/state', 'api/whiteboard/list'])
    assert.equal((await fetch(new URL(route, a), { headers: { cookie: alice } })).status, 404);
  assert.equal((await fetch(new URL(a.pathname, b.origin))).status, 404);
  assert.equal((await post(a, '', 'list')).status, 401);
  assert.equal((await post(a, alice, 'send', { text: 'blocked', hours: 1 }, b.origin)).status, 403);
  const { id, publisherKey } = await ok(a, alice, 'send', { text: 'secret', hours: 1, password: 'pickup', rememberPickup: true });
  const proof = { id, key: publisherKey };
  assert.equal((await ok(a, alice, 'recall', proof)).password === 'pickup', true);
  assert.equal((await post(a, alice, 'recall', { id, key: randomBytes(32).toString('hex') })).status, 403);
  assert.equal((await post(a, eve, 'recall', proof)).status, 403);
  const inbox = await ok(b, bob, 'list');
  assert.equal(inbox.some(row => row.protection || row.publisherKey || row.password), false);
  const index = await readFile(path.join(directory, 'collaboration', 'transfer.json'), 'utf8');
  assert.equal(index.includes(publisherKey) || index.includes('"pickup"'), false);
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
  await assert.rejects(links.save({ ports: [portB, unused, occupied], shorten: [portB] }), /已被占用/);
  assert.deepEqual(links.status(), configured);
  assert.equal((await fetch(b.origin)).status, 404);
  await assert.rejects(fetch('http://127.0.0.1:' + unused));
  assert.equal((await ok(a, alice, 'list')).length, 1);
  await links.close();
  await store.close();
  store = await createCollabStore(directory);
  links = await createTransferLinks(directory, dist, store);
  assert.deepEqual(links.status(), configured);
  assert.equal((await ok(a, alice, 'recall', proof)).password === 'pickup', true);
  assert.equal((await ok(b, await client(b), 'list'))[0].id, id);
  await links.save({ ports: [portA, portB], shorten: [portB] });
  assert.equal(links.status()[1].short, true);
  assert.equal((await ok(new URL(b.origin), await client(b.origin), 'list'))[0].id, id);
  assert.equal((await ok(b, bob, 'list'))[0].id, id);
  await links.close();
  links = await createTransferLinks(directory, dist, store);
  assert.equal((await fetch(b.origin)).status, 200);
  assert.equal((await fetch(b)).status, 200);
  await links.save([portB]);
  await assert.rejects(fetch(a));
  await links.save([portA]);
  assert.equal(await (await fetch(a)).text(), 'quick page');
  await links.save([portB]);
  assert.equal((await fetch(b)).status, 404);
  assert.equal((await fetch(b.origin)).status, 200);
  await links.save([]);
  await assert.rejects(fetch(b));
});
