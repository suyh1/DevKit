import { execFile } from 'node:child_process';
import path from 'node:path';
import { powerShellError } from './jar-process.mjs';

const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$ProgressPreference = 'SilentlyContinue'
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{
        ShowWindow = [uint16]0
        EnvironmentVariables = [string[]]$request.environment
    }
    $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = [string]$request.command
        CurrentDirectory = [string]$request.directory
        ProcessStartupInformation = $startup
    }
    if ($result.ReturnValue -ne 0) { throw "Win32_Process.Create: $($result.ReturnValue)" }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
`;
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const command = Buffer.from(script, 'utf16le').toString('base64');

function argument(value) {
  if (value && !/[\s"]/.test(value)) return value;
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

// Win32-OpenSSH owns a job that can terminate descendants when the SSH session ends.
export function launchOutsideSshJob(executable, args, { cwd, env = process.env }) {
  const input = JSON.stringify({ command: [executable, ...args].map(argument).join(' '), directory: cwd, environment: Object.entries(env).map(([name, value]) => `${name}=${value}`) });
  return new Promise((resolve, reject) => {
    const child = execFile(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', command], { windowsHide: true, timeout: 15000, maxBuffer: 65536 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(powerShellError(stderr) || 'Windows SSH 后台进程启动失败或超时。'));
      else resolve();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
