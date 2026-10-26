# 局域网共享工作台

项目中心、Nginx 配置及 HTTP 工作台使用同一个地址、访问口令和会话。客户端只需现代浏览器；数据、文件路径、nginx 程序和 HTTP 请求都属于共享主机。`127.0.0.1` / `localhost` 指主机，不是访问网页的电脑。

## 桌面开启

在桌面顶部工具栏的 **局域网共享** 设置监听范围、端口和至少 8 位的独立口令。项目中心、Nginx 配置、HTTP 调试是三个独立服务，可任意组合开放，也可只开放其中一个；首次配置不预选服务。至少选择一个服务才能启动。每项服务的访问权限紧随开放开关显示，关闭服务会清除该项授权，再次开启从只读开始。

| 服务 | 开放后可查看 | 独立编辑权限 | 独立执行权限 |
| --- | --- | --- | --- |
| 项目中心 | 当前档案、项目和入口 | 保存、导入、删除、恢复档案及项目 | 检测项目入口 |
| Nginx 配置 | 已登记实例、配置、日志、备份 | 登记/修改/删除实例、新建配置、保存文件 | 检测主机程序、检查、启动、重载、优雅停止 |
| HTTP 调试 | 接口项目、文档和环境 | 保存、恢复接口项目 | 从主机发送请求、取消自己的请求 |

编辑和执行互不附带授权。例如可只允许 HTTP 调试而禁止修改接口定义，也可只编辑 Nginx 配置而不允许运行命令。所有授权均在主机 API 校验，关闭服务后即使直接调用接口也无法访问。

顶部入口显示共享状态，悬停可查看地址；项目中心、Nginx、HTTP 的“共享设置”打开同一面板。面板中的设置是草稿，点击“开启共享”或“应用并重启”才生效。应用成功会使原会话失效、取消共享请求；绑定端口或保存设置失败会保留原服务、口令、权限与会话，表单草稿保留以便修正。停止共享也关闭下次自动开启偏好。

旧配置迁移保留原来已经授予的权限，不会扩权：原项目中心仍开放，旧全局编辑只迁移到原已开放的服务，旧 Nginx 运行仍需原先的编辑与运行开关同时成立。面板提示检查迁移权限，之后可独立调整或关闭项目中心。

浏览器顶部统一提供服务切换、浅色/深色/跟随系统主题及退出登录；模块内部仅保留自身操作。只展示已开放的服务，默认进入可用服务，切换时保留草稿。退出会先确认，再清除当前页面会话和请求。会话失效时提示重新登录并保留当前草稿，可先关闭提示导出；重新登录后按最新权限显示。

Nginx 模块开放后，持有口令者可以看到已登记实例的完整配置、路径和日志。HTTP 项目包含正文、鉴权值及环境变量；只向可信协作者开放。所有访客共用一个角色，尚无独立账户、按实例或项目分权及实时协同编辑。HTTP 未加密，仅用于可信局域网。

## 数据与操作

- Nginx 网页是主机工作台的远程表单。编辑访客可以新建配置、登记/修改/删除实例，手动填写主配置、附属文件、运行目录及 nginx 程序的主机路径。网页不弹访问者电脑的文件选择器，也不上传客户端配置文件。路径解析、创建/保存、备份和命令执行均在运行 DevKit 的共享主机完成；删除实例仍只取消登记，不删除配置原文件。程序检测也在主机执行，因此与运行命令一样需要额外运行权限。没有运行权限的状态查看不会隐式启动 nginx -V；若缺少既有程序检测结果则显示待确认。状态未确认停止时拒绝修改 pid / include，避免失去进程识别。独立 Node 服务同样支持远程填写，无需先在桌面登记。运行 nginx 需主机已安装、平台匹配且进程身份可确认。
- 配置保存检查文件哈希，API 项目保存检查 revision。多人同时编辑时，后保存者遇到冲突会收到提示，草稿仍保留；重新读取并核对后再保存，不自动合并。保存接口项目前需使用“刷新API工作区”取得其他人的变更。
- API 项目、接口文档、环境和上次保存备份共用 `configs/http/api-workspace.json`。工作区数据最多 16MB；网页保存请求最多 16.1MB（含封装）。其他管理请求最多 4.1MB，超限时拆分保存。
- 快速请求的集合保存在当前浏览器，不自动共享或从桌面同步；可用接口项目或显式导入/导出转移。响应与会话历史仅在当前页面内存。网页切换模块保留草稿，退出登录会清空页面会话并取消请求。
- HTTP 请求由主机转发，绕过浏览器跨域限制，沿用 HTTP(S)、超时、请求/响应大小及重定向限制。每个会话最多同时 4 个请求，取消接口只影响当前会话；退出登录、停止共享或发送连接断开会取消相应请求。
- 未授予 HTTP 编辑权限时不能保存接口定义；未授予发送权限时不能发出请求。访客仍可选择环境、浏览文档、编辑本地请求草稿及整理浏览器集合。生成 Fetch / Axios / cURL 代码在当前浏览器完成，不发送网络请求。Nginx 源码只读；API 设计入口禁用。页面刷新前仍会提示有未保存草稿或正在运行的请求。

