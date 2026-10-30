import { readFile, lstat, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { inspectJava } from './jar-process.mjs';

export const supervisorPath = item => path.join(path.dirname(item.jar), `${item.pidName}.supervisor.json`);
export const workerPath = fileURLToPath(new URL('./jar-supervisor-worker.mjs', import.meta.url));
export async function supervisorRequest(item, command = 'status', timeout = 8000) {
  const file = supervisorPath(item); let raw, record;
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > 65536) throw new Error('守护进程记录无效。');
    raw = await readFile(file, 'utf8'); record = JSON.parse(raw);
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!Number.isSafeInteger(record.pid) || record.pid <= 1 || !Number.isInteger(record.port) || record.port < 0 || record.port > 65535 || !/^[a-f0-9]{64}$/.test(record.token) || record.id !== item.id) throw new Error('守护进程身份记录不匹配。');
  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port: record.port, path: '/', method: 'POST', headers: { Authorization: `Bearer ${record.token}`, 'Content-Type': 'application/json', Connection: 'close' }, agent: false }, response => {
        const chunks = []; let length = 0;
        response.on('data', chunk => { length += chunk.length; if (length > 512 * 1024) request.destroy(new Error('守护进程响应过大。')); else chunks.push(chunk); });
        response.on('end', () => { try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (result.error) reject(new Error(result.error)); else if (result.id !== item.id) reject(new Error('守护进程实例不匹配。')); else resolve(result); } catch (error) { reject(error); } });
        response.on('error', reject);
      });
      const timer = setTimeout(() => request.destroy(new Error('守护进程响应超时。')), timeout);
      request.on('close', () => clearTimeout(timer)); request.on('error', reject);
      request.end(JSON.stringify({ command }));
    });
  } catch (error) {
    // Only absent PIDs permit removing a stale endpoint. Never signal the supervisor PID.
    try {
      process.kill(record.pid, 0);
      if (record.created) {
        const info = await inspectJava(record.pid);
        if (info && !info.unknown && info.created !== record.created) {
          if (await readFile(file, 'utf8').catch(() => '') === raw) await unlink(file); return null;
        }
      }
    }
    catch (failure) {
      if (failure.code === 'ESRCH') { if (await readFile(file, 'utf8').catch(() => '') === raw) await unlink(file); return null; }
    }
    throw error;
  }
}
export async function launchSupervisor(registry, item) {
  let created = false;
  if (!await supervisorRequest(item)) {
    created = true;
    const child = spawn(process.execPath, [workerPath, '--registry', registry, '--id', item.id], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: path.dirname(item.jar), detached: true, windowsHide: true, stdio: 'ignore', shell: false });
    let exited = false; child.once('exit', () => { exited = true; });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (exited) break;
      try { if (await supervisorRequest(item)) { ready = true; break; } } catch { /* Wait for the endpoint to finish initializing. */ }
      await delay(100);
    }
    if (!ready) throw new Error('JAR 守护进程未能启动，请检查运行文件权限与应用安装路径。');
  }
  return supervisorRequest(item, created ? 'start-result' : 'start', 150000);
}
