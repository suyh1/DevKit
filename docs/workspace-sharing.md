# 局域网共享工作台

项目中心、待办清单、本机文件共享管理、Nginx 配置、HTTP 工作台、JAR 管理、监控中心、日志中心及局域网主机可通过同一个共享地址、访问口令和会话使用。客户端只需现代浏览器。JAR、Nginx 和日志的文件与进程属于对应实例所在的主机。HTTP 调试和项目入口探活从共享主机发起，此时 `127.0.0.1` / `localhost` 指共享主机。项目入口链接在当前浏览器中打开。

## 从桌面管理多台主机

顶部“共享”和侧栏“共享栏目”都可打开“排序”。用上移、下移按钮调整，点击“保存顺序”应用，或先点击“恢复默认”再保存。顺序作为本机偏好随设置文件导入导出，访客网页按主机开放的栏目提供导航。

在顶部“共享”或左侧“共享栏目”选择“局域网主机”，即可保存、搜索、编辑和测试远程连接。左侧入口在桌面宽屏向右打开浮层，窄屏在导航抽屉内显示栏目列表。为需要集中管理的主机勾选“JAR 管理”和“Nginx 配置”。两个栏目按本机和各远程主机分组，添加实例时先选目标主机，再选择文件或填写该主机上的绝对路径。开启这两个栏目的局域网共享后，授权网页与桌面看到同一批主机分组，并使用同一套实例表单和操作。

在“局域网共享”中开放“局域网主机”，访客即可搜索已保存的主机，并打开可达的目标 DevKit 工作台。共享面板可分别授予档案管理、连接诊断、SSH 终端、SFTP、主机发现、网络唤醒和远程桌面权限。独立访客获得全局开关与个人设置的交集。首次开放及旧配置升级均从查看权限开始。

网页和桌面编辑同一份档案。网页可提交登录口令或上传 SSH 私钥，主机加密保存并用于两端连接。编辑已有档案时留空可沿用原凭据，网页响应只包含是否配置了凭据的状态。桌面端选用的私钥文件路径仅在桌面展示。新增网页 SSH 档案使用为该档案配置的凭据；修改连接目标时需为新目标配置凭据。通过不可信网络提交凭据时请使用 HTTPS。

网页需同时拥有档案管理和连接诊断权限才能确认或重置 SSH 指纹。终端权限可连接已经确认指纹的主机。重置后网页确认不同指纹时，需为新指纹重新配置凭据。SSH 会话属于当前登录，退出、权限撤销或连接目标、凭据及指纹变更时会关闭对应会话。SFTP 在获得相应权限的终端内选择和下载文件，单文件限 128 MiB。

访客同时获准访问监控中心时，主机卡片显示已有端口监控的状态，并可打开检测历史。监控编辑和运行权限齐备时，还可从主机卡片启用端口监控。获得对应日志分类权限时，可从主机卡片跳到日志中心，筛选该主机的来源。

| 连接方式 | 目标端准备 | 操作范围 |
| --- | --- | --- |
| DevKit 共享 | 开启目标 DevKit 桌面或独立服务的相应栏目，保存目标共享地址和口令 | 复用目标机的实例注册表；中心桌面和网页在目标端权限内操作，也可直接打开目标工作台 |
| SSH | 允许 SSH 执行命令，账号能写入和运行用户目录中的文件。JAR 需要 Java，Nginx 需要 nginx | 集中管理自动部署便携 Node.js 和管理程序，系统自启和进程控制由该账号权限决定 |

SSH 终端支持多会话标签、调整尺寸、交互式命令和断线重连。可使用用户名和密码、本机 SSH Agent、`~/.ssh/id_ed25519` 等默认密钥，或为档案选择本地私钥文件并填写可选的解锁口令。私钥档案保存本机文件路径，解锁口令加密保存。可把已保存的 SSH 主机选作跳板机，最多四级，依次验证每级 SHA-256 指纹。首次连接核对目标指纹，指纹变化时核对服务器后再重置信任。终端需要目标机开启 SSH 服务。

