import { parseCsv } from '../practical';
export type Opt = Record<string, string>;
export function csv(rows: unknown[][]) {
  return rows
    .map((row) =>
      row
        .map((item) => {
          const text = item == null ? '' : String(item);
          return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        })
        .join(','),
    )
    .join('\r\n');
}
export function table(input: string, strict = true) {
  const first = input.split(/\r?\n/, 1)[0].replace(/"(?:[^"]|"")*"/g, '');
  const [header, ...rows] = parseCsv(input, first.includes('\t') ? '\t' : ',', !strict);
  if (header.some((h) => !h.trim()) || new Set(header).size !== header.length)
    throw Error('表头含空列名或重复列名');
  if (strict) {
    const invalid = rows.findIndex((row) => row.length !== header.length);
    if (invalid !== -1) throw Error('第 ' + (invalid + 2) + ' 条记录的列数与表头不符');
  }
  return { header, rows };
}
function names(value: string) {
  const keys = value
    .split(/[,，]/)
    .map((key) => key.trim())
    .filter(Boolean);
  if (!keys.length) throw Error('请至少指定一个字段');
  return [...new Set(keys)];
}
function columns(header: string[], keys: string[]) {
  return keys.map((key) => {
    const i = header.indexOf(key);
    if (i < 0) throw Error('没有找到字段「' + key + '」。可用字段：' + header.join('、'));
    return i;
  });
}
export function reconcile(input: string, options: Opt) {
  const left = table(input),
    right = table(options.target),
    keys = names(options.keys);
  function index(data: ReturnType<typeof table>) {
    const indices = columns(data.header, keys),
      groups = new Map<string, string[][]>();
    for (const row of data.rows) {
      const key = JSON.stringify(indices.map((i) => row[i]));
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    return groups;
  }
  const a = index(left),
    b = index(right);
  const fields = [...new Set([...left.header, ...right.header])].filter((k) => !keys.includes(k));
  const indices = fields.map((k) => [left.header.indexOf(k), right.header.indexOf(k)]);
  const report: unknown[][] = [['状态', ...keys, '字段', '左表', '右表']];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const l = a.get(key) ?? [],
      r = b.get(key) ?? [],
      prefix = JSON.parse(key);
    if (l.length > 1 || r.length > 1) report.push(['重复键', ...prefix, '记录数', l.length, r.length]);
    else if (!l.length || !r.length)
      report.push([
        l.length ? '仅左表' : '仅右表',
        ...prefix,
        '整行',
        l.length ? JSON.stringify(l[0]) : '',
        r.length ? JSON.stringify(r[0]) : '',
      ]);
    else
      fields.forEach((field, i) => {
        const [x, y] = indices[i];
        if (l[0][x] !== r[0][y])
          report.push(['变更', ...prefix, field, l[0][x] ?? '（无此列）', r[0][y] ?? '（无此列）']);
      });
  }
  return csv(report);
}
export function health(input: string) {
  const { header, rows } = table(input, false),
    seen = new Map<string, number>();
  const report: unknown[][] = [['记录号', '问题', '字段或详情', '原始记录']];
  rows.forEach((row, i) => {
    const original = JSON.stringify(row),
      add = (issue: string, detail: string) => report.push([i + 2, issue, detail, original]);
    if (row.length !== header.length) add('列数异常', row.length + ' 列 / 表头 ' + header.length + ' 列');
    const blank = header.filter((_, j) => !row[j]?.trim());
    if (blank.length) add('空值', blank.join('、'));
    if (seen.has(original)) add('重复', '首次出现于第 ' + seen.get(original) + ' 条记录');
    else seen.set(original, i + 2);
  });
  return csv(report);
}
export function pivot(input: string, o: Opt) {
  const { header, rows } = table(input),
    keys = names(o.keys),
    group = columns(header, keys);
  const count = o.aggregate === 'count',
    column = count ? -1 : columns(header, [o.value])[0];
  const buckets = new Map<string, { key: string[]; count: number; sum: number; min: number; max: number }>();
  rows.forEach((row, i) => {
    const key = group.map((j) => row[j]),
      id = JSON.stringify(key);
    const b = buckets.get(id) ?? { key, count: 0, sum: 0, min: Infinity, max: -Infinity };
    const n = count ? 1 : Number(row[column]);
    if (!count && (!row[column].trim() || !Number.isFinite(n)))
      throw Error('记录 ' + (i + 2) + ' 的「' + o.value + '」不是有效数值');
    b.count++;
    b.sum += n;
    b.min = Math.min(b.min, n);
    b.max = Math.max(b.max, n);
    buckets.set(id, b);
  });
  return csv([
    [...keys, count ? 'count' : o.aggregate + '(' + o.value + ')'],
    ...Array.from(buckets.values(), (b) => [
      ...b.key,
      count
        ? b.count
        : o.aggregate === 'avg'
          ? b.sum / b.count
          : o.aggregate === 'min'
            ? b.min
            : o.aggregate === 'max'
              ? b.max
              : b.sum,
    ]),
  ]);
}
function parts(path: string) {
  const keys = path.split('.');
  if (keys.some((k) => !k || ['__proto__', 'prototype', 'constructor'].includes(k.replace(/\[\]$/, ''))))
    throw Error('无效字段路径：' + path);
  return keys;
}
function readPath(obj: unknown, keys: string[]): unknown {
  if (!keys.length) return obj;
  const [head, ...tail] = keys,
    name = head.replace(/\[\]$/, '');
  if (!obj || typeof obj !== 'object' || !Object.hasOwn(obj, name)) throw Error('缺少字段：' + name);
  const value = (obj as Record<string, unknown>)[name];
  if (head.endsWith('[]')) {
    if (!Array.isArray(value)) throw Error(name + ' 应为数组');
    return value.map((item) => readPath(item, tail));
  }
  return readPath(value, tail);
}
export function jsonMap(input: string, o: Opt) {
  const rules = JSON.parse(o.mapping),
    data = JSON.parse(input);
  if (!rules || typeof rules !== 'object' || Array.isArray(rules) || !Object.keys(rules).length)
    throw Error('请输入非空的映射对象');
  const map = (record: unknown) => {
    const out: Record<string, unknown> = Object.create(null);
    for (const [dest, src] of Object.entries(rules)) {
      if (typeof src !== 'string') throw Error('来源路径必须为字符串');
      const path = parts(dest),
        last = path.pop()!;
      let owner = out;
      for (const key of path) {
        if (
          Object.hasOwn(owner, key) &&
          (!owner[key] || typeof owner[key] !== 'object' || Object.getPrototypeOf(owner[key]) !== null)
        )
          throw Error('目标路径冲突：' + dest);
        owner[key] ??= Object.create(null);
        owner = owner[key] as Record<string, unknown>;
      }
      if (Object.hasOwn(owner, last)) throw Error('目标路径冲突：' + dest);
      owner[last] = readPath(record, parts(src));
    }
    return out;
  };
  return JSON.stringify(Array.isArray(data) ? data.map(map) : map(data), null, 2);
}
export async function pseudonym(input: string, o: Opt) {
  const keys = names(o.keys),
    { sha256 } = await import('@noble/hashes/sha2.js'),
    encoder = new TextEncoder(),
    aliases = new Map<string, string>();
  function replace(value: unknown) {
    if (value == null || value === '') return value;
    if (typeof value === 'object') throw Error('请选择具体的标量字段');
    const id = JSON.stringify([o.salt, value]);
    let alias = aliases.get(id);
    if (!alias) {
      alias =
        '匿名-' +
        Array.from(sha256(encoder.encode(id)).slice(0, 10), (n) => n.toString(16).padStart(2, '0')).join('');
      aliases.set(id, alias);
    }
    return alias;
  }
  if (/^\s*[[{]/.test(input)) {
    const data = JSON.parse(input),
      records = Array.isArray(data) ? data : [data];
    for (const key of keys) {
      const path = parts(key),
        last = path.pop()!;
      for (const row of records) {
        const owner = readPath(row, path);
        if (!owner || typeof owner !== 'object' || !Object.hasOwn(owner, last))
          throw Error('缺少字段：' + key);
        const rec = owner as Record<string, unknown>;
        rec[last] = replace(rec[last]);
      }
    }
    return JSON.stringify(data, null, 2);
  }
  const { header, rows } = table(input),
    selected = new Set(columns(header, keys));
  return csv([header, ...rows.map((row) => row.map((v, i) => (selected.has(i) ? replace(v) : v)))]);
}
