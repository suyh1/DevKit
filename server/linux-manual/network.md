## ip

显示/操作路由、设备、策略路由和隧道。 一些子命令（例如 `address`）有自己的使用文档。

列出带有详细信息的接口。

```sh
ip a
```

列出带有简要网络层信息的接口。

```sh
ip -br a
```

列出带有简要链路层信息的接口。

```sh
ip -br l
```

显示路由表。

```sh
ip r
```

显示邻居（ARP 表）。

```sh
ip n
```

## ip address

查看或配置网络接口地址。

列出所有接口的 IPv4 地址。

```sh
ip -4 address show
```

## ip link

查看网络接口的链路属性。

以紧凑形式列出接口。

```sh
ip -brief link show
```

## ip route

查看或修改内核的路由表。

显示当前默认路由。

```sh
ip route show default
```

## ip neighbour

查看内核维护的邻居缓存。

列出已知的同链路邻居。

```sh
ip neighbour show
```

## ss

用于检查套接字（sockets）的实用程序。

显示所有 TCP/UDP/RAW/UNIX 套接字。

```sh
ss -a --tcp
```

根据状态过滤 TCP 套接字（仅显示/排除）。

```sh
ss state bucket
```

显示所有连接到本地 HTTPS 端口（443）的 TCP 套接字。

```sh
ss -t src :443
```

显示所有监听本地 8080 端口的 TCP 套接字。

```sh
ss -lt src :8080
```

显示所有连接到远程 SSH 端口的 TCP 套接字及其对应的进程。

```sh
ss -pt dst :ssh
```

## ping

向网络主机发送 ICMP (ECHO_REQUEST) 数据包。

Ping 主机。

```sh
ping 主机地址
```

仅 Ping 主机特定次数。

```sh
ping -c 次数 主机地址
```

Ping 主机，指定请求之间的间隔（以秒为单位）（默认为 1 秒）。

```sh
ping -i 间隔秒数 主机地址
```

Ping 主机而不尝试查找地址的符号名称。

```sh
ping -n 主机地址
```

Ping 主机并在收到数据包时响铃（如果您的终端支持）。

```sh
ping -a 主机地址
```

## traceroute

观察数据包到目的地址时经过的路由跳点。

对示例域名进行路径诊断。

```sh
traceroute example.org
```

## tracepath

查看到目标的路径及沿途路径 MTU。

诊断示例域名的网络路径。

```sh
tracepath example.org
```

## dig

查询 DNS 记录并查看应答详情。

只输出示例域名的 IPv4 记录。

```sh
dig +short example.org A
```

## nslookup

向名称服务器查询各类域名记录。

使用系统默认名称服务器查询域名的 IP 地址（A 记录）。

```sh
nslookup example.com
```

向指定名称服务器查询域名的 NS 记录。

```sh
nslookup -type=NS example.com 8.8.8.8
```

查询 IP 地址的反向解析（PTR 记录）。

```sh
nslookup -type=PTR 54.240.162.118
```

使用 TCP 协议查询任意（ANY）可用记录。

```sh
nslookup -vc -type=ANY example.com
```

使用 TCP 协议向指定名称服务器查询整个区域文件（zone transfer）。

```sh
nslookup -vc -type=AXFR example.com 名称服务器
```

## host

按名称查询 DNS 记录。

查询示例域名的邮件交换记录。

```sh
host -t MX example.org
```

## resolvectl

查询 systemd-resolved 的 DNS 配置和解析结果。

查看各接口的域名服务器。

```sh
resolvectl status
```

## ethtool

查询网卡驱动、链路速率与双工状态。

查看网卡驱动信息。

```sh
ethtool -i eth0
```

## nmcli

通过命令行查询 NetworkManager。

概览各设备的类型和连接状态。

```sh
nmcli device status
```

## ifconfig

网络接口配置工具。

查看某个网络接口的网络设置。

```sh
ifconfig 接口名称
```

显示所有接口的详细信息，包括已禁用的接口。

```sh
ifconfig -a
```

禁用一个接口。

```sh
ifconfig 接口名称 down
```

启用一个接口。

```sh
ifconfig 接口名称 up
```

为一个接口分配 IP 地址。

```sh
ifconfig 接口名称 ip地址
```

## route

查看或维护传统 Linux 路由表。

以数字地址显示路由。

```sh
route -n
```

## netstat

显示与网络相关的信息，如打开的连接、打开的套接字端口等。

列出所有端口。

```sh
netstat -a
```

列出所有被监听端口。

```sh
netstat -l
```

列出监听的 TCP 端口。

```sh
netstat -t
```

显示 PID 和程序名。

```sh
netstat -p
```

持续列出信息。

```sh
netstat -c
```

## nload

在终端中可视化查看网络流量。

查看所有网络接口的流量（使用`<ArrowKeys>`切换不同网口）。

```sh
nload
```

查看指定网络接口的流量（使用`<ArrowKeys>`切换网口）。

```sh
nload devices 网口1 网口2 ...
```

## ipcalc

计算 IPv4 子网的网络地址、掩码和范围。

检查文档示例网段的地址范围。

```sh
ipcalc 192.0.2.0/26
```

## arp

显示和操作系统的 ARP 缓存。

显示当前的 ARP 表。

```sh
arp -a
```

删除特定条目。

```sh
arp -d 地址
```

创建指定条目。

```sh
arp -s 地址 MAC 地址
```

译文与示例节选自 [tldr-pages 团队及贡献者](https://github.com/tldr-pages/tldr/tree/ab12845965343cfecb51bf2d4db03f3f1f1c75b9/pages.zh)，依照 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 许可整理。DevKit 按主题重编，简化了示例占位符，并补充了部分说明和用法。
