import type { ToolId } from './tools';

// Full-page capabilities live beside the offline task catalog, rather than inside it.
// Both the main navigation and README generator read this registry.
export const workspaceModules = [
  { id: 'logs', name: '日志中心', description: '按主机聚合 JAR 文件日志、控制台输出及 Nginx 日志，支持四窗独立追踪、筛选、主机端脱敏和限量导出。', category: '工作台', badge: '共享' },
  { id: 'monitor', name: '监控中心', description: '定时 HTTP/TCP 检测，可关联项目、本机与远程 JAR 或局域网主机，支持维护窗口、故障恢复记录与 Webhook 通知。', category: '工作台', badge: '共享' },
  { id: 'http', name: 'HTTP 调试', description: '可局域网共享的 API 项目、接口设计、文档与调试，支持快速请求、multipart 字段与文件上传、环境变量、响应 Schema 校验及 OpenAPI/Swagger 导入导出。', category: '工作台', badge: '共享' },
  { id: 'projects', name: '项目中心', description: '管理项目入口、环境档案与局域网共享。', category: '工作台', badge: '共享' },
  { id: 'project-todos', name: '待办清单', description: '像编辑文本文件一样管理待办，支持分组、标签、快捷键、归档、清单导入导出及局域网共享。', category: '工作台', badge: '共享' },
  { id: 'file-shares', name: '本机文件共享管理', description: '通过共享清单和详情查看状态、端口和文件范围，管理多项只读共享并在网页下载文件或文件夹 ZIP。', category: '工作台', badge: '共享' },
  { id: 'nginx', name: 'Nginx 配置', description: '按主机分组管理本机和远程 Windows / Linux 实例，支持配置草稿检查、影响确认、备份、应用及失败恢复。', category: '工作台', badge: '共享' },
  { id: 'jar', name: 'JAR 管理', description: '按主机渐进加载 Java 应用，窄屏使用卡片，SSH 自动部署便携运行时，支持启停重启、日志、健康检查、系统自启和配置编辑。', category: '工作台', badge: '共享' },
  { id: 'lan-hosts', name: '局域网主机', description: '管理、发现和导入主机，支持 SSH 终端、SFTP、端口监控和网络唤醒。共享网页可按访客权限直连远程桌面。', category: '工作台', badge: '共享' },
] as const;

export type WorkspaceModule = typeof workspaceModules[number];
export type WorkspaceModuleId = WorkspaceModule['id'];

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
