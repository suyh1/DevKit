import type { ToolId } from './tools';

// Full-page capabilities live beside the offline task catalog, rather than inside it.
// Both the main navigation and README generator read this registry.
export const workspaceModules = [
  { id: 'http', name: 'HTTP 调试', description: '可局域网共享的API项目、接口设计、文档与真实调试一体化；支持环境变量、响应Schema校验、OpenAPI/Swagger导入导出、Markdown文档和快速请求。', category: '工作台', badge: '共享' },
  { id: 'projects', name: '项目中心', description: '管理项目入口、环境档案与局域网共享。', category: '工作台', badge: '共享' },
  { id: 'nginx', name: 'Nginx 配置', description: '从目录创建或导入主配置与附属文件，可视化编辑并管理 Windows / Linux 主机 Nginx，支持局域网远程填写主机实例与路径、编辑配置、查看日志与授权运行操作。', category: '工作台', badge: '共享' },
  { id: 'jar', name: 'JAR 管理', description: 'Windows / Linux 本机 Java 应用列表，支持 Java 检测、启动/停止/重启、进程与 CPU/内存监视、HTTP/TCP 健康检查、同目录日志轮转、环境档案、崩溃退避重启和系统自启。', category: '工作台', badge: '本机' },
] as const;

export const categories = [
  { name: '结构化数据', key: 'data', description: '整理数据与配置文件', ids: ['json', 'yaml', 'xml', 'csv-json', 'json-csv', 'json-path', 'json-schema', 'mock-data', 'env', 'properties'] },
  { name: '代码与查询', key: 'code', description: '转换类型、生成请求代码与整理查询', ids: ['json-code', 'type-json', 'sql', 'code-format', 'http-code', 'http-status'] },
  { name: '编码与解析', key: 'encode', description: '编码转换与地址解析', ids: ['base64', 'gzip', 'url', 'html', 'url-inspect', 'query-string', 'unicode'] },
  { name: '文本与匹配', key: 'text', description: '比较、匹配与清理文本', ids: ['diff', 'regex', 'text', 'text-stats'] },
  { name: '时间与数值', key: 'utility', description: '时间、数字、子网与地理坐标的计算', ids: ['timestamp', 'radix', 'cron', 'ipv4', 'geo-coordinates'] },
  { name: '安全与标识', key: 'security', description: '摘要、权限、令牌与安全随机数', ids: ['hash', 'password', 'jwt', 'uuid', 'ulid', 'hmac', 'chmod'] },
  { name: '颜色与设计', key: 'color', description: '取色、搭配与视觉探索', ids: ['color-picker', 'color-convert', 'color-palette', 'color-gradient', 'color-contrast', 'color-mix', 'css-unit'] },
];

export const aliases: Partial<Record<ToolId, string>> = {
  'mock-data': 'mock 测试 数据 随机 中文 批量 faker seed schema',
  'geo-coordinates': '地图 经纬度 坐标 度分秒 DMS GPS 圆心 半径 圆周 四方向 geographic latitude longitude WGS84 提取 清洗',
  xml: 'xml 格式化 压缩 配置 svg pom', gzip: 'gzip gunzip 压缩 解压 base64',
  ipv4: 'ipv4 cidr subnet 子网 掩码 网络 广播 主机 ip', chmod: 'chmod unix linux 权限 八进制 rwx setuid sticky',
  ulid: 'ulid 唯一 标识 可排序 时间 生成 解析', 'text-stats': '文本 统计 分析 字数 字节 行数 emoji unicode analyzer',
  'code-format': '前端 格式化 美化 prettier javascript typescript jsx tsx html css scss',
  'json-path': '提取 查询 jsonpath selector', 'json-schema': '结构 校验 schema draft',
  'query-string': '参数 query params searchparams', 'http-code': '接口 请求 fetch axios curl api snippet',
  cron: '定时 调度 crontab schedule', env: '环境 变量 dotenv 配置', properties: 'java spring 配置',
  hmac: '签名 密钥 sha 认证 signature', unicode: '转义 中文 unicode escape',
  'css-unit': '前端 单位 px rem em vw 响应式', 'http-status': '接口 状态码 response status',
  json: '格式化 压缩 校验 美化 formatter pretty', yaml: 'yml 配置 config',
  'csv-json': '表格 导入 excel tsv', 'json-csv': '表格 导出 excel tsv',
  'json-code': 'json java typescript ts 实体类 pojo record bean interface 类型 生成',
  'type-json': 'java typescript ts interface record 实体类 转json mock 示例 反向',
  base64: '解码 编码 decode encode', url: '地址 转义 百分号 percent',
  'url-inspect': '地址 链接 参数 query params', html: '实体 转义 escape',
  diff: '差异 比较 对比 compare patch', regex: '正则 匹配 替换 regexp',
  text: '文本 驼峰 去重 排序 大小写 case', timestamp: '日期 时间 unix epoch timezone',
  radix: '进制 二进制 十六进制 bigint hex binary', hash: '摘要 校验 sha checksum digest',
  password: '密码 随机 安全 secret', jwt: '令牌 token header payload', uuid: '标识 唯一 guid',
  'color-picker': '颜色 图片 吸管 picker', 'color-convert': '颜色 hex rgb hsl hsv cmyk',
  'color-palette': '配色 色阶 palette', 'color-gradient': '渐变 gradient css',
  'color-contrast': '对比度 无障碍 wcag', 'color-mix': '混色 插值 blend',
};

export function categoryFor(id: string): string {
  return categories.find(category => category.ids.includes(id))?.name ?? '结构化数据';
}
