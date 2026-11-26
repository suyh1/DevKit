// Native NetTCPIP integration on a disposable Windows CI runner; never run against a workstation.
import assert from 'node:assert/strict';
import { applyRouting, routingManagementSession } from '../server/relay-routing-apply.mjs';
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw new Error('Requires a GitHub-hosted Windows runner');
const host = await routingManagementSession(null);
const config = JSON.parse(await host.run(`
  $r=Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
  $addr=Get-NetIPAddress -InterfaceIndex $r.InterfaceIndex -AddressFamily IPv4 | Where-Object AddressState -eq 'Preferred' | Select-Object -First 1
  @{ local=$addr.IPAddress; gateway=$r.NextHop; idx=$r.InterfaceIndex } | ConvertTo-Json -Compress`));
const plan = { role:'B', name:'CI', ab:config.gateway, b:config.local, ac:'192.0.2.201', c:'192.0.2.205' };
const read = `@(Get-NetRoute -AddressFamily IPv4 -PolicyStore PersistentStore | Where-Object DestinationPrefix -eq '${plan.c}/32').Count`;
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
