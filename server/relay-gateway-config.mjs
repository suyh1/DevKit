import { generateKeyPairSync } from 'node:crypto';
import { fail } from './collab-record.mjs';
import { block, gatewayNetworks, ipv4, overlaps } from './relay-gateway.mjs';
import { routingAddress } from './relay-routing.mjs';
import { directRoutePlan } from './relay-gateway-routes.mjs';
import { gatewayForwarding } from './relay-gateway-forward.mjs';

function directRoutes(gateway, entries) {
  const linux = `#!/bin/sh
set -eu
hop=$(ip -4 route get ${gateway} | head -1)
case " $hop " in *' via '*|*' local '*) echo '请选择从本机直达 A 的接口目录' >&2; exit 1;; esac
dev=$(printf '%s\\n' "$hop" | awk '{for(i=1;i<NF;i++) if($i=="dev") print $(i+1)}')
test -n "$dev"
pending=''
addr=$(ip -o -4 address show)
local_ips=$(printf '%s\\n' "$addr" | awk '{split($4,a,"/"); printf "%s ", a[1]}')
# Each row contains a destination and any next hops that must keep their own route.
for entry in ${entries.map(s => "'" + s + "'").join(' ')}; do
  set -- $entry
  prefix=$1
  shift
  for next_hop do
    case " $local_ips " in *" $next_hop "*) continue 2;; esac
  done
  current=$(ip -4 route show exact "$prefix")
  case " $current " in
    "  ") pending="$pending $prefix";;
    *" via ${gateway} dev $dev "*) ;;
    *" scope link "*) ;;
    *) echo "已有路由，请核对 $prefix：$current" >&2; exit 1;;
  esac
done
added=''
rollback() { for prefix in $added; do ip -4 route del "$prefix" via ${gateway} dev "$dev"; done; }
trap 'rollback' EXIT
trap 'exit 1' HUP INT TERM
for prefix in $pending; do
  ip -4 route add "$prefix" via ${gateway} dev "$dev"
  added="$prefix $added"
done
trap - EXIT HUP INT TERM
`;
  const windows = `$ErrorActionPreference = 'Stop'
$hop = @(Find-NetRoute -RemoteIPAddress '${gateway}' | Where-Object { $_.PSObject.Properties['NextHop'] })
if ($hop.Count -ne 1 -or $hop[0].NextHop -ne '0.0.0.0' -or (Get-NetIPAddress -IPAddress '${gateway}' -ErrorAction SilentlyContinue)) { throw '请选择从本机直达 A 的接口目录' }
$pending = [Collections.Generic.List[string]]::new()
$localIPs = @((Get-NetIPAddress -AddressFamily IPv4).IPAddress)
foreach ($entry in @(${entries.map(s => "'" + s + "'").join(', ')})) {
  $prefix, $nextHops = $entry.Split(' ')
  if ($nextHops | Where-Object { $_ -in $localIPs }) { continue }
  $route = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix $prefix -ErrorAction SilentlyContinue)
  if ($route.Count -eq 1 -and $route[0].NextHop -eq '0.0.0.0') { continue }
  $saved = @(Get-NetRoute -AddressFamily IPv4 -PolicyStore PersistentStore -DestinationPrefix $prefix -ErrorAction SilentlyContinue)
  if (!$route.Count -and !$saved.Count) { $pending.Add($prefix); continue }
  if ($route.Count -ne 1 -or $saved.Count -ne 1 -or @(@($route[0], $saved[0]) | Where-Object { $_.NextHop -ne '${gateway}' -or $_.InterfaceIndex -ne $hop[0].InterfaceIndex }).Count) { throw "已有路由，请核对 $prefix" }
}
$added = [Collections.Generic.List[string]]::new()
try {
  foreach ($prefix in $pending) {
    New-NetRoute -DestinationPrefix $prefix -InterfaceIndex $hop[0].InterfaceIndex -NextHop '${gateway}' -ErrorAction Stop | Out-Null
    $added.Add($prefix)
  }
} catch {
  foreach ($prefix in $added) { Remove-NetRoute -DestinationPrefix $prefix -InterfaceIndex $hop[0].InterfaceIndex -NextHop '${gateway}' -Confirm:$false }
  throw
}
`;
  return { linux, windows };
}

