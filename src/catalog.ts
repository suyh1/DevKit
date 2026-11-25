import { analysisTools } from './analysis/catalog';
import type { ToolId } from './tools';

// Full-page capabilities live beside the offline task catalog, rather than inside it.
// Both the main navigation and README generator read this registry.
export const workspaceModules = [
  { id: 'logs', name: '日志中心', description: '按主机聚合应用服务日志、控制台输出及 Nginx 日志，支持四窗独立追踪、筛选、主机端脱敏、故障时段联查和限量导出。', category: '工作台', badge: '共享' },
  { id: 'monitor', name: '监控中心', description: '定时 HTTP/TCP 检测，可关联项目、本机与远程应用服务或局域网主机，支持维护窗口、故障恢复记录、HTTPS 证书到期提醒与 Webhook 通知。', category: '工作台', badge: '共享' },
  { id: 'http', name: 'HTTP 调试', description: '可局域网共享的 API 项目、接口设计、文档与调试，支持快速请求、multipart 字段与文件上传、环境变量、接口集合回归、响应 Schema 校验及 OpenAPI/Swagger 导入导出。', category: '工作台', badge: '共享' },
  { id: 'projects', name: '项目中心', description: '管理项目入口与环境档案，关联 API、应用服务、Nginx 和监控，查看项目运维总览。', category: '工作台', badge: '共享' },
  { id: 'git', name: 'Git 仓库管理', description: '选择文件批量暂存或按差异块暂存，提交并预览推送，在提交图查看分叉、合并、分支与标签。支持克隆、冲突处理和逐仓库授权。', category: '工作台', badge: '共享' },
  { id: 'dev-docs', name: '开发文档管理', description: '按文件夹收藏与编写开发文档，离线查阅 Linux 命令大全，全文检索中文说明、命令和用法示例。', category: '工作台', badge: '共享' },
  { id: 'knowledge', name: '团队知识库', description: '按目录、项目和标签组织团队知识，在独立 Markdown 写作页编辑、恢复草稿，批量引用文档与实例，搜索正文并分享章节链接。', category: '工作台', badge: '共享' },
  { id: 'project-todos', name: '待办清单', description: '像编辑文本文件一样管理待办，支持分组、标签、快捷键、归档、清单导入导出及局域网共享。', category: '工作台', badge: '共享' },
  { id: 'file-shares', name: '本机文件共享管理', description: '通过共享清单和详情查看状态、端口和文件范围，管理多项只读共享并在网页下载文件或文件夹 ZIP。', category: '工作台', badge: '共享' },
  { id: 'transfer', name: '局域网快传', description: '电脑与手机之间、两台电脑之间均可传送文件。默认凭密码在线直传，需要离线取件或发送文字、链接时可选支持断点续传的主机暂存。支持通过局域网 IP 和端口直接打开快传页。', category: '工作台', badge: '共享' },
  { id: 'mock', name: '接口模拟服务', description: '按 Schema 或模板生成局域网 HTTP 响应，按请求字段切换场景，查看命中原因并重放请求。项目基础地址支持共享数据集的增删改查。', category: '工作台', badge: '共享' },
  { id: 'whiteboard', name: '截图协作白板', description: '在共享截图或空白画布上同步绘制、圈选、连箭头和文字标注，可导出 PNG。', category: '工作台', badge: '共享' },
  { id: 'nginx', name: 'Nginx 配置', description: '按主机分组管理本机和远程 Windows / Linux 实例，支持配置草稿检查、影响确认、备份、应用及失败恢复。', category: '工作台', badge: '共享' },
  { id: 'jar', name: '服务管理', description: '按主机管理 Java JAR、npm 项目、可执行程序和解释器脚本，关联项目中心入口，替换服务文件并管理启停、日志、健康检查和系统自启。', category: '工作台', badge: '共享' },
  { id: 'lan-hosts', name: '局域网主机', description: '管理、发现和导入主机，支持 SSH 终端、SFTP、端口监控和网络唤醒。共享网页可按访客权限直连远程桌面。', category: '工作台', badge: '共享' },
] as const;

