import { execFile } from 'node:child_process';
import { opendir, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveNode } from './backend-launch.mjs';
import { detectJava, pathKey } from './jar-process.mjs';

const execute = promisify(execFile);
const windows = process.platform === 'win32';
const below = (root, ...parts) => root && path.isAbsolute(root) ? path.join(root, ...parts) : '';

// Only inspect the direct children of known installation roots.
export async function discoverRuntimes(kind, { env = process.env, home = homedir(), configured = [] } = {}) {
  if (!['java', 'node'].includes(kind)) throw new Error('未知运行时类型。');
  const name = kind + (windows ? '.exe' : '');
  const files = new Set();
  const roots = new Map();
  let truncated = false;
  function add(file) {
    if (file && path.isAbsolute(file) && !file.includes('\0')) files.add(file);
  }
  function versions(root, suffix) {
    if (root && path.isAbsolute(root) && root !== path.parse(root).root) roots.set(path.normalize(root), suffix);
  }
  for (const file of configured) {
    if (path.basename(file).toLowerCase() === name) add(file);
  }
  for (const directory of (env.PATH || env.Path || '').split(path.delimiter)) add(below(directory.replace(/^"|"$/g, ''), name));
  const data = env.XDG_DATA_HOME || below(home, '.local/share');
  const asdf = env.ASDF_DATA_DIR || below(home, '.asdf');
  const mise = env.MISE_DATA_DIR || below(windows ? env.LOCALAPPDATA : data, 'mise');
  if (kind === 'java') {
    for (const [key, value] of Object.entries(env)) {
      if (/^(?:JAVA_HOME(?:_\d+.*)?|(?:JAVA|JDK|JRE)\d*_HOME)$/i.test(key)) add(below(value, 'bin', name));
    }
    versions(below(env.SDKMAN_CANDIDATES_DIR || below(env.SDKMAN_DIR || below(home, '.sdkman'), 'candidates'), 'java'), 'bin');
    versions(below(home, '.jdks'), 'bin');
    versions(below(asdf, 'installs/java'), 'bin');
    versions(below(mise, 'installs/java'), 'bin');
    if (windows) {
      for (const base of [env.ProgramFiles, env['ProgramFiles(x86)']]) {
        for (const vendor of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Amazon Corretto', 'Zulu', 'BellSoft', 'Semeru']) versions(below(base, vendor), 'bin');
      }
      const reg = below(env.SystemRoot, 'System32', 'reg.exe');
      if (reg) {
        const keys = ['HKLM\\SOFTWARE\\JavaSoft', 'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft', 'HKCU\\SOFTWARE\\JavaSoft'];
        await Promise.all(keys.map(async key => {
          const query = await execute(reg, ['query', key, '/s', '/v', 'JavaHome'], { timeout: 2500, maxBuffer: 131072, windowsHide: true }).catch(() => null);
          for (const match of (query?.stdout || '').matchAll(/^\s*JavaHome\s+REG_SZ\s+(.+?)\s*$/gmi)) add(below(match[1], 'bin', name));
        }));
      }
    } else {
      for (const root of ['/usr/lib/jvm', '/usr/java', '/usr/local/java']) versions(root, 'bin');
      if (process.platform === 'darwin') {
        versions('/Library/Java/JavaVirtualMachines', 'Contents/Home/bin');
        versions(below(home, 'Library/Java/JavaVirtualMachines'), 'Contents/Home/bin');
        versions('/opt/homebrew/opt', 'bin');
        versions('/usr/local/opt', 'bin');
      }
    }
  } else {
    const bin = windows ? '' : 'bin';
    add(below(env.NODE_HOME, bin, name));
    add(below(env.NVM_BIN, name));
    versions(env.NVM_HOME, bin);
    if (windows) {
      versions(below(env.APPDATA, 'nvm'), bin);
      versions(below(env.LOCALAPPDATA, 'nvm'), bin);
    }
    versions(below(env.NVM_DIR || below(home, '.nvm'), 'versions/node'), bin);
    versions(below(env.FNM_DIR || below(windows ? env.APPDATA : data, 'fnm'), 'node-versions'), path.join('installation', bin));
    if (process.platform === 'darwin') {
      versions(below(home, 'Library/Application Support/fnm/node-versions'), path.join('installation', bin));
      versions('/opt/homebrew/opt', 'bin');
      versions('/usr/local/opt', 'bin');
    }
    versions(below(env.VOLTA_HOME || (windows ? below(env.LOCALAPPDATA, 'Volta') : below(home, '.volta')), 'tools/image/node'), bin);
    versions(below(asdf, 'installs/nodejs'), bin);
    versions(below(mise, 'installs/node'), bin);
    add(below(env.NVM_SYMLINK, name));
    if (windows) add(below(env.ProgramFiles, 'nodejs', name));
    else for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']) add(below(dir, name));
  }

  // A PATH link or JAVA_HOME can point to a versioned installation on another drive.
  for (const file of await Promise.all([...files].map(file => realpath(file).catch(() => '')))) {
    if (!file) continue;
    const dir = path.dirname(file);
    const hasBin = path.basename(dir).toLowerCase() === 'bin';
    const install = hasBin ? path.dirname(dir) : dir;
    if (/^(?:v?\d+[._-]|(?:java|jdk|jre|node)[-_]?\d)/i.test(path.basename(install))) {
      versions(path.dirname(install), hasBin ? 'bin' : '');
    }
  }
  for (const [root, suffix] of roots) {
    const entries = await opendir(root).catch(() => null);
    if (!entries) continue;
    let count = 0;
    try {
      for await (const entry of entries) {
        if (++count > 256) { truncated = true; break; }
        if (entry.isDirectory() || entry.isSymbolicLink()) add(path.join(root, entry.name, suffix, name));
      }
    } catch { /* Continue if this root becomes inaccessible during enumeration. */ }
  }

  const seen = new Set();
  const results = new Map();
  const candidates = [...files];
  let next = 0;
  async function worker() {
    while (next < candidates.length) {
      const file = candidates[next++];
      try {
        const executable = kind === 'java' ? await realpath(file) : await resolveNode(file);
        const key = pathKey(executable);
        if (seen.has(key)) continue;
        if (seen.size >= 64) { truncated = true; break; }
        seen.add(key);
        if (kind === 'java') {
          let result = await detectJava({ executable, resolveHome: true });
          if (!result.found) result = await detectJava({ executable }); // Older VMs can lack -XshowSettings.
          const version = result.found && /"([^"\r\n]+)"/.exec(result.version)?.[1];
          if (version) results.set(pathKey(result.executable), { version, executable: result.executable });
        } else {
          const { stdout } = await execute(executable, ['-p', 'JSON.stringify([process.version, process.execPath])'], { cwd: tmpdir(), timeout: 3500, maxBuffer: 32768, windowsHide: true });
          const [version, binary] = JSON.parse(stdout);
          if (/^v\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(version) && path.isAbsolute(binary)) {
            const actual = await resolveNode(binary);
            results.set(pathKey(actual), { version, executable: actual });
          }
        }
      } catch { /* A stale entry or unusable installation does not hide the others. */ }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const installations = [...results.values()].sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }) || a.executable.localeCompare(b.executable));
  return { installations, truncated };
}
