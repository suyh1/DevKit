## systemctl

查看并管理 systemd 服务和其他单元。

列出正在运行的服务。

```sh
systemctl list-units --type=service --state=running
```

检查指定服务的状态。

```sh
systemctl status nginx
```

列出运行失败的单元。

```sh
systemctl --failed
```

## journalctl

检索系统与服务写入 systemd 日志的数据。

查看本次启动以来的日志。

```sh
journalctl -b
```

查看指定服务最近一小时的日志。

```sh
journalctl -u nginx --since "1 hour ago"
```

持续查看新日志。

```sh
journalctl -f
```

## logger

向系统日志提交一条消息。

使用自定义标记写入一条部署记录。

```sh
logger -t deploy '配置检查完成'
```

## dmesg

查看内核环形缓冲区中的消息。

仅查看错误级别的内核消息。

```sh
dmesg --level=err
```

## logrotate

根据配置轮换、压缩和保留日志。

以调试模式检查配置，不执行轮换。

```sh
logrotate -d /etc/logrotate.conf
```

## systemd-cgls

显示控制组的树状结构。

查看系统服务所在控制组。

```sh
systemd-cgls /system.slice
```

## systemd-cgtop

按控制组动态查看资源用量。

按批处理方式输出一组统计。

```sh
systemd-cgtop -b -n 1
```

## crontab

为当前用户计划 cron 任务，按照时间间隔运行。

编辑当前用户的 crontab 文件。

```sh
crontab -e
```

为特定用户修改 crontab 文件。

```sh
sudo crontab -e -u 用户
```

用指定文件的内容，覆盖当前的 crontab 文件。

```sh
crontab 路径/到/文件
```

查看当前用户，现存的 cron 任务列表。

```sh
crontab -l
```

移除当前用户的所有 cron 任务。

```sh
crontab -r
```

## at

稍后执行一次性命令。 执行结果将通过邮件发送给用户。

启动 `atd` 守护进程。

```sh
systemctl start atd
```

以交互方式创建命令并在 5 分钟后执行（完成后按 `<Ctrl d>`）。

```sh
at now + 5 minutes
```

以交互方式创建命令并在特定时间执行。

```sh
at hh:mm
```

在今天上午 10:00 从标准输入执行命令。

```sh
echo "command" | at 1000
```

在下周二执行给定文件中的命令。

```sh
at -f 路径/到/文件 9:30 PM Tue
```

## atq

列出等待执行的一次性任务。

查看当前账号的任务队列。

```sh
atq
```

## loginctl

查询 systemd-logind 的登录会话。

列出用户会话和终端。

```sh
loginctl list-sessions
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。
