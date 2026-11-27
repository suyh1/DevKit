// Both exported scripts complete their read-only checks before the first write.
export function gatewayForwarding(addresses, tunnel) {
  const ips = [...new Set(tunnel ? [...addresses, tunnel.address] : addresses)];
  const linux = `#!/bin/sh
set -efu
pending=''
for address in ${ips.join(' ')}; do
  found=$(ip -o -4 address show to "$address/32")
  dev=$(printf '%s\\n' "$found" | awk 'NR==1 {sub(/@.*/, "", $2); dev=$2} END {if(NR==1) print dev}')
  test -n "$dev" || { echo "未找到 A 的接口地址 $address" >&2; exit 1; }
${tunnel ? `  if [ "$address" = '${tunnel.address}' ] && [ "$dev" != devkit-a ]; then echo '请先启用本次导出的 devkit-a 隧道' >&2; exit 1; fi\n` : ''}  state=$(sysctl -n "net/ipv4/conf/$dev/forwarding")
  case "$state" in
    1) ;;
    0) case " $pending " in *" $dev "*) ;; *) pending="$pending $dev";; esac;;
    *) echo "无法读取 $dev 的转发状态" >&2; exit 1;;
  esac
done
${tunnel ? `nat_rule() { iptables -w -t nat "$1" POSTROUTING -s ${tunnel.network} ! -o devkit-a -j MASQUERADE; }
iptables -w -t nat -S POSTROUTING >/dev/null
need_nat=0
if nat_rule -C 2>/dev/null; then :; else rc=$?; [ "$rc" -eq 1 ] || exit "$rc"; need_nat=1; fi
` : ''}changed=''
rollback() {
  for dev in $changed; do
    sysctl -qw "net/ipv4/conf/$dev/forwarding=0" || echo "请复核 $dev 的转发状态" >&2
  done
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM
for dev in $pending; do
  state=$(sysctl -n "net/ipv4/conf/$dev/forwarding")
  if [ "$state" = 0 ]; then
    changed="$dev $changed"
    sysctl -qw "net/ipv4/conf/$dev/forwarding=1"
  fi
done
${tunnel ? `if [ "$need_nat" = 1 ]; then nat_rule -A; fi\n` : ''}trap - EXIT HUP INT TERM
`;
  const windows = `$ErrorActionPreference = 'Stop'
$pending = @{}
$persistent = @(Get-NetIPInterface -PolicyStore PersistentStore | Where-Object AddressFamily -eq IPv4)
foreach ($address in @(${ips.map(ip => "'" + ip + "'").join(', ')})) {
  $ip = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $address -ErrorAction Stop)
  if ($ip.Count -ne 1) { throw "请核对 A 的接口地址 $address" }
${tunnel ? `  if ($address -eq '${tunnel.address}' -and $ip[0].InterfaceAlias -ne 'devkit-a') { throw '请先启用本次导出的 devkit-a 隧道' }\n` : ''}  $idx = [int]$ip[0].InterfaceIndex
  $active = (Get-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $idx -PolicyStore ActiveStore).Forwarding
  $saved = ($persistent | Where-Object InterfaceIndex -eq $idx).Forwarding
  if ($null -eq $saved) { $saved = 'Disabled' }
  if ($active -notin 'Enabled','Disabled' -or $saved -notin 'Enabled','Disabled') { throw "无法读取接口 $idx 的转发状态" }
  if ($active -ne 'Enabled' -or $saved -ne 'Enabled') { $pending[$idx] = @{ active=[string]$active; saved=[string]$saved } }
}
${tunnel ? `$nat = @(Get-NetNat -ErrorAction Stop)
if ($nat.Count -and !($nat | Where-Object InternalIPInterfaceAddressPrefix -eq '${tunnel.network}')) { throw '已有其他 WinNAT，请先规划源 NAT 或回程路由。' }
` : ''}$changed = [Collections.Generic.List[int]]::new()
try {
  foreach ($idx in $pending.Keys) {
    $changed.Add($idx)
    if ($pending[$idx].saved -eq 'Enabled') {
      Set-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $idx -PolicyStore ActiveStore -Forwarding Enabled
    } else { Set-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $idx -Forwarding Enabled }
  }
${tunnel ? `  if (!$nat.Count) { New-NetNat -Name 'DevKit-Gateway' -InternalIPInterfaceAddressPrefix '${tunnel.network}' -ErrorAction Stop | Out-Null }\n` : ''}} catch {
  $failure = $_
  $changed.Reverse()
  foreach ($idx in $changed) {
    $old = $pending[$idx]
    try {
      if ($old.saved -ne 'Enabled') { Set-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $idx -Forwarding $old.saved }
      if ($old.active -ne $old.saved) { Set-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $idx -PolicyStore ActiveStore -Forwarding $old.active }
    } catch { Write-Warning "撤回接口 $idx 失败，请复核转发状态" }
  }
  throw $failure
}
`;
  return { 'A/forward.sh': linux, 'A/forward.ps1': windows };
}
