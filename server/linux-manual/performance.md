## uptime

查看运行时长和最近 1、5、15 分钟的平均负载。

显示系统启动至今的运行概况。

```sh
uptime
```

## free

查看物理内存和交换区的使用量；available 表示预计可供新进程使用的内存。

以易读单位显示内存概况。

```sh
free -h
```

## vmstat

采样进程、内存、交换区和 CPU 指标。

连续输出五组数据，首组为启动以来的统计。

```sh
vmstat 1 5
```

## iostat

统计磁盘设备的吞吐量和等待时间。

按秒查看扩展设备统计。

```sh
iostat -xz 1 3
```

## mpstat

查看各逻辑 CPU 的使用情况。

输出所有 CPU 的三组样本。

```sh
mpstat -P ALL 1 3
```

## sar

读取或采样系统活动统计。

每秒记录 CPU 使用率，共五次。

```sh
sar -u 1 5
```

## nproc

显示当前进程可用的处理器数量。

查询可用于并行构建的核数。

```sh
nproc
```

## lscpu

显示处理器架构、拓扑和能力。

按 CPU、核心、插槽和 NUMA 节点列出拓扑。

```sh
lscpu -e=CPU,CORE,SOCKET,NODE
```

## lsmem

列出内存块、状态和大小。

查看系统中的内存块。

```sh
lsmem
```

## sysctl

查询内核运行参数。

读取内核发行版本参数。

```sh
sysctl kernel.osrelease
```

## lsipc

显示系统的进程间通信资源。

查看共享内存段。

```sh
lsipc -m
```

## glances

一个跨平台的系统监控工具。

在终端中运行。

```sh
glances
```

以网页服务器模式运行，在浏览器中查看结果。

```sh
glances -w
```

以服务器模式启动，允许其他 glances 客户端连接以查看数据。

```sh
glances -s
```

作为客户端连接到 glances 服务器。

```sh
glances -c 主机名
```

在（网页）服务器模式下启用密码保护。

```sh
glances -s --password
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。
