import { jsonObjectFields } from './result-model';

function decodeSegment(segment: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) throw new Error('JWT 包含无效的 Base64URL 数据。');
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - segment.length % 4) % 4);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(padded), char => char.charCodeAt(0)));
  jsonObjectFields(text);
  return text;
}
export function decodeJwt(input: string): string {
  const parts = input.trim().split('.');
  if (parts.length !== 3) throw new Error('请输入由三段组成的 JWT（header.payload.signature），不支持加密 JWE。');
  const header = decodeSegment(parts[0]), payload = decodeSegment(parts[1]), claims = jsonObjectFields(payload);
  const dates: Record<string, string> = {};
  for (const key of ['iat', 'exp', 'nbf']) {
    const value = claims.has(key) ? JSON.parse(claims.get(key)!.raw) : undefined;
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value * 1000) <= 8.64e15) dates[key] = new Date(value * 1000).toISOString();
  }
  return `{\n  "notice": "仅解码，未验证签名、有效期或可信性。",\n  "header": ${header},\n  "payload": ${payload},\n  "dates": ${JSON.stringify(dates)},\n  "signature": ${JSON.stringify(parts[2])}\n}`;
}

export function convertRadix(input: string, options: Record<string, string>): string {
  const from = Number(options.from || 10), to = Number(options.to || 16);
  if (![2, 8, 10, 16].includes(from) || ![2, 8, 10, 16].includes(to)) throw new Error('仅支持 2、8、10、16 进制。');
  let text = input.trim(), sign = 1n;
  if (text.startsWith('-')) { sign = -1n; text = text.slice(1); } else if (text.startsWith('+')) text = text.slice(1);
  const prefixes: Record<number, string> = { 2: '0b', 8: '0o', 16: '0x' };
  if (prefixes[from] && text.toLowerCase().startsWith(prefixes[from])) text = text.slice(2);
  if (text.length > 4096) throw new Error('数字最多支持 4096 位。');
  const patterns: Record<number, RegExp> = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[\da-f]+$/i };
  if (!patterns[from].test(text)) throw new Error(`请输入有效的 ${from} 进制整数。`);
  return ((from === 10 ? BigInt(text) : BigInt(prefixes[from] + text)) * sign).toString(to);
}

export function transformText(input: string, options: Record<string, string>): string {
  const mode = options.mode || 'camel';
  if (mode === 'upper') return input.toUpperCase();
  if (mode === 'lower') return input.toLowerCase();
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  if (mode === 'dedupe') return [...new Set(lines)].join('\n');
  if (mode === 'sort') return lines.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })).join('\n');
  if (mode === 'trim') return lines.map(line => line.trim()).filter(Boolean).join('\n');
  return lines.map(line => {
    const words = line.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean).map(word => word.toLowerCase());
    if (mode === 'snake') return words.join('_');
    if (mode === 'kebab') return words.join('-');
    if (mode === 'pascal') return words.map(word => word[0].toUpperCase() + word.slice(1)).join('');
    return words.map((word, index) => index ? word[0].toUpperCase() + word.slice(1) : word).join('');
  }).join('\n');
}

export function htmlEntities(input: string, options: Record<string, string>): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®' };
  if (options.mode === 'decode') return input.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity] ?? match;
    const value = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(value) || value < 1 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(value);
  });
  const encode: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return input.replace(/[&<>"']/g, char => encode[char]);
}

export function jsonToCsv(input: string, options: Record<string, string>): string {
  const rows: unknown = JSON.parse(input);
  if (!Array.isArray(rows) || !rows.every(row => row !== null && typeof row === 'object' && !Array.isArray(row))) throw new Error('请输入 JSON 对象数组，例如 [{"name":"Alice","age":28}]。');
  const records = rows as Record<string, unknown>[];
  function checkNumber(value: unknown, depth = 0): void {
    if (depth > 100) throw new Error('JSON 嵌套超过 100 层。');
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('CSV 中存在超出安全精度的数字，请将大整数改为 JSON 字符串。');
    if (value && typeof value === 'object') Object.values(value).forEach(child => checkNumber(child, depth + 1));
  }
  checkNumber(records);
  const columns = [...new Set(records.flatMap(row => Object.keys(row)))];
  const delimiter = options.delimiter === 'tab' ? '\t' : ',';
  const cell = (value: unknown) => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (options.excelSafe !== 'off' && /^[\s]*[=+\-@]/.test(text) && typeof value === 'string') text = "'" + text;
    return /["\r\n]/.test(text) || text.includes(delimiter) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return [columns.map(cell).join(delimiter), ...records.map(row => columns.map(column => cell(Object.hasOwn(row, column) ? row[column] : null)).join(delimiter))].join('\r\n');
}
