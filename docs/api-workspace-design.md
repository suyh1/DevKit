# API 工作台设计与开源参考

调研日期：2026-10-26。本次采用原生React组件和现有主题，不嵌入其他产品页面、Vue应用、iframe、远程站点或第二套设计系统。运行时没有CDN、云账号、远程字体、公共代理和遥测依赖。

| 参考项目 | 维护与许可证核对 | 采用的设计思路 | 集成取舍 |
| --- | --- | --- | --- |
| [Bruno](https://github.com/usebruno/bruno) | MIT；约47.8k Stars；GitHub API最近推送2026-10-24 | 离线项目、目录与接口管理，显式保存与本地数据所有权 | 参考工作流，不带入其完整Electron应用、Bru存储或脚本系统 |
| [Hoppscotch](https://github.com/hoppscotch/hoppscotch) | 社区版MIT；官方仓库约80.6k Stars；持续维护 | 参数/鉴权/正文编辑、请求响应、环境切换、导入导出 | 使用当前受限Node HTTP客户端，保持桌面本机请求、取消、超时和CSP |
| [Scalar](https://github.com/scalar/scalar) | MIT；16,319 Stars；GitHub API最近推送2026-10-25 | OpenAPI作为接口与文档的共同来源，定义、文档与调试并行 | 未安装其组件；api-reference 1.76.0发布包解压约55MB并依赖Vue，原生实现更适合项目主题 |

Star数量为调研时近似或快照值，更新会变化。以上只参考通用交互和组织方式，没有复制产品商标、视觉资产或整套源码。

## 数据与交互

- API项目独立管理目录、服务地址、环境、接口，保存在configs/http/api-workspace.json；接口内的参数、鉴权、正文和响应定义同时用于文档与调试。
- 三个视图为接口文档、接口设计、运行调试；项目树、选中接口、环境与草稿状态始终明确。长文档在内部滚动，目录和主要操作保持可访问。
- 查询、路径和Header/Cookie参数逐项定义启停、必填、基本类型和示例。路径值与表单值按位置编码；JSON字符串变量替换不会重新序列化数字。
- 原HTTP快速请求完整保留，生成代码的流转仍进入快速请求；旧集合可显式迁入API项目，不在升级时擅自合并或删除记录。
- 保存检查版本并原子替换，保留上一个完整版本；冲突/失败保留草稿，刷新不静默丢弃输入。项目/接口删除、完整备份导出、导入提交及恢复均有明确确认。

## 校验器选择

使用 [@cfworker/json-schema](https://github.com/cfworker/cfworker/tree/main/packages/json-schema) 4.1.1（MIT）作为本地Schema验证引擎。它以解释执行方式工作，不需要eval或new Function，适合当前严格CSP；官方说明使用JSON Schema测试集验证。相比Ajv的运行时代码生成，这一方式无需放宽renderer策略。没有将其“通过测试集”等同于支持所有方言和扩展：当前明确使用2020-12常见词汇，并将不支持的动态引用标记为未验证。

官方JSON Schema 2020-12 meta-schema的schema/core/applicator/unevaluated/validation/meta-data/format-annotation/content文件保存于src/api-schema-meta，构建时一并编译到Worker。验证前先检查Schema定义；再验证正文。Worker限制2秒，超过预算或精度不足不会判为通过。运行时不抓取远程引用，不执行用户脚本。新增依赖及meta-schema的原始许可说明见[第三方声明](api-third-party-notices.md)。

## 导入转换与已知边界

OpenAPI支持3.0/3.1、Swagger支持2.0；可读JSON/YAML并解析同文档引用，循环Schema使用本地defs打包，导出回读验证覆盖循环引用与JSON示例数字原文。外部/多文件引用、无法可靠转换的参数序列化、同时要求多种鉴权、multipart和二进制正文会明确拒绝；多媒体或可选鉴权取舍先列出警告。基础Postman请求可转入，继承变量、继承鉴权、脚本等不承诺完整兼容。导入先预览，失败不写文件。

当前覆盖HTTP接口定义、文档和调试的本地工作流，不等同于Apifox全部产品能力。没有团队云同步、交互OAuth授权、文件上传、gRPC、WebSocket、用户脚本运行器、Cookie jar或HTTP/2。完整支持范围及使用步骤见[HTTP/API工作台说明](http-workbench.md)。

## 验证入口

- npm test：请求构造、变量转义、参数类型、导入导出、循环Schema、数字原文和校验器异常等核心回归。
- npm run test:http：本地HTTP传输与API文件存储、并发版本、失败写入、损坏保护和恢复。
- node scripts/smoke-desktop.mjs --api-only：真实桌面创建/设计/文档/发送/响应校验、文件重载、草稿保护、取消、导入失败、导出及离线资源与响应式检查。
- node scripts/smoke-desktop.mjs --http-close-only：原快速请求及托盘/退出生命周期回归。


局域网入口复用相同API存储管理器，保存仍检查revision并保留上次保存。只读访问禁止持久化及HTTP发送；详情见 [共享工作台](workspace-sharing.md)。
