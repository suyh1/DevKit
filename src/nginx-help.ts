import type { NginxNode } from '../shared/nginx.mjs';

export const instanceHints = {
  name: '给这套配置起一个便于识别的名字，例如“本地前端”。一套实例可以包含多个 server、监听端口和代理目标。',
  platform: '选择配置实际运行的系统。Windows 和 Linux 都支持主文件加多个附属文件；可跨系统编辑，运行命令只能在匹配的系统执行。',
  directory: '选择已有目录，用于生成主配置、附属配置和运行子目录；不会覆盖同名配置，也不会自动启动 nginx。',
  mainName: '只填主文件名，例如 nginx.conf，不填目录。它是启动时读取的入口，内部可以配置多个服务。',
  commonName: '只填不同的附属文件名，例如 common_proxy.conf。新模板会在示例服务中 include 此文件，之后可让多个服务共用。',
  port: '仅用于生成第一个示例服务，例如 8080，访问地址为 http://127.0.0.1:8080。范围 1–65535；创建后可增加多个 server 和 listen。导入已有配置无需填写。',
  main: '选择已有主配置的绝对路径，例如 D:/nginx/nginx.conf 或 /etc/nginx/nginx.conf。已有端口、站点和代理规则会按原结构读取，无需重新填写。',
  prefix: '填写原来启动 nginx 时使用的运行目录。pid、error_log、root 等相对路径基于此目录；include 相对主配置所在目录。自动检测后请核对，自定义目录可能被覆盖。',
  executable: '可留空，自动检测 PATH 和常见安装位置；找不到时选择 nginx.exe（Windows）或 nginx（Linux）可执行文件。此处填写程序文件路径。',
  files: '每行一个附属文件的绝对路径，可解析 include 或手动选择。登记只让文件可编辑；实际生效仍需 include。多个服务共用时，修改会影响所有引用它的服务。',
} as const;

export const operationHints = {
  refresh: '重新读取实例、磁盘配置和运行状态；有草稿时先确认是否放弃。',
  add: '登记一套已有配置或在目录中新建主文件与附属文件；一个实例可以包含多个服务。',
  existing: '导入现有文件并保留原内容，不要求重新填写端口或代理目标。',
  create: '在所选目录生成一个示例服务及公共代理文件，不自动启动；之后可添加多个服务。',
  pick: '打开本机文件或目录选择器；取消选择保留原输入。',
  discover: '读取主配置中的 include，递归查找附属文件并加入列表；不改写文件。',
  detect: '查找 nginx 程序并读取安装信息，不启动进程。导入模式会填入程序和运行目录，新建模式保留所选配置目录。',
  settings: '修改名称、文件列表、运行目录或程序路径；运行期间不可改变主文件、程序、运行目录和目标系统。',
  unregister: '只移除工作区中的登记记录，不删除文件、备份，也不停止 nginx。',
  test: '使用磁盘上已保存的配置执行 nginx -t，检查语法和文件可读性；不启动服务，也不验证后端接口是否可用。',
  start: '先检查配置，通过后按主文件启动；一个实例的多个 server 会一起启动。端口占用等问题可查看 error_log。',
  reload: '先检查已保存的配置，再通知运行中的 nginx 重新加载；影响此实例中全部服务。成功后仍需实际访问并检查错误日志。',
  stop: '向此主配置对应的 nginx 发送 quit，等待已有连接处理完毕；此实例中的所有监听端口都会停止。',
  backups: '查看每次保存前自动保留的原文件；载入备份只替换草稿，核对并保存后才写入磁盘。',
  reread: '放弃此实例的草稿并重新读取磁盘文件；有修改时会先确认。',
  saveFiles: '保存所有修改文件，写入前备份并检查外部改动；保存不会自动重载。推荐顺序：保存 → 检查配置 → 启动或重载。',
  fields: '按原层级修改参数；只填参数，不填指令名、分号或注释。Enter 或离开输入框提交到草稿，Esc恢复当前字段。',
  source: '编辑当前文件的完整源码，需要保留指令名、分号与花括号；结构错误时可在这里修复。',
  addDirective: '在当前层级新增完整指令或配置块，只修改草稿；普通指令以分号结束，配置块使用花括号。',
  deleteDirective: '从当前草稿删除此指令；确认并保存文件后才写入磁盘。',
  deleteBlock: '删除当前配置块及其全部子项，只修改草稿；删除 server 会在保存并重载后移除此服务。',
  saveInstance: '保存实例的登记信息，不修改已有配置文件，也不启动或重载 nginx。',
  createInstance: '生成配置和运行子目录并登记实例；已有同名配置会阻止创建，不自动启动 nginx。',
  cancel: '关闭当前表单；有实际改动时先确认，继续编辑可保留输入。',
  loadBackup: '将这份备份载入当前草稿，核对后保存才会覆盖磁盘文件；不会自动重载。',
} as const;

