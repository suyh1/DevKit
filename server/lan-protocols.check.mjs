import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Readable } from 'node:stream';
import { ftpFixture } from '../electron/ftp-fixture.mjs';
import { MockBinding } from '@serialport/binding-mock';
import { openSerial } from './lan-console.mjs';
import { createLanWorkspaces } from './lan-workspaces.mjs';

async function setup(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'devkit-session-'));
  const lan = await createLanWorkspaces(dir);
  t.after(async () => { lan.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, lan };
}
async function listen(t, accept) {
  const server = createServer(accept).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return server.address().port;
}

test('Telnet negotiates interrupted IAC sequences, resizes and writes configured line endings', async t => {
  const { lan } = await setup(t);
  let peer;
  const received = [];
  const port = await listen(t, socket => { peer = socket; socket.on('data', data => received.push(data)); });
  const [host] = await lan.hostRequest('save', { name: 'console', mode: 'telnet', address: '127.0.0.1', port, terminalType: 'vt100', lineEnding: 'cr' });
  const session = await lan.hostRequest('terminal-open', { id: host.id, cols: 100, rows: 40 });
  peer.write(Buffer.from([255,253]));
  await delay(10);
  peer.write(Buffer.from([24,255,250,24,1,255,240,255,253,31,65,13,0,66]));
  let output = '';
  for (let i = 0; i < 60 && !output; i++) {
    await delay(10);
    output += Buffer.from((await lan.hostRequest('terminal-read', session)).data, 'base64').toString();
  }
  assert.equal(output, 'A\rB');
  await lan.hostRequest('terminal-resize', { ...session, cols: 132, rows: 49 });
  await lan.hostRequest('terminal-input', { ...session, text: 'go\r' });
  for (let i = 0; i < 60 && !Buffer.concat(received).includes('go\r\0'); i++) await delay(10);
  const wire = Buffer.concat(received);
  assert.ok(wire.includes('vt100'));
  assert.ok(wire.includes(Buffer.from([255,250,31,0,132,0,49,255,240])));
  assert.ok(wire.includes('go\r\0'));
  await lan.hostRequest('terminal-close', session);
});

test('serial sessions use saved line settings and remain desktop-local', async t => {
  const { lan } = await setup(t);
  const [host] = await lan.hostRequest('save', { mode: 'serial', name: 'line', address: 'com3', baudRate: 9600, dataBits: 7, stopBits: 2, parity: 'odd', flowControl: 'software', lineEnding: 'lf' });
  assert.equal(host.address, 'COM3');
  assert.deepEqual(lan.sharedHosts(false, {}), []);
  MockBinding.createPort('COM3', { echo: true });
  const port = await openSerial(host, MockBinding);
  const input = once(port.stream, 'data');
  await port.input('ok\r');
  assert.equal((await input)[0].toString(), 'ok\n');
  assert.equal(port.stream.settings.baudRate, 9600);
  assert.equal(port.stream.settings.xon, true);
  const close = once(port.stream, 'close');
  port.dispose(); await close;
  await assert.rejects(openSerial({ ...host, address: 'COM4' }, MockBinding), /未发现/);
  await assert.rejects(lan.hostRequest('terminal-open', { id: host.id }, undefined, { token: 'guest', ensureCurrent() {} }), /桌面/);
});

test('passive FTP sessions save login, start directory and transfer files through the workspace', async t => {
  const { lan, dir } = await setup(t);
  const ftp = await ftpFixture(), { port, files } = ftp;
  t.after(() => ftp.close());
  const [host] = await lan.hostRequest('save', { mode: 'ftp', name: 'files', address: '127.0.0.1', port, user: 'reader', password: 'demo', startDirectory: '/incoming' });
  assert.equal(host.hasPassword, true);
  assert.equal(host.password, undefined);
  const session = await lan.hostRequest('file-open', { id: host.id });
  assert.deepEqual(ftp.credentials(), ['reader','demo','/incoming']);
  const listing = await lan.hostRequest('file-list', session);
  assert.equal(listing.entries[0].path, '/incoming/readme.txt');
  const dest = path.join(dir, 'download.txt');
  await lan.hostRequest('file-download', { ...session, path: listing.entries[0].path }, dest);
  assert.equal(await readFile(dest, 'utf8'), 'hello');
  const signal = AbortSignal.timeout(2000);
  const web = { token: 'visitor', ensureCurrent() {} };
  const webFile = await lan.hostRequest('file-open', { id: host.id }, undefined, web);
  let downloaded;
  await lan.hostRequest('file-download', { ...webFile, path: listing.entries[0].path }, { signal, async download(name, stream) {
    assert.equal(name, 'readme.txt');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    downloaded = Buffer.concat(chunks).toString();
  } }, web);
  assert.equal(downloaded, 'hello');
  await lan.hostRequest('file-upload', { ...webFile, path: listing.directory }, {
    name: 'web.txt', input: Readable.from([Buffer.from('visitor')]), signal,
  }, web);
  assert.equal(files.get('/incoming/web.txt').toString(), 'visitor');
  await lan.hostRequest('terminal-close', webFile, undefined, web);
  await writeFile(dest, 'uploaded');
  await lan.hostRequest('file-upload', { ...session, path: listing.directory }, dest);
  assert.equal(files.get('/incoming/download.txt').toString(), 'uploaded');
  await assert.rejects(lan.hostRequest('file-upload', { ...session, path: listing.directory }, dest), /同名/);
  await lan.hostRequest('terminal-close', session);
});
