import { csv, type Opt } from './tabular';
const numType = /^(?:Long|Integer|Short|Byte|Double|Float|BigDecimal|BigInteger)$/i;
function params(text: string) {
  if (!text.trim()) return [];
  return text.split(/(?<=\([A-Za-z.$\d]+\)|\bnull),\s*/).map((raw) => {
    if (raw === 'null') return 'NULL';
    const match = /^([\s\S]*)\(([\w.$]+)\)$/.exec(raw);
    if (!match) throw Error('无法识别参数：' + raw);
    const [, value, type] = match;
    if (numType.test(type) && /^[+-]?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?$/.test(value)) return value;
    if (type === 'Boolean' && /^(true|false)$/i.test(value)) return value.toUpperCase();
    return "'" + value.replace(/'/g, "''") + "'";
  });
}
export function mybatis(input: string) {
  const result: string[] = [],
    pending = new Map<string, string>();
  for (const line of input.split(/\r?\n/)) {
    const m = /^(.*?)(?:==>\s*)?(Preparing|Parameters):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, prefix, kind, body] = m;
    const thread = Array.from(prefix.matchAll(/\[([^\]]+)\]/g)).at(-1)?.[1] ?? '';
    if (kind === 'Preparing') {
      if (pending.has(thread)) result.push('-- 缺少 Parameters\n' + pending.get(thread));
      pending.set(thread, body);
      continue;
    }
    const sql = pending.get(thread);
    if (sql === undefined) {
      result.push('-- 缺少 Preparing\n-- ' + line);
      continue;
    }
    pending.delete(thread);
    try {
      const values = params(body);
      let i = 0;
      const rendered = sql.replace(
        /'(?:''|\\.|[^'])*'|"(?:""|[^"])*"|\x60(?:\x60\x60|[^\x60])*\x60|\/\*[\s\S]*?\*\/|--[^\n]*|\?/g,
        (token) => (token === '?' ? (values[i++] ?? '?') : token),
      );
      if (i !== values.length) throw Error('占位符 ' + i + ' 个，参数 ' + values.length + ' 个');
      result.push(rendered);
    } catch (e) {
      result.push('-- ' + (e as Error).message + '\n' + sql + '\n-- Parameters: ' + body);
    }
  }
  for (const sql of pending.values()) result.push('-- 缺少 Parameters\n' + sql);
  if (!result.length) throw Error('没有找到 Preparing 或 Parameters 记录');
  return result.join('\n\n');
}
export function pgPlan(input: string) {
  const root = JSON.parse(input),
    plan = (Array.isArray(root) ? root[0] : root)?.Plan;
  if (!plan?.['Node Type']) throw Error('请输入 EXPLAIN (FORMAT JSON) 的完整计划');
  type Plan = Record<string, unknown> & { Plans?: Plan[] };
  const rows: unknown[][] = [];
  function visit(n: Plan, path: string, depth: number) {
    const actual = Number(n['Actual Rows']),
      estimate = Number(n['Plan Rows']),
      loops = Number(n['Actual Loops']);
    const total = Number(n['Actual Total Time']) * loops;
    rows.push([
      path,
      '　'.repeat(depth) + n['Node Type'],
      n['Relation Name'] ?? '',
      Number.isFinite(total) ? total.toFixed(3) : '',
      n['Total Cost'],
      n['Plan Rows'],
      n['Actual Rows'],
      estimate > 0 && Number.isFinite(actual) ? (actual / estimate).toFixed(2) : '',
      n['Filter'] ?? n['Index Cond'] ?? '',
    ]);
    n.Plans?.forEach((p, i) => visit(p, path + '.' + (i + 1), depth + 1));
  }
  visit(plan, '1', 0);
  const peak = Number(rows[0]?.[3]) || 0;
  return csv([
    [
      '节点',
      '执行路径',
      '关系',
      '累计毫秒（含子节点）',
      '成本',
      '估计行',
      '实际行',
      '行数倍率',
      '条件',
      '耗时占根节点',
    ],
    ...rows.map((r) => [...r, peak > 0 ? ((100 * Number(r[3])) / peak).toFixed(1) + '%' : '']),
  ]);
}
export function maven(input: string, o: Opt) {
  const stack: string[] = [],
    rows: unknown[][] = [];
  for (const line of input.split(/\r?\n/)) {
    const raw = line.replace(/^\[INFO\]\s?/, '');
    const m = /^((?:\|  |   )*)(?:[+\\]- )?(\(?[\w.-]+:[\w.-]+:[^\s)]+)(.*)$/.exec(raw);
    if (!m) continue;
    const depth = m[1].length / 3 + (/[+\\]- /.test(raw) ? 1 : 0),
      coordinate = m[2].replace(/^\(/, '');
    stack.splice(depth);
    stack[depth] = coordinate;
    if (!o.query || raw.toLowerCase().includes(o.query.toLowerCase()))
      rows.push([coordinate, depth, stack.join(' → '), m[3].trim().replace(/^\s*-\s*|\)$/g, '')]);
  }
  if (!stack.length) throw Error('没有找到 Maven 坐标，请粘贴 dependency:tree 输出');
  return csv([['依赖坐标', '深度', '引入路径', '说明'], ...rows]);
}
const chars = new Map<number, string>([
  [0xfeff, 'BOM / 零宽不换行空格'],
  [0x200b, '零宽空格'],
  [0x200c, '零宽非连接符'],
  [0x200d, '零宽连接符'],
  [0x2060, '单词连接符'],
  [0xa0, '不换行空格'],
  [0xad, '软连字符'],
  [0x202f, '窄不换行空格'],
  [0x09, '制表符'],
  [0x200e, '从左至右标记'],
  [0x200f, '从右至左标记'],
]);
export function invisible(input: string) {
  const rows: unknown[][] = [['行', '列（码点）', 'UTF-16 偏移', '字符', '码点', '附近文本']];
  let line = 1,
    col = 1;
  for (let i = 0; i < input.length;) {
    const cp = input.codePointAt(i)!,
      ch = String.fromCodePoint(cp);
    const end = ch === '\r' && input[i + 1] === '\n' ? '\r\n' : ch;
    const newline = /^[\r\n]+$/.test(end);
    const name = newline
      ? end === '\r\n'
        ? 'CRLF'
        : end === '\r'
          ? 'CR'
          : 'LF'
      : (chars.get(cp) ??
        ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)
          ? '方向控制符'
          : cp < 32
            ? '控制字符'
            : ''));
    if (name)
      rows.push([
        line,
        col,
        i,
        name,
        Array.from(end, (c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')).join(
          ' ',
        ),
        input.slice(Math.max(0, i - 8), i) +
          '〔' +
          name +
          '〕' +
          input.slice(i + end.length, i + end.length + 8),
      ]);
    i += end.length;
    if (newline) {
      line++;
      col = 1;
    } else col++;
  }
  return csv(rows);
}
export function intervals(input: string, o: Opt) {
  const changes = new Map<number, number[]>();
  for (const [group, source] of [input, o.target].entries()) {
    source.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const pair = line.trim().split(/\s*\/\s*|\s+/);
      const [a, b] = pair.map((x) => (/T.*(?:Z|[+-]\d\d:\d\d)$/i.test(x) ? Date.parse(x) : NaN));
      if (pair.length !== 2 || !Number.isFinite(a) || !Number.isFinite(b) || a >= b)
        throw Error('第 ' + (group + 1) + ' 组第 ' + (i + 1) + ' 行需要带时区且递增的两个时刻');
      for (const [t, n] of [
        [a, 1],
        [b, -1],
      ]) {
        const v = changes.get(t) ?? [0, 0];
        v[group] += n;
        changes.set(t, v);
      }
    });
  }
  const times = [...changes.keys()].sort((a, b) => a - b),
    runs: number[][][] = [[], [], []];
  let a = 0,
    b = 0;
  for (let i = 0; i < times.length - 1; i++) {
    const t = times[i],
      end = times[i + 1],
      [x, y] = changes.get(t)!;
    a += x;
    b += y;
    for (const [j, yes] of [a > 0 || b > 0, a > 0 && b > 0, !a && !b].entries())
      if (yes) {
        const last = runs[j].at(-1);
        if (last?.[1] === t) last[1] = end;
        else runs[j].push([t, end]);
      }
  }
  return csv([
    ['类型', '起始 UTC', '结束 UTC', '时长（秒）'],
    ...runs.flatMap((group, j) =>
      group.map(([s, e]) => [
        ['并集', '交集', '空档'][j],
        new Date(s).toISOString(),
        new Date(e).toISOString(),
        (e - s) / 1000,
      ]),
    ),
  ]);
}
