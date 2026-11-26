# 跨网互联

整个现场只需在一台设备运行 DevKit。在「共享栏目 → 跨网互联」新建规则，选择安装位置，填写实际服务地址和 TCP 端口。「保存并检测」会检查当前安装位置可用的路径。选择通过检测的方式后启动入口，客户端使用原有的账号、协议和程序。

| DevKit 在哪里 | B 如何访问 C | 需要什么 |
| --- | --- | --- |
| 中转端 A | 连接 A 的监听 IPv4 和端口，由 A 连接指定的 C 服务 | B 能访问 A 的入口，A 能访问 C 的服务；A、B、C 均无需 VPN |
| 访问端 B | B 连接本机入口，如 `ssh -p 2222 user@127.0.0.1` | 能直达目标，或 A 已提供获准的 SSH 本地转发、HTTP CONNECT 或 SOCKS5 |
| 服务端 C | C 通过 SSH 在 A 申请入口，B 连接 A 的地址和端口 | C 可登录 A，A 接受反向转发并允许监听 B 可达的地址；B 能访问该端口 |

B、C 表示访问端与服务端。上述端口规则按访问方向配置。双方需要主动访问对方原 IP 时，选择下方的「原 IP 双向互通」。监听地址填客户端能访问的网卡 IPv4；访问端本机使用可填 127.0.0.1。对外监听时指定允许的来源 IPv4，经过 NAT 时填监听端实际看到的地址。规则可保存 64 项，重启后手动启动。独立服务与桌面使用相同转发实现。

## 原 IP 双向互通

在「共享栏目 → 跨网互联 → 原 IP 双向互通」新建一份方案，桌面端只需填写 A 的管理 IPv4 和 B、C 的原 IPv4，点「检测并配置」。DevKit 匹配本机安装位置和已核对指纹的管理档案，从 A 分别查询到 B、C 的实际直连路由及源地址。两侧独立判断，遇到经其他网关、选路不明确或缺少档案，会说明原因，保留已确定的地址并提示补充。可选「仅保存」先生成方案。此模式要求 A 能在两侧分别充当直连下一跳，端点地址唯一，沿途网络允许保留源 IP。若实际拓扑经过其他路由器，应由相应网关管理员配置去程和回程。

打开已保存的方案，可按 B、A、C 三行核对地址。A 的两个接口分别标明「面向 B」和「面向 C」。桌面端可在地址下方选择「一键配置」，各设备的手工配置与验证步骤可按需展开。本机使用当前系统权限，其余两台复用已确认指纹的 SSH 管理档案。检测发现缺档案时，桌面端在当前方案打开对应设备的表单，预填设备地址；填写用户名、密码，核对端口、目标系统和服务器管理员提供的 SHA256 主机指纹。登录验证成功后，密码加密保存到本机的主机档案库，自动继续检测或配置。已有待验证档案可以直接选用。DevKit 在 B 上补录 C 时，读取指纹、登录和保存档案均使用方案中已信任的 A；装在 C 上补录 B 同理。表单显示管理路径。已有经该 A 登记的对端档案可直接复用，原有直连档案保留。A 缺少档案时先补录 A；若有多个符合条件的 A 账号，先确认本次使用的账号。取消或登录失败可返回原方案。可复用管理员预先登记的跳板连接。首次需具备到每台设备的管理通道，Windows 使用管理员权限，Linux 使用 root 或允许非交互 sudo 的账号。没有管理权限时，可展开各设备的 Linux 或 Windows 步骤。共享网页可查看方案，系统变更由桌面发起。

DevKit 先检查三台设备的接口、权限、路由冲突和持久化条件，然后在 A 的指定接口启用 IPv4 转发，在 B 和 C 各保存一条目的为对方原地址的 /32 路由。Linux 端点支持由 NetworkManager 或 systemd-networkd 管理的接口，A 使用 sysctl.d。Windows 使用 NetTCPIP。等效配置会保留，写入失败会尝试撤回本次变更。A 启用的是接口级转发，流量继续受现场防火墙和网络 ACL 约束。公网 NAT、重叠地址或云平台源/目标检查可能需要网管处理。

