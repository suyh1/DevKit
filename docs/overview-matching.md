# 总览内容匹配清单

粘贴后自动识别，手动编辑后点击「识别内容」。也可以直接输入下表的完整工具名、工具 ID 或共享栏目名。名称和操作词用于打开入口，文件名用于推荐文件工具，实际文件在工具内选择。结构化输入按原文带入对应工具，匹配共享栏目后点击进入该栏目，粘贴内容只在本机识别。

## 结构化数据

| 工具或栏目 | 输入特征及用法 |
| --- | --- |
| JSON 格式化（`json`） | JSON 对象或数组 |
| JSON ↔ YAML（`yaml`） | JSON 对象、数组或 YAML 键值、列表 |
| XML 格式化（`xml`） | XML 标签或声明 |
| CSV 转 JSON（`csv-json`） | 带表头和数据行的 CSV、TSV |
| JSON 转 CSV（`json-csv`） | JSON 对象数组 |
| JSON 路径提取（`json-path`） | JSON 对象或数组，打开后指定路径 |
| JSON Schema 生成与校验（`json-schema`） | JSON 对象或数组，可据此推断 Schema |
| 批量 Mock 数据（`mock-data`） | JSON 样本或带 type、properties 的 Schema |
| .env ↔ JSON（`env`） | 环境变量赋值，如 PORT=8080 |
| Properties ↔ JSON（`properties`） | 点分键赋值，如 server.port=8080 |
| JSON Lines ↔ JSON 数组（`json-lines`） | 逐行 JSON 记录或一个 JSON 数组，按输入选择转换方向 |
| Markdown 表格转换（`markdown-table`） | CSV、TSV 或含分隔行的 Markdown 表格 |
| 双表业务键对账（`reconcile`） | CSV、TSV 作为第一张表，再填写业务键和第二张表 |
| CSV 数据体检（`csv-health`） | 带表头的 CSV、TSV，可检查缺列与重复记录 |
| 分类数据透视（`pivot`） | CSV、TSV，打开后选择分组字段 |
| JSON 字段映射（`json-map`） | JSON 对象或对象数组，可设置字段映射 |
| 稳定替名脱敏（`pseudonym`） | CSV、TSV 或 JSON 记录，可指定替名字段 |
| 多语言资源校对（`i18n-diff`） | 含 ICU 占位符的 JSON 语言包 |
| Spring 配置覆盖溯源（`spring-config`） | 含 server、spring 等顶层配置键的 YAML |
| Excel 工作簿检查（`excel-inspect`） | 工作簿文件名，如 report.xlsx |
| Parquet 数据查看（`parquet-view`） | 文件名后缀 .parquet 或 .pq |
| ZIP 清单与比较（`zip-inventory`） | 文件名后缀 .zip 或 .jar |

## 代码与查询

