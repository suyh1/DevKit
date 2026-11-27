import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGatewayDeployment } from './relay-gateway-deployment.mjs';

const input = { a:'192.0.2.1', networks:['198.51.100.0/24'], mode:'auto' };
const profile = { id:'profile-A', address:input.a, fingerprint:'trusted', mode:'ssh' };
const steps = [{ role:'A', kind:'forward', ip:input.a },{ role:'B',kind:'route',cidr:input.networks[0] }];
async function fixture(t, initial = []) {
  const folder = await mkdtemp(join(tmpdir(),'gateway-deployment-'));
  t.after(() => rm(folder,{recursive:true,force:true}));
  const file = join(folder,'record.json');
  const state = new Set(initial), events = [];
  let hook = () => {};
  const options = {
    interfaces:() => ({ lan:[{address:'192.0.2.42'}] }),
    plan:async () => ({mode:'direct',steps}),
    command:(_platform,op,action) => ({op,action}),
    connect:async (_lan,id) => ({
      platform:'linux', close() {},
      async run({op,action}) {
        assert.equal(id,op.role === 'A' ? profile.id : undefined);
        if (action === 'state' || action === 'owned') return state.has(op.kind) ? 'present' : 'missing';
        events.push([action,op.kind]);
        if (action === 'add') state.add(op.kind);
        await hook(op,action);
        if (action === 'undo') state.delete(op.kind);
      },
    }),
  };
  const open = () => createGatewayDeployment(file,{hostRequest:async () => [profile]},options);
  return { manager:await open(), open, file, state, events, hook:fn => { hook=fn; } };
}

test('disconnect after a restart preserves pre-existing forwarding and rolls back only the new client route', async t => {
  const f=await fixture(t,['forward']);
  const {id}=f.manager.start(input);
  assert.throws(() => f.manager.start(input),/先取消/);
  assert.equal((await f.manager.settled()).phase,'active');
  const recovered=await f.open();
  assert.throws(() => recovered.cancel('old button'),/已变化/);
  recovered.cancel(id);
  assert.equal((await recovered.settled()).phase,'restored');
  assert.deepEqual(f.events,[['add','route'],['undo','route']]);
  assert.deepEqual([...f.state],['forward']);
});

test('cancelling during a write waits for it and prevents the next device from changing', async t => {
  const f=await fixture(t), started=Promise.withResolvers(), finish=Promise.withResolvers();
  f.hook(async (_op,action) => { if (action==='add') { started.resolve(); await finish.promise; } });
  const {id}=f.manager.start(input);
  await started.promise;
  f.manager.cancel(id); finish.resolve();
  assert.equal((await f.manager.settled()).phase,'restored');
  assert.deepEqual(f.events,[['add','forward'],['undo','forward']]);
});

test('a lost reply and failed rollback retain the outstanding change for retry across a restart', async t => {
  const f=await fixture(t);
  f.hook(async (op,action) => { if (op.kind==='route') throw Error(action==='add' ? 'lost reply' : 'offline'); });
  const {id}=f.manager.start(input);
  assert.equal((await f.manager.settled()).phase,'cleanup');
  assert.deepEqual([...f.state],['route']);
  assert.deepEqual(JSON.parse(await readFile(f.file)).pending.map(op => op.kind),['route']);
  f.hook(() => {});
  const recovered=await f.open();
  recovered.cancel(id);
  assert.equal((await recovered.settled()).phase,'restored');
  assert.equal(f.state.size,0);
});

test('an interrupted deploy starts recovery when reopened and never reapplies the plan', async t => {
  const f=await fixture(t);
  f.manager.start(input); await f.manager.settled();
  const journal=JSON.parse(await readFile(f.file));
  journal.phase='deploying';
  await writeFile(f.file,JSON.stringify(journal));
  assert.equal((await (await f.open()).settled()).phase,'restored');
  assert.deepEqual(f.events,[['add','forward'],['add','route'],['undo','route'],['undo','forward']]);
});
