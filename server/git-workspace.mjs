import { git, patches, fail } from './git-command.mjs';
import { reviewFile, applyReview, applyFiles, conflictView, resolveConflict } from './git-review.mjs';
import {
  history,
  visibleCommit,
  compareCommits,
  mergeStatus,
  startMerge,
  pushPlan,
  cloneRepository,
} from './git-operations.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { atomicFile } from './atomic-file.mjs';
import { configGroup } from './config-layout.mjs';

const syncActions = new Set(['fetch', 'pull', 'push']);
const editActions = new Set([
  'merge',
  'merge-abort',
  'merge-continue',
  'resolve',
  'stage',
  'unstage',
  'discard',
  'undo-commit',
  'commit',
  'create-branch',
  'switch',
  'tag',
  'stash-save',
  'stash-apply',
  'stash-pop',
  'stash-drop',
]);
export const gitReads = new Set([
  'list',
  'state',
  'patch',
  'review',
  'show',
  'stash-show',
  'conflict',
  'history',
  'compare',
  'push-plan',
  'head-commit',
  'discard-plan',
]);
const publicReads = new Set(['state', 'history', 'compare', 'show']);
const levels = ['none', 'history', 'worktree', 'edit', 'sync', 'collaborate'];
const legacyPolicy = { default: 'collaborate', visitors: [] };
function policyFor(v) {
  if (!v || !levels.includes(v.default) || !Array.isArray(v.visitors) || v.visitors.length > 30)
    fail(400, '仓库访问策略无效。');
  const seen = new Set();
  for (const { name, level } of v.visitors) {
    if (typeof name !== 'string' || !name || name.length > 48 || seen.has(name) || !levels.includes(level))
      fail(400, '访客名称或授权无效。');
    seen.add(name);
  }
  return { default: v.default, visitors: v.visitors.map(({ name, level }) => ({ name, level })) };
}
function accessFor(repo, actor) {
  if (!actor.portal) return { visible: true, worktree: true, edit: true, sync: true };
  const p = repo.policy ?? legacyPolicy,
    level = p.visitors.find((v) => v.name === actor.visitor)?.level ?? p.default;
  return {
    visible: repo.published && level !== 'none',
    worktree: !['none', 'history'].includes(level),
    edit: actor.edit && ['edit', 'collaborate'].includes(level),
    sync: actor.sync && ['sync', 'collaborate'].includes(level),
  };
}
async function rootOf(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail(400, '请选择主机上的 Git 工作目录。');
  const root = (await git(directory, ['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '');
  return realpath(root);
}

async function status(root) {
  const raw = await git(root, [
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
    '--no-renames',
    '--untracked-files=all',
    '--ignore-submodules=dirty',
  ]);
  const headers = {},
    files = [];
  for (const entry of raw.split('\0').filter(Boolean)) {
    if (entry.startsWith('# ')) {
      const i = entry.indexOf(' ', 2);
      headers[entry.slice(2, i)] = entry.slice(i + 1);
    } else if (entry.startsWith('? ')) {
      files.push({ path: entry.slice(2), index: '.', work: '?' });
    } else {
      const unmerged = entry.startsWith('u ');
      const fields = entry.split(' ');
      files.push({
        path: fields.slice(unmerged ? 10 : 8).join(' '),
        index: fields[1][0],
        work: fields[1][1],
        conflict: unmerged,
        ...(fields[2].startsWith('S') && { submodule: true }),
      });
    }
  }
  const [ahead, behind] = (headers['branch.ab'] || '+0 -0').split(' ').map((n) => Math.abs(Number(n)));
  const head = headers['branch.oid'] === '(initial)' ? '' : headers['branch.oid'];
  const mergeHead = await mergeStatus(root);
  return {
    mergeHead,
    branch: headers['branch.head'],
    upstream: headers['branch.upstream'] || '',
    ahead,
    behind,
    head,
    files,
    revision: createHash('sha256')
      .update(raw + '\0' + mergeHead)
      .digest('hex'),
  };
}

async function refs(root) {
  const output = await git(root, [
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname)%00%(objectname)%00%(upstream:short)%00%(*objectname)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]);
  return output
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, hash, upstream, peeled] = line.split('\0');
      const [, kind, ...parts] = ref.split('/');
      return { kind, name: parts.join('/'), hash, upstream, ...(peeled && { peeled }) };
    });
}

