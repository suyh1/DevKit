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
88. 同步文档、打包并提交推送增量修正 — complete
- 延续本会话已授权的Nginx实现、打包和提交推送流程。

## 2026-10-25 Nginx 弹窗与退出确认修正
89. 统一主题确认弹窗、处理窗口退出保护与实际草稿状态 — complete
90. 优化实例表单与无实例状态，验证键盘/主题/关闭取消与放弃 — complete
91. 同步文档，打包核验并提交推送v1.10.2 — complete
- 继续已授权的实现、打包与推送流程，保持整体主题配色。

## 2026-10-25 Nginx 新手填写与操作提示
92. 核对指令语义与现有多服务/公共代理配置，设计提示 — complete
93. 为实例字段、配置指令和操作补充可访问的中文说明 — complete
94. 验证实际配置覆盖、桌面交互与文档，打包提交推送 — complete

## 2026-10-25 Nginx 自动补齐运行目录
95. 核对默认/显式目录、include路径和失败语义，设计自动准备 — complete
96. 接入检查/启动/重载目录补齐及可见结果，验证无覆盖和跨平台路径 — complete
96a. 将实例信息、操作与执行反馈吸顶，加入克制动画并验证窄屏/键盘 — complete
97. 同步提示和文档，验证打包并提交推送 — complete

## 2026-10-25 Nginx 实例删除与提示精简
98. 提供明确的实例删除入口，覆盖草稿、选中切换和文件保留 — complete
99. 移除全部操作提示及问号，仅保留输入字段提示 — complete
100. 验证桌面流程、同步文档，打包并提交推送 — complete

## 2026-10-25 Nginx 全文语法高亮
101. 核对编辑器和成熟 Nginx 语言支持，接入现有主题 — complete
102. 验证源码编辑、深浅主题与文档同步 — complete
- 仅实现本轮高亮需求；不沿用历史记录中的打包、提交或推送授权。
- 环境错误：默认 python 为 Windows Store 别名，session-catchup 未运行；已读取现有计划与近期记录，工作区初始干净。

## 2026-10-25 v1.10.6 发行与 Windows CI 修复
103. 查明 GitHub Windows 检查失败并修复对应跨平台问题 — complete
104. 更新版本、文档，完成发行前检查与三平台/独立服务打包核验 — complete
105. 提交并推送，核对远端及新一轮CI结果 — complete
- 用户已明确授权本轮打包发布、提交与推送；对失败检查先读实际证据。

## 2026-10-26 HTTP 调试与窗口关闭行为
106. 检查现有实现并调研成熟 HTTP 客户端与 Electron 托盘 — complete
107. 完善参数、请求头、鉴权、正文及响应/会话历史 — complete
108. 实现关闭选择、记住行为、托盘恢复/退出与设置 — complete
109. 同步文档并验证模型、真实桌面交互及构建 — complete
- 本轮只实现与验证；未授权发行打包、提交或推送。
- 环境：默认 Python 为 Store 别名，catchup 失败；已读取现有计划与近期记录，初始工作区干净。

## 2026-10-26 v1.10.8 发行
110. 更新版本、完成发行检查并稳定已确认的提示测试时序 — complete
111. 制作三平台及独立服务包，核验真实产物 — complete
112. 提交、推送并发布GitHub Release，核对远端与附件 — complete
- 用户明确授权打包、提交、推送和发布。沿用现有三平台发行流程。

## 2026-10-26 项目档案独立存储
113. 核对共享项目根因与迁移设计 — complete
114. 实现档案独立项目、分文件存储、删除与方案对比 — complete
115. 回归验证与使用文档同步 — complete
- 本轮实施代码和文档，沿用现有目录；真实项目配置不在测试中使用。
- 已完成175核心测试、18项目服务测试、7文档测试及真实桌面/网页定向回归；生产构建、文档一致性和diff空白检查均通过。
- 初轮类型检查暴露旧测试模型和遗留覆盖分支引用；已更新模型及测试。桌面测试脚本首轮字符串转义错误已修正；首轮文档测试因Python别名跳过一项，使用bundled Python重跑7项全部通过。

## 2026-10-26 HTTP 调试与接口文档升级
116. 调研开源调试/文档一体方案与离线约束 — complete
117. 参考成熟项目原生实现完整接口管理/调试/文档工作流 — complete
118. 验证离线、迁移、真实桌面与同步文档 — complete
- 按本轮最后一项限制，不打包、不提交、不发布；保留上一轮项目中心修改。