// Produce maximal CIDRs without capturing the tunnel's own UDP endpoint or a client's local LAN.
function allowedRoutes(networks, exceptions) {
  const omit = exceptions.map(block), result = [];
  function visit(start, size) {
    const end = start + size - 1;
    if (omit.some(r => r.start <= start && end <= r.end)) return;
    if (omit.some(r => r.start <= end && start <= r.end)) {
      visit(start, size / 2); visit(start + size / 2, size / 2);
    } else result.push(ipv4(start) + '/' + (32 - Math.log2(size)));
  }
  const ordered = networks.map(block).sort((a,b) => a.start - b.start || b.end - a.end);
  let covered = -1;
  for (const r of ordered) if (r.end > covered) {
    visit(r.start, r.end - r.start + 1); covered = r.end;
  }
  return result;
}
function tunnelBase(occupied, previous) {
  const used = occupied.map(block).sort((a,b) => a.start - b.start);
  const pools = ['10.77.0.0/16','172.16.0.0/12','192.168.0.0/16','10.0.0.0/8','100.64.0.0/10'].map(block);
  const prior = block(previous);
  if (prior && prior.end - prior.start === 7 && pools.some(p => p.start <= prior.start && prior.end <= p.end) &&
      used.every(r => !overlaps(r, prior))) return prior.start;
  for (const pool of pools) {
    let start = pool.start;
    for (const r of used) {
      if (r.start > start + 7) break;
      if (r.end >= start) start = Math.ceil((r.end + 1) / 8) * 8;
    }
    if (start + 7 <= pool.end) return start;
  }
  fail(400, '无法分配与现场网段互不重叠的隧道地址段，请核对 A 与客户端的路由。');
}
function wireGuardKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const raw = (key, field) => Buffer.from(key.export({ format:'jwk' })[field], 'base64url').toString('base64');
  return { publicKey:raw(publicKey,'x'), privateKey:raw(privateKey,'d') };
}

// Keep native connected routes when a client is itself inside one of A's advertised LANs.
function prepareClient(name, tunnelNet) {
  const linux = `#!/bin/sh
set -eu
cd "$(dirname "$0")"
umask 077
mkdir -p ready
temp=$(mktemp ready/profile.XXXXXX)
trap 'rm -f "$temp"' EXIT
ip -o -4 address show up | awk '$2 != "${name}" {print $4}' > "$temp"
awk -v tunnel='${tunnelNet}' '
  function bounds(c, v, oct, i, n, size) {
    split(c,v,"/"); split(v[1],oct,"."); n=0
    for (i=1;i<=4;i++) n=n*256+oct[i]
    size=2^(32-v[2]); lo=int(n/size)*size; hi=lo+size-1
  }
  FILENAME==ARGV[1] { bounds($1); lows[++count]=lo; highs[count]=hi; next }
  FNR==1 {
    bounds(tunnel)
    for (j=1;j<=count;j++) if (lo<=highs[j] && lows[j]<=hi) {
      print "隧道地址段与本机网络重叠，请在桌面补入本地优先网段后重新导出。" > "/dev/stderr"; exit 1
    }
  }
  /^AllowedIPs = / {
    sub(/^AllowedIPs = /,""); total=split($0,items,/, */); list=""
    for (i=1;i<=total;i++) {
      bounds(items[i])
      for (j=1;j<=count;j++) if (lows[j]<=lo && hi<=highs[j]) break
      if (j>count) list=list (list ? ", " : "") items[i]
    }
    print "AllowedIPs = " list; next
  }
  { print }
' "$temp" '${name}.conf' > "$temp.conf" && mv "$temp.conf" 'ready/${name}.conf' || { rm -f "$temp.conf"; exit 1; }
echo '已生成 ready/${name}.conf'
`;
  const windows = `$ErrorActionPreference = 'Stop'
function Get-Range([string]$cidr) {
  $address, $prefix = $cidr.Split('/')
  $bytes = [Net.IPAddress]::Parse($address).GetAddressBytes()
  [array]::Reverse($bytes)
  $size = [Math]::Pow(2, 32 - [int]$prefix)
  $low = [Math]::Floor([BitConverter]::ToUInt32($bytes, 0) / $size) * $size
  @{ low=$low; high=$low+$size-1 }
}
$up = @((Get-NetIPInterface -AddressFamily IPv4 | Where-Object { $_.ConnectionState -eq 'Connected' -and $_.InterfaceAlias -ne '${name}' }).InterfaceIndex)
$local = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceIndex -in $up } | ForEach-Object { Get-Range "$($_.IPAddress)/$($_.PrefixLength)" })
$vpn = Get-Range '${tunnelNet}'
if ($local | Where-Object { $_.low -le $vpn.high -and $vpn.low -le $_.high }) { throw '隧道地址段与本机网络重叠，请在桌面补入本地优先网段后重新导出。' }
$config = Get-Content (Join-Path $PSScriptRoot '${name}.conf') | ForEach-Object {
  if ($_.StartsWith('AllowedIPs = ')) {
    $allowed = foreach ($cidr in $_.Substring(13).Split(',')) {
      $range = Get-Range $cidr.Trim()
      if (!($local | Where-Object { $_.low -le $range.low -and $range.high -le $_.high })) { $cidr.Trim() }
    }
    'AllowedIPs = ' + ($allowed -join ', ')
  } else { $_ }
}
$folder = [IO.Directory]::CreateDirectory((Join-Path $PSScriptRoot 'ready'))
[IO.File]::WriteAllLines((Join-Path $folder.FullName '${name}.conf'), [string[]]$config, [Text.UTF8Encoding]::new($false))
Write-Output '已生成 ready/${name}.conf'
`;
  return { linux, windows };
}

