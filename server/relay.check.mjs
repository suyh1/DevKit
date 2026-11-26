import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import ssh from 'ssh2';
import { createLanWorkspaces } from './lan-workspaces.mjs';
import http from 'node:http';
import { once } from 'node:events';
import { routingProfiles } from '../shared/routing-profiles.mjs';
import { createRelay } from './relay.mjs';
import { tcp } from './relay-transport.mjs';
import { discoverRouting } from './relay-routing-discovery.mjs';
import { applyRouting } from './relay-routing-apply.mjs';
import { verifyRouting } from './relay-routing-verify.mjs';

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
  await assert.rejects(relay.call('verify',{ ...ref, routingControl:true, sshAllowed:true }),/权限/);
  await assert.rejects(relay.call('start',{ ...ref, mode:'direct' }));
  await relay.call('remove',ref);
});

test('directional checks validate ports, isolate missing credentials and test TCP even when ping has no reply', async () => {
  const plan = { ...routingPlan, role:'B' };
  const access = { routingControl:true, sshAllowed:false };
  let closed = 0, opened = 0, calls = 0;
  const connect = async (_lan,id,options) => {
    assert.equal(id,undefined); assert.equal(options.elevated,false); opened++;
    return { platform:'linux', close() { closed++; }, async run(script) {
      calls++;
      assert.ok(script.includes(plan.c));
      if (script.includes('ping -n')) return 'no-reply';
      assert.ok(script.includes('/dev/tcp/' + plan.c + '/443'));
      return 'connected';
    }};
  };
  for (const ports of [{ C:[22,80] }, { B:0 }, { C:65536 }, { A:22 }, { B:'22' }])
    await assert.rejects(verifyRouting(plan,ports,null,access,connect), /端口/);
  assert.equal(opened,0);
  const [forward,reverse] = await verifyRouting(plan,{ C:443 },null,access,connect);
  assert.equal(forward.status,'no-reply'); assert.equal(forward.tcp.status,'connected');
  assert.equal(reverse.status,'unverified'); assert.match(reverse.message,/权限/);
  assert.equal(calls,2); assert.equal(closed,1);
});

test('interface discovery keeps independent results and only uses the pinned profile for A', async () => {
  const ips = { a:'10.9.0.1', b:'10.1.0.2', c:'10.2.0.2' };
  const local = { eth0:[{ address:ips.b }] }, profile = { id:'a'.repeat(36), mode:'ssh', address:ips.a, fingerprint:'trusted' };
  const lan = { hostRequest:async () => [profile, { ...profile, fingerprint:'' }] };
  let closed = false;
  const connect = async (_lan, id, options) => {
    assert.equal(id,profile.id); assert.equal(options.elevated,false);
    return { platform:'linux', close:() => { closed = true; }, run:async script => {
      if (script.endsWith(ips.c)) return JSON.stringify([{ dev:'eth1', gateway:'10.1.0.9', prefsrc:'10.1.0.1' }]);
      if (script.includes('fibmatch')) return '[{"dev":"eth1"}]';
      if (script.includes('addr show')) return '2: eth1@if4 inet 10.1.0.1/24 scope global eth1';
      return '[{"dev":"eth1","prefsrc":"10.1.0.1"}]';
    } };
  };
  const found = await discoverRouting(ips,lan,local,connect);
  assert.equal(found.role,'B'); assert.equal(found.ab.ip,'10.1.0.1'); assert.ok(found.ac.reason); assert.ok(closed);
  assert.ok((await discoverRouting(ips,lan,{})).reason);
  assert.ok((await discoverRouting(ips,null,local)).ab.reason);
  const duplicates = { hostRequest:async () => [profile, { ...profile, id:'d'.repeat(36) }] };
  assert.equal((await discoverRouting(ips,duplicates,local)).candidates.length,2);
  assert.equal((await discoverRouting({ ...ips, profileA:profile.id },duplicates,local,connect)).ab.ip,'10.1.0.1');
  await assert.rejects(discoverRouting({ ...ips, b:'10.1.0.2; echo' },lan,local));
  await assert.rejects(fixture().call('discover',ips),/权限/);
});

test('three-address drafts can be resumed without publishing incomplete routes', async () => {
  const relay = fixture();
  const draft = { kind:'routing', pending:true, name:'两台电脑互访', a:routingPlan.ab, b:routingPlan.b, c:routingPlan.c };
  await assert.rejects(relay.call('save',{ ...draft, b:draft.a }), /不同/);
  await assert.rejects(relay.call('save',{ ...draft, c:'abc' }), /设备 C/);
  const ref = await relay.call('save',draft);
  const [{ created, ...pending }] = await relay.call('list');
  assert.ok(created);
  assert.deepEqual(pending, { ...draft, ...ref });
  for (const operation of ['apply','detect','start']) await assert.rejects(relay.call(operation,ref),/草稿/);
  const saved = await relay.call('save',{ ...routingPlan, ...ref });
  assert.equal(saved.id,ref.id);
  assert.ok((await relay.call('list'))[0].steps.A);
  await assert.rejects(relay.call('save',{ ...draft, ...saved }),/草稿/);
});

