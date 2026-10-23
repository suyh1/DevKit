import { ShieldCheck } from 'lucide-react';
import type { Options, ToolId } from './tools';

type Field = { key: string; label: string; entries?: [string, string][]; min?: number; max?: number; placeholder?: string; secret?: boolean };
const fields: Partial<Record<ToolId, Field[]>> = {
  xml: [{ key: 'mode', label: '处理方式', entries: [['format', '格式化'], ['compact', '压缩']] }, { key: 'indent', label: '缩进', entries: [['2', '2 空格'], ['4', '4 空格']] }],
  gzip: [{ key: 'mode', label: '转换方向', entries: [['compress', '文本 → GZip Base64'], ['decompress', 'GZip Base64 → 文本']] }],
  ulid: [{ key: 'mode', label: '处理方式', entries: [['generate', '生成（输入数量）'], ['parse', '解析（每行一个）']] }],
  'code-format': [
    { key: 'language', label: '语言', entries: [['babel', 'JavaScript / JSX'], ['typescript', 'TypeScript / TSX'], ['css', 'CSS'], ['scss', 'SCSS'], ['html', 'HTML']] },
    { key: 'indent', label: '缩进', entries: [['2', '2 空格'], ['4', '4 空格']] },
    { key: 'quotes', label: 'JS 引号', entries: [['single', '单引号'], ['double', '双引号']] },
  ],
  'json-path': [{ key: 'path', label: '路径', placeholder: '$.users[*].name' }],
  'query-string': [{ key: 'mode', label: '转换方向', entries: [['decode', 'Query → JSON'], ['encode', 'JSON → Query']] }],
  'http-code': [{ key: 'style', label: '代码风格', entries: [['fetch', 'Fetch'], ['axios', 'Axios'], ['curl', 'cURL (POSIX shell)']] }],
  cron: [{ key: 'start', label: '起始 ISO 时间', placeholder: '留空使用当前时间' }, { key: 'count', label: '预览数量', min: 1, max: 50 }],
  env: [{ key: 'mode', label: '转换方向', entries: [['decode', '.env → JSON'], ['encode', 'JSON → .env']] }],
  properties: [{ key: 'mode', label: '转换方向', entries: [['decode', 'Properties → JSON'], ['encode', 'JSON → Properties']] }],
  hmac: [{ key: 'key', label: 'UTF-8 密钥', placeholder: '输入密钥', secret: true }, { key: 'algorithm', label: '算法', entries: [['SHA-256', 'SHA-256'], ['SHA-384', 'SHA-384'], ['SHA-512', 'SHA-512']] }, { key: 'format', label: '输出', entries: [['hex', 'HEX'], ['base64', 'Base64']] }],
  unicode: [{ key: 'mode', label: '转换方向', entries: [['encode', '文本 → Unicode'], ['decode', 'Unicode → 文本']] }],
  'css-unit': [
    { key: 'from', label: '输入单位', entries: [['px', 'px'], ['rem', 'rem'], ['em', 'em'], ['vw', 'vw']] },
    { key: 'to', label: '输出单位', entries: [['rem', 'rem'], ['px', 'px'], ['em', 'em'], ['vw', 'vw']] },
    { key: 'base', label: '字体基准 px', placeholder: '16' }, { key: 'viewport', label: '视口宽度 px', placeholder: '1440' },
  ],
  yaml: [{ key: 'mode', label: '转换方向', entries: [['yaml-json', 'YAML → JSON'], ['json-yaml', 'JSON → YAML']] }],
  'csv-json': [
    { key: 'delimiter', label: '分隔符', entries: [['comma', '逗号 CSV'], ['tab', '制表符 TSV']] },
    { key: 'headers', label: '首行', entries: [['first', '作为表头'], ['none', '无表头（数组）']] },
    { key: 'types', label: '字段类型', entries: [['strings', '保留字符串'], ['infer', '推断数字 / 布尔值']] },
  ],
  sql: [
    { key: 'dialect', label: '数据库', entries: [['sql', '标准 SQL'], ['mysql', 'MySQL'], ['postgresql', 'PostgreSQL'], ['sqlite', 'SQLite'], ['transactsql', 'SQL Server'], ['plsql', 'Oracle']] },
    { key: 'keywordCase', label: '关键字', entries: [['upper', '大写'], ['lower', '小写'], ['preserve', '保留原样']] },
    { key: 'indent', label: '缩进', entries: [['2', '2 空格'], ['4', '4 空格']] },
  ],
  diff: [{ key: 'ignoreWhitespace', label: '行首尾空白', entries: [['off', '参与对比'], ['on', '忽略差异']] }],
  password: [
    { key: 'length', label: '长度', min: 4, max: 256 }, { key: 'count', label: '数量', min: 1, max: 100 },
    { key: 'charset', label: '字符集', entries: [['all', '字母 + 数字 + 符号'], ['alnum', '字母 + 数字'], ['hex', '十六进制'], ['digits', '纯数字']] },
    { key: 'ambiguous', label: '易混淆字符', entries: [['exclude', '排除 Il1O0o'], ['keep', '保留']] },
  ],
  json: [{ key: 'mode', label: '处理方式', entries: [['format', '格式化'], ['compact', '压缩']] }, { key: 'indent', label: '缩进', entries: [['2', '2 空格'], ['4', '4 空格']] }],
  'json-code': [{ key: 'language', label: '目标语言', entries: [['ts', 'TypeScript'], ['java', 'Java']] }, { key: 'rootName', label: '根类型名', placeholder: 'Root' }],
  'type-json': [{ key: 'language', label: '输入语言', entries: [['ts', 'TypeScript'], ['java', 'Java']] }, { key: 'rootName', label: '根类型名', placeholder: '留空选择首个类型' }, { key: 'arrayLength', label: '数组元素', min: 0, max: 5 }],
  'json-csv': [{ key: 'delimiter', label: '分隔符', entries: [['comma', '逗号 CSV'], ['tab', '制表符 TSV']] }, { key: 'excelSafe', label: '公式转义', entries: [['on', '开启'], ['off', '关闭（保留原文）']] }],
  html: [{ key: 'mode', label: '处理方式', entries: [['encode', '转义'], ['decode', '解码']] }],
  base64: [{ key: 'mode', label: '处理方式', entries: [['encode', '编码'], ['decode', '解码']] }],
  url: [{ key: 'mode', label: '处理方式', entries: [['encode', '编码'], ['decode', '解码']] }],
  radix: [{ key: 'from', label: '输入进制', entries: [['2', '二进制'], ['8', '八进制'], ['10', '十进制'], ['16', '十六进制']] }, { key: 'to', label: '输出进制', entries: [['2', '二进制'], ['8', '八进制'], ['10', '十进制'], ['16', '十六进制']] }],
  text: [{ key: 'mode', label: '转换方式', entries: [['camel', 'camelCase 小驼峰'], ['pascal', 'PascalCase 大驼峰'], ['snake', 'snake_case 下划线'], ['kebab', 'kebab-case 连字符'], ['upper', '全部大写'], ['lower', '全部小写'], ['dedupe', '逐行去重'], ['sort', '逐行自然排序'], ['trim', '清理空白与空行']] }],
  timestamp: [{ key: 'unit', label: '时间戳单位', entries: [['s', '秒 (s)'], ['ms', '毫秒 (ms)']] }],
  hash: [{ key: 'algorithm', label: '算法', entries: [['SHA-256', 'SHA-256'], ['SHA-384', 'SHA-384'], ['SHA-512', 'SHA-512'], ['SHA-1', 'SHA-1（兼容用途）']] }],
  regex: [{ key: 'pattern', label: '表达式', placeholder: '输入 JavaScript 正则' }, { key: 'flags', label: '标志', placeholder: 'gim' }],
};

