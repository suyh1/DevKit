import type { Options, ToolId } from './tools';

export type Suggestion = { id: ToolId; reason: string; options?: Options };
export const DETECTION_LIMIT = 200_000;
// Explicit input only. No clipboard access, source execution or network requests.
export function detectTools(input: string): Suggestion[] {
  if (input.length > DETECTION_LIMIT) throw new Error('内容识别最多支持 200,000 字符，请直接导入目标工具处理更大的内容。');
  const text = input.trim();
  if (!text) return [];
  const suggestions: Suggestion[] = [];
  const add = (id: ToolId, reason: string, options?: Options) => suggestions.push({ id, reason, options });
  if (/^[\[{]/.test(text)) {
    try {
      const data = JSON.parse(text);
      add('json', '识别到 JSON 对象或数组');
      add('json-code', '从 JSON 样本生成 Java / TypeScript 类型');
      if (Array.isArray(data) && data.length && data.every(item => item && typeof item === 'object' && !Array.isArray(item))) add('json-csv', '对象数组可导出为表格');
      add('yaml', '将 JSON 转为 YAML', { mode: 'json-yaml' });
    } catch { /* Other structured formats may start with a bracket. */ }
  }
  if (/^[\w-]+\.[\w-]+\.[\w-]*$/.test(text) && text.startsWith('eyJ')) add('jwt', '疑似 JWT：仅推荐解码，不判断可信性');
  if (/^https?:\/\/\S+$/i.test(text)) {
    try { new URL(text); add('url-inspect', '识别到 HTTP(S) 地址，可拆解重复查询参数'); } catch { /* Not a URL. */ }
  }
  if (/^(?:\d{1,3}\.){3}\d{1,3}\/(?:\d{1,2}|(?:\d{1,3}\.){3}\d{1,3})$/.test(text)) add('ipv4', '疑似 IPv4 子网表达式');
  if (/^<[?\w!]/.test(text) && text.endsWith('>')) add('xml', '疑似 XML：使用格式化工具检查结构');
  if (/^H4sI[A-Za-z0-9+/=\s]*$/.test(text)) add('gzip', '疑似 GZip Base64', { mode: 'decompress' });
  if (/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(text)) add('ulid', '识别到 ULID，可解析其时间字段', { mode: 'parse' });
  if (/^[0-7]{3,4}$/.test(text) || /^[-dlcbps]?[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(text)) add('chmod', '疑似 Unix 文件权限');
  if (/^-?\d{10}(?:\d{3})?$/.test(text)) add('timestamp', '疑似 Unix 时间戳，请确认秒 / 毫秒单位', { unit: text.replace('-', '').length === 13 ? 'ms' : 's' });
  if (/(?:^|\n)\s*(?:export\s+)?(?:interface|type)\s+\w+/.test(text)) add('type-json', '识别到 TypeScript 类型声明', { language: 'ts' });
  else if (/\b(?:class|record)\s+\w+\s*(?:[<{(]|extends\b|implements\b)/.test(text)) add('type-json', '疑似 Java 类 / Record', { language: 'java' });
  if (suggestions.length === 0) add('text-stats', '未识别到明确格式，可先查看文本、字节和行数统计');
  return suggestions.slice(0, 5);
}
