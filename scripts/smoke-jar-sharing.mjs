import electron from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { root } from './desktop-files.mjs';
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [path.join(root, 'electron/jar-sharing-smoke.cjs')], { stdio: 'inherit', windowsHide: true, env });
child.on('error', error => { console.error(error); process.exitCode = 1; }); child.on('exit', code => { process.exitCode = code ?? 1; });