async function stashes(root) {
  const output = await git(root, ['stash', 'list', '-100', '--format=%H%x00%gd%x00%gs%x00%ai', '-z']);
  const fields = output.split('\0'),
    result = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    const [id, ref, message, date] = fields.slice(i, i + 4);
    result.push({ id, ref, message, date });
  }
  return result;
}

async function perform(root, action, value, current, authorize, worktree) {
  const run = (args, options) => {
    authorize();
    return git(root, args, options);
  };
  if (action === 'state') {
    const [log, references, remotes, saved] = await Promise.all([
      history(root, current.head),
      refs(root),
      git(root, ['remote']),
      worktree ? stashes(root) : [],
    ]);
    return {
      ...current,
      ...log,
      worktree,
      references,
      stashes: saved,
      remotes: remotes.trim().split('\n').filter(Boolean),
    };
  }
  if (action === 'head-commit') {
    if (!current.head || current.head !== value.head) fail(409, '分支已更新，请重新核对上次提交。');
    const [parents, subject, message] = (
      await git(root, ['log', '-1', '--format=%P%x00%s%x00%B', current.head, '--'])
    ).split('\0');
    return { id: current.head, parents: parents.split(' ').filter(Boolean), subject, message: message.trimEnd() };
  }
  if (action === 'history') return history(root, current.head, value);
  if (action === 'compare') return compareCommits(root, current.head, value);
  if (action === 'show') {
    await visibleCommit(root, current.head, value.commit);
    return run(['show', '--format=fuller', '--first-parent', '--stat', '--patch', ...patches, value.commit, '--'], {
      preview: true,
    });
  }
  if (!gitReads.has(action) && value.revision !== current.revision) fail(409, '仓库已变化，请刷新后重新核对。');
  if (action === 'stash-save') {
    if (!current.head || !current.files.length || current.files.some((f) => f.conflict))
      fail(409, '贮藏需要已有提交和无冲突的本地改动。');
    if (typeof value.message !== 'string' || value.message.length > 500) fail(400, '贮藏说明最多 500 字符。');
    return run(['stash', 'push', '--include-untracked', ...(value.message.trim() ? ['-m', value.message.trim()] : [])]);
  }
  if (['stash-show', 'stash-apply', 'stash-pop', 'stash-drop'].includes(action)) {
    const removes = action === 'stash-pop' || action === 'stash-drop';
    const entry = (await stashes(root)).find((item) => item.id === value.stash && (!removes || item.ref === value.ref));
    if (!entry) fail(404, '找不到该贮藏记录，请刷新。');
    if (action === 'stash-show')
      return run(['stash', 'show', '--include-untracked', '--patch', ...patches, entry.id], { preview: true });
    if (action === 'stash-drop') return run(['stash', 'drop', entry.ref]);
    if (current.files.length) fail(409, '请先提交或贮藏当前改动，再应用贮藏。');
    if (action === 'stash-pop') return run(['stash', 'pop', '--index', entry.ref]);
    return run(['stash', 'apply', '--index', entry.id]);
  }
  if (action === 'discard-plan' || (value.files !== undefined && ['stage', 'unstage', 'discard'].includes(action))) {
    if (value.revision !== current.revision) fail(409, '文件列表已变化，请刷新后重选。');
    return applyFiles(root, current.files, action, value.files, authorize, value.token);
  }
  if (['patch', 'review', 'stage', 'unstage', 'discard', 'conflict', 'resolve'].includes(action)) {
    const staged = action === 'unstage' || (['patch', 'review'].includes(action) && value.staged);
    const file = current.files.find(
      (f) => f.path === value.path && (f.conflict || (staged ? f.index : f.work) !== '.'),
    );
    if (!file) fail(409, '文件状态已变化，请刷新。');
    if (action === 'conflict') return conflictView(root, file);
    if (action === 'resolve') return resolveConflict(root, file, value, authorize);
    if (action === 'patch' || action === 'review') {
      const review = await reviewFile(root, file, !!value.staged);
      return action === 'patch' ? review.text : review;
    }
    return applyReview(root, file, action, value, authorize);
  }
  if (action === 'merge') return startMerge(root, current, value, authorize);
  if (action === 'merge-abort' || action === 'merge-continue') {
    if (!current.mergeHead) fail(409, '当前没有进行中的合并。');
    if (action === 'merge-continue' && current.files.some((f) => f.conflict)) fail(409, '请先解决所有冲突。');
    return run(action === 'merge-abort' ? ['merge', '--abort'] : ['commit', '--no-edit']);
  }
  if (action === 'undo-commit') {
    if (
      !current.head ||
      value.head !== current.head ||
      current.branch === '(detached)' ||
      current.mergeHead ||
      current.files.some((file) => file.conflict)
    )
      fail(409, '请在没有合并冲突的本地分支上重新核对要撤销的提交。');
    const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trimEnd();
    for (const marker of ['CHERRY_PICK_HEAD', 'REVERT_HEAD', 'sequencer', 'rebase-merge', 'rebase-apply']) {
      const pending = await access(path.join(gitDir, marker)).then(
        () => true,
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return false;
        },
      );
      if (pending) fail(409, '请先完成或中止当前的 Git 操作，再撤销提交。');
    }
    // A shallow boundary still has a parent in the commit object and must never be treated as a root.
    const commit = await git(root, ['cat-file', 'commit', current.head]);
    const end = commit.indexOf('\n\n');
    const parent = /^parent ([0-9a-f]+)$/m.exec(commit.slice(0, end))?.[1];
    const message = commit.slice(end + 2).trimEnd();
    const branchRef = 'refs/heads/' + current.branch;
    const move = parent ? 'update ' + branchRef + ' ' + parent : 'delete ' + branchRef;
    // Move only the reviewed tip, keeping both the index and worktree intact (including on an unborn branch).
    await run(['update-ref', '-m', 'DevKit: undo commit', '--stdin'], {
      input: 'update ORIG_HEAD ' + current.head + '\n' + move + ' ' + current.head + '\n',
    });
    return { message };
  }
  if (action === 'commit') {
    if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 8000)
      fail(400, '请填写 1 至 8000 字符的提交信息。');
    if (current.files.some((f) => f.conflict)) fail(409, '请先解决冲突。');
    if (
      value.amendHead !== undefined &&
      (!current.head || current.head !== value.amendHead || current.mergeHead || value.stageAll)
    )
      fail(409, '请重新核对要修改的提交。');
    if (value.stageAll === true) {
      if (current.mergeHead || !current.files.length || current.files.some((file) => file.index !== '.'))
        fail(409, '暂存区已变化，请重新核对提交范围。');
      if (value.files?.length !== current.files.length) fail(409, '文件列表已变化，请重新核对。');
      await applyFiles(root, current.files, 'stage', value.files, authorize);
    }
    return run(['commit', ...(value.amendHead ? ['--amend'] : []), '-m', value.message.trim()]);
  }
  if (['create-branch', 'switch', 'tag'].includes(action)) {
    const name = value.name;
    if (typeof name !== 'string' || !name || name.startsWith('-') || name === 'HEAD' || name.length > 240)
      fail(400, '引用名称无效。');
    await git(root, ['check-ref-format', (action === 'tag' ? 'refs/tags/' : 'refs/heads/') + name]);
    if (action === 'switch' && !(await refs(root)).some((r) => r.kind === 'heads' && r.name === name))
      fail(404, '本地分支不存在。');
    if (action === 'switch' && current.files.length) fail(409, '请先提交或在主机收起工作区改动，再切换分支。');
    return run([action === 'create-branch' ? 'branch' : action, '--', name]);
  }
  const remote = value.remote;
  if (
    typeof remote !== 'string' ||
    !remote ||
    remote.startsWith('-') ||
    !(await git(root, ['remote'])).split('\n').includes(remote)
  )
    fail(400, '请选择已配置的远端。');
  if (action === 'push' || action === 'push-plan') {
    const plan = await pushPlan(root, current, remote);
    if (action === 'push-plan') return plan;
    if (plan.token !== value.token) fail(409, '推送来源或目标已变化，请重新核对。');
    if (current.mergeHead || plan.incoming) fail(409, '请先完成合并或整合远端提交。');
    await run(['push', '--no-follow-tags', '--', remote, current.head + ':refs/heads/' + plan.target], {
      network: true,
    });
    if (plan.first) {
      try {
        await run(['branch', '--set-upstream-to=' + remote + '/' + plan.target, '--', current.branch]);
      } catch (error) {
        if (!error.gitFailure) throw error;
        return { notice: '提交已推送；本机未能设置上游，请检查远端跟踪配置。' };
      }
    }
    return { notice: '已将 ' + current.head.slice(0, 8) + ' 推送至 ' + remote + '/' + plan.target };
  }
  if (action === 'fetch') return run(['fetch', '--no-recurse-submodules', '--', remote], { network: true });
  if (!current.upstream || current.branch === '(detached)') fail(409, '请先在主机为当前分支设置上游。');
  const tracking = (
    await git(root, [
      'for-each-ref',
      '--format=%(upstream:remotename)%00%(upstream:remoteref)',
      'refs/heads/' + current.branch,
    ])
  )
    .split('\n')[0]
    .split('\0');
  if (remote !== tracking[0] || !tracking[1]?.startsWith('refs/heads/')) fail(409, '请选择当前上游所在的远端。');
  if (current.files.length) fail(409, '快进拉取需要干净的工作区。');
  return run(
    [
      '-c',
      'pull.rebase=false',
      'pull',
      '--ff-only',
      '--no-rebase',
      '--no-recurse-submodules',
      '--',
      remote,
      tracking[1],
    ],
    { network: true },
  );
}

