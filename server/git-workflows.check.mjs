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

test('file and hunk discard, reversible commits and stash actions preserve the correct Git layer', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'devkit-git-edits-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const root = path.join(folder, 'repo');
  await mkdir(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trimEnd();
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'diff.relative', 'true');
  git('config', 'core.autocrlf', 'false');
  const manager = await createGitWorkspace(folder);
  const [{ id }] = await manager.request('register', { root });
  const request = (action, args = {}, access) => manager.request(action, { id, ...args }, access);
  const state = () => request('state');
  const change = async (action, args, access) => request(action, { revision: (await state()).revision, ...args }, access);
  const file = 'nested/sp ace [1].txt';
  await mkdir(path.join(root, 'nested'));
  const location = path.join(root, file);
  const base = Array.from({ length: 25 }, (_, i) => 'line ' + i + '\n').join('');
  await writeFile(location, base);
  const emptyFile = 'empty.bin';
  await writeFile(path.join(root, emptyFile), '');
  const files = [{ path: file }, { path: emptyFile }];
  const edit = async (action, hunk) => {
    const { token } = await request('review', { path: file, staged: action === 'unstage' });
    return change(action, { path: file, token, hunk });
  };

  await assert.rejects(change('commit', { message: 'incomplete', stageAll: true, files: files.slice(1) }), { status: 409 });
  await change('commit', { message: 'initial\n\nBody', stageAll: true, files });
  const initial = (await state()).head;
  assert.equal((await change('undo-commit', { head: initial })).message, 'initial\n\nBody');
  assert.equal((await state()).head, '');
  assert.equal(git('rev-parse', 'ORIG_HEAD'), initial);
  assert.equal(git('show', ':' + file), base.trimEnd());
  assert.equal(await readFile(location, 'utf8'), base);
  await change('commit', { message: 'initial again' });
  const parent = (await state()).head;
  const staged = base.replace('line 0\n', 'staged\n');
  await writeFile(location, staged);
  await edit('stage');
  const work = staged.replace('line 2\n', 'first work\n').replace('line 24\n', 'second work\n');
  await writeFile(location, work);
  assert.equal((await request('review', { path: file })).hunks.length, 2);
  await edit('discard', 1);
  assert.equal(await readFile(location, 'utf8'), work.replace('second work\n', 'line 24\n'));
  assert.equal(git('show', ':' + file), staged.trimEnd());
  const stale = await request('review', { path: file });
  await writeFile(location, work);
  await assert.rejects(change('discard', { path: file, token: stale.token }), { status: 409 });
  await edit('discard');
  assert.equal(await readFile(location, 'utf8'), staged);
  await writeFile(location, work);
  await change('commit', { message: 'second' });
  const second = (await state()).head;
  assert.equal((await request('head-commit', { head: second })).message, 'second');
  await assert.rejects(change('commit', { message: 'stale amend', amendHead: initial }), { status: 409 });
  await change('commit', { message: 'amended\n\nBody', amendHead: second });
  assert.equal(git('log', '-1', '--format=%B'), 'amended\n\nBody');
  assert.equal(git('show', 'HEAD:' + file), staged.trimEnd());
  await assert.rejects(change('undo-commit', { head: second }), { status: 409 });
  assert.equal((await change('undo-commit', { head: (await state()).head })).message, 'amended\n\nBody');
  assert.equal((await state()).head, parent);
  assert.equal(await readFile(location, 'utf8'), work);
  assert.equal(git('show', ':' + file), staged.trimEnd());
  await edit('unstage');
  assert.equal(git('show', ':' + file), base.trimEnd());
  assert.equal(await readFile(location, 'utf8'), work);

  await change('stash-save', { message: 'saved' });
  const [entry] = (await state()).stashes;
  const stash = { stash: entry.id, ref: entry.ref };
  await assert.rejects(change('stash-drop', { ...stash, ref: 'stash@{1}' }), { status: 404 });
  await change('stash-pop', stash);
  assert.equal((await state()).stashes.length, 0);
  assert.equal(await readFile(location, 'utf8'), work);
  await change('stash-save', { message: 'again' });
  const [again] = (await state()).stashes;
  await change('stash-drop', { stash: again.id, ref: again.ref });
  assert.equal(await readFile(location, 'utf8'), base);

  await rm(location);
  await edit('discard');
  assert.equal(await readFile(location, 'utf8'), base);
  git('rm', '--cached', '--', file);
  // Staged deletion and an untracked replacement share a path but have different diffs.
  assert.match((await request('review', { path: file })).text, /new file mode/);
  assert.match((await request('review', { path: file, staged: true })).text, /deleted file mode/);
  await edit('discard');
  await assert.rejects(readFile(location), { code: 'ENOENT' });
  await edit('unstage');
  await edit('discard');
  assert.equal(await readFile(location, 'utf8'), base);

  await writeFile(location, work);
  const extra = path.join(root, 'untracked.bin');
  await writeFile(extra, Buffer.from([0, 255, 128]));
  const discardFiles = [{ path: file }, { path: 'untracked.bin' }];
  const plan = () => change('discard-plan', { files: discardFiles });
  const beforeEdit = await plan();
  await writeFile(location, work + 'later');
  await assert.rejects(change('discard', { files: discardFiles, ...beforeEdit }), { status: 409 });
  assert.deepEqual(await readFile(extra), Buffer.from([0, 255, 128]));
  assert.equal(await readFile(location, 'utf8'), work + 'later');
  await change('discard', { files: discardFiles, ...(await plan()) });
  assert.equal(await readFile(location, 'utf8'), base);
  await assert.rejects(readFile(extra), { code: 'ENOENT' });

  await request('publish', { published: true });
  await request('policy', { policy: { default: 'worktree', visitors: [] } });
  for (const action of ['discard', 'undo-commit', 'stash-pop', 'stash-drop', 'commit'])
    await assert.rejects(change(action, {}, { portal: true, edit: true }), { status: 403 });
});
