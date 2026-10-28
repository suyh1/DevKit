# Findings

## 2026-10-24 深色主题去绿
- 根因是 styles.css、workbench.css 和 design.css 重复定义全局主题，最后一层将深色背景、面板、文字和边框全部染绿，另有硬编码绿色装饰、焦点和选区。共享 theme.css 保留原导入顺序，新增首位主题变量文件统一管理。
- 确定配色：背景 #141518、面板 #1C1E22、浮层 #25282E、输入区 #181A1E、正文 #E8E9ED、强调 #A6B8F4。成功 #8AC5A0、警告 #E2BB7F、错误 #EFA0AB；颜色工具的业务颜色不随主题替换。
- 实际 Electron 主题切换含颜色过渡；视觉断言须等待过渡完成，避免捕获中间帧。已将真实成功状态、按钮及行号配色纳入既有设计回归。

## Debian first-install failure
- The reported /opt/devkit/chrome-sandbox.dpkg-new ENOENT matches the original data.tar.xz having no directory entries. The old verifier checked file metadata but did not enforce parent-directory presence/order; it incorrectly let this package pass static checks.
- Emit every parent directory before children, with root ownership and 0755 permissions; preserve runtime empty directories. A verifier must not use an extractor that silently creates missing parents, since that masks this defect. Strict empty-root extraction reproduces and prevents it.
- The actual old ARM64 archive now fails verification on its first entry due to missing opt/devkit. Eight packaging tests pass after the fix, with complete builder/extractor roundtrips on both architectures.
- Reissue as Debian 1.1.0-1 so a direct dpkg -i retry supersedes the old 1.1.0 package. No cleanup of /opt or replacement of OS libraries is needed for this specific error. Kylin launch and baseline dependency compatibility remain separate, unverified target checks.
- Actual rebuilt ARM64 revision passed strict empty-root extraction with 14 directories and 76 files, while preserving root:root ownership and 4755 sandbox metadata. SHA256SUMS matches the rebuilt artifact. Original defective deb is retained only under artifacts/legacy-deb for diagnosis, not transfer/install.

## Kylin V10 compatibility
- User screenshot: arm64, GTK 3.24.23, WebKitGTK 4.0 / JavaScriptCore 2.38.6 and libsoup 2.70.0. WebKitGTK 4.1 has no installed version/candidate. Target system libraries cannot be upgraded.
- Preserve the existing Tauri distribution and add a Kylin-specific Electron shell that bundles Chromium. Do not rename WebKit libraries, alter system repositories/libraries or disable the renderer sandbox.
- Use a secure local custom protocol for ES-module workers and lazy local resources, a narrowly scoped save-file IPC bridge, and an offline deb with no network install scripts. Validate actual ARM64 binary requirements before claiming compatibility.
- User subsequently requested a unified Electron architecture for both Windows and Linux. Active Tauri dependencies, native interfaces, source and CI were removed; residual build files/icons archived under ignored artifacts/legacy-tauri. Shared icons now live under build/icons.
- Electron 45.0.0 official ARM64 runtime ELF scan reports GLIBC 2.25 as its highest referenced glibc version across the bundled binaries. This is a static symbol check, not proof of target-machine compatibility.
- Generated v1.1.0 unified ARM64 deb (83.5 MiB) and Windows NSIS installer (~107 MiB). The deb contains Chromium, no WebKit dependency or system library replacements; only application files and a packaged Chromium sandbox helper are installed.
- Real Electron integration test passed: secure custom origin, sandbox/context isolation, renderer without Node, JSON UI, YAML/SQL lazy Worker modules, Web Crypto, save IPC writing UTF-8 and cancel. Native save dialog selection is mocked only in the test harness.

## v1.0 product upgrade
- Unified all 26 tools into seven task-oriented categories and a shared alias/fuzzy search index.
- Independent task state is memory-only; mounted editor instances preserve cursor/scroll on switching. Workers are keyed by task and cancellable; stale edits and failed reruns preserve prior output.
- Structured JSON results use an independently tokenized tree after grammar validation, preserving source number lexemes and duplicate fields. Preview limits bound main-thread work.
- Native save uses Tauri dialog + fs plugins with save and write-text-file commands only; user-selected file scope is supplied by the dialog plugin. No general filesystem scope was added.
- Verified production browser workflow: file import with 9007199254740993, JSON structured preview, duplicate task isolation, stale output retention, JSON-to-TypeScript routing, alias search, settings theme, workspace export excluding JWT by default, and restore into a fresh task.
- Rust check and formatting pass. All 56 tests pass. Generated Java compiles with the local IntelliJ JBR javac path; javac is not on PATH.
- First Windows release built successfully; native homepage startup and dark desktop layout inspected. Final revisions add navigation focus trapping and bounded workspace export.

