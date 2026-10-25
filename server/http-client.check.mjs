import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHttpClient, validateHttpRequest } from './http-client.mjs';

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
