<!-- README.md 自动生成；维护源为 docs/README.template.md。工具清单来自源码注册表，版本和产物名称来自 package.json / releaseTargets。
     变更工作台、项目中心、部署或数据行为时，同步修改本模板及对应专题文档，然后运行 npm run docs:update。
     不要直接编辑根目录 README.md；每次打包都会重新生成。 -->
# DevKit · 开发者工具箱

DevKit 是中文界面的本地开发工作台，提供 **7 类、44 个离线工具**，以及可通过局域网共享的项目中心。桌面端基于 Electron + React + TypeScript，Windows、Linux amd64 与 Linux ARM64 共用内置 Chromium，无需目标电脑另装 Node.js、Python、Java、WebView2 或 WebKitGTK。

当前版本：**v1.8.0**。工具输入和结果默认只保存在内存中；偏好、收藏和项目中心配置按各自规则保存。项目中心共享和手动入口检测会按用户操作使用网络，无遥测和远程字体。

## 开始使用

1. 根据系统选择安装包：Windows 使用 `DevKit_1.8.0_x64-setup.exe`；Linux amd64 / ARM64 使用对应架构的 `.deb`。发行合集目录为 `artifacts/release-1.8.0/`。
2. 启动后在总览中搜索工具名称或用途，或按 `Ctrl/Cmd + K` 打开全局搜索。工具可载入示例、粘贴文本或导入本地文件，处理后复制、导出或继续送入其他工具。
3. 需要管理开发、测试、生产入口时，打开侧栏的“项目中心”，添加项目与配置档案；其他电脑需要访问时，再开启“局域网共享”。

Windows 解压版需要保留整个应用目录，再运行 `devkit.exe`。Windows 安装包当前未配置代码签名。Linux / 麒麟离线安装、基础库检查和启动排查见 [麒麟 V10 部署说明](docs/kylin-offline-install.md)。

## 工具功能

以下清单直接读取应用的工具定义与分类；名称、说明、数量和排序随当前功能同步。

### 结构化数据（9）

整理数据与配置文件

| 工具 | 功能 |
| --- | --- |
| JSON 格式化 | 让结构清晰，让调试轻松。格式化、压缩与校验 JSON。 |
| JSON ↔ YAML | 转换配置文件，保留大整数，检测重复键与不兼容的 YAML 值。 |
| XML 格式化 | 格式化或压缩 XML，保留注释、CDATA 与 xml:space。拒绝 DTD / ENTITY；不执行内容，不校验 XSD。 |
| CSV 转 JSON | 导入 CSV / TSV，支持表头、引号内换行与可选类型推断。 |
| JSON 转 CSV | 合并对象数组的所有列，支持 CSV / TSV 和表格公式转义。 |
| JSON 路径提取 | 支持 $.field、[0]、["字段"] 与 [*]，始终输出匹配值数组，保留数字原文。不是完整 JSONPath；最多 300,000 字符、8,000 节点。 |
| JSON Schema 生成 | 根据样本生成 Draft 2020-12 Schema，合并数组对象与可选字段。样本推断不代表完整业务约束；最多 300,000 字符、8,000 节点。 |
| .env ↔ JSON | 转换平面字符串配置，支持 export、引号和注释；双引号支持 \n、\r、\t、\"、\\，不展开变量、不执行命令。拒绝重复键及多行引号。 |
| Properties ↔ JSON | Java Properties 文本与 JSON 字符串对象互转，支持转义、Unicode、续行、空格或 =/: 分隔。拒绝重复键；输出使用 ASCII Unicode 转义。 |

### 代码与查询（6）

转换类型、生成请求代码与整理查询

