# DevKit · 开发者工具箱

基于 **Electron + React + TypeScript** 的本地开发工作台。Windows 与 Linux 统一使用内置 Chromium，无需系统 WebKitGTK 或 WebView2。当前版本 v1.6.0，中文界面，44 个工具均离线运行，另含支持局域网共享的项目中心。

## v1.6 项目中心打磨与便携配置

项目中心配置改存为 **安装目录/configs**。首次启动自动迁入旧版数据并保留原件；关闭应用后，可将 configs 整个复制到另一台电脑安装目录的相同位置。界面提供实际路径、打开目录与迁移指引，升级和卸载保留该目录。Linux 安装时准备普通用户可写的 configs，目录不可写时明确报错，具体权限处理见部署说明。

卡片压缩为紧凑布局，名称、编码、分组、状态和操作集中显示，长地址按需展开；增加列表视图、排序和明确勾选的批量操作。编辑区提供作用范围、URL 组成和各档案预览，取消/Esc/退出保护草稿。导入支持合并/替换及影响预览，恢复先预览快照，支持命名备份。

当前发行目录 `artifacts/release-1.6.0/` 提供 Windows x64、Linux amd64、Linux ARM64 及独立 Node24 服务 ZIP。[配置位置、迁移与局域网部署说明](docs/project-center.md)。

## v1.5 项目中心与局域网共享

新增统一的 **项目中心**，将项目入口、环境配置档案、导入导出与快照恢复放在同一工作流中。项目定义维护一次，配置档案维护变量及个别项目的覆盖；切换档案只影响当前使用者。支持分组搜索、批量启停、入口清单、主机手动检测、版本冲突检查和最近 30 份快照。

桌面端通过“局域网共享”开启独立 HTTP 服务，其他电脑用浏览器访问主机 IP/端口。设置访问口令，默认只读，可明确允许协作编辑及下次启动自动共享。只开放项目中心，原有工具箱资源与输入不开放；不需要 Nginx，桌面主机不需要另装 Node。另有 Node.js 24+ 独立服务 ZIP，用于常驻主机部署。

[项目中心逻辑、局域网操作步骤与部署说明](docs/project-center.md)。v1.5 历史桌面交付在 `artifacts/release-1.5.0/`，包括 Windows x64、Linux amd64、Linux ARM64 包及校验值。独立服务 ZIP 不包含 Node 运行时；仅运行主机需要 Node，浏览器客户端不需要。

## v1.4 GitHub 调研与实用工具补齐

参考 DevToys、IT-Tools 和 CyberChef，新增 **XML、GZip、IPv4 子网、chmod、ULID、文本统计** 六个工具，接入现有搜索、独立任务、示例与文件导出。首页新增显式内容识别，推荐工具并携带原文和转换模式；仅在主动操作时读取剪贴板。搜索优先用途别名，处理结果可继续送往 GZip / XML / 文本统计。

[调研报告、对比与后续优先级](docs/github-research-2026-10-24.md)。v1.4 历史交付目录为 `artifacts/release-1.4.0/`，包含 Windows x64、Linux amd64、Linux ARM64 包、构建指纹及 SHA-256。打包过程检查实际 ASAR 的全部前端资源和桌面代码，防止汇总旧包；交付后可运行 `npm run verify:release`。

## v1.3 类型转换整合

将 JSON 转 Java / TypeScript 合并为 **JSON 转类型**，通过目标语言切换，并保留 POJO/Record、Jackson、interface/type 和 TS 对象输出选项。新增 **类型转 JSON**，从 Java 实体类/Record 或 TS interface/type 生成 JSON 示例，支持本地嵌套类型、集合、泛型与继承；循环对象引用以 null 截断。v1.3 时总计仍为 38 个工具，v1.4 已扩展为 44 个。

反向转换按声明类型生成示例，不执行源码、构造器或初始化表达式，不会还原实际数据。输入语言、根类型与数组示例数量可设置，TS 可选择包含/忽略可选字段。旧工作区、收藏和启动入口自动迁移。[用法、支持范围与示例](docs/type-conversion.md)。v1.3 历史安装包位于 `artifacts/release-1.3.0/`。

