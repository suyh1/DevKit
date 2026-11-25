## apt

基于 Debian 的发行版上的软件包管理工具。 在 Ubuntu 16.04 及之后版本推荐用它代替 `apt-get`。

更新可用软件包及其版本列表（推荐在运行其他 APT 命令前首先运行该命令）。

```sh
sudo apt update
```

查找指定软件包。

```sh
apt search 软件包
```

显示关于指定软件包的信息。

```sh
apt show 软件包
```

安装指定软件包或将指定软件包更新到最新版本。

```sh
sudo apt install 软件包
```

移除指定软件包（使用 `purge` 同时移除其配置文件）。

```sh
sudo apt remove 软件包
```

## apt-get

Debian 和 Ubuntu 的软件包管理工具。 使用 `apt-cache` 查找包。

更新可用软件包及其版本列表（推荐在其他 `apt-get` 命令运行之前使用）。

```sh
sudo apt-get update
```

安装一个软件包或更新到最新版本。

```sh
sudo apt-get install 软件包
```

移除一个软件包。

```sh
sudo apt-get remove 软件包
```

移除一个软件包及其配置文件。

```sh
sudo apt-get purge 软件包
```

升级所有已安装软件包到最新版本。

```sh
sudo apt-get upgrade
```

## apt-cache

Debian 和 Ubuntu 的包查询工具。

在当前的软件源中查找一个软件包。

```sh
apt-cache search 软件包
```

显示指定软件包的相关信息。

```sh
apt-cache show 软件包
```

查看一个软件包是否安装或是否为最新。

```sh
apt-cache policy 软件包
```

显示一个软件包的依赖项。

```sh
apt-cache depends 软件包
```

列出依赖指定软件包的所有软件包。

```sh
apt-cache rdepends 软件包
```

## apt-file

在 APT 软件包中查找文件，其中也包括未安装的软件。

更新元数据的数据库。

```sh
sudo apt update
```

查找包含指定文件或路径的软件包。

```sh
apt-file find 文件路径
```

列出指定包的内容。

```sh
apt-file list 软件包名
```

查找符合给定 `pattern` 中`regex`式的软件包。

```sh
apt-file find -x 正则表达式
```

## apt-mark

查看或设置软件包的安装标记。

列出已锁定版本的软件包。

```sh
apt-mark showhold
```

## aptitude

Debian 和 Ubuntu 上的软件包管理工具。

同步可用软件包及其版本列表，在运行后续 aptitude 命令前，应该首先运行该命令。

```sh
sudo aptitude update
```

安装一个新的软件包及其依赖。

```sh
sudo aptitude install 软件包
```

查找一个软件包。

```sh
aptitude search 软件包
```

查找一个已安装的软件包（`?installed` 是一个 aptitude 搜索项）。

```sh
aptitude search '?installed(软件包)'
```

移除一个软件包并移除所有依赖它的软件包。

```sh
sudo aptitude remove 软件包
```

## dpkg

安装、查询 Debian 软件包。

列出已安装的 bash 软件包文件。

```sh
dpkg -L bash
```

## dpkg-query

检索 Debian 已安装软件包的数据库。

查看软件包的安装状态和版本。

```sh
dpkg-query -s bash
```

## dpkg-deb

检查或构建 Debian 软件包归档。

读取本地软件包的控制信息。

```sh
dpkg-deb -I package.deb
```

## debuild

从源代码构建 `Debian` 软件包的工具。

在当前目录中生成软件包。

```sh
debuild
```

仅构建二进制包。

```sh
debuild -b
```

生成软件包后，不运行 `lintian`（检查常见打包错误）。

```sh
debuild --no-lintian
```

## rpm

查询 RPM 软件包数据库。

显示已安装软件包的信息。

```sh
rpm -qi bash
```

## dnf

RHEL, Fedora 和 CentOS 的软件包管理工具（yum 的替代品）。

更新已安装的包到最新可用版本。

```sh
sudo dnf upgrade
```

通过关键词搜索包。

```sh
dnf search 关键词1 关键词2 ...
```

显示软件包的描述。

```sh
dnf info 包
```

安装软件包（使用 `-y` 自动确认所有提示）。

```sh
sudo dnf install 包1 包2 ...
```

删除软件包。

```sh
sudo dnf remove 包1 包2 ...
```

## yum

查询和管理使用 RPM 的发行版软件包。

查看已安装的 bash 包。

```sh
yum list installed bash
```

## zypper

SUSE & openSUSE 的软件包管理工具。

同步可用的软件包和版本列表。

```sh
zypper refresh
```

安装一个新的软件包。

```sh
zypper install 软件包
```

移除一个软件包。

```sh
zypper remove 软件包
```

将已安装的软件包升级到最新的可用版本。

```sh
zypper update
```

通过关键字搜索软件包。

```sh
zypper search 关键字
```

## pacman

Arch Linux 的软件包管理器工具。

同步并更新所有软件包。

```sh
sudo pacman -Syu
```

安装一个新的软件包。

```sh
sudo pacman -S 软件包
```

删除一个软件包及其依赖。

```sh
sudo pacman -Rs 软件包
```

列出已安装的软件包和版本。

```sh
pacman -Q
```

仅列出明确安装的软件包和版本。

```sh
pacman -Qe
```

## makepkg

创建 `pacman` 可用的软件包。 默认使用当前工作目录中的 `PKGBUILD` 文件。

构建软件包。

```sh
makepkg
```

构建软件包并使用 `pacman` 安装缺失的依赖关系。

```sh
makepkg -s
```

