import { execFile, spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

// The sole job handle belongs to this process. Windows closes it on every exit,
// including force-stop or a crash, terminating all inherited descendants.
const [, , , executable, ...args] = process.argv;
const windows = process.platform === 'win32';
try {
  if (windows) {
    // Read through Electron's filesystem API so the helper also works inside app.asar.
    const source = await readFile(new URL('./backend-job.ps1', import.meta.url), 'utf8');
    const command = '& {\n' + source + '\n} ' + process.pid;
    await promisify(execFile)(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      { windowsHide: true, timeout: 15000 });
  }
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, args, { env, detached: !windows, stdio: 'inherit', windowsHide: true, shell: false });
  child.once('spawn', () => { process.send?.({ ready: true, pid: child.pid }); process.disconnect?.(); });
  function signalGroup(signal) {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  let stopping = false;
  if (!windows) {
    process.on('SIGTERM', () => { stopping = true; signalGroup('SIGTERM'); });
    process.on('SIGUSR2', () => signalGroup('SIGKILL'));
  }
  child.once('exit', async code => {
    if (!windows) {
      // npm may exit before the HTTP server finishes handling TERM. Keep the
      // launcher available for a later force-stop until the whole group exits.
      if (!stopping) signalGroup('SIGKILL');
      while (await groupHasMembers(child.pid)) await delay(100);
    }
    process.exitCode = code ?? 1;
  });
  child.once('error', fail);
} catch (error) { fail(error); }

async function groupHasMembers(group) {
  try { process.kill(-group, 0); }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  // A zombie can keep a process group visible although it holds no resources.
  for (const pid of await readdir('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    const stat = await readFile('/proc/' + pid + '/stat', 'utf8').catch(() => '');
    const [state, , pgid] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (Number(pgid) === group && state !== 'Z' && state !== 'X') return true;
  }
  return false;
}

function fail(error) {
  process.stderr.write(`${error.message}\n`);
  process.send?.({ error: error.message });
  if (process.connected) process.disconnect();
  process.exitCode = 1;
}
