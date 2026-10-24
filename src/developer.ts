import type { Options } from './tools';
import { jsonTree } from './result-model';
import type { JsonNode } from './result-model';

export type DeveloperToolId = 'code-format' | 'json-path' | 'json-schema' | 'query-string' | 'http-code' | 'cron' | 'env' | 'properties' | 'hmac' | 'unicode' | 'css-unit' | 'http-status';
export const developerDefaults: Record<DeveloperToolId, Options> = {
  'code-format': { language: 'babel', indent: '2', quotes: 'single' },
  'json-path': { path: '$.users[*].name' }, 'json-schema': {},
  'query-string': { mode: 'decode' }, 'http-code': { style: 'fetch' },
  cron: { start: '', count: '10' }, env: { mode: 'decode' }, properties: { mode: 'decode' },
  hmac: { algorithm: 'SHA-256', key: '', format: 'hex' }, unicode: { mode: 'encode' },
  'css-unit': { from: 'px', to: 'rem', base: '16', viewport: '1440' }, 'http-status': {},
};
export const developerTools: { id: DeveloperToolId; name: string; english: string; category: string; description: string; sample: string }[] = [
  { id: 'code-format', name: '前端代码格式化', english: 'Code Formatter', category: '代码与查询', description: '使用本地 Prettier 整理 JS / JSX、TS / TSX、CSS / SCSS、HTML；仅格式化，不执行代码。每次最多 200,000 字符。', sample: 'const users=[{name:"Alice",active:true}];const names=users.map(user=>user.name)' },
  { id: 'json-path', name: 'JSON 路径提取', english: 'JSON Path Selector', category: '结构化数据', description: '支持 $.field、[0]、["字段"] 与 [*]，始终输出匹配值数组，保留数字原文。不是完整 JSONPath；最多 300,000 字符、8,000 节点。', sample: '{"users":[{"id":9007199254740993,"name":"Alice"},{"id":2,"name":"张三"}]}' },
  { id: 'json-schema', name: 'JSON Schema 生成', english: 'JSON Schema Generator', category: '结构化数据', description: '根据样本生成 Draft 2020-12 Schema，合并数组对象与可选字段。样本推断不代表完整业务约束；最多 300,000 字符、8,000 节点。', sample: '{"users":[{"id":1,"name":"Alice"},{"id":2,"active":true}],"next":null}' },
  { id: 'query-string', name: 'Query 参数转换', english: 'Query String Converter', category: '编码与解析', description: 'Query 与 JSON 字符串对象互转，同名参数保留为数组，+ 按空格解码。输入为参数串（可带 ?），不接受完整 URL。', sample: 'name=%E5%BC%A0%E4%B8%89&tag=java&tag=react&empty=&q=hello+world' },
  { id: 'http-code', name: 'HTTP 请求代码生成', english: 'HTTP Request Snippets', category: '代码与查询', description: '从 JSON 请求配置生成 Fetch、Axios 或 POSIX shell cURL 代码。支持 method、url、headers、body，全程不发送请求；cURL 不适用于 PowerShell 引号规则。', sample: '{"method":"POST","url":"https://example.com/api/users","headers":{"Content-Type":"application/json"},"body":{"name":"张三"}}' },
  { id: 'cron', name: 'Cron 表达式预览', english: 'Cron Schedule Preview', category: '时间与数值', description: '五字段 Unix Cron（分 时 日 月 周），支持数字、*、范围、逗号与步长，0/7 为周日；日期与星期均受限时取或。按 UTC 预览未来最多 4 年，不创建定时任务；不支持 Quartz 秒字段、名称或 L/W/#。', sample: '*/15 9-18 * * 1-5' },
  { id: 'env', name: '.env ↔ JSON', english: 'Environment Converter', category: '结构化数据', description: '转换平面字符串配置，支持 export、引号和注释；双引号支持 \\n、\\r、\\t、\\"、\\\\，不展开变量、不执行命令。拒绝重复键及多行引号。', sample: 'APP_NAME="DevKit"\nPORT=3000\nAPI_URL=https://example.com\nMESSAGE="你好\\n开发者"\n' },
  { id: 'properties', name: 'Properties ↔ JSON', english: 'Java Properties Converter', category: '结构化数据', description: 'Java Properties 文本与 JSON 字符串对象互转，支持转义、Unicode、续行、空格或 =/: 分隔。拒绝重复键；输出使用 ASCII Unicode 转义。', sample: 'server.port=8080\napp.name=DevKit\nwelcome=\\u4f60\\u597d\npath=C:\\\\data\n' },
  { id: 'hmac', name: 'HMAC 签名', english: 'HMAC Generator', category: '安全与标识', description: '使用 UTF-8 密钥计算 HMAC SHA-256 / SHA-384 / SHA-512，输出 HEX 或 Base64，可核对已有签名。密钥与结果仅在内存；工作区默认排除此任务。', sample: 'The quick brown fox jumps over the lazy dog' },
  { id: 'unicode', name: 'Unicode 转义', english: 'Unicode Escape Converter', category: '编码与解析', description: '文本与 JavaScript Unicode 转义互转，支持 \\uXXXX、\\u{1F600} 和代理对；输出为文本，不执行。', sample: '你好，DevKit 😄' },
  { id: 'css-unit', name: 'CSS 单位换算', english: 'CSS Unit Converter', category: '颜色与设计', description: '逐行转换 px / rem / em / vw，em 使用设定的字体基准，vw 使用设定的视口宽度。输入数字或带对应单位的值，不解析 CSS 表达式。', sample: '16px\n24px\n-8px\n1.5px' },
  { id: 'http-status', name: 'HTTP 状态码速查', english: 'HTTP Status Reference', category: '代码与查询', description: '离线查询常用 HTTP 状态码、英文名称与中文说明；输入状态码、名称或关键词。不覆盖全部扩展状态码。', sample: '404' },
];
export function isDeveloperTool(id: string): id is DeveloperToolId { return Object.hasOwn(developerDefaults, id); }
const pretty = (value: unknown) => JSON.stringify(value, null, 2);
function stringObject(input: string): Record<string, string> {
  const value = JSON.parse(input);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string')) throw new Error('请输入平面 JSON 对象，所有值必须是字符串。');
  return value;
}
async function formatCode(input: string, options: Options) {
  if (input.length > 200_000) throw new Error('代码格式化最多支持 200,000 字符。');
  const language = options.language || 'babel';
  const prettier = await import('prettier/standalone');
  const plugins = language === 'html' ? [await import('prettier/plugins/html')] : ['css', 'scss'].includes(language) ? [await import('prettier/plugins/postcss')] : language === 'typescript' ? [await import('prettier/plugins/typescript'), await import('prettier/plugins/estree')] : language === 'babel' ? [await import('prettier/plugins/babel'), await import('prettier/plugins/estree')] : null;
  if (!plugins) throw new Error('请选择支持的代码语言。');
  return prettier.format(input, { parser: language, plugins, tabWidth: options.indent === '4' ? 4 : 2, singleQuote: options.quotes !== 'double', printWidth: 100, embeddedLanguageFormatting: 'off' });
}
function selectJson(input: string, path: string): string {
  if (!path.startsWith('$') || path.length > 2000) throw new Error('路径必须从 $ 开始，且不超过 2,000 字符。');
  let nodes = [jsonTree(input)], position = 1;
  while (position < path.length) {
    const match = /^(?:\.([A-Za-z_$][\w$]*)|\[(0|[1-9]\d*|\*|"(?:\\.|[^"\\])*")\])/.exec(path.slice(position));
    if (!match) throw new Error(`不支持的路径语法：${path.slice(position)}。支持 .field、[0]、["key"]、[*]。`);
    position += match[0].length;
    const token = match[1] ?? match[2];
    nodes = nodes.flatMap(node => {
      if (token === '*' && !match[1]) return node.children.map(child => child.node);
      const key = match[1] ?? (token.startsWith('"') ? JSON.parse(token) as string : token);
      if (node.kind === 'value' || (node.kind === 'array' && (match[1] || token.startsWith('"')))) return [];
      if (!match[1] && /^\d/.test(token) && node.kind !== 'array') return [];
      return node.children.filter(child => child.key === key).map(child => child.node);
    });
  }
  return `[${nodes.length ? '\n' + nodes.map(node => node.raw).join(',\n') + '\n' : ''}]`;
}
type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; anyOf?: Schema[] };
function inferSchema(nodes: JsonNode[], depth = 0): Schema {
  if (depth > 100) throw new Error('Schema 超过 100 层。');
  const groups = new Map<string, JsonNode[]>();
  for (const node of nodes) {
    const type = node.kind !== 'value' ? node.kind : node.raw === 'null' ? 'null' : node.raw.startsWith('"') ? 'string' : /^(true|false)$/.test(node.raw) ? 'boolean' : /[.eE]/.test(node.raw) ? 'number' : 'integer';
    groups.set(type, [...(groups.get(type) || []), node]);
  }
  if (groups.has('number') && groups.has('integer')) { groups.get('number')!.push(...groups.get('integer')!); groups.delete('integer'); }
  const variants: Schema[] = [];
  for (const [type, items] of groups) {
    const schema: Schema = { type };
    if (type === 'array') schema.items = inferSchema(items.flatMap(node => node.children.map(child => child.node)), depth + 1);
    if (type === 'object') {
      const keys = [...new Set(items.flatMap(node => node.children.map(child => child.key)))];
      schema.properties = Object.fromEntries(keys.map(key => [key, inferSchema(items.flatMap(node => node.children.filter(child => child.key === key).map(child => child.node)), depth + 1)]));
      schema.required = keys.filter(key => items.every(node => node.children.some(child => child.key === key)));
    }
    variants.push(schema);
  }
  return variants.length > 1 ? { anyOf: variants } : variants[0] ?? {};
}
function queryString(input: string, options: Options) {
  if (options.mode === 'encode') {
    const value = JSON.parse(input);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请输入 JSON 对象，值为字符串或字符串数组。');
    const query = new URLSearchParams();
    for (const [key, item] of Object.entries(value)) for (const entry of Array.isArray(item) ? item : [item]) {
      if (typeof entry !== 'string') throw new Error('参数值必须是字符串或字符串数组。');
      query.append(key, entry);
    }
    return query.toString();
  }
  const text = input.trim().replace(/^\?/, '');
  if (/^[a-z][\w+.-]*:\/\//i.test(text) || /%(?![0-9a-f]{2})/i.test(text)) throw new Error('请输入合法的 Query 参数串；完整 URL 请使用 URL 解析工具。');
  decodeURIComponent(text.replace(/\+/g, ' '));
  const value: Record<string, string | string[]> = Object.create(null);
  for (const [key, entry] of new URLSearchParams(text)) value[key] = Object.hasOwn(value, key) ? [...(Array.isArray(value[key]) ? value[key] as string[] : [value[key] as string]), entry] : entry;
  return pretty(value);
}
function httpCode(input: string, options: Options) {
  const config = JSON.parse(input);
  if (!config || typeof config !== 'object' || Array.isArray(config) || typeof config.url !== 'string') throw new Error('配置必须包含 url 字符串。');
  const url = new URL(config.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL 仅支持 HTTP(S)，认证信息请放到 headers。');
  const method = String(config.method ?? 'GET').toUpperCase();
  if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method)) throw new Error('不支持此 HTTP method。');
  const headers = config.headers ?? {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) || Object.entries(headers).some(([key, value]) => !/^[!#$%&'*+.^_`|~\w-]+$/.test(key) || typeof value !== 'string' || /[\r\n]/.test(value))) throw new Error('headers 必须为合法名称与单行字符串值的对象。');
  const body = config.body === undefined ? undefined : typeof config.body === 'string' ? config.body : JSON.stringify(config.body);
  if (body !== undefined && ['GET', 'HEAD'].includes(method)) throw new Error('GET / HEAD 不支持请求体，请移除 body 或更换 method。');
  const shell = (text: string) => "'" + text.replace(/'/g, "'\\''") + "'";
  if (options.style === 'curl') return ['curl', '--request', shell(method), '--url', shell(config.url), ...Object.entries(headers).flatMap(([key, value]) => ['--header', shell(`${key}: ${value}`)]), ...(body === undefined ? [] : ['--data-raw', shell(body)])].join(' ');
  if (options.style === 'axios') return `import axios from 'axios';\n\nconst response = await axios.request(${pretty({ url: config.url, method, headers, ...(body === undefined ? {} : { data: config.body }) })});\nconsole.log(response.data);\n`;
  return `const response = await fetch(${JSON.stringify(config.url)}, ${pretty({ method, headers, ...(body === undefined ? {} : { body }) })});\nif (!response.ok) throw new Error(\`HTTP \${response.status}\`);\nconst text = await response.text();\nconsole.log(text);\n`;
}
function cronPreview(input: string, options: Options) {
  const fields = input.trim().split(/\s+/);
  if (fields.length !== 5 || input.length > 1000) throw new Error('请输入五字段 Cron：分 时 日 月 周。');
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const values = fields.map((field, index) => {
    const [min, max] = bounds[index], result = new Set<number>();
    for (const part of field.split(',')) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) throw new Error(`Cron 字段无效：${field}`);
      const step = Number(match[2] ?? 1), range = match[1].split('-').map(Number);
      const start = match[1] === '*' ? min : range[0], end = match[1] === '*' ? max : range[1] ?? (match[2] ? max : start);
      if (start < min || end > max || start > end || step < 1 || step > max - min + 1) throw new Error(`Cron 字段越界：${field}`);
      for (let value = start; value <= end; value += step) result.add(index === 4 && value === 7 ? 0 : value);
    }
    return result;
  });
  const count = Number(options.count || 10);
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('预览数量为 1–50。');
  if (options.start && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(options.start)) throw new Error('起始时间需要带时区的 ISO 日期，如 2026-10-24T00:00:00Z。');
  if (options.start) {
    const [year, month, day, hour, minute, second = 0] = options.start.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/)![0].split(/[-T:]/).map(Number);
    const calendar = new Date(0); calendar.setUTCFullYear(year, month, 0);
    if (month < 1 || month > 12 || day < 1 || day > calendar.getUTCDate() || hour > 23 || minute > 59 || second > 59) throw new Error('起始时间包含无效的日期或时分秒。');
  }
  const start = options.start ? new Date(options.start) : new Date();
  if (!Number.isFinite(start.getTime())) throw new Error('起始时间无效。');
  const date = new Date(Math.floor(start.getTime() / 60_000) * 60_000 + 60_000);
  const end = start.getTime() + 1462 * 86400_000, matches: string[] = [];
  while (date.getTime() <= end && matches.length < count) {
    const day = values[2].has(date.getUTCDate()), week = values[4].has(date.getUTCDay());
    const dayMatches = fields[2].startsWith('*') || fields[4].startsWith('*') ? day && week : day || week;
    if (values[3].has(date.getUTCMonth() + 1) && dayMatches) {
      if (values[1].has(date.getUTCHours()) && values[0].has(date.getUTCMinutes())) matches.push(date.toISOString());
      date.setUTCMinutes(date.getUTCMinutes() + 1);
    } else { date.setUTCDate(date.getUTCDate() + 1); date.setUTCHours(0, 0, 0, 0); }
  }
  return pretty({ expression: fields.join(' '), timezone: 'UTC', after: start.toISOString(), matches, complete: matches.length === count, note: '结果严格晚于起始时间；搜索窗口最多 4 年。' });
}
function envConvert(input: string, options: Options) {
  if (options.mode === 'encode') return Object.entries(stringObject(input)).map(([key, value]) => {
    if (!/^[A-Za-z_][\w]*$/.test(key)) throw new Error(`无效环境变量名：${key}`);
    return `${key}=${JSON.stringify(value)}`;
  }).join('\n');
  const result: Record<string, string> = Object.create(null);
  for (const [index, line] of input.replace(/^\uFEFF/, '').split(/\r?\n/).entries()) {
    if (/^\s*(#|$)/.test(line)) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`.env 第 ${index + 1} 行格式无效。`);
    const [, key, raw] = match;
    if (Object.hasOwn(result, key)) throw new Error(`重复变量：${key}`);
    let value: string;
    if (raw.startsWith('"')) {
      const quoted = /^"(?:\\.|[^"\\])*"/.exec(raw)?.[0];
      if (!quoted || !/^\s*(?:#.*)?$/.test(raw.slice(quoted.length))) throw new Error(`第 ${index + 1} 行引号未闭合或尾部无效。`);
      value = JSON.parse(quoted);
    } else if (raw.startsWith("'")) {
      const end = raw.indexOf("'", 1);
      if (end < 0 || !/^\s*(?:#.*)?$/.test(raw.slice(end + 1))) throw new Error(`第 ${index + 1} 行引号无效。`);
      value = raw.slice(1, end);
    } else value = raw.split('#', 1)[0].trimEnd();
    result[key] = value;
  }
  return pretty(result);
}
function propertiesConvert(input: string, options: Options) {
  const escape = (text: string, key: boolean) => text.split('').map((char, index) => {
    const mapped: Record<string, string> = { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\f': '\\f' };
    return mapped[char] ?? (/[^\x20-\x7e]/.test(char) ? '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0') : /[=:#! ]/.test(char) && (key || index === 0) ? '\\' + char : char);
  }).join('');
  if (options.mode === 'encode') return Object.entries(stringObject(input)).map(([key, value]) => `${escape(key, true)}=${escape(value, false)}`).join('\n');
  const unescape = (text: string) => {
    if (/\\u(?![0-9a-fA-F]{4})/.test(text.replace(/\\\\/g, ''))) throw new Error('Properties Unicode 转义需要四位十六进制。');
    return text.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (_all, hex: string | undefined, char: string) => hex ? String.fromCharCode(parseInt(hex, 16)) : ({ n: '\n', r: '\r', t: '\t', f: '\f' }[char] ?? char));
  };
  const result: Record<string, string> = Object.create(null), lines = input.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index].replace(/^[ \t\f]+/, '');
    if (!line || /^[#!]/.test(line)) continue;
    while ((/\\+$/.exec(line)?.[0].length ?? 0) % 2) {
      if (++index >= lines.length) { line = line.slice(0, -1); break; }
      line = line.slice(0, -1) + lines[index].replace(/^[ \t\f]+/, '');
    }
    let position = 0;
    while (position < line.length) { if (line[position] === '\\') position += 2; else if (/[=: \t\f]/.test(line[position])) break; else position++; }
    const key = unescape(line.slice(0, position));
    let tail = line.slice(position).replace(/^[ \t\f]+/, '');
    tail = tail.replace(/^[=:][ \t\f]*/, '');
    if (Object.hasOwn(result, key)) throw new Error(`重复 Properties 键：${key}`);
    result[key] = unescape(tail);
  }
  return pretty(result);
}
async function hmac(input: string, options: Options) {
  if (!options.key) throw new Error('请输入 HMAC 密钥。');
  const algorithm = options.algorithm || 'SHA-256';
  if (!['SHA-256', 'SHA-384', 'SHA-512'].includes(algorithm)) throw new Error('不支持此 HMAC 算法。');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(options.key), { name: 'HMAC', hash: algorithm }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input)));
  return options.format === 'base64' ? btoa(String.fromCharCode(...bytes)) : [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
function unicode(input: string, options: Options) {
  if (options.mode !== 'decode') return input.split('').map(char => /[\x20-\x7e]/.test(char) && char !== '\\' ? char : '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  let result = '';
  for (let index = 0; index < input.length; index++) {
    if (input[index] !== '\\' || input[index + 1] !== 'u') { result += input[index]; continue; }
    const match = /^\\u(?:\{([0-9a-f]{1,6})\}|([0-9a-f]{4}))/i.exec(input.slice(index));
    if (!match || parseInt(match[1] ?? match[2], 16) > 0x10ffff) throw new Error(`位置 ${index} 的 Unicode 转义无效。`);
    result += String.fromCodePoint(parseInt(match[1] ?? match[2], 16)); index += match[0].length - 1;
  }
  return result;
}
function cssUnits(input: string, options: Options) {
  const base = Number(options.base ?? 16), viewport = Number(options.viewport ?? 1440);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(viewport) || viewport <= 0) throw new Error('字体基准与视口宽度必须是正数。');
  const scales: Record<string, number> = { px: 1, rem: base, em: base, vw: viewport / 100 };
  const from = options.from || 'px', to = options.to || 'rem';
  if (!Object.hasOwn(scales, from) || !Object.hasOwn(scales, to)) throw new Error('不支持此 CSS 单位。');
  return input.trim().split(/\r?\n/).map((line, index) => {
    const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(px|rem|em|vw)?\s*$/.exec(line);
    if (!match || match[2] && match[2] !== from) throw new Error(`第 ${index + 1} 行请输入 ${from} 数值。`);
    const value = Number(match[1]) * scales[from] / scales[to];
    if (!Number.isFinite(value) || Math.abs(value) >= 1e15) throw new Error('换算数值超出支持范围。');
    return `${Number(value.toFixed(8))}${to}`;
  }).join('\n');
}
const statuses: [number, string, string][] = [
  [100, 'Continue', '继续发送请求体'], [101, 'Switching Protocols', '切换协议'], [103, 'Early Hints', '预先提示资源'],
  [200, 'OK', '请求成功'], [201, 'Created', '资源已创建'], [202, 'Accepted', '已接受，尚未完成'], [204, 'No Content', '成功，无响应内容'], [206, 'Partial Content', '部分资源内容'],
  [301, 'Moved Permanently', '永久重定向'], [302, 'Found', '临时重定向'], [303, 'See Other', '使用 GET 获取其他地址'], [304, 'Not Modified', '缓存仍有效'], [307, 'Temporary Redirect', '临时重定向，保留方法'], [308, 'Permanent Redirect', '永久重定向，保留方法'],
  [400, 'Bad Request', '请求无效'], [401, 'Unauthorized', '需要身份认证'], [403, 'Forbidden', '拒绝访问'], [404, 'Not Found', '资源不存在'], [405, 'Method Not Allowed', '不允许此请求方法'], [408, 'Request Timeout', '请求超时'], [409, 'Conflict', '资源状态冲突'], [410, 'Gone', '资源已移除'], [413, 'Content Too Large', '请求内容过大'], [415, 'Unsupported Media Type', '不支持此媒体类型'], [422, 'Unprocessable Content', '内容无法处理'], [429, 'Too Many Requests', '请求过于频繁'],
  [500, 'Internal Server Error', '服务器内部错误'], [501, 'Not Implemented', '功能未实现'], [502, 'Bad Gateway', '上游网关响应无效'], [503, 'Service Unavailable', '服务暂不可用'], [504, 'Gateway Timeout', '上游网关超时'],
];
export async function developerTransform(id: DeveloperToolId, input: string, options: Options): Promise<string> {
  switch (id) {
    case 'code-format': return formatCode(input, options);
    case 'json-path': return selectJson(input, options.path || '$');
    case 'json-schema': return pretty({ $schema: 'https://json-schema.org/draft/2020-12/schema', ...inferSchema([jsonTree(input)]) });
    case 'query-string': return queryString(input, options);
    case 'http-code': return httpCode(input, options);
    case 'cron': return cronPreview(input, options);
    case 'env': return envConvert(input, options);
    case 'properties': return propertiesConvert(input, options);
    case 'hmac': return hmac(input, options);
    case 'unicode': return unicode(input, options);
    case 'css-unit': return cssUnits(input, options);
    case 'http-status': {
      const query = input.trim().toLowerCase();
      const matches = statuses.filter(row => row.join(' ').toLowerCase().includes(query));
      if (!matches.length) throw new Error('常用状态码库未找到匹配项。可输入 404、timeout 或中文关键词。');
      return pretty(matches.map(([code, name, description]) => ({ code, name, description })));
    }
  }
}
