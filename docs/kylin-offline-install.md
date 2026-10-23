# 麒麟 V10 ARM64 离线安装

## 适配方式

从 v1.1.0 起 Windows 与 Linux 使用同一个 Electron 主进程、预加载接口及 React 界面。Chromium 和 Node 运行时随应用分发，不再使用系统 WebKitGTK。截图中的 WebKitGTK 4.0 和 libsoup 2 无需升级或替换；不需要 WebKitGTK 4.1。

这不等于完全没有操作系统依赖。程序仍使用系统现有的 glibc、GTK 3、NSS、X11、音频等基础库。构建过程检查实际 ARM64 ELF 的 glibc 符号要求，并将包内所有 ELF 文件记录在 runtime-report.json。只有目标机器上的安装和启动测试，才能确认该台机器的完整兼容性。

安装包不会执行 apt、下载文件、添加软件源、修改 /usr/lib、/lib 或替换 glibc。依赖不满足时应停止安装并反馈，不要强制忽略依赖，不要更换系统库。Chromium 的沙箱保持开启，安装包包含 root 所有的 setuid chrome-sandbox 帮助程序，不要添加 --no-sandbox。

## 带到离线电脑的文件

从 artifacts/linux-arm64/ 复制：

- DevKit_1.6.0-1_arm64.deb
- SHA256SUMS
- runtime-report.json

需要排查时另带项目里的 scripts/check-kylin.sh。

## 安装

在麒麟桌面终端进入存放文件的目录：

```sh
dpkg --print-architecture
getconf GNU_LIBC_VERSION
sha256sum -c SHA256SUMS
dpkg-deb -f ./DevKit_1.6.0-1_arm64.deb Architecture Depends
sudo dpkg -i ./DevKit_1.6.0-1_arm64.deb
```

架构应为 arm64。dpkg 只使用本地文件，不会联网下载或升级系统依赖。如果提示缺少 NSS、GTK 等依赖，请保存完整提示。不要执行 --force-depends，也不要通过 apt 自动升级系统来绕过。

### 旧安装包解包失败

旧 `DevKit_1.1.0_arm64.deb` 缺少父目录归档条目，首次安装可能报 `无法创建 /opt/devkit/chrome-sandbox.dpkg-new：没有那个文件或目录`。随后的 `lzma 写入错误：断开的管道` 是解包中断引发的连带错误，不表示需要安装 WebKit。

请换成 `DevKit_1.6.0-1_arm64.deb`，直接重新执行上面的安装命令。`-1` 是 Debian 打包修订号，本次应用版本为 1.6.0；新包保留自 1.1.0-1 起补齐父目录并保持沙箱权限的修复。不需要手工创建目录、删除 `/opt`、强制忽略依赖或修改系统库。构建验证已增加空目录严格解包检查；Linux CI 另执行实际 `dpkg --unpack`，但 CI 配置不代表已经完成目标麒麟实机验收。

安装成功后，在应用菜单打开 DevKit，或以普通桌面用户运行：

```sh
devkit
```

不要使用 sudo 启动。X11 图形会话或 XWayland 必须可用；应用默认采用软件绘制，减少旧 ARM 显卡驱动兼容问题。

项目中心配置保存在 `/opt/devkit/configs`。用普通用户执行 `sudo dpkg -i` 时，安装脚本会为该用户准备可写目录。纯 root 安装或 root 复制配置后，若提示不可写，请由管理员执行 `sudo chown -R 实际用户名 /opt/devkit/configs` 并以该普通用户启动。升级/卸载保留该目录。整目录迁移前关闭两台电脑上的应用，详情见 `docs/project-center.md`。

检查包状态和库：

```sh
dpkg-query -W -f='${Status}\n' devkit
sh ./check-kylin.sh /opt/devkit
```

脚本只读取架构和动态库信息，不安装或修改任何依赖。若启动失败，把终端输出以及下列信息发回：

```sh
cat /etc/os-release
uname -m
getconf GNU_LIBC_VERSION
ldd /opt/devkit/devkit
```

安装状态为 installed 只说明包管理成功。还需检查打开窗口、JSON/YAML 转换、复制、本地文件导入和另存结果。真实麒麟硬件上的启动、图形驱动和系统安全策略验收尚未在当前 Windows 开发机上完成。

## 开发者重新构建

联网构建机安装 Node.js 24 与 Python 3.10+。在 Windows 也可以生成 ARM64 deb，因为没有需要在目标机器上编译的 Node 原生扩展。运行：

```sh
npm ci
npm test
npm run test:desktop
python scripts/test-deb-packaging.py
npm run bundle:linux:arm64
python scripts/verify-deb.py artifacts/linux-arm64/DevKit_1.6.0-1_arm64.deb
```

如果 Python 不在 PATH，设置 DEVKIT_PYTHON 为实际 Python 可执行文件的路径。构建时下载指定版本的官方 Electron ARM64 运行时；部署时无需 Node、Python、Rust、Java或任何联网服务。

## 卸载

```sh
sudo dpkg -r devkit
```

卸载移除应用文件，不会卸载系统图形库。用户偏好留在 Electron 用户数据目录中。旧 Tauri 版与新 Electron 版的偏好存储不同，迁移前可从旧版导出设置，再在新版导入。


