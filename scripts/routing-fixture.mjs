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
  const pub = (await readFile(folder + '/host.pub','utf8')).split(' ')[1];
  const fingerprint = 'SHA256:' + createHash('sha256').update(Buffer.from(pub,'base64')).digest('base64').replace(/=+$/, '');
  for (const node of ['A','B','C'].filter(key => key !== role)) {
    const address = node === 'A' ? (role === 'C' ? plan.ac : plan.ab) : node === 'B' ? plan.b : plan.c;
    const hosts = await lan.hostRequest('save',{ mode:'ssh', name:node, platform:'linux', address, user, port:2222, auth:'key', keyPath:folder + '/client',
      jumpHostId:role !== 'A' && node !== 'A' ? profiles.A : undefined });
    const id = hosts.find(host => host.name === node).id;
    await lan.hostRequest('test',{ id, fingerprint });
    profiles[node] = id;
  }
  const saved = await store.request('relay','save',plan);
  const apply = () => store.request('relay','apply',{ ...saved, profiles },{ desktopAdmin:true });
  assert.match(await apply(),/配置已应用/);
  assert.match(await apply(),/持久配置已就绪/);
} finally { await store.close(); lan.close(); }
