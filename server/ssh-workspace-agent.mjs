import { homedir } from 'node:os';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { createJarManager } from './jar-manager.mjs';
import { createNginxManager } from './nginx-manager.mjs';
import { managedRequest } from './managed-workspace.mjs';
import { readJsonLines } from './ssh-lines.mjs';
import { launchOutsideSshJob } from './ssh-windows-process.mjs';

const folder = path.join(homedir(), '.devkit-ssh', 'managed');
const managers = new Map();
const pending = new Set();
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let closing = false;
const windows = process.platform === 'win32';
function manager(module) {
  if (!['jar', 'nginx'].includes(module)) throw new Error('未知远程管理栏目。');
  if (!managers.has(module)) {
    const opening = module === 'jar'
      ? createJarManager(folder, windows ? { launchDetached: launchOutsideSshJob } : undefined)
      : createNginxManager(folder, windows ? { launch: (executable, args, cwd) => launchOutsideSshJob(executable, args, { cwd }) } : undefined);
    managers.set(module, opening);
    opening.catch(() => { managers.delete(module); });
  }
  return managers.get(module);
}
async function close() {
  if (closing) return;
  closing = true;
  await Promise.allSettled(pending);
  for (const instance of managers.values()) await (await instance).close();
}
async function handle({ id, module, action, payload, access, session }) {
  try {
    if (action === 'resolve-legacy-path') {
      const filename = payload?.path;
      if (!access?.edit || typeof filename !== 'string' || filename.length > 12000 || !path.isAbsolute(filename) || /[\0\r\n]/.test(filename)) throw new Error('请输入目标主机的绝对文件路径。');
      send({ id, result: await realpath(filename) });
      return;
    }
    if (action === 'release') {
      await (await managers.get('jar'))?.releaseConsoleSession(session);
    } else {
      send({ id, result: await managedRequest(await manager(module), module, action, payload, access, session) });
      return;
    }
    send({ id, result: true });
  } catch (error) { send({ id, error: error.message }); }
}
function stop() { void close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; }); }
process.stdin.on('end', stop);
process.stdout.on('error', stop);
process.on('SIGHUP', () => { process.stdin.pause(); stop(); });
readJsonLines(process.stdin, value => {
  if (closing) return;
  const job = handle(value);
  pending.add(job);
  void job.finally(() => pending.delete(job));
}, () => { process.stdin.pause(); stop(); });
send({ ready: true });
