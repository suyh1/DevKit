import { access, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { effectiveEnvironment } from './jar-policies.mjs';
import { matchesJar, pathKey } from './jar-process.mjs';

export const isJar = item => !item.kind || item.kind === 'jar';
export const serviceDirectory = item => isJar(item) ? path.dirname(item.jar) : item.workDir;
export const serviceEntry = item => item.kind === 'npm' ? path.join(item.workDir, 'package.json') : item.kind === 'program' ? item.program : item.jar;
const windows = process.platform === 'win32';
export const jobRunner = fileURLToPath(new URL('./backend-job.mjs', import.meta.url));

export async function projectScripts(directory) {
  const manifest = path.join(directory, 'package.json');
  const handle = await open(manifest, constants.O_RDONLY | (constants.O_NONBLOCK || 0)).catch(error => {
    if (error.code === 'ENOENT') throw new Error('项目缺少 package.json。');
    throw error;
  });
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('package.json 必须是普通文件。');
    const size = info.size;
    if (size > 2 * 1024 * 1024) throw new Error('package.json 超过 2 MiB。');
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(buffer, offset, size - offset, offset);
      if (!bytesRead) throw new Error('package.json 读取期间发生变化。');
      offset += bytesRead;
    }
    const { scripts } = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return [];
    return Object.entries(scripts).filter(([name, command]) => validScript(name) && typeof command === 'string' && command.trim()).map(([name]) => name);
  } finally { await handle.close(); }
}

export const validScript = name => typeof name === 'string' && name.length > 0 && name.length <= 128 && !name.startsWith('-') && !/[\x00-\x1f\x7f]/.test(name);

async function npmRuntime(env) {
  const dirs = (Object.entries(env).find(([k]) => windows ? k.toUpperCase() === 'PATH' : k === 'PATH')?.[1] || '')
    .split(path.delimiter).map(dir => dir.replace(/^"|"$/g, '')).filter(dir => path.isAbsolute(dir));
  let node, cli;
  for (const dir of dirs) {
    if (!node) node = await realpath(path.join(dir, windows ? 'node.exe' : 'node')).catch(() => undefined);
    if (!cli) {
      const candidate = path.join(dir, windows ? 'node_modules/npm/bin/npm-cli.js' : 'npm');
      const resolved = await realpath(candidate).catch(() => undefined);
      if (resolved) cli = resolved;
    }
    if (node && cli) return { node, cli };
  }
  throw new Error('目标主机找不到 Node.js 或 npm CLI，请检查服务环境的 PATH。');
}

export async function launchSpec(item, detect) {
  const entry = serviceEntry(item), directory = serviceDirectory(item);
  if (pathKey(await realpath(entry)) !== pathKey(entry) || !(await stat(entry)).isFile() ||
      pathKey(await realpath(directory)) !== pathKey(directory) || !(await stat(directory)).isDirectory()) throw new Error('服务入口或工作目录已变化，请重新登记。');
  if (isJar(item)) {
    const java = await detect({ executable: item.executable, env: effectiveEnvironment(item) });
    if (!java.found) throw new Error(java.output);
    return { executable: java.executable, args: [...item.jvmArgs, '-jar', entry, ...item.appArgs] };
  }
  if (item.kind === 'npm') {
    if (!(await projectScripts(directory)).includes(item.script)) throw new Error('package.json 中找不到所选 npm 脚本。');
    const { node, cli } = await npmRuntime(effectiveEnvironment(item));
    const args = item.script === 'start' ? ['start'] : ['run', item.script];
    if (item.appArgs.length) args.push('--', ...item.appArgs);
    return windows ? { executable: node, args: [cli, ...args] } : { executable: cli, args };
  }
  await access(entry, windows ? 0 : 1);
  return { executable: entry, args: item.appArgs };
}

const argsHash = args => createHash('sha256').update(JSON.stringify(args)).digest('hex');
export function launchIdentity(item, spec) {
  return isJar(item) ? { jar: item.jar } : { serviceId: item.id, kind: item.kind, argsHash: argsHash(spec.args) };
}

export function matchesService(item, info, identity) {
  if (isJar(item)) return matchesJar(item, info, identity);
  return !!identity && !!info?.executable && !info.unknown && identity.serviceId === item.id && identity.kind === item.kind &&
    identity.pid === info.pid && identity.created === info.created && pathKey(identity.executable) === pathKey(info.executable) &&
    Array.isArray(info.args) && identity.argsHash === argsHash(info.args.slice(1));
}
