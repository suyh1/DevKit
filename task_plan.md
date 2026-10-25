# Toolkit implementation plan

## 2026-10-25 分类导航浮层 v1.9.3
75. 核对开源导航实践，实现固定分类与桌面浮层 / 窄屏返回列表 — complete
76. 补充导航真实交互回归、同步文档并完成构建与验证 — complete
77. 制作并核验三平台安装包与独立服务 — complete
78. 提交并推送授权修改，核对远端 SHA，保留用户 AGENTS.md 修改 — complete
- 用户已选方案①并授权执行、打包、提交和推送。沿用现有三平台发行流程。

## 2026-10-24 石墨灰深色主题 v1.8.1
54. 按已审阅方案实现石墨灰 / 雾蓝，分离交互与状态配色并同步文档 — complete
55. 验证核心、文档、桌面视觉、全部工具与项目中心流程 — complete
56. 制作三平台安装包和独立服务包，核验内容与实际打包界面 — complete
57. 提交并推送 origin/main，确认远端提交 — complete

## 2026-10-24 v1.8.0 打包、提交与推送
51. 更新发行版本与文档并运行发行前检查 — complete
52. 制作三平台安装包和项目中心独立服务，校验产物与打包界面 — complete
53. 提交本次变更并推送 origin/main，核对远端提交 — complete

## 2026-10-24 明亮优雅的界面改造
48. 审查现有工作流，确定浅色 Aurora / Bento 设计 — complete
49. 实现悬浮导航、Bento 首页、分段切换、Marquee 与真实加载骨架 — complete
50. 验证桌面和窄屏、深浅主题及交互，更新使用文档 — complete
- 默认 Python Store 别名不可用，已使用 bundled Python 生成设计建议。
- 文档补丁首次因旧标题匹配失败而整体未应用，使用准确标题重新提交后成功。
- 独立界面复核首轮断言通过后未结束进程；已在分支中清理超时并显式退出，复核正常退出码。

## 2026-10-24 按工具功能重设计
44. 逐项审查全部工具并记录操作流程与专属设计 — complete
45. 实现查询、计算、生成、解析、统计、对比与编辑工作区 — complete
46. 回归与真实 Electron 界面验证，更新功能文档 — complete
47. Windows x64 / Linux amd64 / Linux ARM64 打包及一致性校验 — complete


## Goal
Build an offline cross-platform developer desktop toolkit, with Windows exe and Linux arm64/amd64 deb packaging.

## Phases
1. Inspect environment and confirm packaging architecture — complete
2. Implement desktop shell, tool engine and usable interface — complete
3. Add automated verification and multi-platform packaging workflow — complete
4. Build available local artifacts, verify interface and document delivery — complete
5. Add JSON → Java / TypeScript generators and more offline utilities — complete
6. Verify generated code, refresh UI and rebuild Windows artifacts — complete
7. Add visual color-management suite: picker, conversion, palettes, gradients, contrast and mixing — complete
8. Test color math and UI interactions, refresh documentation and rebuild Windows — complete
9. Refine design system, overview, navigation, command search and editor workspaces — complete
10. Verify light/dark themes and responsive interactions, document and rebuild Windows — complete
11. Add six practical offline tools with focused parsing and generation tests — complete
12. Verify production UI, update documentation and rebuild Windows v0.5.0 — complete
13. Product-level v1.0: task-oriented taxonomy, compact visual system and interaction design — complete
14. Implement multi-task workspaces, file workflows, settings and structured result views — complete
15. Verify user flows, accessibility, regression and Windows delivery — complete
16. Migrate all desktop targets to one Electron shell with bundled Chromium; remove active Tauri dependencies and build paths — complete
17. Build and inspect the ARM64 deb and Windows Electron package, test the isolated desktop bridge and document offline validation — complete
18. Fix missing Debian archive parent directories and add strict extraction regression tests — complete
19. Rebuild corrected ARM64 Debian revision, verify the actual artifact and document retry steps — complete