## v1.2 前后端工具升级

新增 **12 个工具**：JS/JSX、TS/TSX、HTML、CSS/SCSS 格式化，JSON 路径提取、JSON Schema 生成、Query 参数转换、Fetch/Axios/cURL 请求代码生成、Cron 预览、.env 与 Properties 转换、HMAC、Unicode 转义、CSS 单位换算、HTTP 状态码速查。全部接入分类搜索、独立任务、示例、复制和导出，JSON 输出支持结构预览。

[工具用法与边界](docs/developer-tools.md)。代码格式化通过随应用分发的 Prettier 按需加载，HTTP 工具只生成代码，Cron 只预览 UTC 触发时间。HMAC 密钥与结果默认排除在工作区保存之外。

新增 `npm run bundle:all`，一次生成 Windows x64、Linux amd64 与 Linux ARM64 三份安装包，统一放入对应版本的发行目录（当前为 `artifacts/release-1.6.0/`），附带 `SHA256SUMS` 和 `release.json`。构建 Windows 安装包的合集命令在 Windows 构建机使用，各平台仍保留独立打包命令和 CI。

## v1.0 产品体验升级

- 七个任务分类统一总览、侧栏和搜索：结构化数据、代码与查询、编码与解析、文本与匹配、时间与数值、安全与标识、颜色与设计。搜索支持用途别名、多个关键词、英文子序列匹配，收藏和最近使用优先。
- 紧凑工作台首页提供继续工作、卡片/列表切换、分类过滤；移除宣传式大图。浅色、深色、跟随系统主题，以及舒适/紧凑密度。
- 最多 12 个独立任务，同一工具可打开多份输入。切换保留编辑器、光标和滚动；任务可后台执行或主动取消。编辑后保留旧结果并标记待更新；失败重试保留上次输出。清空、文件导入和关闭文本任务可撤销。
- 文本文件可拖入或选择导入，最多 8 MB 且不超过 2,000,000 字符；支持 UTF-8、带 BOM 的 UTF-16 LE/BE。桌面导出使用原生另存对话框，仅授予用户选择文件的写权限；浏览器预览使用下载。
- 编辑区支持拖动分栏（宽窗口）、上下布局、输入/结果最大化、字号与缩进设置。窄窗口导航支持 Esc 关闭、焦点约束与焦点恢复。
- JSON、CSV 导入结果可切换结构/表格预览，保留大整数、数字原文及重复键；支持节点搜索、路径和值复制。URL/JWT 展示结构化字段，正则提供匹配高亮与分组，diff 提供左右对照和差异块跳转，密码/UUID 提供逐条复制。
- 处理结果可作为新任务输入，串联 JSON 格式化、代码生成、编码等操作。工作区通过文件主动保存、恢复；默认排除密码/JWT/HMAC，颜色任务和图片不导出。工作区文件为明文，导入有大小、数量和字段验证，恢复的结果需重新处理。
- 设置页管理主题、密度、启动工具、字号、缩进、换行与布局，并支持设置/收藏导入导出和可撤销重置。

离线工具的任务输入输出默认仅存在内存；偏好、工具收藏和收藏色自动保存。项目中心的数据经主动保存后持久化在主机，可按设置供局域网访问；入口检测仅在主动操作时进行。无遥测或远程字体。

## 已实现

