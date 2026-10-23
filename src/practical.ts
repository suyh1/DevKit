import type { Options } from './tools';

export type PracticalToolId = 'yaml' | 'csv-json' | 'sql' | 'diff' | 'url-inspect' | 'password';
export const practicalDefaults: Record<PracticalToolId, Options> = {
  yaml: { mode: 'yaml-json' }, 'csv-json': { delimiter: 'comma', headers: 'first', types: 'strings' },
  sql: { dialect: 'sql', keywordCase: 'upper', indent: '2' },
  diff: { target: 'name: DevKit\nversion: 0.5.0\noffline: true\ntools: 26\n', ignoreWhitespace: 'off' },
  'url-inspect': {}, password: { length: '24', count: '5', charset: 'all', ambiguous: 'exclude' },
};
export const practicalTools: { id: PracticalToolId; name: string; english: string; category: string; description: string; sample: string }[] = [
  { id: 'yaml', name: 'JSON ↔ YAML', english: 'JSON / YAML Converter', category: '数据处理', description: '转换配置文件，保留大整数，检测重复键与不兼容的 YAML 值。', sample: 'name: DevKit\nport: 1420\noffline: true\nplatforms:\n  - Windows\n  - Linux\n' },
  { id: 'csv-json', name: 'CSV 转 JSON', english: 'CSV to JSON', category: '数据处理', description: '导入 CSV / TSV，支持表头、引号内换行与可选类型推断。', sample: 'name,city,id,note\nAlice,上海,001,"hello, world"\nBob,北京,002,"多行备注\n第二行"' },
  { id: 'sql', name: 'SQL 格式化', english: 'SQL Formatter', category: '数据处理', description: '整理 SQL 缩进与关键字大小写，支持常用数据库方言，仅格式化、不执行。', sample: "select u.id,u.name,count(o.id) as order_count from users u left join orders o on u.id=o.user_id where u.active=true and u.city='上海' group by u.id,u.name order by order_count desc;" },
  { id: 'diff', name: '文本差异对比', english: 'Text Diff', category: '效率工具', description: '逐行比较两份文本，突出新增与删除，导出 unified diff 补丁。', sample: 'name: DevKit\nversion: 0.4.0\noffline: true\ntools: 20\n' },
  { id: 'url-inspect', name: 'URL 解析', english: 'URL Inspector', category: '编码转换', description: '拆解地址、路径与查询参数，保留同名参数；全程不发起网络请求。', sample: 'https://example.com:8443/api/users?name=%E5%BC%A0%E4%B8%89&tag=java&tag=ts&empty=#details' },
  { id: 'password', name: '随机密码生成', english: 'Secure Password Generator', category: '效率工具', description: '使用系统安全随机数批量生成密码，支持字符集、长度与排除易混淆字符。', sample: '' },
];
export function isPracticalTool(id: string): id is PracticalToolId { return id in practicalDefaults && Object.hasOwn(practicalDefaults, id); }

// Serialize Maps and BigInts directly to avoid rounding integers during YAML conversion.
function jsonValue(value: unknown, depth = 0, seen = new Set<object>(), budget = { left: 100_000 }): string {
  if (--budget.left < 0 || depth > 100) throw new Error('结构过大或嵌套超过 100 层，请缩小输入。');
  if (value === null) return 'null';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('JSON 不支持 NaN 或 Infinity。'); return JSON.stringify(value); }
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value !== 'object' || (!(value instanceof Map) && !Array.isArray(value))) throw new Error('包含 JSON 无法表示的 YAML 类型。');
  if (seen.has(value)) throw new Error('JSON 不支持循环 YAML 别名。');
  seen.add(value);
  const next = (item: unknown) => jsonValue(item, depth + 1, seen, budget);
  const pad = '  '.repeat(depth + 1), end = '  '.repeat(depth);
  let result: string;
  if (Array.isArray(value)) result = value.length ? `[\n${pad}${value.map(next).join(`,\n${pad}`)}\n${end}]` : '[]';
  else {
    const entries = [...(value as Map<unknown, unknown>)].map(([key, item]) => {
      if (typeof key !== 'string') throw new Error('JSON 对象的键必须是字符串，请给 YAML 数字键或复杂键加引号。');
      return `${JSON.stringify(key)}: ${next(item)}`;
    });
    result = entries.length ? `{\n${pad}${entries.join(`,\n${pad}`)}\n${end}}` : '{}';
  }
  seen.delete(value); return result;
}
async function convertYaml(input: string, options: Options): Promise<string> {
  if (!input.trim()) throw new Error('请输入要转换的 JSON 或 YAML。');
  const { parseDocument, stringify } = await import('yaml');
  if (options.mode === 'json-yaml') JSON.parse(input);
  const document = parseDocument(input, { intAsBigInt: true, uniqueKeys: true, schema: 'core', strict: true });
  if (document.errors.length) throw new Error(document.errors[0].message);
  if (document.warnings.length) throw new Error(document.warnings[0].message);
  const value = document.toJS({ mapAsMap: true, maxAliasCount: 50 });
  const json = jsonValue(value);
  return options.mode === 'json-yaml' ? stringify(value, { lineWidth: 0, aliasDuplicateObjects: false }) : json;
}

