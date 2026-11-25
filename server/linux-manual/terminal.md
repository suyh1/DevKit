## tty

显示标准输入关联的终端设备名。

检查当前终端。

```sh
tty
```

## stty

查看或设置终端行规程。

以行数和列数显示终端尺寸。

```sh
stty size
```

## tput

查询终端能力或生成控制序列。

获取终端列数。

```sh
tput cols
```

## clear

清空终端的屏幕。

清空屏幕（相当于在 Bash shell 中按 `<Ctrl l>` 键）。

```sh
clear
```

清空屏幕但保留终端的回滚缓冲区。

```sh
clear -x
```

指明要清空的终端类型（默认为环境变量 `$TERM` 的值）。

```sh
clear -T type_of_terminal
```

显示 `clear` 使用的 `ncurses` 版本。

```sh
clear -V
```

## tmux

终端复用器。 支持包含窗口、窗格等的多个会话。

启动一个新会话。

```sh
tmux
```

启动一个指定名称的新会话（[s]ession）。

```sh
tmux new -s name
```

列出现有会话。

```sh
tmux ls
```

连接到最近使用的会话。

```sh
tmux a
```

从当前 tmux 会话断开连接。

```sh
<Ctrl b><d>
```

## screen

在远程服务器上保持会话打开。通过单个 SSH 连接管理多个窗口。

启动一个新的 screen 会话。

```sh
screen
```

启动一个指定名称的新 screen 会话。

```sh
screen -S 会话名称
```

启动一个后台会话，指定会话名称并执行指定命令并将日志输出到 screenlog.x。

```sh
screen -dmLS 会话名称 命令
```

显示所有打开的 screen 会话。

```sh
screen -ls
```

重新连接到一个打开的 screen 会话。

```sh
screen -r 会话名称
```

## nano

命令行文本编辑器。一个功能更强的 `Pico` 克隆版。

启动编辑器。

```sh
nano
```

启动编辑器且不使用配置文件。

```sh
nano -I
```

打开指定文件，在关闭前一个文件后移动到下一个文件。

```sh
nano 路径/到/文件1 路径/到/文件2 ...
```

打开文件并将光标定位到指定行和列。

```sh
nano +行号,列号 路径/到/文件
```

打开文件并启用软换行。

```sh
nano -S 路径/到/文件
```

## vim

Vi IMproved，一个程序员的文本编辑器，提供为不同类型的文档修改设计的多种模式。 按 `<i>` 进入插入模式。`<Esc>` 返回正常模式，正常模式允许使用 Vim 命令。

打开文档。

```sh
vim 文件
```

打开文件的指定行数。

```sh
vim +行数 文件
```

查看 Vim 的使用说明。

```sh
<:>help<Enter>
```

保存并退出。

```sh
<Esc><Z><Z>
```

撤销上一个操作。

```sh
<Esc><u>
```

## nvim

Neovim，基于 Vim 的代码编辑器，使用多种不同的模式来修改文本。 在普通模式（normal mode）下，按下 `<i>` 键以进入插入模式（insert mode）。通过 `<Esc>` 或 `<Ctrl c>` 返回普通模式。普通模式下不支持一般的文本输入。

打开文件。

```sh
nvim path/to/file
```

进入文本编辑模式（insert mode）。

```sh
<Esc><i>
```

复制（"yank"）或剪切（"delete"）当前行（使用 `<p>` 粘贴）。

```sh
<Esc><y><y>
```

进入普通模式并撤消上次操作。

```sh
<Esc><u>
```

在当前文件中使用正则表达式搜索（使用 `<n>`/`<N>` 查看上一个/下一个搜索结果）。

```sh
<Esc></>search_pattern<Enter>
```

## joe

Joe 自己的文本编辑器。

在 JOE 中打开一个新文件。

```sh
joe
```

打开一个指定文件。

```sh
joe 路径/到/文件
```

打开一个指定文件，并将光标定位在指定的行。

```sh
joe +行号 路径/到/文件
```

以只读模式打开一个指定文件。

```sh
joe -rdonly 路径/到/文件
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。