| 工具 | 功能 |
| --- | --- |
| XML 格式化 | 格式化 / 压缩、注释 / CDATA / xml:space，拒绝 DTD / ENTITY；不是 XSD 校验器 |
| GZip 文本编解码 | UTF-8 文本 ↔ GZip Base64，流式解压最多 4,000,000 字节 |
| IPv4 子网 | CIDR / 点分掩码、网络 / 广播 / 主机范围、/31 与 /32 |
| chmod 权限 | 八进制 ↔ rwx，setuid / setgid / sticky，只计算不执行 |
| ULID | 批量生成、同批次单调递增、时间字段解析；不用于秘密令牌 |
| 文本统计 | UTF-8 字节、UTF-16 单元、码点、字符簇、分词、行数与换行类型 |
| JSON ↔ YAML | 双向转换，保留大整数，拒绝重复键、非有限数、复杂键与循环别名 |
| CSV → JSON | CSV / TSV、首行表头或数组模式，支持引号、换行、可选类型推断 |
| SQL 格式化 | 标准 SQL / MySQL / PostgreSQL / SQLite / SQL Server / Oracle，缩进与关键字大小写 |
| 文本差异对比 | 双文本输入、交换内容、行首尾空白选项、增删高亮与 .patch 导出 |
| URL 解析 | 拆解 URL、查询参数、重复参数与片段，全程不访问地址 |
| 随机密码生成 | 安全随机数、4–256 位、1–100 条、四种字符集、排除易混淆字符 |
| JSON | 格式化、压缩、语法校验，保留大整数、数字原始写法及重复键 |
| JSON 转类型 | 同一入口切换 Java POJO / Record 与 TS interface / type，保留两种语言的独立配置 |
| 类型转 JSON | Java 类 / Record 或 TS interface / type 生成示例 JSON，支持嵌套、集合、本地继承和泛型 |
| JSON → CSV / TSV | 合并所有行的列、引用转义、缺失值与表格公式转义 |
| Base64 | UTF-8 编码、解码，支持中文与 emoji |
| URL | URL 参数编码、解码（encodeURIComponent 语义） |
| HTML 实体 | 特殊字符转义、常见命名实体和数字实体解码 |
| 时间戳 | 秒/毫秒、带时区 ISO 日期、UTC 与本地时区显示 |
| 哈希 | SHA-256 / SHA-384 / SHA-512 / SHA-1 |
| UUID | 使用安全随机数生成 UUID v4，单次 1–1000 个 |
| 正则 | JavaScript 正则、标志、匹配位置、捕获分组和命名分组 |
| JWT | Header / Payload 解码及 iat / exp / nbf 的 UTC 日期，仅解码、不验证签名 |
| 进制转换 | BigInt 精确转换 2 / 8 / 10 / 16 进制，支持负数和对应进制前缀 |
| 文本与命名 | 小驼峰、大驼峰、下划线、连字符、大小写、逐行去重、自然排序和空白清理 |
| 取色器 | 色板、可用环境下的屏幕吸管、本地图片像素取色、坐标与放大镜 |
| 颜色格式转换 | HEX / HEXA / RGB / HSL、透明度、HSV 与 CMYK 分量显示 |
| 调色板与色阶 | 类似色、互补色、三角色、分裂互补色、四角色、单色系及 50–950 色阶 |
| 渐变生成器 | 2–5 个等距色标、线性 / 径向渐变、角度和 CSS 导出 |
| 颜色对比度 | WCAG 2.2 AA / AAA 普通字、大字与 UI 图形阈值检查 |
| 混色与插值 | sRGB 或线性光空间、预乘透明度混合、11 级插值色阶 |

支持 `Ctrl/Cmd + K` 搜索、`Shift + Enter` 从搜索新建独立任务、文字工具的 `Ctrl/Cmd + Enter` 处理；总览中按 `/` 聚焦工具库搜索。

### 工作台与代码编辑器

默认启动进入工具总览，也可在设置中指定启动工具。侧边栏提供七个工具分组、收藏与最近使用；桌面可收起为图标栏，窄窗口改为抽屉导航。最近使用只记录本次会话的工具，不保存输入内容。点击工具复用已打开任务，工具卡片的 ＋ 或工具标题旁的“新任务”创建独立实例。

`Ctrl/Cmd+K` 打开全局搜索面板，输入名称或用途，上下键选择，Enter 打开，Esc 关闭。面板使用原生模态对话框管理焦点。工具库的关键词筛选与分类过滤独立于全局搜索。

文字工具和颜色代码导出区使用 CodeMirror 6，提供行号、折叠、JSON / Java / TypeScript / CSS 语法高亮、Ctrl/Cmd+F 查找与撤销重做。编辑器与各语言包按需从本地资源加载，不使用在线 CDN。Tab 用于缩进；按 Esc 后再按 Tab 可离开编辑器，避免键盘焦点被困。输入区支持粘贴、示例与清空，结果支持复制与文件导出，自动换行可切换。

