import { routingProfiles } from '../shared/routing-profiles.mjs';
import { normalizeRouting } from './relay-routing.mjs';
import { fail } from './collab-record.mjs';

// Both callers supply a normalized plan and run the probe on the source endpoint.
export async function pingDirection(plan, from, host) {
  const to = from === 'B' ? 'C' : 'B';
  const source = plan[from.toLowerCase()], target = plan[to.toLowerCase()];
  const cmd = host.platform === 'win32' ? `
    $source = @(Find-NetRoute -RemoteIPAddress '${target}' | Where-Object { $_.PSObject.Properties['IPAddress'] })
    if ($source.Count -ne 1 -or $source[0].IPAddress -ne '${source}') { 'wrong-source'; return }
    if (Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq '${target}') { 'local-target'; return }
    $ping = New-Object System.Net.NetworkInformation.Ping
    try {
      $reply = $ping.Send('${target}', 2000)
      if ($reply.Status -eq 'Success' -and $reply.Address.ToString() -eq '${target}') { 'reply' } else { 'no-reply' }
    } finally { $ping.Dispose() }` : `
    route=$(ip -4 route get ${target} from ${source})
    case "$route" in 'local '*|'broadcast '*) echo local-target; exit 0;; esac
    if ping -n -I ${source} -c 1 -W 2 ${target} >/dev/null; then echo reply
    elif [ "$?" = 1 ]; then echo no-reply
    else echo unavailable; fi`;
  let result;
  try { result = (await host.run(cmd)).trim(); } catch { /* The source could not complete the probe. */ }
  if (result === 'reply') return { from, to, status:'reply', message:'ICMP 已收到应答' };
  if (result === 'no-reply') return { from, to, status:'no-reply', message:'未收到对端的 ping 应答。可用对端原 IP 访问已开放的服务，并核对防火墙。' };
  const message = result === 'wrong-source' ? '系统选择的源地址与方案不同，请核对本机 IP 和路由。'
    : result === 'local-target' ? '目标 IP 属于本机，请核对两台设备的地址。' : '设备未能完成 ping，请核对管理连接、本机地址和 ping 权限。';
  return { from, to, status:'unverified', message };
}

async function testTcp(source, target, port, host) {
  const cmd = host.platform === 'win32' ? `
    if (Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq '${target}') { 'local-target'; return }
    $bind = [Net.IPEndPoint]::new([Net.IPAddress]::Parse('${source}'), 0)
    $client = [Net.Sockets.TcpClient]::new($bind)
    try {
      $attempt = $client.BeginConnect([Net.IPAddress]::Parse('${target}'), ${port}, $null, $null)
      if (!$attempt.AsyncWaitHandle.WaitOne(3000)) { 'timeout'; return }
      $client.EndConnect($attempt)
      'connected'
    } catch {
      if ($_.Exception.GetBaseException().SocketErrorCode -eq 'ConnectionRefused') { 'refused' } else { 'unavailable' }
    } finally { $client.Dispose() }` : `
    command -v bash >/dev/null && command -v timeout >/dev/null || { echo unavailable; exit 0; }
    route=$(ip -4 route get ${target})
    case "$route" in 'local '*|'broadcast '*) echo local-target; exit 0;; esac
    case " $route " in *" src ${source} "*) ;; *) echo wrong-source; exit 0;; esac
    if err=$(timeout 3 bash -c 'exec 3<>/dev/tcp/${target}/${port}' 2>&1); then echo connected
    elif [ "$?" = 124 ]; then echo timeout
    else case "$err" in *'Connection refused'*) echo refused;; *) echo unavailable;; esac; fi`;
  const messages = {
    connected:'TCP 已连通，可继续用客户端验证登录或业务。',
    refused:'连接被拒绝，请确认目标服务已启动，并在这个 IP 和端口监听。',
    timeout:'连接超时，请核对目标端口和沿途防火墙的放行规则。',
    'wrong-source':'本机访问该端口时选择的源 IP 与方案不同。',
    'local-target':'目标 IP 属于本机，请核对方案地址。',
    unavailable:'未能确认 TCP 连接，请从此设备用实际客户端验证。',
  };
  let status;
  try { status = (await host.run(cmd)).trim(); } catch { /* Unknown source, tool or transport error. */ }
  if (!Object.hasOwn(messages,status)) status = 'unavailable';
  return { port, status, message:messages[status] };
}

export async function verifyRouting(input, ports = {}, lan, access, connect) {
  const plan = normalizeRouting(input);
  if (!ports || typeof ports !== 'object' || Array.isArray(ports) ||
      Object.entries(ports).some(([to,port]) => !['B','C'].includes(to) || !Number.isInteger(port) || port < 1 || port > 65535))
    fail(400,'请为每台目标设备填写一个 1 至 65535 的 TCP 端口，或留空。');
  const canUseSsh = access.desktopAdmin || access.sshAllowed;
  let hosts = [];
  if (canUseSsh) {
    try { hosts = await lan.hostRequest('list'); } catch { /* A local endpoint can still be tested. */ }
  }
  const { profiles } = routingProfiles(hosts, plan.role, { A:[plan.a,plan.ab,plan.ac].filter(Boolean), B:[plan.b], C:[plan.c] });
  return Promise.all(['B','C'].map(async from => {
    const to = from === 'B' ? 'C' : 'B';
    const remote = from !== plan.role;
    if (remote && !profiles[from]) {
      const message = canUseSsh ? '无法唯一匹配已信任的 SSH 档案，请核对该设备及跳板机的管理档案。' : '从这台设备发起检测需要 SSH 终端权限。';
      return { from, to, status:'unverified', message };
    }
    access.authorize?.();
    let host;
    try {
      host = await connect(lan, remote ? profiles[from] : undefined, { elevated:false });
    } catch { return { from, to, status:'unverified', message:'无法打开设备的管理连接，请核对安装位置、SSH 档案和连接路径。' }; }
    try {
      access.authorize?.();
      const row = await pingDirection(plan, from, host);
      if (ports[to]) {
        access.authorize?.();
        row.tcp = await testTcp(plan[from.toLowerCase()], plan[to.toLowerCase()], ports[to], host);
      }
      return row;
    }
    finally { host.close(); }
  }));
}
