import path from 'node:path';
import { glob, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parseNginx } from '../shared/nginx.mjs';
import { pathKey } from './nginx-process.mjs';

// Follow actual includes in their parent contexts. Registered attachments alone are not effective.
export async function inspectNginx(instance, readDocument) {
  const documents = new Map(), references = [], logs = new Map(), warnings = [], cache = new Map(), parsed = new Map();
  let visits = 0, characters = 0;
  async function load(filename) {
    const cached = cache.get(pathKey(filename));
    if (cached) return cached;
    const doc = await readDocument(filename);
    characters += doc.content.length;
    if (characters > 10_000_000) throw new Error('引用配置内容超过 10,000,000 字符，扫描结果不完整。');
    cache.set(pathKey(filename), doc); cache.set(pathKey(doc.path), doc);
    return doc;
  }
  async function visit(filename, context = [], stack = [], depth = 0) {
    if (++visits > 1000 || depth > 32) { warnings.push('引用扫描达到 1,000 次或 32 层上限，结果不完整。'); return; }
    let doc;
    try { doc = await load(filename); } catch (error) { warnings.push(`${filename}：${error.message}`); return; }
    const key = pathKey(doc.path);
    if (stack.includes(key)) { warnings.push(`循环 include：${filename}`); return; }
    if (!documents.has(key) && documents.size >= 100) { warnings.push('引用扫描达到 100 个文件上限，结果不完整。'); return; }
    documents.set(key, doc);
    let nodes;
    try { nodes = parsed.get(key) || parseNginx(doc.content); parsed.set(key, nodes); } catch (error) { warnings.push(`${filename}：${error.message}`); return; }
    async function walk(nodes, context) {
      for (const node of nodes) {
        if (node.name === 'include') {
          const value = node.values[0];
          if (node.values.length !== 1 || !value || value.includes('$')) { warnings.push(`无法解析引用：${doc.path}:${node.line}`); continue; }
          let matches = 0;
          try {
            for await (const match of glob(path.resolve(path.dirname(instance.main), value).replaceAll('\\', '/'))) {
              if (++matches > 100 || references.length >= 1000) { warnings.push('引用数量超过扫描上限，结果不完整。'); break; }
              let target;
              try { target = await load(match); } catch (error) { warnings.push(`${match}：${error.message}`); continue; }
              references.push({ from: doc.path, to: target.path, line: node.line, context: context.join(' → ') || '主层级' });
              await visit(target.path, context, [...stack, key], depth + 1);
            }
            if (!matches) warnings.push(`未匹配引用：${doc.path}:${node.line} ${value}`);
          } catch (error) { warnings.push(`${doc.path}:${node.line}：${error.message}`); }
        }
        if (['access_log', 'error_log'].includes(node.name)) {
          const value = node.values[0];
          if (!value || /^(?:off|stderr)$|^(?:syslog|memory):/.test(value)) continue;
          if (value.includes('$')) { warnings.push(`动态日志路径需在外部查看：${value}`); continue; }
          const filename = path.resolve(instance.prefix, value), logKey = pathKey(filename);
          const item = logs.get(logKey) || { path: filename, kinds: [], sources: [] };
          if (!item.kinds.includes(node.name)) item.kinds.push(node.name);
          if (item.sources.length < 100) item.sources.push({ file: doc.path, line: node.line, context: context.join(' → ') || '主层级' });
          logs.set(logKey, item);
        }
        if (node.block) {
          const label = node.name === 'server' ? `server ${node.children.find(child => child.name === 'server_name')?.args || node.children.find(child => child.name === 'listen')?.args || ''} (${path.basename(doc.path)}:${node.line})` : `${node.name}${node.args ? ` ${node.args}` : ''}`;
          await walk(node.children, [...context, label]);
        }
      }
    }
    await walk(nodes, context);
  }
  await visit(instance.main);
  return { documents: [...documents.values()], references, logs: [...logs.values()], warnings: [...new Set(warnings)].slice(0, 100) };
}

export async function tailNginxLog(filename, options = {}) {
  const lines = options.lines ?? 300;
  if (!Number.isInteger(lines) || lines < 1 || lines > 2000 || typeof (options.query ?? '') !== 'string' || (options.query || '').length > 200 || !['all', 'error', 'warn', 'notice', 'info', 'debug'].includes(options.level || 'all')) throw new Error('日志筛选参数无效。');
  // O_NONBLOCK prevents opening FIFOs from hanging the main process on Unix.
  const handle = await open(filename, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('日志目标不是普通文件。');
    const length = Math.min(info.size, 1_000_000), offset = info.size - length, buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    let content = buffer.subarray(0, bytesRead).toString('utf8');
    if (offset) { const next = content.indexOf('\n'); content = next < 0 ? '' : content.slice(next + 1); }
    const query = (options.query || '').toLocaleLowerCase(), level = options.level || 'all';
    const candidates = content.split(/\r?\n/); if (candidates.at(-1) === '') candidates.pop();
    const filtered = candidates.filter(line => (!query || line.toLocaleLowerCase().includes(query)) && (level === 'all' || line.includes(`[${level}]`) || level === 'error' && /\[(?:emerg|alert|crit|error)\]/.test(line)));
    return { path: filename, text: filtered.slice(-lines).join('\n'), size: info.size, modifiedAt: info.mtime.toISOString(), identity: `${info.dev}:${info.ino}:${info.birthtimeMs}`, truncated: offset > 0 || filtered.length > lines, scannedBytes: bytesRead };
  } finally { await handle.close(); }
}
