# home 项目非 Nginx 功能清单与 DevKit 对照

参考路径：`D:/workspace/HLD/front/code/home`。

本轮只核对本地源码、界面入口、Store 与后端实现，不迁移功能、不运行服务探活、不发送 HTTP 请求、不执行构建或安装。没有修改 home 项目。这里的“已实现”表示源码中存在接线与实现，不代表本轮完成了运行验收。

排除范围：Nginx 工作台、nginx.conf 解析/生成/编辑/写入、代理转发配置、Nginx 路径和日志配置、location / WebSocket 片段，以及依赖这些配置语义的迁移和交付逻辑。

## 1. 项目级功能

| 功能 | 排除 Nginx 后保留的能力 | 当前 DevKit |
| --- | --- | --- |
| 项目入口管理 | 服务新增、编辑、复制、删除；名称、编码、协议、IP、端口、路径、分组、可启停的 Query 参数；URL 预览、打开、复制 | 无服务入口管理模块 |
| 服务筛选与批量操作 | 名称/IP/端口搜索、分组/启停筛选、分组展示、每行卡片数、批量启停、复制入口清单 | 无对应模块 |
| 手动服务探活 | 单个服务探活、批量探活当前已启用项目、在线/异常状态与检测信息 | 无；需要主动网络访问 |
| 本机 IP | 读取后端所在机器的本地 IP，应用到服务地址 | 无；需明确桌面本机与远端后端的区别 |
| 通用配置管理 | 配置新增、复制、重命名、描述、选择、删除、恢复内置配置、导入导出；后端持久化/浏览器存储 | 已有偏好与工作区文件，但没有项目配置档案模块 |
| 环境档案 | 名称、类型、主机/IP、系统、Node 版本、配置目录、负责人、备注、更新时间；新增/删除/保存 | 无；与 HTTP 环境变量是两套不同功能 |
| 运行状态 | 存储模式、Node 版本、平台/架构、PID、运行时长、本地 IP、配置/环境/备份目录 | 无独立诊断页 |
| 数据备份与恢复 | 创建带名称/备注/时间的快照、列表、恢复、删除 | 已有工作区导入导出，尚无快照中心 |
| 通用界面 | 深浅主题、分区导航、按需加载、代码编辑器、差异编辑器、复制/文件操作、HTTP 面板拖动分栏 | DevKit 已有多数工作台基础能力 |

注意：home 的服务和配置模型混有 Nginx 字段。后续如参考这些模块，只提取通用入口、配置、环境与快照机制，不整体照搬模型。项目入口是打开服务地址，不是启动/停止操作系统进程；“启停”指配置中的启用状态。

源码入口：[App.vue](D:/workspace/HLD/front/code/home/src/App.vue:12)、[ServiceLauncher.vue](D:/workspace/HLD/front/code/home/src/components/ServiceLauncher.vue:1)、[ServiceEditor.vue](D:/workspace/HLD/front/code/home/src/components/ServiceEditor.vue:22)、[EnvironmentCenter.vue](D:/workspace/HLD/front/code/home/src/components/EnvironmentCenter.vue:1)、[RuntimeStatusCenter.vue](D:/workspace/HLD/front/code/home/src/components/RuntimeStatusCenter.vue:1)、[BackupCenter.vue](D:/workspace/HLD/front/code/home/src/components/BackupCenter.vue:1)。

## 2. 工具箱：35 个非 Nginx 入口

源码注册表共有 36 个入口，移除 `nginx-location` 后为 **35 个**，分为六组。一个入口可能包含多个子功能，不与 DevKit 的工具数一一对应。

“已有”表示主要能力重叠；“增强”表示当前只有部分能力；“新增”表示当前没有对应的完整工具或模块。

