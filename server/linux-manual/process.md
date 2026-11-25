## ps

提供正在运行的进程的信息。

列出所有正在运行的进程。

```sh
ps aux
```

列出所有正在运行的进程，包括完整的命令字符串。

```sh
ps auxww
```

查找与字符串匹配的进程。

```sh
ps aux | grep 字符串
```

以 extra full 格式列出当前用户的所有进程。

```sh
ps -u $(id -u) -F
```

以树形方式列出当前用户的所有进程。

```sh
ps -u $(id -u) f
```

## pgrep

按名称查找进程或向进程发送信号。

返回命令字符串匹配的所有正在运行进程的 PID。

```sh
pgrep 进程名称
```

同时显示完整命令。

```sh
pgrep -a 进程名称
```

搜索进程时包含其命令行选项。

```sh
pgrep -f "进程名称 参数"
```

搜索由特定用户运行的进程。

```sh
pgrep -u 用户名 进程名称
```

## pidof

查找指定程序的进程号。

列出 nginx 实例的进程号。

```sh
pidof nginx
```

## pstree

以树形显示进程的父子关系。

同时显示进程号。

```sh
pstree -p
```

## top

交互查看进程、CPU 和内存占用。

以批处理模式输出一份快照。

```sh
top -b -n 1
```

## htop

显示正在运行的进程的动态实时信息。`top` 的增强版。

启动 `htop`。

```sh
htop
```

启动 `htop`, 显示指定用户拥有的进程。

```sh
htop -u 用户名
```

以树形视图显示进程的层级关系，展示父子进程之间的关系。

```sh
htop -t
```

使用指定的 `sort_item` 对进程排序（使用 `htop --sort help` 获取可用选项）。

```sh
htop -s sort_item
```

以指定的更新间隔启动 `htop`, 以十分之一秒为单位（即 50 = 5 秒）。

```sh
htop -d 50
```

## btop

显示有关 CPU、内存、磁盘、网络和进程的信息的资源监视器。 `bpytop` 的 C++ 版本。

启动 `btop`。

```sh
btop
```

使用指定预设启动 `btop`。

```sh
btop -p 0..9
```

使用 16 种颜色和 TTY 友好的图形符号在 TTY 模式下启动 `btop`。

```sh
btop -t
```

在 256 色模式而不是 24 位颜色模式下启动 `btop`。

```sh
btop -l
```

设置更新速率为 500 毫秒。

```sh
btop -u 500
```

## atop

Linux 系统和进程监控工具。

启动。

```sh
atop
```

启动并显示每个进程的内存消耗。

```sh
atop -m
```

启动并显示磁盘信息。

```sh
atop -d
```

启动并显示后台进程信息。

```sh
atop -c
```

启动并显示线程特定的资源利用信息。

```sh
atop -y
```

## kill

向进程发送信号，通常用于停止进程。 除了 `SIGKILL` 和 `SIGSTOP`，所有信号都可以被进程拦截，以便进行正常退出。

使用默认的 `SIGTERM`（终止）信号来结束一个程序。

```sh
kill 进程id
```

列出可用的信号名称（使用时无需加 `SIG` 前缀）。

```sh
kill -l
```

使用 `SIGHUP`（挂起）信号终止一个程序。许多守护进程接收到此信号后会重新加载而不是终止。

```sh
kill -1 进程id
```

使用 `SIGINT`（中断）信号终止一个程序。通常由用户按下 `<Ctrl c>` 发起。

```sh
kill -2 进程id
```

向操作系统发送信号，立即终止一个程序（程序无机会捕获信号）。

```sh
kill -9 进程id
```

## pkill

按名称向进程发送信号。 通常用于停止进程。

终止所有匹配指定名称的进程。

```sh
pkill "进程名称"
```

根据完整命令而不只是进程名称，终止所有匹配的进程。

```sh
pkill -f "命令名称"
```

强制终止匹配的进程（该信号不能被捕获或忽略）。

```sh
pkill -9 "进程名称"
```

向匹配指定名称的进程发送 `SIGUSR1` 信号。

```sh
pkill -USR1 "进程名称"
```

终止主 `firefox` 进程来关闭浏览器。

```sh
pkill -o "firefox"
```

## killall

根据进程名称向所有实例发送终止信号（必须是精确的进程名称）。 除了 `SIGKILL` 和 `SIGSTOP`，所有信号都可以被进程拦截，从而实现正常退出。

