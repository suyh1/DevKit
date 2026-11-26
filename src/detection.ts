import { tools, type Options, type ToolId } from './tools';
import { workspaceModules, type WorkspaceModuleId } from './catalog';
import { parseColor } from './colors';
import { parseCsv } from './practical';
import { timestampDate } from './time-conversion';
import { ipv4 } from './extended';
import { parseWorkspaceLink } from './workspace-link-format';

export type ServiceDraft = { kind: 'jar' | 'npm' | 'program' | 'script'; jar?: string; program?: string; script?: string; name?: string; jvm?: string; args?: string };

export type Suggestion =
  | { kind: 'tool'; id: ToolId; name: string; reason: string; input?: string; options?: Options }
  | { kind: 'workspace'; id: WorkspaceModuleId; name: string; reason: string; service?: ServiceDraft; resourceId?: string; gitMode?: import('./git-api').GitMode;gitSeed?:import('./git-api').GitSeed; options?: never };
export const DETECTION_LIMIT = 200_000;

const toolNames = new Map(tools.map(t => [t.id, t.name]));
const workspaceNames = new Map(workspaceModules.map(w => [w.id, w.name]));
const intents: Partial<Record<ToolId, string[]>> = {
  password: ['生成密码', '随机密码'], hash: ['计算哈希', '计算摘要'], uuid: ['生成 uuid', '生成uuid'],
  'css-flex': ['弹性布局'], hmac: ['计算 hmac'],
};

type Rules = {
  tool: (id: ToolId, reason: string, options?: Options, input?: string) => void;
  workspace: (id: WorkspaceModuleId, reason: string, service?: ServiceDraft, resourceId?: string) => void;
  open: (id: ToolId, reason: string) => void;
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function contract(r: Rules, comparable: boolean) {
  if (comparable) r.tool('openapi-diff', '核对两份 OpenAPI 契约', { target: '' });
  r.workspace('http', '可在 HTTP 调试中导入接口定义');
  r.workspace('mock', '可根据接口定义配置模拟响应');
}

function jsonRules(data: unknown, text: string, r: Rules) {
  const { tool, workspace } = r;
  const first = Array.isArray(data) ? data[0] : data;
  const rows = Array.isArray(data) && data.length > 0 && data.every(record);
  if (record(first) && record(first.Plan) && typeof first.Plan['Node Type'] === 'string')
    tool('pg-plan', '识别到 PostgreSQL 执行计划');
  if (record(data)) {
    if (data.openapi && record(data.paths)) contract(r, true);
    else if (data.swagger && record(data.paths)) contract(r, false);
    if (data.lockfileVersion && (record(data.packages) || record(data.dependencies)))
      tool('npm-lock-diff', '识别到 npm 锁文件，请补充另一个版本', { target: '' });
    if (data.bomFormat === 'CycloneDX') tool('sbom-diff', '识别到 CycloneDX 组件清单', { target: '' });
    if (record(data.log) && Array.isArray(data.log.entries)) tool('har-waterfall', '识别到 HAR 请求记录');
    if (data.version === 3 && Array.isArray(data.sources) && typeof data.mappings === 'string')
      tool('source-map', '识别到 Source Map，请补充异常堆栈', { target: '' });
    if (Array.isArray(data.nodes) && Array.isArray(data.samples)) tool('cpu-profile', '识别到 V8 CPU 采样');
    if (record(data.outputs) || (Array.isArray(data.assets) && Array.isArray(data.modules)))
      tool('bundle-size', '识别到构建体积统计', { target: '' });
    if (typeof data.type === 'string' && /^(?:Feature(?:Collection)?|GeometryCollection|(?:Multi)?(?:Point|LineString|Polygon))$/.test(data.type)
      && ('coordinates' in data || 'geometry' in data || 'features' in data || 'geometries' in data))
      tool('geojson-map', '识别到 GeoJSON 几何或要素');
    if (/"\$value"\s*:/.test(text)) tool('tokens', '识别到带 $value 的设计令牌');
    if (/:\s*"[^"\n]*\{[\w.-]+[,}]/.test(text)) tool('i18n-diff', '发现翻译消息占位符', { target: '' });
    if (typeof data.url === 'string' && /^https?:\/\//i.test(data.url)) {
      tool('http-code', '从请求配置生成客户端代码');
      workspace('http', '识别到 HTTP 请求配置');
    }
    if (data.$schema || (data.type === 'object' && record(data.properties))) {
      tool('mock-data', '按 Schema 生成示例记录', { source: 'schema' });
      workspace('mock', '可按 Schema 配置接口响应');
    }
    if (data.format === 'devkit-project-center') workspace('projects', '识别到项目中心导出文件');
  }
  tool('json', '识别到 JSON 对象或数组');
  tool('json-code', '从 JSON 样本生成类型');
  if (rows) tool('json-csv', '对象数组可导出为表格');
  tool('yaml', '将 JSON 转为 YAML', { mode: 'json-yaml' });
  if (Array.isArray(data)) tool('json-lines', '将数组拆为逐行记录', { mode: 'lines' });
  tool('json-path', '按路径提取字段', { path: '$' });
  tool('json-schema', '从样本推断 JSON Schema');
  tool('mock-data', '从样本生成测试记录');
  if (record(data) || rows) {
    tool('json-map', '按映射重组 JSON 字段');
    tool('pseudonym', '选择 JSON 字段做稳定替名');
  }
  tool('diff', '与另一份 JSON 比较', { mode: 'json', target: '' });
}

