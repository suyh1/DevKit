import type { NginxNode } from '../shared/nginx.mjs';

export const instanceHints = {
  name: '给这套配置起一个便于识别的名字，例如“本地前端”。一套实例可以包含多个 server、监听端口和代理目标。',
  platform: '选择配置实际运行的系统。Windows 和 Linux 都支持主文件加多个附属文件；可跨系统编辑，运行命令只能在匹配的系统执行。',
  directory: '选择已有目录，用于生成主配置、附属配置和运行子目录；不会覆盖同名配置，也不会自动启动 nginx。',
  mainName: '只填主文件名，例如 nginx.conf，不填目录。它是启动时读取的入口，内部可以配置多个服务。',
  commonName: '只填不同的附属文件名，例如 common_proxy.conf。新模板在示例服务中 include 此文件，之后可让多个服务共用；初始 /api/ 代理到 http://127.0.0.1:9000，需按实际后端调整。',
  port: '仅用于生成第一个示例服务，例如 8080，访问地址为 http://127.0.0.1:8080。范围 1–65535；创建后可增加多个 server 和 listen。导入已有配置无需填写。',
  main: '选择已有主配置的绝对路径，例如 D:/nginx/nginx.conf 或 /etc/nginx/nginx.conf。已有端口、站点和代理规则会按原结构读取，无需重新填写。',
  prefix: '填写原来启动 nginx 时使用的运行目录，也可使用自定义配置目录。pid、error_log、root 等相对路径基于此目录，include 基于主配置所在目录。检查/启动/重载会自动补齐日志、PID、临时及缓存等运行目录；自动检测后请核对自定义目录。',
  executable: '可留空，自动检测 PATH 和常见安装位置；找不到时选择 nginx.exe（Windows）或 nginx（Linux）可执行文件。此处填写程序文件路径。',
  files: '每行一个附属文件的绝对路径，可解析 include 或手动选择。登记只让文件可编辑；实际生效仍需 include。多个服务共用时，修改会影响所有引用它的服务。',
} as const;

type Help = { detail: string; example?: string; base?: 'prefix' | 'config' };
const fields: Record<string, Help> = {
  user: { detail: 'Linux 工作进程的用户和可选用户组，需对站点文件有读取权限；Windows 不支持此指令。', example: 'www-data' },
  worker_processes: { detail: '处理请求的工作进程数量，可填 auto 或正整数；Windows 通常保留 1。', example: '1' },
  worker_connections: { detail: '每个工作进程允许的最大连接数，包含客户端及代理到后端的连接。', example: '1024' },
  pid: { detail: '保存 nginx 主进程编号的文件，停止和重载靠它定位进程。不同实例使用不同文件，运行期间勿改。', example: 'logs/nginx.pid', base: 'prefix' },
  error_log: { detail: '记录启动失败、代理错误等信息。填写文件路径，可追加日志级别，如 warn 或 error；检查/启动前自动补齐父目录，仍需有写入权限。', example: 'logs/error.log warn', base: 'prefix' },
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
  client_body_temp_path: { detail: '客户端请求体的临时文件目录，可追加目录分级参数；检查/启动/重载时自动补齐，需有写入权限。', example: 'temp/client_body', base: 'prefix' },
  proxy_temp_path: { detail: '缓存代理响应时使用的临时文件目录，可追加目录分级参数；检查/启动/重载时自动补齐，需有写入权限。', example: 'temp/proxy', base: 'prefix' },
  fastcgi_temp_path: { detail: 'FastCGI响应的临时文件目录；检查/启动/重载时自动补齐，可追加目录分级参数，需有写入权限。', example: 'temp/fastcgi', base: 'prefix' },
  uwsgi_temp_path: { detail: 'uWSGI响应的临时文件目录；检查/启动/重载时自动补齐，可追加目录分级参数，需有写入权限。', example: 'temp/uwsgi', base: 'prefix' },
  scgi_temp_path: { detail: 'SCGI响应的临时文件目录；检查/启动/重载时自动补齐，可追加目录分级参数，需有写入权限。', example: 'temp/scgi', base: 'prefix' },
  proxy_cache_path: { detail: '代理缓存目录及缓存区参数。固定目录会自动补齐；keys_zone定义缓存区名与内存大小，实际启用缓存还需proxy_cache。', example: 'cache/proxy levels=1:2 keys_zone=app:10m', base: 'prefix' },
  fastcgi_cache_path: { detail: 'FastCGI缓存目录及缓存区参数。固定目录会自动补齐；实际启用缓存还需fastcgi_cache。', example: 'cache/fastcgi keys_zone=app:10m', base: 'prefix' },
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