| 工具 | 功能 |
| --- | --- |
| JSON 转类型 | 在同一工具切换 Java POJO / Record 与 TypeScript interface / type，保留各语言选项，从全部 JSON 样本推断嵌套类型。 |
| 类型转 JSON | 从 Java 类 / Record 或 TS interface / type 生成 JSON 示例。支持嵌套、集合、本地继承与泛型；循环引用和未知值类型输出 null。不会执行源码或还原真实数据；外部类型需同时提供定义。最多 200,000 字符、500 类型、10,000 示例节点、60 层。 |
| SQL 格式化 | 整理 SQL 缩进与关键字大小写，支持常用数据库方言，仅格式化、不执行。 |
| 前端代码格式化 | 使用本地 Prettier 整理 JS / JSX、TS / TSX、CSS / SCSS、HTML；仅格式化，不执行代码。每次最多 200,000 字符。 |
| HTTP 请求代码生成 | 从 JSON 请求配置生成 Fetch、Axios 或 POSIX shell cURL 代码。支持 method、url、headers、body，全程不发送请求；cURL 不适用于 PowerShell 引号规则。 |
| HTTP 状态码速查 | 离线查询常用 HTTP 状态码、英文名称与中文说明；输入状态码、名称或关键词。不覆盖全部扩展状态码。 |

### 编码与解析（7）

编码转换与地址解析

| 工具 | 功能 |
| --- | --- |
| Base64 编解码 | 在文本与 Base64 之间转换，完整支持 UTF-8 中文。 |
| GZip 压缩与解压 | UTF-8 文本与 GZip Base64 双向转换，流式解压最多 4,000,000 字节；不处理 ZIP 或任意二进制文件。 |
| URL 编解码 | 编码或解码 URL 参数中的特殊字符。 |
| HTML 实体转换 | 转义 HTML 特殊字符；解码常见命名实体与数字实体。输出作为文本展示。 |
| URL 解析 | 拆解地址、路径与查询参数，保留同名参数；全程不发起网络请求。 |
| Query 参数转换 | Query 与 JSON 字符串对象互转，同名参数保留为数组，+ 按空格解码。输入为参数串（可带 ?），不接受完整 URL。 |
| Unicode 转义 | 文本与 JavaScript Unicode 转义互转，支持 \uXXXX、\u{1F600} 和代理对；输出为文本，不执行。 |

### 文本与匹配（4）

比较、匹配与清理文本

| 工具 | 功能 |
| --- | --- |
| 文本差异对比 | 逐行比较两份文本，突出新增与删除，导出 unified diff 补丁。 |
| 正则测试 | 测试 JavaScript 正则表达式，查看匹配位置和捕获分组。 |
| 文本与命名转换 | 驼峰、下划线、大小写转换，以及逐行去重、排序与清理。 |
| 文本统计 | 统计 UTF-8 字节、UTF-16 单元、Unicode 码点、可见字符簇、单词与行数，正确处理中文、emoji 和 CRLF。 |

### 时间与数值（4）

时间、数字与子网的精确计算

| 工具 | 功能 |
| --- | --- |
| 时间戳转换 | 在 Unix 时间戳与日期之间转换，明确区分秒和毫秒；可填入当前时间，逐项复制 UTC、本地时间与时区。 |
| 进制转换 | 使用 BigInt 精确转换二、八、十、十六进制整数。 |
| Cron 表达式预览 | 五字段 Unix Cron（分 时 日 月 周），支持数字、*、范围、逗号与步长，0/7 为周日；日期与星期均受限时取或。按 UTC 预览未来最多 4 年，不创建定时任务；不支持 Quartz 秒字段、名称或 L/W/#。 |
| IPv4 子网计算 | 由 IPv4 / CIDR 或连续子网掩码计算网络、广播、主机范围。/31 使用点对点规则，/32 为单个地址；不访问网络。 |

### 安全与标识（7）

摘要、权限、令牌与安全随机数

