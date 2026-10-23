import electron from 'electron';
import { spawn } from 'node:child_process';
import { root, prepareDesktop } from './desktop-files.mjs';

const { staging } = await prepareDesktop(process.platform, process.arch);
const environment = { ...process.env, DEVKIT_DEV_ROOT: root };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [staging], { stdio: 'inherit', windowsHide: true, env: environment });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