### 颜色管理

六个颜色工具共用当前主颜色与收藏色，可在色板、格式、配色、渐变、对比度和混色之间切换。支持最多 40 个本地收藏色，点击复用，可删除、清空或导出为 JSON；配色方案还可复制 / 导出 CSS 变量或 JSON，渐变可导出 CSS 文件。窄窗口下通过左上角按钮打开工具抽屉，Ctrl/Cmd+K 可直接搜索并打开工具。

颜色输入支持 `#RGB`、`#RGBA`、`#RRGGBB`、`#RRGGBBAA`，逗号或空格形式的 `rgb()/rgba()`、`hsl()/hsla()`，百分比透明度和常见命名色。转换基于 sRGB；HSV 与 CMYK 为分量换算，CMYK 不包含印刷 ICC 配置。明度阶梯基于 HSL，不是感知均匀色阶。调色板与插值色块中的透明颜色以白色为底预览。

屏幕吸管使用运行环境提供的 [EyeDropper API](https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper_API)，仅在支持时启用；Linux WebKit 等环境可能不支持。跨平台仍可通过色板或图片取色。图片支持 PNG / JPEG / WebP / BMP，最大 20 MB、2000 万像素，按系统 WebView 解码后从原分辨率 Canvas 读取像素；可移动鼠标预览、点击取色，或输入零起始 X/Y 坐标取色。图片不会上传，不导入 SVG 或远程图片。

对比度依据 [WCAG 2.2 的 sRGB 相对亮度与对比度公式](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)，使用未四舍五入比值判定；普通字 AA ≥4.5、AAA ≥7，大字 AA ≥3、AAA ≥4.5，UI 图形阈值 ≥3。透明背景先叠加白色，文字再叠加背景。它是颜色对的检查，不能单独证明页面整体无障碍合规。

### JSON 转 Java / TypeScript

转换器根据整个 JSON 样本推断结构，合并数组中所有对象的字段。字段在部分样本中缺失时，TS 会生成 `?`；显式 `null` 会保留在 TS 联合类型中。仅由 null 推断的 Java 字段、空数组元素和不兼容混合类型使用 `Object`；TS 空数组使用 `unknown`。样本推断无法替代完整 JSON Schema。

Java 支持对象或非空对象数组根节点，输出可保存为单个 `Root.java` 文件，嵌套对象生成为内部类型。整数根据原始数字文本推断为 `Integer` / `Long` / `BigInteger`，小数或指数形式使用 `BigDecimal`；不会先把大整数转换为 JS Number。POJO 使用包装类型和 getter/setter，Record 需要 Java 16+。默认无外部依赖；字段重命名后如需保留 JSON 绑定，请选择 Jackson 注解，并在目标 Java 项目引入 `jackson-annotations`，反序列化时使用支持相应类型的 Jackson 配置。

TS 支持任意合法 JSON 根节点，提供 interface / type 风格，可输出 `export const data: Root = ...`。`number` 采用 JavaScript 数值精度；生成代码保留原数字写法，但大整数业务 ID 建议在 JSON 中使用字符串。

### 配置、表格与调试工具

JSON / YAML 转换采用 YAML 1.2 core 规则，只处理单文档。大整数保留原始整数精度；浮点数仍使用双精度。转换会丢弃注释与原始排版，拒绝重复键、非字符串键、非有限数、未知标签、循环别名及超过 100 层的结构。别名展开有数量限制。

CSV 导入默认将字段保留为字符串，避免 `001` 变成 `1`。可选择数字 / 布尔 / null 推断；带前导零或超出安全整数范围的数字保留字符串，空字段保留空字符串。支持 BOM、CRLF、引号转义与字段内换行；空白记录行忽略，列数不一致、重复或空表头会报错。最多支持 100,000 条记录。

SQL 只做排版，不连接数据库、不执行语句，也不保证语义或语法正确。最多支持 200,000 字符；复杂存储过程可能不受解析器支持。YAML、SQL、diff 及其语法高亮模块从本地按需加载。

