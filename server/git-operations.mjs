import path from 'node:path';
import { mkdir, realpath, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { git, patches, fail } from './git-command.mjs';

const oid = (value) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
export async function visibleCommit(root, head, id) {
  if (!oid(id)) fail(404, '提交不存在。');
  if (id === head) return id;
  const refs = await git(root, [
    'for-each-ref',
    '--count=1',
    '--format=%(refname)',
    '--contains=' + id,
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]);
  if (
    !refs.trim() &&
    (!head || (await git(root, ['merge-base', '--is-ancestor', id, head], { allowOne: true })) === null)
  )
    fail(404, '提交不在可浏览的历史中。');
  return id;
}
export async function history(
  root,
  head,
  { offset = 0, path: file = '', query = '', field = 'message', snapshot } = {},
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    typeof file !== 'string' ||
    file.length > 4096 ||
    file.includes('\0') ||
    typeof query !== 'string' ||
    query.length > 240 ||
    !['message', 'author', 'ref', 'hash'].includes(field)
  )
    fail(400, '历史筛选条件无效。');
  const refList = await git(root, [
    'for-each-ref',
    '--format=%(objectname) %(refname)',
    'refs/heads',
    'refs/tags',
    'refs/remotes',
  ]);
  const version = createHash('sha256')
    .update(head + '\0' + refList)
    .digest('hex');
  if (offset && snapshot !== version) fail(409, '分支已更新，请从第一页重新加载历史。');
  let scope = ['--branches', '--remotes', '--tags', ...(head ? [head] : [])];
  const filter = [];
  if (query) {
    if (field === 'hash') {
      if (!/^[a-f0-9]{4,64}$/i.test(query)) fail(400, '请输入至少 4 位提交哈希。');
      const id = (await git(root, ['rev-parse', '--verify', query + '^{commit}'])).trim();
      scope = [await visibleCommit(root, head, id)];
      filter.push('--no-walk');
    } else if (field === 'ref') {
      scope = refList
        .trimEnd()
        .split('\n')
        .map((row) => row.slice(row.indexOf(' ') + 1))
        .filter((ref) => ref && ref.toLowerCase().includes(query.toLowerCase()));
      if (!scope.length) return { commits: [], more: false, snapshot: version };
    } else filter.push('-i', '--fixed-strings', (field === 'author' ? '--author=' : '--grep=') + query);
  }
  const raw = await git(root, [
    'log',
    '--topo-order',
    '--no-show-signature',
    ...filter,
    ...scope,
    '--skip=' + offset,
    '-201',
    '--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%D',
    '-z',
    '--',
    ...(file ? [file] : []),
  ]);
  const fields = raw.split('\0'),
    commits = [];
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const [id, parents, author, date, subject, refs] = fields.slice(i, i + 6);
    commits.push({ id, parents: parents.split(' ').filter(Boolean), author, date, subject, refs });
  }
  return { commits: commits.slice(0, 200), more: commits.length > 200, snapshot: version };
}
export async function compareCommits(root, head, value) {
  const [base, target] = await Promise.all([
    visibleCommit(root, head, value.base),
    visibleCommit(root, head, value.target),
  ]);
  return git(root, ['diff', ...patches, '--stat', '--patch', base, target, '--'], { preview: true });
}
export async function mergeStatus(root) {
  const value = await git(root, ['rev-parse', '--verify', '-q', 'MERGE_HEAD'], { allowOne: true });
  return value?.trim() || '';
}
export async function startMerge(root, current, value, authorize) {
  if (current.mergeHead || current.files.length || !current.head || current.branch === '(detached)')
    fail(409, '合并分支需要干净的本地分支。');
  if (
    !oid(value.target) ||
    typeof value.name !== 'string' ||
    (!value.name.startsWith('refs/heads/') && !value.name.startsWith('refs/remotes/'))
  )
    fail(400, '请选择分支。');
  const exact = (await git(root, ['show-ref', '--verify', '--hash', value.name])).trim();
  if (exact !== value.target) fail(409, '目标分支已变化，请重新比较。');
  authorize();
  try {
    await git(root, ['merge', '--ff', '--no-commit', '--no-edit', exact]);
  } catch (error) {
    if (!(await mergeStatus(root))) throw error;
    return { notice: '合并已开始，请逐文件解决冲突。' };
  }
  return { notice: (await mergeStatus(root)) ? '合并结果已暂存，请核对后完成合并。' : '分支已同步。' };
}
export async function pushPlan(root, current, remote) {
  if (!current.head || current.branch === '(detached)') fail(409, '请先在本地分支创建提交。');
  const tracking = (
    await git(root, [
      'for-each-ref',
      '--format=%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)',
      'refs/heads/' + current.branch,
    ])
  )
    .trimEnd()
    .split('\0');
  if (tracking[0] && tracking[0] !== remote) fail(409, '当前分支的上游位于 ' + tracking[0] + '。');
  const target = tracking[1] || 'refs/heads/' + current.branch;
  if (!target.startsWith('refs/heads/')) fail(409, '上游不是分支。');
  const cached = tracking[2] || 'refs/remotes/' + remote + '/' + current.branch;
  const known = (await git(root, ['rev-parse', '--verify', '-q', cached + '^{commit}'], { allowOne: true }))?.trim();
  const range = known ? [known + '..' + current.head] : [current.head, '--not', '--remotes=' + remote];
  const total = Number(await git(root, ['rev-list', '--count', ...range]));
  const incoming = known ? Number(await git(root, ['rev-list', '--count', current.head + '..' + known])) : 0;
  const log = await git(root, ['log', '--no-show-signature', '--format=%h %s', '-6', ...range]);
  const destination = await git(root, ['remote', 'get-url', '--push', '--all', remote]);
  const token = createHash('sha256')
    .update(JSON.stringify([current.head, current.branch, remote, target, known, destination]))
    .digest('hex');
  return {
    remote,
    target: target.slice(11),
    first: !tracking[0],
    total,
    incoming,
    commits: log.trimEnd().split('\n').filter(Boolean),
    token,
  };
}
export async function cloneRepository(parent, source) {
  if (
    typeof parent !== 'string' ||
    !path.isAbsolute(parent) ||
    typeof source !== 'string' ||
    source.length > 2048 ||
    /[\x00-\x1f]/.test(source)
  )
    fail(400, '请选择父目录并填写仓库地址。');
  const local = path.isAbsolute(source);
  if (
    !local &&
    !/^https:\/\/[^@\s/]+\/[^\s]+$/i.test(source) &&
    !/^ssh:\/\/(?:[\w.-]+@)?[\w.-]+(?::\d+)?\/[^\s]+$/.test(source) &&
    !/^[\w.-]+@[\w.-]+:[\w./-]+$/.test(source)
  )
    fail(400, '支持 HTTPS、SSH 或主机本地仓库路径。');
  const name = source
    .replace(/[/\\]+$/, '')
    .split(/[/:\\]/)
    .at(-1)
    ?.replace(/\.git$/i, '');
  if (!name || name === '.' || name === '..' || /[<>:"|?*]/.test(name) || name.endsWith('.'))
    fail(400, '无法从地址取得有效仓库名。');
  const target = path.join(await realpath(parent), name);
  try {
    await mkdir(target);
  } catch (e) {
    if (e.code === 'EEXIST') fail(409, '目标目录已存在，请另选父目录或登记已有仓库。');
    throw e;
  }
  try {
    await git(
      target,
      [
        '-c',
        'protocol.allow=never',
        '-c',
        'protocol.https.allow=always',
        '-c',
        'protocol.ssh.allow=always',
        ...(local ? ['-c', 'protocol.file.allow=always'] : []),
        'clone',
        '--no-local',
        '--no-recurse-submodules',
        '--',
        source,
        '.',
      ],
      { network: true },
    );
  } catch (e) {
    await rmdir(target).catch(() => {});
    throw e;
  }
  return target;
}
