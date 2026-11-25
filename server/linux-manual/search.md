## find

在指定目录树下递归查找文件或目录。

通过扩展名查找文件。

```sh
find 指定目录 -name '*.ext'
```

查找匹配多个路径或名称模式的文件。

```sh
find 指定目录 -path '**/path/**/*.ext' -or -name '*pattern*'
```

查找匹配指定名称的目录，不区分大小写。

```sh
find 指定目录 -type d -iname '*lib*'
```

查找匹配指定模式的文件，排除特定路径。

```sh
find 指定目录 -name '*.py' -not -path '*/site-packages/*'
```

查找符合指定大小范围的文件，将递归深度限制为 "1"。

```sh
find 指定目录 -maxdepth 1 -size +500k -size -10M
```

## fd

在文件系统中查找条目。

在当前目录中递归查找匹配特定模式的文件。

```sh
fd "正则表达式"
```

在特定目录中查找文件。

```sh
fd "正则表达式" 路径/到/文件
```

查找具有特定扩展名的文件。

```sh
fd -e 扩展名
```

仅查找匹配特定模式的文件夹。

```sh
fd "正则表达式" -t d
```

在搜索中包含被忽略和隐藏的文件。

```sh
fd "正则表达式" -HI
```

## locate

在文件名索引中搜索路径，结果取决于索引更新时间。

按名称查找配置文件。

```sh
locate nginx.conf
```

## which

在用户的`$PATH`中寻找可执行文件的路径。

在`$PATH`中寻找可执行文件并打印第一个匹配的结果。

```sh
which executable
```

如果有多个匹配结果则打印所有结果。

```sh
which -a executable
```

## whereis

查找程序的二进制文件、源代码或手册位置。

列出 Bash 的可执行文件和手册位置。

```sh
whereis bash
```

## type

查看 Shell 如何解析一个命令。

列出 ls 的别名和可执行文件来源。

```sh
type -a ls
```

## command

Command 强制当前 shell 执行指定程序，并忽略具有相同名称的任何函数、内置函数和别名。

从字面上执行 `ls` 程序，即使存在 `ls` 别名。

```sh
command ls
```

显示指定命令的可执行程序路径或别名定义。

```sh
command -v 命令名
```

## grep

使用 `regex` 式查找文件中的模式。

在文件中查找模式。

```sh
grep "模式字符串" 路径/到/文件1 路径/到/文件2
```

查找精确的字符串（禁用 `regex` 式）。

```sh
grep -F "字符串" 路径/到/文件
```

在目录中递归查找所有文件中的模式，忽略二进制文件。

```sh
grep -rI "模式字符串" 路径/到/目录
```

打印每个匹配项周围、之前或之后的 3 行上下文。

```sh
grep --context 3 "模式字符串" 路径/到/文件
```

打印每个匹配项的文件名和行号，并带彩色输出。

```sh
grep -Hn --color=always "模式字符串" 路径/到/文件
```

## rg

Ripgrep，一款递归的行导向搜索工具。 旨在成为 `grep` 的更快替代品。

在当前目录中递归搜索匹配模式的内容（`regex`）。

```sh
rg 模式
```

在指定文件或目录中递归搜索匹配模式的内容。

```sh
rg 模式 路径/到/文件或目录
```

搜索字面字符串模式。

```sh
rg -F -- 字符串
```

包含隐藏文件以及 `.gitignore` 中列出的条目。

```sh
rg -. --no-ignore 模式
```

仅搜索文件名匹配通配符（`glob`）模式的文件（例如 `README.*`）。

```sh
rg 模式 -g 文件名通配符模式
```

## ag

The Silver Searcher. 类似 `ack`, 但是更快。

寻找内容包含"小明"的文件，并列出所在的行数。

```sh
ag 小明
```

在指定目录中寻找内容包含 "foo" 的文件。

```sh
ag 小明 指定的目录
```

寻找内容包含 "foo" 的文件，但只列出文件名。

```sh
ag -l 小明
```

忽略大小写，寻找内容包含 "ABC" 的文件，并只输出匹配的内容，而非整行。

```sh
ag -i -o ABC
```

在文件名包含"小红"的文件中寻找"小明"。

```sh
ag 小明 -G 小红
```

## ack

一个类似 grep 的搜索工具，为程序员优化。

在当前目录下递归地搜索包含一个字符串或正则表达式的文件。

```sh
ack "search_pattern"
```

不区分大小写搜索。

```sh
ack -i "search_pattern"
```

搜索匹配模式的行，只打印匹配的文本，而不打印行的其他部分。

```sh
ack -o "search_pattern"
```

限制搜索特定类型的文件。

```sh
ack -t ruby "search_pattern"
```

不在特定类型的文件中搜索。

```sh
ack -t noruby "search_pattern"
```

## fzf

命令行模糊查找器。

对指定目录中的所有文件启动 `fzf`。

```sh
find 路径/到/目录 -type f | fzf
```

为正在运行的进程启动 `fzf`。

```sh
ps aux | fzf
```

使用 `<Shift Tab>` 选择多个文件并将结果写入文件。

```sh
find 路径/到/目录 -type f | fzf -m >路径/到/文件
```

使用指定查询词启动 `fzf`。

```sh
fzf -q "查询词"
```

对以 core 开头、以 go, rb 或 py 结尾的条目启动 `fzf`。

```sh
fzf -q "^core go$ | rb$ | py$"
```

## xargs

从标准输入构建参数列表，分批调用命令。

统计各文本文件的行数，用空字符分隔文件名。

```sh
find . -name '*.txt' -print0 | xargs -0 -r wc -l
```

## zoxide

记录最常使用的目录。 使用一个排序算法来导航到最佳匹配。

转到名称中包含 "foo" 的排名最高的目录。

```sh
zoxide query foo
```

转到名称中依次包含 "foo" 和 "bar" 的排名最高的目录。

```sh
zoxide query foo bar
```

启动一个交互式目录搜索（需要 `fzf`）。

```sh
zoxide query --interactive
```

添加一个目录或提升其排名。

```sh
zoxide add 路径/到/目录
```

从 `zoxide` 的数据库中移除一个目录。

```sh
zoxide remove 路径/到/目录
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。
