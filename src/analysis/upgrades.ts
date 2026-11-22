import { jsonTree } from '../result-model';
import { table, type Opt, csv } from './tabular';
import { timestampDate } from '../time-conversion';
import { httpCode } from '../http-code';
export type MergeBlock = { ok?: string[]; conflict?: { a: string[]; o: string[]; b: string[] } };
export function curlConfig(input: string) {
  const tokens: string[] = [];
  let quote = '',
    part = '',
    active = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '\\' && quote !== "'") {
      if (i + 1 === input.length) throw Error('末尾反斜线缺少字符');
      const next = input[++i];
      if (next !== '\n') part += (quote === '"' && !/["\\$\x60]/.test(next) ? '\\' : '') + next;
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      else part += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      active = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (active || part) tokens.push(part);
      part = '';
      active = false;
      continue;
    }
    if (/[|;<>&\x60]/.test(c) || (c === '$' && input[i + 1] === '(')) throw Error('仅可导入单条 cURL 命令');
    part += c;
    active = true;
  }
  if (quote) throw Error('引号未闭合');
  if (active || part) tokens.push(part);
  if (tokens.shift() !== 'curl') throw Error('输入应以 curl 开头');
  const headers: Record<string, string> = Object.create(null),
    data: string[] = [];
  let method = '',
    url = '';
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i];
    const value = () => {
      if (++i >= tokens.length) throw Error(arg + ' 缺少参数');
      return tokens[i];
    };
    if (arg === '-X' || arg === '--request') method = value();
    else if (arg === '-H' || arg === '--header') {
      const s = value(),
        at = s.indexOf(':');
      if (at < 1) throw Error('无效请求头：' + s);
      headers[s.slice(0, at).trim()] = s.slice(at + 1).trim();
    } else if (['-d', '--data', '--data-raw', '--data-binary'].includes(arg)) {
      const v = value();
      if (v.startsWith('@') && arg !== '--data-raw') throw Error('不读取命令引用的外部文件');
      data.push(v);
    } else if (arg === '--url') url = value();
    else if (arg.startsWith('-')) throw Error('未支持的 cURL 参数：' + arg);
    else if (url) throw Error('只支持单个 URL');
    else url = arg;
  }
  if (data.length && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type'))
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  return {
    method: method || (data.length ? 'POST' : 'GET'),
    url,
    headers,
    ...(data.length ? { body: data.join('&') } : {}),
  };
}
export function inserts(input: string, o: Opt) {
  const isJson = input.trimStart().startsWith('['),
    records: Record<string, unknown>[] = isJson
      ? jsonTree(input, { length: 2_000_000, nodes: 200_000 }).children.map(({ node }) => {
          if (node.kind !== 'object') throw Error('JSON 数组中的每项都应为记录对象');
          const entries = node.children.map(({ key, node: field }) => {
            if (field.kind !== 'value') return [key, field.raw] as const;
            if (/^-?\d/.test(field.raw)) return [key, { numeric: field.raw }] as const;
            return [key, JSON.parse(field.raw)] as const;
          });
          if (new Set(entries.map(([key]) => key)).size !== entries.length)
            throw Error('JSON 记录含重复字段');
          return Object.fromEntries(entries);
        })
      : (() => {
          const { header, rows } = table(input);
          return rows.map((row) =>
            Object.fromEntries(
              header.map((k, i) => [k, o.nullMarker && row[i] === o.nullMarker ? null : row[i]]),
            ),
          );
        })();
  if (
    !Array.isArray(records) ||
    !records.length ||
    records.some((v) => !v || typeof v !== 'object' || Array.isArray(v))
  )
    throw Error('需要非空记录数组或有表头的 CSV');
  const cols = o.columns?.trim()
    ? o.columns.split(',').map((s) => s.trim())
    : [...new Set(records.flatMap(Object.keys))];
  const quote = o.dialect === 'mysql' ? '\x60' : '"',
    identifier = (s: string) => {
      if (!s.trim() || s.includes('\0')) throw Error('空或无效标识符');
      return quote + s.replaceAll(quote, quote + quote) + quote;
    };
  const name = o.table.split('.').map(identifier).join('.');
  function literal(v: unknown) {
    if (v == null) return 'NULL';
    if (typeof v === 'object' && 'numeric' in v) return String(v.numeric);
    if (typeof v === 'number' || typeof v === 'boolean') return String(v).toUpperCase();
    let text = typeof v === 'string' ? v : JSON.stringify(v);
    if (text.includes('\0')) throw Error('字符串包含 NUL');
    if (o.dialect === 'mysql') text = text.replace(/\\/g, '\\\\');
    return "'" + text.replace(/'/g, "''") + "'";
  }
  const batch = Number(o.batch);
  if (!Number.isInteger(batch) || batch < 1 || batch > 10000) throw Error('每批行数应为 1–10000');
  const out: string[] = [];
  for (let at = 0; at < records.length; at += batch)
    out.push(
      'INSERT INTO ' +
        name +
        ' (' +
        cols.map(identifier).join(', ') +
        ') VALUES\n' +
        records
          .slice(at, at + batch)
          .map((record) => '(' + cols.map((k) => literal(record[k])).join(', ') + ')')
          .join(',\n') +
        ';',
    );
  return out.join('\n\n');
}
export function uuid7(input: string) {
  if (input.includes('-')) {
    return csv([
      ['UUID v7', '毫秒', 'UTC'],
      ...input
        .trim()
        .split(/\s+/)
        .map((s) => {
          if (!/^[\da-f]{8}-[\da-f]{4}-7[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(s))
            throw Error('无效 UUID v7：' + s);
          const n = parseInt(s.slice(0, 13).replace('-', ''), 16);
          return [s, n, new Date(n).toISOString()];
        }),
    ]);
  }
  const count = Number(input);
  if (!Number.isInteger(count) || count < 1 || count > 1000)
    throw Error('请输入数量 1–1000，或要解析的 UUID v7');
  return Array.from({ length: count }, () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let t = Date.now();
    for (let i = 5; i >= 0; i--) {
      bytes[i] = t % 256;
      t = Math.floor(t / 256);
    }
    bytes[6] = 0x70 | (bytes[6] & 15);
    bytes[8] = 0x80 | (bytes[8] & 63);
    const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
  }).join('\n');
}
export function clampValues(o: Opt) {
  const [w1, w2, a, b] = [o.fromWidth, o.toWidth, o.fromSize, o.toSize].map(Number);
  if (![w1, w2, a, b].every(Number.isFinite) || w1 <= 0 || w2 <= w1 || Math.min(a, b) < 0)
    throw Error('宽度应正向递增，字号须为非负数');
  const slope = (b - a) / (w2 - w1),
    intercept = a - slope * w1,
    fmt = (v: number) => Number(v.toFixed(6));
  return {
    slope,
    intercept,
    a,
    b,
    w1,
    w2,
    css:
      'clamp(' +
      Math.min(a, b) +
      'px, ' +
      fmt(intercept) +
      'px ' +
      (slope < 0 ? '-' : '+') +
      ' ' +
      fmt(Math.abs(slope) * 100) +
      'vw, ' +
      Math.max(a, b) +
      'px)',
  };
}
export async function upgrade(id: string, input: string, o: Opt) {
  switch (id) {
    case 'diff': {
      const { diff3Merge } = await import('node-diff3');
      return JSON.stringify(
        diff3Merge(input.split('\n'), o.base.split('\n'), o.target.split('\n'), {
          excludeFalseConflicts: true,
        }),
      );
    }
    case 'json': {
      const { default: patch } = await import('fast-json-patch');
      if (o.patchMode === 'apply') {
        const ops = JSON.parse(input);
        if (!Array.isArray(ops)) throw Error('需要 RFC 6902 操作数组');
        return JSON.stringify(
          patch.applyPatch(JSON.parse(o.third), ops, true, false, true).newDocument,
          null,
          2,
        );
      }
      const base = JSON.parse(input),
        target = JSON.parse(o.target);
      const bothObjects =
        base !== null &&
        target !== null &&
        typeof base === 'object' &&
        typeof target === 'object' &&
        Array.isArray(base) === Array.isArray(target);
      const operations = bothObjects ? patch.compare(base, target) : [];
      if (
        (typeof base !== 'object' ||
          base === null ||
          typeof target !== 'object' ||
          target === null ||
          Array.isArray(base) !== Array.isArray(target)) &&
        JSON.stringify(base) !== JSON.stringify(target)
      )
        operations.splice(0, operations.length, { op: 'replace', path: '', value: target });
      const applied = patch.applyPatch(JSON.parse(o.third), operations, true, false, true).newDocument;
      return JSON.stringify({ patch: operations, result: applied }, null, 2);
    }
    case 'yaml': {
      const toml = await import('smol-toml'),
        yaml = await import('yaml');
      const warning = /(^|\s)#/.test(input) ? '# 转换时原注释未保留\n' : '';
      if (o.direction === 'toml-yaml') return warning + yaml.stringify(toml.parse(input));
      const obj = yaml.parse(input, { schema: 'core' });
      function check(v: unknown, path: string) {
        if (v === null) throw Error('TOML 无法表示 null：' + path);
        if (typeof v === 'object') for (const [k, x] of Object.entries(v as object)) check(x, path + '.' + k);
      }
      check(obj, '$');
      return warning + toml.stringify(obj);
    }
    case 'sql':
      return inserts(input, o);
    case 'http-code': {
      const cfg = curlConfig(input);
      return JSON.stringify(cfg, null, 2) + '\n\n' + httpCode(JSON.stringify(cfg), { style: o.style });
    }
    case 'timestamp': {
      const dates = input
        .trim()
        .split(/\r?\n/)
        .map((s) => timestampDate(s, o.unit));
      if (dates.length < 2) throw Error('每行一个时刻，至少两行');
      return csv([
        ['行', 'UTC', '距上一行 ms', '距首行 ms'],
        ...dates.map((date, i) => [
          i + 1,
          date.toISOString(),
          i ? +date - +dates[i - 1] : '',
          +date - +dates[0],
        ]),
      ]);
    }
    case 'cron':
      return (await import('./zoned-cron')).zonedCron(input, o);
    case 'uuid':
      return uuid7(input);
    case 'css-unit':
      return clampValues(o).css;
    case 'geo-coordinates': {
      const { parseCoordinatePair } = await import('../geography'),
        { default: geo } = await import('geographiclib-geodesic');
      const a = parseCoordinatePair(input),
        b = parseCoordinatePair(o.target);
      const inverse = geo.Geodesic.WGS84.Inverse(+a.lat, +a.lon, +b.lat, +b.lon);
      if (!Number.isFinite(inverse.s12)) throw Error('无效经纬度');
      return csv([
        ['距离（米）', '距离（公里）', '初始方位（度）'],
        [
          inverse.s12!.toFixed(3),
          (inverse.s12! / 1000).toFixed(6),
          inverse.s12 ? ((inverse.azi1! + 360) % 360).toFixed(6) : '重合点，无方位',
        ],
      ]);
    }
    default:
      throw Error('未识别的操作');
  }
}