| 编号 | home 工具 | 具体能力 | 相对 DevKit v1.4 |
| ---: | --- | --- | --- |
| 1 | JSON 工具 | 格式化、压缩、语法校验 | 已有 |
| 2 | 实体类生成器 | JSON → TS interface/type、Java；通用命名规则；TS readonly/export；Java 包名、Lombok、访问器、List/Set、日期风格；切换语言保留配置 | 增强：基础生成已有，可补这些选项 |
| 3 | 配置格式互转 | JSON/YAML/TOML 格式识别与转换，另有文本输入/输出模式 | 增强：新增 TOML 与统一入口 |
| 4 | OpenAPI 小工作台 | JSON/YAML 文档解析、接口列表、将选中接口转为 HTTP 调试请求 | 新增 |
| 5 | JSON Schema | Schema + 样例双输入校验、错误路径/关键字/原因；样例推断 Schema | 增强：当前只有 Schema 推断 |
| 6 | Mock 数据 | 从 Schema、JSON 示例或 TS 类型生成 1–50 份 Mock；可送入 HTTP Body | 新增：当前类型转 JSON 为声明类型的示例值，不是这套 Mock 流程 |
| 7 | JSON Diff | 按结构生成字段路径及新增/删除/修改摘要，配合差异编辑器 | 增强：当前是文本行差异 |
| 8 | 大小写转换 | camel/Pascal/kebab/snake/CONSTANT/Title 等命名结果 | 已有，可补输出风格 |
| 9 | URL 工具 | 编码/解码、Query ↔ 对象 | 已有 |
| 10 | URL 解析器 | 协议、Host、Path、Query、Hash 等拆解 | 已有 |
| 11 | Base64 | 文本编码/解码 | 已有 |
| 12 | 编码进制工具 | Base32、Base58、Unicode 转义、文本 ↔ Hex、ASCII 查看、整数进制 | 增强：新增 Base32/Base58、文本 Hex 与 ASCII 查看 |
| 13 | HTML 实体 | 转义与反转义 | 已有 |
| 14 | 时间戳 | 秒/毫秒/ISO/本地时间、填入当前毫秒 | 已有 |
| 15 | JWT 解码 | Header/Payload 本地只读解析 | 已有 |
| 16 | Hash/HMAC | SHA-1/256/384/512 摘要与 HMAC 结果 | 已有主要能力，可补 HMAC SHA-1 兼容项 |
| 17 | 正则测试 | 匹配位置、匹配结果、捕获组 | 已有 |
| 18 | 颜色工具 | 格式转换、颜色选择器、调色板、对比度 | 已有，当前另有图片取色/渐变/混色 |
| 19 | UUID | 批量 UUID v4 | 已有 |
| 20 | 随机字符 | 长度、数量、自定义字符表 | 增强：当前密码生成主要为预设字符集 |
| 21 | CSS 单位 | px/rem 与根字号换算 | 已有，当前另有 em/vw |
| 22 | chmod | rwx、八进制、特殊位与命令示例 | 已有 |
| 23 | HTTP 调试台 | 请求、集合、环境变量、历史、实际发送、响应与断言 | 新增完整模块 |
| 24 | cURL 转换 | 解析 cURL，生成 Fetch/Axios，导入 HTTP 调试台 | 增强：当前从 JSON 配置生成代码，不解析 cURL |
| 25 | 端口检测 | 批量检查后端本机端口占用、Windows PID/进程信息、处理命令建议 | 新增；命令只是建议，不直接杀进程 |
| 26 | 表格格式互转 | CSV/TSV/Markdown Table 之间转换、源格式自动识别 | 新增 Markdown 表格与直接互转；当前 CSV ↔ JSON 已有 |
| 27 | CSV 清洗 | 去空行、去重、单元格处理/列裁剪、清洗摘要 | 新增 |
| 28 | SQL INSERT/JSON | JSON 数组生成 INSERT，受限 INSERT 解析回 JSON | 新增；不等于任意 SQL 解析/执行 |
| 29 | CSS Grid | 配置列、行、gap、minmax，预览并生成 CSS | 新增 |
| 30 | Flex 布局 | direction、wrap、主轴/交叉轴对齐、gap 与预览/CSS | 新增 |
| 31 | Box Shadow | 多层阴影、调整顺序、增删、预览/CSS | 新增 |
| 32 | Border Radius | 统一/四角圆角、预览/CSS | 新增 |
| 33 | .env 整理比较 | 排序、重复键处理、左右新增/删除/变化比较 | 增强：当前是 .env ↔ JSON |
| 34 | .gitignore 模板 | Node、Vue/Vite、Java/Maven、Gradle、IDE、OS、日志/构建产物模板合并去重 | 新增 |
| 35 | Docker Compose | 服务名、镜像、端口、环境变量、卷映射的 YAML 片段 | 新增；只生成文本，不启动容器 |

源码注册与接线：[FrontendToolbox.vue](D:/workspace/HLD/front/code/home/src/components/FrontendToolbox.vue:1586)。实体生成选项：[entityGenerator.ts](D:/workspace/HLD/front/code/home/src/utils/entityGenerator.ts:762)。算法：[frontendTools.ts](D:/workspace/HLD/front/code/home/src/utils/frontendTools.ts:177)。

## 3. HTTP 调试台的细分功能

这部分比当前 DevKit 的“请求代码生成”范围大，建议作为一个完整模块评估。