type Help = { detail: string; example?: string; base?: 'prefix' | 'config' };
const fields: Record<string, Help> = {
  user: { detail: 'Linux 工作进程的用户和可选用户组，需对站点文件有读取权限；Windows 不支持此指令。', example: 'www-data' },
  worker_processes: { detail: '处理请求的工作进程数量，可填 auto 或正整数；Windows 通常保留 1。', example: '1' },
  worker_connections: { detail: '每个工作进程允许的最大连接数，包含客户端及代理到后端的连接。', example: '1024' },
  pid: { detail: '保存 nginx 主进程编号的文件，停止和重载靠它定位进程。不同实例使用不同文件，运行期间勿改。', example: 'logs/nginx.pid', base: 'prefix' },
  error_log: { detail: '记录启动失败、代理错误等信息。填写文件路径，可追加日志级别，如 warn 或 error；需保证父目录存在且可写。', example: 'logs/error.log warn', base: 'prefix' },
  access_log: { detail: '记录访问请求。填写日志文件路径，可追加已定义的日志格式名；填写 off 可关闭访问日志。', example: 'logs/access.log', base: 'prefix' },
  include: { detail: '引入附属文件，支持通配符。内容在当前层级生效；公共 location 规则应在每个需要它的 server 中引入。', example: 'common_proxy.conf', base: 'config' },
  listen: { detail: '当前服务接收请求的地址和端口。9011 表示监听该端口；127.0.0.1:9011 仅本机访问。可有多个 server 或多条 listen，需避免端口冲突。', example: '9011' },
  server_name: { detail: '当前站点匹配的域名，多个名称用空格分隔；域名需通过 DNS 或 hosts 指向此电脑。本机测试可填 localhost。', example: 'localhost' },
  root: { detail: '前端构建产物或静态文件所在目录。请求路径会拼接到此目录；Windows 配置路径推荐使用 /，含空格时加引号。', example: '"D:/web sites/dist"', base: 'prefix' },
  alias: { detail: '用此目录替换 location 匹配到的路径前缀，区别于 root 的拼接方式；目录型 location 和 alias 通常都以 / 结尾。', example: '/srv/assets/', base: 'prefix' },
  index: { detail: '访问目录时依次尝试的首页文件名，多个文件用空格分隔；通常与 root 配合使用。', example: 'index.html index.htm' },
  try_files: { detail: '依次查找文件，最后一项是回退地址或状态码。Vue/React 单页应用常回退到 /index.html；保留 $uri 变量。', example: '$uri $uri/ /index.html' },
  proxy_pass: { detail: '此路径转发到的后端地址，填写协议、主机和端口。普通前缀 location /api/ 中，不带末尾 / 保留 /api/；带 / 会替换此前缀。正则、变量等场景请核对官方规则。每条 location 可有不同目标。', example: 'http://127.0.0.1:9002' },
  proxy_set_header: { detail: '转发给后端的请求头，填写“头名称 值”。可重复添加多条；$host、$remote_addr 等是 nginx 变量，保留 $。', example: 'Host $host' },
  client_max_body_size: { detail: '请求体大小上限，影响文件上传；超出返回 413。使用 k/m 等单位，0 表示不限制大小。', example: '100m' },
  keepalive_timeout: { detail: '客户端空闲长连接的保留时间，默认单位秒，可显式写 s；0 关闭长连接。', example: '65s' },
  sendfile: { detail: '是否使用系统文件发送机制，填写 on 或 off；静态站点通常使用 on。', example: 'on' },
  default_type: { detail: '无法根据文件扩展名判断类型时使用的默认 Content-Type。常见类型映射通常由 mime.types 引入。', example: 'application/octet-stream' },
  ssl_certificate: { detail: 'HTTPS 证书链的 PEM 文件路径，通常需配合 listen ... ssl 和证书私钥；文件需可读取。', example: '/etc/nginx/certs/site.pem', base: 'config' },
  ssl_certificate_key: { detail: '与证书配对的 PEM 私钥文件路径，需可读取；不要把私钥内容填写到路径字段。', example: '/etc/nginx/certs/site.key', base: 'config' },
  return: { detail: '直接返回状态码及可选正文或跳转地址。正文含空格时加引号；301/302 可用于重定向。', example: '200 "ok"' },
  proxy_connect_timeout: { detail: '与后端建立连接的超时时间，单位可用 s；后端不可达时可检查地址与网络。', example: '60s' },
  proxy_read_timeout: { detail: '从后端两次读取数据之间允许等待的时间，并非整个请求的总时长。', example: '60s' },
  proxy_send_timeout: { detail: '向后端两次写入数据之间允许等待的时间，并非整个请求的总时长。', example: '60s' },
  proxy_http_version: { detail: '与后端通信使用的 HTTP 版本；按后端要求填写，WebSocket 通常使用 1.1 并配置 Upgrade 请求头。', example: '1.1' },
  client_body_temp_path: { detail: '客户端请求体的临时文件目录，可追加目录分级参数；需可写。', example: 'temp/client_body', base: 'prefix' },
  proxy_temp_path: { detail: '缓存代理响应时使用的临时文件目录，可追加目录分级参数；需可写。', example: 'temp/proxy', base: 'prefix' },
  gzip: { detail: '是否压缩符合条件的响应，填写 on 或 off；可结合 gzip_types 指定内容类型。', example: 'on' },
  gzip_types: { detail: '要压缩的响应 MIME 类型，用空格分隔。', example: 'text/css application/javascript application/json' },
  rewrite: { detail: '按正则重写请求路径，填写正则、替换目标及可选标志；可能改变路由，修改后需实际访问验证。', example: '^/old/(.*)$ /new/$1 permanent' },
};
const blocks: Record<string, Help> = {
  http: { detail: 'HTTP 服务的公共设置，包含多个 server；此层的设置可能被其下多个服务继承。' },
  events: { detail: '工作进程的连接处理设置，通常在这里填写 worker_connections。' },
  server: { detail: '一个前端站点/虚拟服务。在内部配置 listen、server_name、静态目录和代理规则；同一实例可有多个 server。配置块本身通常不填参数。' },
  location: { detail: '当前服务的请求路径匹配规则。例如 /training/；代理目标填在其内部的 proxy_pass。公共文件中的规则会被每个 include 它的服务使用。', example: '/api/' },
  upstream: { detail: '一组后端服务的名称，之后可用 proxy_pass http://名称 引用；内部 server 指定后端地址。', example: 'backend' },
  stream: { detail: 'TCP/UDP 转发配置，与 HTTP 站点层级不同，需 nginx 安装对应模块。' },
  types: { detail: '扩展名与 MIME 类型的映射，常来自 mime.types；例如 text/html 对应 html htm。' },
  map: { detail: '按已有变量的值生成新变量，填写源变量和目标变量；内部配置匹配项与结果。', example: '$http_upgrade $connection_upgrade' },
  if: { detail: '条件匹配表达式，保留括号和变量；指令在此层级的可用性需由 nginx -t 确认。', example: '($request_method = OPTIONS)' },
  limit_except: { detail: '对所列 HTTP 方法之外的请求应用内部访问控制。', example: 'GET' },
};

