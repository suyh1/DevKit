// Reconstruct commands from the typed undo journal. Never execute saved command text.
import { routingAddress } from './relay-routing.mjs';
import { gatewayNetworks, block, ipv4 } from './relay-gateway.mjs';
import { forwardingLease } from './relay-gateway-forward-lease.mjs';
import { tunnelOperation } from './relay-gateway-tunnel.mjs';

export function gatewayOperation(platform, op, action, config) {
  if (!['state','owned','add','undo'].includes(action)) throw Error('未知的部署步骤。');
  const windows = platform === 'win32';
  if (op.kind === 'forward') {
    const ip = routingAddress(op.ip);
    if (windows) {
      const init = `$idx = @(Get-NetIPAddress -IPAddress '${ip}' -AddressFamily IPv4 -ErrorAction SilentlyContinue)
${op.transient && ['state','owned'].includes(action) ? "if (!$idx.Count) { 'missing'; return }" : ''}
if ($idx.Count -ne 1) { throw '无法唯一确定转发接口 ${ip}' }
$argsIP = @{ InterfaceIndex = $idx[0].InterfaceIndex; AddressFamily = 'IPv4'; PolicyStore = 'ActiveStore' }`;
      const commands = {
        state:"$s=(Get-NetIPInterface @argsIP).Forwarding; if ($s -eq 'Enabled') { 'present' } elseif ($s -eq 'Disabled') { 'missing' } else { throw '无法读取接口转发状态' }",
        add:'Set-NetIPInterface @argsIP -Forwarding Enabled', undo:'Set-NetIPInterface @argsIP -Forwarding Disabled',
      };
      return forwardingLease(platform,op,action,init,commands.state,commands.add,commands.undo);
    }
    const init = `dev=$(ip -o -4 addr show to ${ip}/32 | awk 'NR==1 { sub(/@.*/, "", $2); dev=$2 } END { if(NR==1) print dev }')
${op.transient && ['state','owned'].includes(action) ? 'if [ -z "$dev" ]; then echo missing; exit 0; fi' : ''}
test -n "$dev" || { echo '找不到转发接口 ${ip}' >&2; exit 1; }
key="net/ipv4/conf/$dev/forwarding"`;
    const commands = {
      state:'case "$(sysctl -n "$key")" in 1) echo present;; 0) echo missing;; *) exit 1;; esac',
      add:'sysctl -qw "$key=1"', undo:'sysctl -qw "$key=0"',
    };
    return forwardingLease(platform,op,action,init,commands.state,commands.add,commands.undo);
  }
  if (op.kind === 'route') {
    const [cidr] = gatewayNetworks([op.cidr]), via = routingAddress(op.via);
    const source = routingAddress(op.source);
    if (!Number.isInteger(op.metric) || op.metric < 1 || op.metric > 65535) throw Error('部署路由跃点数无效。');
    if (windows) {
      const init = `$idx=(Get-NetIPAddress -AddressFamily IPv4 -IPAddress '${source}' -ErrorAction Stop).InterfaceIndex
$argsRoute=@{ InterfaceIndex=$idx; DestinationPrefix='${cidr}'; NextHop='${via}'; PolicyStore='ActiveStore' }`;
      return init + '\n' + ({
        state:`$r=@(Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore -DestinationPrefix '${cidr}' -ErrorAction SilentlyContinue)
if (!$r.Count) { 'missing' } elseif ($r.Count -eq 1 -and $r[0].NextHop -eq '${via}' -and $r[0].InterfaceIndex -eq $idx) { 'present' }
elseif ($r.Count -eq 1 -and $r[0].NextHop -eq '0.0.0.0') { 'local' } else { throw '已有不同的路由 ${cidr}' }`,
        owned:`if (Get-NetRoute @argsRoute -ErrorAction SilentlyContinue | Where-Object RouteMetric -eq ${op.metric}) { 'present' } else { 'missing' }`,
        add:`New-NetRoute @argsRoute -RouteMetric ${op.metric} -ErrorAction Stop | Out-Null`,
        undo:`Get-NetRoute @argsRoute | Where-Object RouteMetric -eq ${op.metric} | Remove-NetRoute -Confirm:$false -ErrorAction Stop`,
      })[action];
    }
    const init = `dev=$(ip -o -4 addr show to ${source}/32 | awk 'NR==1 {sub(/@.*/,"",$2); dev=$2} END {if(NR==1) print dev}')
test -n "$dev" || { echo '访问端的地址已变化' >&2; exit 1; }`;
    return init + '\n' + ({
      state:`r=$(ip -4 route show exact ${cidr})
case " $r " in "  ") echo missing;; *" via ${via} dev $dev "*) echo present;; *" scope link "*) echo local;; *) echo '已有不同的路由 ${cidr}' >&2; exit 1;; esac`,
      owned:`r=$(ip -4 route show exact ${cidr} via ${via} dev "$dev")
case " $r " in *" metric ${op.metric} "*) echo present;; *) echo missing;; esac`,
      add:`ip -4 route add ${cidr} via ${via} dev "$dev" metric ${op.metric}`, undo:`ip -4 route del ${cidr} via ${via} dev "$dev" metric ${op.metric}`,
    })[action];
  }
  return tunnelOperation(platform, op, action === 'owned' ? 'state' : action, config);
}

export async function directClient(host, addresses) {
  // Ask the client's kernel, including when the desktop is running on A.
  for (const address of addresses) {
    const ip = routingAddress(address);
    if (host.platform === 'win32') {
      const result = await host.run(`$r=@(Find-NetRoute -RemoteIPAddress '${ip}' -ErrorAction SilentlyContinue)
$hop=@($r | Where-Object { $_.PSObject.Properties['NextHop'] }); $src=@($r | Where-Object { $_.PSObject.Properties['IPAddress'] })
if ($hop.Count -eq 1 -and $src.Count -eq 1 -and $hop[0].NextHop -eq '0.0.0.0' -and $src[0].InterfaceIndex -eq $hop[0].InterfaceIndex) { $src[0].IPAddress }`);
      if (result && result !== ip) return { via:ip, source:routingAddress(result) };
    } else {
      const routes = JSON.parse(await host.run("ip -j -4 route get " + ip + " 2>/dev/null || echo '[]'"));
      const [r] = routes;
      if (routes.length === 1 && r.dev && !r.gateway && !r.via && (!r.type || r.type === 'unicast') && r.prefsrc !== ip)
        return { via:ip, source:routingAddress(r.prefsrc) };
    }
  }
}

// The live handshake proves that the selected client and A have exchanged keys.
export function tunnelAddress(config) {
  const range = block(config.match(/^Address = (.+)$/m)?.[1]);
  if (!range || range.end - range.start !== 7) throw Error('隧道地址段无效。');
  return { hub:ipv4(range.start + 1), network:range.cidr };
}
