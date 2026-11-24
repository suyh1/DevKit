import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { withDeadline } from './lan-probe.mjs';
import { sshCall, sshExec } from './ssh-exec.mjs';
import { sshNodeAsset, sshNodeVersion } from './ssh-node-runtimes.mjs';

const managerFiles = [
  'server/nginx-draft.mjs', 'server/backend-launch.mjs', 'server/runtime-discovery.mjs', 'server/backend-job.mjs', 'server/backend-job.ps1',
  'server/log-center.mjs', 'server/log-redaction.mjs',
  'server/ssh-workspace-agent.mjs', 'server/ssh-windows-process.mjs', 'server/ssh-lines.mjs', 'server/managed-workspace.mjs', 'server/project-lock.mjs', 'server/atomic-file.mjs',
  ...['manager', 'process', 'policies', 'supervisor-client', 'supervisor-worker', 'autostart', 'replacement', 'configs', 'log-writer', 'console'].map(name => `server/jar-${name}.mjs`),
  ...['manager', 'process', 'create', 'inspection', 'directories'].map(name => `server/nginx-${name}.mjs`), 'shared/nginx.mjs',
];
let bundle;
function managerBundle() {
  return bundle ??= Promise.all(managerFiles.map(async name => [name, await readFile(new URL(`../${name}`, import.meta.url))])).then(files => {
    const hash = createHash('sha256');
    for (const [name, bytes] of files) hash.update(name).update(bytes);
    return { files, folder: `.devkit-ssh/workspaces/${hash.digest('hex').slice(0, 24)}` };
  });
}

const shQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
const sh = script => `sh -c ${shQuote(`set -eu\n${script}`)}`;
const ps = script => {
  const source = `$ErrorActionPreference='Stop'\n$ProgressPreference='SilentlyContinue'\n[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)\ntry {\n${script}\n} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(source, 'utf16le').toString('base64')}`;
};

const probes = {
  linux: sh(`if [ "$(uname -s)" = Linux ]; then printf 'DEVKIT_ARCH %s\\nDEVKIT_HOME %s\\n' "$(uname -m)" "$HOME"; fi`),
  win32: ps(`$arch = $env:PROCESSOR_ARCHITEW6432; if (!$arch) { $arch = $env:PROCESSOR_ARCHITECTURE }\n[Console]::WriteLine('DEVKIT_ARCH ' + $arch)\n[Console]::WriteLine('DEVKIT_HOME ' + $env:USERPROFILE)`),
};
const architectures = new Map([['x86_64', 'x64'], ['amd64', 'x64'], ['aarch64', 'arm64'], ['arm64', 'arm64']]);

export async function detectSshTarget(client, preferred = 'linux') {
  const order = preferred === 'win32' ? ['win32', 'linux'] : ['linux', 'win32'];
  for (const platform of order) {
    const output = await sshExec(client, probes[platform], { timeout: 7000 }).catch(() => '');
    const machine = /^DEVKIT_ARCH ([\w-]+)\r?$/m.exec(output)?.[1]?.toLowerCase();
    const home = /^DEVKIT_HOME ([^\r\n\0]+)\r?$/m.exec(output)?.[1];
    if (!machine || !home || !(platform === 'win32' ? path.win32.isAbsolute(home) : path.posix.isAbsolute(home))) continue;
    const arch = architectures.get(machine) || machine;
    return { platform, arch, home, key: `${platform}-${arch}` };
  }
  throw new Error('无法识别 SSH 目标系统。请确认该账号可以执行 Linux shell 或 Windows PowerShell 命令。');
}

export async function trySftp(client) {
  let expired = false;
  const opening = sshCall(client, 'sftp').then(channel => { if (expired) channel.end(); return channel; });
  try { return await withDeadline(opening, 5000); }
  catch { expired = true; return null; }
}