| 工具或栏目 | 输入特征及用法 |
| --- | --- |
| JSON 转类型（`json-code`） | JSON 对象或数组 |
| 类型转 JSON（`type-json`） | TypeScript interface、type 或 Java class、record 声明 |
| SQL 格式化（`sql`） | 以 SELECT、INSERT INTO 等语句开头的 SQL |
| 前端代码格式化（`code-format`） | JS、TS 声明、HTML 标签或 CSS 规则，按语言打开 |
| HTTP 请求代码生成（`http-code`） | 含 HTTP(S) url 的 JSON 请求配置 |
| HTTP 状态码速查（`http-status`） | 三位 HTTP 状态码，如 404 |
| SemVer 版本范围检查（`semver`） | 单个或逐行的语义版本号 |
| MyBatis 日志还原 SQL（`mybatis-sql`） | 配对的 Preparing 和 Parameters 日志 |
| PostgreSQL 执行计划（`pg-plan`） | 含 Plan 和 Node Type 的 PostgreSQL JSON 计划 |
| Maven 依赖来源（`maven-path`） | 含树形前缀和 Maven 坐标的依赖树 |
| Git 忽略规则解释（`git-ignore`） | 通配忽略行或取反规则，如 *.log |
| npm 依赖版本比较（`npm-lock-diff`） | 带 lockfileVersion 及依赖表的 package-lock JSON |
| Git 中文更新说明（`changelog`） | Conventional Commit 标题，可带提交短哈希 |
| SBOM 组件比较（`sbom-diff`） | 带 bomFormat 的 CycloneDX JSON |
| Protobuf 字段兼容性（`proto-diff`） | Protobuf syntax 或 message 声明 |
| JS/TS 语法模板检索（`ast-search`） | JavaScript 或 TypeScript 声明 |
| Java 线程栈分析（`thread-dump`） | 带 java.lang.Thread.State 的线程转储 |
| GC 停顿时间线（`gc-pauses`） | 带 GC 停顿标记的 JVM 日志 |
| Source Map 堆栈定位（`source-map`） | 含 sources 和 mappings 的 v3 Source Map |
| HAR 请求瀑布（`har-waterfall`） | 含 log.entries 的 HAR 文件内容 |
| OpenAPI 兼容性比较（`openapi-diff`） | 含 openapi 和 paths 的 JSON 或 YAML 契约 |
| CPU 采样火焰图（`cpu-profile`） | 含 nodes、samples 的 V8 CPU 采样 |
| 构建体积归因（`bundle-size`） | 含 outputs 的 esbuild 统计或含 assets、modules 的 Webpack 统计 |
| HTTP 缓存计算（`http-cache`） | Cache-Control、Age、ETag 等响应头 |
| Cookie 发送条件（`cookie-context`） | Set-Cookie 响应头 |
| JAR 内容检查（`jar-inspect`） | 文件名后缀 .jar、.war 或 .zip |

## 编码、文本与标识

| 工具或栏目 | 输入特征及用法 |
| --- | --- |
| Base64 编解码（`base64`） | 带编码特征且可解为 UTF-8 的 Base64 文本 |
| GZip 压缩与解压（`gzip`） | H4sI 开头的 GZip Base64 |
| URL 编解码（`url`） | HTTP(S) 地址或含 %HH 转义的参数 |
| HTML 实体转换（`html`） | HTML 标签或 HTML 实体 |
| URL 解析（`url-inspect`） | 完整 HTTP(S) 地址 |
| Query 参数转换（`query-string`） | 查询参数串，如 ?tag=a&tag=b |
| Unicode 转义（`unicode`） | 含反斜杠 u 转义的文本 |
| 离线二维码生成（`qr-code`） | HTTP(S) 链接或 500 字符以内的自由文本 |
| 中文乱码诊断修复（`encoding-repair`） | 文本文件名，如 notes.txt 或 data.csv，打开后选择原文件 |
| 文件签名识别（`file-signature`） | 带扩展名的文件名，如 sample.bin |
| 文本与 JSON 差异（`diff`） | 多行文本或 JSON，作为对比左侧 |
| 正则测试（`regex`） | 正则字面量，如 /订单\d+/g，带入表达式和标志 |
| 文本与命名转换（`text`） | 下划线、短横线、驼峰命名或多行文本 |
| 文本统计（`text-stats`） | 自由文本或格式不明的内容 |
| 隐形字符定位（`invisible`） | 含 BOM、零宽、不换行空格或方向控制字符 |
| Markdown 文档体检（`markdown-lint`） | Markdown 标题、代码围栏、复选框或表格 |
| 哈希计算（`hash`） | 自由文本作为摘要原文，也可输入“计算哈希” |
| 随机密码生成（`password`） | 输入“生成密码”或“随机密码” |
| JWT 解码（`jwt`） | 形似 JWT 的三段编码令牌 |
| UUID 生成（`uuid`） | 输入“生成 UUID” |
| ULID 生成与解析（`ulid`） | 26 位 ULID，打开解析模式 |
| HMAC 签名（`hmac`） | 自由文本作为签名原文，打开后补充密钥，也可输入“HMAC 签名” |
| chmod 权限换算（`chmod`） | 八进制权限或 rwx 权限串 |
| 证书与域名检查（`cert-inspect`） | 证书文件名 .pem、.der、.crt 或 .cer |

