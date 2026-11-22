import { csv, type Opt } from './tabular';
export async function spring(input: string, o: Opt) {
  const { parse } = await import('yaml');
  type Source = '基础' | 'Profile' | '环境变量';
  const values = new Map<string, Partial<Record<Source, string>>>();
  const add = (path: string, source: Source, value: string) =>
    values.set(path, { ...values.get(path), [source]: value });
  function walk(node: unknown, path: string, source: Source) {
    if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node))
        walk(v, Array.isArray(node) ? path + '[' + k + ']' : path ? path + '.' + k : k, source);
    } else if (path) add(path, source, String(node ?? ''));
  }
  walk(parse(input), '', '基础');
  walk(parse(o.target), '', 'Profile');
  const env = new Map<string, string>();
  for (const line of o.env
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    const at = line.indexOf('=');
    if (at <= 0) throw Error('环境变量应为 KEY=value：' + line);
    env.set(line.slice(0, at).trim(), line.slice(at + 1));
  }
  for (const [k, v] of env) {
    const key = [...values.keys()].find(
      (name) =>
        name
          .toUpperCase()
          .replace(/-/g, '')
          .replace(/[.[\]]+/g, '_')
          .replace(/_$/, '') === k,
    );
    add(key ?? k.toLowerCase().replace(/_/g, '.'), '环境变量', v);
  }
  const raw = (k: string) => {
    const s = values.get(k);
    return env.get(k) ?? s?.环境变量 ?? s?.Profile ?? s?.基础;
  };
  const resolve = (s: string, seen: Set<string>): string =>
    s.replace(/\$\{([^}:]+)(?::([^}]*))?\}/g, (token, k: string, fallback: string | undefined) => {
      if (seen.has(k) || seen.size >= 32) return token;
      const v = raw(k) ?? fallback;
      return v === undefined ? token : resolve(v, new Set([...seen, k]));
    });
  return csv([
    ['键', '生效值', '来源', '基础 YAML', 'Profile YAML', '环境变量', '状态'],
    ...Array.from(values, ([k, v]) => {
      const text = resolve(raw(k) ?? '', new Set([k]));
      return [
        k,
        text,
        Object.keys(v).at(-1),
        v.基础,
        v.Profile,
        v.环境变量,
        text.includes('\${') ? '占位符未解析' : '已解析',
      ];
    }),
  ]);
}
export function threads(input: string) {
  const blocks = input.replace(/\r/g, '').split(/^(?="[^"\n]+")/m),
    owners = new Map<string, string>(),
    groups = new Map<string, { state: string; stack: string; names: string[]; wait: Set<string> }>();
  for (const block of blocks) {
    const name = /^"([^"]+)"/.exec(block)?.[1];
    if (!name) continue;
    const state = /java\.lang\.Thread\.State:\s*(\w+)/.exec(block)?.[1] ?? '未知';
    const stack = block
        .split('\n')
        .filter((l) => /^\s+at\s/.test(l))
        .map((l) => l.trim())
        .join('\n'),
      key = JSON.stringify([state, stack]);
    const g = groups.get(key) ?? { state, stack, names: [], wait: new Set<string>() };
    g.names.push(name);
    for (const m of block.matchAll(/-\s+locked <([^>]+)>/g)) owners.set(m[1], name);
    for (const m of block.matchAll(/-\s+(?:waiting to lock|waiting on|parking to wait for)\s+<([^>]+)>/g))
      g.wait.add(m[1]);
    groups.set(key, g);
  }
  if (!groups.size) throw Error('没有找到以双引号线程名开头的线程记录');
  return csv([
    ['状态', '同栈线程数', '线程名', '等待锁 → 持有者', '调用栈'],
    ...[...groups.values()]
      .sort((a, b) => b.names.length - a.names.length)
      .map((g) => [
        g.state,
        g.names.length,
        g.names.join('\n'),
        [...g.wait].map((id) => id + ' → ' + (owners.get(id) ?? '未知')).join('\n'),
        g.stack,
      ]),
  ]);
}
export function gc(input: string) {
  const rows: { line: number; t: string; event: string; ms: number; heap: string }[] = [];
  input.split(/\r?\n/).forEach((l, i) => {
    if (!/Pause |\[(?:Full )?GC\b/.test(l)) return;
    const pause = l.split(/\s*\[Times:/i, 1)[0];
    const duration = /([\d.]+)\s*(ms|secs?|s|us|µs|ns)\s*\]?\s*$/.exec(pause);
    if (!duration) return;
    const factor =
      duration[2] === 'ms' ? 1 : duration[2] === 'ns' ? 1e-6 : /[uµ]s/.test(duration[2]) ? 0.001 : 1000;
    const heap = /([\d.]+[BKMG])->([\d.]+[BKMG])(?:\(([^)]+)\))?/i.exec(l);
    rows.push({
      line: i + 1,
      t: /^\[([\d.]+s)\]|^([\d.]+):/.exec(l)?.slice(1).find(Boolean) ?? '',
      event: /Pause (.+?)(?:\s+\d+[\d.]*[BKMG]->|\s+[\d.]+\s*(?:ms|s)$)/.exec(l)?.[1] ?? l.slice(0, 90),
      ms: Number(duration[1]) * factor,
      heap: heap?.[0] ?? '',
    });
  });
  if (!rows.length) throw Error('未找到带持续时间的 GC 停顿记录');
  const sorted = rows.map((r) => r.ms).sort((a, b) => a - b),
    p = (q: number) => sorted[Math.ceil(q * sorted.length) - 1];
  return csv([
    ['行', '运行时间', '停顿类型', '停顿毫秒', '堆变化', '分布'],
    ...rows.map((r) => [
      r.line,
      r.t,
      r.event,
      r.ms,
      r.heap,
      r.ms === p(1) ? '最长' : r.ms >= p(0.95) ? 'P95 以上' : '',
    ]),
    ['', '', 'P50', p(0.5)],
    ['', '', 'P95', p(0.95)],
    ['', '', 'P99', p(0.99)],
  ]);
}
export async function sourceMap(input: string, o: Opt) {
  const { TraceMap, originalPositionFor, sourceContentFor } = await import('@jridgewell/trace-mapping'),
    raw = JSON.parse(input),
    map = new TraceMap(raw);
  const rows: unknown[][] = [['堆栈帧', '状态', '源文件', '行', '列', '符号', '附近源码']];
  for (const frame of o.target.split(/\r?\n/).filter(Boolean)) {
    const m = /([^\s()@]+):(\d+):(\d+)\)?\s*$/.exec(frame);
    if (!m || (raw.file && m[1].split(/[?#]/)[0].split('/').at(-1) !== raw.file.split('/').at(-1))) {
      rows.push([frame, '未匹配']);
      continue;
    }
    const p = originalPositionFor(map, { line: Number(m[2]), column: Math.max(0, Number(m[3]) - 1) });
    if (!p.source || p.line == null) {
      rows.push([frame, '无映射']);
      continue;
    }
    const content = sourceContentFor(map, p.source)?.split(/\r?\n/) ?? [],
      line = p.line;
    const start = Math.max(0, line - 3);
    rows.push([
      frame,
      '已定位',
      p.source,
      line,
      (p.column ?? 0) + 1,
      p.name,
      content
        .slice(start, line + 2)
        .map((s, i) => (i + start + 1 === line ? '▶ ' : '  ') + (i + start + 1) + ' ' + s)
        .join('\n'),
    ]);
  }
  return csv(rows);
}
