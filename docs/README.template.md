<!-- README.md 自动生成；维护源为 docs/README.template.md。工具清单来自源码注册表，版本和产物名称来自 package.json / releaseTargets。
     变更工作台、项目中心、部署或数据行为时，同步修改本模板及对应专题文档，然后运行 npm run docs:update。
     不要直接编辑根目录 README.md；每次打包都会重新生成。 -->
# DevKit · 开发者工具箱

DevKit 是中文界面的本地开发工作台，提供 **{{CATEGORY_COUNT}} 类、{{TOOL_COUNT}} 个离线工具**，以及可通过局域网共享的项目中心、本机 Nginx 配置与实例管理。桌面端基于 Electron + React + TypeScript，Windows、Linux amd64 与 Linux ARM64 共用内置 Chromium，无需目标电脑另装 Node.js、Python、Java、WebView2 或 WebKitGTK。运行 Nginx 实例需单独安装对应系统和架构的 nginx。

当前版本：**v{{VERSION}}**。工具输入和结果默认只保存在内存中；偏好、收藏和项目中心配置按各自规则保存。项目中心共享和手动入口检测会按用户操作使用网络，无遥测和远程字体。

## 开始使用

1. 根据系统选择安装包：Windows 使用 `DevKit_{{VERSION}}_x64-setup.exe`；Linux amd64 / ARM64 使用对应架构的 `.deb`。发行合集目录为 `artifacts/release-{{VERSION}}/`。
2. 启动后在总览中搜索工具名称或用途，或按 `Ctrl/Cmd + K` 打开全局搜索。工具可载入示例、粘贴文本或导入本地文件，处理后复制、导出或继续送入其他工具。
3. 需要管理开发、测试、生产入口时，打开侧栏的“项目中心”，添加项目与配置档案；其他电脑需要访问时，再开启“局域网共享”。
4. 需要维护本机 Nginx 时，打开与项目中心平级的“Nginx 配置”，登记主文件、附属文件、运行目录与 nginx 程序。默认按字段编辑，也可切换全文；保存后检查配置，再启动或重载。

Windows 解压版需要保留整个应用目录，再运行 `devkit.exe`。Windows 安装包当前未配置代码签名。Linux / 麒麟离线安装、基础库检查和启动排查见 [麒麟 V10 部署说明](docs/kylin-offline-install.md)。

## 工具功能

以下清单直接读取应用的工具定义与分类；名称、说明、数量和排序随当前功能同步。

{{TOOL_CATALOG}}

### 工作台模块

以下模块与工具分类平级，名称、分类和说明同样来自界面注册表，不计入文本/颜色工具数量。

{{WORKSPACE_MODULES}}

### 经纬度处理

“时间与数值 → 经纬度工具”在同一工具内提供十进制度/度分秒互转、圆心与半径的四方向圆周点计算、混合文本中的度分秒坐标提取。圆周算法可选 WGS84 椭球测地线（默认）或球面大圆；支持单值、坐标对、整列和 CSV/TSV 复制/导出，各页签分别保留参数与结果。

粘贴坐标对“填入经纬字段”及提取后“用作圆心”保留角度原文，只有主动转换才改变表示。结果的十进制度/度分秒旁分别复制对应数值。格式转换不改变坐标基准；圆周方向为起始方位角，正东/正西终点纬度可能变化。文本提取不跨无关段落拼凑坐标，无法确认的片段另列供核对。输入格式、精度、半径及复制边界见 [经纬度工具说明](docs/geographic-coordinates.md)。

## 工作台与文件处理