export function gatewayFiles(input) {
  const a = routingAddress(input.a, ' A '), networks = gatewayNetworks(input.networks);
  if (!networks.length) fail(400, '请至少选择一个目的网段。');
  if (!Array.isArray(input.links) || input.links.length > 4096) fail(400, '请重新读取 A 的接口。');
  const links = input.links.map(link => {
    const address = routingAddress(link.address), [network] = gatewayNetworks([link.network]);
    if (!overlaps(block(address + '/32'), block(network))) fail(400, 'A 的地址与接口网段不符。');
    return { address, network, device:link.device ?? address };
  });
  const files = {};
  const addresses = [...new Set(links.map(l => l.address))];
  const tunnel = input.mode === 'tunnel';
  if (!tunnel && input.mode !== 'direct') fail(400, '请选择接入方式。');
  const instructions = [
    '经 A 访问局域网', 'A 的管理或接入地址 ' + a, '目的 IPv4 网段 ' + networks.join('、'), '',
    '请用管理员权限在标注的设备上应用配置。服务使用原 IP、原端口和原账号。A 与目标设备的防火墙须允许相应流量。',
  ];
  if (!tunnel) {
    Object.assign(files, gatewayForwarding(addresses));
    const plan = directRoutePlan(networks, links, input.routes);
    for (const link of links) {
      const { address } = link;
      const destinations = plan(link);
      if (!destinations.length) continue;
      const scripts = directRoutes(address, destinations);
      files['via-' + address + '/routes.sh'] = scripts.linux;
      files['via-' + address + '/routes.ps1'] = scripts.windows;
    }
    if (!Object.keys(files).some(p => p.startsWith('via-'))) fail(400, '没有需要经 A 转发的其他网段。请核对目的网段，或选择三层隧道。');
    instructions.push('', '1. 在 A 上运行 A/forward.sh 或 A/forward.ps1。',
      '2. 在每一侧网关选择 via- 后面为该侧直连 A 地址的目录，按系统运行 routes.sh 或 routes.ps1。手动配置硬件路由器时，逐行查看脚本的目的前缀：如果该行后续列出了本机的任一 IP，请保留原路由；其余前缀使用目录名中的 A 地址作为下一跳。两侧网关都配置后，使用它们作为网关的主机即可互访。',
      '3. 也可在 B 或 C 本机运行对应脚本，让该设备接入。在目标侧网关添加经 A 返回访问端网段的路由。目标主机以 A 为网关时已有回程。',
      '4. Windows 新增路由默认持久保存。Linux 脚本设置当前运行状态，重启后重新运行，或将等效静态路由保存到 NetworkManager / systemd-networkd，将接口转发设置保存到 sysctl.d。',
      '验证时在 B、C 各选择对方网段的一台普通主机，使用其原 IP 打开实际服务。用 ip route get 或 Find-NetRoute 核对去程与回程。');
  } else {
    const port = input.port ?? 51820;
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail(400, 'A 的 UDP 端口无效。');
    const local = ['B','C'].map(role => gatewayNetworks(input.local?.[role] ?? []));
    const base = tunnelBase([...gatewayNetworks(input.occupiedTunnels ?? []), ...gatewayNetworks(input.discovered ?? []), ...networks, ...links.map(l => l.network), ...local.flat(), a + '/32'], input.previousTunnel);
    const tunnelNet = ipv4(base) + '/29', hub = ipv4(base + 1);
    const keys = [wireGuardKeys(), wireGuardKeys(), wireGuardKeys()];
    const peers = ['B','C'].map((role,i) => {
      const ip = ipv4(base + 2 + i);
      const allowed = allowedRoutes(networks, [a + '/32', ...local[i]]);
      const prepare = prepareClient('devkit-' + role.toLowerCase(), tunnelNet);
      files[role + '/prepare.sh'] = prepare.linux;
      files[role + '/prepare.ps1'] = prepare.windows;
      files[role + '/devkit-' + role.toLowerCase() + '.conf'] = `[Interface]
PrivateKey = ${keys[i + 1].privateKey}
Address = ${ip}/32

[Peer]
PublicKey = ${keys[0].publicKey}
Endpoint = ${a}:${port}
AllowedIPs = ${[hub + '/32', ...allowed].join(', ')}
PersistentKeepalive = 25
`;
      return `[Peer]\nPublicKey = ${keys[i + 1].publicKey}\nAllowedIPs = ${ip}/32`;
    });
    files['A/devkit-a.conf'] = `[Interface]\nPrivateKey = ${keys[0].privateKey}\nAddress = ${hub}/29\nListenPort = ${port}\n\n${peers.join('\n\n')}\n`;
    Object.assign(files, gatewayForwarding(addresses, { address:hub, network:tunnelNet }));
    instructions.push('', `1. 整包包含三份私钥，请保存在管理员目录，只向每台设备分发自己的目录。同一部署使用同一次导出的配置。每次重新导出会生成新的密钥。`,
      `2. 在 A 和使用隧道的客户端安装 WireGuard。先在 A 导入并启用 devkit-a.conf，放行指向 A 的 UDP ${port}。A 位于 NAT 后时，将该 UDP 端口映射到 A，客户端 Endpoint 填写实际可达的外部地址。`,
      '3. 在 A 以管理员运行 forward.ps1，Linux 以 root 运行 sh forward.sh（需要 iproute2、sysctl 和 iptables）。脚本启用接口转发及隧道来源的 SNAT，使目标主机可以直接向 A 回包。沿途 ACL 和转发防火墙需允许隧道流量。Linux 重启后重新应用。已有 SNAT 或使用回程路由的现场，可按脚本核对转发并沿用现有网络策略。',
      `4. 在 B 和 C 各自运行本目录的 prepare.ps1 或 sh prepare.sh，自动保留本机直连路由。Windows 在 WireGuard 中导入生成的 ready 目录下的 .conf。Linux 将该文件以 0600 保存到 /etc/wireguard，使用 wg-quick up devkit-b 或 wg-quick up devkit-c。查看最近握手，先验证 A 的隧道地址 ${hub}，再从 B、C 分别访问目的网段中其他主机的原 IP 和服务。`,
      '混合现场可仅给隔着其他网关的一端分发隧道配置，另一端按直连网关方式部署。局域网中其他设备若也要主动经隧道访问，可在该侧网关部署客户端并为来自 LAN 的流量配置源 NAT，或规划站点间返回路由与 WireGuard 的来源前缀。',
      '停用接入时关闭对应隧道。Linux 可按 forward.sh 中 nat_rule 的参数，用 -D 撤回本次新增的 MASQUERADE 规则；Windows 可移除本次新建的 DevKit-Gateway NAT。接口转发按部署前状态恢复。');
  }
  files['部署说明.txt'] = instructions.join('\n') + '\n';
  return files;
}

export async function gatewayArchive(input) {
  const files = gatewayFiles(input);
  const { default: yazl } = await import('yazl');
  const archive = new yazl.ZipFile();
  for (const [path, source] of Object.entries(files)) {
    const content = path.endsWith('.ps1') ? '\uFEFF' + source.replace(/\n/g, '\r\n') : source;
    archive.addBuffer(Buffer.from(content), path, { mode:path.endsWith('.sh') ? 0o100700 : 0o100600 });
  }
  archive.end();
  return archive.outputStream;
}