## 独立 Node 服务

主机需要 Node.js 24+；源码运行先执行 `npm run build`。服务包直接解压启动，无需 npm install。Windows PowerShell 示例：

```powershell
$env:DEVKIT_PROJECT_PASSWORD = 'replace-with-a-separate-password'
$env:DEVKIT_SHARE_PROJECTS = 'true'
$env:DEVKIT_PROJECT_EDIT = 'true'
$env:DEVKIT_PROJECT_PROBE = 'true'
$env:DEVKIT_SHARE_NGINX = 'true'
$env:DEVKIT_NGINX_EDIT = 'true'
$env:DEVKIT_SHARE_HTTP = 'true'
$env:DEVKIT_HTTP_EDIT = 'true'
$env:DEVKIT_HTTP_SEND = 'true'
$env:DEVKIT_NGINX_CONTROL = 'true'
node server/start.mjs
```

Linux 示例：

```sh
DEVKIT_PROJECT_PASSWORD='replace-with-a-separate-password' \
DEVKIT_SHARE_PROJECTS=true DEVKIT_PROJECT_EDIT=true DEVKIT_PROJECT_PROBE=true \
DEVKIT_SHARE_NGINX=true DEVKIT_NGINX_EDIT=true DEVKIT_NGINX_CONTROL=true \
DEVKIT_SHARE_HTTP=true DEVKIT_HTTP_EDIT=true DEVKIT_HTTP_SEND=true node server/start.mjs
```

首次配置必须通过 `DEVKIT_SHARE_PROJECTS=true`、`DEVKIT_SHARE_NGINX=true`、`DEVKIT_SHARE_HTTP=true` 选择至少一个服务，未选服务和未授予权限均关闭。后续启动复用保存的服务与权限；明确设置的环境变量逐项覆盖已有选择，值只接受 `true` / `false`。例如 HTTP 只发送不编辑：首次仅设置 `DEVKIT_SHARE_HTTP=true DEVKIT_HTTP_SEND=true`；已有配置则显式关闭其他服务及 `DEVKIT_HTTP_EDIT`。关闭服务会清除其权限，重新启用时需重新授权。

| 环境变量 | 含义 |
| --- | --- |
| `DEVKIT_SHARE_PROJECTS` / `DEVKIT_PROJECT_EDIT` / `DEVKIT_PROJECT_PROBE` | 项目中心开放 / 编辑 / 入口检测 |
| `DEVKIT_SHARE_NGINX` / `DEVKIT_NGINX_EDIT` / `DEVKIT_NGINX_CONTROL` | Nginx 开放 / 编辑 / 运行管理 |
| `DEVKIT_SHARE_HTTP` / `DEVKIT_HTTP_EDIT` / `DEVKIT_HTTP_SEND` | HTTP 开放 / 编辑 / 发送 |

可复用已保存的口令哈希。默认 `0.0.0.0:8765`；支持 `HOST`、`PORT`、`DEVKIT_PROJECT_DATA`。

桌面和独立服务不能同时使用同一配置目录。迁移前停止两端，复制 configs；Nginx 配置原文件与程序需要另外迁移并调整路径。端口和防火墙说明见 [项目中心](project-center.md)。

共享面板独立于各模块草稿；关闭有修改的共享设置会提示保留或放弃。启动、停止、失败均会刷新顶部状态，端口占用时保留表单填写。浏览器访客不显示主机共享管理入口。

验证入口：`npm run test:http` 包含共享鉴权、权限、保存冲突、取消隔离及无 npm 依赖的独立服务启动测试。`npm run build` 后运行 `node scripts/smoke-sharing.mjs` 验证真实浏览器登录、接口文档/发送、Schema Worker、配置保存、只读权限与窄屏布局。设置 `DEVKIT_NGINX_TEST_EXECUTABLE` 为测试 nginx 的绝对路径，可额外通过共享接口验证真实检查、启动、重载和停止。

全局入口专项：构建后执行 `node scripts/smoke-desktop.mjs --sharing-settings-only`，覆盖首页入口、模块快捷入口、唯一面板、草稿保护、启动/停止状态、地址复制、端口冲突与响应式主题。

本次交互与权限审查的范围、发现和验证见 [交互一致性审查](interaction-audit.md)。

同端口切换“仅本机/局域网”时，系统无法同时绑定两个重叠地址，会短暂重绑；失败尝试恢复原监听，保留原授权和会话，但既有 TCP 连接可能中断。若其他进程抢占端口导致恢复失败，会报告原因并显示实际停止状态。不同端口应用先验证新监听再关闭旧监听。

门户路由、滚动、复制降级、调试值隔离、运行状态过期和离线退出规则见 [共享网页版说明](portal-browser.md)。专用验证入口为 `npm run test:portal`，使用临时数据和实际 LAN HTTP，覆盖原生点击、滚轮及页面最底部可达性。
