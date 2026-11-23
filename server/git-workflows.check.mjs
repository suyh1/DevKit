import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGitWorkspace } from './git-workspace.mjs';

test('reviewed patch bytes, hunks, merge resolution, first push, history, clone and scoped visitors', async (t) => {
  const parent = await realpath(tmpdir()),
    folder = await mkdtemp(path.join(parent, 'devkit-git-flow-'));
  t.after(async () => {
    assert.equal(path.dirname(await realpath(folder)), parent);
    await rm(folder, { recursive: true, force: true });
  });
  const root = path.join(folder, 'source'),
    bare = path.join(folder, 'upstream.git');
  await mkdir(root);
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  git('init', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.email', 'review@example.invalid');
  git('config', 'user.name', 'Review');
  git('config', 'commit.gpgsign', 'false');
  const file = 'two blocks.txt',
    location = path.join(root, file),
    base = Array.from({ length: 25 }, (_, i) => 'line ' + i).join('\n') + '\n';
  await writeFile(location, base);
  git('add', '--', file);
  git('commit', '-m', 'Initial body');
  const initial = git('rev-parse', 'HEAD');
  const manager = await createGitWorkspace(folder),
    [{ id }] = await manager.request('register', { root });
  const call = (a, v = {}, ctx) => manager.request(a, { ...v, id }, ctx);
  const state = () => call('state');
  const change = async (a, v = {}) => call(a, { revision: (await state()).revision, ...v });
  const review = (staged = false) => call('review', { path: file, staged });
  // A file stays "modified" while its reviewed contents change.
  const changeA = base.replace('line 0', 'first A').replace('line 24', 'last A');
  await writeFile(location, changeA);
  const a = await review(),
    revision = (await state()).revision;
  assert.equal(a.hunks.length, 2);
  await writeFile(location, changeA.replace('first A', 'first B'));
  await assert.rejects(call('stage', { revision, path: file, token: a.token }), { status: 409 });
  assert.equal(git('diff', '--cached', '--name-only'), '');
  const b = await review();
  await change('stage', { path: file, hunk: 0, token: b.token });
  assert.match(git('diff', '--cached'), /\+first B/);
  assert.doesNotMatch(git('diff', '--cached'), /last A/);
  await change('unstage', { path: file, hunk: 0, token: (await review(true)).token });
  assert.equal(git('diff', '--cached', '--name-only'), '');
  const fresh = 'new.txt';
  await writeFile(path.join(root, fresh), 'A');
  const before = await call('review', { path: fresh });
  await writeFile(path.join(root, fresh), 'B');
  await assert.rejects(change('stage', { path: fresh, token: before.token }), { status: 409 });
  git('add', '.');
  git('commit', '-m', 'New material');
  git('branch', 'topic');
  await writeFile(location, 'current\n');
  git('commit', '-am', 'Main version');
  git('switch', 'topic');
  await writeFile(location, 'topic\n');
  git('commit', '-am', 'Topic version');
  const topic = git('rev-parse', 'HEAD');
  git('switch', 'main');
  assert.match(await call('compare', { base: git('rev-parse', 'HEAD'), target: topic }), /\+topic/);
  const start = () => change('merge', { name: 'refs/heads/topic', target: topic });
  await start();
  assert.ok((await state()).mergeHead);
  await change('merge-abort');
  assert.equal(await readFile(location, 'utf8'), 'current\n');
  await start();
  const conflict = await call('conflict', { path: file });
  assert.equal(conflict.ours.text, 'current\n');
  assert.equal(conflict.theirs.text, 'topic\n');
  await assert.rejects(change('merge-continue'), { status: 409 });
  await change('resolve', { path: file, side: 'manual', text: 'combined\n', token: conflict.token });
  await change('merge-continue');
  assert.equal(git('show', 'HEAD:' + file), 'combined');
  assert.equal(git('show', '-s', '--format=%P').split(' ').length, 2);
  git('init', '--bare', '-b', 'main', bare);
  git('remote', 'add', 'origin', bare);
  const plan = await call('push-plan', { remote: 'origin' });
  assert.equal(plan.target, 'main');
  assert.equal(plan.first, true);
  await assert.rejects(change('push', { remote: 'origin', token: 'old' }), { status: 409 });
  await change('push', { remote: 'origin', token: plan.token });
  assert.equal(git('rev-parse', '--abbrev-ref', '@{u}'), 'origin/main');
  const destination = path.join(folder, 'copies');
  await mkdir(destination);
  const clone = (await manager.request('clone', { source: bare, parent: destination })).at(-1);
  assert.equal(clone.published, false);
  assert.equal((await readFile(path.join(clone.root, file), 'utf8')).replaceAll('\r\n', '\n'), 'combined\n');
  await assert.rejects(manager.request('clone', { source: bare, parent: destination }), { status: 409 });
  const login = (visitor) => ({ portal: true, edit: true, sync: true, visitor });
  await call('policy', {
    policy: {
      default: 'none',
      visitors: [
        { name: 'reader', level: 'history' },
        { name: 'writer', level: 'edit' },
      ],
    },
  });
  await call('publish', { published: true });
  assert.deepEqual(await call('list', {}, login('')), []);
  assert.deepEqual(await call('list', {}, login('other')), []);
  await writeFile(path.join(root, 'private.txt'), 'Unpublished');
  const publicState = await call('state', {}, login('reader'));
  assert.equal(publicState.worktree, false);
  assert.deepEqual(publicState.files, []);
  for (const action of ['review', 'conflict', 'stage', 'stash-show', 'push', 'merge', 'resolve'])
    await assert.rejects(call(action, { path: 'private.txt' }, login('reader')), { status: 403 });
  assert.equal((await call('list', {}, login('writer')))[0].access.sync, false);
  assert.ok((await call('state', {}, login('writer'))).files.some((f) => f.path === 'private.txt'));
  // Create a long history with fast-import in the isolated fixture.
  const script = Array.from(
    { length: 205 },
    (_, i) =>
      'commit refs/heads/long\ncommitter Review <review@example.invalid> ' +
      (1800000000 + i) +
      ' +0000\ndata ' +
      ('Sequence ' + i).length +
      '\nSequence ' +
      i +
      '\n' +
      (i === 0 ? 'from ' + initial + '\n' : '') +
      '\n',
  ).join('');
  execFileSync('git', ['fast-import', '--quiet'], { cwd: root, input: script, windowsHide: true });
  const firstPage = await call('history', {}, login('reader'));
  assert.equal(firstPage.commits.length, 200);
  assert.equal(firstPage.more, true);
  const second = await call('history', { offset: 200, snapshot: firstPage.snapshot }, login('reader'));
  assert.ok(second.commits.length > 0);
  assert.match(await call('show', { commit: initial }, login('reader')), /Initial body/);
  assert.equal(
    (await call('history', { path: file, query: 'Initial body', field: 'message' }, login('reader'))).commits[0].id,
    initial,
  );
  assert.equal(
    (await call('history', { query: initial.slice(0, 12), field: 'hash' }, login('reader'))).commits[0].id,
    initial,
  );
  assert.match(await call('compare', { base: initial, target: topic }, login('reader')), /\+topic/);
});
