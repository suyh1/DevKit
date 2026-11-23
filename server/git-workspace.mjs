import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { atomicFile } from './atomic-file.mjs';
import { configGroup } from './config-layout.mjs';

const execute = promisify(execFile);
const patches = ['--no-ext-diff', '--no-textconv', '--no-color', '--submodule=short'];
const syncActions = new Set(['fetch', 'pull', 'push']);
const editActions = new Set([
  'stage',
  'unstage',
  'commit',
  'create-branch',
  'switch',
  'tag',
  'stash-save',
  'stash-apply',
]);
const reads = new Set(['list', 'state', 'patch', 'show', 'stash-show']);
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

// Resolve the executable outside the repository, including on Windows where cwd is searched first.
let executable;
async function gitExecutable() {
  if (executable) return executable;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, process.platform === 'win32' ? 'git.exe' : 'git');
    try {
      await access(candidate, 1);
      executable = candidate;
      return candidate;
    } catch {
      /* Try the next PATH entry. */
    }
  }
  fail(503, '主机找不到 Git，请安装 Git 并重启服务。');
}

async function git(cwd, args, { preview = false, difference = false, network = false } = {}) {
  const binary = await gitExecutable();
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_LITERAL_PATHSPECS']) delete env[key];
  const literal = ['add', 'diff', 'rm', 'restore'].includes(args[0]) ? ['--literal-pathspecs'] : [];
  try {
    const { stdout } = await execute(
      binary,
      ['--no-pager', ...literal, '-c', 'color.ui=false', '-c', 'core.quotepath=false', ...args],
      {
        cwd,
        windowsHide: true,
        timeout: network ? 60000 : 20000,
        maxBuffer: preview ? 384 * 1024 : 8 * 1024 * 1024,
        env: {
          ...env,
          LC_ALL: 'C',
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'Never',
          GIT_OPTIONAL_LOCKS: '0',
        },
      },
    );
    return stdout;
  } catch (error) {
    if (difference && error.code === 1) return error.stdout;
    if (preview && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      return error.stdout + '\n… 差异较大，仅显示前段。';
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') fail(413, '此仓库的状态或引用列表超出读取上限。');
    if (error.code === 'ENOENT') fail(503, '请确认主机已安装 Git，且仓库目录仍然存在。');
    if (error.killed) fail(408, 'Git 操作超时，请刷新仓库并检查主机状态。');
    const detail = String(error.stderr || '')
      .trim()
      .replace(/(?:https?|ssh):\/\/\S+/gi, '[远端地址]')
      .slice(0, 1200);
    throw Object.assign(new Error(detail || 'Git 操作失败，请检查仓库状态和主机配置。'), {
      status: 400,
      gitFailure: true,
    });
  }
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
      });
    }
  }
  const [ahead, behind] = (headers['branch.ab'] || '+0 -0').split(' ').map((n) => Math.abs(Number(n)));
  const head = headers['branch.oid'] === '(initial)' ? '' : headers['branch.oid'];
  return {
    branch: headers['branch.head'],
    upstream: headers['branch.upstream'] || '',
    ahead,
    behind,
    head,
    files,
    revision: createHash('sha256').update(raw).digest('hex'),
  };
}

async function history(root, head) {
  const raw = await git(root, [
    'log',
    '--topo-order',
    '--no-show-signature',
    '--branches',
    '--remotes',
    '--tags',
    ...(head ? [head] : []),
    '-201',
    '--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%D',
    '-z',
    '--',
  ]);
  const fields = raw.split('\0'),
    commits = [];
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const [id, parents, author, date, subject, refs] = fields.slice(i, i + 6);
    commits.push({ id, parents: parents.split(' ').filter(Boolean), author, date, subject, refs });
  }
  return { commits: commits.slice(0, 200), more: commits.length > 200 };
}

async function refs(root) {
  const output = await git(root, [
    'for-each-ref',
    '--sort=refname',
    '--format=%(refname)%00%(objectname:short)%00%(upstream:short)',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ]);
  return output
    .trimEnd()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref, hash, upstream] = line.split('\0');
      const [, kind, ...parts] = ref.split('/');
      return { kind, name: parts.join('/'), hash, upstream };
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