| 工具 | 功能 |
| --- | --- |
| 哈希计算 | 为 UTF-8 文本计算 SHA 摘要，粘贴已有 HEX 摘要核对是否一致。 |
| 随机密码生成 | 使用系统安全随机数批量生成密码，支持字符集、长度与排除易混淆字符。 |
| JWT 解码 | 查看 Header、Payload 和时间字段。仅解码，不验证签名或令牌可信性。 |
| UUID 生成 | 使用安全随机数批量生成 UUID v4。 |
| ULID 生成与解析 | 生成 1–1,000 个 ULID，同批次单调递增；或逐行解析标识的毫秒时间与随机段。时间可见，不用于密码或令牌。 |
| HMAC 签名 | 使用 UTF-8 密钥计算 HMAC SHA-256 / SHA-384 / SHA-512，输出 HEX 或 Base64，可核对已有签名。密钥与结果仅在内存；工作区默认排除此任务。 |
| chmod 权限换算 | 通过权限矩阵、八进制或 rwx 输入换算权限，解释 owner / group / other 与 setuid、setgid、sticky。只计算，不执行命令或修改文件。 |

### 颜色与设计（7）

取色、搭配与视觉探索

| 工具 | 功能 |
| --- | --- |
| 取色器 | 从色板、屏幕或本地图片中取色，收藏你的常用颜色。 |
| 颜色格式转换 | HEX、RGB、HSL 相互转换，同时查看 HSV、CMYK 与透明度。 |
| 调色板与色阶 | 生成配色方案与 50–950 色阶，导出 CSS 变量和 JSON。 |
| 渐变生成器 | 搭配 2–5 个色标，实时预览线性、径向渐变并导出 CSS。 |
| 颜色对比度 | 检查文字与背景的 WCAG 2.2 对比度，以及 AA / AAA 等级。 |
| 混色与插值 | 在 sRGB 或线性光空间混合颜色，支持透明度与渐变色阶。 |
| CSS 单位换算 | 逐行转换 px / rem / em / vw，em 使用设定的字体基准，vw 使用设定的视口宽度。输入数字或带对应单位的值，不解析 CSS 表达式。 |

## 工作台与文件处理

- **独立任务**：最多 12 个任务，同一工具可打开多份输入；切换保留编辑内容、光标和滚动位置。任务可后台处理或取消，修改输入后保留旧结果并标记待更新，失败后可重试。
- **查找与导航**：7 类工具分组、用途别名搜索、收藏、会话内最近使用，支持卡片 / 列表。首页可主动识别文本内容并推荐工具；剪贴板仅在主动操作时读取。
- **明亮工作空间**：悬浮导航连接工作台、项目中心与收藏，首页以 Bento 区块展示快捷工具、内容识别和配色入口；分段切换全部 / 收藏 / 最近使用。Aurora 光晕、可暂停的类别滚动带、真实加载骨架和柔和过渡兼容深色主题及减少动态效果设置，详见 [界面设计说明](docs/interface-design.md)。
- **按功能设计的工作区**：格式化使用单文档「编辑原文 / 查看结果」切换；编解码使用上下流程；代码与配置转换保留可调整分栏；差异对比使用并排双输入和下方差异。全部 44 个工具的逐项设计见 [工具交互设计说明](docs/tool-workflows.md)。
- **查询、计算与解析**：状态码搜索与快捷码、时间字段卡片、子网位图、chmod 权限矩阵、Cron 五字段拆解与 UTC 时间线、JWT 分区、URL 参数表、文本统计指标。HTTP 请求代码提供方法 / URL 表单与配置 JSON 切换；Headers / body 在 JSON 中编辑。
- **编辑体验**：CodeMirror 6 提供语法高亮、行号、折叠、查找、撤销重做；对照工作区支持分栏拖动与上下布局，另有区域最大化、字体、缩进与换行设置。清空、导入和关闭文本任务支持撤销。
- **结果查看**：JSON 结构树、CSV 表格、正则匹配与分组、左右差异对照，以及密码 / UUID / ULID 逐项复制。SHA / HMAC 可粘贴已有值核对（HEX 忽略大小写，Base64 区分大小写）；输入或选项变更后保留旧源码并标记待更新。处理结果可作为新任务的输入继续转换。
- **文件输入输出**：支持拖入或选择文本文件，最多 8 MB 且不超过 2,000,000 字符，可读取 UTF-8 与带 BOM 的 UTF-16 LE/BE。桌面导出使用原生另存对话框，浏览器预览使用下载。
- **工作区与偏好**：可主动保存、恢复文本任务；默认排除密码、JWT、HMAC，颜色任务和图片不写入工作区。主题支持浅色、深色、跟随系统，另有密度、启动工具及设置 / 收藏导入导出。

