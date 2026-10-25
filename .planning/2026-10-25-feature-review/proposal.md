# DevKit 功能扩展候选清单（待审阅）

日期：2026-10-25。基线：v1.10.6，7 类、45 个离线工具，另有项目中心与 Nginx 本机管理。

本轮仅盘点、调研、提出候选，不实现功能、不修改产品文档、不打包、不提交推送。以下优先级和复杂度是结合当前代码的相对判断，不是工期承诺。用户选择后再确定最终依赖、验收边界和交付范围。

## 已有能力及筛选依据

- 工作台已有独立任务、Worker、取消、文件输入输出、结构化结果、手动保存恢复、收藏与用途识别；“继续处理结果”已经支持手动串联。
- 数据工具已有 JSON/YAML/XML/CSV、Schema 推断、有限 JSONPath、Java/TS 双向转换、文本 Diff。Schema 推断不等于数据校验，文本 Diff 不等于结构 Diff。
- HTTP 目前只生成 Fetch/Axios/POSIX cURL，不发送请求。Cron 仅五字段 Unix 与 UTC。
- 项目中心已有环境变量和覆盖、手动 HEAD 检测、局域网共享、导入合并、30 份快照和恢复预览。
- Nginx 已有主/附属文件编辑、高亮、外部冲突检查、保存前备份、配置检查、启动/优雅停止/重载、缺运行目录准备。日志路径字段不等于日志阅读器；备份载入草稿不等于变更审阅。
- 文件摘要当前为 UTF-8 文本；文本文件读取当前支持 UTF-8 和带 BOM 的 UTF-16，有 8MB/200万字符限制。
- 历史 docs/home-feature-inventory.md 的“当前缺口”针对旧版本，未直接沿用。

## 优先候选

| 编号 | 功能 | 当前缺口与建议首版 | 价值 | 复杂度 |
| --- | --- | --- | --- | --- |
| 1 | JSON 结构差异对比 | 在现有 Diff 上增加结构模式，按字段路径列出新增、删除、修改；对象键顺序不造成噪声，数组默认按位置，可指定业务标识字段；保留数字原文 | 对比接口响应和配置，减少格式差异干扰 | 中 |
| 2 | JSON Schema 数据校验 | Schema+数据双输入，定位字段路径、关键字和失败原因，先明确支持 Draft 2020-12；本地引用显式导入 | 补全“样本→Schema→验证数据”的链路 | 中高 |
| 3 | 二进制文件哈希与清单校验 | 文件流式计算 SHA-256/512，显示进度/取消，与粘贴摘要比对；后续支持 SHA256SUMS 文件和多文件结果 | 直接核验安装包和离线交付物 | 中 |
| 4 | Nginx 日志查看 | 从生效配置识别 access/error 日志，查看末尾若干行、关键词/级别筛选、暂停跟随、导出选中片段；处理日志轮转 | 配置检查/重载后即可继续排查 404、502 等故障 | 中 |
| 5 | Nginx 变更预览与引用影响 | 保存前对比磁盘与草稿；备份与当前文件对比；展示共享 include 被哪些已登记实例/服务引用，支持跳转 | 修改公共文件前看清修改内容和影响范围 | 中高 |
| 6 | 项目环境档案对比 | 开发/测试/生产并排比较变量、启用覆盖和解析后的地址；列出缺失变量；导出差异报告 | 减少切错环境、端口或地址的排查成本 | 中 |
| 7 | cURL 导入 | 常见 POSIX cURL 文本→现有请求配置→Fetch/Axios；覆盖方法、URL、Headers、文本/JSON body；未知参数明确提示 | 接住浏览器“Copy as cURL”的实际工作流 | 中 |
| 8 | Cron 时区预览 | IANA 时区、中文时间说明，UTC 与所选时区并列，展示夏令时边界；保持五字段语义 | 与实际本地调度时间对照，避免手工换算 | 中 |

首批建议选择 1、3、4、6：覆盖数据处理、离线交付、本机排障和环境管理，能独立交付。若近期重点仍在 Nginx，可将 5 提前。2 的用户价值高，但需要先解决校验执行架构再承诺实现范围。

## 后续候选

| 编号 | 功能 | 建议范围及与现有能力的关系 | 复杂度 |
| --- | --- | --- | --- |
| 9 | 文件编码与换行转换 | 显式选择 GBK/GB18030、UTF-8/16，预览解码结果；BOM、CRLF/LF转换；导出副本。自动识别仅作建议 | 中 |
| 10 | 可保存处理配方 | 把已有手动“继续处理”升级为可复用步骤，例如 Base64 解码→GZip 解压→JSON 格式化；逐步结果、失败定位，只保存步骤参数 | 高 |
| 11 | 多文件批处理 | 对选择的文件执行同一种转换或已有配方，逐项状态、取消、失败清单、结果目录；先做单工具批量，再接配方 | 中高 |
| 12 | OpenAPI 离线浏览 | 导入 JSON/YAML，按分组/路径搜索接口，查看参数和响应，生成现有请求配置；首版明确支持 OpenAPI 3.0，引用只来自显式导入集合 | 中高 |
| 13 | HTTP 调试工作台 | 扩展现有请求编辑器，显式发送、响应头/正文、状态、耗时、超时/取消、请求集合；敏感鉴权数据单独设计 | 高 |
| 14 | 批量 Mock 数据 | 从示例/受支持 Schema 生成多份 JSON/CSV，字段生成规则、中文数据、固定随机种子；先做数据生成 | 中高 |
| 15 | 离线二维码 | 文本/URL生成、纠错级别、尺寸、PNG/SVG导出，项目中心入口可直接生成；图片识别可后续增加 | 低中 |
| 16 | TOML 配置互转 | 补充 TOML↔JSON/YAML，明确日期、整数精度和无法映射值的处理；首次转换需呈现可能丢失的格式信息 | 中 |

