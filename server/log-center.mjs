import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { jarPaths } from './jar-manager.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const sourceId = (kind, id, filename) => digest(`${kind}\0${id}\0${filename}`);
const fail = message => { throw new Error(message); };

// File cursors are byte offsets. Verify the bytes before the offset to detect copy-truncate
// and same-size rewrites, and leave a split UTF-8 character for the next read.
export async function readLogFile(filename, cursor, { initial = 128 * 1024, chunk = 64 * 1024 } = {}) {
  const handle = await open(filename, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK));
  try {
    const info = await handle.stat(); if (!info.isFile()) fail('日志目标不是普通文件。');
    const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
    let reset = !cursor || cursor.kind !== 'file' || cursor.identity !== identity || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > info.size;
    if (!reset) {
      const check = Buffer.alloc(Math.min(64, cursor.offset));
      const read = await handle.read(check, 0, check.length, cursor.offset - check.length);
      reset = digest(check.subarray(0, read.bytesRead)) !== cursor.anchor;
    }
    let offset = reset ? Math.max(0, info.size - initial) : cursor.offset;
    const truncated = reset && offset > 0;
    const buffer = Buffer.alloc(Math.min(reset ? initial : chunk, Math.max(0, info.size - offset)));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    let end = bytesRead;
    // A leading byte announces 2–4 bytes. Do not consume an incomplete final sequence.
    if (end) {
      let start = end - 1; while (start > 0 && (buffer[start] & 0xc0) === 0x80) start--;
      const byte = buffer[start], expected = byte >= 0xf0 && byte <= 0xf4 ? 4 : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xc2 && byte <= 0xdf ? 2 : 1;
      if (expected > end - start) end = start;
    }
    let bytes = buffer.subarray(0, end);
    if (truncated) { const newline = bytes.indexOf(10); bytes = newline < 0 ? Buffer.alloc(0) : bytes.subarray(newline + 1); }
    offset += end;
    const anchor = Buffer.alloc(Math.min(64, offset)), checked = await handle.read(anchor, 0, anchor.length, offset - anchor.length);
    return { text: bytes.toString('utf8'), cursor: { kind: 'file', identity, offset, anchor: digest(anchor.subarray(0, checked.bytesRead)) }, reset, truncated, size: info.size, more: info.size > offset, checkedAt: new Date().toISOString() };
  } finally { await handle.close(); }
}

export function createLogCenter({ jar, nginx }) {
  const clientId = randomUUID();
  let active = 0;
  async function discover(access = {}) {
    const sources = [], warnings = [];
    if (access.jar !== false) {
      try {
        const state = await jar?.()?.request('get', {}, { allowEdit: false, allowControl: false });
        for (const item of state?.instances || []) {
          if (item.logMode === 'silent') continue;
          const console = item.logMode === 'console', filename = console ? '' : jarPaths(item).logPath;
          sources.push({ id: sourceId('jar', item.id, filename), kind: 'jar', instanceId: item.id, name: `${item.name} · ${console ? '控制台输出' : '文件日志'}`, path: filename, mode: console ? 'console' : 'file' });
        }
      } catch (error) { warnings.push(`JAR 来源读取失败：${error.message}`); }
    }
    if (access.nginx !== false) {
      try {
        const manager = nginx?.(), state = await manager?.request('get');
        for (const item of state?.instances || []) {
          try {
            const scan = await manager.request('inspect', { id: item.id }, { allowExecution: false });
            warnings.push(...scan.warnings.map(value => `${item.name}：${value}`));
            for (const log of scan.logs) {
              if (sources.length >= 300) break;
              sources.push({ id: sourceId('nginx', item.id, log.path), kind: 'nginx', instanceId: item.id, name: `${item.name} · ${log.kinds.join(' / ')}`, path: log.path, mode: 'file' });
            }
          } catch (error) { warnings.push(`${item.name}：${error.message}`); }
        }
      } catch (error) { warnings.push(`Nginx 来源读取失败：${error.message}`); }
    }
    if (sources.length >= 300) warnings.push('来源列表最多显示 300 项，请在原模块整理实例配置。');
    return { sources: sources.slice(0, 300), warnings: [...new Set(warnings)].slice(0, 30) };
  }
  async function read(source, cursor, exporting = false) {
    if (source.mode === 'file') return readLogFile(source.path, exporting ? null : cursor, exporting ? { initial: 1024 * 1024 } : {});
    let result, text = '', count = 0;
    do {
      result = await jar().request('console-read', { id: source.instanceId, clientId, cursor: cursor?.offset, generation: cursor?.identity }, { allowEdit: false, allowControl: false });
      if (!result.available) return { text: '', cursor: null, reset: true, truncated: false, available: false, checkedAt: new Date().toISOString() };
      text += result.text; cursor = { kind: 'console', identity: result.generation, offset: result.cursor };
      count++;
    } while (exporting && result.cursor < result.end && count < 16);
    return { text, cursor, reset: result.reset, truncated: result.truncated, available: true, more: result.cursor < result.end, checkedAt: new Date().toISOString() };
  }
  return {
    async request(action, payload = {}, access = {}) {
      if (active >= 4) throw Object.assign(new Error('日志读取繁忙，请稍后重试。'), { status: 429 });
      active++;
      try {
      if (!['sources', 'read', 'export'].includes(action)) fail('未知日志中心操作。');
      if (action === 'export' && access.export === false) fail('未授予日志导出权限。');
      const catalog = await discover(access);
      if (action === 'sources') return catalog;
      const requested = payload.sources;
      if (!Array.isArray(requested) || requested.length < 1 || requested.length > 4 || requested.some(item => !item || typeof item.id !== 'string' || !/^[a-f0-9]{64}$/.test(item.id)) || new Set(requested.map(item => item.id)).size !== requested.length) fail('每次请选择 1–4 个不同的已登记日志来源。');
      const results = [];
      // A fixed bound protects the host even when several visitors track the same files.
      for (const value of requested) {
        const source = catalog.sources.find(item => item.id === value.id);
        if (!source) { results.push({ id: value.id, error: '来源已移除、变更或未授权，请刷新来源列表。' }); continue; }
        try { results.push({ id: source.id, ...await read(source, value.cursor, action === 'export') }); }
        catch (error) { results.push({ id: source.id, error: error.code === 'ENOENT' ? '日志文件尚未生成或已被移走。' : error.message }); }
      }
      return { results };
      } finally { active--; }
    },
  };
}