| 快捷键 | 操作 |
| --- | --- |
| `Ctrl/Cmd + K` | 打开全局工具搜索 |
| `Shift + Enter` | 从搜索创建独立任务 |
| `Ctrl/Cmd + Enter` | 处理当前文本任务 |
| `/` | 在总览中聚焦工具库搜索 |
| `Ctrl/Cmd + F` | 编辑器内查找 |
| `Esc` 后按 `Tab` | 从编辑器缩进模式移出焦点 |

## 颜色管理

取色、格式转换、调色板、渐变、对比度和混色共用当前主颜色及最多 40 个本地收藏色。支持 HEX / HEXA、RGB、HSL 输入，显示 HSV / CMYK 分量，配色可导出 CSS 变量或 JSON，渐变可导出 CSS。

屏幕吸管在运行环境支持时启用；也可使用色板或本地图片取色。图片支持 PNG / JPEG / WebP / BMP，最大 20 MB、2000 万像素，可按坐标取色，不上传图片。颜色换算基于 sRGB，CMYK 不含印刷 ICC 配置；HSL 色阶不保证感知均匀。对比度检查提供 WCAG 2.2 的 AA / AAA 阈值判断。

## 项目中心

项目中心集中维护项目入口及环境差异，桌面与局域网网页共用同一份主机数据。

- **项目与档案**：项目维护名称、唯一编码、分组、说明、HTTP(S) 地址模板、查询参数和默认状态；配置档案维护变量与个别项目的地址 / 启用覆盖。切换档案只影响当前使用者。
- **管理与预览**：支持搜索、分组、排序、紧凑卡片 / 列表、复制项目 / 档案，以及明确勾选后的批量启停。编辑时展示 URL 组成及各档案的解析结果，有修改时提供草稿退出保护。
- **导入导出与恢复**：支持 JSON 导出、导入影响预览、合并或替换；保存时检查版本冲突。自动保留最近 30 份快照，支持命名备份、恢复预览，导入和恢复前自动备份。
- **手动检测**：主机按用户操作检测入口可达性。启停只控制入口状态，不启动或停止系统服务。
- **局域网访问**：桌面端开启共享后，其他电脑通过主机 IP / 端口进入项目中心，使用口令登录。默认只读，可明确允许协作编辑，并设置下次启动自动共享。共享范围仅包含项目中心。

### 配置保存与迁移

| 运行方式 | 默认配置位置 |
| --- | --- |
| Windows 安装版 / 解压版 | `devkit.exe` 同级的 `configs/` |
| Linux 安装版 | `/opt/devkit/configs/` |
| 独立 Node 服务 | 解压根目录的 `configs/`，与 `server/` 同级 |
| 源码桌面运行 | 仓库根目录的 `configs/` |

`configs` 保存项目、档案、快照、共享设置及加盐口令哈希。首次启动会在新位置无数据时迁入旧版配置并保留原件；已有新配置优先，升级和卸载保留配置目录。

迁移时关闭来源与目标应用 / 服务，备份目标配置后，复制整个 `configs` 到新安装目录并确保普通用户有写入权限。只导出项目 JSON 不会包含共享口令和历史快照。两边数据需要合并时使用界面的导入预览。

### 独立服务部署