文本差异每侧最多 500,000 字符，计算设有时间及编辑距离限制。绿色 `+` 为新增，红色 `-` 为删除；没有 `@@` 差异块表示按当前空白规则未发现差异。默认精确对比，导出的 unified diff 可用于补丁工具；开启忽略空白时仅用于查看差异。

URL 解析使用标准 URL / URLSearchParams 规则，查询参数以数组表示以保留重复项。查询中的 `+` 按空格解析，端口等字段可能标准化。结果包含输入中的用户名、密码等字段，仅在本地显示。

密码使用 Web Crypto `getRandomValues`，通过拒绝采样避免模偏差；混合字符集每条保证包含所选的各类字符。默认 24 位、5 条，排除 `Il1O0o`。支持字母数字符号、字母数字、十六进制和纯数字；十六进制或数字模式若需要完整字符集，可将易混淆字符设为保留。生成结果不自动保存，复制或导出需主动操作。

## 开发与打包

从 v1.1.0 起统一采用 Electron + React + TypeScript。Windows、Linux amd64 和 Linux ARM64 使用同一个桌面主进程和原生文件保存接口。Chromium 随安装包分发，不要求目标系统安装 WebKitGTK、WebView2、Node.js 或 Rust。

构建机准备 Node.js 24、Python 3.10+（仅制作 deb 使用）：

```sh
npm ci
npm run desktop
```

`npm run desktop` 先构建再打开 Electron；浏览器界面开发可运行 `npm run dev`。修改桌面主进程或需要验证原生文件保存、Worker/CSP 时，重新运行桌面命令。

| 目标 | 命令 | 输出 |
| --- | --- | --- |
| Windows x64 安装包 | `npm run bundle:windows` | `artifacts/windows-x64/DevKit_1.6.0_x64-setup.exe` |
| Linux amd64 | `npm run bundle:linux` | `artifacts/linux-x64/DevKit_1.6.0-1_amd64.deb` |
| Linux ARM64 / 麒麟 | `npm run bundle:linux:arm64` | `artifacts/linux-arm64/DevKit_1.6.0-1_arm64.deb` |
| 当前系统解压版 | `npm run bundle:host` | `artifacts/desktop-runtime/` |

Windows 解压版必须保留 `artifacts/desktop-runtime/DevKit-win32-x64/` 整个目录，再运行其中的 `devkit.exe`。不能只复制一个 exe。NSIS 安装包包含运行时，可整包传输，采用当前用户安装；目前没有配置代码签名。

ARM64 deb 可以在 Windows 或 Linux 构建机上生成。打包脚本下载官方 Electron 预编译运行时，检查 ELF 架构及 glibc 符号要求，然后使用 Python 标准库生成 Debian ar/control/data 归档。安装脚本不联网、不添加源、不安装或替换系统库。基础库依赖以 deb 控制文件为准，不依赖 WebKitGTK。真实麒麟机器上的安装/启动仍需验证。

[麒麟 V10 离线安装与排查](docs/kylin-offline-install.md)。离线终端只需应用包；若它本身缺少包中声明的基础库，安装会报错，此时应反馈做进一步应用适配，不要强制忽略依赖或升级目标系统。

构建依赖下载需要联网；现有 44 个工具离线运行，项目中心共享与手动检测按用户设置使用网络。桌面使用不需要额外安装 Node、Python 或 Java；独立服务 ZIP 的主机需要 Node.js 24+。Linux 安装包包含 Chromium 的沙箱帮助程序，运行时不要添加 `--no-sandbox` 或用 sudo 启动。

### 自动构建

`.github/workflows/build.yml` 使用同一套 Electron 打包脚本，生成 Windows x64、Linux amd64、Linux ARM64 产物并上传到 Actions。Windows 执行真实 Electron 集成检查；Linux 检查 deb 元数据、父目录完整性、空目录严格解包，并执行实际 `dpkg --unpack`。工作流不发布 Release，不代表已在麒麟机器上验收。旧版本构建产物可能仍在 artifacts 中，Electron 统一版从 1.1.0 开始；本次交付使用 `1.6.0-1` Debian 包，保留自 `1.1.0-1` 起修复父目录缺失问题的打包逻辑。

