import { access, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { effectiveEnvironment } from './jar-policies.mjs';
import { matchesJar, pathKey } from './jar-process.mjs';

export const isJar = item => !item.kind || item.kind === 'jar';
export const serviceDirectory = item => isJar(item) ? path.dirname(item.jar) : item.workDir;
export const serviceEntry = item => item.kind === 'npm' ? path.join(item.workDir, 'package.json') : item.kind === 'script' ? item.script : item.kind === 'program' ? item.program : item.jar;
const windows = process.platform === 'win32';
const execute = promisify(execFile);
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

const nodeName = windows ? 'node.exe' : 'node';
export async function resolveNode(filename) {
  const resolved = await realpath(filename).catch(() => { throw new Error('找不到指定的 Node.js 程序：' + filename); });
  if (!(await stat(resolved)).isFile()) throw new Error('请选择 Node.js 程序文件。');
  await access(resolved, windows ? constants.F_OK : constants.X_OK).catch(() => { throw new Error('指定的 Node.js 程序缺少执行权限。'); });
  // Store the version directory behind a version manager's current symlink.
  const directory = path.dirname(resolved);
  const command = path.join(directory, nodeName);
  const target = await realpath(command).catch(() => '');
  if (!target || pathKey(target) !== pathKey(resolved)) throw new Error('请选择安装目录中的 ' + nodeName + '，以便 npm 脚本使用同一版本。');
  return command;
}

async function npmRuntime(env, nodePath) {
  const pathKeyName = Object.keys(env).find(k => windows ? k.toUpperCase() === 'PATH' : k === 'PATH') || 'PATH';
  const searchPath = env[pathKeyName] || '';
  const cliName = windows ? 'node_modules/npm/bin/npm-cli.js' : 'npm';
  if (nodePath) {
    const node = await resolveNode(nodePath);
    const directory = path.dirname(node);
    // npm from an upstream Unix installation lives under lib, while distro
    // packages often link bin/npm to their own npm-cli.js.
    const bundledCli = windows ? cliName : '../lib/node_modules/npm/bin/npm-cli.js';
    let cli = await realpath(path.join(directory, bundledCli)).catch(() => undefined);
    if (!cli && !windows) cli = await realpath(path.join(directory, 'npm')).catch(() => undefined);
    const childEnv = { ...env, [pathKeyName]: searchPath ? directory + path.delimiter + searchPath : directory };
    return { node, cli, viaNode: true, env: childEnv };
  }
  const dirs = searchPath
    .split(path.delimiter).map(dir => dir.replace(/^"|"$/g, '')).filter(dir => path.isAbsolute(dir));
  let node, cli;
  for (const dir of dirs) {
    if (!node) node = await realpath(path.join(dir, nodeName)).catch(() => undefined);
    if (!cli) {
      const candidate = path.join(dir, cliName);
      const resolved = await realpath(candidate).catch(() => undefined);
      if (resolved) cli = resolved;
    }
    if (node && cli) break;
  }
  return { node, cli, viaNode: windows, env };
}

export async function detectNpm(searchPath, nodePath) {
  if (searchPath !== undefined && (typeof searchPath !== 'string' || searchPath.length > 16000 || searchPath.includes('\0'))) throw new Error('PATH 无效。');
  const { node, cli, viaNode, env } = await npmRuntime(effectiveEnvironment({ env: searchPath === undefined ? {} : { PATH: searchPath } }), nodePath);
  async function version(label, file, executable, args) {
    if (!file) return { ok: false, text: nodePath ? '所选 Node.js 安装中未找到 npm。' : label + '：在目标主机的 PATH 中未找到。' };
    if (!executable) return { ok: false, text: label + '：缺少 Node.js，无法读取版本 · ' + file };
    try {
      const { stdout } = await execute(executable, [...args, '--version'], { env, cwd: tmpdir(), shell: false, windowsHide: true, timeout: 5000, maxBuffer: 32768 });
      const value = stdout.trim();
      if (/^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/.test(value)) return { ok: true, text: label + ' ' + value + ' · ' + file };
    } catch { /* Report the resolved path even if version detection failed. */ }
    return { ok: false, text: label + '：版本检测失败，请检查安装和执行权限 · ' + file };
  }
  return Promise.all([version('Node.js', node, node, []), version('npm', cli, viaNode ? node : cli, viaNode ? [cli] : [])]);
}

export async function checkProgram(filename) {
  let file;
  try {
    const resolved = await realpath(filename);
    if (!(await stat(resolved)).isFile()) throw new Error('请选择普通程序文件。');
    if (windows && path.extname(filename).toLowerCase() !== '.exe') throw new Error('请选择 Windows .exe 程序。');
    await access(resolved, windows ? constants.R_OK : constants.X_OK);
    file = await open(resolved, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
    const head = Buffer.alloc(256);
    const { bytesRead } = await file.read(head, 0, head.length, 0);
    let detail, architecture;
    if (windows) {
      const pe = Buffer.alloc(26);
      const validDos = bytesRead >= 64 && head.toString('latin1', 0, 2) === 'MZ';
      const offset = validDos ? head.readUInt32LE(60) : 0;
      if (!validDos || offset < 64 || (await file.read(pe, 0, pe.length, offset)).bytesRead !== pe.length ||
          pe.readUInt32LE(0) !== 0x4550 || !(pe.readUInt16LE(22) & 2) || (pe.readUInt16LE(22) & 0x2000) ||
          ![0x10b, 0x20b].includes(pe.readUInt16LE(24))) throw new Error('文件不是有效的 Windows PE 可执行程序。');
      detail = 'Windows .exe 文件格式检查通过';
      architecture = ({ 0x14c: 'ia32', 0x8664: 'x64', 0xaa64: 'arm64' })[pe.readUInt16LE(4)];
    } else if (process.platform === 'darwin') {
      const magic = bytesRead >= 8 ? head.readUInt32BE(0) : 0;
      const machArch = cpu => ({ 0x0100000c: 'arm64', 0x01000007: 'x64', 7: 'ia32', 12: 'arm' })[cpu];
      if (magic === 0xcffaedfe || magic === 0xcefaedfe) {
        detail = 'Mach-O 程序格式和执行权限检查通过';
        architecture = machArch(head.readUInt32LE(4));
      } else if (magic === 0xfeedfacf || magic === 0xfeedface) {
        detail = 'Mach-O 程序格式和执行权限检查通过';
        architecture = machArch(head.readUInt32BE(4));
      } else if ((magic === 0xcafebabe || magic === 0xcafebabf) && bytesRead >= 12) {
        const count = head.readUInt32BE(4);
        const stride = magic === 0xcafebabf ? 32 : 20;
        if (count >= 1 && count <= 20 && 8 + count * stride <= bytesRead) {
          detail = 'Mach-O 通用程序格式和执行权限检查通过';
          const arches = Array.from({ length: count }, (_, index) => machArch(head.readUInt32BE(8 + index * stride))).filter(Boolean);
          architecture = arches.includes(process.arch) ? process.arch : arches[0];
        }
      }
      if (!detail) {
        const interpreter = /^#![ \t]*(\/[^ \t\n\0]+)/.exec(head.toString('utf8', 0, bytesRead))?.[1];
        if (!interpreter) throw new Error('文件有执行权限，但未识别为 Mach-O 程序或带解释器声明的脚本。');
        if (!(await stat(interpreter).catch(() => null))?.isFile()) throw new Error('找不到脚本声明的解释器。');
        await access(interpreter, constants.X_OK).catch(() => { throw new Error('脚本解释器缺少执行权限。'); });
        detail = '脚本解释器和执行权限检查通过';
      }
    } else {
      const elf = bytesRead >= 52 && head.readUInt32BE(0) === 0x7f454c46 && [1, 2].includes(head[4]) && [1, 2].includes(head[5]);
      if (elf && [2, 3].includes(head[5] === 1 ? head.readUInt16LE(16) : head.readUInt16BE(16))) {
        detail = 'ELF 程序格式和执行权限检查通过';
        const machine = head[5] === 1 ? head.readUInt16LE(18) : head.readUInt16BE(18);
        architecture = ({ 3: 'ia32', 62: 'x64', 40: 'arm', 183: 'arm64' })[machine];
      } else {
        const interpreter = /^#![ \t]*(\/[^ \t\n\0]+)/.exec(head.toString('utf8', 0, bytesRead))?.[1];
        if (!interpreter) throw new Error('文件有执行权限，但未识别为 ELF 程序或带解释器声明的脚本。');
        if (!(await stat(interpreter).catch(() => null))?.isFile()) throw new Error('找不到脚本声明的解释器。');
        await access(interpreter, constants.X_OK).catch(() => { throw new Error('脚本解释器缺少执行权限。'); });
        detail = '脚本解释器和执行权限检查通过';
      }
    }
    if (architecture && architecture !== process.arch) {
      return [{ ok: false, text: detail + '；程序架构为 ' + architecture + '，主机运行时为 ' + process.arch + '，请确认系统兼容支持。' }];
    }
    return [{ ok: true, text: detail + ' · ' + resolved }];
  } catch (error) {
    const reason = { ENOENT: '所选文件不存在。', ENOTDIR: '所选文件的路径无效。', EACCES: '当前账号缺少读取或执行权限。', EPERM: '当前账号无权检查此文件。' };
    return [{ ok: false, text: reason[error.code] || error.message }];
  } finally { await file?.close(); }
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
    const { node, cli, viaNode, env } = await npmRuntime(effectiveEnvironment(item), item.nodePath);
    if (item.nodePath && !cli) throw new Error('所选 Node.js 安装中未找到 npm。');
    if (!node || !cli) throw new Error('目标主机找不到 Node.js 或 npm CLI，请检查服务环境的 PATH。');
    const args = item.script === 'start' ? ['start'] : ['run', item.script];
    if (item.appArgs.length) args.push('--', ...item.appArgs);
    return viaNode ? { executable: node, args: [cli, ...args], env } : { executable: cli, args, env };
  }
  if (item.kind === 'script') {
    await access(entry, constants.R_OK);
    await access(item.program, windows ? constants.F_OK : constants.X_OK);
    return { executable: item.program, args: [entry, ...item.appArgs] };
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
