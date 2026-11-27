// Native NetTCPIP integration on a disposable Windows CI runner; never run against a workstation.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { block, discoverGateway, overlaps } from '../server/relay-gateway.mjs';
import { gatewayFiles } from '../server/relay-gateway-config.mjs';
import { discoverRouting } from '../server/relay-routing-discovery.mjs';
import { applyRouting, routingManagementSession } from '../server/relay-routing-apply.mjs';
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw new Error('Requires a GitHub-hosted Windows runner');
const host = await routingManagementSession(null);
const config = JSON.parse(await host.run(`
  $r=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
  $addr=Get-NetIPAddress -InterfaceIndex $r.InterfaceIndex -AddressFamily IPv4 | Where-Object AddressState -eq 'Preferred' | Select-Object -First 1
  @{ local=$addr.IPAddress; gateway=$r.NextHop; idx=$r.InterfaceIndex } | ConvertTo-Json -Compress`));
const found = await discoverRouting({ a:config.local, b:config.gateway, c:'192.0.2.205' });
const inventory = await discoverGateway({ a:config.local },null,{ desktopAdmin:true });
const localLink = inventory.links.find(link => link.address === config.local);
assert.ok(localLink && inventory.networks.includes(localLink.network));
const site = '198.51.100.0/28';
const files = gatewayFiles({ a:config.gateway, links:[{ address:config.gateway, network:localLink.network }], networks:[localLink.network,site], mode:'direct' });
const script = files['via-' + config.gateway + '/routes.ps1'];
const routeCheck = `@(Get-NetRoute -PolicyStore PersistentStore | Where-Object DestinationPrefix -eq '${site}').Count`;
assert.equal(await host.run(routeCheck),'0');
try {
  await host.run(script);
  assert.equal(await host.run(routeCheck),'1');
  await host.run(script);
} finally {
  await host.run(`Get-NetRoute -DestinationPrefix '${site}' -NextHop '${config.gateway}' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false`);
}
const tunnel = gatewayFiles({ ...inventory, mode:'tunnel', discovered:inventory.networks, networks:[localLink.network,site] });
const folder = await mkdtemp(path.join(tmpdir(),'devkit-gateway-'));
try {
  await writeFile(path.join(folder,'devkit-b.conf'), tunnel['B/devkit-b.conf']);
  const prepare = path.join(folder,'prepare.ps1');
  await writeFile(prepare, '\uFEFF' + tunnel['B/prepare.ps1']);
  await host.run(`& '${prepare.replaceAll("'","''")}'`);
  const profile = await readFile(path.join(folder,'ready','devkit-b.conf'),'utf8');
  const routes = profile.match(/^AllowedIPs = (.+)$/m)[1].split(', ').map(block);
  assert.ok(routes.some(r => overlaps(r,block('198.51.100.9/32'))));
  assert.ok(!routes.some(r => overlaps(r,block(localLink.network))));
} finally { await rm(folder,{ recursive:true,force:true }); }
assert.equal(found.role,'A');
assert.equal(found.ab?.ip,config.local, JSON.stringify(found));
assert.ok(found.ac?.reason, JSON.stringify(found));
const plan = { role:'B', name:'CI', ab:config.gateway, b:config.local, ac:'192.0.2.201', c:'192.0.2.205' };
const read = `@(Get-NetRoute -PolicyStore PersistentStore | Where-Object DestinationPrefix -eq '${plan.c}/32').Count`;
assert.equal(await host.run(read),'0');
const profiles = { A:'a'.repeat(36), C:'c'.repeat(36) };
const connect = async (_lan, id) => id ? { platform:'win32', close() {}, run:async () => 'present' }
  : { ...host, run:script => script.includes('NetworkInformation.Ping') ? Promise.resolve('') : host.run(script) };
try {
  assert.match(await applyRouting(plan, profiles, null, connect), /已应用/);
  assert.equal(await host.run(read),'1');
  assert.match(await applyRouting(plan, profiles, null, connect), /已就绪/);
} finally {
  await host.run(`Get-NetRoute -DestinationPrefix '${plan.c}/32' -InterfaceIndex ${config.idx} -NextHop '${config.gateway}' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false`);
  host.close();
}
