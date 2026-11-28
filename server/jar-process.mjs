import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readlink, realpath, stat, access } from 'node:fs/promises';
import path from 'node:path';

const execute = promisify(execFile);
export const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
export const powerShellError = value => (value || '').replace(/#< CLIXML\s*/g, '').replace(/<Objs[\s\S]*?<\/Objs>/g, '').trim();
async function ps(script) {
  script = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $ProgressPreference='SilentlyContinue'; try { " + script + "; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  try { return await execute(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 }); }
  catch (error) { throw new Error(powerShellError(error.stderr) || 'Windows 进程操作失败或超时。'); }
}
export async function protectSupervisorFile(filename) {
  if (process.platform !== 'win32') return;
  const literal = "'" + filename.replaceAll("'", "''") + "'";
  await ps(`$ErrorActionPreference='Stop'; $acl=New-Object System.Security.AccessControl.FileSecurity; $acl.SetAccessRuleProtection($true,$false); $user=[Security.Principal.WindowsIdentity]::GetCurrent().User; $system=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18'); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($user,'FullControl','Allow'))); $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($system,'FullControl','Allow'))); [IO.File]::SetAccessControl(${literal},$acl)`);
}
export async function detectJava({ executable = '', env = process.env, resolveHome = false } = {}) {
  const name = process.platform === 'win32' ? 'java.exe' : 'java';
  const candidates = executable ? [executable] : [env.JAVA_HOME && path.join(env.JAVA_HOME, 'bin', name), ...(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir.replace(/^"|"$/g, ''), name))].filter(Boolean);
  for (const candidate of [...new Set(candidates)]) {
    try {
      if (!path.isAbsolute(candidate) || /[\0\r\n]/.test(candidate)) continue;
      const resolved = await realpath(candidate);
      if (!(await stat(resolved)).isFile() || (process.platform === 'win32' && path.extname(resolved).toLowerCase() !== '.exe')) continue;
      await access(resolved, process.platform === 'win32' ? 0 : 1);
      const args = resolveHome ? ['-XshowSettings:properties', '-version'] : ['-version'];
      const { stdout, stderr } = await execute(resolved, args, { windowsHide: true, timeout: 3500, maxBuffer: 65536, shell: false });
      const output = (stdout + stderr).trim();
      const version = output.match(/(?:java|openjdk)\s+version\s+"[^"\r\n]+"[^\r\n]*/i);
      if (!version) continue;
      const javaHome = resolveHome && output.match(/^\s*java\.home = (.+)$/m)?.[1].trim();
      const actual = javaHome && path.isAbsolute(javaHome) && await realpath(path.join(javaHome, 'bin', name)).catch(() => '');
      return { found: true, executable: actual || resolved, version: version[0], output };
    } catch { /* Try the next configured location. */ }
  }
  return { found: false, executable: '', version: '', output: executable ? '指定 Java 不可用，请检查路径与执行权限。' : '未检测到 Java，请安装 JRE/JDK 并设置 JAVA_HOME 或 PATH，也可为此 JAR 指定 Java。' };
}

