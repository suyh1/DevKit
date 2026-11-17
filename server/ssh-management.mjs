import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';

const maxBytes = 512 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const configActions = ['config-list', 'config-read', 'config-save', 'config-backup'];
const jarConfigName = name => /^[^./\\:\x00-\x1f][^/\\:\x00-\x1f]*\.(?:ya?ml|properties|json|xml|toml|ini|conf|cfg)$/i.test(name) &&
  !/\.pid\.devkit\.json$|\.supervisor\.json$/i.test(name);
const actionSet = {
  jar: ['check', 'validate', 'status', 'start', 'stop', 'restart', 'log', ...configActions],
  nginx: ['check', 'validate', 'test', 'reload', ...configActions],
};
const windowsBootstrap = Buffer.from(`
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  [Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
  [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
  try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    & ([ScriptBlock]::Create($request.script)) $request.parameters
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
  }
`, 'utf16le').toString('base64');

function hostArguments(host) {
  const { address, user, port, platform } = host ?? {};
  if (typeof address !== 'string' || address.length > 253 ||
    (!isIP(address) && !/^[a-z0-9][a-z0-9.-]*$/i.test(address))) throw new Error('SSH 主机地址无效。');
  if (typeof user !== 'string' || !/^[a-z0-9_.@\\-]{1,120}$/i.test(user) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 用户名或端口无效。');
  if (!['linux', 'win32'].includes(platform)) throw new Error('请选择远端系统。');
  return ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ClearAllForwardings=yes',
    '-o', 'ConnectTimeout=5', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
    '-p', String(port), '-l', user, '--', address];
}

function parameters(host, module, action, target, payload) {
  if (!Object.hasOwn(actionSet, module) || !actionSet[module].includes(action)) throw new Error('未知 SSH 操作。');
  if (action === 'check') return { module, action };
  const fsPath = host.platform === 'win32' ? path.win32 : path.posix;
  function absolute(value) {
    if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f]/.test(value) ||
      (host.platform === 'win32' ? !/^[a-z]:[\\/]/i.test(value) || value.slice(2).includes(':') : !fsPath.isAbsolute(value))) throw new Error('请填写目标主机上的本地绝对路径。');
    return fsPath.normalize(value);
  }
  const main = absolute(target?.path), directory = fsPath.dirname(main);
  const executable = target.executable ? absolute(target.executable) : '';
  const values = { module, action, main, directory, executable };
  if (module === 'jar') {
    if (!/\.jar$/i.test(main)) throw new Error('请选择 .jar 文件。');
    const args = target.args ?? [];
    if (!Array.isArray(args) || args.length > 50 || args.some(arg => typeof arg !== 'string' || arg.length > 2048 || arg.includes('\0'))) throw new Error('JAR 应用参数无效。');
    values.args = args;
  } else {
    const files = target.files ?? [];
    if (!Array.isArray(files) || files.length > 100) throw new Error('Nginx 附属文件列表无效。');
    values.files = [...new Set([main, ...files.map(absolute)])];
    values.prefix = target.prefix ? absolute(target.prefix) : '';
  }
  if (configActions.includes(action) && action !== 'config-list') {
    if (typeof payload?.name !== 'string' || payload.name.length > 4096) throw new Error('请选择配置文件。');
    if (module === 'jar') {
      if (!jarConfigName(payload.name) || payload.name.length > 255) throw new Error('请选择 JAR 同目录下支持的配置文件。');
      values.file = fsPath.join(directory, payload.name);
    } else {
      values.file = absolute(payload.name);
      if (!values.files.includes(values.file)) throw new Error('请先登记该 Nginx 配置文件。');
    }
  }
  if (action === 'config-save') {
    if (typeof payload.hash !== 'string' || !/^[a-f0-9]{64}$/.test(payload.hash)) throw new Error('请先读取当前配置。');
    const content = payload.content;
    if (typeof content !== 'string' || !content.isWellFormed() || content.includes('\0') || Buffer.byteLength(content) > maxBytes) throw new Error('配置必须是 512 KiB 以内的 UTF-8 文本。');
    values.expected = payload.hash;
    values.content = Buffer.from(content).toString('base64');
  }
  return values;
}

async function sshInput(platform, values) {
  if (platform === 'win32') {
    const script = await readFile(new URL('./ssh-windows.ps1', import.meta.url), 'utf8');
    return { command: `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${windowsBootstrap}`, input: JSON.stringify({ script, parameters: values }) };
  }
  const script = await readFile(new URL('./ssh-linux.sh', import.meta.url), 'utf8');
  const variables = Object.entries(values).filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => `${key}=${quote(value)}`).join('\n');
  const args = values.module === 'jar' ? values.args : values.files;
  return { command: 'sh -s', input: `${variables}\nset -- ${(args || []).map(quote).join(' ')}\n${script.replaceAll('\r\n', '\n')}\n` };
}

function executeSsh(args, command, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('ssh', [...args, command], { windowsHide: true, timeout: 30_000, maxBuffer: 1_500_000 }, (error, stdout, stderr) => {
      if (!error) { resolve(stdout); return; }
      if (error.code === 'ENOENT') { reject(new Error('找不到系统 OpenSSH 客户端（ssh）。')); return; }
      if (error.killed) { reject(new Error('SSH 操作超时，请刷新目标状态后重试。')); return; }
      reject(new Error((stderr.trim() || stdout.trim() || error.message).slice(0, 4000)));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export async function requestSsh(value, execute = executeSsh) {
  const { host, module, action, target, payload } = value ?? {};
  const args = hostArguments(host);
  const values = parameters(host, module, action, target, payload);
  const { command, input } = await sshInput(host.platform, values);
  const output = await execute(args, command, input);
  if (action === 'check') {
    if (output.trim() !== 'devkit-ssh') throw new Error('SSH 已连接，但远端执行环境不匹配。');
    return 'SSH 已连接。';
  }
  if (action === 'config-list') {
    const files = module === 'jar' ? output.split('\0').filter(name => jarConfigName(name)).sort((a, b) => a.localeCompare(b)) : values.files;
    return { directory: values.directory, files };
  }
  if (['config-read', 'config-backup', 'config-save'].includes(action)) {
    if (action === 'config-backup' && output.trim() === 'missing') return null;
    const match = /^file\r?\n([a-z0-9+/=]*)\s*$/i.exec(output);
    if (!match) throw new Error('远端返回的配置内容无效。');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length > maxBytes) throw new Error('单个配置文件最多 512 KiB。');
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (content.includes('\0')) throw new Error('配置不是有效的 UTF-8 文本。');
    return { name: payload.name, content, hash: hash(bytes) };
  }
  return output.trim() || '操作完成。';
}
