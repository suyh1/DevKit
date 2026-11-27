import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { discoverGateway } from './relay-gateway.mjs';
import { gatewayFiles } from './relay-gateway-config.mjs';
import { directRoutePlan } from './relay-gateway-routes.mjs';

const a = '10.0.0.10';
const links = [{ address:a, network:'10.0.0.0/8', device:'lan' },
  { address:'192.0.2.10', network:'192.0.2.0/24', device:'vpn' }];
const subnet = '10.40.0.0/16';
const direct = gatewayFiles({ a, links, mode:'direct', networks:['10.0.0.0/8','198.51.100.0/24'], routes:[
  { network:subnet, device:'vpn', gateway:'192.0.2.1', metric:2 },
  { network:subnet, device:'vpn', gateway:'192.0.2.2', metric:2 },
  { network:subnet, device:'lan', gateway:'10.0.0.5', metric:20 },
] });
const tunnel = gatewayFiles({ a:'192.0.2.10', links:[links[1]], mode:'tunnel', networks:['198.51.100.0/24'] });
const sh = process.env.DEVKIT_TEST_SH || (process.platform === 'win32' ? undefined : 'sh');
function shell(script) {
  const r = spawnSync(sh, ['-s'], { input:script, encoding:'utf8', windowsHide:true });
  if (r.error) throw r.error;
  return r;
}
function powershell(script) {
  const encoded = Buffer.from(script,'utf16le').toString('base64');
  const r = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{ encoding:'utf8', windowsHide:true });
  assert.equal(r.status,0,r.error?.message || r.stderr);
  return r.stdout.trim();
}

test('the selected aggregate never sends a protected child prefix back through A', () => {
  const plan = directRoutePlan(['198.51.100.0/24'],links,[
    { network:'0.0.0.0/0', device:'lan',gateway:'10.0.0.1' },
    { network:'198.51.100.64/26', device:'vpn',gateway:'192.0.2.1' },
  ]);
  assert.deepEqual(plan(links[0]),['198.51.100.0/26 10.0.0.1','198.51.100.64/26 192.0.2.1','198.51.100.128/25 10.0.0.1']);
});

test('Windows discovery preserves route preference and excludes active WireGuard, local host and broadcast routes', { skip:process.platform !== 'win32' }, async () => {
  const host = { platform:'win32',close() {},async run(script) {
    return powershell(`$ErrorActionPreference='Stop'
function Get-NetIPInterface {
  [pscustomobject]@{InterfaceIndex=2;ConnectionState='Connected';InterfaceAlias='LAN';InterfaceMetric=5}
  [pscustomobject]@{InterfaceIndex=7;ConnectionState='Connected';InterfaceAlias='devkit-a';InterfaceMetric=10}
}
function Get-NetIPAddress {
  [pscustomobject]@{InterfaceIndex=2;InterfaceAlias='LAN';AddressState='Preferred';IPAddress='10.0.0.10';PrefixLength=8}
  [pscustomobject]@{InterfaceIndex=7;InterfaceAlias='devkit-a';AddressState='Preferred';IPAddress='192.168.77.9';PrefixLength=29}
}
function Get-NetRoute {
  foreach ($prefix in '10.0.0.0/8','10.0.0.10/32','10.255.255.255/32') {
    [pscustomobject]@{InterfaceIndex=2;Protocol='Local';NextHop='0.0.0.0';DestinationPrefix=$prefix;RouteMetric=256}
  }
  [pscustomobject]@{InterfaceIndex=2;Protocol='NetMgmt';NextHop='10.0.0.1';DestinationPrefix='10.40.0.0/16';RouteMetric=2}
  [pscustomobject]@{InterfaceIndex=7;Protocol='NetMgmt';NextHop='0.0.0.0';DestinationPrefix='192.168.77.10/32';RouteMetric=0}
}
${script}`);
  } };
  const plan = await discoverGateway({ a },null,{ desktopAdmin:true },{ lan:[{ address:a }] },async () => host);
  assert.deepEqual(plan.links,[{ address:a,network:'10.0.0.0/8',device:'2' }]);
  assert.deepEqual(plan.networks,['10.0.0.0/8',subnet]);
  assert.deepEqual(plan.routes,[{ network:'10.0.0.0/8',device:'2',metric:261 },{ network:subnet,device:'2',gateway:'10.0.0.1',metric:7 }]);
  assert.equal(plan.previousTunnel,'192.168.77.8/29');
});

