import { glob, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { flattenNginx, parseNginx } from '../shared/nginx.mjs';
import { pathKey } from './nginx-process.mjs';

export async function stageNginxDraft(instance, changes, directory, readDocument) {
  const files = new Map();
  const configRoot = path.dirname(instance.main);
  let characters = 0;
  const quote = filename => '"' + filename.replaceAll('\\', '/').replace(/["$]/g, value => '\\' + value) + '"';
  async function stage(filename, stack) {
    const resolved = await realpath(filename), key = pathKey(resolved);
    if (stack.includes(key) || stack.length > 32) throw new Error(`include 循环或超过 32 层：${resolved}`);
    if (files.has(key)) return files.get(key);
    if (files.size >= 100) throw new Error('草稿检查最多展开 100 个配置文件。');
    const original = await readDocument(resolved);
    const content = changes.get(key)?.content ?? original.content;
    characters += content.length;
    if (characters > 10_000_000) throw new Error('草稿及引用文件超过 10 MB。');
    const target = path.join(directory, `config-${files.size}.conf`);
    const entry = { filename: target, source: original };
    files.set(key, entry);
    let staged = content;
    const includes = flattenNginx(parseNginx(content)).filter(node => node.name === 'include');
    for (const node of includes.sort((a, b) => b.start - a.start)) {
      const value = node.values[0];
      if (node.values.length !== 1 || !value || value.includes('$')) throw new Error(`无法安全展开 include：${resolved} 第 ${node.line} 行`);
      const pattern = path.resolve(configRoot, value).replaceAll('\\', '/');
      const matches = [];
      if (/[*?\[]/.test(value)) {
        for await (const match of glob(pattern)) {
          if (matches.length >= 100) throw new Error(`include 匹配超过 100 个文件：${value}`);
          matches.push(match);
        }
        matches.sort();
      } else matches.push(pattern);
      const directives = [];
      for (const match of matches) directives.push(`include ${quote((await stage(match, [...stack, key])).filename)};`);
      staged = staged.slice(0, node.start) + directives.join('\n') + staged.slice(node.end);
    }
    await writeFile(target, staged, { flag: 'wx', mode: 0o600 });
    return entry;
  }
  const main = (await stage(instance.main, [])).filename;
  return { main, sources: [...files.values()].map(item => item.source) };
}