- 完成188核心、5 HTTP/文件存储、18项目、4桌面策略和7文档测试；真实API端到端（含参数Schema失败阻止网络、响应Schema、导出回读）、原快速请求及关闭/托盘流程通过，生产构建通过。
- API功能边界与开源参考、离线数据、meta-schema许可均已记录；未做发行打包、Git提交或发布。

## 2026-10-26 v1.11.0 发行
119. 更新发行版本并核对全部本地改动、依赖和验证入口 — complete
120. 完成源码与真实桌面验证，提交并推送实现 — complete
121. 制作并核验Windows/Linux双架构与独立服务包 — complete
122. 等待CI、发布GitHub Release并核对远端附件 — complete
- 用户明确授权全部提交、打包、推送和发布，撤销上一轮暂不发行的限制。

- v1.11.0已作为latest公开发布：https://github.com/suyh1/DevKit/releases/tag/1.11.0 。14份附件均按远端大小与SHA256核对一致，来源2821ffc，CI40278166607四作业全部成功；完成记录另行文档提交，不改变发行二进制或标签来源。

## 2026-10-26 Nginx 与 HTTP 局域网共享
- 调查并说明共享架构与权限 — complete
- 实现服务、网页、独立入口与文档 — complete
- 验证鉴权、权限、冲突、发送取消与构建 — complete

- 补充远程填写主机实例与路径表单，验证主机执行语义 — complete

## 2026-10-26 v1.12.0发行
- 更新版本、核对变更和发行前检查 — complete
- 提交并制作三平台安装包与独立服务，核验真实载荷 — complete
- 推送、等待CI、发布并核对远端附件 — complete
用户已授权提交、打包、推送和发布全部本次共享修改。

- v1.12.0已作为latest发布：https://github.com/suyh1/DevKit/releases/tag/1.12.0 。14份附件大小与SHA256均匹配，注解标签来源6cbfeb7a9da80fc9a8e565e48d647969cde8e539，CI40314617517四作业全部成功。

## 全局共享入口
- 提取统一共享面板和状态服务，接入顶部及模块快捷入口 — complete
- 更新文档并验证全局状态、保存/停止、草稿保护及窄屏 — complete

## v1.12.1 全局共享入口发行
- 更新版本并完成发行前验证 — complete
- 提交推送、制作三平台与独立服务并核对载荷 — complete
- 等待CI、发布正式版并核对远端附件 — complete
用户已授权提交、打包、推送及发布本次全局共享入口调整。

- v1.12.1已作为latest发布：https://github.com/suyh1/DevKit/releases/tag/1.12.1 。14份附件大小和SHA256均匹配；来源6bc0d9f58ef3fef02cfff6fd9f3e17f3bbe5473f，CI40318634420四作业全部成功。

## 共享与全项目交互一致性审查
- 梳理全局操作、默认值、权限依赖、数据/执行边界及失败行为 — complete
- 实现三服务独立权限、门户统一控制、共享切换与兼容策略 — complete
- 修复同类交互缺陷并完成权限矩阵/真实交互/文档验证 — complete
用户要求审查整个项目是否有同类不合理行为，发现影响使用或权限边界的问题一并修复。

## v1.12.2 共享一致性修复发行
- 更新版本、完成发行前检查并提交推送 — complete
- 打包三平台与独立服务并验证实际载荷 — complete
- 等待CI、发布并核对远端附件 — complete
用户明确授权提交、打包、推送及发布本次审查修复。

- v1.12.2已作为latest发布：https://github.com/suyh1/DevKit/releases/tag/1.12.2 。14附件发布前后大小与SHA256均匹配；来源6c0db675f116c91ec2f1a38a0bc6a6c19070178b，CI40328143760四作业全部success。

## 2026-10-27 共享网页版15项修复（已批准）
- 修复门户滚动、HTTP高度与Nginx吸顶 — complete
- 修复复制、调试覆盖值、过期状态与退出 — complete
- 统一导航、缺变量修复、文案、帮助、焦点、草稿与反馈 — complete
- 真实LAN HTTP/真实点击回归、文档同步与逐项验收 — complete
用户已明确批准全部15项修复；本轮未要求提交、打包或发布。

## v1.12.3 共享网页版修复发行
- 更新版本、核对检查并提交推送 — complete
- 制作三平台和独立服务包，验证实际载荷与包内交互 — in_progress
- 等待CI、发布并核对远端附件 — pending
用户已授权提交、打包、推送和发布全部15项修复。
