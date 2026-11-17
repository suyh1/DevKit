import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHttpClient, validateHttpRequest } from './http-client.mjs';

test('multipart keeps repeated fields and byte-exact files, and rejects malformed or oversized input', async () => {
  const bytes = Buffer.from([0, 255, 13, 10, 128, 11]);
  const parts = [{ name: 'tag', value: '中文' }, { name: 'tag', value: 'second' }, { name: 'file', file: { name: 'data.bin', data: bytes.toString('base64') } }];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      assert.equal(Number(req.headers['content-length']), body.length);
      const form = await new Response(body, { headers: { 'content-type': req.headers['content-type'] } }).formData();
      assert.deepEqual(form.getAll('tag'), ['中文', 'second']);
      assert.equal(form.get('file').name, 'data.bin');
      assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()), bytes);
      res.end('multipart received');
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`, client = createHttpClient();
  try {
    const reply = await client.send('multipart', { url, method: 'POST', multipart: parts, headers: { 'Content-Type': 'text/plain' } });
    assert.equal(reply.body, 'multipart received');
    for (const form of [[], [{ name: 'bad\r\nheader', value: 'x' }], [{ name: 'tooBig', value: '汉'.repeat(400000) }], [{ name: 'file', file: { name: '../x', data: '' } }], [{ name: 'file', file: { name: 'x', data: 'A' } }]]) {
      assert.throws(() => validateHttpRequest({ url, method: 'POST', multipart: form }), /multipart/);
    }
    assert.throws(() => validateHttpRequest({ url, multipart: parts }), /GET\/HEAD/);
  } finally {
    client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('HTTP methods, raw JSON, headers, no redirects, binary and compressed responses', async () => {
  let redirectHit = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: '/target' }); res.end(); return; }
    if (req.url === '/target') redirectHit++;
    if (req.url === '/binary') { res.setHeader('Content-Type', 'image/png'); res.end(Buffer.from([0, 255, 1])); return; }
    if (req.url === '/gzip') { res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }); res.end(gzipSync('中文响应')); return; }
    const body = []; for await (const chunk of req) body.push(chunk);
    res.writeHead(201, { 'Content-Type': 'application/json', 'Set-Cookie': ['a=1', 'b=2'] }); res.end(JSON.stringify({ method: req.method, body: Buffer.concat(body).toString(), token: req.headers.authorization }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`, client = createHttpClient();
  try {
    const response = await client.send('post', { url, method: 'POST', headers: { Authorization: 'test' }, body: '{"n":9007199254740993}' });
    assert.equal(response.status, 201); assert.equal(JSON.parse(response.body).body, '{"n":9007199254740993}'); assert.equal(JSON.parse(response.body).token, 'test');
    assert.equal(response.headers.filter(([key]) => key.toLowerCase() === 'set-cookie').length, 2);
    assert.equal((await client.send('redirect', { url: url + '/redirect' })).status, 302); assert.equal(redirectHit, 0);
    assert.equal((await client.send('binary', { url: url + '/binary' })).body, 'AP8B');
    assert.equal((await client.send('gzip', { url: url + '/gzip' })).body, '中文响应');
  } finally { client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('absolute timeout/cancel, response budgets and request validation', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/large') { res.end(Buffer.alloc(4_000_001)); return; }
    if (req.url === '/bomb') { res.writeHead(200, { 'content-encoding': 'gzip' }); res.end(gzipSync(Buffer.alloc(4_000_001))); return; }
    // Leave the connection open to test explicit cancellation and absolute timeout.
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`, client = createHttpClient();
  try {
    await assert.rejects(client.send('timeout', { url, timeout: 100 }), /超时/);
    const pending = client.send('cancel', { url }); client.cancel('cancel'); await assert.rejects(pending, /取消/);
    await assert.rejects(client.send('limit', { url: url + '/large' }), /4MB/);
    await assert.rejects(client.send('bomb', { url: url + '/bomb' }), /larger|length|size/i);
    for (const input of [{ url: 'file:///etc/passwd' }, { url: 'http://a:b@localhost' }, { url, method: 'CONNECT' }, { url, method: 'GET', body: 'x' }, { url, headers: { x: 'a\r\nx:y' } }, { url, headers: { 'Transfer-Encoding': 'chunked' } }]) assert.throws(() => validateHttpRequest(input));
  } finally { client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