顺序关系：7 可独立实现，也可作为 13 的前置；12 的文档浏览/请求生成不依赖 13；14 的数据生成不依赖本地 HTTP Mock 服务。10 和 11 应共用执行、取消和结果管理，首版避免同时建设两套任务引擎。

## 开源参考与接入判断

GitHub API 快照见 github-metadata.json。最近 push 只反映仓库活动，不等于每个功能均持续维护或当前发行版适用。下列是设计/候选库比较，本轮未安装依赖或复制源码。

| 参考项目 | Stars / 许可 / 最近 push 日期（UTC） | 借鉴方向 | 与当前项目的依赖、兼容及已知边界 |
| --- | --- | --- | --- |
| [DevToys](https://github.com/DevToys-app/DevToys) | 32,105 / MIT / 2026-09-29 | 小工具的专用交互与文件校验 | 不引入另一套桌面框架；复用当前 React/Electron 工作台 |
| [CyberChef](https://github.com/gchq/CyberChef) | 36,202 / Apache-2.0 / 2026-10-23 | 配方、逐步数据处理 | 借鉴步骤模型，接当前 transform/Worker；整套引入会增加体积及维护面 |
| [IT-Tools](https://github.com/CorentinTh/it-tools) | 40,961 / GPL-3.0 / 2026-10-24 | 配置互转、二维码等工具划分 | Vue 工具箱，主要参考功能与交互；不直接搬入源码 |
| [Ajv](https://github.com/ajv-validator/ajv) | 14,865 / MIT / 2026-09-06 | 标准化 Schema 校验及错误模型 | 多 Draft 使用不同实例；浏览器动态编译需要 unsafe-eval，与现有 CSP 冲突；需比较解释型库或受限后台线程，不能为接库放宽页面 CSP |
| [jsondiffpatch](https://github.com/benjamine/jsondiffpatch) | 5,351 / MIT / 2026-05-14 | 结构差异与数组匹配 | 数组对象需 objectHash；默认数字对象会丢失大整数精度，需适配本项目保真结构；维护活动相对较低，先作为算法/结果设计参考 |
| [Hoppscotch](https://github.com/hoppscotch/hoppscotch) | 80,681 / MIT / 2026-10-23 | HTTP 请求、集合、环境及导入 | 不整套移植 Vue 应用和后端；网页模式存在 CORS 限制，DevKit 需设计受限本机请求桥接，不关闭浏览器安全策略 |
| [Nginx UI](https://github.com/0xJacky/nginx-ui) | 11,666 / AGPL-3.0 / 2026-10-25 | 日志查看、版本比较、配置影响 | Go/Vue 系统，参考交互和边界，不引入其服务端；项目有 Debian 站点布局假设，不能替代 DevKit 现有多系统/任意配置路径模型 |
| [cron-parser](https://github.com/harrisiirak/cron-parser) | 1,501 / MIT / 2026-10-22 | 时区、DST 和时间迭代 | 依赖 Luxon；其六字段/扩展能力不等于完整 Quartz，先继续提供明确的五字段模式 |
| [Swagger Parser](https://github.com/APIDevTools/swagger-parser) | 1,207 / MIT / 2026-10-22 | OpenAPI JSON/YAML及引用解析 | 依赖 ref-parser、Ajv等；README承诺Swagger2/OpenAPI3.0，不能据此声称3.1；默认外部引用读取需关闭/约束 |
| [Faker](https://github.com/faker-js/faker) | 15,529 / MIT正文 / 2026-10-24 | 生成器、中文样本、seed | API识别为NOASSERTION，已核对LICENSE及package声明MIT；无运行时dependencies，需按需加载locale控制体积；不负责把任意Schema自动变成有效数据 |

关键直接依据：

- [Ajv Draft 支持](https://github.com/ajv-validator/ajv/blob/master/docs/json-schema.md)、[CSP及用户Schema边界](https://ajv.js.org/security.html)。任意用户Schema不能简单靠构建时预编译解决。
- [jsondiffpatch 数组匹配](https://github.com/benjamine/jsondiffpatch/blob/master/docs/arrays.md)。数组顺序变化、业务标识不唯一、重复键与大整数必须明确比较语义。
- [Nginx UI 共享 upstream 问题 #2038](https://github.com/0xJacky/nginx-ui/issues/2038)。这里只引用问题报告作为影响范围设计依据，不据此推断当前版本仍有该问题。
- [Swagger Parser 特性与默认外部引用边界](https://github.com/APIDevTools/swagger-parser)。
- [Faker 许可证正文](https://github.com/faker-js/faker/blob/next/LICENSE)。

## 范围取舍

当前优先延伸中文、离线、本机工作台。完整数据库客户端、SSH终端、容器管理、远程Nginx集群和云端AI助手暂不列入首批：它们需要新的连接、凭据、权限、平台与运维模型，适合用户有明确场景后单独立项。

本轮仅新增隔离调研目录中的笔记与本提案。没有调整注册表、README模板或任何产品行为，因此未运行产品测试或发行流程。
