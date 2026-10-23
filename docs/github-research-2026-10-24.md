# GitHub 同类工具调研与 DevKit v1.4 改进

调研日期：2026-10-24。基线为 DevKit v1.3.0、38 个离线工具。以下结论来自公开仓库 README、工具目录和本地代码对比；优先级为针对本项目的判断，不是上游项目排名。功能参考与代码复用分开处理，本次未复制这些工具箱的源码。

## 参考项目

| 项目与直接来源 | 可借鉴之处 | 对本项目的意义 |
| --- | --- | --- |
| [DevToys](https://github.com/DevToys-app/DevToys)（MIT） | 内容识别、分类工具、XML、GZip、文本分析、扩展机制 | 从“用户记得工具在哪里”改进为“内容提示下一步” |
| [IT-Tools](https://github.com/CorentinTh/it-tools) 及[工具注册表](https://github.com/CorentinTh/it-tools/blob/main/src/tools/index.ts)（GPL-3.0） | 覆盖网络、标识符、配置转换等日常场景 | 补足子网、Unix 权限和 ULID 等短小、高频工具；仅借鉴功能方向 |
| [CyberChef](https://github.com/gchq/CyberChef)（Apache-2.0） | 压缩、编码、数据分析和组合处理流程 | 用已有“继续处理结果”串联步骤，后续再考虑可保存的配方 |

本项目已有优势：中文离线桌面工作台、Java / TS 双向类型转换、独立任务、Worker 隔离与取消、精确保留 JSON 大整数、颜色套件，以及 Windows / Linux ARM64 / Linux amd64 统一运行时。无需为模仿其他项目而重写桌面架构。

## 本轮实际完成

| 改动 | 能力与边界 |
| --- | --- |
| XML 格式化 | 2 / 4 空格、压缩、注释 / CDATA / xml:space；最多 200,000 字符。拒绝 DTD / ENTITY，不校验 XSD。排版可能规范化空白、引号及换行，不是字节无损转换 |
| GZip 文本编解码 | UTF-8 文本 ↔ GZip Base64；流式读取并在超过 4,000,000 字节时停止；拒绝损坏流与非 UTF-8 结果 |
| IPv4 子网 | CIDR 与连续点分掩码、网络 / 广播 / 主机范围；/0、/31、/32；不枚举大网段、不联网 |
| chmod 权限 | 八进制与 rwx、带文件类型前缀输入、setuid / setgid / sticky；只给出命令示例，不执行、不修改文件 |
| ULID | 1–1,000 个生成、可选毫秒时间、逐行解析时间字段；同批次单调递增，不承诺跨任务或进程单调性；不作为密码或访问令牌 |
| 文本统计 | 字节、UTF-16、码点、字符簇、分词、行数与 CRLF / LF / CR；包含空白，分词依赖运行时 ICU |
| 内容推荐 | 首页显式粘贴 / 手动输入后识别；推荐 JSON、XML、URL、JWT、类型源码、GZip、ULID、时间戳、子网、权限等对应工具；携带原文及正确模式打开独立任务。最多 200,000 字符，不读取后台剪贴板、不自动执行转换、不保存内容 |
| 搜索排序 | 工具名称优先，其次显式用途别名，再看简介。修复 ULID 简介中的“令牌”提示干扰 JWT 搜索的问题 |
| 处理链 | GZip、XML、文本统计接入“继续处理结果”入口，复用原有任务串联方式 |
| 打包一致性 | 验证实际 ASAR 中应用版本、所有 dist 文件（包括懒加载 Worker / 解析器）、主进程和预加载代码；生成包级构建凭据并关联安装包 SHA-256。汇总时拒绝旧构建、错架构、被改动文件；三目标必须共享同一构建指纹 |

本轮将工具数从 **38 增加到 44**，保留七个任务分类。新 XML 解析与高亮随应用本地分发，运行时不需要网络服务。其余算法使用浏览器内置能力或项目内实现。

## 后续建议与优先级

| 优先级 | 功能或改进 | 当前缺口与建议做法 |
| --- | --- | --- |
| P1 | 文件哈希 / Base64 文件 | 现有哈希面向文本。加入二进制文件流式读取、进度、取消和大小限制，可直接核对离线安装包 |
| P1 | JSON Schema 校验 | 现有工具是从样本推断 Schema。应另加 Schema + 数据双输入与错误路径；支持范围先明确一个 Draft |
| P1 | Cron 时区与语义 | 现有五字段、UTC 预览；增加 IANA 时区、夏令时提示，并明确区分 Unix / Quartz，避免混用 |
| P1 | cURL 导入 | 现有 HTTP 工具从 JSON 配置生成 Fetch / Axios / cURL；反向解析常用 cURL，仍不发送真实请求 |
| P1 | 配方与批处理 | 先支持少量明确步骤、逐步输出、失败定位；只保存步骤参数，输入与敏感密钥继续默认不保存 |
| P1 | 麒麟原机验收 | 在真实 ARM64 机器验证首次安装、沙箱、启动、文件导出、字体和显卡环境；归档校验不能代替运行验收 |
| P2 | TOML ↔ JSON | 服务端配置使用频繁；需先定义日期和大整数映射，避免静默损失类型 / 精度 |
| P2 | QR Code | 优先离线生成和 PNG / SVG 导出；识别图片另设像素和资源预算 |
| P2 | UUID v7 | 与 UUID v4 / ULID 同组；遵循标准版本位及跨调用时钟处理，加入固定测试向量 |
| P2 | Markdown 预览 / HTML 转换 | 有需求后引入受限渲染，默认不加载远程图片和不执行 HTML / JS；与导出能力一起设计 |
| P2 | JSONPath 扩展 | 当前选择器仅支持明确子集；若加入过滤 / 递归，应采用安全解析器、结果数量上限和超时，禁止 eval |
| P2 | 交付签名与体积 | 当前 Windows 包未签名。配置签名需实际证书；保留 Electron 对麒麟的适配方式，用依赖分块和压缩减少增长 |
| P3 | 插件系统与多语言生成 | 先稳定工具定义 / 输入输出契约、版本迁移与资源预算，再考虑插件或 Go / Python / C# 生成器 |

## 验证方式与交付

- `npm test`：117 项核心测试，包括 zlib 独立交叉校验 GZip、解压膨胀上限、全部 4096 种 Unix 权限组合、子网边界、Unicode 字符簇和内容识别。
- `npm run test:desktop`：3 项桌面策略检查。
- `npm run test:release`：2 项打包完整性检查，使用真实 ASAR 验证旧 Worker / 预加载代码会被拒绝。
- `python scripts/test-deb-packaging.py`：8 项 Debian 归档回归。
- `npm run test:java`：4 份生成 Java 示例的 JDK 17 编译。
- `npm run test:electron`：真实 Electron 环境验证新工具 Worker / UI、内容推荐传参与方向、窄窗口、CSP、Web Crypto 和原生保存桥接。
- `npm run bundle:all`：Windows x64 NSIS、Linux amd64 deb、Linux ARM64 deb，输出至 `artifacts/release-1.4.0/`。
- `npm run verify:release`：复核三目标文件、大小、构建指纹、`release.json` 与 `SHA256SUMS`。

最终包大小、校验值与环境限制见 `artifacts/verification-1.4.0.md`。Linux 安装和运行需要在目标机器确认；本机是 Windows，不把静态校验描述为麒麟实测。

## 实现依据

- XML 排版依赖 [xml-formatter](https://github.com/chrisbottin/xml-formatter)（MIT），遵循其 strictMode / collapseContent / xml:space 支持范围。
- GZip 使用 [Compression Streams 标准](https://compression.spec.whatwg.org/) 的压缩 / 解压流，在 Worker 中执行。
- /31 主机范围遵循 [RFC 3021](https://www.rfc-editor.org/rfc/rfc3021)。
- ULID 时间位宽、Crockford Base32 与溢出规则参考 [ULID 规范](https://github.com/ulid/spec)。
