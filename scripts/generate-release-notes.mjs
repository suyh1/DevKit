import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [tag, publishedTagsFile] = process.argv.slice(2);
const stableTag = /^v?[0-9]+\.[0-9]+\.[0-9]+$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

if (!stableTag.test(tag)) {
  throw new Error('Usage: node scripts/generate-release-notes.mjs <version-tag> [published-tags-file]');
}
if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
  throw new Error('Generating release notes requires full Git history and tags');
}

const version = name => name.replace(/^v/, '');
const compareVersions = (a, b) => version(a).localeCompare(version(b), 'en', { numeric: true });
const ref = name => `refs/tags/${name}`;
const publishedTags = publishedTagsFile
  ? new Set(readFileSync(publishedTagsFile, 'utf8').split(/\s+/))
  : null;
const previousTag = git('tag', '--merged', `${ref(tag)}^{commit}`).trim().split('\n')
  .filter(name => stableTag.test(name) && compareVersions(name, tag) < 0 && (!publishedTags || publishedTags.has(name)))
  .sort((a, b) => compareVersions(b, a))[0];

const notesPath = `docs/releases/${version(tag)}.md`;
const notes = git('show', `${ref(tag)}:${notesPath}`).trim();
if (!notes.split(/\r?\n/).some(line => !/^\s*#/.test(line) && /\p{Script=Han}/u.test(line))) {
  throw new Error(`${notesPath} 需要用中文介绍本版本的用户可见变化。`);
}

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY } = process.env;
const repository = GITHUB_SERVER_URL && GITHUB_REPOSITORY
  ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}`
  : '';
const lines = ['## 本次更新', '', notes];
if (previousTag) {
  const comparison = `${previousTag}...${tag}`;
  lines.push('', repository
    ? `[查看完整变更 ${comparison}](${repository}/compare/${comparison})`
    : `版本范围 \`${comparison}\``);
}
process.stdout.write(`${lines.join('\n')}\n`);
