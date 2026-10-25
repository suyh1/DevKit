import { glob, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseNginx } from '../shared/nginx.mjs';
import { pathKey } from './nginx-process.mjs';

const directoryDirectives = new Set(['client_body_temp_path', 'proxy_temp_path', 'fastcgi_temp_path', 'uwsgi_temp_path', 'scgi_temp_path', 'proxy_cache_path', 'fastcgi_cache_path', 'uwsgi_cache_path', 'scgi_cache_path', 'working_directory']);
const fileDirectives = new Set(['pid', 'error_log', 'access_log', 'lock_file', 'proxy_store', 'fastcgi_store', 'uwsgi_store', 'scgi_store']);
const dataBlocks = new Set(['types', 'map', 'geo', 'split_clients', 'charset_map']);

function fileDestination(name, value) {
  if (name === 'access_log' && value === 'off') return false;
  if (['error_log', 'access_log'].includes(name) && (value === 'stderr' || /^(syslog|memory):/.test(value))) return false;
  if (name.endsWith('_store') && ['on', 'off'].includes(value)) return false;
  return true;
}
function buildOption(output, name, fallback) {
  const match = output.match(new RegExp(`(?:^|\\s)--${name}=(?:'([^']*)'|"([^"]*)"|(\\S*))`));
  return match ? match.slice(1).find(value => value !== undefined) : fallback;
}

// Directory preparation never creates config, certificate, log or PID files.
// Build the full plan first so unreadable includes and malformed files cause no mkdir.
export async function prepareNginxDirectories(instance, { readConfig, buildInfo = '', makeDirectory = mkdir } = {}) {
  const directories = new Map(), warnings = new Set(), visited = new Set(), stack = new Set();
  function addDirectory(directory) {
    directory = path.resolve(directory);
    if (directories.size >= 1000 && !directories.has(pathKey(directory))) throw new Error('配置涉及的运行目录超过 1000 个，请缩小范围。');
    directories.set(pathKey(directory), directory);
  }
  addDirectory(instance.prefix);
  addDirectory(path.dirname(instance.pidPath));
  const confPrefix = path.dirname(instance.main);
  async function visit(filename, depth = 0) {
    if (depth > 32) throw new Error('运行目录扫描的 include 嵌套超过 32 层。');
    const resolved = await realpath(filename), key = pathKey(resolved);
    if (stack.has(key)) throw new Error(`include 存在循环引用，无法准备目录：${filename}`);
    if (visited.has(key)) return;
    if (visited.size >= 100) throw new Error('运行目录扫描的配置文件超过 100 个。');
    visited.add(key); stack.add(key);
    const { content } = await readConfig(resolved);
    async function nodes(items) {
      for (const node of items) {
        if (node.name === 'include' && !node.block) {
          if (node.values.length !== 1 || node.values[0].includes('$')) { warnings.add(`无法提前解析 include：${node.args}`); continue; }
          const pattern = path.resolve(confPrefix, node.values[0]).replaceAll('\\', '/');
          let count = 0;
          for await (const match of glob(pattern)) { count++; await visit(match, depth + 1); }
          if (!count && !/[*?[{]/.test(pattern)) throw new Error(`引用的配置文件不存在：${path.resolve(confPrefix, node.values[0])}`);
          continue;
        }
        if (node.block) { if (!dataBlocks.has(node.name)) await nodes(node.children); continue; }
        if (!directoryDirectives.has(node.name) && !fileDirectives.has(node.name)) continue;
        const value = node.values[0];
        if (!value || !fileDestination(node.name, value)) continue;
        if (value.includes('$')) { warnings.add(`${node.name} 含变量，目录在运行时才能确定，未自动创建：${value}`); continue; }
        if (/[\0\r\n\t]/.test(value)) throw new Error(`${node.name} 的路径含无效控制字符：${filename} 第${node.line}行`);
        const target = path.resolve(instance.prefix, value);
        addDirectory(directoryDirectives.has(node.name) ? target : path.dirname(target));
      }
    }
    await nodes(parseNginx(content)); stack.delete(key);
  }
  await visit(instance.main);

  const createdDirectories = [], directoryWarnings = [...warnings];
  async function ensure(directory) {
    try {
      const created = await makeDirectory(directory, { recursive: true });
      if (created && !createdDirectories.some(item => pathKey(item) === pathKey(directory))) createdDirectories.push(directory);
      return !!created;
    } catch (cause) {
      const error = new Error(`无法自动创建运行目录：${directory}\n${cause.code || ''} ${cause.message}。请检查写入权限或同名文件占用。`);
      Object.assign(error, { createdDirectories: [...createdDirectories], directoryWarnings }); throw error;
    }
  }
  for (const directory of directories.values()) await ensure(directory);

  // Defaults can be absolute distro paths, and some modules may never use them.
  // Prepare a default only when nginx -t itself reports that exact path missing.
  const defaults = new Map(), attempted = new Set();
  for (const kind of ['client-body', 'proxy', 'fastcgi', 'uwsgi', 'scgi']) {
    const leaf = kind.replaceAll('-', '_') + '_temp';
    const value = buildOption(buildInfo, `http-${kind}-temp-path`, process.platform === 'win32' ? `temp/${leaf}` : leaf);
    defaults.set(pathKey(path.resolve(instance.prefix, value)), { path: path.resolve(instance.prefix, value), directory: true });
  }
  for (const [name, fallback] of [['error-log-path', 'logs/error.log'], ['http-log-path', 'logs/access.log'], ['pid-path', 'logs/nginx.pid'], ['lock-path', 'logs/nginx.lock']]) {
    const value = buildOption(buildInfo, name, fallback);
    if (!value || !fileDestination(name === 'http-log-path' ? 'access_log' : 'error_log', value) || value.includes('$')) continue;
    const target = path.resolve(instance.prefix, value);
    defaults.set(pathKey(target), { path: target, directory: false });
    if (name === 'lock-path') defaults.set(pathKey(target + '.accept'), { path: target + '.accept', directory: false });
  }
  async function repairMissing(output) {
    const matches = output.matchAll(/(CreateDirectory\(\)|mkdir\(\)|CreateFile\(\)|open\(\))\s+"([^"\r\n]+)"\s+failed\s+\((2|3):/g);
    let changed = false;
    for (const match of matches) {
      const target = path.resolve(instance.prefix, match[2]), key = pathKey(target), item = defaults.get(key);
      if (!item || attempted.has(key) || item.directory !== /^(CreateDirectory|mkdir)/.test(match[1])) continue;
      attempted.add(key);
      changed = await ensure(item.directory ? item.path : path.dirname(item.path)) || changed;
    }
    return changed;
  }
  return { createdDirectories, directoryWarnings, repairMissing };
}

export function withDirectoryReport(result, preparation = {}) {
  const { createdDirectories = [], directoryWarnings = [] } = preparation;
  return { ...result, createdDirectories: [...createdDirectories], directoryWarnings: [...directoryWarnings], output: [
    createdDirectories.length ? `已自动创建运行目录（${createdDirectories.length}）：\n${createdDirectories.map(directory => `- ${directory}`).join('\n')}` : '',
    directoryWarnings.length ? `目录准备提示：\n${directoryWarnings.join('\n')}` : '',
    result.output,
  ].filter(Boolean).join('\n\n') };
}
