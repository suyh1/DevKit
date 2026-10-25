# 六项功能验收记录

基线版本：1.10.6。功能编号：1 / 4 / 5 / 6 / 13 / 14。

## 已通过
- npm test：160 项，包含新增结构Diff、Mock、环境对比和HTTP集合语义。
- npm run build：TypeScript 和 Vite 生产构建成功。
- npm run test:nginx：26 项，指定隔离nginx.exe后包含3项真实生命周期，无跳过。
- npm run test:http：2项隔离本地服务，覆盖回显、取消/超时、重复头、二进制、压缩和大小限制。
- npm run test:projects：12项。
- npm run test:desktop：3项。
- npm run test:release：2项。
- npm run test:docs：指定bundled Python后7项，无跳过。
- npm run docs:update / npm run docs:check / git diff --check：通过。
- 合计：212项核心/服务/文档等自动检查。

## 桌面验证
- 已通过全部46工具界面/40个文本与坐标工具执行、两种主题/四种宽度、项目中心与只读共享门户。
- 已通过真实nginx编辑、外部冲突、备份恢复、启停重载、目录准备及新六项功能的界面和IPC。
- 已复核HTTP大整数请求体、集合默认排除和显式敏感保存、取消、环境对比、日志筛选/轮转/暂停、共享配置影响和备份对比。
- 最终完整 Electron 流程退出码0；新增夹具在用例结束时清理自身实例登记，完整退出/取消/重载保护与配置锁释放检查通过。

## 截图
artifacts/electron-smoke/features-*.png：JSON差异、Mock、HTTP深浅/宽窄、环境档案对比、Nginx日志和变更预览。

## 交付边界
- 未修改用户实际Nginx配置或接管用户进程；HTTP测试只请求隔离的本地服务。
- HTTP真实发送仅桌面端；Mock明确为Schema常用子集；日志按末尾1MB窗口筛选。
- 未制作发行安装包、修改版本号、提交或推送。本轮Linux实现共用代码，未进行Linux/麒麟实机运行验收。