适合常驻主机：解压 `DevKit_ProjectCenter_1.8.0_node24.zip`，**服务端准备 Node.js 24+**，无需 `npm install`；浏览器客户端无需安装运行时。首次启动需提供口令。

Windows PowerShell：

```powershell
$env:DEVKIT_PROJECT_PASSWORD='替换为独立访问口令'
node server/start.mjs
```

Linux：

```sh
DEVKIT_PROJECT_PASSWORD='替换为独立访问口令' node server/start.mjs
```

默认监听 `0.0.0.0:8765`，只读访问。可通过 `HOST`、`PORT`、`DEVKIT_PROJECT_EDIT=true` 配置监听与协作编辑；`DEVKIT_PROJECT_DATA` 可显式指定数据目录。后续启动可复用已保存的口令哈希。HTTP 共享用于可信局域网；同一配置目录只能由一个主机进程使用。完整步骤与权限处理见 [项目中心使用和部署说明](docs/project-center.md)。

## 开发与打包

构建机使用 Node.js 24；制作 `.deb` 或独立服务 ZIP 还需 Python 3.10+。首次下载构建依赖和 Electron 运行时需要网络，已安装的离线工具使用本地资源。

```sh
npm ci
npm run dev       # 浏览器开发
npm run desktop   # 构建后启动 Electron
```

桌面运行时当前使用 Electron 45.0.0。安装包包含 Chromium，Linux 包不添加系统软件源、不替换系统库；依赖以 `.deb` 控制文件为准。麒麟实际安装和启动需要在目标系统验收。

| 目标 | 命令 | 输出 |
| --- | --- | --- |
| Windows x64 安装包 | `npm run bundle:windows` | `artifacts/windows-x64/DevKit_1.8.0_x64-setup.exe` |
| Linux amd64 安装包 | `npm run bundle:linux` | `artifacts/linux-x64/DevKit_1.8.0-1_amd64.deb` |
| Linux ARM64 / 麒麟安装包 | `npm run bundle:linux:arm64` | `artifacts/linux-arm64/DevKit_1.8.0-1_arm64.deb` |
| 麒麟 ARM64（命令别名） | `npm run bundle:kylin` | `同 Linux ARM64` |
| 当前系统解压版 | `npm run bundle:host` | `artifacts/desktop-runtime/DevKit-<platform>-<arch>/` |
| 三平台安装包合集 | `npm run bundle:all` | `artifacts/release-1.8.0/` |
| 独立项目中心服务 | `npm run bundle:project-server` | `artifacts/release-1.8.0/DevKit_ProjectCenter_1.8.0_node24.zip` |

`bundle:all` 在 Windows 构建机依次制作三平台安装包，汇总 `SHA256SUMS`、`release.json` 和当前 README；独立服务 ZIP 使用单独的打包命令。仅汇总已经构建的安装包可运行：

```sh
node scripts/package-all.mjs --collect-only
npm run verify:release
```

汇总前会校验各包的版本、架构、校验值、构建凭据及实际 ASAR 内容，拒绝过期产物。Python 路径可用 `DEVKIT_PYTHON` 指定。CI 工作流 `.github/workflows/build.yml` 使用同一组打包入口，构建三平台产物与独立服务 ZIP。

### README 自动维护

**每次打包都会先根据当前功能生成根目录 README.md，失败时停止打包。** Windows、Linux、麒麟别名、解压版、合集（含 `--collect-only`）及独立服务 ZIP 均覆盖；直接运行打包脚本同样生效。安装包、输出目录、解压版、发行合集和独立服务 ZIP 会附带当前 README 及其链接的专题文档。

```sh
npm run docs:update   # 手动同步 README
npm run docs:check    # 只检查一致性，过期时返回失败
npm run test:docs     # 验证自动更新逻辑
```

维护来源：

