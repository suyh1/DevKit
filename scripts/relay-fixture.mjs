// Run by check-service-relay.sh inside one namespace at a time.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCollabStore } from '../server/collab-store.mjs';
import { createLanWorkspaces } from '../server/lan-workspaces.mjs';
const [role, folder, user] = process.argv.slice(2);
const directory = folder + '/' + role;
const lan = await createLanWorkspaces(directory);
const store = await createCollabStore(directory, lan);
const hub = role === 'C' ? '192.0.2.5' : '192.0.2.1';
const mode = { A: 'direct', B: 'ssh', C: 'reverse' }[role];
if (role !== 'A') {
  const [host] = await lan.hostRequest('save', { mode:'ssh', platform:'linux', name:'A', address:hub, port:2222, user, auth:'key', keyPath:folder + '/client' });
  const pub = (await readFile(folder + '/host-A.pub','utf8')).split(' ')[1];
  const fingerprint = 'SHA256:' + createHash('sha256').update(Buffer.from(pub,'base64')).digest('base64').replace(/=+$/, '');
  await lan.hostRequest('test', { id: host.id, fingerprint });
}
for (const [name, targetPort, listenPort] of [['HTTP',8000,18080], ['SSH',2222,12222], ['FTP',2121,12121]]) {
  const saved = await store.request('relay','save',{ role, name, target:'192.0.2.6', targetPort, listenPort,
    bind: role === 'B' ? '127.0.0.1' : '192.0.2.1', source: role === 'B' ? '' : '192.0.2.2',
    hub, user, sshPort:2222, httpPort:3128, socksPort:1080, passive:name === 'FTP' ? '50000-50004' : '' });
  const results = await store.request('relay','detect',saved);
  assert.equal(results.find(r => r.mode === mode)?.ok,true,JSON.stringify(results));
  await store.request('relay','start',{ ...saved, mode });
}
await writeFile(folder + '/ready-' + role, 'ready');
process.once('SIGTERM', async () => { await store.close(); lan.close(); });