export async function createGitWorkspace(directory) {
  const filename = path.join(await configGroup(directory, 'sharing'), 'git-repositories.json');
  let repositories = await readFile(filename, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
  if (
    !Array.isArray(repositories) ||
    repositories.some(
      (r) =>
        !r ||
        typeof r.root !== 'string' ||
        !path.isAbsolute(r.root) ||
        typeof r.id !== 'string' ||
        typeof r.name !== 'string' ||
        typeof r.published !== 'boolean',
    )
  )
    throw new Error('Git 仓库登记文件无效。');
  let busy = false;
  const writing = new Set();
  for (const repo of repositories) if (repo.policy) policyFor(repo.policy);
  const list = (actor) =>
    repositories
      .filter((r) => accessFor(r, actor).visible)
      .map((r) =>
        actor.portal
          ? { id: r.id, name: r.name, published: r.published, access: accessFor(r, actor) }
          : { ...r, policy: r.policy ?? legacyPolicy },
      );
  return {
    async request(
      action,
      value = {},
      { portal = false, edit = !portal, sync = !portal, visitor = '', authorize = () => {} } = {},
    ) {
      const actor = { portal, edit, sync, visitor };
      authorize();
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '请求参数无效。');
      if (action === 'list') return list(actor);
      if (['register', 'clone', 'policy', 'publish', 'remove'].includes(action)) {
        if (portal) fail(403, '请在主机管理仓库登记。');
        if (busy || writing.size) fail(409, '仓库操作正在进行，请稍后再试。');
        busy = true;
        try {
          let next;
          if (action === 'register' || action === 'clone') {
            const root = await rootOf(
              action === 'clone' ? await cloneRepository(value.parent, value.source) : value.root,
            );
            if (repositories.some((r) => path.relative(r.root, root) === '')) fail(409, '该仓库已登记。');
            next = [
              ...repositories,
              {
                id: randomUUID(),
                root,
                name: path.basename(root),
                published: false,
                policy: { default: 'history', visitors: [] },
              },
            ];
          } else {
            if (!repositories.some((r) => r.id === value.id)) fail(404, '仓库未登记。');
            if (action === 'publish' && typeof value.published !== 'boolean') fail(400, '发布状态无效。');
            next =
              action === 'remove'
                ? repositories.filter((r) => r.id !== value.id)
                : repositories.map((r) =>
                    r.id !== value.id
                      ? r
                      : action === 'policy'
                        ? { ...r, policy: policyFor(value.policy) }
                        : { ...r, published: value.published },
                  );
          }
          await atomicFile(filename, JSON.stringify(next, null, 2));
          repositories = next;
          return list(actor);
        } finally {
          busy = false;
        }
      }
      const repo = repositories.find((r) => r.id === value.id && accessFor(r, actor).visible);
      if (!repo) fail(404, '找不到可访问的仓库。');
      const rights = accessFor(repo, actor);
      if (!rights.worktree && !publicReads.has(action)) fail(403, '此仓库仅授权查看提交历史。');
      const mutation = !gitReads.has(action);
      if (mutation) {
        if (!editActions.has(action) && !syncActions.has(action)) fail(404, 'Git 操作不存在。');
        if (syncActions.has(action) ? !rights.sync : !rights.edit) fail(403, '未获此 Git 操作权限。');
        if (busy || writing.has(repo.id)) fail(409, '另一个仓库操作正在进行，请稍后刷新。');
        writing.add(repo.id);
      }
      const verify = () => {
        authorize();
        if (
          portal &&
          !repositories.some(
            (r) =>
              r.id === repo.id &&
              accessFor(r, actor).visible &&
              JSON.stringify(accessFor(r, actor)) === JSON.stringify(rights),
          )
        )
          fail(404, '仓库已撤下。');
      };
      try {
        if (path.relative(repo.root, await rootOf(repo.root)) !== '') fail(409, '仓库位置已改变，请重新登记。');
        const current = rights.worktree
          ? await status(repo.root)
          : {
              branch:
                (await git(repo.root, ['symbolic-ref', '-q', '--short', 'HEAD'], { allowOne: true }))?.trim() ||
                '(detached)',
              head: (await git(repo.root, ['rev-parse', '-q', '--verify', 'HEAD'], { allowOne: true }))?.trim() || '',
              revision: '',
              files: [],
              mergeHead: '',
              upstream: '',
              ahead: 0,
              behind: 0,
            };
        const result = await perform(repo.root, action, value, current, verify, rights.worktree);
        verify();
        return mutation
          ? {
              ok: true,
              ...(result?.notice && { notice: result.notice }),
              ...(action === 'undo-commit' && { message: result.message }),
            }
          : result;
      } catch (error) {
        if (portal && !error.status) fail(409, '仓库文件已变化或读取失败，请刷新后重试。');
        if (error.gitFailure && /non-fast-forward|fetch first|rejected.*behind/i.test(error.message))
          fail(409, '远端分支已推进，请获取更新、比较并整合后重试。');
        if (portal && error.gitFailure) fail(400, 'Git 拒绝了操作，请由主机检查身份、凭据、分支和文件状态。');
        throw error;
      } finally {
        if (mutation) writing.delete(repo.id);
      }
    },
  };
}