export default function ToolOptions({ toolId, options, busy, onChange }: { toolId: ToolId; options: Options; busy: boolean; onChange: (key: string, value: string) => void }) {
  const visibleFields: Field[] = [...(fields[toolId] ?? []), ...(toolId === 'ulid' && options.mode !== 'parse' ? [{ key: 'timestamp', label: '毫秒时间戳', placeholder: '留空使用当前时间' } as Field] : []), ...(toolId === 'json-code' ? options.language === 'java' ? [
    { key: 'javaStyle', label: '生成风格', entries: [['pojo', 'POJO'], ['record', 'Record (Java 16+)']] } as Field,
    { key: 'annotations', label: '字段映射', entries: [['none', '无依赖'], ['jackson', 'Jackson 注解']] } as Field,
  ] : [
    { key: 'tsStyle', label: '类型风格', entries: [['interface', 'interface'], ['type', 'type']] } as Field,
    { key: 'value', label: '输出内容', entries: [['include', '类型 + TS 对象'], ['none', '仅类型定义']] } as Field,
  ] : toolId === 'type-json' && options.language !== 'java' ? [{ key: 'optional', label: '可选字段', entries: [['include', '包含示例'], ['exclude', '忽略']] } as Field] : [])];
  const notice = toolId === 'type-json' ? '生成示例值 · 不执行源码或还原真实数据' : toolId === 'hmac' ? '密钥仅在内存，默认不保存工作区' : toolId === 'http-code' ? '只生成代码，不发送请求' : toolId === 'cron' ? 'UTC · 五字段 Unix Cron' : toolId === 'jwt' ? '仅解码，不验证签名或可信性' : toolId === 'url-inspect' ? '保留重复参数，不访问地址' : toolId === 'uuid' ? '安全随机 UUID v4 · 最多 1,000 个' : '';
  return <div className="options">{visibleFields.map(field => <label className={`option field-${field.key}`} key={field.key}><span>{field.label}</span>{field.entries ? <select disabled={busy} value={options[field.key]} onChange={event => onChange(field.key, event.target.value)}>{field.entries.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select> : <input disabled={busy} type={field.secret ? 'password' : field.min !== undefined ? 'number' : 'text'} autoComplete={field.secret ? 'off' : undefined} spellCheck={field.secret ? false : undefined} min={field.min} max={field.max} step={field.min !== undefined ? 1 : undefined} value={options[field.key]} placeholder={field.placeholder} onChange={event => onChange(field.key, event.target.value)} />}</label>)}{notice && <span className="toolbar-hint"><ShieldCheck size={14} />{notice}</span>}</div>;
}



