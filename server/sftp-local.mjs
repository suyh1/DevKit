import path from 'node:path';
import { homedir } from 'node:os';
import { lstat, readdir, mkdir, rename, rm, realpath } from 'node:fs/promises';

export function childName(name, windows = false) {
  if (
    typeof name !== 'string' ||
    !name ||
    name === '.' ||
    name === '..' ||
    /[/\\\x00-\x1f]/.test(name) ||
    (windows && (/[<>:"|?*]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)))
  )
    throw new Error('文件名无效。');
  return name;
}
export function localChild(directory, name) {
  if (!path.isAbsolute(directory)) throw new Error('本机目录须为绝对路径。');
  return path.join(directory, childName(name, process.platform === 'win32'));
}
export const conflict = () => Object.assign(new Error('目标已有同名文件。'), { status: 409 });
export async function localFiles(action, value) {
  const directory = value.path === '.' ? homedir() : value.path;
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new Error('本机目录须为绝对路径。');
  const parent = await realpath(directory);
  if (action === 'local-list') {
    const names = await readdir(parent, { withFileTypes: true });
    const entries = [];
    // Bound simultaneous metadata reads for very large directories.
    for (let i = 0; i < names.length; i += 64) {
      entries.push(
        ...(await Promise.all(
          names.slice(i, i + 64).map(async (item) => {
            const file = path.join(parent, item.name);
            const info = await lstat(file).catch(() => null);
            return {
              name: item.name,
              path: file,
              kind: info?.isDirectory() ? 'directory' : info?.isFile() ? 'file' : 'other',
              size: info?.size,
              modified: info?.mtimeMs,
            };
          }),
        )),
      );
    }
    return { directory: parent, parent: path.dirname(parent), entries };
  }
  const target = localChild(parent, value.name);
  if (action === 'local-mkdir') {
    try {
      await mkdir(target);
    } catch (error) {
      if (error.code !== 'EEXIST' || !value.merge || !(await lstat(target)).isDirectory()) throw error;
    }
    return target;
  }
  if (action === 'local-rename') {
    const destination = localChild(parent, value.newName);
    if (
      await lstat(destination).then(
        () => true,
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return false;
        },
      )
    )
      throw conflict();
    await rename(target, destination);
  } else if (action === 'local-remove') await rm(target, { recursive: true });
  else throw new Error('未知本机文件操作。');
}
