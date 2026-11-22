import type { Options } from './tools';
import { parseCsv } from './practical';
import { jsonTree } from './result-model';

// Preserve number spellings, duplicate members and whitespace inside strings.
function compactRecord(value: string) {
  return value.replace(/"(?:\\.|[^"\\])*"|\s+/g, token => token.startsWith('"') ? token : '');
}

export function jsonLines(input: string, options: Options) {
  if (options.mode === 'lines') {
    const root = jsonTree(input, { length: 2_000_000, nodes: 100_000 });
    if (root.kind !== 'array') throw new Error('请输入 JSON 数组。');
    return root.children.map(({ node }) => compactRecord(node.raw) + '\n').join('');
  }
  const lines = input.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const records: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim() && options.blank !== 'error') continue;
    try { JSON.parse(line); }
    catch { throw new Error('第 ' + (index + 1) + ' 行不是有效的 JSON 记录。'); }
    records.push(compactRecord(line));
  }
  return '[' + records.join(',\n') + ']';
}

function markdownCells(line: string) {
  const cells: string[] = [];
  const row = line.trim();
  let cell = '', ended = false;
  for (let i = row.startsWith('|') ? 1 : 0; i < row.length; i++) {
    const c = row[i];
    ended = false;
    if (c === '\\' && ['|', '\\'].includes(row[i + 1])) cell += row[++i];
    else if (c === '|') { cells.push(cell.trim()); cell = ''; ended = true; }
    else cell += c;
  }
  if (!ended) cells.push(cell.trim());
  return cells;
}

const decodeCell = (value: string) => value.replace(/<br\s*\/?>|&lt;|&gt;|&amp;|&#32;|&#9;/gi, token =>
  ({ '&lt;': '<', '&gt;': '>', '&amp;': '&', '&#32;': ' ', '&#9;': '\t' })[token.toLowerCase()] ?? '\n');

function encodeCell(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('\t', '&#9;').replace(/\r\n?|\n/g, '<br>')
    .replace(/^ +| +$/g, spaces => '&#32;'.repeat(spaces.length));
}

export function markdownTable(input: string, options: Options) {
  const delimiter = options.delimiter === 'tab' ? '\t' : ',';
  const reverse = options.mode === 'delimited';
  const rows = reverse ? input.trim().split(/\r?\n/).map(markdownCells) : parseCsv(input, delimiter);
  const width = rows[0].length;
  if (rows.some(row => row.length !== width)) throw new Error('表格各行列数应与表头一致。');
  if (reverse) {
    if (rows.length < 2 || !rows[1].every(cell => /^:?-+:?$/.test(cell))) throw new Error('第二行需要 Markdown 表头分隔线，例如 | --- |。');
    rows.splice(1, 1);
    return rows.map(row => row.map(cell => {
      const value = decodeCell(cell);
      return !value || value.includes(delimiter) || /["\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
    }).join(delimiter)).join('\n');
  }
  const rowText = (row: string[]) => '| ' + row.join(' | ') + ' |';
  const lines = rows.map(row => rowText(row.map(encodeCell)));
  lines.splice(1, 0, rowText(Array(width).fill('---')));
  return lines.join('\n');
}

export async function checkVersions(input: string, options: Options) {
  const { Range, valid, rcompare } = await import('semver');
  let range;
  try { range = new Range(options.range ?? '*'); }
  catch { throw new Error('无效的 npm 版本范围。'); }
  const versions: string[] = [], invalid: string[] = [];
  for (const [index, raw] of input.split(/\r?\n/).entries()) {
    const value = raw.trim();
    if (!value) continue;
    if (valid(value)) versions.push(value);
    else invalid.push('第 ' + (index + 1) + ' 行 · ' + value);
  }
  const sorted = versions.sort(rcompare);
  const matched = sorted.filter(value => range.test(value));
  return JSON.stringify({ '范围': range.raw || '*', '最高匹配版本': matched[0] ?? null,
    '匹配（降序）': matched, '未匹配（降序）': sorted.filter(value => !range.test(value)), '无效行': invalid }, null, 2);
}
