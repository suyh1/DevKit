// Run inside the relay CI client namespaces with a verified SSH profile for A.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createLanWorkspaces } from '../server/lan-workspaces.mjs';
import { createGatewayDeployment } from '../server/relay-gateway-deployment.mjs';

const [folder,user,expected] = process.argv.slice(2);
const a='192.0.2.1', directory=folder + '/managed-' + expected;
const lan=await createLanWorkspaces(directory);
const [profile]=await lan.hostRequest('save',{ mode:'ssh', platform:'linux', name:'A', address:a, port:2222, user, auth:'key', keyPath:folder+'/client' });
const publicKey=(await readFile(folder+'/host-A.pub','utf8')).split(' ')[1];
const fingerprint='SHA256:'+createHash('sha256').update(Buffer.from(publicKey,'base64')).digest('base64').replace(/=+$/,'');
await lan.hostRequest('test',{ id:profile.id,fingerprint });
const record=directory+'/gateway.json', prefix='203.0.113.0/24';
const routes=() => execFileSync('ip',['-4','route','show','exact',prefix],{encoding:'utf8'});
const before=routes();
const service=await createGatewayDeployment(record,lan);
const {id}=service.start({ a, profile:profile.id, networks:[prefix], mode:'auto' });
try {
  const state=await service.settled();
  assert.equal(state.phase,'active',state.message);
  assert.equal(state.mode,expected);
  const body=execFileSync('curl',['--noproxy','*','--max-time','5','-fsS','http://203.0.113.42:18084/probe']);
  assert.deepEqual(body,await readFile(folder+'/files/probe'));
} finally {
  service.cancel(id);
  const state=await service.settled();
  assert.equal(state.phase,'restored',state.message);
  assert.equal(routes(),before);
  lan.close();
}
