import { gatewayNetworks } from './relay-gateway.mjs';
import { routingAddress } from './relay-routing.mjs';

// Pinned official Windows installers from Microsoft's WireGuard.WireGuard manifest.
// Administrative extraction leaves the system's installed applications untouched.
const windowsTools = `
$installed = Join-Path $env:ProgramFiles 'WireGuard'
if (!(Test-Path "$installed/wireguard.exe") -or !(Test-Path "$installed/wg.exe")) {
  $arch = $env:PROCESSOR_ARCHITECTURE
  $packages = @{
    AMD64=@('amd64','76FCEC042C5989C5B816CD32EAED1E5B1C3B998A4B1C9ECA55F299E3314EF7E4')
    ARM64=@('arm64','E11F22D22E2E938822C39B88EE04AF814B2FB53B70ACB00A0BD1BCB2C3F36B1C')
  }
  if (!$packages.ContainsKey($arch)) { throw '此 Windows 架构缺少 WireGuard 运行组件' }
  $package=$packages[$arch]
  $msi=Join-Path $dir 'wireguard.msi'
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 90 ("https://download.wireguard.com/windows-client/wireguard-"+$package[0]+"-0.5.3.msi") -OutFile $msi
  if ((Get-FileHash $msi -Algorithm SHA256).Hash -ne $package[1]) { throw 'WireGuard 安装包校验失败' }
  $expanded=Join-Path $dir 'tools'
  $proc=Start-Process msiexec.exe -ArgumentList ('/a "'+$msi+'" /qn TARGETDIR="'+$expanded+'"') -PassThru -Wait
  if ($proc.ExitCode -ne 0) { throw "解压 WireGuard 失败 ($($proc.ExitCode))" }
}
`;
const linuxTools = `
if ! command -v wg >/dev/null || ! command -v wg-quick >/dev/null; then
  mkdir "$dir/tools"
  cd "$dir/tools"
  if command -v apt-get >/dev/null && command -v dpkg-deb >/dev/null; then
    apt-get download wireguard-tools >&2
    dpkg-deb -x ./*.deb .
  elif command -v dnf >/dev/null && command -v rpm2cpio >/dev/null && command -v cpio >/dev/null; then
    dnf download wireguard-tools >&2
    rpm2cpio ./*.rpm > tools.cpio
    cpio -id --quiet < tools.cpio
  else echo '系统缺少 WireGuard，软件源不能提供临时运行组件' >&2; exit 1; fi
fi
command -v wg >/dev/null && command -v wg-quick >/dev/null || { echo '读取 WireGuard 组件失败' >&2; exit 1; }
`;

