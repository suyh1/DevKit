import { jsonTree, nodePath } from './result-model';
import type { JsonNode } from './result-model';

export type JsonChange = {
  kind: 'added' | 'removed' | 'changed' | 'moved';
  path: string;
  before?: string;
  after?: string;
  from?: string;
};
// Separate paths with newlines or semicolons outside quoted keys.
export function filterDiffPaths(rows: JsonChange[], rules: string) {
  const paths = new Set<string>();
  if (rules.length > 8000) throw new Error('忽略规则最多 8,000 字符。');
  const root = /\$|[A-Za-z_][\w$]*/y;
  const segment = /(?:\.([A-Za-z_$][\w$]*)|\[("(?:\\.|[^"\\])*"|0|[1-9]\d*)\])/y;
  const divider = /[ \t]*(?:;|\r?\n|$)[ \t]*/y;
  const input = rules.trim();
  const invalid = () => new Error('忽略路径格式无效，请使用 $.字段 或从结果复制路径，以分号分隔。');
  let index = 0;
  while (index < input.length) {
    root.lastIndex = index;
    const head = root.exec(input);
    if (!head) throw invalid();
    let path = head[0] === '$' ? '$' : nodePath('$', head[0], false);
    segment.lastIndex = root.lastIndex;
    index = root.lastIndex;
    let part;
    while ((part = segment.exec(input))) {
      if (part[1]) path = nodePath(path, part[1], false);
      else if (part[2].startsWith('"')) path = nodePath(path, JSON.parse(part[2]), false);
      else path = nodePath(path, part[2], true);
      index = segment.lastIndex;
    }
    if (path === '$') throw invalid();
    paths.add(path);
    divider.lastIndex = index;
    if (!divider.exec(input)) throw invalid();
    index = divider.lastIndex;
  }
  if (paths.size > 100) throw new Error('最多设置 100 个忽略路径。');
  const prefixes = [...paths];
  const changes = rows.filter((row) => !prefixes.some((p) => row.path === p || row.path.startsWith(p + '[')));
  return { ignored: rows.length - changes.length, changes };
}
// Compare source tokens, never JS numbers: 9007199254740993 remains distinct.
export function structuredDiff(left: string, right: string, arrayKey = ''): JsonChange[] {
  if (arrayKey.length > 100) throw new Error('数组标识字段最多 100 字符。');
  const changes: JsonChange[] = [];
  const a = jsonTree(left), b = jsonTree(right);
  function fields(node: JsonNode, path: string) {
    const map = new Map<string, JsonNode>();
    for (const child of node.children) {
      if (map.has(child.key)) throw new Error(`${path} 存在重复字段 ${child.key}，请修正后对比。`);
      map.set(child.key, child.node);
    }
    return map;
  }
  function validate(node: JsonNode, path = '$') {
    if (node.kind === 'object') fields(node, path);
    for (const child of node.children) validate(child.node, nodePath(path, child.key, node.kind === 'array'));
  }
  validate(a); validate(b);
  function identity(node: JsonNode, path: string) {
    const result = new Map<string, { node: JsonNode; index: number }>();
    node.children.forEach((child, index) => {
      const key = child.node.kind === 'object' ? fields(child.node, path).get(arrayKey) : undefined;
      if (!key || key.kind !== 'value' || !/^(?:"|-?\d)/.test(key.raw)) throw new Error(`${path}[${index}] 缺少字符串或数字标识字段 ${arrayKey}。`);
      const id = key.raw.startsWith('"') ? `s:${JSON.parse(key.raw)}` : `n:${key.raw}`;
      if (result.has(id)) throw new Error(`${path} 的标识字段 ${arrayKey} 重复。`);
      result.set(id, { node: child.node, index });
    });
    return result;
  }
  function compare(a: JsonNode | undefined, b: JsonNode | undefined, path: string) {
    if (!a) { changes.push({ kind: 'added', path, after: b!.raw }); return; }
    if (!b) { changes.push({ kind: 'removed', path, before: a.raw }); return; }
    if (a.kind !== b.kind) { changes.push({ kind: 'changed', path, before: a.raw, after: b.raw }); return; }
    if (a.kind === 'value') {
      const equal = a.raw.startsWith('"') && b.raw.startsWith('"') ? JSON.parse(a.raw) === JSON.parse(b.raw) : a.raw === b.raw;
      if (!equal) changes.push({ kind: 'changed', path, before: a.raw, after: b.raw });
    } else if (a.kind === 'array' && arrayKey && [...a.children, ...b.children].every(child => child.node.kind === 'object')) {
      const l = identity(a, path), r = identity(b, path);
      for (const [id, item] of l) {
        const next = r.get(id);
        if (next && next.index !== item.index) changes.push({ kind: 'moved', path: `${path}[${next.index}]`, from: `${path}[${item.index}]` });
        compare(item.node, next?.node, `${path}[${next?.index ?? item.index}]`);
      }
      for (const [id, item] of r) if (!l.has(id)) compare(undefined, item.node, `${path}[${item.index}]`);
    } else {
      const l = fields(a, path), r = fields(b, path);
      for (const key of new Set([...l.keys(), ...r.keys()])) compare(l.get(key), r.get(key), nodePath(path, key, a.kind === 'array'));
    }
  }
  compare(a, b, '$');
  return changes;
}