- **测试连接**逐步检查地址解析、TCP 端口、SSH 指纹与认证，或 DevKit 共享认证及已选栏目权限。启用了 SSH 管理栏目时，还会显示识别到的目标平台、部署通道、运行时和 `java` 或 `nginx` 的检查结果。经过跳板机的目标由跳板机解析和连接。
- **分组和导入**可按名称、地址、分组和标签搜索，也可置顶。选择本地 CSV 或 OpenSSH 配置文件，也可粘贴内容，预览后勾选要导入的连接。CSV 需要 `address` 列，可填 `name,mode,user,port,platform,auth,group,tags,pinned,jar,nginx`；多个标签用 `|` 分隔。SSH 配置读取明确的 `Host`、`HostName`、`User` 和 `Port`，用户名缺省时使用本机用户。导入后在主机档案设置凭据、私钥和跳板机。
- **发现主机**按所选网卡直连的 IPv4 网段输入 CIDR 或起止地址，一次最多 256 个地址。通过 TCP 响应及系统邻居缓存发现设备，尝试反向 DNS，显示可取得的 MAC。可把结果填入新建主机表单。MAC 缓存结果表示设备曾被记录。
- **SFTP 文件**在已连接的终端旁打开。从远程目录浏览文件，可输入绝对路径、上传本地文件、下载远程文件。上传遇到同名文件时提示，下载由本机保存对话框选择去向。
- **端口监控**在主机卡片点“启用端口监控”，使用已保存的 SSH 或共享端口，从运行 DevKit 的主机发起直接 TCP 检测。卡片显示最近状态、时间和耗时，“监控历史”打开同一监控的记录。
- **远程桌面和网络唤醒**支持在 Windows 桌面端启动 `mstsc`，共享网页通过 `guacd` 在页面内连接。Windows SSH 档案默认目标端口为 3389，可自行指定。填写设备 MAC 后，可向设备所在直连 IPv4 网段发出唤醒包，目标设备需在硬件和系统设置中启用 Wake-on-LAN。

发行包内置 Windows x64、Linux x64 和 Linux ARM64 的 Node.js 24 LTS。自动识别以远端的实际系统和架构为准，优先用 SFTP 传输，也可通过 SSH 命令的二进制标准输入传输。目标机可离线部署。Node 按版本缓存在目标用户的 `~/.devkit-ssh/runtimes/`，脚本位于 `~/.devkit-ssh/workspaces/`，注册表和备份位于 `~/.devkit-ssh/managed/`。旧运行时保留给已启动的守护进程及自启项。

Linux x64 和 ARM64 使用官方 glibc 发行版，适用于满足官方系统库要求的麒麟 ARM64。Windows 使用系统 PowerShell 和 CIM，SSH 账号需能查询和创建本机进程。其它架构可使用 SSH 会话 PATH 中的 Node.js 24+。 [Node.js 24 平台要求](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list)

独立 Node 服务支持在网页配置和使用连接。也可停掉两端，并复制 `configs/lan-hosts/` 迁移已有档案。凭据密文和存储密钥都在该目录内，桌面引用的私钥文件需与配置分开迁移。

网页操作须满足中心共享的编辑或运行授权。DevKit 类型的目标主机还须授予对应权限。中心汇总各目标 DevKit 的本机实例，避免多层共享重复和循环。有编辑权限时可浏览已选择的远程目标目录，可在“远程绝对目录”输入路径后点击“打开”，或点“上级”返回。主机不可达时仍可使用本机组，当前会话已加载过的远程组会保留上次读取的列表并显示连接异常。

旧版桌面地址簿会导入主机连接。启用 SSH 主机上的对应栏目并验证连接后，可从 JAR 或 Nginx 页面选择“导入旧版 SSH 登记”。已由旧版运行的 Java 应用需先停掉，成功导入后进入目标主机分组。