test('shared discovery ignores caller-supplied installation and account overrides and hides host profiles', async () => {
  const relay = createRelay({ hostRequest:() => { throw Error('unexpected host access'); } }, () => {});
  const input = { a:'192.0.2.1', b:'192.0.2.2', c:'192.0.2.3', role:'A', profileA:'chosen', desktopAdmin:true };
  const request = access => relay.request({ rows:[], action:'discover', input, access });
  await assert.rejects(request({}), /权限/);
  assert.deepEqual(await request({ routingDiscovery:true, sshAllowed:false }), { role:undefined, ab:{}, ac:{} });
});

test('peer management profiles follow the chosen hub for either endpoint installation', () => {
  const addresses = { A:['10.0.0.1'], B:['10.0.0.2'], C:['10.0.0.3'] };
  const profile = (id,device,jumpHostId) => ({ id, address:addresses[device][0], mode:'ssh', fingerprint:'pinned', jumpHostId });
  const hub = profile('hub','A'), second = profile('second','A');
  for (const [local,peer] of [['B','C'],['C','B']]) {
    const direct = profile('direct',peer), viaHub = profile('via-hub',peer,hub.id), viaSecond = profile('via-second',peer,second.id);
    const peers = [direct,viaHub,viaSecond], hosts = [hub,...peers];
    assert.equal(routingProfiles(hosts,local,addresses).profiles[peer],viaHub.id);
    assert.deepEqual(routingProfiles([hub,direct,viaSecond],local,addresses).matching[peer],[]);
    assert.equal(routingProfiles([hub,second,...peers],local,addresses).profiles[peer],undefined);
    assert.equal(routingProfiles([hub,second,...peers],local,addresses,{A:second.id,[peer]:viaHub.id}).profiles[peer],viaSecond.id);
    assert.equal(routingProfiles([direct], 'A',addresses).profiles[peer],direct.id);
  }
});

test('desktop SSH enrollment confirms identity before password login and commits only verified credentials', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'devkit-enroll-'));
  const lan = await createLanWorkspaces(directory), password = randomUUID();
  const hostKey = generateKeyPairSync('rsa',{ modulusLength:2048, privateKeyEncoding:{ format:'pem', type:'pkcs1' }, publicKeyEncoding:{ format:'pem', type:'spki' } }).privateKey;
  let logins = 0;
  const server = new ssh.Server({ hostKeys:[hostKey] }, client => {
    client.on('error',() => {});
    client.on('authentication',auth => {
      if (auth.method === 'password') logins++;
      if (auth.method === 'password' && auth.password === password && auth.username === 'operator') auth.accept();
      else auth.reject(['password']);
    });
  });
  const port = await bind(server);
  t.after(async () => { lan.close(); await new Promise(resolve => server.close(resolve)); await rm(directory,{ recursive:true, force:true }); });
  const draft = { name:'A', address:'127.0.0.1', user:'operator', port, platform:'linux' };
  await assert.rejects(lan.hostRequest('routing-fingerprint',draft,null,{ token:'guest',ensureCurrent() {} }),/桌面/);
  const { fingerprint } = await lan.hostRequest('routing-fingerprint',draft);
  assert.match(fingerprint,/^SHA256:/);
  await assert.rejects(lan.hostRequest('routing-enroll',{ ...draft,password,fingerprint:'SHA256:' + 'x'.repeat(43) }),/指纹/);
  assert.equal(logins,0);
  await assert.rejects(lan.hostRequest('routing-enroll',{ ...draft,fingerprint,password:'incorrect' }),/身份验证失败/);
  assert.deepEqual(await lan.hostRequest('list'),[]);
  const [pending] = await lan.hostRequest('save',{ ...draft,mode:'ssh',auth:'password' });
  const saved = await lan.hostRequest('routing-enroll',{ ...draft,id:pending.id,revision:pending.revision,password,fingerprint });
  assert.equal(saved.id,pending.id); assert.equal(saved.fingerprint,fingerprint); assert.ok(saved.hasPassword);
  await assert.rejects(lan.hostRequest('routing-enroll',{ ...draft,id:pending.id,revision:pending.revision,password,fingerprint }),/变化/);
  await lan.hostRequest('remove',saved.id);
  const created = await lan.hostRequest('routing-enroll',{ ...draft,password,fingerprint });
  assert.equal(created.password,undefined); assert.equal(created.secret,undefined);
  assert.equal((await lan.hostRequest('list')).length,1);
  assert.ok(!(await readFile(path.join(directory,'lan-hosts','connections.json'),'utf8')).includes(password));
  const client = await lan.routingSession(created.id); client.client.end();
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