export async function closeSftp(channel) {
  if (!channel || channel.incoming.state === 'closed') return;
  const closed = once(channel, 'close');
  channel.end();
  // Some servers accept our close without acknowledging it. A subsequent exec
  // will report whether the connection can still open channels.
  await withDeadline(closed, 5000).catch(() => {});
}

function remoteCommands(client, target) {
  const windows = target.platform === 'win32';
  const fileHash = `function Get-DevKitHash([string]$filename) {
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $data = [IO.File]::OpenRead($filename)
    try { [BitConverter]::ToString($algorithm.ComputeHash($data)).Replace('-', '') } finally { $data.Dispose() }
  } finally { $algorithm.Dispose() }
}`;
  const make = (linux, win) => windows
    ? ps(`Set-Location -LiteralPath $env:USERPROFILE\n[Environment]::CurrentDirectory = (Get-Location).ProviderPath\n${fileHash}\n${win}`)
    : sh(`umask 077\ncd "$HOME"\n${linux}`);
  const run = (linux, win, options) => sshExec(client, make(linux, win), options);
  const sftpPath = relative => {
    const absolute = windows ? path.win32.join(target.home, relative).replaceAll('\\', '/') : path.posix.join(target.home, relative);
    return windows && !absolute.startsWith('/') ? `/${absolute}` : absolute;
  };
  function checksum(relative, sha) {
    return [`set -- $(sha256sum < ${shQuote(relative)})\n[ "$1" = ${shQuote(sha)} ]`,
      `(Get-DevKitHash ${psQuote(relative)}) -eq ${psQuote(sha)}`];
  }
  return {
    sftpPath,
    async exists(filename, sha) {
      const [linux, win] = sha ? checksum(filename, sha) : [':', '$true'];
      const result = await run(
        `if [ -f ${shQuote(filename)} ] && ( ${linux} ); then printf 'DEVKIT_PRESENT\\n'; fi`,
        `if ((Test-Path -LiteralPath ${psQuote(filename)} -PathType Leaf) -and (${win})) { [Console]::WriteLine('DEVKIT_PRESENT') }`,
      );
      return /^DEVKIT_PRESENT\r?$/m.test(result);
    },
    async directories(folders) {
      await run(`mkdir -p ${folders.map(shQuote).join(' ')}`, folders.map(name => `[IO.Directory]::CreateDirectory(${psQuote(name)}) | Out-Null`).join('\n'));
    },
    async write(filename, input) {
      await run(`cat > ${shQuote(filename)}`, `$file = [IO.File]::Open(${psQuote(filename)}, [IO.FileMode]::CreateNew)\ntry { [Console]::OpenStandardInput().CopyTo($file) } finally { $file.Dispose() }`, { input, timeout: 300000 });
    },
    async publish(temporary, filename, sha, executable) {
      const [linux, win] = checksum(temporary, sha);
      const pending = psQuote(temporary), target = psQuote(filename);
      await run(
        `${linux} || { echo 'SHA-256 mismatch' >&2; exit 1; }\nchmod ${executable ? '700' : '600'} ${shQuote(temporary)}\nmv -f ${shQuote(temporary)} ${shQuote(filename)}`,
        `if (!(${win})) { throw 'SHA-256 mismatch' }
if ([IO.File]::Exists(${target})) {
  if ((Get-DevKitHash ${target}) -ne ${psQuote(sha)}) {
    $backup = ${pending} + '.old'
    [IO.File]::Replace(${pending}, ${target}, $backup)
    [IO.File]::Delete($backup)
  }
} else {
  try { [IO.File]::Move(${pending}, ${target}) } catch {
    if (!(Test-Path -LiteralPath ${target} -PathType Leaf) -or (Get-DevKitHash ${target}) -ne ${psQuote(sha)}) { throw }
  }
}
[IO.File]::Delete(${pending})`,
      );
    },
    async discard(filename) {
      await run(`rm -f ${shQuote(filename)}`, `if ([IO.File]::Exists(${psQuote(filename)})) { [IO.File]::Delete(${psQuote(filename)}) }`).catch(() => {});
    },
    executable(runner, args, portable) {
      const program = portable ? `./${runner}` : runner;
      const windowsProgram = portable ? `(Join-Path $env:USERPROFILE ${psQuote(runner)})` : psQuote(runner);
      return make(`exec ${[program, ...args].map(shQuote).join(' ')}`, `& ${windowsProgram} ${args.map(psQuote).join(' ')}\nexit $LASTEXITCODE`);
    },
  };
}