test('a running hub tunnel is excluded from discovery and its subnet can be reused unless a physical LAN now needs it', async () => {
  const addr = (ifname,local,prefixlen) => ({ ifname, addr_info:[{ family:'inet',scope:'global',local,prefixlen }] });
  const host = { platform:'linux', close() {}, async run(cmd) {
    return JSON.stringify(cmd.includes('address show')
      ? [addr('lan',a,24),addr('devkit-a','10.77.0.25',29)]
      : [{ dst:'10.77.0.24/29',dev:'devkit-a' },{ dst:'10.77.0.26',dev:'devkit-a' },
        { dst:'198.51.100.0/24',nexthops:[{ dev:'devkit-a' },{ dev:'lan',gateway:'10.0.0.1' }] }]);
  } };
  const snapshot = await discoverGateway({ a },null,{ desktopAdmin:true },{ lan:[{ address:a }] },async () => host);
  assert.deepEqual(snapshot.networks,['10.0.0.0/24','198.51.100.0/24']);
  assert.deepEqual(snapshot.links,[{ address:a,network:'10.0.0.0/24',device:'lan' }]);
  assert.deepEqual(snapshot.routes,[{ network:'198.51.100.0/24',device:'lan',gateway:'10.0.0.1',metric:0 }]);
  assert.equal(snapshot.previousTunnel,'10.77.0.24/29');
  const files = gatewayFiles({ ...snapshot,mode:'tunnel' });
  assert.match(files['A/devkit-a.conf'],/^Address = 10\.77\.0\.25\/29$/m);
  assert.doesNotMatch(gatewayFiles({ ...snapshot,mode:'direct' })['A/forward.sh'],/10\.77\./);
  const moved = gatewayFiles({ ...snapshot,mode:'tunnel',discovered:[...snapshot.networks,'10.77.0.0/24'] });
  assert.doesNotMatch(moved['A/devkit-a.conf'],/Address = 10\.77\.0\.25\//);
});

test('Linux installs a more-specific exit for ordinary clients and keeps every equal-cost next hop on its own path', { skip:!sh }, () => {
  for (const [address, shouldInstall] of [['10.0.0.5',true],['192.0.2.1',false],['192.0.2.2',false]]) {
    const r = shell(`ip() {
  case "$*" in
    '-4 route get '*) echo '10.0.0.10 dev lan';;
    '-o -4 address show') echo '2: lan inet 10.0.0.9/8'; echo '3: other inet ${address}/32';;
    '-4 route show exact '*) ;;
    '-4 route add '*) echo "$4";;
    *) exit 2;;
  esac
}
${direct['via-' + a + '/routes.sh']}`);
    assert.equal(r.status,0,r.stderr);
    assert.deepEqual(r.stdout.trim().split(/\s+/).sort(),shouldInstall ? [subnet,'198.51.100.0/24'] : ['198.51.100.0/24']);
  }
});

test('PowerShell preserves the downstream gateway and installs the nested VPN prefix on other LAN clients', { skip:process.platform !== 'win32' }, () => {
  for (const [address,shouldInstall] of [['10.0.0.5',true],['192.0.2.2',false]]) {
    const result = powershell(`
function Find-NetRoute { [pscustomobject]@{ NextHop='0.0.0.0'; InterfaceIndex=2 } }
function Get-NetIPAddress { param($IPAddress,$AddressFamily,$ErrorAction) if (!$IPAddress) {
  [pscustomobject]@{ IPAddress='10.0.0.9' }; [pscustomobject]@{ IPAddress='${address}' }
} }
function Get-NetRoute {}
$installed = [Collections.Generic.List[string]]::new()
function New-NetRoute { param($DestinationPrefix) $installed.Add($DestinationPrefix) }
function Remove-NetRoute { throw 'unexpected route deletion' }
& { ${direct['via-' + a + '/routes.ps1']} }
ConvertTo-Json -InputObject $installed.ToArray() -Compress`);
    assert.deepEqual(JSON.parse(result).sort(),shouldInstall ? [subnet,'198.51.100.0/24'] : ['198.51.100.0/24']);
  }
});

test('Linux forwarding preflights the tunnel and NAT, then rolls back only changed interfaces on a write failure', { skip:!sh }, () => {
  for (const scenario of ['missing-tunnel','nat-unavailable','nat-add-fails','existing-nat']) {
    const r = shell(`ip() {
  case "$*" in
    *192.0.2.10/32) echo '1: wan inet 192.0.2.10/24';;
    *10.77.0.1/32) if [ '${scenario}' != missing-tunnel ]; then echo '2: devkit-a inet 10.77.0.1/29'; fi;;
    *) return 2;;
  esac
}
sysctl() {
  case "$1:$2" in -n:*/wan/forwarding) echo 1;; -n:*/devkit-a/forwarding) echo 0;; -qw:*) echo "$2";; *) return 2;; esac
}
iptables() {
  case "$4" in
    -S) [ '${scenario}' != nat-unavailable ];;
    -C) [ '${scenario}' = existing-nat ];;
    -A) echo 'add-nat'; return 2;;
    *) return 2;;
  esac
}
${tunnel['A/forward.sh']}`);
    const writes = r.stdout.trim() ? r.stdout.trim().split(/\r?\n/) : [];
    const enabled = 'net/ipv4/conf/devkit-a/forwarding=1';
    assert.equal(r.status === 0,scenario === 'existing-nat',r.stderr);
    assert.deepEqual(writes,scenario === 'nat-add-fails' ? [enabled,'add-nat',enabled.replace('=1','=0')] :
      scenario === 'existing-nat' ? [enabled] : []);
  }
});

test('Windows forwarding leaves both stores untouched on preflight failure and restores their distinct values on NAT failure', { skip:process.platform !== 'win32' }, () => {
  for (const scenario of ['missing-tunnel','conflicting-nat','nat-add-fails','existing-nat']) {
    const result = powershell(`
$live = @{ 2='Enabled'; 3='Disabled' }
$disk = @{ 2='Disabled'; 3='Enabled' }
$writes = [Collections.Generic.List[int]]::new()
function Get-NetIPAddress { param($AddressFamily,$IPAddress,$ErrorAction)
  if ($IPAddress -eq '192.0.2.10') { [pscustomobject]@{ InterfaceIndex=[uint32]2;InterfaceAlias='wan' } }
  elseif ('${scenario}' -ne 'missing-tunnel') { [pscustomobject]@{ InterfaceIndex=[uint32]3;InterfaceAlias='devkit-a' } }
}
function Get-NetIPInterface { param($AddressFamily,$InterfaceIndex,$PolicyStore)
  if ($PolicyStore -eq 'ActiveStore') { [pscustomobject]@{Forwarding=$live[$InterfaceIndex]} }
  else { foreach ($i in $disk.Keys) { [pscustomobject]@{InterfaceIndex=$i;AddressFamily='IPv4';Forwarding=$disk[$i]} } }
}
function Set-NetIPInterface { param($AddressFamily,$InterfaceIndex,$PolicyStore,$Forwarding)
  $writes.Add($InterfaceIndex); $live[$InterfaceIndex]=$Forwarding
  if (!$PolicyStore) { $disk[$InterfaceIndex]=$Forwarding }
}
function Get-NetNat {
  if ('${scenario}' -eq 'conflicting-nat') { [pscustomobject]@{InternalIPInterfaceAddressPrefix='10.33.0.0/24'} }
  elseif ('${scenario}' -eq 'existing-nat') { [pscustomobject]@{InternalIPInterfaceAddressPrefix='10.77.0.0/29'} }
}
function New-NetNat { throw 'fixture NAT write failed' }
$failed=$false
try { & { ${tunnel['A/forward.ps1']} } } catch { $failed=$true }
@{failed=$failed;writes=$writes.Count;states=@($live[2],$disk[2],$live[3],$disk[3])} | ConvertTo-Json -Compress`);
    const { failed,writes,states } = JSON.parse(result);
    assert.equal(failed,scenario !== 'existing-nat');
    assert.deepEqual(states,scenario === 'existing-nat' ? Array(4).fill('Enabled') : ['Enabled','Disabled','Disabled','Enabled']);
    if (scenario === 'nat-add-fails') assert.ok(writes > 2);
    else assert.equal(writes,scenario === 'existing-nat' ? 2 : 0);
  }
});