## Delivery status
- User's first Kylin install exposed missing directory entries in the original 1.1.0 deb. The old verifier missed this packaging defect. Rebuilt ARM64 revision 1.1.0-1 with 14 parent-first directories and 76 files, verified strict extraction into an empty root, root ownership and 4755 sandbox permissions. Eight packaging tests, 56 core tests and 3 desktop policy tests pass. SHA256SUMS and offline instructions refreshed; defective original moved to artifacts/legacy-deb. Actual Kylin retry/startup remains pending.
- v1.1.0 unifies all targets on Electron 45.0.0. Windows x64 NSIS (~107 MiB) and Linux ARM64 deb (83.5 MiB) generated. ARM64 archive audited: AArch64 executable, no WebKit dependency or system library files, preserved root-owned Chromium sandbox helper, highest glibc symbol requirement 2.25. 56 core tests, 3 desktop policy tests, generated Java fixtures and real Electron integration checks pass, including checks against the packaged Windows ASAR. Actual Kylin installation/startup and installer execution remain unverified on this Windows host.
- v1.0.0 product upgrade delivered: seven task categories, independent tasks, modern workbench UI, settings, file workflows and structured results. 56 tests plus frontend/Rust checks and generated Java compilation pass. Windows EXE/NSIS and versioned SHA-256 checksums are in artifacts/windows-x64. Verification details and native-dialog automation limitation are recorded in artifacts/v1-verification.md. Linux execution and system installation remain environment-dependent.
- v0.5.0 adds six practical offline tools (26 total); 45 tests and production UI checks pass. Windows installer/exe rebuilt, checksums refreshed and native startup smoke check passed.
- Windows exe and NSIS installer built successfully and copied to artifacts/windows-x64.
- Native exe startup smoke check passed. Nine core tests and frontend type/build checks passed.
- Linux amd64/arm64 build matrix configured; actual deb artifacts remain dependent on a Linux runner. No remote repository is configured, so these jobs have not been executed here.
- v0.2.0 extends to 14 tools. 24 tests pass; generated TS typechecks and 4 generated Java fixtures compile with Java 17. Windows installer rebuilt and copied to artifacts/windows-x64.
- v0.3.0 extends to 20 tools with six visual color tools. 35 tests pass; image pixel sampling, palette persistence/copy, gradients, contrast and themes verified. Windows bundle rebuilt with local blob image CSP support.
- v0.4.0 refines the app shell, overview, command search and editor workspaces; 35 tests and production UI checks pass. Windows installer rebuilt; screenshots saved under artifacts/preview-ui-*.png.

## Decisions
- User-selected stack: Tauri 2, React, TypeScript and Vite; prioritize small distribution size.
- Default language: Simplified Chinese; offline processing.
- Initial tools: JSON, encodings, timestamps, hash, UUID and regular expressions.
- Follow-up: prioritize JSON → Java and TypeScript; add JSON → CSV, JWT decoding, radix conversion, text transforms and HTML entity conversion (14 tools total).

## Errors
- Follow-up plan patch included an incorrect progress.md anchor; split into a targeted plan patch and appended log entry.
- A combined CodeEditor move/add patch was rejected as duplicate path; split the move and wrapper creation into sequential patches.
- Previous preview handle/server did not survive between turns; reacquired browser tab and restarted the local Vite dev server.
- Browser scroll used coordinates from an older, wider viewport; refreshed screenshot and used keyboard navigation for the narrow preview.
- New all-sample smoke test omitted existing regex options; corrected it to use the UI's centralized default options.
- TypeScript inferred literal `false` for the theme preference; fixed by explicit boolean generic.
- A dev-server attempt overlapped dependency replacement and found no Vite executable; wait for install completion before rerunning.
- Visual review found root text color did not inherit the dark theme variable; fixed root color inheritance.
- First Rust release build succeeded (3,151,360-byte exe); NSIS helper DLL download ended unexpectedly. Inspect official download/cache and retry bundling after correcting dependency download.

