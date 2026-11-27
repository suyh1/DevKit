// Runs on A inside the existing isolated relay network fixture.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { discoverGateway } from '../server/relay-gateway.mjs';
import { gatewayFiles } from '../server/relay-gateway-config.mjs';

const plan = await discoverGateway({ a:'192.0.2.1' }, null, { desktopAdmin:true });
for (const network of ['198.51.100.0/24','203.0.113.0/24']) assert.ok(plan.networks.includes(network));
for (const mode of ['direct','tunnel']) {
  for (const [file, contents] of Object.entries(gatewayFiles({ ...plan, mode }))) {
    const target = path.join(process.argv[2], mode, file);
    await mkdir(path.dirname(target), { recursive:true, mode:0o700 });
    await writeFile(target, contents, { mode:0o600 });
  }
}