- **独立任务**：最多 {{MAX_TASKS}} 个任务，同一工具可打开多份输入；切换保留编辑内容、光标和滚动位置。任务可后台处理或取消，修改输入后保留旧结果并标记待更新，失败后可重试。
- **查找与导航**：侧栏提供 {{CATEGORY_COUNT}} 个固定分类入口，点击后在右侧浮层选择工具，展示用途与已打开任务数量；再次点击分类、点击外部或按 `Esc` 关闭。收起侧栏后保留分类图标，窄屏在导航抽屉内切换工具列表并可返回分类。支持用途别名搜索、收藏、会话内最近使用，以及卡片 / 列表。首页可主动识别文本内容并推荐工具；剪贴板仅在主动操作时读取。
- **工作空间外观**：悬浮导航连接工作台、项目中心、Nginx 配置与收藏，首页以 Bento 区块展示快捷工具、内容识别和配色入口；分段切换全部 / 收藏 / 最近使用。浅色采用中性灰白表面、深灰文字与蓝色强调，深色采用石墨灰背景、柔白文字与雾蓝强调色；两种模式均关闭首页 Aurora 光晕；成功、警告、错误分别使用绿色、琥珀色和柔红色。可暂停的类别滚动带、真实加载骨架和柔和过渡兼容减少动态效果设置，详见 [界面设计说明](docs/interface-design.md)。
- **按功能设计的工作区**：格式化使用单文档「编辑原文 / 查看结果」切换；编解码使用上下流程；代码与配置转换保留可调整分栏；差异对比使用并排双输入和下方差异。全部 {{TOOL_COUNT}} 个工具的逐项设计见 [工具交互设计说明](docs/tool-workflows.md)。
- **查询、计算与解析**：状态码搜索与快捷码、时间字段卡片、子网位图、chmod 权限矩阵、Cron 五字段拆解与 UTC 时间线、JWT 分区、URL 参数表、文本统计指标。HTTP 请求代码提供方法 / URL 表单与配置 JSON 切换；Headers / body 在 JSON 中编辑。
- **编辑体验**：CodeMirror 6 提供语法高亮、行号、折叠、查找、撤销重做；对照工作区支持分栏拖动与上下布局，另有区域最大化、字体、缩进与换行设置。清空、导入和关闭文本任务支持撤销。
- **结果查看**：JSON 结构树、CSV 表格、正则匹配与分组、左右差异对照，以及密码 / UUID / ULID 逐项复制。SHA / HMAC 可粘贴已有值核对（HEX 忽略大小写，Base64 区分大小写）；输入或选项变更后保留旧源码并标记待更新，复制/导出/继续处理需重新运行成功。成功的空结果也可复制和导出。处理结果可原样送到新任务，并衔接已知的语言、分隔符与编解码方向；ULID 两种模式分别保留草稿。逐项核对见 [工具交互审查清单](docs/tool-interaction-audit-2026-10-24.md)。
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

## Nginx 配置

- **多实例与多文件**：每个实例登记一个主配置及多个附属文件，可按 include 递归发现（包括通配符），也可手动添加。一份单文件 Linux 配置同样可以独立管理；仅登记文件不会自动改写 include。
- **字段与全文编辑**：默认按 `http` / `server` / `location` 等层级显示字段，提供端口、域名、静态目录、代理目标、请求头、日志、PID 等说明，保留未知指令、重复指令、注释和原有布局。可新增/删除指令或配置块；全文模式支持完整文档编辑。
- **文件保存与恢复**：配置原地保存，保存前检查内容哈希并备份原文件；外部修改时要求重新读取合并。备份可载入草稿核对后保存；保存不会自动重载。配置须为 UTF-8，保留 BOM 和现有换行。
- **本机运行控制**：自动检测 PATH / 常见路径，也可指定 nginx 程序与运行目录。使用主文件的 `-c` 参数检查、启动、`-s quit` 优雅停止及 `-s reload` 重载；启动/重载前自动执行 `-t`。状态依赖 PID 文件与进程身份，无法确认时拒绝停止或重载。
- **Windows / Linux**：共用同一套功能；配置应符合目标系统的路径、模块和权限。可编辑其他系统的文件，运行操作仅对匹配系统启用。每个并行实例需不同 PID 路径和监听端口；进程不会随 DevKit 退出而停止。管理功能仅限桌面本机，局域网项目中心及独立项目服务不暴露文件或进程控制。

完整步骤、路径规则、命令和权限排查见 [Nginx 配置说明](docs/nginx.md)。

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

`configs` 保存项目、档案、快照、共享设置及加盐口令哈希；桌面 Nginx 实例注册表和原文件备份位于 `configs/nginx/`，实际配置文件仍在原路径。首次启动会在新位置无数据时迁入旧版项目配置并保留原件；已有新配置优先，升级和卸载保留配置目录。

迁移时关闭来源与目标应用 / 服务，备份目标配置后，复制整个 `configs` 到新安装目录并确保普通用户有写入权限。只导出项目 JSON 不会包含共享口令和历史快照。两边数据需要合并时使用界面的导入预览。

### 独立服务部署

适合常驻主机：解压 `DevKit_ProjectCenter_{{VERSION}}_node24.zip`，**服务端准备 Node.js 24+**，无需 `npm install`；浏览器客户端无需安装运行时。首次启动需提供口令。

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

桌面运行时当前使用 Electron {{ELECTRON_VERSION}}。安装包包含 Chromium，Linux 包不添加系统软件源、不替换系统库；依赖以 `.deb` 控制文件为准。麒麟实际安装和启动需要在目标系统验收。

{{PACKAGE_TABLE}}

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