async function perform(root, action, value, current, authorize) {
  const run = (args, options) => {
    authorize();
    return git(root, args, options);
  };
  if (action === 'state') {
    const [log, references, remotes, saved] = await Promise.all([
      history(root, current.head),
      refs(root),
      git(root, ['remote']),
      stashes(root),
    ]);
    return { ...current, ...log, references, stashes: saved, remotes: remotes.trim().split('\n').filter(Boolean) };
  }
  if (action === 'show') {
    if (!(await history(root, current.head)).commits.some((item) => item.id === value.commit))
      fail(404, '该提交不在当前历史窗口中。');
    return run(['show', '--format=fuller', '--first-parent', '--stat', '--patch', ...patches, value.commit, '--'], {
      preview: true,
    });
  }
  if (!reads.has(action) && value.revision !== current.revision) fail(409, '仓库已变化，请刷新后重新核对。');
  if (action === 'stash-save') {
    if (!current.head || !current.files.length || current.files.some((f) => f.conflict))
      fail(409, '贮藏需要已有提交和无冲突的本地改动。');
    if (typeof value.message !== 'string' || value.message.length > 500) fail(400, '贮藏说明最多 500 字符。');
    return run(['stash', 'push', '--include-untracked', ...(value.message.trim() ? ['-m', value.message.trim()] : [])]);
  }
  if (action === 'stash-show' || action === 'stash-apply') {
    const entry = (await stashes(root)).find((item) => item.id === value.stash);
    if (!entry) fail(404, '找不到该贮藏记录，请刷新。');
    if (action === 'stash-show')
      return run(['stash', 'show', '--include-untracked', '--patch', ...patches, entry.id], { preview: true });
    if (current.files.length) fail(409, '请先提交或贮藏当前改动，再应用贮藏。');
    return run(['stash', 'apply', '--index', entry.id]);
  }
  if (['patch', 'stage', 'unstage'].includes(action)) {
    const file = current.files.find((item) => item.path === value.path);
    if (!file) fail(409, '文件状态已变化，请刷新。');
    if (action === 'patch') {
      if (file.work === '?' && !value.staged) {
        const target = path.resolve(root, file.path);
        const relative = path.relative(root, await realpath(path.dirname(target)));
        if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
          fail(409, '文件位置已变化。');
        const info = await lstat(target);
        if (!info.isFile() && !info.isSymbolicLink()) return '嵌套仓库或特殊文件，仅显示状态。';
        return run(['diff', ...patches, '--no-index', '--', '/dev/null', file.path], {
          preview: true,
          difference: true,
        });
      }
      return run(['diff', ...patches, ...(value.staged ? ['--cached'] : []), '--', file.path], { preview: true });
    }
    if (action === 'stage') return run(['add', '--', file.path]);
    if (file.conflict) fail(409, '请在主机解决文件冲突。');
    return run(current.head ? ['restore', '--staged', '--', file.path] : ['rm', '--cached', '--', file.path]);
  }
  if (action === 'commit') {
    if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 8000)
      fail(400, '请填写 1 至 8000 字符的提交信息。');
    if (current.files.some((f) => f.conflict)) fail(409, '请先解决冲突。');
    return run(['commit', '-m', value.message.trim()]);
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
  if (action === 'push')
    return run(['push', '--no-follow-tags', '--', remote, 'HEAD:' + tracking[1]], { network: true });
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
        typeof r.root !== 'string' || !path.isAbsolute(r.root) ||
        typeof r.id !== 'string' ||
        typeof r.name !== 'string' ||
        typeof r.published !== 'boolean',
    )
  )
    throw new Error('Git 仓库登记文件无效。');
  let busy = false;
  const writing = new Set();
  const list = (portal) =>
    repositories.filter((r) => !portal || r.published).map(({ id, name, published, root }) => (portal ? { id, name, published } : { id, name, published, root }));
  return {
    async request(action, value = {}, { portal = false, edit = !portal, sync = !portal, authorize = () => {} } = {}) {
      authorize();
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '请求参数无效。');
      if (action === 'list') return list(portal);
      if (['register', 'publish', 'remove'].includes(action)) {
        if (portal) fail(403, '请在主机管理仓库登记。');
        if (busy || writing.size) fail(409, '仓库操作正在进行，请稍后再试。');
        busy = true;
        try {
          let next;
          if (action === 'register') {
            const root = await rootOf(value.root);
            if (repositories.some((r) => path.relative(r.root, root) === '')) fail(409, '该仓库已登记。');
            next = [...repositories, { id: randomUUID(), root, name: path.basename(root), published: false }];
          } else {
            if (!repositories.some((r) => r.id === value.id)) fail(404, '仓库未登记。');
            if (action === 'publish' && typeof value.published !== 'boolean') fail(400, '发布状态无效。');
            next =
              action === 'remove'
                ? repositories.filter((r) => r.id !== value.id)
                : repositories.map((r) => (r.id === value.id ? { ...r, published: value.published } : r));
          }
          await atomicFile(filename, JSON.stringify(next, null, 2));
          repositories = next;
          return list(false);
        } finally {
          busy = false;
        }
      }
      const repo = repositories.find((r) => r.id === value.id && (!portal || r.published));
      if (!repo) fail(404, '找不到可访问的仓库。');
      const mutation = !reads.has(action);
      if (mutation) {
        if (!editActions.has(action) && !syncActions.has(action)) fail(404, 'Git 操作不存在。');
        if (syncActions.has(action) ? !sync : !edit) fail(403, '未获此 Git 操作权限。');
        if (busy || writing.has(repo.id)) fail(409, '另一个仓库操作正在进行，请稍后刷新。');
        writing.add(repo.id);
      }
      const verify = () => {
        authorize();
        if (portal && !repositories.some((r) => r.id === repo.id && r.published)) fail(404, '仓库已撤下。');
      };
      try {
        if (path.relative(repo.root, await rootOf(repo.root)) !== '') fail(409, '仓库位置已改变，请重新登记。');
        const current = await status(repo.root);
        const result = await perform(repo.root, action, value, current, verify);
        verify();
        return mutation ? { ok: true } : result;
      } catch (error) {
        if (portal && !error.status) fail(409, '仓库文件已变化或读取失败，请刷新后重试。');
        if (portal && error.gitFailure) fail(400, 'Git 拒绝了操作，请由主机检查身份、凭据、分支和文件状态。');
        throw error;
      } finally {
        if (mutation) writing.delete(repo.id);
      }
    },
  };
}