export function tunnelOperation(platform, op, action, config) {
  if (!/^[a-f\d]{12}$/.test(op.tag) || !['A','B'].includes(op.role)) throw Error('隧道部署标记无效。');
  const name = 'dg' + op.role.toLowerCase() + op.tag;
  const windows = platform === 'win32';
  const init = windows
    ? `$dir=Join-Path $env:ProgramFiles 'DevKit-Gateway-${name}'; $file=Join-Path $dir '${name}.conf'; $svc='WireGuardTunnel$${name}'\n`
    : `dir=/run/devkit-gateway-${name}\nfile="$dir/${name}.conf"\nexport PATH="$dir/tools/usr/bin:$PATH"\n`;
  const wg = windows ? `
$bin=Join-Path $env:ProgramFiles 'WireGuard'
if (!(Test-Path "$bin/wireguard.exe") -or !(Test-Path "$bin/wg.exe")) { $bin=(Get-ChildItem "$dir/tools" -Recurse -Filter wireguard.exe -ErrorAction Stop | Select-Object -First 1).DirectoryName }
` : '';
  if (op.kind === 'files') {
    if (action === 'state') return init + (windows ? "if (Test-Path -LiteralPath $dir) { 'present' } else { 'missing' }" : 'if [ -d "$dir" ]; then echo present; else echo missing; fi');
    if (action === 'undo') return init + (windows ? 'Remove-Item -LiteralPath $dir -Force -Recurse' : 'rm -r -- "$dir"');
    if (typeof config !== 'string' || !config.startsWith('[Interface]\n') || /[\r\0]/.test(config)) throw Error('隧道配置无效。');
    const encoded = Buffer.from(config).toString('base64');
    return init + (windows ? `
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
foreach ($sid in 'S-1-5-18','S-1-5-32-544') {
  $who=New-Object Security.Principal.SecurityIdentifier($sid)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($who,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
}
if (Test-Path $dir) { throw '临时目录已存在' }
[IO.Directory]::CreateDirectory($dir,$acl) | Out-Null
${windowsTools}
[IO.File]::WriteAllBytes($file,[Convert]::FromBase64String('${encoded}'))
` : `umask 077
mkdir -m 700 "$dir"
${linuxTools}
printf '%s' '${encoded}' | base64 -d > "$file"`);
  }
  if (op.kind === 'tunnel') {
    if (windows) return init + (action === 'state' ? `$s=Get-Service -Name $svc -ErrorAction SilentlyContinue
if ($s) { 'present' } else { 'missing' }` : wg + (action === 'add' ? `
& "$bin/wireguard.exe" /installtunnelservice $file
if ($LASTEXITCODE) { throw '启动 WireGuard 隧道失败' }
(Get-Service -Name $svc).WaitForStatus('Running',[TimeSpan]::FromSeconds(25))
` : `
& "$bin/wireguard.exe" /uninstalltunnelservice '${name}'
if ($LASTEXITCODE) { throw '移除 WireGuard 隧道失败' }
`));
    return init + ({
      state:`if ip link show dev ${name} >/dev/null 2>&1; then echo present; else echo missing; fi`,
      add:'wg-quick up "$file"', undo:'wg-quick down "$file"',
    })[action];
  }
  if (op.kind === 'firewall' && windows) {
    if (!Number.isInteger(op.port) || op.port < 1 || op.port > 65535) throw Error('隧道端口无效。');
    return init + ({
      state:`if (Get-NetFirewallRule -PolicyStore PersistentStore -Name '${name}' -ErrorAction SilentlyContinue) { 'present' } else { 'missing' }`,
      add:`New-NetFirewallRule -PolicyStore PersistentStore -Name '${name}' -DisplayName 'DevKit ${name}' -Direction Inbound -Action Allow -Protocol UDP -LocalPort ${op.port} | Out-Null`,
      undo:`Remove-NetFirewallRule -PolicyStore PersistentStore -Name '${name}' -ErrorAction Stop`,
    })[action];
  }
  if (op.kind === 'nat') {
    const [network] = gatewayNetworks([op.network]);
    if (windows) return init + ({
      state:`$n=@(Get-NetNat -ErrorAction Stop)
if (!$n.Count) { 'missing' } elseif (@($n | Where-Object { $_.Name -eq '${name}' -and $_.InternalIPInterfaceAddressPrefix -eq '${network}' }).Count -eq 1) { 'present' }
elseif ($n | Where-Object InternalIPInterfaceAddressPrefix -eq '${network}') { 'local' } else { throw '已有其他 WinNAT，无法为此隧道添加地址转换' }`,
      add:`New-NetNat -Name '${name}' -InternalIPInterfaceAddressPrefix '${network}' -ErrorAction Stop | Out-Null`,
      undo:`Remove-NetNat -Name '${name}' -Confirm:$false`,
    })[action];
    const rule = `POSTROUTING -s ${network} ! -o ${name} -m comment --comment ${name} -j MASQUERADE`;
    return init + ({
      state:`iptables -w -t nat -S POSTROUTING >/dev/null
if iptables -w -t nat -C ${rule} 2>/dev/null; then echo present; else rc=$?; [ "$rc" = 1 ] || exit "$rc"; echo missing; fi`,
      add:'iptables -w -t nat -A ' + rule, undo:'iptables -w -t nat -D ' + rule,
    })[action];
  }
  if (op.kind === 'handshake') {
    const hub = routingAddress(op.ip);
    if (windows) return init + wg + `
ping.exe -n 1 -w 1000 '${hub}' | Out-Null
foreach ($i in 1..10) {
  $last= & "$bin/wg.exe" show '${name}' latest-handshakes
  if ($LASTEXITCODE -eq 0 -and $last -match '\\s[1-9]\\d*\\s*$') { 'present'; return }
  Start-Sleep -Milliseconds 600
}
throw '未收到 A 的 WireGuard 握手，请核对 UDP 端口和网络防火墙。'`;
    return init + `ping -c 1 -W 1 ${hub} >/dev/null 2>&1 || true
for i in 1 2 3 4 5 6 7 8; do
  if wg show ${name} latest-handshakes | awk '$2>0 {ok=1} END {exit !ok}'; then echo present; exit 0; fi
  sleep 1
done
echo '未收到 A 的 WireGuard 握手，请核对 UDP 端口和网络防火墙。' >&2; exit 1`;
  }
  throw Error('未知的隧道部署步骤。');
}