使用默认的 `SIGTERM`（终止）信号结束进程。

```sh
killall 进程名称
```

列出可用的信号名称（使用时无需加 `SIG` 前缀）。

```sh
killall -l
```

交互式地询问确认后再终止进程。

```sh
killall -i 进程名称
```

使用 `SIGINT`（中断）信号终止进程，与按下 `<Ctrl c>` 发送的信号相同。

```sh
killall -2 进程名称
```

强制杀死一个进程。

```sh
killall -9 进程名称
```

## nice

以指定的调度优先级启动程序。

降低排序任务的优先级。

```sh
nice -n 10 sort data.txt
```

## renice

调整已运行进程的调度优先级。

为指定进程设置较低的优先级。

```sh
renice 10 -p 进程号
```

## taskset

查看或配置进程可运行的 CPU 集合。

列出当前 Shell 的 CPU 亲和性。

```sh
taskset -pc $$
```

## nohup

允许进程在终端关闭后继续运行。

运行一个可在终端关闭后继续运行的进程。

```sh
nohup 命令 参数1 参数2 ...
```

在后台模式下启动 `nohup`。

```sh
nohup 命令 参数1 参数2 ... &
```

运行一个可在终端关闭后继续运行的 shell 脚本。

```sh
nohup 路径/到/脚本.sh &
```

运行一个进程，并将输出写入指定文件。

```sh
nohup 命令 参数1 参数2 ... >路径/到/输出文件 &
```

## disown

允许子进程在其所属的 shell 结束后继续运行。

解除当前作业与 shell 的关联。

```sh
disown
```

解除指定作业与 shell 的关联（运行 `jobs` 查找作业编号）。

```sh
disown %作业编号
```

解除所有作业与 shell 的关联（仅限 Bash）。

```sh
disown -a
```

保留作业（不解除关联），但标记为 shell 退出时不再接收 `SIGHUP`（仅限 Bash）。

```sh
disown -h %作业编号
```

## jobs

显示当前会话中作业的状态。

显示所有作业的状态。

```sh
jobs
```

显示特定作业的状态。

```sh
jobs %作业_id
```

显示所有作业的状态和进程 ID。

```sh
jobs -l
```

显示所有作业的进程 ID。

```sh
jobs -p
```

## bg

恢复被挂起的任务（如. 使用 `<Ctrl z>`），使它们在后台运行。

恢复最近被挂起的任务，在后台运行。

```sh
bg
```

恢复特定的任务（使用 `jobs -l` 可以获取任务 ID）并在后台运行。

```sh
bg %job_id
```

## fg

在前台运行作业。

将最近暂停或正在后台运行的作业切换到前台。

```sh
fg
```

将指定作业切换到前台（运行 `jobs` 查找作业编号）。

```sh
fg %作业编号
```

## wait

等待当前 Shell 的后台任务结束。

等待最近启动的后台任务。

```sh
wait "$!"
```

## lsof

列出打开的文件和相应的进程。 注意：列出其他人打开的文件需要 root 权限（或 sudo）。

查找打开了给定文件的进程。

```sh
lsof 路径/到/文件
```

查找打开了本地互联网端口的进程。

```sh
lsof -i :端口
```

仅输出进程 ID (PID)。

```sh
lsof -t 路径/到/文件
```

列出给定用户打开的文件。

```sh
lsof -u 用户名
```

列出给定命令或进程打开的文件。

```sh
lsof -c 进程或命令的名称
```

## lslocks

列出系统中的文件锁。

显示进程、锁类型及目标路径。

```sh
lslocks -o PID,COMMAND,TYPE,PATH
```

## ulimit

获取和设置用户限制。

获取所有用户限制的属性。

```sh
ulimit -a
```

获取同时打开文件数量的硬限制。

```sh
ulimit -H -n
```

获取同时打开文件数量的软限制。

```sh
ulimit -S -n
```

设置每个用户的最大进程限制。

```sh
ulimit -u 30
```

显示帮助。

```sh
help ulimit
```

## prlimit

查看或调整进程的资源限制。

查看当前 Shell 的限制。

```sh
prlimit --pid $$
```

## pmap

查看进程的内存映射。

显示当前 Shell 各映射区的内存用量。

```sh
pmap -x $$
```

## pidstat

按进程统计 CPU、内存和 I/O，通常由 sysstat 提供。

每秒采样一次内存统计，共三次。

```sh
pidstat -r 1 3
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。