| 区域 | 已接入的功能 |
| --- | --- |
| 请求组织 | 集合新增/重命名/删除；请求新增/复制/删除/排序；文件夹归组、搜索；保存与未保存状态；集合/环境 JSON 导入导出 |
| 请求编辑 | GET/POST/PUT/PATCH/DELETE/HEAD；URL；可启停的 Query、Headers；none/JSON/text Body；GET/HEAD 忽略 Body |
| 鉴权与 Cookie | Bearer、Basic、Header/Query API Key；逐行 Cookie 配置 |
| 环境变量 | 多环境切换、变量插入 URL/Headers/Query/Body、引用检查、缺失变量提示、秘密变量显隐标记 |
| 执行 | 请求预览、后端实际代发、自定义超时、取消、按顺序运行集合 |
| 断言 | 状态码相等、正文包含、响应头包含，显示通过/失败结果 |
| 响应 | 状态码、响应头、耗时、体积、正文、JSON 排版/原文、搜索、复制、截断提示、执行时间记录 |
| 历史 | 搜索、方法/结果过滤、置顶、重放、删除、清空/保留置顶、与历史记录比较 |
| 工具联动 | 从 cURL/OpenAPI 导入请求、Mock 填入 Body、复制为 cURL/Fetch/Axios |
| 布局 | 请求索引/编辑/上下文区域拖动调宽，Monaco 编辑 |

边界：未看到 multipart 文件上传、WebSocket 客户端、任意前置/后置脚本、自动提取响应变量等完整能力，不把它当成这些功能均齐备的 Postman 替代品。秘密变量遮罩不代表磁盘加密。取消界面的等待与保证服务端/目标服务器全部停止，后续迁移需分别验证。

源码：[HttpRequestWorkbench.vue](D:/workspace/HLD/front/code/home/src/components/HttpRequestWorkbench.vue:1)、[httpLabStore.ts](D:/workspace/HLD/front/code/home/src/stores/httpLabStore.ts:681)、[httpLab.ts](D:/workspace/HLD/front/code/home/src/types/httpLab.ts:1)、[server/httpLab.js](D:/workspace/HLD/front/code/home/server/httpLab.js:919)。

## 4. 后端存在，但当前没有独立界面入口的通用能力

| 能力 | 当前状态 |
| --- | --- |
| 项目检查 | 白名单运行 test/typecheck/build/audit，返回执行结果；当前 Vue 页面未找到调用入口，依赖项目工作目录与 Node/npm，audit 可能联网 |
| 环境检查 | Node/npm 版本、node_modules、锁文件、配置目录、dist 是否存在及修复建议；当前 Vue 页面未找到独立入口 |

接口入口：[server/app.js](D:/workspace/HLD/front/code/home/server/app.js:197)，实现：[server/practicalUtilities.js](D:/workspace/HLD/front/code/home/server/practicalUtilities.js:255)。迁移计划与项目交付目录接口也存在，但包含 Nginx 配置语义，不列入本次非 Nginx 候选功能。

## 5. 参考实现时需要调整的地方

1. **保留当前 Electron 工作台。** home 为 Vue + Express，本项目为 React + Electron。参考算法、交互与数据流程，按当前 Worker / 本地资源 / 桌面桥接结构重做。
2. **先做纯离线增量。** TOML、编码、表格清洗、SQL INSERT、CSS、ENV、模板工具可沿用现有独立任务，不需要另开本地 Web 服务。
3. **HTTP 与探活单独设计。** 它们会主动访问用户指定地址；当前产品的“处理过程不联网”需调整为准确的模块说明，不加入后台轮询或自动发送。
4. **Schema 校验适配 CSP。** home 在前端使用 Ajv 动态编译；需要验证当前严格 CSP 下的方案，不能直接加 unsafe-eval。
5. **端口检测适配 Linux/ARM64。** home 仅 Windows 分支获取 PID/进程，其他平台回退到端口可用性检查，不应描述为跨平台完整进程识别。
6. **不直接复制全部类型推断选项。** 源码中 `detectEnums` 有开关和默认值，但未看到推断逻辑消费该参数；`$ref` 开关文案与分支语义也需重新核对。
7. **维持既有数据边界。** home 的 HTTP 集合/历史会持久化，DevKit 默认输入内存保存；后续需要明确请求、响应、Token、密码哪些能保存，不能因为移植而改变默认行为。
8. **继续三架构交付。** 最终实现后仍生成 Windows x64、Linux amd64、Linux ARM64 三份包并复核内容与校验值；本轮清单审阅不重新打包。

## 6. 建议的迁移顺序（等待用户选定）

- 第一批：TOML、Schema 校验、结构化 JSON Diff、Base32/Base58/文本 Hex/ASCII、cURL 解析。
- 第二批：Mock、CSV/TSV/Markdown Table、CSV 清洗、SQL INSERT ↔ JSON、ENV 整理比较。
- 第三批：Grid/Flex/Shadow/Radius、.gitignore、Compose；实体生成与随机字符串选项增强。
- 独立模块：HTTP 调试台、项目入口/探活、环境档案、运行状态、备份中心与端口检测。

以上仅为审阅清单与建议，没有启动功能迁移。
