import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { createRelay } from './relay.mjs';
import { tcp } from './relay-transport.mjs';

async function bind(server) {
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return server.address().port;
}
async function freePort() {
  const server = net.createServer();
  const port = await bind(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}
function fixture() {
  const relay = createRelay(undefined, () => {});
  let rows = [];
  return { ...relay, call(action, input) { return relay.request({ rows, action, input, access: { owner:'test' }, commit: async next => { rows = next; } }); } };
}
function relaySocket(client, targetPort) {
  const remote = net.connect(targetPort, '127.0.0.1');
  remote.on('error', () => client.destroy());
  client.on('error', () => remote.destroy());
  client.pipe(remote); remote.pipe(client);
  client.on('close', () => remote.destroy());
}

test('capabilities negotiate a fixed target through HTTP CONNECT and SOCKS5 and keep TCP bytes intact', async t => {
  const echo = net.createServer(s => s.pipe(s)), targetPort = await bind(echo);
  const httpProxy = http.createServer(), httpPort = await bind(httpProxy);
  httpProxy.on('connect',(req, socket) => {
    if (req.url !== '127.0.0.1:' + targetPort) return socket.destroy();
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    relaySocket(socket, targetPort);
  });
  const socksProxy = net.createServer(s => {
    s.once('data', () => {
      s.write(Buffer.from([5,0]));
      s.once('data', request => {
        if (request.readUInt16BE(request.length - 2) !== targetPort) return s.destroy();
        s.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));
        relaySocket(s, targetPort);
      });
    });
  }), socksPort = await bind(socksProxy);
  const fixtureData = fixture();
  t.after(() => { fixtureData.close(); httpProxy.close(); socksProxy.close(); echo.close(); });
  const listenPort = await freePort(), sshPort = await freePort();
  const rule = await fixtureData.call('save',{ role:'B', name:'echo', hub:'127.0.0.1', target:'127.0.0.1', targetPort, listenPort, bind:'127.0.0.1', sshPort, httpPort, socksPort });
  const report = await fixtureData.call('detect',rule);
  assert.deepEqual(report.filter(result => result.ok).map(result => result.mode), ['direct','http','socks']);
  for (const mode of ['direct','http','socks']) {
    await fixtureData.call('start',{ ...rule, mode });
    const socket = await tcp('127.0.0.1',listenPort);
    socket.write(Buffer.from([0,255,1,2]));
    const [reply] = await once(socket,'data');
    assert.deepEqual(reply, Buffer.from([0,255,1,2]));
    assert.equal((await fixtureData.call('list'))[0].connected,true);
    socket.once('end', () => socket.end());
    const closed = once(socket,'close');
    fixtureData.release('test');
    await closed;
    assert.equal((await fixtureData.call('list'))[0].mode,undefined);
  }
});

test('a passive port conflict rolls back the entire group; old publication cannot grant new controls',async t => {
  const occupied = net.createServer(), dataPort = await bind(occupied), listenPort = await freePort();
  const relay = fixture();
  t.after(() => { occupied.close(); relay.close(); });
  const { sharingServices, emptySharingServices } = await import('../shared/sharing.mjs');
  const legacy = emptySharingServices();
  delete legacy.relay; legacy.wireguard = { enabled:true, edit:true };
  assert.deepEqual(sharingServices({ services:legacy }).relay,{ enabled:false, edit:false, control:false });
  const rule = await relay.call('save',{ name:'ftp', role:'A', bind:'127.0.0.1', target:'127.0.0.1', targetPort:21, listenPort, passive:dataPort + '-' + dataPort });
  await assert.rejects(relay.call('start',{ ...rule, mode:'direct' }),/EADDRINUSE/);
  assert.equal((await relay.call('list'))[0].mode,undefined);
  await assert.rejects(tcp('127.0.0.1',listenPort), /ECONNREFUSED/);
});
