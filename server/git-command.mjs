import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export const patches = ['--no-ext-diff', '--no-textconv', '--no-color', '--submodule=short', '--no-renames'];
export const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};

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
    } catch {}
  }
  fail(503, '主机找不到 Git，请安装 Git 并重启服务。');
}

export async function git(
  cwd,
  args,
  { preview = false, difference = false, network = false, bytes = false, input, limit, allowOne = false } = {},
) {
  const binary = await gitExecutable(),
    env = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_LITERAL_PATHSPECS',
  ])
    delete env[key];
  const literal = ['add', 'diff', 'rm', 'restore', 'checkout', 'ls-files', 'log', 'ls-tree'].includes(args[0])
    ? ['--literal-pathspecs']
    : [];
  return new Promise((resolve, reject) => {
    const proc = execFile(
      binary,
      ['--no-pager', ...literal, '-c', 'color.ui=false', '-c', 'core.quotepath=false', ...args],
      {
        cwd,
        windowsHide: true,
        timeout: network ? 120000 : 20000,
        maxBuffer: limit ?? (preview ? 384 * 1024 : 8 * 1024 * 1024),
        encoding: bytes ? 'buffer' : 'utf8',
        env: {
          ...env,
          LC_ALL: 'C',
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'Never',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_MERGE_AUTOEDIT: 'no',
          GIT_EDITOR: 'true',
        },
      },
      (error, stdout, stderr) => {
        if (!error || (difference && error.code === 1)) return resolve(stdout);
        if (allowOne && error.code === 1) return resolve(null);
        if (preview && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
          return resolve(stdout + '\n… 差异较大，仅显示前段。');
        const detail = String(stderr || '')
          .trim()
          .replace(/(?:https?|ssh):\/\/\S+/gi, '[远端地址]')
          .slice(0, 1200);
        const size = error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        reject(
          Object.assign(
            new Error(
              size
                ? '输出超过处理上限，请缩小范围或在主机处理。'
                : error.killed
                  ? 'Git 操作超时，请刷新后检查状态。'
                  : detail || 'Git 操作失败，请检查主机状态。',
            ),
            { status: size ? 413 : error.killed ? 408 : 400, gitFailure: !size && !error.killed },
          ),
        );
      },
    );
    proc.stdin.on('error', () => {
      /* Git reports early exits through its completion callback. */
    });
    proc.stdin.end(input);
  });
}