构建软件包、安装缺失的依赖后将其安装到系统。

```sh
makepkg -s -i
```

构建软件包但不验证源文件的检验值。

```sh
makepkg --skipchecksums
```

编译后清理工作文件。

```sh
makepkg -c
```

## yay

Yet Another Yogurt: 一个用于 Arch Linux 的工具，用于从 Arch User Repository 中构建和安装软件包。

从仓库和 AUR 中交互式搜索和安装软件包。

```sh
yay 软件包
```

同步并更新所有来自仓库和 AUR 的软件包。

```sh
yay
```

只同步和更新 AUR 软件包。

```sh
yay -Sua
```

从仓库和 AUR 中安装一个新的软件包。

```sh
yay -S 软件包
```

从仓库和 AUR 中搜索软件包数据库中的关键词。

```sh
yay -Ss 关键词
```

## paru

一个 AUR 助手和 pacman 包装。

交互式搜索并安装软件包。

```sh
paru 包名或关键字
```

同步和更新所有包。

```sh
paru
```

更新 AUR 包。

```sh
paru -Sua
```

获取包的信息。

```sh
paru -Si 包
```

从 AUR 或 ABS 下载 `PKGBUILD` 和其他的包的源文件。

```sh
paru --getpkgbuild 包
```

## apk

Alpine Linux 的包管理工具。

从所有的远程仓库中更新仓库索引。

```sh
apk update
```

安装一个新软件包。

```sh
apk add 软件包
```

移除一个软件包。

```sh
apk del 软件包
```

修复或更新软件包而不修改主依赖项。

```sh
apk fix 软件包
```

通过关键字查找软件包。

```sh
apk search 关键字
```

## snap

查询和管理 Snap 应用。

列出已安装的应用和版本。

```sh
snap list
```

## flatpak

构建、安装和运行 Flatpak 应用和运行时。

运行已安装应用。

```sh
flatpak run 应用名
```

从远程源安装应用。

```sh
flatpak install 远程源名 应用名
```

列出所有应用和运行时。

```sh
flatpak list
```

更新所有已安装的应用和运行时。

```sh
flatpak update
```

添加远程源。

```sh
flatpak remote-add --if-not-exists 远程源名 远程源网址
```

## brew

Homebrew - 一个 macOS 和 Linux 的包管理器。 此命令也有关于其子命令的文件，例如：`install`。

安装最新稳定版本的软件包或安装包。

```sh
brew install 软件包
```

列出所有已安装的软件包和安装包。

```sh
brew list
```

升级已安装的软件包或安装包（如果未指定，则升级所有已安装的软件包或安装包）。

```sh
brew upgrade 软件包
```

从 Homebrew 源代码仓库中获取 Homebrew 和所有软件包及安装包的最新版本。

```sh
brew update
```

显示有更新版本可用的软件包和安装包。

```sh
brew outdated
```

## nix

一款强大的包管理器，让包管理变得可靠、可重现且可声明。 `nix` 中的某些功能（如 `nix-command`, `flake`）还是实验性功能，需启用实验特性。 部分子命令如 `build`、`develop`、`flake`、`registry`、`profile`、`search`、`repl`、`store`、`edit`、`why-depends` 等均有其独立的用法说明。

启用 `nix` 命令（这是一个实验性功能）。

```sh
mkdir -p ~/.config/nix; echo 'experimental-features = nix-command flakes' >~/.config/nix/nix.conf
```

根据名称或描述在 nixpkgs 中搜索软件包。

```sh
nix search nixpkgs search_term
```

启动一个 shell，使其可以访问 nixpkgs 中指定的软件包。

```sh
nix shell nixpkgs#pkg1 nixpkgs#pkg2 nixpkgs#pkg3 ...
```

从 nixpkgs 中永久安装某些软件包。

```sh
nix profile install nixpkgs#pkg1 nixpkgs#pkg2 nixpkgs#pkg3 ...
```

从 Nix 存储中移除未使用的路径以释放空间。

```sh
nix store gc
```

## nix-env

管理或查询 Nix 用户环境。

列出所有已安装的软件包。

```sh
nix-env -q
```

查询已安装的软件包（支持 `正则表达式`）。

```sh
nix-env -q 搜索模式
```

从 Nixpkgs 注册表中查询可用的软件包。

```sh
nix-env -qa 搜索模式
```

从 Nixpkgs 注册表中安装软件包。

```sh
nix-env -iA nixpkgs.软件包名称
```

从自定义 URL 安装软件包。

```sh
nix-env -i 软件包名称 -f example.com
```

## pip

Python 主流的包安装管理工具。

安装包（通过 `pip install` 查看更多安装示例）。

```sh
pip install 包名
```

安装包到用户目录而不是系统范围的默认位置。

```sh
pip install --user 包名
```

升级包。

```sh
pip install -U 包名
```

卸载包。

```sh
pip uninstall 包名
```

将已安装的包以 Requirements 的格式保存文件中。

```sh
pip freeze >requirements.txt
```

## pipx

在隔离环境中安装并运行 Python 应用程序。

在临时虚拟环境中运行应用程序。

```sh
pipx run pycowsay moo
```

在虚拟环境中安装软件包并将入口点添加到路径。

```sh
pipx install 软件包
```

列出已安装软件包。

```sh
pipx list
```

在临时虚拟环境中运行应用程序（当软件包名与可执行文件不同时）。

```sh
pipx run --spec httpx-cli httpx http://www.github.com
```

向现有虚拟环境注入依赖项。

```sh
pipx inject 软件包 依赖项1 依赖项2 ...
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。
