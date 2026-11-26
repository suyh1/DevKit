import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { once } from 'node:events';
import { createRelay } from './relay.mjs';
import { tcp } from './relay-transport.mjs';
import { applyRouting } from './relay-routing-apply.mjs';

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
const routingPlan = { kind:'routing', name:'互通', role:'A', ab:'192.0.2.1', b:'192.0.2.2', ac:'192.0.2.5', c:'192.0.2.6' };

test('routing plans validate endpoints, share both host routes and reserve writes for the trusted desktop', async () => {
  const relay = fixture();
  for (const c of ['0.0.0.0','127.0.0.1','224.1.2.3',routingPlan.b,'192.0.2.6/24','$(id)'])
    await assert.rejects(relay.call('save',{ ...routingPlan, c }));
  const ref = await relay.call('save',routingPlan);
  const [saved] = await relay.call('list');
  assert.match(saved.steps.B.linux,/192\.0\.2\.6\/32 via 192\.0\.2\.1/);
  assert.match(saved.steps.C.windows,/'192\.0\.2\.2\/32'.*'192\.0\.2\.5'/);
  await assert.rejects(relay.call('apply',{ ...ref, desktopAdmin:true }),/桌面/);
  await assert.rejects(relay.call('start',{ ...ref, mode:'direct' }));
  await relay.call('remove',ref);
});

test('routing runs every preflight before writing and rolls back only its successful changes', async () => {
  const ids = { B:'b'.repeat(36), C:'c'.repeat(36) };
  for (const when of ['preflight','apply']) {
    const changes = [], live = new Set(['A1']);
    let n = 0;
    const connect = async () => {
      const role = ['A','B','C'][n++];
      return { platform:'win32', close() {}, async run(script) {
        const key = role === 'A' ? (script.includes(routingPlan.ab) ? 'A1' : 'A2') : role;
        if (script.includes("'missing'")) {
          if (role === 'C' && when === 'preflight') throw new Error('冲突');
          return live.has(key) ? 'present' : 'missing';
        }
        if (script.includes('Remove-NetRoute') || script.includes('-Forwarding Disabled')) { live.delete(key); changes.push('-' + key); return ''; }
        if (role === 'C') throw new Error('拒绝写入');
        live.add(key); changes.push('+' + key); return '';
      }};
    };
    await assert.rejects(applyRouting(routingPlan,ids,null,connect),/C/);
    assert.deepEqual(changes, when === 'preflight' ? [] : ['+A2','+B','-B','-A2']);
    assert.deepEqual([...live],['A1']);
  }
});

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
