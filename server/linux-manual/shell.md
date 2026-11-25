## bash

Bourne-Again SHell，兼容 `sh` 的命令行解释器。

启动交互式 shell。

```sh
bash
```

启动一个不加载启动配置的交互式的 shell 会话。

```sh
bash --norc
```

执行命令。

```sh
bash -c "echo '已执行bash命令'"
```

执行脚本文件。

```sh
bash 路径/到/脚本文件.sh
```

执行脚本文件，并将所有执行过的命令输出到终端。

```sh
bash -x 路径/到/脚本文件.sh
```

## zsh

Z SHell，一个兼容 Bash 的命令行解释器。

启动交互式解释器。

```sh
zsh
```

执行指定的命令。

```sh
zsh -c "echo '已执行zsh命令'"
```

执行指定的脚本。

```sh
zsh 路径/到/脚本.zsh
```

不执行指定的脚本，只检查其语法错误。

```sh
zsh --no-exec 路径/到/脚本.zsh
```

执行来自 `stdin` 的命令。

```sh
echo "echo '已执行zsh命令'" | zsh
```

## fish

The Friendly Interactive SHell, 一个设计为用户友好的命令行解释器。

启动交互式 shell 会话。

```sh
fish
```

启动不加载启动配置的交互式 shell 会话。

```sh
fish -N
```

执行特定命令。

```sh
fish -c "echo 'fish is executed'"
```

执行特定脚本。

```sh
fish 路径/到/脚本.fish
```

检查特定脚本是否有语法错误。

```sh
fish -n 路径/到/脚本.fish
```

## env

在指定环境变量下运行程序。

仅对本次 date 调用使用 UTC 时区。

```sh
env TZ=UTC date
```

## printenv

打印所有或环境变量的值。

显示所有环境变量的键值对。

```sh
printenv
```

显示特定变量的值。

```sh
printenv HOME
```

显示变量的值并以 NUL 而不是换行符结尾。

```sh
printenv -0 HOME
```

## export

命令为当前 shell 中的子进程进行环境变量设置。

设置环境变量。

```sh
export 变量名=值
```

向环境变量 `$PATH` 追加一个路径名。

```sh
export PATH=$PATH:追加的 path 路径
```

## unset

删除 Shell 变量或函数。

删除变量 `foo`，如果该变量不存在则删除函数 `foo`。

```sh
unset foo
```

删除变量 foo 和 bar。

```sh
unset -v foo bar ...
```

删除函数 my_func。

```sh
unset -f my_func
```

## alias

创建别名——用给定的字符串指代特定的命令。 别名只会在当前的 shell 会话中生效，除非它们在 shell 的配置文件中被定义，例如`~/.bashrc`。

列出所有别名。

```sh
alias
```

创建一个通用的别名。

```sh
alias 别名="命令"
```

通过给定的别名查看它所指代的命令。

```sh
alias 别名
```

移除一个别名。

```sh
unalias 别名
```

将 `rm` 转换为交互式命令。

```sh
alias rm="rm --interactive"
```

## unalias

移除别名。

移除一个别名。

```sh
unalias 别名
```

移除所有别名。

```sh
unalias -a
```

## history

列出当前交互式 Shell 的历史命令。

查看最近十条命令。

```sh
history 10
```

## fc

打开最近的命令进行编辑，然后运行它。

在默认系统编辑器中打开最后一个命令，并在编辑后运行。

```sh
fc
```

指定一个编辑器打开。

```sh
fc -e 'emacs'
```

从历史记录中列出最近的命令。

```sh
fc -l
```

以相反的顺序列出最近的命令。

```sh
fc -l -r
```

从历史记录中编辑并运行一个命令。

```sh
fc 编号
```

## source

在当前 Shell 中执行来自文件的命令。

执行指定文件中的内容。

```sh
source 路径/到/文件
```

执行指定文件中的内容（也可以用`.`替代`source`）。

```sh
. 路径/到/文件
```

## eval

在当前 shell 中以单个命令的形式执行参数，并返回其结果。

