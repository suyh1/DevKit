import { opendir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const actions = {
  jar: {
    read: ['get', 'statuses', 'log-tail', 'console-read', 'startup-get'],
    edit: ['browse', 'upsert', 'remove', 'config-list', 'config-read', 'config-save', 'config-backup'],
    control: ['command', 'detect', 'health-check', 'console-claim', 'console-input', 'console-eof', 'console-release', 'startup-install', 'startup-remove'],
  },
  nginx: {
    read: ['get', 'statuses', 'documents', 'inspect', 'log-tail', 'review', 'backups', 'backup-files'],
    edit: ['browse', 'save-files', 'create', 'upsert', 'remove', 'discover'],
    control: ['command', 'detect'],
  },
};
export const fullAccess = { edit: true, control: true };
export function authorizeWorkspace(module, action, access) {
  const rules = Object.hasOwn(actions, module) && actions[module];
  if (rules?.read?.includes(action) || rules?.edit?.includes(action) && access.edit || rules?.control?.includes(action) && access.control) return;
  const message = rules?.edit?.includes(action) ? '未授予编辑权限。' : rules?.control?.includes(action) ? '未授予运行管理权限。' : '网页不提供本机文件选择器，请填写共享主机路径。';
  throw Object.assign(new Error(message), { status: 403 });
}

async function browse({ directory = '', kind }) {
  if (!['jar', 'file', 'directory'].includes(kind) || typeof directory !== 'string' || directory.length > 12000 || directory && !path.isAbsolute(directory)) throw new Error('请输入目标主机的绝对目录。');
  const current = await realpath(directory || homedir());
  const entries = [];
  let scanned = 0;
  for await (const entry of await opendir(current)) {
    if (++scanned > 2000 || entries.length >= 400) break;
    if (/^\.devkit(?:-ssh)?$/.test(entry.name)) continue;
    const filename = path.join(current, entry.name);
    const info = entry.isSymbolicLink() ? await stat(filename).catch(() => null) : entry;
    const folder = info?.isDirectory();
    if (folder || (kind !== 'directory' && info?.isFile() && (kind !== 'jar' || /\.jar$/i.test(entry.name)))) {
      entries.push({ name: entry.name, path: filename, directory: !!folder });
    }
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  const parent = path.dirname(current);
  return { directory: current, parent: parent === current ? '' : parent, entries, truncated: scanned > 2000 || entries.length >= 400 };
}

export async function managedRequest(manager, module, action, payload, access = fullAccess, session) {
  authorizeWorkspace(module, action, access);
  if (action === 'browse') return browse(payload);
  return manager.request(action, payload, { session, allowEdit: access.edit, allowControl: access.control, allowExecution: access.control });
}