- `src/tools.ts` 及其引用的工具模块：自动读取实际工具名称和功能说明，新增、删除、重命名或修改说明均同步到清单。
- `src/catalog.ts`：自动读取分类和工具顺序；工具遗漏、重复或引用失效会阻止生成。
- `package.json`、`scripts/release-integrity.mjs`、`src/workbench.ts`：自动读取版本、Electron 版本、发行文件名、打包命令和任务数量限制。
- `docs/README.template.md`：维护工作台、项目中心、部署和使用边界等说明。相关功能改变时同步修改模板及专题文档，再生成 README。

生成不依赖在线 AI 或网络；内容相同不会重复写入，也不写入构建时间。请修改上述来源，避免直接编辑会被重新生成的根目录 README。

## 验证与使用边界

```sh
npm run docs:check
npm run test:docs
npm test
npm run test:desktop
npm run test:projects
npm run test:release
npm run test:electron
npm run build
python scripts/test-deb-packaging.py
```

生成的 Java 代码可额外用 JDK 17+ 验证：`npm run test:java`，也可传入 `javac` 路径。桌面集成测试覆盖本地协议、Worker、沙箱及原生保存桥接；保存对话框的选择使用测试桩。真实安装、目标 Linux / 麒麟启动及跨电脑网络访问需在对应环境确认。

- 文本工具在独立 Worker 中执行；正则超过 3 秒、其他任务超过 10 秒会终止。通用输入上限为 2,000,000 个 UTF-16 单元，输出为 4,000,000 个；部分工具有更小限制，具体见界面说明。
- JSON 格式化保留数字原文与重复键；JSON / YAML 转换拒绝重复键等不兼容结构，转换不保留注释和排版。CSV 默认保留字符串，并对导出中的表格公式字符串转义。
- JSON 转类型按样本推断；类型转 JSON 按声明生成示例，不执行源码，也不还原真实数据。详见 [类型转换说明](docs/type-conversion.md)。
- SQL / 代码工具仅格式化或生成代码，HTTP 工具不发送请求，Cron 只预览 UTC 时间，JWT 仅解码、不验证签名。前后端工具的具体支持范围见 [开发工具说明](docs/developer-tools.md)。
- 工作区、项目导出和配置文件包含明文业务数据，应按实际内容保管；任务内容不会自动持久化，主动复制、导出或共享由用户决定。

## 工程结构

| 路径 | 职责 |
| --- | --- |
| `src/tools.ts`、`src/catalog.ts`、`src/discovery.ts` | 工具注册、分类与搜索 |
| `src/App.tsx`、`src/workbench.ts`、`src/ToolWorkspace.tsx` | 工作台、独立任务与偏好 |
| `src/ToolOptions.tsx`、`src/ResultView.tsx`、`src/CodeEditor*.tsx` | 参数、结果预览与编辑器 |
| `src/tool-experience.ts`、`src/ToolInput.tsx`、`src/ToolResult.tsx` | 各工具流程、专属输入与结果展示 |
| `src/generators.ts`、`src/type-samples.ts`、`src/utilities.ts`、`src/practical.ts`、`src/developer.ts`、`src/extended.ts` | 转换、解析与生成算法 |
| `src/colors.ts`、`src/ColorWorkbench.tsx` | 颜色算法与交互 |
| `src/ProjectCenter.tsx`、`shared/projects.mjs`、`server/`、`portal.html` | 项目中心界面、共享模型、存储及局域网服务 |
| `electron/`、`src/files.ts` | 桌面入口、来源策略及文件保存桥接 |
| `scripts/package-*.mjs`、`scripts/make-deb.py` | 桌面、合集与服务打包 |
| `scripts/release-integrity.mjs`、`scripts/verify-release.mjs` | 构建内容和发行包一致性校验 |
| `scripts/update-readme.mjs`、`docs/README.template.md` | 功能文档生成与维护源 |
| `docs/` | 类型转换、开发工具、项目中心和麒麟部署专题说明 |