export async function deploySshWorkspace(client, preferred, { loadRuntime = sshNodeAsset, stage } = {}) {
  const target = await detectSshTarget(client, preferred);
  const node = await loadRuntime(target.key);
  const remote = remoteCommands(client, target);
  const { files, folder } = await managerBundle();
  const runtimeDir = `.devkit-ssh/runtimes/node-v${sshNodeVersion}-${target.key}-${node?.sha256.slice(0, 12)}`;
  const runner = node ? `${runtimeDir}/${target.platform === 'win32' ? 'node.exe' : 'node'}` : 'node';
  const needsRuntime = node && !await remote.exists(runner, node.sha256);
  const needsScripts = !await remote.exists(`${folder}/ready`);
  if (needsRuntime || needsScripts) stage?.('deploying');
  let allowSftp = true;

  async function install(files) {
    const staged = files.map(file => ({ ...file, temporary: `${file.filename}.${randomUUID()}.tmp`, attempted: false, uploaded: false }));
    try {
      const sftp = allowSftp ? await trySftp(client) : null;
      if (sftp) {
        try {
          for (const file of staged) {
            file.attempted = true;
            await pipeline(file.stream(), sftp.createWriteStream(remote.sftpPath(file.temporary), { flags: 'wx', mode: 0o600 }));
            file.uploaded = true;
          }
        } catch { allowSftp = false; }
        finally { await closeSftp(sftp); }
      } else allowSftp = false;

      // Publish over SSH after closing SFTP so that deployment also works with
      // an SSH server that allows only one session channel per connection.
      for (const file of staged) {
        if (!file.uploaded) {
          if (file.attempted) await remote.discard(file.temporary);
          file.attempted = true;
          await remote.write(file.temporary, file.stream());
        }
        await remote.publish(file.temporary, file.filename, file.sha256, file.executable);
        file.attempted = false;
      }
    } finally {
      for (const file of staged) if (file.attempted) await remote.discard(file.temporary);
    }
  }

  if (needsRuntime) {
    await remote.directories([runtimeDir]);
    await install([{ ...node, filename: runner, executable: true }]);
  }
  try {
    const version = await sshExec(client, remote.executable(runner, ['--version'], !!node));
    if (node ? !version.split(/\r?\n/).includes(`v${sshNodeVersion}`) : !version.split(/\r?\n/).some(line => Number(/^v(\d+)\./.exec(line)?.[1]) >= 24)) throw new Error(version);
  } catch (error) {
    throw new Error(node ? `便携 Node.js 在 ${target.key} 无法启动。请检查目标系统运行库和用户目录执行权限。${error.message}` : `目标 ${target.key} 未提供便携 Node.js，现有连接需要 SSH 会话可执行 Node.js 24+。${error.message}`);
  }
  if (needsScripts) {
    await remote.directories([`${folder}/server`, `${folder}/shared`]);
    await install([...files, ['ready', Buffer.from('ready')]].map(([name, bytes]) => ({
      filename: `${folder}/${name}`, stream: () => Readable.from([bytes]), sha256: createHash('sha256').update(bytes).digest('hex'),
    })));
  }
  return { platform: target.platform, stream: await sshCall(client, 'exec', remote.executable(runner, [`${folder}/server/ssh-workspace-agent.mjs`], !!node)) };
}