- Additional UI patch used a partial single-line JSX anchor; corrected to exact lines. Session catchup unavailable because Windows python is an uninstalled Store alias; restored context from project planning files.

- New tool count invalidated the old 20-tool assertion; updated to 26. TypeScript rejected heterogeneous invalid-option fixtures with optional undefined properties; added the explicit Options[] fixture type.

- Starting a duplicate preview server reported port 1421 already in use; reused the existing production server successfully.

- Rebuilding dist removed old hashed worker assets while a preview page stayed open; reloaded the final build and repeated diff successfully. CUA contenteditable fill timed out; used native select-all and paste, then verified controlled state and Ctrl+Enter.

- Initial export click showed the UI notice but no Downloads file; used the documented download-event waiter, then verified the actual returned file path and content.

## 2026-10-24 v1.2 developer tools upgrade
20. Implement twelve offline frontend/backend tools and integrate catalog/options/editor/export — complete
21. Add edge-case regression and real Electron worker/UI verification — complete
22. Build Windows x64, Linux x64 and Linux ARM64 packages, verify archives/checksums and update docs — complete



## 2026-10-24 unified type conversion
23. Merge JSON-to-Java/TS with language-specific options and migrate old workspace/preferences IDs — complete
24. Add safe Java/TS type-to-JSON sample generation with parsers, limits, cycle handling and tests — complete
25. Verify UI/worker, refresh documentation and all three architecture packages — complete



## 2026-10-24 GitHub research and v1.4 delivery
26. Compare established GitHub toolkits and prioritize gaps — complete
27. Implement selected offline tools and explicit content recommendations — complete
28. Run regression, Electron integration and improve release verification — complete
29. Package Windows x64 / Linux amd64 / Linux ARM64 and deliver research report — complete

- Session catchup: Python Store alias unavailable; restored context from existing plan, progress and findings.


## v1.4 delivery complete
- 44 offline tools, explicit content recommendations and improved search. All three actual packages collected under artifacts/release-1.4.0, checksums and shared source/runtime fingerprint verified. Research, installation and verification documents included. Linux/Kylin execution and Windows installer execution remain target-machine checks.

## home project reference inventory
30. Inspect home source, enumerate non-Nginx functions and compare with DevKit — complete
31. Present inventory for user selection before implementation — complete
- Scope: read-only reference inspection; no functionality implementation or packaging in this review turn.


## Integrated project center and LAN portal
32. Design shared project definitions, environment profiles, safe persistence and conflict handling — complete
33. Build desktop project center and authenticated project-only browser portal — complete
34. Verify domain/storage/LAN boundaries and actual desktop/browser workflows — complete
35. Document host/client setup, package Windows x64 + Linux amd64 + ARM64 — complete
- User selected project-center-only LAN exposure; existing toolkit is not exposed. No Nginx features.

## Project center refinement and portable configs
36. Audit entry/profile/backup flows and define a clearer responsive management UI — complete
37. Store configs beside the installed executable, migrate legacy data safely, support folder transfer and permissions — complete
38. Refine URL validation/previews, editing safety, selection/actions, import/restore workflows and desktop/browser parity — complete
39. Verify real UI, migration/transfer/permissions and regressions, update deployment docs — complete
40. Build and verify Windows x64, Linux amd64/ARM64 and portable server release — complete


## README 功能文档与打包同步
41. 核对当前工具、项目中心和打包入口 — complete
42. 重写功能导向 README，加入可重复的自动生成与打包接入 — complete
43. 验证文档更新、打包入口及现有回归 — complete
- 本次 session-catchup 因 Python Store 别名不可用未运行；已读取现有计划、进度、发现恢复上下文。

- 首轮核心回归与生产构建并行时，Java 解析测试超过默认 5 秒（其余 116 核心项通过）；构建完成后将独立重跑，暂不调整测试阈值。

