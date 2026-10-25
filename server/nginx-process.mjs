import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const execute = promisify(execFile);
export const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
export async function runNginx(executable, args, prefix, timeout = 12000) {
  try {
    const result = await execute(executable, args, { cwd: prefix, windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8', shell: false });
    return { ok: true, code: 0, output: (result.stdout + result.stderr).trim() };
  } catch (error) {
    return { ok: false, code: typeof error.code === 'number' ? error.code : null, output: [error.stdout, error.stderr, error.killed ? '命令执行超时。' : !error.stdout && !error.stderr ? error.message : ''].filter(Boolean).join('\n').trim() };
  }
}
export function nginxArgs(instance, action) {
  const prefix = instance.prefix.replaceAll('\\', '/').replace(/\/?$/, '/');
  const args = ['-p', prefix, '-c', instance.main.replaceAll('\\', '/')];
  if (action === 'test') args.push('-t');
  else if (action === 'reload' || action === 'stop') args.push('-s', action === 'stop' ? 'quit' : 'reload');
  else if (action !== 'start') throw new Error('不支持的 Nginx 命令。');
  return args;
}
export async function launchNginx(executable, args, prefix) {
  const child = spawn(executable, args, { cwd: prefix, windowsHide: true, detached: true, stdio: 'ignore', shell: false });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
  child.unref();
}
export async function detectNginx({ executable = '', main = '', prefix = '' } = {}) {
  const candidates = executable ? [executable] : [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir.replace(/^"|"$/g, ''), process.platform === 'win32' ? 'nginx.exe' : 'nginx')),
    ...(process.platform === 'win32' ? [prefix && path.join(prefix, 'nginx.exe'), main && path.join(path.dirname(main), 'nginx.exe'), 'C:\\nginx\\nginx.exe', 'D:\\nginx\\nginx.exe'] : ['/usr/sbin/nginx', '/usr/local/nginx/sbin/nginx', '/usr/local/sbin/nginx', '/opt/nginx/sbin/nginx']),
  ].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    if (!path.isAbsolute(candidate) || /[\0\r\n]/.test(candidate)) continue;
    try {
      const resolved = await realpath(candidate);
      if (!(await stat(resolved)).isFile() || (process.platform === 'win32' && path.extname(resolved).toLowerCase() !== '.exe')) continue;
      await access(resolved, process.platform === 'win32' ? 0 : 1);
      const result = await runNginx(resolved, ['-V'], path.dirname(resolved), 3500);
      if (!result.ok || !/nginx version:\s*nginx\//i.test(result.output)) continue;
      const compiledPrefix = result.output.match(/--prefix=(?:'([^']*)'|"([^"]*)"|(\S+))/);
      const compiledPid = result.output.match(/--pid-path=(?:'([^']*)'|"([^"]*)"|(\S+))/);
      return { found: true, executable: resolved, version: result.output.split(/\r?\n/)[0], output: result.output,
        prefix: process.platform === 'win32' ? path.dirname(resolved) : (compiledPrefix?.slice(1).find(Boolean) || '/usr/local/nginx'),
        pid: compiledPid?.slice(1).find(Boolean) || 'logs/nginx.pid', platform: process.platform };
    } catch { /* Continue to the next installation. */ }
  }
  return { found: false, executable: '', prefix: '', pid: '', version: '', platform: process.platform, output: executable ? '指定文件不是可执行的 nginx，请检查路径与权限。' : '未检测到 nginx，请选择 nginx 可执行文件或填写绝对路径。' };
}
export async function inspectNginxProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const executable = await realpath(`/proc/${pid}/exe`);
      const commandLine = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).replaceAll('\0', ' ').trim();
      return { pid, executable, commandLine };
    }
    if (process.platform === 'win32') {
      // PID is validated as an integer; no user-supplied script or shell command is accepted.
      const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){@{pid=$p.ProcessId;executable=$p.ExecutablePath;commandLine=$p.CommandLine}|ConvertTo-Json -Compress}`;
      const { stdout } = await execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 5000, maxBuffer: 65536 });
      return JSON.parse(stdout.replace(/^\uFEFF/, ''));
    }
    return { pid, unknown: true };
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return null;
    return { pid, unknown: true };
  }
}
export function processMatches(instance, info) {
  if (!info?.executable || !info.commandLine || pathKey(info.executable) !== pathKey(instance.executable)) return false;
  const command = process.platform === 'win32' ? info.commandLine.replaceAll('\\', '/').toLowerCase() : info.commandLine;
  const main = process.platform === 'win32' ? instance.main.replaceAll('\\', '/').toLowerCase() : instance.main;
  const escaped = main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)-c\\s+(?:"${escaped}"|'${escaped}'|${escaped})(?=\\s|$)`).test(command);
}
