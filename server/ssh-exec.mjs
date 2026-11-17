import { pipeline } from 'node:stream/promises';
import { withDeadline } from './lan-probe.mjs';

export const sshCall = (receiver, method, ...args) => new Promise((resolve, reject) => receiver[method](...args, (error, result) => error ? reject(error) : resolve(result)));

export async function sshExec(client, command, { input, timeout = 12000, includeStderr = false } = {}) {
  let expired = false, stream;
  try {
    return await withDeadline((async () => {
      stream = await sshCall(client, 'exec', command);
      if (expired) { stream.destroy(); return; }
      let stdout = '', stderr = '';
      stream.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-8192); });
      stream.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
      const complete = new Promise((resolve, reject) => {
        stream.once('error', reject);
        stream.once('close', code => {
          if (code === 0) resolve((includeStderr ? `${stdout}\n${stderr}` : stdout).trim());
          else reject(new Error(stderr.trim() || stdout.trim() || `远程命令退出码 ${code ?? '未知'}`));
        });
      });
      if (input) {
        // SSH exec sends a channel EOF on writable finish. Continue reading the
        // remote process's exit status after the input stream has finished.
        await Promise.all([complete, pipeline(input, stream)]);
        return await complete;
      }
      stream.end();
      return await complete;
    })(), timeout, 'SSH 远程命令超时。');
  } finally {
    expired = true;
    if (stream && !stream.destroyed) stream.destroy();
  }
}

export async function sshOutput(client, command) {
  // Version programs such as java and nginx commonly write to stderr.
  return (await sshExec(client, command, { timeout: 5000, includeStderr: true })).split(/\r?\n/)[0];
}
