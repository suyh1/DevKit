import { analysisTools, byAnalysis, mapAnalysis, type AnalysisId } from './analysis/catalog';
import { jsonToJava, jsonToTypescript } from './generators';
import { categoryFor } from './catalog';
import { convertRadix, decodeJwt, htmlEntities, jsonToCsv, transformText } from './utilities';
import { colorTransform, isColorTool } from './colors';
import type { ColorToolId } from './colors';
import { practicalDefaults, practicalTools, isPracticalTool, practicalTransform } from './practical';
import type { PracticalToolId } from './practical';
import { developerDefaults, developerTools, isDeveloperTool, developerTransform } from './developer';
import type { DeveloperToolId } from './developer';
import { extendedDefaults, extendedTools, isExtendedTool, extendedTransform } from './extended';
import type { ExtendedToolId } from './extended';
import { replaceMatches } from './regex-replace';
import { timestampDate, timeRows } from './time-conversion';
import { geoDefaults } from './geo-config';

export type ToolId = 'json-lines' | 'markdown-table' | 'qr-code' | 'semver' | 'css-flex' | 'mock-data' | 'geo-coordinates' | 'json' | 'json-code' | 'type-json' | 'json-csv' | 'base64' | 'url' | 'html' | 'timestamp' | 'hash' | 'uuid' | 'regex' | 'jwt' | 'radix' | 'text' | ColorToolId | PracticalToolId | DeveloperToolId | ExtendedToolId | AnalysisId;
function isAnalysisId(id: string): id is AnalysisId { return byAnalysis.has(id); }
export type LegacyToolId = 'json-java' | 'json-ts';
export type Options = Record<string, string>;
export const defaultOptions: Record<ToolId, Options> = {
  'mock-data': { source: 'example', count: '10', seed: 'devkit', format: 'json', rules: '{}' },
  'geo-coordinates': geoDefaults,
  'json-lines': { mode: 'array', blank: 'skip' }, 'markdown-table': { mode: 'markdown', delimiter: 'comma' },
  'qr-code': { level: 'M', size: '384' }, semver: { range: '^1.2.3' },
  'css-flex': { direction: 'row', wrap: 'wrap', justify: 'flex-start', align: 'center', width: '360', gap: '12' },
  ...mapAnalysis(s => s.options),
  ...practicalDefaults,
  ...developerDefaults,
  ...extendedDefaults,
  json: { mode: 'format', indent: '2' }, base64: { mode: 'encode' }, url: { mode: 'encode' },
  timestamp: { mode: 'single', unit: 's', zone: 'UTC' }, hash: { algorithm: 'SHA-256' }, uuid: {}, regex: { mode: 'match', replacement: '', pattern: '[\\w.+-]+@[\\w.-]+\\.[a-zA-Z]{2,}', flags: 'g' },
  'json-code': { language: 'ts', rootName: 'Root', javaStyle: 'pojo', tsStyle: 'interface', annotations: 'none', value: 'include' },
  'type-json': { language: 'ts', rootName: '', optional: 'include', arrayLength: '1' },
  'json-csv': { delimiter: 'comma', excelSafe: 'on' }, html: { mode: 'encode' },
  jwt: {}, radix: { from: '10', to: '16' }, text: { mode: 'camel' },
  'color-picker': {}, 'color-convert': {}, 'color-palette': { mode: 'analogous', format: 'css' },
  'color-gradient': { second: '#F5B041', angle: '135', type: 'linear' },
  'color-contrast': { second: '#FFFFFF' }, 'color-mix': { second: '#FFFFFF', amount: '50', space: 'srgb' },
};
const definitions: { id: ToolId; name: string; english: string; category: string; description: string; sample: string }[] = [
  { id: 'mock-data', name: '批量 Mock 数据', english: 'Mock Data Generator', category: '结构化数据', description: '从 JSON 示例或常用 Schema 子集生成 1–1,000 份中文测试数据，支持字段规则、固定随机种子和 JSON/CSV 导出。纯本地生成，不是完整 Schema 校验器；规则优先于样本/Schema，最多 100,000 节点、20 层。', sample: '{"id":1,"name":"张三","email":"demo@example.com","city":"北京","active":true}' },
  { id: 'geo-coordinates', name: '经纬度工具', english: 'Geographic Coordinates', category: '时间与数值', description: '十进制度与度分秒互转；按圆心、半径及四方向计算椭球/球面圆周点；从文本提取度分秒坐标对。结果可逐项、整列或 CSV/TSV 复制，全部离线处理。支持两点 WGS84 距离和初始方位反算。', sample: '116.3913,39.9075' },
  { id: 'json-lines', name: 'JSON Lines ↔ JSON 数组', english: 'JSON Lines NDJSON', category: '结构化数据', description: '逐行 JSON 与数组互转，保留数字原文，可选择空行策略并定位坏行。', sample: '{"id":9007199254740993}\n{"id":2}' },
  { id: 'markdown-table', name: 'Markdown 表格转换', english: 'Markdown Table CSV TSV', category: '结构化数据', description: 'CSV / TSV 与 Markdown 表格双向转换，支持竖线、空单元格与多行字段。', sample: '编号,备注\n001,"开发,测试"\n002,A|B' },
  { id: 'qr-code', name: '离线二维码生成', english: 'QR Code Generator', category: '编码与解析', description: '将文本或链接编码为二维码，预览并按尺寸、纠错级别导出 PNG。支持导入本地图片或粘贴截图识别二维码并复制内容。', sample: '你好，DevKit 😄' },
  { id: 'semver', name: 'SemVer 版本范围检查', english: 'Semantic Version Range', category: '代码与查询', description: '按 npm 范围筛选版本，列出最高匹配版本、降序结果与无效行。', sample: '1.4.0\n2.0.0\n1.5.0-beta.1\n1.2.3' },
  { id: 'css-flex', name: 'CSS Flex 布局预览', english: 'CSS Flexbox', category: '颜色与设计', description: '调节容器宽度、间距、方向、换行和对齐方式，实时预览并复制 CSS。', sample: '' },
  ...analysisTools,
  ...practicalTools,
  ...developerTools,
  ...extendedTools,
  { id: 'json', name: 'JSON 格式化', english: 'JSON Formatter', category: '数据处理', description: '格式化、压缩与校验 JSON，支持 JSON 文档与带转义的字符串互转。可生成并预演 RFC 6902 补丁。', sample: '{"name":"DevKit","version":"0.3.0","offline":true,"platforms":["Windows","Linux ARM64","Linux AMD64"]}' },
  { id: 'json-code', name: 'JSON 转类型', english: 'JSON to Java / TypeScript', category: '代码生成', description: '在同一工具切换 Java POJO / Record 与 TypeScript interface / type，保留各语言选项，从全部 JSON 样本推断嵌套类型。', sample: '{"id":10001,"user_name":"Alice","active":true,"profile":{"city":"上海","score":98.5},"roles":["admin","developer"],"orders":[{"id":1,"note":"加急"},{"id":2,"amount":19.9}]}' },
  { id: 'type-json', name: '类型转 JSON', english: 'Java / TypeScript to JSON', category: '代码生成', description: '从 Java 类 / Record 或 TS interface / type 生成 JSON 示例。支持嵌套、集合、本地继承与泛型；循环引用和未知值类型输出 null。不会执行源码或还原真实数据；外部类型需同时提供定义。最多 200,000 字符、500 类型、10,000 示例节点、60 层。', sample: 'export interface User {\n  id: number;\n  name: string;\n  active: boolean;\n  profile: { city: string };\n  tags: string[];\n  nickname?: string;\n}' },
  { id: 'json-csv', name: 'JSON 转 CSV', english: 'JSON to CSV', category: '数据处理', description: '合并对象数组的所有列，支持 CSV / TSV 和表格公式转义。', sample: '[{"name":"Alice","city":"上海","note":"hello, world"},{"name":"Bob","city":"北京","active":true}]' },
  { id: 'base64', name: 'Base64 编解码', english: 'Base64 Encoder', category: '编码转换', description: '在文本与 Base64 之间转换，完整支持 UTF-8 中文。文件模式可无损转换二进制和 Data URL 并下载恢复的文件。', sample: '你好，开发者！Hello, DevKit.' },
  { id: 'url', name: 'URL 编解码', english: 'URL Encoder', category: '编码转换', description: '编码或解码 URL 参数中的特殊字符。', sample: 'https://example.com/search?q=程序员&lang=中文' },
  { id: 'html', name: 'HTML 实体转换', english: 'HTML Entities', category: '编码转换', description: '转义 HTML 特殊字符；解码常见命名实体与数字实体。输出作为文本展示。', sample: '<div title="DevKit">你好 & welcome</div>' },
  { id: 'timestamp', name: '时间戳转换', english: 'Timestamp Converter', category: '效率工具', description: '在 Unix 时间戳与日期之间转换，明确区分秒和毫秒；支持单值查看及批量按 IANA 时区转换，逐行报告错误并导出 TSV。支持两时刻及相邻记录耗时比较。', sample: '1735689600' },
  { id: 'hash', name: '哈希计算', english: 'Hash Generator', category: '数据处理', description: '为文本计算 SHA 摘要，或分块计算文件 SHA-256，支持批量核对和 SHA256SUMS 导入导出。目录按相对路径计算，可与另一目录或清单比较。', sample: 'Hello, DevKit!' },
  { id: 'uuid', name: 'UUID 生成', english: 'UUID Generator', category: '效率工具', description: '使用安全随机数批量生成 UUID v4。还可生成 UUID v7 及提取其中的毫秒时间戳。', sample: '5' },
  { id: 'regex', name: '正则测试', english: 'Regex Playground', category: '数据处理', description: '测试 JavaScript 正则表达式，查看匹配位置与捕获组，或用替换模板输出全文与匹配次数。可保存匹配或替换回归样例，修改表达式后自动复验。', sample: '联系 hello@example.com 或 dev@toolkit.dev' },
  { id: 'jwt', name: 'JWT 解码', english: 'JWT Decoder', category: '数据处理', description: '查看 Header、Payload 和时间字段。仅解码，不验证签名或令牌可信性。', sample: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZXZraXQiLCJuYW1lIjoiQWxpY2UiLCJpYXQiOjE3MzU2ODk2MDB9.c2FtcGxl' },
  { id: 'radix', name: '进制转换', english: 'Number Base Converter', category: '效率工具', description: '使用 BigInt 精确转换二、八、十、十六进制整数。', sample: '9007199254740993' },
  { id: 'text', name: '文本与命名转换', english: 'Text Transformer', category: '效率工具', description: '驼峰、下划线、大小写转换，以及逐行去重、排序与清理。', sample: 'user_profile_name\nHTTPResponseCode\nhello-world' },
  { id: 'color-picker', name: '取色器', english: 'Color Picker', category: '颜色管理', description: '从色板、屏幕或本地图片中取色，收藏你的常用颜色。', sample: '#147D64' },
  { id: 'color-convert', name: '颜色格式转换', english: 'Color Converter', category: '颜色管理', description: 'HEX、RGB、HSL 相互转换，同时查看 HSV、CMYK 与透明度。', sample: 'hsl(165 72% 28% / 80%)' },
  { id: 'color-palette', name: '调色板与色阶', english: 'Palette Generator', category: '颜色管理', description: '生成配色方案与 50–950 色阶，导出 CSS 变量和 JSON。', sample: '#147D64' },
  { id: 'color-gradient', name: '渐变生成器', english: 'Gradient Generator', category: '颜色管理', description: '搭配 2–5 个色标，实时预览线性、径向渐变并导出 CSS。', sample: '#147D64' },
  { id: 'color-contrast', name: '颜色对比度', english: 'Contrast Checker', category: '颜色管理', description: '检查文字与背景的 WCAG 2.2 对比度，以及 AA / AAA 等级。收藏色支持 WCAG 对比度矩阵。', sample: '#147D64' },
  { id: 'color-mix', name: '混色与插值', english: 'Color Mixer', category: '颜色管理', description: '在 sRGB 或线性光空间混合颜色，支持透明度与渐变色阶。', sample: '#147D64' },
];

export const tools = definitions.map(tool => ({ ...tool, category: categoryFor(tool.id) }));

// Validate with the native parser, but format the original tokens so large numbers,
// exponent notation and duplicate keys are never silently rewritten.
export function formatJson(input: string, options: Options): string {
  JSON.parse(input);
  const tokens = input.match(/"(?:\\.|[^"\\])*"|[^\s]/g) || [];
  if (options.mode === 'compact') return tokens.join('');
  const indent = options.indent === '4' ? 4 : 2;
  let depth = 0;
  const chunks: string[] = [];
  const newline = () => '\n' + ' '.repeat(depth * indent);
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '{' || token === '[') {
      chunks.push(token);
      if (tokens[index + 1] !== (token === '{' ? '}' : ']')) {
        if (++depth > 100) throw new Error('JSON 嵌套超过 100 层，请缩小输入结构。');
        chunks.push(newline());
      }
    } else if (token === '}' || token === ']') {
      if (tokens[index - 1] !== (token === '}' ? '{' : '[')) { depth--; chunks.push(newline()); }
      chunks.push(token);
    } else if (token === ',') chunks.push(',', newline());
    else if (token === ':') chunks.push(': ');
    else chunks.push(token);
  }
  return chunks.join('');
}