## 时间、数值与设计

| 工具或栏目 | 输入特征及用法 |
| --- | --- |
| 时间戳转换（`timestamp`） | 10 位秒、13 位毫秒时间戳或带时区的 ISO 日期时间 |
| 进制转换（`radix`） | 十进制整数或带 0b、0o、0x 前缀的整数 |
| Cron 表达式预览（`cron`） | 五字段 Unix Cron 表达式 |
| IPv4 子网计算（`ipv4`） | IPv4 地址、CIDR 或点分子网掩码 |
| 经纬度工具（`geo-coordinates`） | 经度、纬度数值对，或含方向和度分秒的坐标 |
| 时间区间集合（`intervals`） | 以斜杠分隔的两个带时区 ISO 时刻 |
| 重复日程预览（`rrule`） | iCalendar RRULE 重复规则 |
| GeoJSON 离线地图（`geojson-map`） | 含坐标或要素的 GeoJSON 对象 |
| 颜色格式转换（`color-convert`） | HEX、RGB(A)、HSL(A)、工具支持的颜色名或单色 CSS 声明，如 `color: #36c;`。三、四位纯数字色值请带 `#` |
| 取色器（`color-picker`） | 同一色值作为当前取色值 |
| 调色板与色阶（`color-palette`） | 同一色值作为调色板基色 |
| 渐变生成器（`color-gradient`） | 同一色值作为渐变起点 |
| 颜色对比度（`color-contrast`） | 同一色值作为待比较的前景色 |
| 混色与插值（`color-mix`） | 同一色值作为第一种混合色 |
| CSS 单位换算（`css-unit`） | 带 px、rem、em、vw 的数值或同单位数值列表 |
| CSS Flex 布局预览（`css-flex`） | 含 display: flex 的 CSS 或“弹性布局” |
| CSS Grid 布局（`css-grid`） | 多行等宽的网格区域名，如 head head / side main（用换行分隔） |
| 设计令牌转换（`tokens`） | 含 $value 字段的设计令牌 JSON |
| SVG 图像优化（`svg-optimize`） | SVG 根标签 |
| Mermaid 离线绘图（`mermaid-diagram`） | flowchart、graph、sequenceDiagram 或 erDiagram 图定义 |
| 截图像素对比（`pixel-diff`） | 图片文件名，如 screen.png，打开后选择两张图片 |
| 图片压缩对照（`image-compress`） | 图片文件名，如 photo.jpg |
| 站点图标包（`favicon-kit`） | 图片文件名，如 icon.png |

## 共享栏目

带有共享栏目片段的 HTTP(S) 链接也会推荐对应栏目，并保留链接指向的资源。例如，`#jar/服务ID` 定位到服务所在页，`#logs/instance%3A服务ID` 打开服务日志，`#nginx/主机ID%3A实例ID` 和 `#lan-hosts/主机ID` 分别定位到实例和主机。