## 2026-10-24 新一轮工具与功能调研（待用户审阅）
58. 核对 v1.8.1 现有能力、扩展点和重复项 — complete
59. 检索 GitHub 同类项目及候选依赖，比较许可证、活跃度、设计与问题 — complete
60. 形成分批工具清单、具体实现方案和验收/发行计划供审阅 — complete
- 审阅文档：docs/feature-expansion-proposal-2026-10-24.md；推荐 T1–T6 + F1–F2（6 工具 + 参数预设/文本配方），尚未得到实施授权。
- 当前仅分析和文档记录；用户审阅前不实现、不打包、不提交、不推送。
- 保留用户已有 AGENTS.md 修改。
- 调研错误：首次误读 src/tool-experience.tsx；实际文件为 src/tool-experience.ts，后续按真实路径查看。

## 2026-10-24 经纬度工具定向方案
61. 按用户三项需求核对地图算法、DMS 解析与文本提取边界 — complete
62. 比较开源实现并形成单工具三页签方案供用户审阅 — complete
- 当前审阅文件：docs/geographic-coordinates-proposal-2026-10-24.md；建议一个工具三页签，工具总数 44 → 45。
- 上轮通用工具方案已被用户否定，不纳入后续实施。
- 审阅前继续不实施、不打包、不提交、不推送。

## 2026-10-24 经纬度工具 v1.9.0 实施
63. 实现单工具三页签、严格坐标解析/文本提取、两种圆周算法和复制 — complete
64. 算法边界、工作区和真实 Electron 流程验证并同步文档 — complete
65. 打包三平台和独立服务、核验发行物 — complete
66. 仅提交授权文件并推送，确认远端 SHA — complete
- 用户已批准实施；圆周仅含椭球 Karney 和球面大圆，不含恒向线/沿经纬线模式。
- 保留用户 AGENTS.md 未提交修改；延续 planning-with-files 记录。

## 2026-10-24 v1.9.1 修复与浅色主题去绿
67. 复现提取/圆周点流转的全精度数字解析失败并补齐端到端回归 — complete
68. 将浅色主配色改为中性灰白/蓝色，清除背景与交互的硬编码绿色并同步文档 — complete
69. 回归与实际 Electron/主题截图验证，打包 v1.9.1 并核验发行物 — complete
70. 提交并推送修复，保留用户 AGENTS.md 修改 — complete
- 延续此前用户授权的实现、打包、提交推送流程；使用 ui-ux-pro-max 技能复核配色，保持现有布局与深色主题。

## 2026-10-24 全工具交互语义审查与 v1.9.2
71. 修正坐标对拆分保留原文，并审查 45 工具的输入/模式/复制/导出/流转 — complete
72. 修复确认问题，建立逐工具审查清单与实际交互回归 — complete
73. 同步文档、执行完整验证并制作核验 v1.9.2 发行物 — complete
74. 提交并推送授权修改，保留用户 AGENTS.md 修改 — complete

## 2026-10-25 Nginx 配置与实例管理
79. 调研成熟方案、核对示例与桌面架构 — complete
80. 实现无损配置解析、主/附属文件和跨平台实例管理 — complete
81. 接入平级导航、字段/全文编辑与操作反馈 — complete
82. 验证解析、文件冲突、命令隔离和真实桌面流程，同步文档 — complete
- 本轮需求为实施功能；不自动修改用户的示例配置、不自动操作已有 Nginx 进程。

## 2026-10-25 Nginx v1.10.0 发行与推送
83. 更新版本、生成文档并完成发行前检查 — complete
84. 制作并核验三平台安装包与独立项目中心服务 — complete
85. 核验打包后的真实桌面流程，提交并推送 origin/main — complete
- 用户已明确授权打包、提交和推送。当前分支 main，与 origin/main 同步，AGENTS.md 无未提交修改。

## 2026-10-25 Nginx 空目录创建配置
86. 定义跨平台双文件模板、目录初始化与无覆盖创建 — complete
87. 接入添加实例的新建模式与目录选择，验证原子性与真实nginx — complete
88. 同步文档、打包并提交推送增量修正 — in_progress
- 延续本会话已授权的Nginx实现、打包和提交推送流程。
