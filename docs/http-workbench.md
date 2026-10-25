# HTTP 调试工作台

在桌面端的侧栏或顶部导航打开“HTTP 调试”。它与离线的“HTTP 请求代码生成”分开：代码生成器不联网；调试工作台只有点击“发送请求”才从当前桌面主机访问目标。

## 编辑与发送

请求表单编辑方法/URL，“配置 JSON”编辑 Headers 和 body。支持 GET、HEAD、POST、PUT、PATCH、DELETE、OPTIONS；仅 HTTP(S)，URL 不支持内嵌用户名/密码。示例：

```json
{
  "method": "POST",
  "url": "http://127.0.0.1:9000/api/users",
  "headers": { "Content-Type": "application/json" },
  "body": { "name": "张三", "active": true }
}
```

body 可为文本字符串或 JSON 值。结构化 body 按原始 JSON 数字/字段原文发送，未指定 Content-Type 时补 application/json；GET/HEAD 不支持非空请求体。重复配置字段、重复请求头名称（忽略大小写）会报错。

点击发送后可随时取消；超时覆盖 DNS、连接、响应读取及解压全过程，默认 15,000ms，可设 100–120,000ms。显示状态码、耗时、正文、完整响应头（保留重复头），支持复制和导出。HTTP 4xx/5xx 作为正常收到的响应展示；网络/TLS/超时错误另行显示。修改配置后保留上次响应并标注待更新。

请求由 Electron 主进程的受限客户端发出，不受网页 CORS 限制，不使用 shell/cURL，不修改页面 CSP 或关闭 TLS 验证。不会自动跟随 3xx，避免无意把认证数据带往其他目标。客户端不维护 Cookie jar、不读浏览器 Cookie；需要 Cookie 时在请求头中显式填写。HTTPS 使用 Node 默认 CA，不提供“忽略证书错误”开关。

请求正文最多 2MB；请求头最多 100 项、64KB。Content-Length、Connection、Transfer-Encoding、Upgrade、Expect、Proxy-Connection 由客户端管理。响应原始载荷与解压后各最多 4MB；支持 gzip/deflate/br。文本按 Content-Type charset 解码，二进制、未知编码或无效文本以 Base64 展示。HTML 只作为文本，不渲染页面或执行脚本。最多允许 4 个后台并发请求，当前界面逐次发送。

## 请求集合与敏感信息

- 请求草稿和响应默认只在内存；切换工作台模块保留，退出/刷新时有未保存草稿或运行中请求会提示。
- “保存请求”主动写入当前桌面用户的本地存储，最多 100 项、4MB；与项目中心 configs、文本工作区快照分别管理。
- 默认排除 Authorization/Cookie 及常见 token/password/secret/api-key/signature/session/credential 请求头和 Query 参数，并排除整个 body。界面原草稿保留，重新选择集合项才载入保存的版本。
- 这些名称筛选不能识别所有业务自定义敏感字段。勾选“保存时包含完整 Headers、正文与敏感参数（明文）”后会完整保存；集合项会明确标记。保存和导出前请根据实际配置选择。
- 支持删除、JSON 导出及合并导入；导入使用新标识保留原集合，不发送请求。导入前显示确认；损坏的本地集合会提示且不在启动时覆盖。

代码生成器中的“在 HTTP 调试中打开”携带当前配置，不自动发送；调试工作台中的“生成请求代码”打开独立代码任务。HTTP 调试与请求集合不向项目中心局域网页面或独立项目服务开放。

首版不支持文件/multipart 上传、代理设置、HTTP/2/gRPC、自动重定向、Cookie 会话管理或认证脚本。已有 Header/body 可用于常规本地接口联调。

## 验证与参考

`npm run test:http` 使用隔离本地服务验证正文保真、重复响应头、取消/超时、重定向、二进制、压缩与解压预算；桌面 `node scripts/smoke-desktop.mjs --features-only` 验证真实 IPC/界面发送、集合脱敏及窄屏。设计参考 [Hoppscotch](https://github.com/hoppscotch/hoppscotch)（MIT）；不引入它的前端/后端。实现使用 Node 内置 HTTP/HTTPS/zlib，不增加网络运行依赖。