export type WorkspaceModule = typeof workspaceModules[number];
export type WorkspaceModuleId = WorkspaceModule['id'];

export function normalizeSharedModuleOrder(value: unknown, defaults: readonly WorkspaceModuleId[] = workspaceModules.map(item => item.id)): WorkspaceModuleId[] {
  const saved = Array.isArray(value) ? value.filter((id): id is WorkspaceModuleId => defaults.includes(id)) : [];
  return [...new Set([...saved, ...defaults])];
}

export const categories = [
  { name: '结构化数据', key: 'data', description: '整理数据与配置文件', ids: [...analysisTools.filter(tool => tool.category === '结构化数据').map(tool => tool.id), 'json', 'yaml', 'xml', 'csv-json', 'json-csv', 'json-path', 'json-schema', 'mock-data', 'env', 'properties', 'json-lines', 'markdown-table'] },
  { name: '代码与查询', key: 'code', description: '转换类型、生成请求代码与整理查询', ids: [...analysisTools.filter(tool => tool.category === '代码与查询').map(tool => tool.id), 'json-code', 'type-json', 'sql', 'code-format', 'http-code', 'http-status', 'semver'] },
  { name: '编码与解析', key: 'encode', description: '编码转换与地址解析', ids: [...analysisTools.filter(tool => tool.category === '编码与解析').map(tool => tool.id), 'base64', 'gzip', 'url', 'html', 'url-inspect', 'query-string', 'unicode', 'qr-code'] },
  { name: '文本与匹配', key: 'text', description: '比较、匹配与清理文本', ids: [...analysisTools.filter(tool => tool.category === '文本与匹配').map(tool => tool.id), 'diff', 'regex', 'text', 'text-stats'] },
  { name: '时间与数值', key: 'utility', description: '时间、数字、子网与地理坐标的计算', ids: [...analysisTools.filter(tool => tool.category === '时间与数值').map(tool => tool.id), 'timestamp', 'radix', 'cron', 'ipv4', 'geo-coordinates'] },
  { name: '安全与标识', key: 'security', description: '摘要、权限、令牌与安全随机数', ids: [...analysisTools.filter(tool => tool.category === '安全与标识').map(tool => tool.id), 'hash', 'password', 'jwt', 'uuid', 'ulid', 'hmac', 'chmod'] },
  { name: '颜色与设计', key: 'color', description: '取色、搭配与视觉探索', ids: [...analysisTools.filter(tool => tool.category === '颜色与设计').map(tool => tool.id), 'color-picker', 'color-convert', 'color-palette', 'color-gradient', 'color-contrast', 'color-mix', 'css-unit', 'css-flex'] },
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
  json: '格式化 压缩 校验 美化 字符串 转义 反转义 formatter pretty stringify parse', yaml: 'yml 配置 config',
  'csv-json': '表格 导入 excel tsv', 'json-csv': '表格 导出 excel tsv',
  'json-code': 'json java typescript ts 实体类 pojo record bean interface 类型 生成',
  'type-json': 'java typescript ts interface record 实体类 转json mock 示例 反向',
  base64: '解码 编码 decode encode', url: '地址 转义 百分号 percent',
  'url-inspect': '地址 链接 参数 query params', html: '实体 转义 escape',
  diff: '差异 比较 对比 compare patch', regex: '正则 匹配 替换 regexp',
  text: '文本 驼峰 去重 排序 大小写 case', timestamp: '日期 时间 unix epoch timezone',
  radix: '进制 二进制 十六进制 bigint hex binary', hash: '文件 批量 SHA256SUMS 摘要 校验 sha checksum digest',
  password: '密码 随机 安全 secret', jwt: '令牌 token header payload', uuid: '标识 唯一 guid',
  'color-picker': '颜色 图片 吸管 picker', 'color-convert': '颜色 hex rgb hsl hsv cmyk',
  'color-palette': '配色 色阶 palette', 'color-gradient': '渐变 gradient css',
  'color-contrast': '对比度 无障碍 wcag', 'color-mix': '混色 插值 blend',
};

export function categoryFor(id: string): string {
  return categories.find(category => category.ids.includes(id))?.name ?? '结构化数据';
}