// Parse the quoting used by Windows CreateProcess/CommandLineToArgvW.
export function windowsArguments(command) {
  const result = []; let token = '', quoted = false, active = false;
  for (let i = 0; i < command.length; i++) {
    let c = command[i];
    if (c === '\\') {
      let count = 1; while (command[i + 1] === '\\') { count++; i++; }
      if (command[i + 1] === '"') {
        token += '\\'.repeat(Math.floor(count / 2)); i++;
        if (count % 2) token += '"'; else quoted = !quoted;
      } else token += '\\'.repeat(count);
      active = true; continue;
    }
    if (c === '"') { quoted = !quoted; active = true; }
    else if (/\s/.test(c) && !quoted) { if (active) result.push(token); token = ''; active = false; }
    else { token += c; active = true; }
  }
  if (active) result.push(token);
  return result;
}
export function matchesJar(item, info, identity) {
  if (!info || info.unknown || !info.executable || !Array.isArray(info.args)) return false;
  const index = info.args.indexOf('-jar');
  if (index < 0 || !info.args[index + 1] || !path.isAbsolute(info.args[index + 1]) || pathKey(info.args[index + 1]) !== pathKey(item.jar)) return false;
  return !!identity && identity.pid === info.pid && identity.created === info.created && pathKey(identity.executable) === pathKey(info.executable) && pathKey(identity.jar) === pathKey(item.jar);
}
function parseDarwinCpuTime(value) {
  const [daysPart, rest] = value.includes('-') ? value.split('-') : ['0', value];
  const parts = rest.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  return Number(daysPart) * 86400 + seconds;
}
async function darwinExecutable(pid) {
  try {
    const { stdout } = await execute('lsof', ['-Fn', '-a', '-p', String(pid), '-d', 'txt'], { timeout: 3000, maxBuffer: 262144 });
    let inText = false;
    for (const line of stdout.split('\n')) {
      if (line === 'ftxt') { inText = true; continue; }
      if (line.startsWith('f')) { inText = false; continue; }
      if (inText && line.startsWith('n/')) {
        const candidate = line.slice(1).trim();
        return await realpath(candidate).catch(() => candidate);
      }
    }
  } catch { /* Fall back to ps comm=. */ }
  const { stdout } = await execute('ps', ['-ww', '-p', String(pid), '-o', 'comm='], { timeout: 3000, maxBuffer: 65536, env: { ...process.env, LC_ALL: 'C' } });
  const comm = stdout.trim();
  return comm ? await realpath(comm).catch(() => comm) : '';
}
function splitDarwinArgs(commandLine, executable, comm) {
  const trimmed = commandLine.trim();
  if (!trimmed) return [];
  for (const prefix of [comm, executable].filter(Boolean)) {
    if (trimmed === prefix) return [executable || prefix];
    if (trimmed.startsWith(`${prefix} `)) {
      const rest = trimmed.slice(prefix.length + 1).trim();
      return [executable || prefix, ...(rest ? rest.split(/\s+/) : [])];
    }
  }
  return trimmed.split(/\s+/);
}
export async function inspectJava(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const exeLink = `/proc/${pid}/exe`;
      const [target, cmd, raw, status, uptime] = await Promise.all([readlink(exeLink), readFile(`/proc/${pid}/cmdline`, 'utf8'), readFile(`/proc/${pid}/stat`, 'utf8'), readFile(`/proc/${pid}/status`, 'utf8'), readFile('/proc/uptime', 'utf8')]);
      const fields = raw.slice(raw.lastIndexOf(')') + 2).trim().split(/\s+/);
      if (['Z', 'X'].includes(fields[0])) return null;
      // Linux keeps the old inode executable after a package upgrade unlinks it.
      // A real filename can also end in " (deleted)". Preserve it when still linked.
      const marker = ' (deleted)';
      const executableDeleted = target.endsWith(marker) && (await stat(exeLink)).nlink === 0;
      const executable = executableDeleted ? target.slice(0, -marker.length) : target;
      // Linux exports start time in clock ticks; getconf provides the platform rate.
      const ticks = await clockTicks();
      return { pid, executable, executableDeleted, args: cmd.split('\0').slice(0, -1), created: fields[19], uptime: Math.max(0, Number(uptime.split(' ')[0]) - Number(fields[19]) / ticks), memory: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0) * 1024, cpuSeconds: (Number(fields[11]) + Number(fields[12])) / ticks };
    }
    if (process.platform === 'darwin') {
      const env = { ...process.env, LC_ALL: 'C' };
      const [meta, cmd, comm, executable] = await Promise.all([
        execute('ps', ['-ww', '-p', String(pid), '-o', 'stat=,rss=,cputime=,lstart='], { timeout: 3000, maxBuffer: 65536, env }),
        execute('ps', ['-ww', '-p', String(pid), '-o', 'args='], { timeout: 3000, maxBuffer: 262144, env }),
        execute('ps', ['-ww', '-p', String(pid), '-o', 'comm='], { timeout: 3000, maxBuffer: 65536, env }),
        darwinExecutable(pid),
      ]);
      const match = /^\s*(\S+)\s+(\d+)\s+((?:\d+-)?(?:\d+:)?\d+:\d+(?:\.\d+)?)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s*$/.exec(meta.stdout.trim());
      if (!match) return null;
      if (match[1].startsWith('Z')) return null;
      const startMs = Date.parse(match[4]);
      if (!Number.isFinite(startMs)) return { pid, unknown: true };
      const resolvedExec = executable || comm.stdout.trim();
      return {
        pid,
        executable: resolvedExec,
        args: splitDarwinArgs(cmd.stdout, resolvedExec, comm.stdout.trim()),
        created: String(Math.floor(startMs / 1000)),
        uptime: Math.max(0, (Date.now() - startMs) / 1000),
        memory: Number(match[2]) * 1024,
        cpuSeconds: parseDarwinCpuTime(match[3]),
      };
    }
    if (process.platform === 'win32') {
      const { stdout } = await ps(`$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){@{pid=[int]$p.ProcessId;executable=$p.ExecutablePath;command=$p.CommandLine;created=$p.CreationDate.ToUniversalTime().Ticks.ToString();uptime=([DateTime]::UtcNow-$p.CreationDate.ToUniversalTime()).TotalSeconds;memory=[double]$p.WorkingSetSize;cpuSeconds=([double]$p.KernelModeTime+[double]$p.UserModeTime)/10000000}|ConvertTo-Json -Compress}`);
      if (!stdout.trim()) return null;
      const info = JSON.parse(stdout.replace(/^\uFEFF/, ''));
      return { ...info, args: windowsArguments(info.command || '') };
    }
    return { pid, unknown: true };
  } catch (error) {
    if (error.code === 'ESRCH' || error.code === 'ENOENT') return null;
    return { pid, unknown: true };
  }
}
let ticksPromise;
function clockTicks() {
  return ticksPromise ||= execute('getconf', ['CLK_TCK'], { timeout: 3000 }).then(({ stdout }) => {
    const value = Number(stdout.trim()); if (!(value > 0)) throw new Error('无法读取系统时钟频率'); return value;
  }).catch(error => { ticksPromise = undefined; throw error; });
}
// A managed launcher acknowledges only after containment and the business spawn succeed.
export function waitForLaunch(child, job) {
  return new Promise((resolve, reject) => {
    const timer = job && setTimeout(() => { child.kill(); finish(new Error('建立服务进程组超时。')); }, 20000);
    const spawned = () => { if (!job) finish(); };
    const reply = value => value.ready ? finish(null, value.pid) : finish(new Error(value.error || '服务启动失败。'));
    const exited = () => finish(new Error('服务启动进程提前退出。'));
    function finish(error, pid) {
      clearTimeout(timer);
      child.off('spawn', spawned).off('message', reply).off('exit', exited).off('error', finish);
      if (error) reject(error); else resolve(pid);
    }
    child.once('spawn', spawned).once('exit', exited).once('error', finish);
    if (job) child.once('message', reply);
  });
}
export async function launchJar(executable, args, cwd, output, env = process.env, job = false) {
  const child = spawn(executable, args, { cwd, env: job ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env, detached: true, windowsHide: true, stdio: ['ignore', output ?? 'ignore', output ?? 'ignore', ...(job ? ['ipc'] : [])], shell: false });
  let exit;
  child.on('exit', (code, signal) => { exit = { code, signal }; });
  const businessPid = await waitForLaunch(child, job);
  child.unref();
  return { pid: child.pid, businessPid, exit: () => exit };
}
export async function signalJava(pid, force, created, job = false) {
  if (process.platform === 'win32') {
    // Re-check creation time inside the OS operation as well as in the manager.
    if (!/^\d+$/.test(created)) throw new Error('进程创建标识无效。');
    await ps(`$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if(!$p -or $p.CreationDate.ToUniversalTime().Ticks.ToString() -ne '${created}'){throw 'Process identity changed'}; Stop-Process -Id ${pid}${force ? ' -Force' : ''} -ErrorAction Stop`);
  } else process.kill(pid, force ? (job ? 'SIGUSR2' : 'SIGKILL') : 'SIGTERM');
}