export async function transform(id: ToolId | LegacyToolId, input: string, options: Options = {}, onMatchCount?: (count: number) => void): Promise<string> {
  if (id === 'mock-data') return (await import('./mock-data')).generateMock(input, options);
  if (input.length > 2_000_000) throw new Error('输入超过 2 MB，请缩小内容后重试。');
  if (id === 'geo-coordinates') return (await import('./geography')).geographyTransform(input, options);
  if (id === 'json-java') return jsonToJava(input, options);
  if (id === 'json-ts') return jsonToTypescript(input, options, formatJson(input, { indent: '2' }));
  if (isAnalysisId(id)) return (await import('./analysis/run')).runAnalysis(id, input, { ...byAnalysis.get(id)!.options, ...options });
  if (isColorTool(id)) return colorTransform(id, input, options);
  if (isPracticalTool(id)) return practicalTransform(id, input, options);
  if (isDeveloperTool(id)) return developerTransform(id, input, options);
  if (isExtendedTool(id)) return extendedTransform(id, input, options);
  switch (id) {
    case 'json-lines': return (await import('./record-tools')).jsonLines(input, options);
    case 'markdown-table': return (await import('./record-tools')).markdownTable(input, options);
    case 'semver': return (await import('./record-tools')).checkVersions(input, options);
    case 'qr-code': return (await import('./visual-tools')).makeQr(input, options).createSvgTag();
    case 'css-flex': return (await import('./visual-tools')).flexCss(options);
    case 'json': {
      if (options.mode === 'stringify') {
        JSON.parse(input);
        return JSON.stringify(input);
      }
      if (options.mode === 'parse') {
        const decoded: unknown = JSON.parse(input);
        if (typeof decoded !== 'string') throw new Error('请输入带外层双引号的 JSON 字符串。普通 JSON 文档可直接使用“格式化”。');
        try {
          return formatJson(decoded, options);
        } catch (error) {
          if (error instanceof SyntaxError) throw new Error(`字符串内容不是有效的 JSON：${error.message}`);
          throw error;
        }
      }
      return formatJson(input, options);
    }
    case 'json-code': {
      if (options.language === 'java') return jsonToJava(input, { ...options, style: options.javaStyle || 'pojo' });
      if (options.language && options.language !== 'ts') throw new Error('请选择 Java 或 TypeScript。');
      return jsonToTypescript(input, { ...options, style: options.tsStyle || 'interface' }, formatJson(input, { indent: '2' }));
    }
    case 'type-json': return (await import('./type-samples')).typesToJson(input, options);
    case 'json-csv': return jsonToCsv(input, options);
    case 'jwt': return decodeJwt(input);
    case 'radix': return convertRadix(input, options);
    case 'text': return transformText(input, options);
    case 'html': return htmlEntities(input, options);
    case 'base64': {
      if (options.mode === 'decode') {
        const binary = atob(input.replace(/\s/g, ''));
        return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
      }
      const bytes = new TextEncoder().encode(input);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(binary);
    }
    case 'url': return options.mode === 'decode' ? decodeURIComponent(input) : encodeURIComponent(input);
    case 'timestamp': {
      if (options.mode === 'batch') return timeRows(input, options.unit, options.zone);
      const date = timestampDate(input, options.unit);
      return `秒时间戳    ${Math.floor(date.getTime() / 1000)}\n毫秒时间戳  ${date.getTime()}\nUTC         ${date.toISOString()}\n本地时间    ${date.toLocaleString('zh-CN', { hour12: false })}\n本地时区    ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
    }
    case 'hash': {
      const algorithm = options.algorithm || 'SHA-256';
      if (!['SHA-256', 'SHA-384', 'SHA-512', 'SHA-1'].includes(algorithm)) throw new Error('不支持的哈希算法。');
      const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(input));
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    case 'uuid': {
      const count = Number(input.trim());
      if (!Number.isInteger(count) || count < 1 || count > 1000) throw new Error('请输入 1 到 1000 之间的整数。');
      return Array.from({ length: count }, () => crypto.randomUUID()).join('\n');
    }
    case 'regex': {
      if (!options.pattern) throw new Error('请输入正则表达式。');
      const flags = options.flags ?? 'g';
      const regex = new RegExp(options.pattern, flags);
      if (options.mode === 'replace') {
        const result = replaceMatches(input, regex, options.replacement ?? '');
        onMatchCount?.(result.count);
        return result.text;
      }
      const matches: { match: string; index: number; groups: (string | null)[]; namedGroups?: Record<string, string> }[] = [];
      // exec permits both global and single-match patterns; cap results and advance empty matches.
      let match: RegExpExecArray | null;
      while ((match = regex.exec(input))) {
        matches.push({ match: match[0], index: match.index, groups: match.slice(1).map(v => v ?? null), namedGroups: match.groups });
        if (!regex.global || matches.length >= 1000) break;
        if (match[0] === '') {
          const point = input.codePointAt(regex.lastIndex);
          regex.lastIndex += (regex.unicode || flags.includes('v')) && point !== undefined && point > 0xffff ? 2 : 1;
        }
      }
      return JSON.stringify({ count: matches.length, limitReached: matches.length === 1000, matches }, null, 2);
    }
  }
}
