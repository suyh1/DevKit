import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJarConsole } from './jar-console.mjs';
import { emptySharingServices, sharingServices } from '../shared/sharing.mjs';
import { createSharedWorkspaces } from './shared-workspaces.mjs';

test('console cursors retain bounded output for independent readers and reset per run', () => {
  const io = createJarConsole({ capacity: 10 });
  io.append('hello'); const first = io.read(); assert.equal(first.text, 'hello');
  io.append(' world'); const second = io.read({ cursor: first.cursor, generation: first.generation }); assert.equal(second.text, ' world');
  const late = io.read(); assert.equal(late.text, 'ello world'); assert.equal(late.truncated, true);
  assert.equal(io.read({ generation: first.generation, cursor: 0 }).truncated, true);
  io.begin(); io.append('new run'); const next = io.read({ generation: first.generation, cursor: second.cursor });
  assert.equal(next.reset, true); assert.equal(next.text, 'new run'); assert.notEqual(next.generation, first.generation);
});
test('one writer lease expires, renews and revokes by session; restarted input is rejected', () => {
  let now = 0; const io = createJarConsole({ now: () => now, leaseMs: 20 });
  const generation = io.read().generation;
  io.claim({ owner: 'sessionA:tab1', label: 'one', generation });
  assert.throws(() => io.claim({ owner: 'sessionB:tab2', label: 'two', generation }), /持有/);
  assert.throws(() => io.assertInput('sessionB:tab2', generation), /控制权/);
  now = 15; io.read({ owner: 'sessionA:tab1', renew: true });
  now = 25; assert.throws(() => io.claim({ owner: 'sessionB:tab2', label: 'two', generation }), /持有/);
  io.revoke('sessionA'); io.claim({ owner: 'sessionB:tab2', label: 'two', generation });
  now = 46; io.claim({ owner: 'sessionA:tab1', label: 'one', generation });
  io.begin(); assert.throws(() => io.assertInput('sessionA:tab1', generation), /重启/);
});
test('existing sharing settings leave JAR closed; JAR grants are independent of project role', async () => {
  const old = emptySharingServices(); delete old.jar;
  assert.deepEqual(sharingServices({ services: old }).jar, { enabled: false, edit: false, control: false });
  const calls = [], revoked = [];
  const manager = { request: async (action, value, options) => { calls.push({ action, value, options }); return { ok: true }; }, releaseConsoleSession: async token => revoked.push(token) };
  const workspaces = createSharedWorkspaces({ jar: () => manager });
  const services = emptySharingServices(); services.jar.enabled = true;
  const options = { token: 'session', settings: { services } };
  await workspaces.request('jar', 'get', {}, options);
  assert.equal(calls[0].options.allowEdit, false); assert.equal(calls[0].options.allowControl, false);
  for (const action of ['command', 'detect', 'console-input', 'console-claim', 'console-eof', 'startup-install', 'upsert', 'remove', 'pick']) await assert.rejects(workspaces.request('jar', action, {}, options), error => error.status === 403);
  services.jar.control = true;
  await workspaces.request('jar', 'console-claim', { id: 'test' }, options);
  assert.equal(calls.at(-1).options.session, 'session');
  workspaces.release('session'); await Promise.resolve(); assert.deepEqual(revoked, ['session']);
  services.jar.enabled = false; await assert.rejects(workspaces.request('jar', 'get', {}, options), error => error.status === 404);
});
