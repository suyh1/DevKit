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
    ...(process.platform === 'win32' ? [prefix && path.join(prefix, 'nginx.exe'), main && path.join(path.dirname(main), 'nginx.exe'), 'C:\\nginx\\nginx.exe', 'D:\\nginx\\nginx.exe'] : ['/opt/homebrew/bin/nginx', '/usr/local/bin/nginx', '/usr/sbin/nginx', '/usr/local/nginx/sbin/nginx', '/usr/local/sbin/nginx', '/opt/nginx/sbin/nginx']),
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
    if (process.platform === 'darwin') {
      const env = { ...process.env, LC_ALL: 'C' };
      const [{ stdout: statOut }, { stdout: argsOut }] = await Promise.all([
        execute('ps', ['-ww', '-p', String(pid), '-o', 'stat='], { timeout: 3000, maxBuffer: 16384, env }),
        execute('ps', ['-ww', '-p', String(pid), '-o', 'args='], { timeout: 3000, maxBuffer: 262144, env }),
      ]);
      if (!statOut.trim() || statOut.trim().startsWith('Z')) return null;
      let executable = '';
      try {
        const { stdout: lsofOut } = await execute('lsof', ['-Fn', '-a', '-p', String(pid), '-d', 'txt'], { timeout: 3000, maxBuffer: 262144 });
        let inText = false;
        for (const line of lsofOut.split('\n')) {
          if (line === 'ftxt') { inText = true; continue; }
          if (line.startsWith('f')) { inText = false; continue; }
          if (inText && line.startsWith('n/')) { executable = await realpath(line.slice(1).trim()).catch(() => line.slice(1).trim()); break; }
        }
      } catch { /* Fall back to ps comm=. */ }
      if (!executable) {
        const { stdout: commOut } = await execute('ps', ['-ww', '-p', String(pid), '-o', 'comm='], { timeout: 3000, maxBuffer: 65536, env });
        const comm = commOut.trim();
        executable = comm ? await realpath(comm).catch(() => comm) : '';
      }
      return { pid, executable, commandLine: argsOut.trim() };
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
export async function inspectNginxWorkers(pid, executable) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    if (process.platform === 'win32') {
      const script = `$children = @(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}' | Select-Object ProcessId, ExecutablePath); ConvertTo-Json -InputObject $children -Compress`;
      const { stdout } = await execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 3500, maxBuffer: 65536 });
      return JSON.parse(stdout.replace(/^\uFEFF/, '')).filter(item => item.ExecutablePath && pathKey(item.ExecutablePath) === pathKey(executable)).map(item => item.ProcessId);
    }
    if (process.platform === 'linux') {
      const children = (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(id => /^\d+$/.test(id));
      const workers = await Promise.all(children.map(async id => {
        const line = await readFile(`/proc/${id}/cmdline`, 'utf8').catch(() => '');
        return /^nginx: worker process(?:\s|\0|$)/.test(line) ? Number(id) : null;
      }));
      return workers.filter(Boolean);
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,args='], { timeout: 3500, maxBuffer: 512 * 1024, env: { ...process.env, LC_ALL: 'C' } });
      const workers = [];
      for (const line of stdout.split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        if (match && Number(match[2]) === pid && /^nginx: worker process(?:\s|$)/.test(match[3])) workers.push(Number(match[1]));
      }
      return workers;
    }
  } catch { /* An unavailable process listing cannot verify a reload. */ }
  return null;
}
export function processMatches(instance, info) {
  if (!info?.executable || !info.commandLine || pathKey(info.executable) !== pathKey(instance.executable)) return false;
  const command = process.platform === 'win32' ? info.commandLine.replaceAll('\\', '/').toLowerCase() : info.commandLine;
  const main = process.platform === 'win32' ? instance.main.replaceAll('\\', '/').toLowerCase() : instance.main;
  const escaped = main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)-c\\s+(?:"${escaped}"|'${escaped}'|${escaped})(?=\\s|$)`).test(command);
}
