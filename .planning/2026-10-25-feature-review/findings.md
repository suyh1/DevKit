# 调研发现

- 当前 package.json 版本 1.10.6；React/TypeScript/Electron，离线优先，支持 Windows x64 与 Linux amd64/arm64。
- 现有 7 分类；工作台外另有项目中心与 Nginx 配置模块。
- docs/home-feature-inventory.md 是旧版对照，部分“无”已由当前项目中心实现，不能直接用作待开发清单。
- 当前已有项目快照/恢复、Nginx 备份载入草稿、多任务、工作区保存恢复、收藏和内容识别，应避免重复推荐。

## 本地盘点补充
- 当前 README 注册表为 45 工具；JSON Schema 仅由样本推断，没有 Schema+数据校验；JSONPath 仅字段/索引/通配符。
- HTTP 工具仅生成 Fetch/Axios/POSIX cURL，没有反向导入或发送请求。Cron 仅五字段 UTC。
- 文件读取仅 UTF-8 / BOM UTF-16 文本，8MB/200万字符；哈希为 UTF-8 文本 SHA。
- 项目中心已有环境变量/覆盖、共享只读或可编辑、手动 HEAD 探活、30份快照与预览；无自动轮询/探活历史。
- Nginx 已有多文件字段/全文编辑、语法高亮、外部冲突检测、保存前备份、nginx -t 与本机生命周期。日志仅为配置项，无日志阅读器；备份可载入草稿。
- 候选重点：Schema校验、结构化Diff、二进制文件摘要、编码修复、配方/批量、cURL导入、HTTP调试/OpenAPI/Mock、Nginx日志/变更审阅、档案对比、时区Cron。

## 开源核验（GitHub API 当前快照）
- 已保存 github-metadata.json：10个仓库均未归档。CyberChef/IT-Tools/Hoppscotch/nginx-ui/cron-parser本月有push；DevToys/Ajv为9月；jsondiffpatch最近push在5月，活跃度低于其他候选，不作为已确定依赖。
- CyberChef Apache-2.0，IT-Tools GPL-3.0，nginx-ui AGPL-3.0；其余已确认项目多为MIT。Faker API许可证NOASSERTION，必须读取LICENSE正文后再下结论。
- jsondiffpatch数组匹配依赖objectHash，否则按位置；不能直接JSON.parse破坏DevKit现有大整数保真约定。
- Ajv 2020-12与旧Draft不能混用同一实例；远程ref需单独设计，离线版本只允许显式导入的本地依赖。
- Hoppscotch网页请求需处理CORS；DevKit可以复用Electron主进程能力，但仅允许显式发送，不能为此关闭浏览器安全策略。
- cron-parser提供时区与DST，使用Luxon；应先补IANA时区，Quartz另行核验而不直接承诺兼容。
- nginx-ui #2038记录过共享upstream的操作影响多个站点，支持优先补共享配置影响范围预览。

## 接入边界补充
- 当前 electron/security.json 为 script-src self / connect-src self；Ajv 官方说明浏览器动态编译需要unsafe-eval，任意用户Schema不能靠构建时预编译解决。需另选解释型校验器或在受限后台线程中校验，保持页面CSP。故Schema校验估算中高，不列最低成本首批。
- Swagger Parser README当前承诺Swagger 2.0/OpenAPI 3.0，未以此承诺3.1；默认外部ref解析有LFI风险，首版应只解析用户显式导入的文档集合，不自动读任意磁盘路径/URL。
- Faker LICENSE正文及package.json均明确MIT，API NOASSERTION来自识别结果；本轮已人工核对。可按需加载中文locale和具体模块，固定seed使样本可复现。
- 依赖快照：Ajv依赖fast-deep-equal/fast-uri/json-schema-traverse/require-from-string；cron-parser依赖Luxon；swagger-parser依赖ref-parser/schema集合/Ajv；Faker无运行时dependencies。分支源码版本仅用于调研，不代表已选择发行依赖。
- jsondiffpatch根package是workspace，运行包位于packages/jsondiffpatch，补充读取该包；不把根包的空license误判为无许可证。
- 来源：https://ajv.js.org/security.html；https://github.com/APIDevTools/swagger-parser；https://github.com/faker-js/faker/blob/next/LICENSE；各仓库package.json。完整日期/stars/license见github-metadata.json。

## 已实现的设计与边界
- JSON结构Diff直接复用原文token树；未引入jsondiffpatch以保留大整数和重复键语义。数组业务标识匹配可识别移动，拒绝重复标识。
- Faker 10.6.0仅按需加载zh_CN locale，固定seed/参考日期，提供示例/明确Schema子集/规则及CSV；许可证已复制到docs/faker-license.txt。
- HTTP使用Node内置http/https/zlib，保留页面CSP；显式请求、不跟随重定向、默认TLS验证、绝对超时和取消、压缩/原始响应各4MB预算；集合显式本地保存，默认排除鉴权/常见敏感参数/正文。
- Nginx从实际include发现日志和上下文引用；读取日志前重新核对配置、普通文件检查、末尾1MB窗口、轮转身份检测。变更审阅重读磁盘并保留原有保存冲突/备份规则。
- 环境比较复用resolveProject，不改变数据/选中环境；桌面与门户均可读取比较，导出明文报告。
- 本次不发布、打包安装器、提交或推送；所有真实进程/网络测试均使用仓库隔离夹具。