完成后，B、C 分别用对方的原 IP 和原端口访问已开放服务。DevKit 退出后系统路由仍有效。配置后的新 TCP 或 UDP 服务沿用同一路由。可在 Linux 用 `ip route get 对端IP`、在 Windows 用 `Find-NetRoute -RemoteIPAddress 对端IP` 检查选路，再从双方分别访问实际服务。方案页提供本机检测和手工撤回说明，移除方案记录仅删除 DevKit 保存的数据。[Linux 内核转发选项](https://docs.kernel.org/networking/ip-sysctl.html) · [Windows 主机路由](https://learn.microsoft.com/en-us/powershell/module/nettcpip/new-netroute)

## 检测结果和处理

- **直达目标**会从 DevKit 主机连接指定的目标端口。如已在网络设备配置静态端口映射，可把映射入口作为目标。失败时，在目标设备使用 Linux 的 `ss -lnt` 或 Windows 的 `Get-NetTCPConnection -State Listen` 核对服务绑定，再按实际来源放行服务端口。
- **SSH**先读取 A 的 SSH 协议标识，再使用「局域网主机」中地址、端口和用户名相符的档案。首次连接请通过已有可信渠道核对主机指纹。SSH 能登录后，还会实际尝试连到指定的服务或申请反向监听。探测反向监听时拒绝数据连接，随即关闭探测会话。A 接受监听请求后仍需从 B 验证防火墙、绑定与 NAT。
- **HTTP CONNECT / SOCKS5**会分别在填写的端口与 A 协商，尝试连接指定目标。默认入口为 3128 和 1080，可在规则内修改。只检查这些入口；现场使用其他端口时请填写实际值。本版支持按来源授权的免口令代理，遇到 HTTP 407 或 SOCKS 认证要求时，使用受限来源策略或选用已有 SSH 档案。
- **现场配置**。每项结果可展开「如何配置和验证」，查看本规则对应的目标地址、端口及配置。A 缺少 SSH 服务时，可由管理员启用已有的系统 OpenSSH Server，核对服务监听和账号授权。如果现场禁止增加服务，可改用已有的代理或路由。在局域网内只能 ping 通 A，且现场既无可用转发又无法更改路由时，单端应用无法建立跨网通道。
- **直接按原始 IP 访问**需要去回路由。当 A 可承担三层网关时，由网络管理员在 B 侧添加去往 C 主机/子网的路由，下一跳指向 B 侧可达的网关；在 C 侧为 B 添加返回路由。在 A 按实际接口启用 IPv4 转发，并仅允许对应来源、目的和业务端口。各侧网关须能逐跳转发至 A。栏目中的端口转发不要求修改系统路由。
- **外端验证**。入口启动后，从实际访问端使用 `Test-NetConnection <入口地址> -Port <端口>` 或目标客户端连接。SSH/SFTP 使用目标服务器的账号及指纹。HTTPS 若依赖域名或 SNI，客户端应使用证书对应的主机名。
- **FTP**同时使用控制端口与数据端口。在服务器配置固定的被动端口范围，在规则中填写同一范围（每条规则最多 32 个连续数据端口）。DevKit 对数据端口同号转发。客户端使用 EPSV 或忽略 PASV 返回的不可达 IP，沿用控制连接的地址。沿途防火墙和 SSH/代理策略须同时允许数据端口。仅转发 TCP 21 只能建立控制连接。

例如 Windows A 已有端口代理功能，B 侧地址为 `192.168.10.5`、C 的服务为 `192.168.20.8:22`。A 的管理员可以添加并查看单项映射，再在防火墙中只向 B 的实际来源放行 TCP 2222。B 用 SSH 或 SFTP 访问 `192.168.10.5:2222`，C 允许 A 访问其 TCP 22。若需撤回，仅删除对应入口。[Windows 端口映射文档](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-interface)

```text
netsh interface portproxy add v4tov4 listenaddress=192.168.10.5 listenport=2222 connectaddress=192.168.20.8 connectport=22
netsh interface portproxy show v4tov4
```

撤回该映射可使用 `netsh interface portproxy delete v4tov4 listenaddress=192.168.10.5 listenport=2222`。

## A 的 OpenSSH 配置示例

在 A 为转发专用账号设置权限。B 安装 DevKit、目标服务在 192.168.20.8:22 时：

```text
Match User devkit-forward
    AllowTcpForwarding local
    PermitOpen 192.168.20.8:22
```

C 安装 DevKit、B 使用 192.168.10.5:2222 作为入口时：

```text
Match User devkit-forward
    AllowTcpForwarding remote
    GatewayPorts clientspecified
    PermitListen 192.168.10.5:2222
```

核对账号、密钥的转发限制及 A 上实际存在的接口。先校验配置再重载服务，保留现有管理会话。登录 B 或 C 无需部署远程代理。服务转发模式的检测只验证目标和入口；系统路由由桌面的「原 IP 双向互通」模式单独配置。数据转发只使用规则指定的固定目标和已授权来源。

## 共享权限

`DEVKIT_SHARE_RELAY` 开放栏目，`DEVKIT_RELAY_EDIT` 允许维护规则，`DEVKIT_RELAY_CONTROL` 允许检测和启停。共享网页使用 SSH 凭据还需「局域网主机 → SSH 终端」权限。退出或撤销网页会话时会停止该会话建立的转发，桌面启动的转发随 DevKit 退出停止。旧 WireGuard 配置不自动创建监听或授予新权限。

SSH 连接复用项目已有 ssh2、档案与指纹校验。HTTP CONNECT 使用 Node HTTP 客户端，SOCKS5 使用随包分发的 MIT 许可 socks 客户端。与 3proxy 等独立代理服务相比，已有代理可直接复用，现场无需新装代理服务。[OpenSSH 转发选项](https://man.openbsd.org/sshd_config.5) · [ssh2](https://github.com/mscdex/ssh2) · [socks](https://github.com/JoshGlazebrook/socks) · [3proxy](https://github.com/3proxy/3proxy)
