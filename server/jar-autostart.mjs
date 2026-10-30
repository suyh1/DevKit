import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { workerPath } from './jar-supervisor-client.mjs';
import { powerShellError } from './jar-process.mjs';

const execute = promisify(execFile);
const quote = value => `'${value.replaceAll("'", "''")}'`;
const taskLookup = (name, variable = 't') => `$${variable}=$null; try {$${variable}=Get-ScheduledTask -TaskName ${quote(name)} -ErrorAction Stop} catch {if($_.CategoryInfo.Category -ne 'ObjectNotFound'){throw}}; `;
const unitQuote = (value, command = true) => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', () => command ? '$$' : '$') + '"';
export function startupDefinition(registry, item, mode, platform = process.platform, runner = process.execPath, worker = workerPath) {
  if (!['login', 'boot'].includes(mode) || !['win32', 'linux'].includes(platform)) throw new Error('自启模式或操作系统不支持。');
  for (const value of [registry, runner, worker]) if (/[\0\r\n]/.test(value)) throw new Error('自启路径包含无效字符。');
  const hash = createHash('sha256').update(registry).digest('hex').slice(0, 12);
  const name = `devkit-jar-${hash}-${item.id}`, tag = `Managed by DevKit JAR ${hash} ${item.id}`;
  const javaArguments = item.executable ? ` '--java' ${quote(item.executable)}` : '';
  const launch = `$env:ELECTRON_RUN_AS_NODE='1'; & ${quote(runner)} ${quote(worker)} '--registry' ${quote(registry)} '--id' ${quote(item.id)}${javaArguments}; exit $LASTEXITCODE`;
  return { name, tag, mode, taskArguments: `-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${Buffer.from(launch, 'utf16le').toString('base64')}`,
    unit: `# ${tag}\n[Unit]\nDescription=DevKit JAR ${item.id}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nEnvironment=ELECTRON_RUN_AS_NODE=1\nExecStart=${unitQuote(runner)} ${unitQuote(worker)} --registry ${unitQuote(registry)} --id ${unitQuote(item.id)}${item.executable ? ` --java ${unitQuote(item.executable)}` : ''}\nWorkingDirectory=${unitQuote(path.dirname(registry), false)}\nRestart=no\nTimeoutStopSec=${item.stopTimeout + 15}\nKillMode=mixed\n\n[Install]\nWantedBy=${mode === 'boot' ? 'default.target' : 'graphical-session.target'}\n` };
}
export function createJarAutostart(registry, dependencies = {}) {
  const platform = dependencies.platform || process.platform, run = dependencies.execute || execute;
  const configHome = dependencies.configHome || process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  const folder = path.join(path.dirname(registry), 'autostart');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = async script => {
    const wrapped = "[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false); $ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; try { " + script + "; exit 0 } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
    try { return await run(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(wrapped, 'utf16le').toString('base64')], { timeout: 20000, windowsHide: true, maxBuffer: 65536 }); }
    catch (error) { throw new Error(powerShellError(error.stderr) || 'Windows 任务计划操作失败或超时。'); }
  };
  function def(item, mode) { return startupDefinition(registry, item, mode, platform, dependencies.runner, dependencies.worker); }
  async function saved(item) { try { return JSON.parse(await readFile(path.join(folder, `${item.id}.json`), 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async function get(item) {
    const record = await saved(item);
    if (!record) return { enabled: false, mode: 'login', platform };
    const definition = def(item, record.mode);
    try {
      if (platform === 'win32') {
        const { stdout } = await command(`${taskLookup(definition.name)}if($t){@{enabled=($t.State -ne 'Disabled');owned=($t.Description -eq ${quote(definition.tag)})}|ConvertTo-Json -Compress}`);
        const result = stdout.trim() ? JSON.parse(stdout) : { enabled: false, owned: true };
        if (!result.owned) throw new Error('同名任务不属于此 JAR，拒绝修改。');
        return { ...record, enabled: result.enabled, platform, target: definition.name };
      }
      const target = path.join(configHome, 'systemd/user', `${definition.name}.service`);
      const content = await readFile(target, 'utf8');
      if (!content.startsWith(`# ${definition.tag}\n`)) throw new Error('同名服务不属于此 JAR。');
      let enabled = false;
      try { const { stdout } = await run('systemctl', ['--user', 'is-enabled', `${definition.name}.service`], { timeout: 10000 }); enabled = stdout.trim() === 'enabled'; } catch { /* Disabled or user manager unavailable. */ }
      return { ...record, enabled, platform, target };
    } catch (error) { if (error.code === 'ENOENT') return { ...record, enabled: false, platform }; return { ...record, platform, error: error.stderr?.trim() || error.message, enabled: false }; }
  }
  async function install(item, mode) {
    const definition = def(item, mode);
    await mkdir(folder, { recursive: true });
    const recordFile = path.join(folder, `${item.id}.json`);
    await writeFile(recordFile, JSON.stringify({ enabled: false, mode, installing: true }), { mode: 0o600 });
    try {
    if (platform === 'win32') {
      await command(`${taskLookup(definition.name, 'old')}if($old -and $old.Description -ne ${quote(definition.tag)}){throw 'Task is not owned by this JAR'}; $user=[Security.Principal.WindowsIdentity]::GetCurrent().Name; $action=New-ScheduledTaskAction -Execute ${quote(powershell)} -Argument ${quote(definition.taskArguments)}; $trigger=${mode === 'boot' ? 'New-ScheduledTaskTrigger -AtStartup' : 'New-ScheduledTaskTrigger -AtLogOn -User $user'}; $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType ${mode === 'boot' ? 'S4U' : 'Interactive'} -RunLevel Limited; $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName ${quote(definition.name)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description ${quote(definition.tag)} -Force | Out-Null`);
    } else {
      const target = path.join(configHome, 'systemd/user', `${definition.name}.service`);
      try {
        const existing = await readFile(target, 'utf8');
        if (!existing.startsWith(`# ${definition.tag}\n`)) throw new Error('同名服务不属于此 JAR。');
        await run('systemctl', ['--user', 'disable', `${definition.name}.service`], { timeout: 10000 });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (mode === 'boot') await run('loginctl', ['enable-linger'], { timeout: 20000, windowsHide: true });
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, definition.unit, { mode: 0o600 });
      await run('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 });
      await run('systemctl', ['--user', 'enable', `${definition.name}.service`], { timeout: 10000 });
    }
    await writeFile(recordFile, JSON.stringify({ enabled: true, mode, installedAt: new Date().toISOString() }), { mode: 0o600 });
    return get(item);
    } catch (error) {
      const detail = /Access is denied|拒绝访问|0x80070005/i.test(error.message) ? '系统拒绝此自启操作。开机模式可能需要以管理员身份运行 DevKit；也可选择当前用户登录模式。' : error.stderr?.trim() || error.message;
      await writeFile(recordFile, JSON.stringify({ enabled: false, mode, error: detail }), { mode: 0o600 });
      throw new Error(`自启设置失败：${detail}`);
    }
  }
  async function remove(item) {
    const record = await saved(item); if (!record) return { enabled: false, platform };
    const definition = def(item, record.mode);
    if (platform === 'win32') {
      await command(`${taskLookup(definition.name)}if($t){if($t.Description -ne ${quote(definition.tag)}){throw 'Task is not owned by this JAR'}; Unregister-ScheduledTask -TaskName ${quote(definition.name)} -Confirm:$false}`);
    } else {
      const target = path.join(configHome, 'systemd/user', `${definition.name}.service`);
      try {
        if (!(await readFile(target, 'utf8')).startsWith(`# ${definition.tag}\n`)) throw new Error('同名服务不属于此 JAR。');
        await run('systemctl', ['--user', 'disable', `${definition.name}.service`], { timeout: 10000 }); await unlink(target);
        await run('systemctl', ['--user', 'daemon-reload'], { timeout: 10000 });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await unlink(path.join(folder, `${item.id}.json`)); return { enabled: false, platform };
  }
  return { get, install, remove };
}
