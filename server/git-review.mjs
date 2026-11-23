import path from 'node:path';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { git, patches, fail } from './git-command.mjs';
import { atomicFile } from './atomic-file.mjs';

const digest = (input) => createHash('sha256').update(input).digest('hex');
const textLimit = 384 * 1024;
async function targetInfo(root, file) {
  const target = path.resolve(root, file);
  const relative = path.relative(root, await realpath(path.dirname(target)));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
    fail(409, '文件位置已变化。');
  const info = await lstat(target).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
    return null;
  });
  return { target, info };
}

async function patchBytes(root, file, staged) {
  if (file.conflict) fail(409, '请在冲突编辑器中解决此文件。');
  const untracked = !staged && file.work === '?';
  if (untracked) {
    const { info } = await targetInfo(root, file.path);
    if (!info?.isFile() && !info?.isSymbolicLink()) fail(409, '嵌套仓库或特殊文件，请在主机处理。');
  }
  return git(
    root,
    [
      'diff',
      ...patches,
      '--binary',
      '--full-index',
      '--no-relative',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--unified=3',
      ...(untracked
        ? ['--no-index', '--', '/dev/null', file.path]
        : [...(staged ? ['--cached'] : []), '--', file.path]),
    ],
    { bytes: true, difference: untracked, limit: 48 * 1024 * 1024 },
  );
}

function splitPatch(bytes) {
  // latin1 is a lossless byte-to-character mapping, including non-UTF-8 files.
  const source = bytes.toString('latin1'),
    offsets = [...source.matchAll(/^@@ [-+0-9, ]+ @@/gm)].map((m) => m.index);
  const header = source.slice(0, offsets[0] ?? source.length);
  const chunks = offsets.map((start, i) => source.slice(start, offsets[i + 1]));
  return { header, chunks };
}
export async function reviewFile(root, file, staged) {
  const raw = await patchBytes(root, file, staged);
  const { header, chunks } = splitPatch(raw);
  const binary = header.includes('\nGIT binary patch\n');
  const text = binary ? '二进制文件内容发生变化。' : raw.subarray(0, textLimit).toString('utf8');
  const truncated = !binary && raw.length > textLimit;
  const selectable = !truncated && !binary && !/^(old mode|new mode|deleted file mode|new file mode) /m.test(header);
  return {
    text: text + (truncated ? '\n… 差异较大，仅显示前段。' : ''),
    token: digest(raw),
    truncated,
    hunks: selectable
      ? chunks.map((chunk, i) => ({
          index: i,
          header: Buffer.from(chunk.split('\n', 1)[0], 'latin1').toString('utf8'),
        }))
      : [],
  };
}
export async function applyReview(root, file, staged, value, authorize) {
  const raw = await patchBytes(root, file, staged);
  if (!raw.length || value.token !== digest(raw)) fail(409, '文件内容已改变，请核对刷新后的差异，再次操作。');
  let input = raw;
  if (value.hunk !== undefined) {
    const { header, chunks } = splitPatch(raw);
    if (
      !Number.isInteger(value.hunk) ||
      !chunks[value.hunk] ||
      raw.length > textLimit ||
      /^(old mode|new mode|deleted file mode|new file mode) /m.test(header)
    )
      fail(400, '请选择预览中的差异块。');
    input = Buffer.from(header + chunks[value.hunk], 'latin1');
  }
  authorize();
  // Apply exactly these reviewed bytes to the index. Never re-read the worktree via git add.
  return git(root, ['apply', '--cached', '--whitespace=nowarn', ...(staged ? ['--reverse'] : []), '-'], { input });
}

export async function conflictView(root, file) {
  if (!file.conflict) fail(409, '冲突状态已经改变。');
  const stages = await git(root, ['ls-files', '--unmerged', '-z', '--', file.path]);
  const entries = stages
    .split('\0')
    .filter(Boolean)
    .map((line) => line.split('\t', 1)[0].split(' '));
  async function side(stage) {
    const entry = entries.find((e) => e[2] === stage);
    if (!entry) return { exists: false, text: null };
    const [mode, oid] = entry;
    if (mode.startsWith('100') && Number(await git(root, ['cat-file', '-s', oid])) <= textLimit) {
      const bytes = await git(root, ['cat-file', 'blob', oid], { bytes: true });
      if (!bytes.includes(0) && Buffer.from(bytes.toString('utf8')).equals(bytes))
        return { exists: true, text: bytes.toString('utf8') };
    }
    return { exists: true, text: null };
  }
  const { target, info } = await targetInfo(root, file.path);
  let merged = null;
  if (info?.isFile() && info.size <= textLimit) {
    const raw = await readFile(target);
    if (!raw.includes(0) && Buffer.from(raw.toString('utf8')).equals(raw)) merged = raw.toString('utf8');
  }
  const [ours, theirs] = await Promise.all([side('2'), side('3')]);
  return { ours, theirs, merged, token: digest(JSON.stringify([stages, merged, info?.mtimeMs, info?.size])) };
}
export async function resolveConflict(root, file, value, authorize) {
  const preview = await conflictView(root, file);
  if (preview.token !== value.token) fail(409, '冲突内容已更新，请重新核对。');
  authorize();
  if (value.side === 'manual') {
    if (
      preview.merged === null ||
      typeof value.text !== 'string' ||
      value.text.includes('\0') ||
      Buffer.byteLength(value.text) > textLimit
    )
      fail(400, '仅支持编辑 384 KiB 以内的 UTF-8 文本。');
    const { target, info } = await targetInfo(root, file.path);
    if (!info?.isFile()) fail(409, '文件类型已经变化。');
    await atomicFile(target, Buffer.from(value.text), info.mode, { beforeReplace: authorize });
  } else {
    if (!['ours', 'theirs'].includes(value.side)) fail(400, '请选择冲突解决方式。');
    if (!preview[value.side].exists) return git(root, ['rm', '--', file.path]);
    await git(root, ['checkout', '--' + value.side, '--', file.path]);
  }
  authorize();
  await git(root, ['add', '--', file.path]);
}
