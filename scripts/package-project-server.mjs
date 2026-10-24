import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { root } from './desktop-files.mjs';
const python = process.env.DEVKIT_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
execFileSync(python, [path.join(root, 'scripts/package-project-server.py')], { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, DEVKIT_NODE: process.execPath } });