## 验证与边界

```sh
npm test
npm run test:desktop
npm run test:release
npm run test:electron
npm run build
python scripts/test-deb-packaging.py
```

117 项核心测试覆盖现有 44 个工具。桌面策略测试覆盖本地来源限制、目录穿越和原生保存参数；Electron 集成检查验证隔离沙箱、安全本地协议、页面、JSON/YAML/SQL、新增工具与 Prettier Worker、Web Crypto、原生保存桥接和取消。测试用的保存对话框选择由测试桩提供，不属于操作系统弹窗点击测试。

安装 JDK 17+ 后，可运行 `npm run test:java` 编译生成代码，也可执行 `npm run test:java -- /path/to/javac` 指定编译器。使用工具箱本身不需要 Java。

文字工具在独立 Web Worker 中执行，正则超过 3 秒、其他任务超过 10 秒会终止，也可主动取消；输入上限为 2,000,000 个 UTF-16 代码单元，输出上限为 4,000,000 个。正则最多返回 1000 条匹配，高亮预览支持最多 100,000 输入字符并展示前 200 项。JSON 最多 100 层嵌套，结构预览最多 300,000 字符、8,000 节点，表格预览最多 100 行、30 列，diff 预览最多 5,000 行。工作区最多 12,000,000 字符和 12 个文本任务。

JWT 仅解码，不验证签名或可信性。SHA-1 仅供兼容性校验。CSV 默认转义看起来像表格公式的字符串，可手动关闭。安装成功、程序启动、功能验收是三项独立检查，当前开发机不能替代真实麒麟 ARM64 验收。

## 工程结构

- `src/tools.ts`、`src/catalog.ts`、`src/discovery.ts`：工具定义、七个任务分类与统一搜索。
- `src/App.tsx`、`src/workbench.ts`：独立任务、运行状态、偏好和工作区文件。
- `src/ToolWorkspace.tsx`、`src/ToolOptions.tsx`、`src/ResultView.tsx`：编辑区、参数与结构化结果。
- `src/generators.ts`、`src/utilities.ts`、`src/practical.ts`、`src/developer.ts`、`src/colors.ts`：转换和生成算法。
- `src/ColorWorkbench.tsx`：颜色工具、图片取色与收藏。
- `src/extended.ts`：XML、GZip、IPv4、chmod、ULID 和文本统计；`src/detection.ts`、`src/SmartOpen.tsx`：显式内容推荐。
- `src/CodeEditor*.tsx`、`src/styles.css`、`src/workbench.css`：编辑器与视觉系统。
- `src/files.ts`：调用统一 Electron 文件保存桥接；浏览器预览使用下载。
- `electron/main.cjs`、`electron/preload.cjs`、`electron/policy.cjs`：共享桌面入口、最小 IPC 接口、本地资源与来源校验。
- `scripts/package-desktop.mjs`、`scripts/make-deb.py`：统一运行时打包与 deb 归档。
- `scripts/release-integrity.mjs`、`scripts/verify-release.mjs`：实际 ASAR 内容校验、构建凭据与三架构发行包校验。
- `build/icons/`：共享应用图标。




发行包一致性复核：`npm run verify:release`。只汇总已构建产物可使用 `node scripts/package-all.mjs --collect-only`，要求每份包具备匹配的 `.build.json`，并与当前全部 dist / 桌面源码一致；缺失或过期会明确失败。

项目中心代码：`shared/projects.mjs` 为共用模型，`server/` 为存储/共享/检测，`src/ProjectCenter.tsx` 为桌面与网页共用界面，`portal.html` 为唯一对外网页入口。`npm run test:projects` 验证项目与共享边界；`npm run serve:projects` 启动独立 Node 服务；`npm run bundle:project-server` 制作仅项目中心的独立 ZIP（构建机需 Python，可通过 DEVKIT_PYTHON 指定）。
