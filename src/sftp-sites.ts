import { lanRequest } from './lan-api';
import { remoteResponse } from './workspace-remote';

export type Entry = {
  name: string;
  path: string;
  kind: 'file' | 'directory' | 'other';
  size?: number;
  modified?: number;
};
export type Listing = { directory: string; parent: string; entries: Entry[] };
export type Side = 'local' | 'remote';
export type Site = {
  list(path: string): Promise<Listing>;
  mkdir(path: string, name: string, merge?: boolean): Promise<string>;
  rename(path: string, name: string, newName: string): Promise<unknown>;
  remove(path: string, name: string): Promise<unknown>;
};

export function serverSite(id: string, side: Side): Site {
  const prefix = side === 'local' ? 'local-' : 'file-';
  return {
    list: (path) => lanRequest(prefix + 'list', { id, path, complete: true }),
    mkdir: (path, name, merge) => lanRequest(prefix + 'mkdir', { id, path, name, merge }),
    rename: (path, name, newName) => lanRequest(prefix + 'rename', { id, path, name, newName }),
    remove: (path, name) => lanRequest(prefix + 'remove', { id, path, name }),
  };
}
export function validName(name: string) {
  if (!name || ['.', '..'].includes(name) || /[/\\\x00-\x1f]/.test(name))
    throw new Error('文件名不能包含路径分隔符或控制字符。');
  return name;
}
export function childPath(parent: string, name: string) {
  return parent.replace(/\/$/, '') + '/' + validName(name);
}

type Directory = FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> };
export type DirectoryPicker = (options: { mode: 'readwrite' }) => Promise<Directory>;
export const directoryPicker = () => (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

// Paths in this adapter always belong to the visitor. Only file data crosses the sharing API.
export class BrowserSite implements Site {
  private files = new Map<string, File>();
  private folders = new Set(['/']);
  constructor(readonly root?: Directory) {}
  add(files: File[]) {
    for (const file of files) {
      const parts = (file.webkitRelativePath || file.name).split('/');
      let parent = '/';
      for (const part of parts.slice(0, -1)) {
        parent = childPath(parent, part);
        this.folders.add(parent);
      }
      this.files.set(childPath(parent, parts.at(-1)!), file);
    }
  }
  async handle(path: string): Promise<Directory> {
    if (!this.root) throw new Error('请先选择可写本机目录。');
    let handle = this.root;
    for (const part of path.split('/').filter(Boolean))
      handle = (await handle.getDirectoryHandle(validName(part))) as Directory;
    return handle;
  }
  async list(path: string): Promise<Listing> {
    const directory = path === '.' ? '/' : path;
    if (!directory.startsWith('/')) throw new Error('请从 / 输入所选目录内的路径。');
    const parent = directory.replace(/\/[^/]+$/, '') || '/';
    const entries: Entry[] = [];
    if (this.root) {
      const dir = await this.handle(directory);
      for await (const item of dir.values()) {
        const file = item.kind === 'file' ? await (item as FileSystemFileHandle).getFile() : undefined;
        entries.push({
          name: item.name,
          path: childPath(directory, item.name),
          kind: item.kind,
          size: file?.size,
          modified: file?.lastModified,
        });
      }
    } else {
      if (!this.folders.has(directory)) throw new Error('目录不在浏览器选区内。');
      const prefix = directory === '/' ? '/' : directory + '/';
      for (const full of [...this.folders, ...this.files.keys()]) {
        const name = full.slice(prefix.length);
        if (!full.startsWith(prefix) || !name || name.includes('/')) continue;
        const file = this.files.get(full);
        entries.push({
          name,
          path: full,
          kind: file ? 'file' : 'directory',
          size: file?.size,
          modified: file?.lastModified,
        });
      }
    }
    return { directory, parent, entries };
  }
  async file(parent: string, name: string) {
    if (this.root) return (await (await this.handle(parent)).getFileHandle(validName(name))).getFile();
    const file = this.files.get(childPath(parent, name));
    if (!file) throw new Error('所选文件已不可用。');
    return file;
  }
  async mkdir(parent: string, name: string, merge = false) {
    const dir = await this.handle(parent);
    if (!merge && (await this.exists(dir, name))) throw new Error('目标已有同名文件。');
    await dir.getDirectoryHandle(validName(name), { create: true });
    return childPath(parent, name);
  }
  async exists(dir: Directory, name: string) {
    try {
      await dir.getFileHandle(validName(name));
      return true;
    } catch (error) {
      if ((error as Error).name === 'TypeMismatchError') return true;
      if ((error as Error).name === 'NotFoundError') return false;
      throw error;
    }
  }
  async rename(parent: string, name: string, newName: string) {
    const dir = await this.handle(parent);
    if (await this.exists(dir, newName)) throw new Error('目标已有同名文件。');
    const handle = (await dir.getFileHandle(name).catch((error) => {
      if (error.name !== 'TypeMismatchError') throw error;
      return dir.getDirectoryHandle(name);
    })) as FileSystemHandle & { move?(name: string): Promise<void> };
    if (!handle.move) throw new Error('当前浏览器未提供本机重命名，请在系统文件管理器中操作。');
    await handle.move(validName(newName));
  }
  async remove(parent: string, name: string) {
    await (await this.handle(parent)).removeEntry(validName(name), { recursive: true });
  }
}

export async function webUpload(
  id: string,
  path: string,
  name: string,
  file: File,
  transferId: string,
  overwrite: boolean,
  signal: AbortSignal,
) {
  if (file.size > 128 * 1024 * 1024) throw new Error('网页单个文件最多 128 MiB。');
  const query = new URLSearchParams({ id, path, name, transferId, overwrite: String(overwrite) });
  await remoteResponse('/api/lan-hosts/file-upload?' + query, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
    signal,
  });
}
export async function webDownload(
  id: string,
  path: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
  sink?: FileSystemWritableFileStream,
) {
  const response = await remoteResponse('/api/lan-hosts/file-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, path }),
    signal,
  });
  if (!response.body) throw new Error('下载通道不可用。');
  let bytes = 0;
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        progress(bytes);
        controller.enqueue(chunk);
      },
    }),
  );
  if (sink) {
    await stream.pipeTo(sink, { signal });
    return;
  }
  return new Response(stream).blob();
}
