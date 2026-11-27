// Runs on A inside the existing isolated relay network fixture.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { discoverGateway } from '../server/relay-gateway.mjs';
import { gatewayFiles } from '../server/relay-gateway-config.mjs';

const plan = await discoverGateway({ a:'192.0.2.1' }, null, { desktopAdmin:true });
for (const network of ['198.51.100.0/24','203.0.113.0/24']) assert.ok(plan.networks.includes(network));
const selected = process.argv[3];
if (selected) {
  assert.ok(plan.networks.includes(selected));
  assert.equal(plan.previousTunnel,'10.77.0.0/29');
  assert.ok(!plan.links.some(link => link.device === 'devkit-a'));
  assert.ok(!plan.networks.includes(plan.previousTunnel));
}
for (const mode of ['direct','tunnel']) {
  const files = gatewayFiles({ ...plan, mode, discovered:plan.networks, networks:selected ? [selected] : plan.networks });
  for (const [file, contents] of Object.entries(files)) {
    const target = path.join(process.argv[2], mode, file);
    await mkdir(path.dirname(target), { recursive:true, mode:0o700 });
    await writeFile(target, contents, { mode:0o600 });
  }
}