连接档案、多标签和文件面板参考 Termix、Nexterm 与 Electerm。网段扫描参考 Angry IP Scanner 的地址区间及 NetAlertX 的设备记录。扫描使用 Node TCP 探测和系统邻居表，适用于 DevKit 的 Windows／Linux 桌面版。SFTP 和跳板转发复用现有 SSH 会话实现，每级转发绑定已保存档案的地址和凭据。文件导入只读取连接字段，避免类似 Electerm 的书签命令注入。 [Termix](https://github.com/Termix-SSH/Termix)、[Nexterm](https://github.com/gnmyt/Nexterm)、[Electerm](https://github.com/electerm/electerm)、[Angry IP Scanner](https://github.com/angryip/ipscan)、[NetAlertX](https://github.com/netalertx/NetAlertX)、[ssh2](https://github.com/mscdex/ssh2)、[Electerm 导入安全公告](https://github.com/electerm/electerm/security/advisories/GHSA-jgg9-rw32-44pj)

## 桌面开启

在桌面顶部工具栏的 **局域网共享** 设置监听范围、端口和至少 8 位的独立口令。各服务可任意组合，至少选择一个才能启动。每项服务的访问权限紧随开放开关显示，关闭服务会清除该项授权，再次开启从只读开始。首次配置及旧版升级时，尚未配置的服务默认关闭。

| 服务 | 开放后可查看 | 独立编辑权限 | 独立执行权限 |
| --- | --- | --- | --- |
| 项目中心 | 当前档案、项目和入口 | 保存、导入、删除、恢复档案及项目 | 检测项目入口 |
| 待办清单 | 查看已发布清单、扩展语法和归档，下载 `.todo` 文件 | 新建或导入共享清单，编辑和删除已发布的清单，在任务或续做点下添加多层子任务，完成周期任务时生成下一期 | — |
| 本机文件共享管理 | 已启动并发布的共享及其文件 | — | 下载单个文件或文件夹 ZIP |
| Nginx 配置 | 已登记实例、配置、备份 | 登记/修改/删除实例、新建配置、保存文件 | 检测主机程序、检查、启动、重载、优雅停止 |
| HTTP 调试 | 接口项目、文档和环境 | 保存、恢复接口项目 | 从主机发送请求、取消自己的请求 |
| 日志中心 | 已授权分类的日志及多窗对照 | 不修改日志或配置 | JAR/Nginx分类读取与日志导出分别授权 |
| 监控中心 | 监控配置、状态、历史及故障恢复记录 | 维护暂停的监控、关联和维护窗口 | 启用、暂停、立即检测；修改/删除运行中的监控还需编辑权限 |
| JAR 管理 | 应用列表、状态、自启状态 | 实例、启动参数、环境档案、同目录配置及备份 | Java 检测、启停重启、健康检查、控制台输入、系统自启 |
| 局域网主机 | 已保存的主机清单、分组和标签 | 添加、编辑、移除、导入、置顶 | 诊断、终端、SFTP、直连网段发现、网络唤醒和远程桌面分别授权 |

编辑和执行互不附带授权。例如可只允许 HTTP 调试而禁止修改接口定义，也可只编辑 Nginx 配置而不允许运行命令。所有授权均在主机 API 校验，关闭服务后即使直接调用接口也无法访问。

顶部广播图标显示“未开启”或“共享中”，并打开发布面板。“共享栏目”是导航入口，桌面侧栏向右展开。应用发布设置时，变更监听或全局权限会撤销原会话；单独修改或移除一名访客时，只撤销该访客的会话和在途请求。应用失败会保留原有监听和设置。停止共享也关闭下次自动开启偏好。

旧配置迁移保留原来已经授予的权限，不会扩权：原项目中心仍开放，旧全局编辑只迁移到原已开放的服务，旧 Nginx 运行仍需原先的编辑与运行开关同时成立。面板提示检查迁移权限，之后可独立调整或关闭项目中心。

网页顶部显示当前栏目、权限和访客名称，点击“外观”切换运行模式、主题与风格。窄屏从菜单打开栏目导航。Ctrl+K 或搜索按钮可打开获准访问的栏目和资源，“复制链接”可直达对应项目、JAR / Nginx 实例、API 接口、监控或日志来源。首次打开链接需要登录，主机按当前权限处理请求。切换栏目保留草稿。同一访客以相同授权重新登录可继续编辑。更换访客或权限后会清除该页面会话中的草稿、响应与弹窗。

### 独立访客与 HTTPS

展开“独立访客权限”，为每位访客设置名称和口令，勾选需开放的服务及细项权限。实际权限取访客配置与全局发布权限的交集，作用于整个服务。可关闭通用共享口令，要求访客使用自己的名称和口令。通过“访问审计”查看近期登录、退出、授权撤销、编辑、运行、HTTP 发送及日志导出等事件。审计写入 `configs/sharing-audit.jsonl`，按约 256 KiB 轮转并保留上一份，记录访客、动作、时间和结果。

展开“HTTPS 与证书”，填写主机上的 PEM 证书和私钥绝对路径，并填写证书匹配的域名或 IPv4。访问者使用面板显示的 HTTPS 地址和客户端信任的证书，登录 Cookie 含 `Secure` 属性。可沿用可信局域网内的 HTTP 配置。口令以带盐 scrypt 哈希保存在 `configs/sharing.json`。

## 网页远程桌面

1. 部署带 RDP 支持的 Apache Guacamole `guacd` 1.6。DevKit 桌面共享和独立 Node 服务默认连接本机的 `127.0.0.1:4822`。例如在已有 Docker 的共享主机上运行 `docker run -d --name devkit-guacd -p 127.0.0.1:4822:4822 guacamole/guacd:1.6.0`。使用单独的网关时，在启动 DevKit 前设置 `DEVKIT_GUACD_HOST` 和 `DEVKIT_GUACD_PORT`。启用网关 TLS 时设置 `DEVKIT_GUACD_TLS=true`，并让运行 DevKit 的 Node 或 Electron 信任网关的证书。将 `guacd` 端口限制在 DevKit 可访问的私有网络内。
2. 确认目标已启用远程桌面，并从 `guacd` 所在网络访问目标的 RDP 端口。容器里的回环地址指容器本身，主机档案应填写从网关可达的地址。
3. 在「局域网共享 → 局域网主机」勾选「远程桌面连接」。使用独立访客时，再为指定访客授予同一权限。独立 Node 服务可设置 `DEVKIT_SHARE_LAN_HOSTS=true` 与 `DEVKIT_LAN_HOSTS_RDP=true` 开放。
4. 访客从主机卡片点「连接远程桌面」，填写目标系统用户名、密码及可选域，即可在工作台内用键盘、鼠标或触控操作。登录凭据仅用于当前连接。目标使用自签名证书时，在确认目标身份后可选「首次信任目标证书」，网关会在后续连接核对证书，重新部署网关时需保留其证书信任记录。使用 HTTPS 可保护浏览器到共享主机的连接。

远程桌面只连接已登记的目标，画面和输入通过当前登录会话传输。关闭窗口、退出登录或撤销权限会断开连接。浏览器内连接使用 Guacamole Common JS 和 `guacd`，部署资料见 [Apache Guacamole 文档](https://guacamole.apache.org/doc/gug/configuring-guacamole.html) 和 [组件许可证](apache-guacamole-license.md)。

## 数据与操作

- Nginx 网页是主机工作台的远程表单。编辑访客可以新建配置、登记/修改/删除实例，手动填写主配置、附属文件、运行目录及 nginx 程序的主机路径。网页不弹访问者电脑的文件选择器，也不上传客户端配置文件。路径解析、创建/保存、备份和命令执行均在运行 DevKit 的共享主机完成；删除实例仍只取消登记，不删除配置原文件。程序检测也在主机执行，因此与运行命令一样需要额外运行权限。没有运行权限的状态查看不会隐式启动 nginx -V；若缺少既有程序检测结果则显示待确认。状态未确认停止时拒绝修改 pid / include，避免失去进程识别。独立 Node 服务同样支持远程填写，无需先在桌面登记。运行 nginx 需主机已安装、平台匹配且进程身份可确认。
- 配置保存检查文件哈希，API 项目保存检查 revision。多人同时编辑时，后保存者遇到冲突会收到提示，草稿仍保留；重新读取并核对后再保存，不自动合并。保存接口项目前需使用“刷新API工作区”取得其他人的变更。
- API 项目、接口文档、环境和上次保存备份共用 `configs/http/api-workspace.json`。工作区数据最多 16MB；网页保存请求最多 16.1MB（含封装）。其他管理请求最多 4.1MB，超限时拆分保存。
- 快速请求的集合保存在当前浏览器，不自动共享或从桌面同步；可用接口项目或显式导入/导出转移。响应与会话历史仅在当前页面内存。网页切换模块保留草稿，退出登录会清空页面会话并取消请求。
- HTTP 请求由主机转发，绕过浏览器跨域限制，沿用 HTTP(S)、超时、请求/响应大小及重定向限制。每个会话最多同时 4 个请求，取消接口只影响当前会话；退出登录、停止共享或发送连接断开会取消相应请求。
- 未授予 HTTP 编辑权限时不能保存接口定义；未授予发送权限时不能发出请求。访客仍可选择环境、浏览文档、编辑本地请求草稿及整理浏览器集合。生成 Fetch / Axios / cURL 代码在当前浏览器完成，不发送网络请求。Nginx 源码只读；API 设计入口禁用。页面刷新前仍会提示有未保存草稿或正在运行的请求。
- 仅有 HTTP 文档访问权限时，主机返回经过脱敏的接口定义，隐藏保存的鉴权值、环境变量值及可识别的凭据示例。编辑或发送权限可访问定义中的鉴权和变量值。

## 本机文件共享管理

1. 在桌面端打开“共享栏目 → 本机文件共享管理”，选择“新建共享”。可在同一共享内添加多个文件和文件夹。每项共享使用自己的监听端口。共享清单可按名称、端口、路径或状态筛选，选中后在详情里独立停止、编辑或移除。
2. 点击“打开网页”在系统浏览器浏览。网页可按名称筛选当前文件夹，点击文件名即下载。点击“下载 ZIP”可将文件夹及其子目录打包下载。浏览和下载会跳过符号链接、目录联接、特殊文件、DevKit 配置目录及 Windows 不支持的子项名称。ZIP 包含空文件夹，单次最多 25,000 个条目和 64 层子目录。
3. 默认独立端口仅监听本机。如需直接发链接给局域网设备，勾选“允许局域网通过独立端口访问”，并在主机防火墙放行该端口。在详情的“访问地址”中按所用网络复制对应的 IPv4 链接。完整链接本身就是访问凭据，直接访问使用明文 HTTP。停止共享期间链接不可访问，变更共享范围后使用新链接。
4. 如需登录后下载，勾选“发布到共享工作台”，再在顶部“局域网共享”开放“本机文件共享管理”。有权限的访客在共享页看到已启动且已发布的共享。浏览与下载沿用共享工作台会话和 HTTP(S) 地址，可以只放行共享工作台的端口。共享范围和监听端口由主机桌面端配置。

共享配置保存在 `configs/file-shares.json`，保存后的启用项随 DevKit 下次启动恢复。停止或移除共享只变更发布状态。独立 Node 服务可读取桌面配好的配置，迁移时要让文件路径仍指向主机上要共享的范围。

文件服务参考 Everything HTTP 的独立端口与可选范围，以及 Dufs 的只读浏览和目录 ZIP。Dufs 的发行记录也说明了文件名别名对路径授权的影响。DevKit 复用现有共享会话，并用 yazl 流式生成 ZIP，桌面和独立服务均随包提供 ZIP 依赖。[Everything HTTP](https://www.voidtools.com/support/everything/http/) · [Dufs（MIT / Apache-2.0）](https://github.com/sigoden/dufs) · [Dufs 发行记录](https://github.com/sigoden/dufs/releases) · [yazl（MIT）](https://github.com/thejoshwolfe/yazl)

## 独立 Node 服务

主机需要 Node.js 24+；源码运行先执行 `npm run build`。服务包直接解压启动，无需 npm install。Windows PowerShell 示例：

```powershell
$env:DEVKIT_PROJECT_PASSWORD = 'replace-with-a-separate-password'
$env:DEVKIT_SHARE_PROJECTS = 'true'
$env:DEVKIT_PROJECT_EDIT = 'true'
$env:DEVKIT_PROJECT_PROBE = 'true'
$env:DEVKIT_SHARE_NGINX = 'true'
$env:DEVKIT_NGINX_EDIT = 'true'
$env:DEVKIT_SHARE_HTTP = 'true'
$env:DEVKIT_HTTP_EDIT = 'true'
$env:DEVKIT_HTTP_SEND = 'true'
$env:DEVKIT_NGINX_CONTROL = 'true'
$env:DEVKIT_SHARE_JAR = 'true'
$env:DEVKIT_JAR_EDIT = 'true'
$env:DEVKIT_JAR_CONTROL = 'true'
node server/start.mjs
```

Linux 示例：

```sh
DEVKIT_PROJECT_PASSWORD='replace-with-a-separate-password' \
DEVKIT_SHARE_PROJECTS=true DEVKIT_PROJECT_EDIT=true DEVKIT_PROJECT_PROBE=true \
DEVKIT_SHARE_NGINX=true DEVKIT_NGINX_EDIT=true DEVKIT_NGINX_CONTROL=true \
DEVKIT_SHARE_HTTP=true DEVKIT_HTTP_EDIT=true DEVKIT_HTTP_SEND=true \
DEVKIT_SHARE_JAR=true DEVKIT_JAR_EDIT=true DEVKIT_JAR_CONTROL=true node server/start.mjs
```

首次配置通过下表的 `DEVKIT_SHARE_*` 开关选择至少一个服务，未选服务和未授予权限均关闭。后续启动复用保存的服务与权限；明确设置的环境变量逐项覆盖已有选择，值只接受 `true` / `false`。例如 HTTP 只发送不编辑：首次仅设置 `DEVKIT_SHARE_HTTP=true DEVKIT_HTTP_SEND=true`；已有配置则显式关闭其他服务及 `DEVKIT_HTTP_EDIT`。关闭服务会清除其权限，重新启用时需重新授权。

| 环境变量 | 含义 |
| --- | --- |
| `DEVKIT_SHARE_PROJECTS` / `DEVKIT_PROJECT_EDIT` / `DEVKIT_PROJECT_PROBE` | 项目中心开放 / 编辑 / 入口检测 |
| `DEVKIT_SHARE_PROJECT_TODOS` / `DEVKIT_PROJECT_TODOS_EDIT` | 待办清单开放 / 编辑 |
| `DEVKIT_SHARE_FILE_SHARES` | 向获准访客开放已发布的本机文件共享 |
| `DEVKIT_SHARE_NGINX` / `DEVKIT_NGINX_EDIT` / `DEVKIT_NGINX_CONTROL` | Nginx 开放 / 编辑 / 运行管理 |
| `DEVKIT_SHARE_HTTP` / `DEVKIT_HTTP_EDIT` / `DEVKIT_HTTP_SEND` | HTTP 开放 / 编辑 / 发送 |
| `DEVKIT_SHARE_LOGS` / `DEVKIT_LOGS_JAR` / `DEVKIT_LOGS_NGINX` / `DEVKIT_LOGS_EXPORT` / `DEVKIT_LOGS_RAW` | 日志中心开放 / JAR日志 / Nginx日志 / 导出 / 原始日志 |
| `DEVKIT_SHARE_CERT` / `DEVKIT_SHARE_KEY` / `DEVKIT_SHARE_HOSTNAME` | PEM 证书绝对路径 / PEM 私钥绝对路径 / HTTPS 域名或 IPv4 |
| `DEVKIT_SHARE_MONITOR` / `DEVKIT_MONITOR_EDIT` / `DEVKIT_MONITOR_CONTROL` | 监控中心开放 / 编辑 / 运行 |
| `DEVKIT_SHARE_LAN_HOSTS` | 开放已保存的局域网主机清单 |
| `DEVKIT_LAN_HOSTS_EDIT` / `DEVKIT_LAN_HOSTS_DIAGNOSE` | 管理主机档案 / 测试和诊断连接 |
| `DEVKIT_LAN_HOSTS_TERMINAL` / `DEVKIT_LAN_HOSTS_FILES` | SSH 终端 / 终端内的 SFTP 文件功能 |
| `DEVKIT_LAN_HOSTS_DISCOVER` / `DEVKIT_LAN_HOSTS_WAKE` / `DEVKIT_LAN_HOSTS_RDP` | 发现主机 / 网络唤醒 / 网页远程桌面连接 |
| `DEVKIT_GUACD_HOST` / `DEVKIT_GUACD_PORT` / `DEVKIT_GUACD_TLS` | 网页远程桌面网关地址 / 端口 / TLS，默认 `127.0.0.1` / `4822` / `false` |
| `DEVKIT_SHARE_JAR` / `DEVKIT_JAR_EDIT` / `DEVKIT_JAR_CONTROL` | JAR 开放 / 编辑 / 运行管理（含控制台输入与系统自启） |

可复用已保存的口令哈希。默认 `0.0.0.0:8765`；支持 `HOST`、`PORT`、`DEVKIT_PROJECT_DATA`。

桌面和独立服务不能同时使用同一配置目录。迁移前停止两端，复制 configs；Nginx 配置原文件与程序需要另外迁移并调整路径。端口和防火墙说明见 [项目中心](project-center.md)。

共享面板独立于各模块草稿；关闭有修改的共享设置会提示保留或放弃。启动、停止、失败均会刷新顶部状态，端口占用时保留表单填写。浏览器访客不显示主机共享管理入口。

验证入口：`npm run test:http` 包含共享鉴权、权限、保存冲突、取消隔离及无 npm 依赖的独立服务启动测试。`npm run build` 后运行 `node scripts/smoke-sharing.mjs` 验证真实浏览器登录、接口文档/发送、Schema Worker、配置保存、只读权限与窄屏布局。设置 `DEVKIT_NGINX_TEST_EXECUTABLE` 为测试 nginx 的绝对路径，可额外通过共享接口验证真实检查、启动、重载和停止。

全局入口专项：构建后执行 `node scripts/smoke-desktop.mjs --sharing-settings-only`，覆盖首页入口、模块快捷入口、唯一面板、草稿保护、启动/停止状态、地址复制、端口冲突与响应式主题。

本次交互与权限审查的范围、发现和验证见 [交互一致性审查](interaction-audit.md)。

同端口切换“仅本机/局域网”时，系统无法同时绑定两个重叠地址，会短暂重绑；失败尝试恢复原监听，保留原授权和会话，但既有 TCP 连接可能中断。若其他进程抢占端口导致恢复失败，会报告原因并显示实际停止状态。不同端口应用先验证新监听再关闭旧监听。

门户路由、滚动、复制降级、调试值隔离、运行状态过期和离线退出规则见 [共享网页版说明](portal-browser.md)。专用验证入口为 `npm run test:portal`，使用临时数据和实际 LAN HTTP，覆盖原生点击、滚轮及页面最底部可达性。

JAR 共享与本机共用实例记录、PID 和进程身份校验，远程启动后再次从本机启动会提示已在运行。未授予编辑权限时隐藏环境变量值、JVM 和应用启动参数；输出及应用自身打印的信息仍可查看。控制台允许多人查看，同一时间仅一人持有输入控制权；关闭视图、退出登录或停止共享会释放输入控制权，断线后租约在 20 秒内到期，Java 继续运行。主机运行 JAR 需另装 Java。详见 [JAR 管理](jar-manager.md)。构建后运行 `node scripts/smoke-jar-sharing.mjs` 验证真实 Java、共享权限和双客户端输入。

监控中心由主机定时执行，关闭共享或网页不会停止已启用的监控。关联选择遵循项目中心、JAR 管理及局域网主机的开放状态和访客权限。生命周期与记录保留见 [监控中心说明](monitor-center.md)。

共享栏目在网页侧栏切换，窄屏通过菜单打开导航。日志中心可以独立开放。JAR 文件日志、控制台输出和 Nginx 日志按类别授权，原页面的日志入口同样执行该规则。见[日志中心](log-center.md)。
