import type { Options, ToolId } from './tools';

export type Workflow = 'geography' | 'format' | 'convert' | 'codec' | 'table' | 'lookup' | 'calculate' | 'permissions' | 'inspect' | 'schedule' | 'digest' | 'match' | 'compare' | 'stats' | 'generate' | 'color';
type Experience = { workflow: Workflow; input: string; output: string; action: string; hint: string; placeholder?: string };
const entry = (workflow: Workflow, input: string, output: string, action: string, hint: string, placeholder?: string): Experience => ({ workflow, input, output, action, hint, placeholder });

// Explicit coverage: each tool chooses its interaction according to its data flow.
export const toolExperiences: Record<ToolId, Experience> = {
  'geo-coordinates': entry('geography', '经纬度与文本', '坐标结果', '处理坐标', '格式互转、椭球/球面圆周点和度分秒文本提取，共享精度与复制格式。'),
  json: entry('format', 'JSON 文档', '格式化与结构', '整理 JSON', '整理缩进后浏览结构；数字原文与重复字段保持不变。'),
  xml: entry('format', 'XML 文档', '整理后的 XML', '整理 XML', '按文档结构整理缩进，保留注释、CDATA 与空白约定。'),
  sql: entry('format', 'SQL 查询', '整理后的查询', '整理 SQL', '选择数据库方言后整理查询；此处不会执行 SQL。'),
  'code-format': entry('format', '源代码', '格式化代码', '格式化代码', '选择实际源码语言，再统一缩进和引号。'),
  'json-code': entry('convert', 'JSON 样本', '类型定义', '生成类型', '以样本推断类型，左右对照检查字段和可选性。'),
  'type-json': entry('convert', '类型定义', 'JSON 示例', '生成示例', '选择源语言与根类型，检查嵌套字段生成的示例值。'),
  'json-schema': entry('convert', 'JSON 样本', 'JSON Schema', '推断 Schema', '从样本推断结构；生成后仍需补充业务约束。'),
  'json-path': entry('match', 'JSON 文档', '路径匹配值', '提取路径', '在上方设置字段路径，检查匹配值数组；数字保持原始精度。'),
  'http-code': entry('convert', '请求配置 JSON', '请求代码', '生成请求代码', '配置 method、url、headers、body，生成代码后复制到项目。'),
  yaml: entry('convert', '源配置', '转换后的配置', '转换配置', '按方向转换 JSON 与 YAML，对照键值和数据类型。'),
  env: entry('convert', '源配置', '转换后的配置', '转换配置', '平面字符串配置转换，不展开变量或执行命令。'),
  properties: entry('convert', '源配置', '转换后的配置', '转换配置', '检查 Java 转义、Unicode 与续行的转换结果。'),
  'csv-json': entry('table', 'CSV / TSV 表格', '数据表格', '导入表格', '设置分隔符与表头，以表格检查解析后的行和列。'),
  'json-csv': entry('table', 'JSON 对象数组', '导出表格预览', '转换表格', '合并全部样本的列，检查表格后导出 CSV 或 TSV。'),
  base64: entry('codec', '待转换文本', 'Base64 / 文本', '转换 Base64', '选择编码或解码方向，支持 UTF-8 中文。'),
  url: entry('codec', '参数文本', '转换结果', '转换 URL 编码', '转换 URL 参数中的特殊字符。'),
  html: entry('codec', '文本或实体', '实体转换结果', '转换实体', 'HTML 实体作为文本显示，可直接复制。'),
  unicode: entry('codec', '文本或转义序列', 'Unicode 转换结果', '转换 Unicode', '支持 Unicode 代理对与码点转义。'),
  gzip: entry('codec', '文本或 GZip Base64', '压缩 / 解压结果', '转换 GZip', '文本与 GZip Base64 转换，结果附带长度变化。'),
  'query-string': entry('codec', '参数串或 JSON', '参数转换结果', '转换参数', '保留重复参数；输入参数串，无需完整 URL。'),
  text: entry('codec', '待整理文本', '整理结果', '整理文本', '选择命名格式，或逐行去重、排序和清理空白。'),
  'http-status': entry('lookup', '状态码或关键词', '状态码参考', '查询状态码', '按状态码、英文名称或中文关键词离线检索。', '例如 404、redirect、认证'),
  timestamp: entry('calculate', '时间戳或 ISO 日期', '时间表示', '转换时间', '输入整数时间戳，或带时区的 ISO 日期。', '例如 1767225600 或 2026-01-01T08:00:00+08:00'),
  radix: entry('calculate', '待换算整数', '进制换算', '换算进制', '支持正负整数与大整数，选择输入及输出进制。', '例如 FF（输入进制选择十六进制）'),
  ipv4: entry('calculate', 'IPv4 / CIDR', '子网详情', '计算子网', '输入地址与前缀或连续子网掩码，查看主机范围。', '192.168.10.42/24'),
  'css-unit': entry('calculate', '尺寸值（每行一个）', '尺寸换算表', '换算尺寸', '使用字体基准与视口宽度计算 px、rem、em、vw。', '16px\n24px\n-8px'),
  chmod: entry('permissions', '八进制或 rwx 权限', '权限解释', '解释权限', '输入权限，或勾选矩阵构造权限值；只计算，不修改文件。', '755 或 rwxr-xr-x'),
  jwt: entry('inspect', 'JWT 令牌', '令牌分区', '解码令牌', '分区查看 Header、Payload 与时间声明；仅解码，未验证可信性。'),
  'url-inspect': entry('inspect', '完整 URL', '地址组成与参数', '解析地址', '拆解路径与查询参数，保留同名参数，不访问地址。', 'https://example.com/path?tag=java&tag=ts'),
  cron: entry('schedule', '五字段 Cron', '未来触发时间', '预览时间', '按 UTC 推演触发时间，支持五字段 Unix Cron。', '*/15 9-18 * * 1-5'),
  hash: entry('digest', '待计算摘要的文本', '消息摘要', '计算摘要', '对 UTF-8 文本计算摘要，可与已有摘要逐字符核对。'),
  hmac: entry('digest', '待签名消息', 'HMAC 签名', '计算签名', '输入 UTF-8 密钥与消息，可核对 HEX 或 Base64 签名。'),
  regex: entry('match', '测试文本', '匹配与捕获组', '测试表达式', '先设置表达式与标志，再在高亮结果中检查位置和捕获组。'),
  diff: entry('compare', '原始文本', '差异对照', '对比文本', '并排编辑两份文本，在下方查看逐行差异与导出补丁。'),
  'text-stats': entry('stats', '待统计文本', '文本指标', '统计文本', '从字节、Unicode 字符簇、分词与换行多个维度检查文本。'),
  uuid: entry('generate', '生成配置', 'UUID 列表', '生成 UUID', '设置批量数量，逐项复制安全随机 UUID v4。'),
  password: entry('generate', '密码配置', '密码列表', '生成密码', '设置长度、数量与字符集，逐项复制生成结果。'),
  ulid: entry('generate', '生成配置', 'ULID 列表', '生成 ULID', '批量生成可排序标识，或切换解析查看时间与随机段。'),
  'color-picker': entry('color', '图片与色板', '取色结果', '取色', '通过图片、色板或支持的屏幕吸管选择颜色。'),
  'color-convert': entry('color', '当前颜色', '颜色分量', '转换颜色', '同步查看 HEX、RGB、HSL、HSV 与 CMYK。'),
  'color-palette': entry('color', '配色规则', '调色板', '生成配色', '按色相关系生成色卡，逐色收藏或导出。'),
  'color-gradient': entry('color', '渐变参数', '渐变预览与 CSS', '生成渐变', '调整端点、角度与类型，实时查看渐变。'),
  'color-contrast': entry('color', '前景与背景', '对比度与等级', '检查对比度', '使用文字样张与 WCAG 阈值判断可读性。'),
  'color-mix': entry('color', '混色参数', '色阶与混色', '混合颜色', '调整比例和色彩空间，实时检查插值色阶。'),
};