| 工具或栏目 | 输入特征及用法 |
| --- | --- |
| Git 仓库管理（`git`） | `git status`、`git diff` 或补丁打开工作区。`git add -- "文件路径"` 定位未暂存文件，`git restore --staged 路径`、`git reset HEAD -- 路径` 和 `git diff --cached -- 路径` 定位已暂存差异，`git restore --worktree -- 路径` 定位未暂存差异；命令含多个路径时打开对应分组。`git commit` 定位暂存区并在可提交的工作树中打开提交说明窗口，`git commit --amend` 在已有提交时带入上次提交说明。`git log --graph --decorate --all`、`git log`、`git show` 或完整提交记录打开提交历史；分支、标签、获取与拉取命令打开分支与同步；`git merge topic` 预选目标分支，`git push` 打开推送预览，`git log -- "文件路径"` 带入文件历史，`git clone 地址` 打开桌面克隆弹窗并预填地址。`git stash` 打开贮藏。命令只决定打开的视图。粘贴 `#git/<仓库 ID>` 结尾的共享链接，可选中已登记的对应仓库。 |
| 日志中心（`logs`） | 带日志级别的记录、MyBatis、Java 线程或 GC 日志 |
| 监控中心（`monitor`） | HTTP(S) 地址或 TCP 检测地址 |
| HTTP 调试（`http`） | HTTP(S) 地址、cURL、HTTP 请求行、请求配置或 OpenAPI/Swagger |
| 项目中心（`projects`） | HTTP(S) 项目入口或项目中心导出 JSON |
| 开发文档管理（`dev-docs`） | 输入「Linux 命令大全」打开手册；`df -h`、`ls -la`、`journalctl -b` 等常用命令带入全文搜索，定位对应章节。文档链接直接打开指定文档或章节。 |
| 团队知识库（`knowledge`） | Markdown 文档 |
| 待办清单（`project-todos`） | Markdown 复选框或 ☐、✔、✘ 任务行 |
| 本机文件共享管理（`file-shares`） | 本地绝对路径或 UNC 共享路径 |
| 跨网互联（`relay`） | “跨网互联”“网段互联”“一键接入网段”“取消网段部署”“局域网互通”“B 通过 A 访问 C”“访问 A 可达的所有网段”打开网段模式；“A=192.0.2.1”“跳板机 A 192.0.2.1”“跨网互联 192.0.2.1”预填 A。单独的 IPv4、CIDR 或普通 SSH 命令保留原有主机或本机工具匹配。“检测 A 的能力”“服务转发”打开服务模式，“跨网转发 c.example:8080”预填目标。“B 和 C 想互相访问”“B、C 双向互通”“原 IP 整机互通”“检测双向互通”“双向路由”“跨网互联补录 SSH 管理档案”“B 经 A 补录 C”“C 经 A 补录 B”打开双主机方案；“A=192.0.2.1 B=192.0.2.2 C=192.0.2.6”带入三个地址。 |
| 局域网快传（`transfer`） | 文件名、本地路径或 HTTP(S) 链接。输入“快速链接设置”或“快传链接设置”可进入该栏目，在标题栏管理快传端口。 |
| 接口模拟服务（`mock`） | OpenAPI/Swagger 定义或 JSON Schema |
| 截图协作白板（`whiteboard`） | 图片文件名，如 screenshot.png |
| Nginx 配置（`nginx`） | server、upstream 配置块或 proxy_pass 指令 |
| 服务管理（`jar`） | JAR、可执行程序或脚本路径，java -jar、npm run、python3 main.py 或 node server.mjs 启动命令；打开相应登记表单并带入入口、JVM 参数、npm 脚本或应用参数。输入“替换服务文件”“替换 JAR”“恢复服务备份”或“恢复 JAR 备份”打开服务列表，从中选择已登记实例 |
| 局域网主机（`lan-hosts`） | 单个 IPv4 地址可带入 SSH 档案；SSH、SFTP、VNC、RDP、Telnet、FTP 和 FTPS 连接 URI（如 `vnc://[::1]:5901`、`sftp://dev@host:2222`）、`新建 VNC 会话`、`ssh -p 2222 dev@host` 或 `sftp -P 2222 dev@host` 打开对应的新建表单并预填地址、端口及适用的用户名。`SFTP 上传文件夹`、`SFTP 文件传输` 或 `FileZilla` 打开 SFTP 档案，连接后进入双栏文件工作区。`vnc desk.local:1` 按显示号预填 TCP 端口 5901。`rdp://desk.local:3390` 可预填远程桌面的自定义端口。双击已保存的主机可直接打开其协议会话，右键或点行末「…」可查看完整地址和管理操作。进入会话后可传长文本；`vnc://desktop.local` 走桌面 VNC 的位图协商，`rdp://desktop.local` 的网页连接可使用已启用的会话中转盘。例如 `telnet switch.local 2323` 带入终端端口，`ftps://dev@nas/backups` 带入隐式 TLS 和起始目录，`COM3 115200` 或 `/dev/ttyUSB0` 带入桌面串口设备及波特率。CIDR 进入子网计算。 |
