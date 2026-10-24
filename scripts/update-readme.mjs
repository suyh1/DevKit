import { copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { root } from './desktop-files.mjs';
import { releaseTargets } from './release-integrity.mjs';

// Load the same registry as the UI, including definitions spread from other modules.
// No HTTP listener, dependency scan, tool execution or network service is started.
export async function readReadmeInputs(directory = root) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const server = await createServer({
    root: directory, configFile: false, logLevel: 'error', appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const { tools } = await server.ssrLoadModule('/src/tools.ts');
    const { categories } = await server.ssrLoadModule('/src/catalog.ts');
    const { MAX_TASKS: maxTasks } = await server.ssrLoadModule('/src/workbench.ts');
    return { manifest, tools, categories, maxTasks };
  } finally {
    await server.close();
  }
}

const cell = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/\r?\n/g, '<br>');

export function renderReadme(template, { manifest, tools, categories, maxTasks }) {
  if (!manifest.version || !manifest.devDependencies?.electron || !Number.isInteger(maxTasks) || maxTasks < 1) throw new Error('README 元数据不完整');
  if (!tools.length || !categories.length) throw new Error('README 工具注册表为空');
  const byId = new Map();
  for (const tool of tools) {
    if (!tool.id || !tool.name || !tool.description || byId.has(tool.id)) throw new Error(`README 工具定义缺失或重复：${tool.id}`);
    byId.set(tool.id, tool);
  }
  const seen = new Set();
  const catalog = categories.map(category => {
    const rows = category.ids.map(id => {
      const tool = byId.get(id);
      if (!tool || seen.has(id)) throw new Error(`README 分类包含缺失或重复工具：${id}`);
      seen.add(id);
      return `| ${cell(tool.name)} | ${cell(tool.description)} |`;
    });
    return `### ${category.name}（${rows.length}）\n\n${category.description}\n\n| 工具 | 功能 |\n| --- | --- |\n${rows.join('\n')}`;
  }).join('\n\n');
  if (seen.size !== tools.length) throw new Error(`README 分类未收录工具：${tools.filter(tool => !seen.has(tool.id)).map(tool => tool.id).join(', ')}`);

  const labels = ['Windows x64 安装包', 'Linux amd64 安装包', 'Linux ARM64 / 麒麟安装包'];
  const commands = ['bundle:windows', 'bundle:linux', 'bundle:linux:arm64'];
  const packageRows = releaseTargets(manifest.version).map((target, index) => [labels[index], commands[index], `artifacts/${target.folder}/${target.name}`]);
  packageRows.push(
    ['麒麟 ARM64（命令别名）', 'bundle:kylin', '同 Linux ARM64'],
    ['当前系统解压版', 'bundle:host', 'artifacts/desktop-runtime/DevKit-<platform>-<arch>/'],
    ['三平台安装包合集', 'bundle:all', `artifacts/release-${manifest.version}/`],
    ['独立项目中心服务', 'bundle:project-server', `artifacts/release-${manifest.version}/DevKit_ProjectCenter_${manifest.version}_node24.zip`],
  );
  for (const [, command] of packageRows) {
    if (!manifest.scripts?.[command]) throw new Error(`README 打包命令不存在：${command}`);
  }
  const values = {
    VERSION: manifest.version, ELECTRON_VERSION: manifest.devDependencies.electron,
    TOOL_COUNT: tools.length, CATEGORY_COUNT: categories.length, MAX_TASKS: maxTasks,
    TOOL_CATALOG: catalog,
    PACKAGE_TABLE: ['| 目标 | 命令 | 输出 |', '| --- | --- | --- |', ...packageRows.map(([label, command, output]) => `| ${label} | \`npm run ${command}\` | \`${output}\` |`)].join('\n'),
  };
  // Replace only template tokens; descriptions may legitimately contain {{variables}}.
  const result = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(values, key)) throw new Error(`README 模板占位符未知：${key}`);
    return String(values[key]);
  });
  return result.replace(/\r\n/g, '\n').trimEnd() + '\n';
}

export async function updateReadme({ directory = root, check = false } = {}) {
  const inputs = await readReadmeInputs(directory);
  const template = await readFile(path.join(directory, 'docs/README.template.md'), 'utf8');
  const expected = renderReadme(template, inputs);
  const filename = path.join(directory, 'README.md');
  const current = await readFile(filename, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (current.replace(/\r\n/g, '\n') === expected) return false;
  if (check) throw new Error('README.md 与当前功能不一致，请运行 npm run docs:update');
  await writeFile(filename, expected, 'utf8');
  console.log(`README.md 已更新：v${inputs.manifest.version}，${inputs.tools.length} 个工具`);
  return true;
}

export async function copyReadme(destination) {
  await copyFile(path.join(root, 'README.md'), path.join(destination, 'README.md'));
  // Preserve relative links to the usage and deployment guides in shipped copies.
  await cp(path.join(root, 'docs'), path.join(destination, 'docs'), {
    recursive: true, filter: filename => path.basename(filename) !== 'README.template.md',
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check')) throw new Error('Supported option: --check');
  await updateReadme({ check: args.includes('--check') });
}