export function directiveHint(node: Pick<NginxNode, 'name' | 'block'>, parent = ''): Help {
  const ancestry = parent.split('/'), container = ancestry.at(-1);
  if (!node.block && node.name === 'server' && container === 'upstream') return { detail: '负载均衡组中的一个后端节点，填写后端主机和端口，可追加 weight、backup 等参数。', example: '127.0.0.1:9001 weight=2' };
  if (node.name === 'keepalive_timeout' && container === 'upstream') return { detail: '后端连接池中空闲长连接的保留时间，按后端服务要求设置。', example: '60s' };
  if (ancestry.includes('stream')) {
    if (node.block && node.name === 'server') return { detail: '一个 TCP/UDP 转发服务。在内部配置 listen 和 proxy_pass；可有多个 server，配置块本身通常不填参数。' };
    if (node.name === 'listen') return { detail: 'TCP/UDP 服务监听的地址和端口；UDP 需追加 udp 参数。此端口用于连接到 nginx。', example: '127.0.0.1:9011' };
    if (node.name === 'proxy_pass') return { detail: 'TCP/UDP 转发的后端主机和端口，或 upstream 组名；此处填写地址，不加 http:// 协议前缀。', example: '127.0.0.1:9002' };
  }
  return (node.block ? blocks : fields)[node.name] || { detail: node.block ? '此配置块的参数取决于对应模块；保留现有语法，并在其内部添加适用于该层级的指令。' : '此指令可能来自自定义模块或 MIME 映射。仅填写原指令参数，支持引号和变量；具体含义请核对对应模块文档。' };
}

export const operationGuide = [
  ['保存文件', operationHints.saveFiles], ['检查配置', operationHints.test], ['启动', operationHints.start], ['重载', operationHints.reload], ['停止', operationHints.stop],
  ['刷新 / 重新读取', '刷新读取实例、状态和磁盘配置；重新读取只读取当前实例的文件。两者有草稿时都会先确认放弃。'],
  ['备份 / 载入草稿', operationHints.backups], ['实例设置 / 取消登记', `${operationHints.settings} ${operationHints.unregister}`],
  ['字段 / 全文 / 新增 / 删除', `${operationHints.fields} 全文及新增框需填写完整语法；删除只改草稿，保存并重载后才影响运行。`],
] as const;
