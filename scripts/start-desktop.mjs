import electron from 'electron';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { root, prepareDesktop } from './desktop-files.mjs';

const environment = { ...process.env, DEVKIT_DEV_ROOT: root };
delete environment.ELECTRON_RUN_AS_NODE;
const preview = process.argv.includes('--preview');

let previewStage;
try {
  if (preview) {
    const artifacts = path.join(await realpath(root), 'artifacts');
    await mkdir(artifacts, { recursive: true });
    if (await realpath(artifacts) !== artifacts) throw new Error('Unsafe preview directory');
    environment.DEVKIT_PREVIEW_PROFILE = path.join(artifacts, 'desktop-preview-profile');
    await mkdir(environment.DEVKIT_PREVIEW_PROFILE, { recursive: true });
    previewStage = await mkdtemp(path.join(artifacts, 'desktop-preview-'));
  }
  const { staging } = await prepareDesktop(process.platform, process.arch, previewStage);
  const child = spawn(electron, [staging], { stdio: 'inherit', windowsHide: !preview, env: environment });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} finally {
  if (previewStage) {
    if (await realpath(previewStage) !== previewStage) throw new Error('Unsafe preview staging directory');
    await rm(previewStage, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
  }
}
