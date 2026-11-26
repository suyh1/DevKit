# 跨网互联

当 B、C 都能向 A 的某个 UDP 端口发包并收到回复时，可把 A 设为 WireGuard 中转。三台设备各有一个隧道 IP。以默认地址为例，B 上的 SSH 客户端连接 `10.77.0.3` 时，系统把流量发给 A，A 转发到 C。回复按原路返回。B、C 可以位于 NAT 后面，A 需保持在线；链路吞吐受 A 的带宽限制。A 是两段隧道的端点，应由受信任的主机承担。

## 登记三台设备

1. 在 A、B、C 安装 WireGuard。Linux 还需要 `wg` 和 `wg-quick`。在 DevKit 打开「共享栏目 → 跨网互联」。要让其他设备参与配置，在「局域网共享」中开放此栏目。访客默认可查看和导出，勾选「维护组网配置」后才可保存参数。
2. 依次选择 A、B、C。在各设备上按页面的 Linux 命令或 Windows「新建空隧道」生成密钥，登记公钥。选择三个互异的私网隧道 IP，避开各端已有的局域网、VPN、容器网段及 A 的实际入口地址。私钥仅在对应设备上使用。
3. A 填写 UDP 监听端口，默认 51820。B 和 C 分别填写各自能访问的 A 地址和端口，例如 B 使用 `192.168.10.5:51820`，C 使用 `192.168.20.5:51820`。如果有端口映射，设备填写映射后的入口。支持域名、IPv4 和带方括号的 IPv6 入口；隧道内使用 IPv4。
4. 保存三端参数后，切换到相应设备和系统下载配置。每端仅为另外两台主机建立 /32 路由。本栏目覆盖运行 WireGuard 的三台主机，访问 B、C 背后的其他局域网设备还需要单独规划子网路由。

## 在设备上启用

**Linux**。以 A 为例，页面提供的命令把本机密钥保存在 `/etc/wireguard/devkit-a.key`。将下载的文件放在 `/etc/wireguard/devkit-a.conf`，保持文件名对应，以 root 运行 `wg-quick up devkit-a`。配置在启动时从本机文件装载私钥。在 B、C 分别使用 `devkit-b`、`devkit-c`。使用 systemd 的设备可通过 `systemctl enable wg-quick@devkit-a` 配置 A 开机启动。

**Windows**。将相应的 Windows 配置复制到该设备原先创建的同名隧道编辑器，保留原有的 `PrivateKey` 值，保存并激活。Windows 版 A 在隧道激活后，按页面提示以管理员身份开启 `devkit-a` 接口的 IPv4 转发。重建隧道接口后复核转发状态。

**A 的防火墙**。允许 B 和 C 的入口流量到达监听的 UDP 端口，允许从 WireGuard 接口进入、从同一接口发出的 B ↔ C 转发及回包。转发范围可按双方隧道 IP 和实际业务端口限定。Linux 导出的 A 配置会在每次启动时为该接口开启 IPv4 转发。先启动 A，再启动 B、C。

**变更**。重新分配隧道 IP、更换密钥或修改监听端口后，将新配置应用到受影响的设备。Linux 可先 `wg-quick down devkit-a`，替换配置后重新启动；B、C 使用各自的接口名。共享主机上的参数与操作系统正在运行的配置分别维护。

## 验证和访问

在 A 用 `wg show` 或 Windows 客户端查看两个对端最近的握手时间。只有一侧握手时，核对另一侧公钥、UDP 入口和防火墙。两侧均握手后，从 B 测试 C 的实际服务。以默认地址为例：

| 从 B 发起的操作 | 目标与条件 |
| --- | --- |
| SSH / SFTP | `ssh user@10.77.0.3` 或 `sftp user@10.77.0.3`，使用 C 已有的账号和 SSH 端口 |
| FTP | 连接 `10.77.0.3` 的 FTP 控制端口，选择被动模式。C 的防火墙放行配置的数据端口范围，PASV 公布 C 的隧道地址，或使用 EPSV |
| Web 或其他服务 | 在 B 的客户端打开 `http://10.77.0.3:8080/` 或相应服务地址。C 上的服务需监听隧道 IP 或可达接口，并允许来自 B 的访问 |

反向访问时改用 B 的地址 `10.77.0.2`。共享页面中的「已登记」统计配置进度，实时握手和传输量在 WireGuard 客户端查看。独立 DevKit 服务可以用 `DEVKIT_SHARE_WIREGUARD=true` 开放栏目，用 `DEVKIT_WIREGUARD_EDIT=true` 授予参数编辑权限。

## 方案依据

wg-easy（AGPL-3.0）用 Web 管理 WireGuard，支持登记设备自持密钥，部署其完整面板需要单独运行服务。Nebula（MIT）提供 NAT 穿透与中继，部署涉及证书、节点发现与中继策略。已知 B、C 均可到达 A 时，三端原生 WireGuard 配置即可满足固定路径需求。DevKit 生成配置并复用现有共享权限，系统 WireGuard 负责转发。[wg-easy](https://github.com/wg-easy/wg-easy) · [Nebula](https://github.com/slackhq/nebula) · [WireGuard 官方快速入门](https://www.wireguard.com/quickstart/)
