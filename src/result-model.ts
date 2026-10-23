export type JsonNode = { raw: string; kind: 'object' | 'array' | 'value'; children: { key: string; node: JsonNode }[] };

export function jsonTree(text: string): JsonNode {
  if (text.length > 300_000) throw new Error('结构化预览支持 300,000 字符以内的结果，请使用源码视图。');
  JSON.parse(text);
  const tokens = [...text.matchAll(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g)];
  let position = 0, budget = 8000;
  function parse(depth: number): JsonNode {
    if (--budget < 0 || depth > 100) throw new Error('结构化预览节点过多，请使用源码视图。');
    const first = tokens[position++];
    const start = first.index!;
    const opening = first[0];
    if (opening !== '{' && opening !== '[') return { kind: 'value', raw: opening, children: [] };
    const children: JsonNode['children'] = [];
    const end = opening === '{' ? '}' : ']';
    while (tokens[position][0] !== end) {
      const key = opening === '{' ? JSON.parse(tokens[position++][0]) as string : String(children.length);
      if (opening === '{') position++;
      children.push({ key, node: parse(depth + 1) });
      if (tokens[position][0] === ',') position++;
    }
    const closing = tokens[position++];
    return { kind: opening === '{' ? 'object' : 'array', raw: text.slice(start, closing.index! + 1), children };
  }
  return parse(0);
}

export function nodePath(parent: string, key: string, array: boolean): string {
  return array ? `${parent}[${key}]` : `${parent}[${JSON.stringify(key)}]`;
}

export type DiffRow = { left: string; right: string; leftLine?: number; rightLine?: number; kind: 'same' | 'change' | 'hunk' };
export function diffRows(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let leftLine = 0, rightLine = 0;
  const lines = patch.split('\n');
  for (let position = 0; position < lines.length; position++) {
    const line = lines[position];
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { leftLine = Number(hunk[1]); rightLine = Number(hunk[2]); rows.push({ left: line, right: '', kind: 'hunk' }); }
    else if ((leftLine || rightLine) && (line.startsWith('-') || line.startsWith('+'))) {
      const removed: string[] = [], added: string[] = [];
      while (position < lines.length && /^[+-]/.test(lines[position])) {
        const current = lines[position++];
        (current[0] === '-' ? removed : added).push(current.slice(1));
      }
      position--;
      for (let index = 0; index < Math.max(removed.length, added.length); index++) rows.push({ left: removed[index] ?? '', right: added[index] ?? '', leftLine: index < removed.length ? leftLine++ : undefined, rightLine: index < added.length ? rightLine++ : undefined, kind: 'change' });
    } else if (leftLine && line.startsWith(' ')) rows.push({ left: line.slice(1), right: line.slice(1), leftLine: leftLine++, rightLine: rightLine++, kind: 'same' });
  }
  return rows;
}
