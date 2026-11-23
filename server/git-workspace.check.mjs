import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitWorkspace } from './git-workspace.mjs';

test('published repositories, partial staging, graph, branches, tags and local upstream', async (t) => {
  const parent = await realpath(tmpdir());
  const folder = await mkdtemp(path.join(parent, 'devkit-git-test-'));
  t.after(async () => {
    assert.equal(path.dirname(await realpath(folder)), parent);
    await rm(folder, { recursive: true, force: true });
  });
  const repo = path.join(folder, '工作 树'),
    bare = path.join(folder, 'remote.git');
  await mkdir(repo);
  const git = (cwd, ...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'config', 'user.email', 'test@example.invalid');
  git(repo, 'config', 'commit.gpgsign', 'false');
  const manager = await createGitWorkspace(folder);
  const [{ id }] = await manager.request('register', { root: repo });
  const viewer = { portal: true },
    editor = { ...viewer, edit: true },
    sync = { ...viewer, sync: true };
  const call = (action, args = {}, access) => manager.request(action, { id, ...args }, access);
  const change = async (action, args = {}, access = editor) =>
    call(action, { revision: (await call('state')).revision, ...args }, access);
  assert.deepEqual(await call('list', {}, viewer), []);
  await assert.rejects(call('state', {}, viewer), { status: 404 });
  await assert.rejects(call('publish', { published: true }, editor), { status: 403 });
  await call('publish', { published: true });
  assert.equal((await call('list', {}, viewer))[0].root, undefined);
  const empty = await call('state', {}, viewer);
  assert.equal(empty.branch, 'main');
  assert.deepEqual(empty.commits, []);
  const file = '-工作 [1].txt',
    payload = { path: file };
  await writeFile(path.join(repo, file), 'first line\n');
  assert.match(await call('patch', payload, viewer), /\+first line/);
  await assert.rejects(change('stage', payload, viewer), { status: 403 });
  await assert.rejects(call('stage', { ...payload, revision: empty.revision }, editor), { status: 409 });
  await change('stage', payload);
  await change('unstage', payload);
  await change('stage', payload);
  await writeFile(path.join(repo, file), 'second line\n');
  assert.match(await call('patch', { ...payload, staged: true }), /\+first line/);
  assert.match(await call('patch', payload), /\+second line/);
  await change('commit', { message: 'Initial snapshot' });
  const first = await call('state');
  assert.equal(first.commits[0].subject, 'Initial snapshot');
  assert.match(await call('show', { commit: first.head }), /\+first line/);
  await assert.rejects(call('show', { commit: 'HEAD' }), { status: 404 });
  await change('create-branch', { name: 'feature/demo' });
  await assert.rejects(change('switch', { name: 'feature/demo' }), { status: 409 });
  await writeFile(path.join(repo, 'new.txt'), 'untracked work\n');
  await change('stash-save', { message: 'Switch context' });
  const saved = await call('state');
  assert.deepEqual(saved.files, []);
  assert.equal(saved.stashes.length, 1);
  const stash = saved.stashes[0].id;
  assert.match(await call('stash-show', { stash }, viewer), /untracked work/);
  await assert.rejects(change('stash-apply', { stash }, viewer), { status: 403 });
  await change('stash-apply', { stash });
  await change('stage', { path: 'new.txt' });
  await change('stage', payload);
  await change('commit', { message: 'Main change' });
  await change('switch', { name: 'feature/demo' });
  await writeFile(path.join(repo, 'feature.txt'), 'feature\n');
  await change('stage', { path: 'feature.txt' });
  await change('commit', { message: 'Feature' });
  await change('switch', { name: 'main' });
  git(repo, 'merge', '--no-ff', '-m', 'Join', 'feature/demo');
  await change('tag', { name: 'demo-1' });
  const merged = await call('state');
  assert.equal(merged.commits.find((c) => c.id === merged.head).parents.length, 2);
  assert.ok(merged.references.some((r) => r.kind === 'tags' && r.name === 'demo-1'));
  git(folder, 'init', '--bare', '-b', 'main', bare);
  git(repo, 'remote', 'add', 'origin', bare);
  git(repo, 'push', '-u', 'origin', 'main');
  await assert.rejects(change('fetch', { remote: 'origin' }, editor), { status: 403 });
  await change('fetch', { remote: 'origin' }, sync);
  const peer = path.join(folder, 'peer');
  git(folder, 'clone', bare, peer);
  await writeFile(path.join(peer, 'remote.txt'), 'upstream\n');
  git(peer, 'add', 'remote.txt');
  git(
    peer,
    '-c',
    'user.name=Peer',
    '-c',
    'user.email=peer@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'Upstream',
  );
  git(peer, 'push');
  await change('pull', { remote: 'origin' }, sync);
  assert.equal((await call('state')).head, git(peer, 'rev-parse', 'HEAD'));
  git(repo, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'To upstream');
  await change('push', { remote: 'origin' }, sync);
  assert.equal(git(repo, 'rev-parse', 'HEAD'), git(bare, 'rev-parse', 'main'));
  assert.equal((await (await createGitWorkspace(folder)).request('list', {}, viewer))[0].id, id);
  await call('publish', { published: false });
  await assert.rejects(call('state', {}, editor), { status: 404 });
  await call('remove');
  assert.equal(git(repo, 'branch', '--show-current'), 'main');
  const registry = (...args) => execFileSync(process.execPath, [fileURLToPath(new URL('./git-register.mjs', import.meta.url)), ...args], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, DEVKIT_PROJECT_DATA: folder },
  });
  assert.match(registry('publish', repo), /已发布/);
  assert.match(registry('list'), /已发布/);
  assert.match(registry('unpublish', repo), /仅主机/);
});
