// Each invocation runs inside the selected isolated host. No routes are preinstalled.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCollabStore } from '../server/collab-store.mjs';
import { createLanWorkspaces } from '../server/lan-workspaces.mjs';

const [role, folder, user] = process.argv.slice(2);
const plan = { kind:'routing', name:'互通', role, ab:'192.0.2.1', ac:'192.0.2.5', b:'192.0.2.2', c:'192.0.2.6' };
const lan = await createLanWorkspaces(folder + '/route-' + role);
const store = await createCollabStore(folder + '/route-' + role, lan);
try {
  const profiles = {};
  for (const node of ['A','B','C'].filter(key => key !== role)) {
    const address = node === 'A' ? (role === 'C' ? plan.ac : plan.ab) : node === 'B' ? plan.b : plan.c;
    const endpoint = { name:node, platform:'linux', address, user, port:2222, jumpHostId:role !== 'A' && node !== 'A' ? profiles.A : undefined };
    const pub = (await readFile(folder + '/host-' + node + '.pub','utf8')).split(' ')[1];
    const fingerprint = 'SHA256:' + createHash('sha256').update(Buffer.from(pub,'base64')).digest('base64').replace(/=+$/, '');
    assert.deepEqual(await lan.hostRequest('routing-fingerprint',endpoint), { fingerprint });
    const hosts = await lan.hostRequest('save',{ ...endpoint, mode:'ssh', auth:'key', keyPath:folder + '/client' });
    const id = hosts.find(host => host.name === node).id;
    await lan.hostRequest('test',{ id, fingerprint });
    profiles[node] = id;
  }
  const a = role === 'C' ? plan.ac : plan.ab;
  const found = await store.request('relay','discover',{ a, b:plan.b, c:plan.c },{ desktopAdmin:true });
  assert.equal(found.role, role);
  assert.deepEqual(found.profiles, profiles);
  assert.equal(found.ab?.ip, plan.ab, JSON.stringify(found));
  assert.equal(found.ac?.ip, plan.ac, JSON.stringify(found));
  const shared = await store.request('relay','discover',{ a, b:plan.b, c:plan.c },{ routingDiscovery:true, sshAllowed:true });
  assert.deepEqual(shared,{ role, ab:{ip:plan.ab}, ac:{ip:plan.ac} });
  const saved = await store.request('relay','save',{ kind:'routing', name:'互通', role:found.role, a, b:plan.b, c:plan.c, ab:found.ab.ip, ac:found.ac.ip });
  const apply = () => store.request('relay','apply',{ ...saved, profiles },{ desktopAdmin:true });
  assert.match(await apply(),/配置已应用/);
  assert.match(await apply(),/持久配置已就绪/);
} finally { await store.close(); lan.close(); }