export function experienceFor(id: ToolId, options: Options): Experience {
  if (id === 'ulid' && options.mode === 'parse') return entry('inspect', 'ULID（每行一个）', '时间与随机段', '解析 ULID', '逐项查看标识中编码的 UTC 时间和随机段。');
  return toolExperiences[id];
}

export function permissionValue(input: string): number | null {
  const text = input.trim();
  if (/^[0-7]{3,4}$/.test(text)) return parseInt(text, 8);
  const symbols = text.length === 10 && /^[-dlcbps]/.test(text) ? text.slice(1) : text;
  if (!/^[r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-]$/.test(symbols)) return null;
  let value = 0;
  for (let group = 0; group < 3; group++) {
    const [r, w, x] = symbols.slice(group * 3, group * 3 + 3);
    value |= ((r === 'r' ? 4 : 0) + (w === 'w' ? 2 : 0) + (/[xst]/.test(x) ? 1 : 0)) << (6 - group * 3);
    if (/[sStT]/.test(x)) value |= 1 << (11 - group);
  }
  return value;
}

export function digestMatches(actual: string, expected: string, format: string): boolean | null {
  if (!expected.trim() || !actual) return null;
  return format === 'base64' ? actual.trim() === expected.trim() : actual.trim().toLowerCase() === expected.trim().toLowerCase();
}
