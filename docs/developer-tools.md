# v1.2 前后端工具

新增 12 个工具，总计 38 个。所有处理在本地 Worker 执行，解析器随应用打包，不加载 CDN、不执行用户代码或发送 HTTP 请求。继续使用原有任务、搜索、文件导入、结果复制/导出与工作区流程。

| 工具 | 输入与选项 | 输出与边界 |
| --- | --- | --- |
| 前端代码格式化 | JS/JSX、TS/TSX、CSS、SCSS、HTML；2/4 空格、JS 引号偏好 | Prettier 排版；200,000 字符；不运行代码；HTML 内嵌代码不另行格式化 |
| JSON 路径提取 | `$.users[*].name`、`$["a.b"][0]` | 始终返回匹配数组，无匹配为 `[]`；保留大整数、数字原文；支持字段、索引、通配符，不支持递归/过滤表达式 |
| JSON Schema 生成 | 任意 JSON 样本 | Draft 2020-12；合并全部数组样本，缺失字段不列入 required，混合类型 anyOf；不推断格式、枚举、业务上下限 |
| Query 参数转换 | 参数串（可带 `?`）或 JSON 字符串对象 | 重复参数为数组；`+` 解码为空格；保留空字符串；不接受完整 URL，不进行类型推断 |
| HTTP 请求代码生成 | JSON：`url`、可选 `method` / `headers` / `body` | Fetch、Axios、POSIX shell cURL；仅 HTTP(S)，拒绝 GET/HEAD 请求体；结构化 body 保留 JSON 数字原文并作为字符串发送，缺少 Content-Type 时补 application/json，用户已有值优先；Axios 需在目标项目安装 |
| Cron 表达式预览 | `*/15 9-18 * * 1-5`；可设带时区 ISO 起始时间与 1–50 次 | UTC 时间列表，严格晚于起始时间；最多搜索 4 年，数量不足时 complete=false；五字段数字 Unix Cron，支持列表/范围/步长，日期与星期规则见工具提示 |
| .env ↔ JSON | 平面字符串对象；支持 export、单/双引号、注释 | 不展开 `${VAR}` 或 `$(command)`；不支持多行引号，拒绝重复变量；双引号采用 JSON 转义规则，单引号为字面量 |
| Properties ↔ JSON | 平面字符串对象，Java Properties 字符文本 | 支持 `=`、`:`、空白分隔与续行；`\uXXXX`、常用控制字符及键转义；拒绝重复键；输出非 ASCII 字符为 Unicode 转义 |
| HMAC 签名 | 文本、UTF-8 密钥、SHA-256/384/512 | HEX 或 Base64；密钥默认空，必须主动输入；密码框展示；默认不导出工作区，勾选敏感任务后会明文保存 |
| Unicode 转义 | 文本或 `\uXXXX` / `\u{1F600}` | UTF-16 转义、代理对及码点解码；不使用 eval、不执行脚本 |
| CSS 单位换算 | 逐行数值（可带输入单位）；字体基准、视口宽度 | px/rem/em/vw，8 位小数；em 使用用户给定字体基准；不解析 calc 或整份 CSS |
| HTTP 状态码速查 | 状态码、英文名称、中文关键词；空输入列出常用项 | 常用状态码 JSON；属于固定离线参考库，不覆盖所有扩展码 |

JSON 提取和 Schema 使用保留原文的结构模型，输入最多 300,000 字符、8,000 节点与 100 层嵌套。其余工具遵循工作台 2,000,000 字符输入、4,000,000 字符输出和 10 秒 Worker 时限，可主动取消。

“示例”会随转换方向/语言/单位调整。HMAC 示例只填充消息，密钥需要单独填写。新工具的 JSON 结果支持结构预览；请求代码、配置文件与格式化结果按相应扩展名保存。

## 请求配置示例

```json
{
  "method": "POST",
  "url": "https://example.com/api/users",
  "headers": { "Content-Type": "application/json" },
  "body": { "name": "张三" }
}
```

cURL 输出采用 POSIX shell 引号规则。在 Windows 请使用相应 shell，或生成 Fetch/Axios 代码。工具本身不调用这些命令。

method/URL 表单编辑只替换对应的 JSON 值，body 中的大整数、指数、小数尾零和重复字段不变，预览也保留原文。请求配置和 headers 的顶层重复字段、Query / .env / Properties 编码输入中的重复 JSON 键会报错，避免最后一个值静默覆盖前面的值。以上结构化编辑/编码最多 2,000,000 字符、100,000 节点、100 层，超过时保留可编辑原文并给出错误。

## 依据

- [Prettier standalone/Worker API](https://prettier.io/docs/browser)：本地按需导入解析插件。
- [Unix crontab 字段与日期规则](https://man7.org/linux/man-pages/man5/crontab.5.html)：仅实现工具说明中的数字子集。
- [Java Properties 文本语法](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/util/Properties.html)：处理字符文本，不读取 ISO-8859-1 二进制文件。
- [IANA HTTP 状态码登记表](https://www.iana.org/assignments/http-status-codes)：常用状态码名称参考；离线库随应用版本更新。

## 多架构交付

在具备 Node.js 24、Python 3.10+ 的 Windows 构建机上：

```powershell
npm ci
# 若 python 不在 PATH，可指定实际 Python 可执行文件：
$env:DEVKIT_PYTHON = 'C:\path\to\python.exe'
npm run bundle:all
```

顺序构建 Windows x64 NSIS、Linux amd64 deb、Linux ARM64 deb。Linux 可继续使用各自的 bundle 命令，CI 保持三个目标的原生 runner。合集目录 `artifacts/release-1.2.0/` 包含三份安装包、`SHA256SUMS` 和记录架构/体积/摘要的 `release.json`；各架构目录保留运行时报告。若任一目标失败，合集命令以非零退出，只有全部成功后才汇总。

GitHub 提交旁的检查状态来自 `.github/workflows/build.yml`。失败时先查看任务中的具体步骤：测试失败会直接阻止后续安装包制作和上传。Windows runner 的临时目录可能使用 `RUNNER~1` 等 8.3 别名，Nginx 测试夹具通过 `realpath` 与管理器的规范路径保持一致，再比较文件路径及模拟进程身份；不改变正式配置的路径校验。未配置测试用 nginx 时，桌面回归仍覆盖编辑与无运行结果的操作区；设置 `DEVKIT_NGINX_TEST_EXECUTABLE` 可进一步验证真实运行及执行反馈。

若下载暂时失败，可完成相应的独立打包命令后执行 `node scripts/package-all.mjs --collect-only` 汇总已生成的当前版本文件。该选项不重新编译，请先确认三个独立包均来自当前源码；任一文件缺失仍会报错。

Windows 使用安装包或完整 `artifacts/desktop-runtime/DevKit-win32-x64/` 解压目录，不能单独拷贝 exe。Linux 包已包含 Chromium，无需系统 WebKitGTK；真实麒麟安装和启动仍需在目标机验证。参见 [麒麟离线安装](kylin-offline-install.md)。
