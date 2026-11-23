import path from 'node:path';
import { lstat, mkdir, readdir, rename } from 'node:fs/promises';

const groups = {
  projects: ['projects.json', '.projects-pending.json', 'projects.v1.backup.json', 'migration.json'],
  sharing: ['sharing.json', 'sharing-audit.jsonl', 'sharing-audit.jsonl.previous', 'transfer-links.json', 'file-shares.json'],
  planning: ['knowledge.json', 'todo-lists.json', 'project-todos.json'],
};

export async function configGroup(root, name) {
  const directory = path.join(root, name);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) throw new Error('配置分组必须是目录：' + directory);
  return directory;
}

// Called with the root project lock held. Each rename is atomic on this volume.
// Preflight the entire batch so a conflict never silently selects an older copy.
export async function organizeConfigs(root) {
  const moves = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const group = /^profile-(?:[a-f0-9]{2}){1,80}\.json$/.test(entry.name) ? 'projects'
      : Object.keys(groups).find(key => groups[key].includes(entry.name));
    if (!group) continue;
    if (!entry.isFile()) throw new Error('旧配置必须是普通文件：' + entry.name);
    const target = path.join(await configGroup(root, group), entry.name);
    const existing = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (existing) throw new Error('新旧配置同名，请核对并保留所需版本：' + target);
    moves.push([path.join(root, entry.name), target]);
  }
  for (const [source, target] of moves) await rename(source, target);
}