使用 'foo' 做为参数调用 `echo`。

```sh
eval "echo foo"
```

在当前 shell 程序中设置变量。

```sh
eval "foo=bar"
```

## read

从标准输入（或文件）读取一行并将单词分配给变量。

读取键盘输入的数据赋值给变量。

```sh
read 变量
```

将您输入的每一行存储为数组一个元素。

```sh
read -a 数组
```

指定要读取的字符数，将数据赋值给变量。

```sh
read -n 字符数 变量
```

将多个数据依次赋值给多个变量。

```sh
read _ 变量1 _ 变量2 <<<"The surname is Bond"
```

读取键盘输入的数据赋值给变量，不对`\`进行转义。

```sh
read -r 变量
```

## test

检查文件类型，比较数值。 如果条件评估为真，则返回 0，如果评估为假，则返回 1。

测试指定的变量是否等于指定的字符串。

```sh
test "$MY_VAR" = "/bin/zsh"
```

测试指定的变量是否为空（[z]ero 长度）。

```sh
test -z "$GIT_BRANCH"
```

测试指定的文件是否存在（[f]ile）。

```sh
test -f "路径/到/文件"
```

测试指定的目录是否不存在（[d]irectory）。

```sh
test ! -d "路径/到/目录"
```

如果 A 为真，则执行 B，如果出错则执行 C（请注意，即使 A 失败，C 也可能会运行）。

```sh
test condition && echo "true" || echo "false"
```

## true

返回成功状态，常用于 Shell 条件。

观察成功命令的退出状态。

```sh
true; echo $?
```

## false

返回失败状态，常用于检查错误分支。

失败时输出提示。

```sh
false || echo '进入失败分支'
```

## yes

重复输出某些内容。 此命令通常用于对安装命令（如 `apt-get`）每个提示回答是。

重复输出“y”。

```sh
yes
```

重复输出“消息”。

```sh
yes 消息
```

接受 `apt-get` 命令的所有提示。

```sh
yes | sudo apt-get install 程序
```

重复输出一个换行符以始终接受提示的默认选项。

```sh
yes ''
```

## sleep

延迟指定的一段时间。

按秒数延迟。

```sh
sleep seconds
```

延迟 [m]分钟（其他元素 [d]天，[h]小时，[s]秒，[inf]无穷 也可以使用）。

```sh
sleep minutesm
```

延迟 1 [d]天 3 [h]小时。

```sh
sleep 1d 3h
```

在 20 [m]分钟 延迟后执行指定命令。

```sh
sleep 20m && command
```

## watch

按固定间隔刷新命令输出。

每两秒查看一次内存用量。

```sh
watch -n 2 free -h
```

## timeout

限制指定命令的运行时间。

让等待命令最多运行五秒。

```sh
timeout 5s sleep 20
```

## time

测量程序的实际耗时及 CPU 时间。

统计排序文件所花的时间。

```sh
time sort names.txt > sorted.txt
```

## date

显示系统日期和时间。

以 UTC 输出 ISO 格式的日期和时间。

```sh
date -u '+%Y-%m-%dT%H:%M:%SZ'
```

## cal

打印日历信息，高亮显示当前日期。

显示当前月份的日历。

```sh
cal
```

显示上个月、当前月和下个月。

```sh
cal -3
```

使用星期一作为一周的第一天。

```sh
cal -m
```

显示特定年份的日历（4 位数字）。

```sh
cal 年份
```

显示特定月份和年份的日历。

```sh
cal 月份 年份
```

## bc

任意精度的计算器语言。

启动交互式会话。

```sh
bc
```

启动交互式会话并启用标准数学库。

```sh
bc -i -l
```

计算表达式。

```sh
echo '5 / 3' | bc
```

执行脚本。

```sh
bc 路径/到/脚本.bc
```

使用指定的小数位数计算一个表达式。

```sh
echo 'scale = 10; 5 / 3' | bc
```

## getconf

读取系统配置变量和资源限制。

查询系统内存页大小。

```sh
getconf PAGESIZE
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。