function tableRules(text: string, firstLine: string, r: Rules) {
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  if (!firstLine.includes(delimiter)) return;
  try {
    const [header, ...rows] = parseCsv(text, delimiter);
    if (!rows.length || header.length < 2 || !rows.some(row => row.length > 1)) return;
    const options = { delimiter: delimiter === '\t' ? 'tab' : 'comma' };
    r.tool('csv-json', '将分隔表格导入为 JSON', options);
    r.tool('csv-health', '检查表格的空值、重复和列数');
    r.tool('markdown-table', '将表格转为 Markdown', options);
    r.tool('reconcile', '选择业务键并补充第二张表', { keys: header[0], target: '' });
    r.tool('pivot', '按字段分组汇总', { keys: header[0], aggregate: 'count' });
    r.tool('pseudonym', '选择表格列做稳定替名', { keys: header[0] });
  } catch { /* Quoted prose or source code can contain commas too. */ }
}

function fileRules(text: string, r: Rules) {
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1);
  if (text.length > 2048 || /[\r\n<>"|?*]/.test(text) || /^\w+:\/\//.test(text)) return;
  const path = /^(?:[a-z]:[\\/]|\\\\[^\\]+\\|\/[^/])\S/i.test(text);
  const extension = /(?:^|[\\/])[^\\/:=]+\.([a-z][a-z0-9]{0,11})$/i.exec(text)?.[1].toLowerCase();
  if (path) r.workspace('file-shares', '可在本机选择此路径建立文件共享');
  if (path || extension) r.workspace('transfer', '可选择文件进行局域网传输');
  if (!extension) return;
  if (/^(png|jpe?g|webp|bmp)$/i.test(extension)) {
    r.open('image-compress', '选择原图比较压缩结果');
    r.open('pixel-diff', '选择两张图片核对像素');
    r.open('favicon-kit', '从母图制作站点图标');
    r.open('color-picker', '选择图片并从像素取色');
    r.workspace('whiteboard', '可将图片导入画板协作标注');
  }
  if (extension === 'xlsx') r.open('excel-inspect', '选择 Excel 工作簿查看工作表');
  if (/^(parquet|pq)$/.test(extension)) r.open('parquet-view', '选择 Parquet 文件查看字段和数据');
  if (/^(pem|der|crt|cer)$/.test(extension)) r.open('cert-inspect', '选择证书文件检查有效期和域名');
  if (/^(zip|jar)$/.test(extension)) r.open('zip-inventory', '选择归档文件查看清单');
  if (/^(jar|war|zip)$/.test(extension)) r.open('jar-inspect', '选择归档文件检查 Java 资源');
  if (extension === 'jar') r.workspace('jar', '可在服务管理中配置 JAR 服务', { kind: 'jar', jar: text });
  if (extension === 'exe') r.workspace('jar', '登记可执行程序', { kind: 'program', program: text });
  if (['py', 'js', 'cjs', 'mjs'].includes(extension)) r.workspace('jar', '登记解释器脚本', { kind: 'script', script: text });
  if (/^(txt|csv|tsv|log|md|properties)$/.test(extension)) r.open('encoding-repair', '选择原文件检查字节和文本编码');
  r.open('file-signature', '选择原文件核对签名与扩展名');
}

function colorRules(text: string, r: Rules) {
  if (text.length > 256 || /^\d{3,4}$/.test(text)) return;
  const color = /^(?:--[\w-]+|(?:background-|border-)?color)\s*:\s*(.+?)\s*;?$/i.exec(text)?.[1] ?? text;
  try { parseColor(color); } catch { return; }
  r.tool('color-convert', '转换色值并查看透明度', undefined, color);
  r.tool('color-picker', '将色值带入取色器', undefined, color);
  r.tool('color-palette', '以此颜色生成调色板', undefined, color);
  r.tool('color-contrast', '以此颜色检查文字对比度', undefined, color);
  r.tool('color-gradient', '以此颜色作为渐变起点', undefined, color);
  r.tool('color-mix', '以此颜色作为第一种混合色', undefined, color);
}

function webAddressRules(text: string, { tool, workspace }: Rules) {
  if (/^https?:\/\/\S+$/i.test(text)) {
    try {
      const url = new URL(text);
      const resource = parseWorkspaceLink(url.hash);
      const linked = resource && workspaceModules.find(w => w.id === resource.page);
      if (linked) workspace(linked.id, '链接指向' + linked.name, undefined, resource.id);
      tool('url-inspect', '拆解地址与查询参数');
      tool('qr-code', '为链接生成二维码');
      tool('url', '对完整地址进行百分号编码');
      workspace('http', '可在 HTTP 调试中测试此地址');
      workspace('monitor', '可设置 HTTP 可用性检测');
      workspace('projects', '可将链接设为项目入口');
      workspace('transfer', '可通过快传分享链接');
      return true;
    } catch { /* Malformed URL. */ }
  }
  return false;
}

function scalarRules(text: string, lines: string[], { tool, workspace }: Rules) {
  const first = lines[0];
  if (/^eyJ[\w-]*\.[\w-]+\.[\w-]*$/.test(text)) tool('jwt', '识别到 JWT，可查看载荷');
  if (/^H4sI[A-Za-z0-9+/=\s]*$/.test(text)) tool('gzip', '疑似 GZip Base64', { mode: 'decompress' });
  else if (text.length >= 4 && text.length % 4 === 0 && /^[\w+/]+={0,2}$/.test(text) && /[A-Z+/=]/.test(text)) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
      if (decoded && !/[\x00-\x08\x0e-\x1f]/.test(decoded)) tool('base64', 'Base64 可解为 UTF-8 文本', { mode: 'decode' });
    } catch { /* Binary or malformed input. */ }
  }
  if (/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(text)) tool('ulid', '解析 ULID 时间字段', { mode: 'parse' });
  if (/^-?\d{10}(?:\d{3})?$/.test(text)) tool('timestamp', '识别到 Unix 时间戳', { unit: text.replace('-', '').length === 13 ? 'ms' : 's' });
  else if (/^\d{4}-\d\d-\d\dT/.test(text)) {
    try { timestampDate(text); tool('timestamp', '识别到带时区的日期时间'); } catch { /* Possibly an interval. */ }
  }
  if (/^\d{4}-\d\d-\d\dT\S+\s*\/\s*\d{4}-\d\d-\d\dT/.test(first)) tool('intervals', '识别到 ISO 起止时刻', { target: '' });
  if (/^RRULE:FREQ=/im.test(text)) tool('rrule', '识别到 iCalendar 重复规则');
  if (/^[1-5]\d\d$/.test(text)) tool('http-status', '查询三位 HTTP 状态码');
  if (/^[0-7]{3,4}$/.test(text) || /^[-dlcbps]?[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(text)) tool('chmod', '疑似 Unix 文件权限');
  const radix = /^[+-]?0x[\da-f]+$/i.test(text) ? '16' : /^[+-]?0b[01]+$/i.test(text) ? '2' : /^[+-]?0o[0-7]+$/i.test(text) ? '8' : /^[+-]?\d+$/.test(text) ? '10' : '';
  if (radix) tool('radix', '转换整数的进制', { from: radix, to: radix === '10' ? '16' : '10' });
  if (/^[\d./]+$/.test(text) && text.includes('.')) {
    const cidr = text.includes('/') ? text : text + '/32';
    try {
      ipv4(cidr);
      tool('ipv4', '计算 IPv4 子网范围' + (text.includes('/') ? '' : '（单主机 /32）'), {}, cidr);
      workspace('lan-hosts', '识别到 IPv4 主机地址');
    } catch { /* Version numbers can resemble an address. */ }
  }
  if (/^(?:ssh(?:\s+|:\/\/)|Host\s+\S+[\r\n]+\s*HostName\s+)/i.test(text)) workspace('lan-hosts', '识别到 SSH 主机信息');
  if (/^tcp:\/\/[\w.[\]:-]+:\d+$/i.test(text)) workspace('monitor', '可配置 TCP 端口检测');
  if (/^(?:[\d*/,-]+\s+){4}[\d*/,-]+$/.test(text) && !text.includes('\n')) tool('cron', '识别到五字段 Cron 表达式');
  if (lines.every(line => /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(line.trim()))) tool('semver', '检查语义版本和范围');
  const pair = /^([+-]?\d+(?:\.\d+)?)\s*[,，]\s*([+-]?\d+(?:\.\d+)?)$/.exec(text);
  if (pair && Math.abs(Number(pair[1])) <= 180 && Math.abs(Number(pair[2])) <= 90)
    tool('geo-coordinates', '转换经度与纬度', { lon: pair[1], lat: pair[2] });
  else if (/[东西南北经纬NSEW]/i.test(text) && /\d[°度]/.test(text) && /[′'分]/.test(text))
    tool('geo-coordinates', '从文本提取度分秒坐标', { mode: 'extract' });
  const unit = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(px|rem|em|vw)$/.exec(first);
  if (unit && lines.every(line => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*(px|rem|em|vw)$/.exec(line.trim())?.[1] === unit[1]))
    tool('css-unit', '换算同一单位的 CSS 数值', { from: unit[1], to: unit[1] === 'px' ? 'rem' : 'px' });
}

function codeRules(text: string, lines: string[], r: Rules) {
  const { tool } = r;
  const first = lines[0];
  if (/^(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(text)) tool('svg-optimize', '识别到 SVG 根元素');
  if (/^<[?\w!]/.test(text) && text.endsWith('>')) tool('xml', '识别到标记文档，可检查 XML 结构');
  const html = /^<(?:!doctype\s+html|html|div|p|span|a|body|section|button|main|input|ul|table|h[1-6])[\s>/]/i.test(text);
  if (html) tool('html', '转义 HTML 标记');
  else if (/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/i.test(text)) tool('html', '解码 HTML 实体', { mode: 'decode' });
  if (/%[\da-f]{2}/i.test(text)) tool('url', '解码百分号转义', { mode: 'decode' });
  if (/\\u(?:[\da-f]{4}|\{[\da-f]{1,6}\})/i.test(text)) tool('unicode', '解码 Unicode 转义', { mode: 'decode' });
  if (/^(?:export\s+)?[A-Z_][A-Z_\d]*=/m.test(text)) tool('env', '识别到环境变量赋值');
  if (/^[\w-]+(?:\.[\w-]+)+\s*[=:]/m.test(text)) tool('properties', '识别到点分配置键');
  if (/^\??[\w.%~-]+=[^\s&]*(?:&[\w.%~-]+=[^\s&]*)*$/.test(text)) tool('query-string', '识别到查询参数串');
  if (/^(?:openapi|swagger):\s*\S+/m.test(text) && /^paths:\s*/m.test(text)) contract(r, /^openapi:/m.test(text));
  if (/^(?:spring|server|management):\s*$/m.test(text)) tool('spring-config', '识别到 Spring YAML 配置', { target: '', env: '' });
  if (/^(?:SELECT\b|INSERT\s+INTO\b|UPDATE\s+\S+\s+SET\b|DELETE\s+FROM\b|CREATE\s+(?:TABLE|INDEX|VIEW)\b|WITH\s+\w+\s+AS\b)/i.test(text)) tool('sql', '整理 SQL 语句');

  const ts = /^(?:export\s+)?(?:interface|type)\s+\w+/m.test(text);
  if (ts) tool('type-json', '识别到 TypeScript 类型声明', { language: 'ts' });
  else if (/\b(?:class|record)\s+\w+\s*(?:[<{(]|extends\b|implements\b)/.test(text)) tool('type-json', '疑似 Java 类或 Record', { language: 'java' });
  const js = /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|import)\s+\S/m.test(text);
  const css = /^[.#:@\w-][^{}\n]{0,200}\{\s*[\w-]+\s*:/.test(text);
  if (ts || js || css || html) tool('code-format', '整理识别到的前端代码', { language: ts ? 'typescript' : js ? 'babel' : html ? 'html' : 'css' });
  if (ts || js) tool('ast-search', '按语法模板检索 JS / TS');
  if (/\bdisplay:\s*(?:inline-)?flex\b/i.test(text)) r.open('css-flex', '打开 Flex 参数预览');
  const gridRow = /^[a-zA-Z_.][\w.-]*(?: +[a-zA-Z_.][\w.-]*)+$/;
  const gridWidth = first.split(/ +/).length;
  if (lines.length > 1 && lines.every(line => gridRow.test(line) && line.split(/ +/).length === gridWidth))
    tool('css-grid', '按区域名预览网格');
  if (/^(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b|^(?:sequenceDiagram|erDiagram)\b/.test(text)) tool('mermaid-diagram', '识别到 Mermaid 图定义');
  if (/^(?:syntax\s*=\s*["']proto[23]["']|message\s+\w+\s*\{)/m.test(text)) tool('proto-diff', '核对 Protobuf 字段兼容性', { target: '' });
  if (/^(?:[a-f0-9]{7,40}\s+)?(?:feat|fix|docs|refactor|perf|test|chore|build|ci|style|revert)(?:\([^)\n]+\))?!?:\s+\S/m.test(text)) tool('changelog', '整理规范化提交标题');
  if (/^[ \t]*(?:\*\.|!\S)/m.test(text)) tool('git-ignore', '识别到 Git 忽略规则', { target: '' });
  if (/(?:\+-|\\-)\s+[\w.-]+:[\w.-]+:[\w.-]+:/.test(text)) tool('maven-path', '识别到 Maven 依赖树');
}

function serviceRules(text: string, first: string, { tool, workspace }: Rules) {
  if (/Preparing:\s*\S/.test(text) && /Parameters:/.test(text)) {
    tool('mybatis-sql', '配对 SQL 预编译语句与参数');
    workspace('logs', '可在日志中心追踪服务输出');
  }
  if (/java\.lang\.Thread\.State:/.test(text)) {
    tool('thread-dump', '识别到 Java 线程状态');
    workspace('logs', '可查看对应服务日志');
  }
  if (/\bGC\(\d+\)\s+Pause\b|\[(?:Full )?GC\b/.test(text)) {
    tool('gc-pauses', '识别到 JVM GC 停顿');
    workspace('logs', '可追踪服务 GC 日志');
  }
  if (/(?:^|\s|\[)(?:INFO|WARN|ERROR|DEBUG|TRACE)(?:\s|\])/.test(text)) workspace('logs', '识别到日志级别');
  if (/^(?:Cache-Control|Age|ETag|Last-Modified|Expires):/im.test(text)) tool('http-cache', '检查 HTTP 缓存响应头');
  if (/^Set-Cookie:/im.test(text)) tool('cookie-context', '检查 Cookie 发送条件');
  if (/^(?:curl\s|(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+)/i.test(text)) workspace('http', '识别到 HTTP 请求');
  if (/(?:^|[\s;{])(?:server\s*\{|upstream\s+[\w.-]+\s*\{|proxy_pass\s+\S+)/m.test(text)) workspace('nginx', '识别到 Nginx 配置指令');
  if (text === first) {
    const args = first.match(/"[^"]*"|'[^']*'|[^\s"']+/g)?.map(token => token.replace(/^(["'])(.*)\1$/, '$2')) || [];
    const [runtime, entry, ...rest] = args;
    if (/^java$/i.test(runtime) && args.includes('-jar')) {
      const index = args.indexOf('-jar');
      if (args[index + 1]) workspace('jar', '登记 Java 服务', { kind: 'jar', jar: args[index + 1], jvm: args.slice(1, index).join('\n'), args: args.slice(index + 2).join('\n') });
    } else if (runtime === 'npm' && (entry === 'start' || (entry === 'run' && rest[0]))) {
      const extra = entry === 'start' ? rest : rest.slice(1);
      workspace('jar', '登记 npm 服务', { kind: 'npm', script: entry === 'start' ? 'start' : rest[0], args: (extra[0] === '--' ? extra.slice(1) : extra).join('\n') });
    } else if (/^(?:python(?:3(?:\.\d+)?)?|node)(?:\.exe)?$/i.test(runtime) && entry && /\.(?:py|[cm]?js)$/i.test(entry)) {
      workspace('jar', '登记解释器脚本', { kind: 'script', script: entry, args: rest.join('\n') });
    }
  }
}

function documentRules(text: string, lines: string[], r: Rules) {
  const { tool, workspace } = r;
  const todo = /^[ \t]*(?:[-*]\s+\[[ xX]\]|[☐✔✘])\s+/m.test(text);
  if (todo) workspace('project-todos', '识别到任务清单');
  const mdTable = lines.some(line => /^\|?[ \t]*:?-{3,}:?[ \t]*\|[ \t]*:?-{3,}/.test(line.trimStart()));
  if (mdTable) tool('markdown-table', '将 Markdown 表格转为分隔文本', { mode: 'delimited' });
  if (todo || mdTable || /^(?:#{1,6}\s+\S|\x60{3}|~~~)/m.test(text)) {
    tool('markdown-lint', '检查 Markdown 文档结构');
    workspace('knowledge', '可在知识库中编辑 Markdown 文档');
  }
  const regex = /^\/([^\r\n]+)\/([dgimsuy]*)$/.exec(text);
  if (regex) tool('regex', '带入正则表达式，填写测试文本', { pattern: regex[1], flags: regex[2] }, '');
  if (/^(?:[\w.-]+:(?:[ \t]|$)|- \S)/m.test(text)) tool('yaml', '将 YAML 转为 JSON', { mode: 'yaml-json' });

  if (lines.length > 1) {
    if (lines.every(line => {
      if (!line.trim()) return true;
      if (!/^\s*[[{]/.test(line)) return false;
      try { JSON.parse(line); return true; } catch { return false; }
    })) tool('json-lines', '将逐行 JSON 记录合为数组');
    tableRules(text, lines[0], r);
  } else if (/^[a-zA-Z][\w-]*$/.test(text) && (/[_-]\w/.test(text) || /^[a-z]+[A-Z]/.test(text))) {
    tool('text', '识别到可转换的命名格式');
  }
}

// Only inspect the explicitly supplied string. File and workspace matches are navigation.
export function detectTools(input: string): Suggestion[] {
  if (input.length > DETECTION_LIMIT) throw new Error('内容识别最多支持 200,000 字符，请直接导入目标工具处理更大的内容。');
  const text = input.trim();
  if (!text && !/[\ufeff\u00a0]/.test(input)) return [];
  const matches = new Map<string, Suggestion>();
  const add = (s: Suggestion) => { if (!matches.has(s.id)) matches.set(s.id, s); };
  const rules: Rules = {
    tool: (id, reason, options, source = input) => add({ kind: 'tool', id, name: toolNames.get(id)!, reason, options, input: source }),
    open: (id, reason) => add({ kind: 'tool', id, name: toolNames.get(id)!, reason }),
    workspace: (id, reason, service, resourceId) => add({ kind: 'workspace', id, name: workspaceNames.get(id)!, reason, ...(service && { service }), ...(resourceId && { resourceId }) }),
  };
  if (text.length <= 100) {
    const key = text.toLowerCase();
    for (const t of tools) {
      if ([t.name, t.english, t.id, ...(intents[t.id] ?? [])].some(name => name.toLowerCase() === key))
        rules.open(t.id, '打开' + t.name);
    }
    for (const w of workspaceModules) if (w.name === text || w.id === key || (w.id === 'jar' && ['后端管理', '替换服务文件', '替换 JAR', '恢复服务备份', '恢复 JAR 备份'].includes(text))) rules.workspace(w.id, '进入' + w.name);
    if (/^linux\s*命令(?:大全|手册)$/i.test(text)) rules.workspace('dev-docs', '查阅 Linux 命令分类文档', undefined, 'folder:Linux 命令大全');
    if (text === '快速链接设置' || text === '快传链接设置') rules.workspace('transfer', '进入局域网快传管理快速链接');
    if (matches.size) return [...matches.values()];
  }
  if (/^(?:跨网转发|服务转发|检测\s*A\s*的能力|B\s*(?:经|通过)\s*A\s*(?:访问|连接)\s*C)$/i.test(text)) rules.workspace('relay', '检测单机部署可用的转发方式');
  if (/^(?:原\s*IP\s*(?:双向)?(?:整机)?互通|跨网互联\s*(?:补录|补全)\s*SSH\s*(?:管理)?档案|B\s*经\s*A\s*补录\s*C|C\s*经\s*A\s*补录\s*B|检测双向互通|双向路由|整机互通|B\s*(?:与|和|、|↔)\s*C\s*(?:(?:双向|双方)?互通|(?:想)?互相访问))$/i.test(text))
    rules.workspace('relay', '按原 IPv4 配置两端路由', undefined, 'routing');
  const triple = /^A\s*[:=：]\s*([\d.]+)[,，\s]+B\s*[:=：]\s*([\d.]+)[,，\s]+C\s*[:=：]\s*([\d.]+)$/i.exec(text)?.slice(1);
  if (triple && new Set(triple).size === 3 && triple.every(ip => /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(ip) &&
      ip.split('.').every(n => Number(n) <= 255) && !/^(0|127)\./.test(ip) && Number(ip.split('.')[0]) < 224))
    rules.workspace('relay', '带入三台设备并识别 A 的接口', undefined, 'routing/new/' + triple.join('/'));
  const relayTarget = /^(?:跨网互联|跨网转发|服务转发|转发)\s+([a-z\d][\w.-]{0,200}):(\d{1,5})$/i.exec(text);
  if (relayTarget && Number(relayTarget[2]) > 0 && Number(relayTarget[2]) <= 65535)
    rules.workspace('relay', '带入目标服务并选择安装位置', undefined, 'new/' + relayTarget[1] + '/' + relayTarget[2]);
  if (/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\u00a0]/.test(input)) rules.tool('invisible', '定位隐形字符与方向控制符');
  if (/^[[{]/.test(text)) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { /* Possibly NDJSON or a different format. */ }
    if (Array.isArray(data) || record(data)) {
      jsonRules(data, text, rules);
      return [...matches.values()];
    }
  }
  const gitCommand = /^git\s+(status|diff|add|restore|reset|commit|log|show|branch|switch|tag|fetch|pull|push|stash|clone|merge)(?:\s|$)/i.exec(text);
  if (gitCommand || /^(?:diff --git |On branch [^\n]+\r?\n|commit [a-f\d]{40}(?:\s|$))/i.test(text)) {
    const command = gitCommand?.[1].toLowerCase();
    const gitMode = command === 'stash' ? 'stash' : ['log', 'show'].includes(command || '') || /^commit /i.test(text) ? 'history'
      : ['branch', 'switch', 'tag', 'fetch', 'pull', 'merge'].includes(command || '') ? 'refs' : 'changes';
    const argument=text.replace(/^git\s+\S+\s*/i,'').trim();
    const unquote=(s:string)=>s.replace(/^(["'])(.*)\1$/,'$2');
    const historyPath = command === 'log' ? /(?:^|\s)--\s+(.+)$/.exec(argument)?.[1] : undefined;
    const resetPath = command === 'reset' && /^(?:HEAD(?:\s+|$))?--(?:\s+|$)/.test(argument);
    const fileCommand = command === 'add' || command === 'diff' || command === 'restore' || resetPath;
    // Match a single literal path. Options or multiple pathspecs still open the appropriate group.
    const stageFlag = command === 'restore' ? /^(?:--staged|-S)(?:\s+|$)/ : /^(?:--staged|--cached)(?:\s+|$)/;
    const staged = resetPath || ((command === 'restore' || command === 'diff') && stageFlag.test(argument));
    const operand = resetPath ? argument.replace(/^HEAD\s+/, '') : staged ? argument.replace(stageFlag, '') :
      command === 'restore' ? argument.replace(/^(?:--worktree|-W)\s+/, '') : argument;
    const afterSeparator = /^--\s+/.test(operand);
    const single = operand.replace(/^--\s+/, '');
    const file = fileCommand && (afterSeparator || (command !== 'diff' && !single.startsWith('-'))) && /^(?:"[^"\n]+"|'[^'\n]+'|[^\s"']+)$/.test(single)
      && single !== '.' && !/[*?]/.test(single) ? unquote(single) : undefined;
    const gitSeed = {
      mode: gitMode as import('./git-api').GitMode,
      ...(command === 'clone' && { clone: argument.startsWith('-') ? '' : unquote(argument) }),
      ...(command === 'push' && { push: true }),
      ...(command === 'merge' && argument && !argument.startsWith('-') && { branch: argument }),
      ...(historyPath && { path: unquote(historyPath) }),
      ...((staged || command === 'commit') && { staged: true }),
      ...(command === 'commit' && { compose: true }),
      ...(command === 'commit' && /^(?:--amend)(?:\s|$)/.test(argument) && { amend: true }),
      ...(file && { path: file }),
    };
    add({ kind: 'workspace', id: 'git', name: workspaceNames.get('git')!, reason: '进入对应的 Git 仓库视图', gitMode,gitSeed });
  }
  if (webAddressRules(text, rules)) return [...matches.values()];
  const lines = text.split(/\r?\n/);
  scalarRules(text, lines, rules);
  colorRules(text, rules);
  codeRules(text, lines, rules);
  serviceRules(text, lines[0], rules);
  documentRules(text, lines, rules);
  const commandHelp = /^(?:sudo\s+)?(ls|df|du|find|grep|awk|sed|tar|chmod|chown|systemctl|journalctl|free|lsblk|lscpu|vmstat|ps|ss|ip|man)(?:\s+[^\n]+)?$/.exec(text);
  if (commandHelp) rules.workspace('dev-docs', '查阅命令的中文用法和示例', undefined, 'search:' + commandHelp[1]);
  if (!matches.size) fileRules(text, rules);
  if (!matches.size || (matches.size === 1 && matches.has('invisible'))) {
    rules.tool('text-stats', '查看文本、字节和行数统计');
    if (input.length <= 500) rules.tool('qr-code', '将这段文字做成二维码');
    rules.tool('hash', '为原文计算摘要');
    rules.tool('hmac', '输入密钥后为原文签名');
  }
  if (text.includes('\n')) {
    rules.tool('diff', '与另一段多行文本比对', { target: '' });
    rules.tool('text', '逐行清理、去重或排序');
  }
  return [...matches.values()];
}
