import electron from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root, prepareDesktop } from './desktop-files.mjs';

const staging = process.argv.includes('--packaged') ? path.join(root, 'artifacts', 'desktop-runtime', `DevKit-${process.platform}-${process.arch}`, 'resources', 'app.asar') : (await prepareDesktop(process.platform, process.arch)).staging;
const environment = { ...process.env, DEVKIT_TEST_APP: staging, DEVKIT_TEST_OUTPUT: path.join(root, 'artifacts', 'electron-smoke') };
environment.DEVKIT_TEST_DESIGN_ONLY = process.argv.includes('--design-only') ? '1' : '';
environment.DEVKIT_TEST_GEOGRAPHY_ONLY = process.argv.includes('--geography-only') ? '1' : '';
environment.DEVKIT_TEST_NGINX_ONLY = process.argv.includes('--nginx-only') ? '1' : '';
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(root, 'electron', 'smoke.check.cjs')], { stdio: 'inherit', windowsHide: true, env: environment });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
