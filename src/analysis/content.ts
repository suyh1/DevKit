import { csv, type Opt } from './tabular';
export function tokens(input: string, o: Opt) {
  const out: Record<string, string> = Object.create(null);
  const clean = (x: string) =>
    x
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\d_-]+/gu, '-');
  const ref = (s: string) =>
    s.replace(/\{([\w.-]+)\}/g, (_, name: string) => 'var(--' + name.split('.').map(clean).join('-') + ')');
  function walk(value: unknown, path: string[]) {
    const obj = value as Record<string, unknown>;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      if ('$value' in obj) return walk(obj.$value, path);
      if (typeof obj.value === 'number' && typeof obj.unit === 'string')
        return walk(obj.value + obj.unit, path);
      for (const [k, v] of Object.entries(obj)) if (!k.startsWith('$')) walk(v, [...path, k]);
      return;
    }
    if (!path.length || (typeof value !== 'string' && typeof value !== 'number'))
      throw Error('不支持的令牌：' + path.join('.'));
    const key = '--' + path.map(clean).join('-');
    if (key in out) throw Error('变量名称冲突：' + key);
    out[key] = ref(String(value));
  }
  walk(JSON.parse(input), []);
  return o.format === 'json'
    ? JSON.stringify(out, null, 2)
    : ':root {\n' +
        Object.entries(out)
          .map(([k, v]) => '  ' + k + ': ' + v + ';')
          .join('\n') +
        '\n}';
}
function flat(value: unknown, path: string[] = [], result = new Map<string, unknown>()) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length)
    for (const [key, v] of Object.entries(value)) flat(v, [...path, key], result);
  else result.set(JSON.stringify(path), value);
  return result;
}
export async function locale(input: string, o: Opt) {
  const { parse } = await import('@formatjs/icu-messageformat-parser');
  const args = (s: string) => {
    const out = new Set<string>();
    const walk = (nodes: ReturnType<typeof parse>) => {
      for (const node of nodes) {
        if (node.type > 0 && 'value' in node) out.add(node.value + ':' + node.type);
        if ('options' in node) Object.values(node.options).forEach((x) => walk(x.value));
        if ('children' in node) walk(node.children);
      }
    };
    walk(parse(s, { ignoreTag: true }));
    return [...out].sort().join(', ');
  };
  const a = flat(JSON.parse(input)),
    b = flat(JSON.parse(o.target)),
    rows: unknown[][] = [['键路径', '问题', '原文', '译文']];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(k),
      y = b.get(k),
      type = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    let issue = !a.has(k) ? '多余键' : !b.has(k) ? '缺失键' : type(x) !== type(y) ? '类型变化' : '';
    if (!issue && typeof x === 'string' && typeof y === 'string')
      try {
        const before = args(x),
          after = args(y);
        if (before !== after) issue = 'ICU 参数不一致：' + before + ' → ' + after;
      } catch (e) {
        issue = 'ICU 语法错误：' + (e as Error).message;
      }
    if (issue) rows.push([JSON.parse(k).join('.'), issue, JSON.stringify(x), JSON.stringify(y)]);
  }
  return csv(rows);
}
export function markdown(input: string) {
  const headings = new Map<string, number>(),
    anchors = new Set<string>(),
    links: [number, string][] = [],
    rows: unknown[][] = [['行', '问题', '详情']];
  const lines = input.split(/\r?\n/);
  let fence = '',
    level = 0,
    cols = 0;
  const cells = (s: string) =>
    s
      .trim()
      .replace(/^\||\|$/g, '')
      .split(/(?<!\\)\|/).length;
  lines.forEach((line, i) => {
    const marker = /^\s{0,3}(\x60{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker.startsWith(fence)) fence = '';
      return;
    }
    if (fence) return;
    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const n = heading[1].length,
        title = heading[2];
      if (level && n > level + 1) rows.push([i + 1, '标题跳级', 'H' + level + ' → H' + n]);
      level = n;
      const slug = title
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, '')
          .replace(/\s/g, '-'),
        cnt = headings.get(slug) ?? 0;
      if (cnt) rows.push([i + 1, '重复标题', title]);
      anchors.add(cnt ? slug + '-' + cnt : slug);
      headings.set(slug, cnt + 1);
    }
    for (const m of line.matchAll(/\[[^\]]*\]\(#([^)]+)\)/g)) links.push([i + 1, m[1]]);
    if (/^\s*\|?\s*:?-{3,}:?\s*\|/.test(line)) {
      cols = cells(line);
      if (i > 0 && cells(lines[i - 1]) !== cols) rows.push([i, '表头列数异常', '分隔行有 ' + cols + ' 列']);
    } else if (cols && line.includes('|')) {
      if (cells(line) !== cols) rows.push([i + 1, '表格列数异常', cells(line) + ' / ' + cols]);
    } else cols = 0;
  });
  for (const [line, link] of links) {
    let id = link;
    try {
      id = decodeURIComponent(link);
    } catch {
      /* invalid anchor */
    }
    if (!anchors.has(id)) rows.push([line, '无效页内锚点', '#' + link]);
  }
  return csv(rows);
}
export async function astSearch(input: string, o: Opt) {
  const { parse } = await import('@babel/parser'),
    opts = { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] } as const;
  const ast = (s: string) => parse(s, { ...opts, plugins: [...opts.plugins] });
  const tree = ast(input),
    pattern = ast(o.pattern).program.body;
  if (pattern.length !== 1) throw Error('请输入一个表达式或语句作为模板');
  const template = pattern[0].type === 'ExpressionStatement' ? pattern[0].expression : pattern[0];
  type Node = Record<string, unknown>;
  const ignore = new Set([
    'start',
    'end',
    'loc',
    'extra',
    'leadingComments',
    'trailingComments',
    'innerComments',
    'comments',
    'errors',
    'tokens',
  ]);
  function matches(p: unknown, v: unknown, captures: Map<string, unknown>, variables = true): boolean {
    if (p === null || typeof p !== 'object') return p === v;
    if (!v || typeof v !== 'object') return false;
    if (Array.isArray(p))
      return (
        Array.isArray(v) && p.length === v.length && p.every((n, i) => matches(n, v[i], captures, variables))
      );
    const node = p as Node;
    if (
      variables &&
      node.type === 'Identifier' &&
      typeof node.name === 'string' &&
      /^\$\w+$/.test(node.name)
    ) {
      if (captures.has(node.name)) return matches(captures.get(node.name), v, captures, false);
      captures.set(node.name, v);
      return true;
    }
    return Object.keys(node).every(
      (k) => ignore.has(k) || matches(node[k], (v as Node)[k], captures, variables),
    );
  }
  const rows: unknown[][] = [['行', '列', '匹配代码', '捕获']];
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Node,
      captures = new Map<string, unknown>();
    if (typeof node.type === 'string' && matches(template, node, captures)) {
      const loc = node.loc as { start: { line: number; column: number } };
      const snippet = (n: Node) => input.slice(Number(n.start), Number(n.end));
      rows.push([
        loc.start.line,
        loc.start.column + 1,
        snippet(node),
        [...captures].map(([k, v]) => k + ' = ' + snippet(v as Node)).join('\n'),
      ]);
    }
    for (const [k, v] of Object.entries(node)) if (!ignore.has(k)) visit(v);
  }
  visit(tree.program);
  return csv(rows);
}