- Workspace is empty and has no Git repository.
- Node.js, npm, pnpm, Rust, Cargo and Git are available on Windows.
- Linux build availability and native packaging requirements are being checked.
- No Docker or installed WSL distribution; Linux packages must be built on Linux CI/native machines.
- Visual Studio 2022 Community and Rust MSVC are present.
- User explicitly prefers Tauri for smaller packages.
- Tauri official Debian docs: bundle includes WebKitGTK/GTK dependencies; native runners avoid cross-linker complexity (https://v2.tauri.app/distribute/debian/).
- Tauri official workflow docs support native ARM runners (https://v2.tauri.app/distribute/pipelines/github/).
- UI guidance applied: controlled labeled fields, clear focus, local fonts, reduced motion; compact desktop layout with teal accent.
- Native Linux ARM runner label verified in GitHub official documentation: https://docs.github.com/en/actions/reference/runners/github-hosted-runners.
- Use Ubuntu 22.04 to keep glibc baseline lower; GTK/WebKit runtime packages are still required.
- JDK compiler is bundled at D:/Program Files/JetBrains/IntelliJ IDEA/jbr/bin/javac.exe; generated Java fixtures compile with --release 17.
- Type inference preserves original integer ranges; heterogeneous object arrays merge keys and optionality; TS results checked with the local TypeScript compiler.
- New tools reuse the existing worker and add no production dependency.
- Color suite: EyeDropper is environment-dependent; feature-detect it and retain native color input + local image canvas sampling on all supported platforms (https://developer.mozilla.org/en-US/docs/Web/API/EyeDropper_API).
- WCAG 2.2 contrast uses sRGB linearization threshold 0.04045 and unrounded AA/AAA decisions (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum).
- Native image blob URLs require blob: in img-src CSP; added for local image decoding.
- UI refinement uses CodeMirror 6 basicSetup, controlled-state synchronization and language compartments. Editor and JSON/TS/Java/CSS parsers are loaded as local lazy chunks (https://codemirror.net/examples/basic/).
- Tab indentation includes the documented Esc-then-Tab escape hatch (https://codemirror.net/examples/tab/).

- Official yaml, jsdiff and sql-formatter APIs reviewed: https://eemeli.org/yaml/ ; https://github.com/kpdecker/jsdiff ; https://github.com/sql-formatter-org/sql-formatter . Use bounded aliases/diffs and local lazy imports.

- With Vite worker.format='es', final worker entry is ~27.5kB; YAML ~97.2kB, SQL ~263.8kB and diff ~12.2kB load as separate local worker chunks. Production CSP conversion tests passed.

## v1.2 inspection
- Current unified Electron version 45.0.0 and app 1.1.0. Cross-packaging Linux deb from Windows is supported by existing Python scripts.
- Existing packaging regression requires parent-first directory metadata, strict empty-root extraction, ELF architecture/glibc checks and sandbox permissions.
- Entire project is untracked in existing Git repository; preserve all files and do not reset checkout.

## v1.2 delivery findings
- Official Electron v45.0.0 Linux x64 archive SHA-256: 22f6a10bd3f7fef987ddbb379d3375ce664ad0c98a9a50f80c89f1718a0c3e3a, checked against GitHub release SHASUMS256.txt.
- Both actual Linux deb archives retain 14 parent-first directories, 76 files and the 4755 root-owned sandbox helper. Static maximum required GLIBC is 2.25 on amd64 and ARM64; target machine execution is still unverified.
- All three app.asar manifests are 1.2.0 and index.html matches current dist; release SHA-256 matches all three copied packages.

## Type conversion follow-up
- Preserve old JSON generator engines through legacy transform compatibility, while the visible catalog contains json-code and type-json only.
- Java-parser 3.0.1 may parse nested Record members as methods returning record; safe top-level declaration reparse corrects this and preserves source locations.
- Parser dependencies are lazy local chunks and run successfully under existing Electron CSP without unsafe-eval. lodash/lodash-es patched compatible overrides are needed for zero known dependency advisories.

## GitHub research (2026-10-24)
- Baseline: DevKit 1.3.0, 38 tools, 97 core tests; all files already untracked, preserve checkout.
- DevToys official repo https://github.com/DevToys-app/DevToys lists smart detection, XML, GZip, text analysis and extensions.
- IT-Tools official registry https://github.com/CorentinTh/it-tools/blob/main/src/tools/index.ts includes ULID, XML, network tools and converters. GPL-3.0; compare capabilities without copying code.
- CyberChef official repo https://github.com/gchq/CyberChef emphasizes composable data transformations and compression. Reuse existing send-result workflow and add content recommendations.


## v1.4 implementation findings
- Six tools added, 44 total. XML formatter and CodeMirror XML are lazy local dependencies; GZip uses native Compression Streams in Workers.
- Existing discovery ranked description mentions as highly as aliases, causing ULID's negative token warning to outrank JWT. Prioritize explicit aliases over prose.
- 117 core tests, 3 desktop checks, 2 release integrity tests, 8 Debian regressions and 4 generated Java compilations pass. Source Electron smoke passes new tools and recommendations.
- XML formatting may normalize whitespace; it is not a lossless converter or schema validator. GZip limited during stream reading, with independent Node zlib checks.
- ASAR extraction on Windows requires native path separators; corrected verifier after real-archive regression exposed this.
- Electron minWidth=800 prevented a 390px test viewport. Adjust only the test window minimum and assert actual viewport width before capturing responsive proof.

- Final v1.4 packages: Windows 112936325 bytes, amd64 93153586 bytes, ARM64 88053710 bytes. Shared build fingerprint 8115fee70a3179903ac8eeebd3b25287e1e52e54d8aa36770687c7305e71ec0a. Independently read final deb payloads; both application ASARs hash to 9bd3bf7edfdfcc2c60bf031bb657500e7d2e587fac79b93dba05e6ff6bd1b196 and match verified runtimes.
- A final metadata-only dependency declaration changed frontend asset names because App imports the package manifest. Integrity collection correctly rejected it. Restored the existing locked dependency graph, rebuilt and successfully recollected identical verified assets. Future optimization: isolate the app version constant from build metadata.


## home reference inspection (requested review only)
- Reference is LaunchPad, Vue/Pinia frontend + Express local backend. Actual App has service entries, Nginx, environment profiles, runtime state, backups and toolbox workspaces.
- Toolbox registry has 36 entries including Nginx location generation; excluding that leaves 35 non-Nginx tool entries. Verify count and detailed runtime-backed capabilities before reporting.
- Newly relevant gaps: TOML, OpenAPI, JSON Schema validation, Mock generation, structured JSON diff, Base32/Base58/Hex/ASCII, cURL parsing, HTTP client, port occupancy, table/CSV cleaning, SQL INSERT conversion, CSS layout, ENV comparison, gitignore and Compose snippets.
- User explicitly requests inventory first; do not implement or rebuild this turn.

- Confirmed registry count: 36 toolbox entries, 35 after removing nginx-location. Core modules outside Nginx remain service entries, config management, environment profiles, runtime state and config backup/restore.
- HTTP implemented types support GET/POST/PUT/PATCH/DELETE/HEAD, none/json/text bodies, Bearer/Basic/API Key, cookies, variables, assertions, collections/history and response comparison.
- Practical backend has preflight/environment/migration/delivery endpoints, but current Vue components only call practicalStore.scanPorts. Treat these separately as backend-only and omit Nginx-coupled parts from suggested visible functionality.

- Inventory saved as docs/home-feature-inventory.md: all 35 visible non-Nginx tools, project-level modules, HTTP details, API-only utilities and current DevKit gaps.
- Found migration caveats: enum detection option not consumed by entity inference; ref label needs semantic review; Linux port inspection lacks PID/process data; frontend Ajv dynamic compilation needs strict Electron CSP adaptation. No reference runtime tests or network actions performed.


## Project center implementation
- User selected LAN exposure for project center only. Added shared model: global project definitions plus per-user-selected environment profiles/variables and per-project overrides; no Nginx schema.
- Host store serializes versioned writes, rejects stale revisions, atomically saves current state + thirty snapshots together, uses a per-data-directory process lock, and preserves corrupt originals.
- HTTP server serves only portal build-manifest dependency closure. Password sessions, readonly default, origin/Host checks and write permissions are separate from Electron-only sharing/file capabilities. Shared server/model use only Node built-ins.
- Eight project/storage/HTTP regression checks pass; existing 117 core, 3 desktop and 2 integrity tests pass. Source Electron UI check running. Fixed test-helper quoting; then found the conflict test clicked save before async refresh completed, now waits for enabled controls.

- All final source and packaged Windows ASAR Electron flows pass, including real project portal browser login and blocked desktop JS/Worker routes. Desktop, light web portal and narrow dark portal visually inspected.
- Created standalone project-only ZIP using the portal manifest closure: no desktop entry, workers, node_modules or user data. Actual extracted Node process serves all portal assets, cookie login works, readonly writes are refused and desktop entry is 404. Host Node required, clients browser-only.

- v1.5 delivery: Windows x64 112957599 bytes, Linux amd64 93167198 bytes, Linux ARM64 88070658 bytes, standalone Node24 ZIP 103644 bytes. Three desktop builds share fingerprint 3909e24172a0f68a42e55af72931571b8722e482b98df7f05035ea66dd03df84. Final deb ASARs independently match runtime (40039deff27dae2a734374fe27470511a1b4785a6ab29a23fa78d2410cdfbf03).
- Electron/get refreshes SHASUMS even for cached archives. A GitHub timeout was recovered without skipping integrity: validated cached ARM64 ZIP against already downloaded official SHASUMS, then used packager electronZipDir. Release and per-package verification passed; details recorded in artifacts/verification-1.5.0.md.

## Project center refinement request
- User requires installed executable directory/configs as the authoritative portable data directory, with folder-copy transfer and JSON import/export. Existing implementation uses Electron userData/project-center and Node data/project-center; both need migration.
- Current UX issues: destructive native confirms, no dirty-dismiss guard, bulk actions target all filtered projects without explicit selection, no sorting/list view, cramped unlabeled parameter rows and preview has no URL component explanation. Existing conflict draft retention should be preserved.
- Linux /opt/devkit is root owned; need deliberate install-time ownership for configs rather than silently falling back to another directory or running the app as root. Folder-copy locks must be portable across machines.
- Implemented install-local data and first-start migration with both source and snapshots preserved. Existing configs always win. Folder-copy tests include a foreign-host lock with a live local PID; it recovers correctly without affecting same-host active-lock rejection.
- UI visual review: desktop/light portal are clear; mobile profile details consumed too much of the first screen. Condensed mobile profile buttons/hints, removed redundant backup text there, and changed mobile filters to three columns. Keep desktop cards/list and modal controls unchanged.
- Actual isolated NSIS harness executes the production cleanup macro and verifies nested configs bytes survive both simulated upgrade and uninstall, while all fixture runtime files are removed. No real installation or registry changed.
- v1.6 final desktop packages share source/runtime fingerprint 1e7038a67729215c5f46f35a5e38fbb9f283d2aa6a05dc69119891df650eba1e. Windows 112966906 bytes, amd64 93179028 bytes, ARM64 88079948 bytes, portable ZIP 116279 bytes. All final checksums verified.
- Configs-only transfer into a clean standalone installation works even when launched from a different CWD. Password env was omitted on restart to prove copied sharing settings are used. Same-host stale lock recovered after test process shutdown; projects and snapshots retained. Final compact cards measured 150 CSS px including description.


## README 自动维护审计
- 当前版本 1.6.0，工具定义分布于 tools/practical/developer/extended，catalog 是七分类顺序的来源。原 README 以版本历史为主，工具清单不完整且版本、路径多处硬编码。
- 打包入口包含 package-desktop.mjs、package-all.mjs（含 collect-only）、package-project-server.mjs / .py；需要覆盖直接运行脚本，而不仅 npm 前置钩子。
- 当前 git 工作区干净；现有发行产物保持不变。

- 自动生成使用 Vite 无监听 SSR 加载实际注册表（包含跨模块展开），关闭依赖扫描，避免另维护功能清单；模板承载非工具使用说明，AGENTS.md 记录后续功能变更的维护要求。
- 文档随安装包、输出目录、合集和服务 ZIP 分发，并附专题文档保证相对链接可用。

- 使用内置 Python 实际验证独立服务 Node 包装入口和 Python 直接入口：临时 ZIP 含最新 README 和 docs，根目录 README 与发行副本一致；未覆盖现有发行目录。
- 显式关闭 Vite HTTP 监听、WebSocket、HMR、文件观察和依赖扫描；生成只加载注册表，不运行转换、不启动局域网服务。
- 核心回归独立重跑 117/117 通过，确认首轮单项超时源于并行构建时的资源竞争；未修改超时阈值。
# 2026-10-24 功能界面审查
- 保持既有离线主题与本地字体；设计指引采用紧凑网格、清晰层级、可访问表单，不加载在线字体。
- ToolWorkspace 统一双框；应提供紧凑查询输入、计算结果卡、权限矩阵、Cron 时间线、JWT 分区、URL 参数表、摘要校验、统计指标、独立双文本对比与生成侧栏。
- 保留源码、复制、导出、取消、状态、导入、撤销、结果继续处理等现有能力；所有专属结果受成功状态约束，避免将旧结果展示为当前数据。
- 最终采用 15 种显式流程（含既有颜色工作区），覆盖 44 工具；文档格式化单文档、计算查询紧凑表单、专属业务结果、转换按方向对照。源码与实际 Windows ASAR 均通过全工具集成验证。
- v1.7.0 三个桌面包已完成并核验；两个 Linux 包内 ASAR 哈希相同，文档和当前源码一致，详细证据位于 artifacts/release-1.7.0/。
# 2026-10-24 明亮界面设计
- 当前为 React 19 / CSS / Lucide；保留既有工具注册、任务内存、项目中心与本地字体。
- 新视觉采用暖白、玉石绿、柔和 Aurora、悬浮侧栏与顶栏；Bento 快捷卡全部连接真实工具，Marquee 只显示现有工具类别。
- Skeleton 仅用于真实的编辑器 / 项目数据加载；减少动态效果时关闭循环与过渡。
- Vite 多入口会将共享设计 CSS 提前分块，可能被工作台原样式覆盖；以 theme.css 统一所有样式导入，确保桌面与 portal 层叠顺序一致。
- 实际截图确认首页、工具工作区和项目中心采用相同明亮视觉，项目卡仍保持 150 CSS px 紧凑高度。

## 2026-10-24 新一轮功能调研
- 用户要求先遵守 AGENTS.md 检索活跃、许可明确、高 Star 的 GitHub 项目，输出工具清单与实施方案，经审阅后再实现、打包、提交和推送。
- 当前 v1.8.1；44 个工具、7 类，React 19 / TypeScript / Electron 45，默认离线，桌面含 Windows x64、Linux amd64、Linux ARM64；另有项目中心独立服务。
- 既有工具包括 JSON Schema 样本生成（尚非校验器）、受限 JSON 路径提取、JSON/YAML/XML/CSV、类型双向转换、代码格式化、HTTP 代码、Cron UTC、文本 diff、网络和颜色套件。
- 工作区手动导出恢复、结果继续处理已存在；不作为新增功能重复计数。任务默认内存，敏感工具默认排除工作区导出。
- 现有 AGENTS.md 是用户未提交改动，保持原样。
- 已确认 electron/security.json 的 script-src 为 self，未允许 unsafe-eval；Ajv 官方安全文档说明运行时动态编译与严格 CSP 不兼容，预编译只适合已知 Schema，不能直接解决用户任意输入 Schema。
- 已核对 docs/home-feature-inventory.md 的早期候选；其中项目入口、环境档案、备份、批量探活后来已经实现，本轮不能照旧重复推荐。
- 第一轮 GitHub API：DevToys 32,105 stars / MIT / pushed 2026-09-29；IT-Tools 40,953 / GPL-3.0 / 2026-10-22；CyberChef 36,193 / Apache-2.0 / 2026-10-23；Ajv 14,864 / MIT / 2026-09-06；jsondiffpatch 5,349 / MIT / 2026-05-14。pushed_at 仅为仓库推送信号，不等于版本发布日期或修复保证。
- 浏览器访问带查询参数的两个 issues 页失败；改用 GitHub API 按仓库获取 issue 与包元数据。
{"repo":"cfworker/cfworker","stars":704,"license":"MIT","pushed_at":"2026-04-10T02:58:34Z","archived":false,"branch":"main"}
{"repo":"kozakdenys/qr-code-styling","stars":2970,"license":"MIT","pushed_at":"2026-02-14T03:52:51Z","archived":false,"branch":"master"}
{"repo":"kazuhikoarase/qrcode-generator","stars":2382,"license":"MIT","pushed_at":"2026-02-14T10:06:24Z","archived":false,"branch":"master"}
{"repo":"nayuki/QR-Code-generator","stars":6802,"license":null,"pushed_at":"2026-08-31T19:37:04Z","archived":false,"branch":"master"}
{"repo":"iarna/iarna-toml","stars":341,"license":"ISC","pushed_at":"2024-05-30T09:46:17Z","archived":false,"branch":"latest"}
- 第二轮选型：smol-toml 318 stars / BSD-3-Clause / 2026-10-10；cfworker/cfworker 704 / MIT / 2026-04-10；qrcode-generator 2,382 / MIT / 2026-02-14；Nayuki QR 6,802 / API 许可证为空但 README 与 TS 文件均明确 MIT / 2026-08-31；node-qrcode 8,180 / MIT / 2024-08-23，因此不能称其维护活跃。
- npm 最新元数据（调研快照）：@cfworker/json-schema 4.1.1、smol-toml 1.9.1、qrcode-generator 2.0.4、semver 7.8.5 均无运行时依赖；jsondiffpatch 0.7.6 依赖 @dmsnell/diff-match-patch；markdown-it 15.0.3 有六个直接依赖；DOMPurify 3.4.17 为 MPL-2.0 OR Apache-2.0，计划选 Apache-2.0。
- @cfworker/json-schema 官方 README 明确不使用 eval/new Function，支持 Draft 4/7/2019-09/2020-12，并列出少量不支持用例，适合作为 CSP 兼容候选；其 stars 少于 Ajv，应明确记录取舍并在实施第一步做实际 Electron 验证。
- smol-toml 默认 Number 会损失超大整数，提供 integersAsBigInt；默认 TomlDate 可能规范化无效日历日期，严格 Temporal 路径需验证；TOML 无 null、日期语义、注释无法双向保真均需明确。
- jsondiffpatch 默认对象数组按位置匹配，只有明确 objectHash 才按业务标识匹配；默认保留数组顺序，不自动猜 id。不得以 Number 解析大整数后比较。
- 调研访问错误：额外候选 isomorphic-gitignore 地址 404（不纳入方案）；markdown-it security.md / security.mts 路径 404，改用仓库目录确认实际文件；均未下载运行或安装第三方代码。
- 完成推荐方案 docs/feature-expansion-proposal-2026-10-24.md：6 个新工具（Schema 校验、JSON 结构比较、TOML、二维码、Markdown、SemVer）和 2 项工作台功能（命名参数预设、文本处理配方），另列后续候选。
- @cfworker/json-schema unsupported.ts 实际包含 2020-12 动态引用和 format/Unicode 等失败用例；方案因此限定支持集、未知/不支持约束必须报错，不能宣传完整 2020-12 兼容。
- 二维码拟选 Nayuki 官方 TS 固定提交、保留 MIT 与适配记录；JSON Diff 仅比较、按索引数组、不生成/应用 Patch，复用原文树避免大整数舍入。

## 2026-10-24 用户明确地图经纬度需求
- 用户否定上轮通用工具建议，当前唯一目标是：十进制度/度分秒互转；圆心+半径+北东南西计算圆周点；从混合文本提取度分秒坐标对；所有结果可复制。
- 延续用户最初的审阅要求，当前只出定向方案，不实现、不打包、不提交、不推送。建议一个经纬度工具内三个子页，共享解析、格式、精度与复制设置。
- GitHub API 快照：Turfjs/turf 10,524 stars / MIT / pushed 2026-10-21；chrisveness/geodesy 1,227 / MIT / 2024-07-10；geographiclib/geographiclib 486 / MIT / 2026-08-24；geographiclib/geographiclib-js 52 / MIT / 2026-07-14。推送日按 UTC，仅为维护信号。
- Turf 覆盖广且维护活跃，但 destination 是球面模型；GeographicLib 专长椭球正解，更符合圆心/半径计算，需要明确说明少 Star 的专业库选型取舍。
- geographiclib-geodesic latest 2.2.0，MIT、无运行时依赖、自带 TS 类型；尚未安装。
- 外部文档访问错误：SourceForge JavaScript API 页面无法读取，改看 GitHub 官方源码、类型和 README。
- geographiclib-dms latest 2.2.0 同为 MIT、无运行时依赖、自带 TS 类型；官方 Decode / DecodeLatLon / Encode 可供格式解析和格式化。旧 geographiclib 合并包已拆分，不使用已弃用包名。
- 已读取官方 Direct/Inverse/WGS84 类型与示例。Direction 需明确为真北起顺时针的起始方位角；地球曲面正东/正西测地线并不严格保持纬度，不能把它暗中当作平面坐标加减或等纬线。
- Turf destination 官方说明使用 Haversine 球面模型；本需求拟用 GeographicLib WGS84 椭球地表距离，不加载完整 Turf、地图瓦片或在线 SDK。
- 文本提取须先定位完整 DMS token，再成对匹配、按半球/标签识别经纬；无标签才用用户指定顺序。需保留原文位置和拒绝原因，不能跨不相关文本将孤立数字硬配对。
- 本轮错误：尝试 dms/src/DMS.js 返回 404，改为 GitHub contents API 确认路径；未安装或执行第三方代码。公开仓库当前没有返回开放 issue，不据此认定无问题。
- 已读取真实路径 dms/DMS.js：官方解析允许内部加减角度表达式，且显式负号与 W/S 符号相乘。方案明确必须先做单角度语法与符号一致性校验，不能直接放开底层 Decode 的全部能力。
- 用户认可三个页签等其他方案，仅继续询问圆周点是否还有常用算法；此问题不等于授权开始实施。补充调研：椭球 Karney、椭球 Vincenty、球面大圆正解、恒向线、投影平面方法。
- 需区分算法与需求语义：Karney/Vincenty 是同一椭球测地线问题的求解方法；球面改了地球模型；恒向线以路线长度为距离且固定航向，正东/西维持纬度，不等同于等最短地表距离圆；投影平面距离不一定等于地面距离，AEQD 中心等距是特定例外。
- 来源：GeographicLib Python 官方 geodesics/intro、Movable Type 作者原文 latlong / latlong-vincenty、Turf destination/rhumbDestination、PROJ AEQD 文档。推荐默认 Karney，按需要增加球面模式；恒向线应作为明确命名的另一种移动方式，不笼统称为更精确/更差算法。
- 最终交付仅经纬度三页签、椭球/球面两模型与复制能力。实际三架构包共享同一构建；两个 deb 实际 ASAR 与 Windows 预打包 ASAR 相同，许可/使用文档完整。验证边界及校验值保存在 artifacts/release-1.9.0/。
- 旧通用提案已转存 artifacts/research，不进入本轮代码提交或发行。

## v1.9.1 用户反馈修复
- 工作区初始只有用户既有 AGENTS.md 未提交修改。使用 planning-with-files 续记，并读取 ui-ux-pro-max，用 bundled Python 生成设计建议；其默认绿色 CTA 与用户意图冲突，不采用，按用户要求选择中性灰白和蓝色。
- 定位候选根因：提取坐标保留 Number 全精度，跳转时 String(point.lon/lat) 可产生 14–17 位小数或科学计数法；原十进制度正则只接受最多 12 位小数且不接受指数，内部结果因此被当作非法用户输入。需先补失败回归再修复。
- 浅色 theme-tokens.css 确实仍为暖白/玉石绿，design.css 另有绿色光晕和装饰；深色先前修改未同步浅色。明确改用灰白背景、中性文字与蓝色交互，成功语义与颜色工具业务色独立保留。
- v1.9.1 实际包内完整流转和浅色主题验证通过。保持全精度内部数据，展示/复制精度独立；未调整地理算法或减小坐标精度。所有新旧回归最终通过，根因与针对性回归均随修复提交。
# 2026-10-24 全工具逻辑审查
- 用户发现“填入经纬字段”暗中把 DMS 转成十进制度。根因为 GeoWorkbench 调用数值解析结果后 String 回填；应拆分校验并保留每个角度原文，仅显式转换生成新表示。
- 初步共享流程问题：ULID 模式切换无条件覆盖输入；工作台在失效/失败后仍允许复制/导出旧结果；坐标结果同时显示两种格式但单个复制按钮随隐藏在下方的复制格式选择，含义不够明确。继续逐工具验证。
- 完成 45 工具源码与实际 UI 首轮审查，确认并修复坐标原文、单值复制、ULID 草稿、失效/空结果、HTTP body 数字、JWT 数字、后续工具设置、差异交换/跳转和重复键等问题。完整逐项清单见 docs/tool-interaction-audit-2026-10-24.md。
- 追加边界：异步粘贴/导入完成时停止先前 Worker，避免旧输入的结果覆盖新输入；目标菜单随结果变化时，实际发送目标与当前选中项保持一致。
# 2026-10-25 固定分类导航
- 现有 7 类折叠标题 10px，展开改变后续分类位置；收起侧栏会显示全部 45 工具图标。用户批准固定分类 + 点击工具浮层。
- GitHub API 快照：radix-ui/primitives 19,420 stars / MIT / pushed 2026-10-14；microsoft/fluentui 20,353 stars / pushed 2026-10-23，API 许可 NOASSERTION，官方仓库 README 明确 MIT，使用其文档指导而不复制代码。
- 参考 Radix Popover 的受控状态、Escape / 外部关闭和焦点返回；Fluent 的 inline / overlay 响应式导航。Radix #4128 报告非模态浮层 Tab 被循环锁定，需验证可离开面板。
- 现有 React/CSS/Lucide 足以实现限定的导航，不引入完整组件库；桌面浮层保留主内容交互，窄屏在现有模态侧栏内替换分类列表并提供返回。
- 来源：https://github.com/radix-ui/primitives；https://www.radix-ui.com/primitives/docs/components/popover；https://github.com/radix-ui/primitives/issues/4128；https://github.com/microsoft/fluentui；https://fluent2.microsoft.design/components/web/react/core/drawer/usage。
- 当前仅 AGENTS.md 为用户原有改动。现有 Electron 用例依赖展开所有分类，需改为先打开相应分类，再点击真实工具入口。
- 最终交付 v1.9.3：导航不再展开45工具挤动分类；窄屏选择页隐藏其他导航以获得足够列表高度。最终ASAR通过全部交互验证；实际Linux包的ASAR、README及界面文档与Windows和源码一致，详见 artifacts/release-1.9.3。

## 2026-10-25 Nginx 调研与设计
- 读取用户命令.txt：start nginx -c 主文件；nginx -c 主文件 -s reload/quit；nginx -t -c 主文件。
- Windows 示例有8个 server 与 common_proxy.conf 共享 location，Linux 为单文件内联；保留注释、重复指令、嵌套块与变量是编辑器基础要求。
- 调研：0xJacky/nginx-ui（Go+Vue，结构块/源码双编辑），cym1102/nginxWebUI（Java，参数模板/代理/stream），digitalocean/nginxconfig.io（Vue，生成导出，不能直接管理已有实例）。仅借鉴设计，不复制项目代码或引入服务端栈。
- 官方命令说明：https://nginx.org/en/docs/switches.html；Windows说明：https://nginx.org/en/docs/windows.html。-c 指定配置，-p 指定 prefix；include 相对主文件所在目录（Nginx conf_prefix），日志/根目录/pid 相对 prefix。不可用 taskkill 全杀区分实例。
- 项目为 React/Electron，桌面通过受限 IPC 调用 Node 模块；LAN portal 只暴露项目中心，新 Nginx 功能限定桌面本机。持久化复用 configs 目录，原 conf 原地保存并做备份和外部修改检查。
- 开源调研补充：nginx-ui 11665 stars / AGPL-3.0 / 2026-10-24 push；nginxWebUI 2617 stars / LICENSE 明确为 MulanPSL-1.0（API 为 NOASSERTION）/ 2026-07-05 push；nginxconfig.io 28258 stars / MIT / 2024-12-14 push。nginx-ui #2038 描述共享 upstream 受站点操作影响，故本实现以原文件跨度修改、保留公共配置，不重新生成整份配置。
- 官方 nginx 1.28.0 Windows 测试运行时只下载到 artifacts/nginx-test-runtime，不打包 nginx，不改用户安装。真实检查/start/HTTP/reload/quit 通过。
- 实测 nginx 不接受 BOM；文件无损保存保留 BOM，界面提供显式移除 BOM 的草稿动作。-t 创建空 PID 的行为已纳入回归。
- 新建服务使用此前已调研的结构编辑/源码并存设计，模板按官方初学指南验证：http://nginx.org/en/docs/beginners_guide.html。主/附属文件独占写入、失败回滚、已有首页保留；18项定向回归含真实Nginx生成配置已通过。
- UI技能候选为高饱和营销风格，不适用于当前DevKit；按用户要求保留中性灰白/石墨灰与蓝色主题，仅采用间距、焦点、键盘和响应式建议。
- 参考Radix Alert Dialog的默认取消焦点/受控确认层，以及Electron will-prevent-unload语义：https://www.radix-ui.com/primitives/docs/components/alert-dialog；https://www.electronjs.org/docs/latest/api/web-contents#event-will-prevent-unload。共享确认不复制其代码，不引入依赖。
- 用户实际Windows配置含8个server（9011至9018），共同include含13条location/proxy_pass的common_proxy.conf；提示需区分实例/服务/路径规则，避免单端口单目标误解。
- 新手提示沿用现有字段编辑器，不引入依赖；以Nginx官方core/http/proxy/upstream文档核对语义。普通字段只填参数；新增配置块/全文则包含完整指令与分号；server在upstream内是后端节点而非前端站点，说明需按父层级区分。
- 用户实际启动失败源于自定义prefix下缺少temp父目录，原nginx仅对temp/client_body_temp调用CreateDirectory而不递归创建。新增目录准备需按实际include读取，不能将未引用的登记附件当成生效配置。
- 参考既有nginx-ui Docker运行目录预建和Nginx官方configure中的日志/临时目录选项，不复制代码。显式输出目录预先递归mkdir；隐式编译默认路径仅在真实-t报告对应缺目录时补齐，避免为未使用的系统默认目录索取权限。失败保留原文件且不启动，不生成配置/证书等输入资源。
- UI技能检索的高饱和营销候选不适用现有工作台，保持当前中性主题，仅采用短缓动、少量动效、吸顶不遮挡字段及prefers-reduced-motion建议。

## 2026-10-25 Nginx 高亮调查
- 现有 CodeEditor 使用 CodeMirror 6、StreamLanguage 和 CSS syntax 变量，可直接加载官方 nginx 模式。
- 官方 language-data 明确通过 @codemirror/legacy-modes/mode/nginx 加载 nginx。legacy-modes 为 MIT，GitHub 已迁至维护者自己的代码托管；Monaco 需替换现有编辑器并额外维护 Nginx 语法。
- 来源：https://github.com/codemirror/legacy-modes；https://github.com/codemirror/language-data/blob/main/src/language-data.ts；https://github.com/microsoft/monaco-editor。
- 实测 legacy nginx 模式错误：listen 8080 不输出数字 token，Host 被输出 number，$host 丢失高亮；因此移除试装依赖，改用现有 StreamLanguage 实现位置驱动的轻量词法规则。
- Ace 27,132 stars，2026-10-21 push；官方 LICENSE 为 BSD。借鉴其指令、字符串、变量、注释分层，不复制代码与关键字表，也不引入另一编辑器。支持未知模块；不充当 nginx -t 校验器。
- GitHub 快照：CodeMirror dev 7,807 stars，legacy-modes 107 stars / MIT，已于2026-04迁站；Monaco 46,883 stars / MIT，2026-10-23 push。Monaco替换成本较高，移动浏览器不受官方支持。
- 来源：https://github.com/ajaxorg/ace/blob/master/src/mode/nginx_highlight_rules.js；https://github.com/ajaxorg/ace/blob/master/LICENSE；https://nginx.org/en/docs/beginners_guide.html。
- GitHub日志证实run 40176844466 的 Windows test:nginx 有7项失败，根因均为TEMP的RUNNER~1路径与realpath展开的runneradmin路径不一致；Linux不受影响。日志保存在artifacts/ci-diagnostics/windows-40176844466.log。
- 修正所有Nginx测试目录使用realpath，并保留真实路径下清理边界断言；修复无nginx测试运行时的吸顶测试getComputedStyle(null)，只在反馈存在时检查其动画。

## 2026-10-26 HTTP 与关闭行为调查
- HTTP 当前只有方法/URL表单，头和body只能通过JSON编辑；已有受限Node发送、取消、超时、集合脱敏及草稿保护，复用这些能力。
- Electron 只有 beforeunload 的草稿确认，无托盘；需在窗口close拦截选择，并让显式退出继续触发草稿保护。
- 参考 Hoppscotch（MIT，Vue/TS，约80k stars）参数/头/正文分区；Bruno（MIT，Electron/React，约48k stars）本地集合/鉴权组织。两者均有近期维护；仅借鉴交互，保留已有React/CodeMirror与Node网络栈，不引入完整客户端依赖。
- 来源：https://github.com/hoppscotch/hoppscotch；https://github.com/usebruno/bruno；https://www.electronjs.org/docs/latest/api/tray；https://www.electronjs.org/docs/latest/api/dialog。
- 已知边界重点：JS JSON重序列化会损失大整数精度，正文使用原始文本跨度；浏览器CORS限制继续交由现有主进程客户端处理；Linux托盘依赖桌面环境，创建失败不得隐藏窗口。

- 扩展桌面回归发现既有分类浮层定位缺陷：getBoundingClientRect取得入场缩放后的620.8px高度，最终布局640px但ResizeObserver不监测transform变化，top212.2导致845px视口底部溢出7px。改用offsetHeight布局高度，维持原有严格几何断言。

- 最终全量桌面回归：46工具（40文本/坐标执行）、主题/四宽度、项目中心CRUD/共享/快照通过；Nginx提示焦点用例在nginx-smoke.cjs:121失败。用git archive导出未修改HEAD 6b1a6e8到artifacts/http-close-baseline，独立构建并运行相同--nginx-only，完全相同位置/条件失败，证实为既有问题。未改Nginx产品代码或放宽其断言。

- v1.10.8已解决前述旧桌面回归失败：悬停提示在截图期间收起、退场中的原生dialog仍占顶层，两者均为自动化未等待可交互状态。修正真实焦点/退场等待及显式提交后，实际Windows ASAR完整回归及GitHub Windows源码/包内回归全部成功，未改Nginx产品行为。

## 2026-10-26 项目档案独立
当前 schemaVersion 1 使用全局 projects，profiles 仅有 variables/overrides。store 将全部状态及快照写入 projects.json。需要 schema v2 将 projects 移入 profile，迁移时展开各档案覆盖。

完成schema v2：projects归属每个profile，项目编码/ID只在档案内唯一；configs/profile-<hex-id>.json为独立档案，projects.json只保存当前索引/版本与历史快照。ID十六进制编码避免Windows大小写碰撞。跨文件日志支持同进程失败恢复及崩溃重启恢复，未变档案不重写。旧v1覆盖展开为独立项目，原件留projects.v1.backup.json；无法从旧结构推断最初归属，因此保留各档案原先可见项目，由用户分别整理。导入与恢复预览按档案标记项目，对比按编码并集展示缺失与完整配置。

## HTTP/API 工作台调研 2026-10-26
用户明确调整为不嵌入第三方UI，参照成熟产品交互而沿用本项目主题，并要求完整、健壮。Scalar MIT 16319 stars、2026-10-25更新；Bruno MIT 47846 stars、2026-10-24更新；Hoppscotch官方MIT约80.6k stars，均活跃。Scalar API-reference npm1.76.0导入约55MB并依赖Vue，整合将引入第二设计系统，因此取消安装（package和lock未变）。采用原生项目/接口目录、设计/文档/调试视图、环境变量、响应契约、OpenAPI导入导出和configs文件存储。
校验依赖选择@cfworker/json-schema（MIT），官方支持draft4/7/2019-09/2020-12且通过4500规格断言，无eval/new Function，适合当前严格CSP。Ajv需运行时代码生成与当前renderer CSP冲突；在隔离Worker中运行Schema验证并加超时，避免大Schema或正则阻塞界面。来源：https://github.com/cfworker/cfworker/tree/main/packages/json-schema ，https://github.com/usebruno/bruno ，https://github.com/hoppscotch/hoppscotch ，https://github.com/scalar/scalar 。

离线实现已落地：API项目configs/http/api-workspace.json（当前+上次保存），独立目录锁、原子同步替换与版本检查；原HTTP集合保留并显式迁入。未引入Scalar/Vue，仅新增MIT @cfworker/json-schema4.1.1及官方2020-12meta数据。支持标准JSON Schema常用验证，动态引用/超时/异常/数字精度不足均不冒充通过；文本/表单按对应实例类型验证。OpenAPI本地循环引用打包与JSON原始示例导出回读保真已测；无法转换的外部引用/文件等明确拒绝。关键边界和依赖许可已写入docs/http-workbench.md、docs/api-workspace-design.md、docs/api-third-party-notices.md。

v1.11.0发行完成：共同构建87fe6e8224d220ec9795818c1b9ce6bb540c47d4b82aedd5e837672697572bbb，三平台实际ASAR同adcc34df9ac4a9531c86295bbb935541f59fc6f692c88a2fedb8c417bb005106；README及18指南一致。发布release id423908013，tag1.11.0来源2821ffc，14远端附件SHA与大小均匹配本地，latest状态确认。产物及验收在artifacts/release-1.11.0；Windows仍为NotSigned，Linux未做用户目标桌面/托盘实测，边界已附公开验收。

## 2026-10-26 局域网工作台共享
复用项目中心会话、同源与清单资源白名单；独立模块显式开启，Nginx注册路径仍限主机，远程仅已有实例与授权命令。复用nginxManager和apiWorkspace避免双重锁。HTTP客户端按会话隔离，退出/共享重启/连接断开取消请求。API项目限制16MB，保存传输上限16.1MB。普通HTTP浏览器不支持randomUUID，门户相关组件改用getRandomValues生成ID。参考GitHub nginx-ui（AGPL-3.0，约11k stars，近期维护，Go/Vue及配置/运行集中管理）和Hoppscotch（MIT，约80k，近期维护，TS/Vue及代理转发）。只借鉴架构，无复制和新依赖；关注公开鉴权问题，坚持统一会话鉴权，不增加旁路。来源：https://github.com/0xJacky/nginx-ui ；https://github.com/hoppscotch/hoppscotch 。
首轮集成测试HTTP夹具错误使用headers数组，已改为生产协议规定的对象后通过19项测试。

用户澄清：Nginx共享是运行DevKit主机的远程填写页面，全部路径和运行命令均属于该主机，不是客户端。已开放编辑访客的create/upsert/remove/discover，detect与command需要运行权限，pick始终不向浏览器开放；Node独立服务无需先用桌面登记实例。

全局共享入口调整：原共享表单在ProjectCenter内部，迁至Sharing.tsx单一Provider。服务仍走现有projectRequest/IPC，门户没有主机共享控制入口。状态与草稿分开维护，后台轮询不覆盖正在编辑的设置；顶部在窄屏显示地球图标与状态点并保留可访问名称。

## 共享与交互一致性审查
已确认：门户重复主题/退出；项目中心强制开放；全局canEdit绑三服务且HTTP编辑/发送混用；共享切换端口失败先停旧服务；门户生成代码按钮仅输出桌面提示；App全局快捷键只避开共享dialog；Nginx状态binary探测会运行-V，需对无运行权限的请求禁止隐式执行。拟采用services.projects(enabled/edit/probe)、nginx(enabled/edit/control)、http(enabled/edit/send)，共享身份与模块分离，服务关闭清除权限，新配置全关闭，旧设置转换不扩权。
使用ui-ux-pro-max查询：采纳渐进展示、权限就近组织、焦点/ARIA/响应式建议；保持现有配色和本地字体，不采用搜索结果的新营销风格或远程字体。

- 全局交互审查确认12类问题，修复服务独立/权限分离、全局操作重复、原服务原子切换、隐式程序检测、门户代码生成、空GET正文一致性、连接重试/会话恢复、全局快捷键及可选存储降级。设计参考Hoppscotch(MIT)和Portainer(zlib)逐能力/后端授权，无代码复制及新依赖；详见docs/interaction-audit.md。

## 2026-10-29 手动探活设计
已核对现有 probeProjects、IPC、HTTP 授权与界面：既有 HEAD/4秒/并发3/单批20项目，界面只支持勾选检测且截断20项。批准方案保留单次请求上限，通过前端三个工作线程逐项请求覆盖整档案并即时展示进度；服务端统一限制并发3。参考先前检索的 Uptime Kuma（MIT）及 Gatus（Apache-2.0），只借鉴设计，无新增依赖或代码复制。

v1.12.5发行完成：三平台和独立Node服务已发布，14附件远端大小/SHA256全部匹配，latest状态确认；同源CI四作业全部成功。发行地址：https://github.com/suyh1/DevKit/releases/tag/1.12.5 。
