import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import { createGitWorkspace } from './git-workspace.mjs';
import { acquireProjectLock } from './project-lock.mjs';

const [action, location] = process.argv.slice(2);
if (!['publish', 'unpublish', 'list'].includes(action) || (action !== 'list' && !location)) {
  console.error('用法：node server/git-register.mjs list | publish <工作树根目录> | unpublish <工作树根目录>');
  process.exitCode = 2;
} else {
  const root = path.resolve(process.env.DEVKIT_PROJECT_DATA || fileURLToPath(new URL('../configs', import.meta.url)));
  const release = await acquireProjectLock(root);
  try {
    const manager = await createGitWorkspace(root);
    let repositories = await manager.request('list');
    if (action !== 'list') {
      const directory = await realpath(path.resolve(location));
      let repo = repositories.find((r) => path.relative(r.root, directory) === '');
      if (!repo && action === 'publish') repo = (await manager.request('register', { root: directory })).at(-1);
      if (!repo) throw new Error('找不到登记，请指定工作树根目录。');
      repositories = await manager.request('publish', { id: repo.id, published: action === 'publish' });
    }
    for (const r of repositories) console.log(r.published ? '已发布' : '仅主机', r.root);
  } finally {
    await release();
  }
}