function parseCsv(input: string, delimiter: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  if (!text) throw new Error('请输入 CSV 或 TSV 内容。');
  const rows: string[][] = []; let row: string[] = [], field = '', state: 'plain' | 'quoted' | 'closed' = 'plain', started = false;
  const cell = () => { row.push(field); field = ''; state = 'plain'; };
  const line = () => { cell(); rows.push(row); row = []; started = false; if (rows.length > 100_000) throw new Error('最多支持 100,000 行，请缩小输入。'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else state = 'closed'; }
      else field += char;
      continue;
    }
    if (char === delimiter) { cell(); started = true; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; if (started || field || row.length) line(); }
    else if (char === '"' && !field && state === 'plain') { state = 'quoted'; started = true; }
    else { if (state === 'closed' || char === '"') throw new Error(`CSV 第 ${rows.length + 1} 条记录的引号格式不正确。`); field += char; started = true; }
  }
  if (state === 'quoted') throw new Error('CSV 引号未闭合。');
  if (started || field || row.length) line();
  if (!rows.length) throw new Error('没有可转换的记录。');
  return rows;
}
function csvToJson(input: string, options: Options): string {
  const rows = parseCsv(input, options.delimiter === 'tab' ? '\t' : ',');
  const headers = options.headers !== 'none' ? rows.shift()! : null;
  if (headers && (headers.some(key => !key.trim()) || new Set(headers).size !== headers.length)) throw new Error('表头不能为空或重复，请修改表头或选择无表头模式。');
  const width = headers?.length ?? rows[0]?.length;
  const cast = (value: string): string | number | boolean | null => {
    if (options.types !== 'infer') return value;
    if (value === 'true') return true; if (value === 'false') return false; if (value === 'null') return null;
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
      const number = Number(value);
      if (Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number))) return number;
    }
    return value;
  };
  return JSON.stringify(rows.map((row, index) => {
    if (row.length !== width) throw new Error(`第 ${index + (headers ? 2 : 1)} 条记录有 ${row.length} 列，应为 ${width} 列。`);
    return headers ? Object.fromEntries(headers.map((key, i) => [key, cast(row[i])])) : row.map(cast);
  }), null, 2);
}
function inspectUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('请输入完整的绝对 URL，例如 https://example.com/path?a=1。'); }
  return JSON.stringify({ href: url.href, protocol: url.protocol, origin: url.origin, hostname: url.hostname, port: url.port,
    pathname: url.pathname, username: url.username, password: url.password, search: url.search,
    query: [...url.searchParams].map(([name, value]) => ({ name, value })), hash: url.hash }, null, 2);
}
function randomIndex(size: number): number {
  const bytes = new Uint32Array(1), limit = Math.floor(0x1_0000_0000 / size) * size;
  do { crypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % size;
}
function passwords(options: Options): string {
  const length = Number(options.length ?? '24'), count = Number(options.count ?? '5');
  if (!Number.isInteger(length) || length < 4 || length > 256) throw new Error('密码长度必须是 4–256 的整数。');
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('生成数量必须是 1–100 的整数。');
  const modes: Record<string, string[]> = { all: ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789', '!@#$%^&*()-_=+[]{}:,.?'], alnum: ['abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '0123456789'], hex: ['0123456789abcdef'], digits: ['0123456789'] };
  const groups = modes[options.charset || 'all'];
  if (!groups) throw new Error('不支持的字符集。');
  const sets = groups.map(group => options.ambiguous !== 'keep' ? group.replace(/[Il1O0o]/g, '') : group);
  const alphabet = sets.join('');
  return Array.from({ length: count }, () => {
    // Rejection sampling keeps all valid passwords equally likely and guarantees every selected character class.
    for (;;) {
      const chars = Array.from({ length }, () => alphabet[randomIndex(alphabet.length)]);
      if (sets.every(set => chars.some(char => set.includes(char)))) return chars.join('');
    }
  }).join('\n');
}

export async function practicalTransform(id: PracticalToolId, input: string, options: Options): Promise<string> {
  if (id === 'yaml') return convertYaml(input, options);
  if (id === 'csv-json') return csvToJson(input, options);
  if (id === 'url-inspect') return inspectUrl(input);
  if (id === 'password') return passwords(options);
  if (id === 'sql') {
    if (!input.trim()) throw new Error('请输入 SQL 语句。');
    if (input.length > 200_000) throw new Error('SQL 最多支持 200,000 字符。');
    const { format } = await import('sql-formatter');
    const language = options.dialect || 'sql';
    if (!['sql', 'mysql', 'postgresql', 'sqlite', 'transactsql', 'plsql'].includes(language)) throw new Error('不支持的 SQL 方言。');
    return format(input, { language: language as 'sql', keywordCase: options.keywordCase === 'lower' ? 'lower' : options.keywordCase === 'preserve' ? 'preserve' : 'upper', tabWidth: options.indent === '4' ? 4 : 2 });
  }
  const target = options.target ?? '';
  if (target.length > 500_000 || input.length > 500_000) throw new Error('对比文本每侧最多支持 500,000 字符。');
  const { createTwoFilesPatch } = await import('diff');
  const patch = createTwoFilesPatch('original.txt', 'modified.txt', input, target, '', '', { context: 3, ignoreWhitespace: options.ignoreWhitespace === 'on', timeout: 1200, maxEditLength: 20_000, headerOptions: { includeIndex: false, includeUnderline: false, includeFileHeaders: true } });
  if (patch === undefined) throw new Error('文本差异过大或计算超时，请缩小对比范围。');
  return patch;
}
