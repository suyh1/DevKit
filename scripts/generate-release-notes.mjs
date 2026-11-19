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

function tagNotes(name) {
  const [type, contents, rawSignature] = git(
    'for-each-ref', '--format=%(objecttype)%00%(contents)%00%(contents:signature)', ref(name),
  ).split('\0');
  if (type !== 'tag') return '';
  const signature = rawSignature.trimEnd();
  const message = signature ? contents.trimEnd().slice(0, -signature.length) : contents;
  return message.trim();
}

function escapeMarkdown(subject) {
  return subject.replace(/[\\`*_\[\]<>~&]/g, '\\$&');
}

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY } = process.env;
const repository = GITHUB_SERVER_URL && GITHUB_REPOSITORY
  ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}`
  : '';
const range = previousTag ? `${ref(previousTag)}..${ref(tag)}` : ref(tag);
const commits = git('log', '--format=%H%x00%s', range, '--').trimEnd();
const lines = [];
const notes = tagNotes(tag);
if (notes && (!previousTag || notes !== tagNotes(previousTag))) {
  lines.push('## 本次更新', '', notes, '');
}
lines.push('## 提交记录', '');
if (commits) {
  for (const commit of commits.split('\n')) {
    const [sha, subject] = commit.split('\0');
    const shortSha = sha.slice(0, 7);
    const reference = repository ? `[${shortSha}](${repository}/commit/${sha})` : `\`${shortSha}\``;
    lines.push(`- ${escapeMarkdown(subject || '无标题提交')} (${reference})`);
  }
} else {
  lines.push('此版本与上一已发布版本之间没有新增提交。');
}
if (previousTag) {
  const comparison = `${previousTag}...${tag}`;
  lines.push('', repository
    ? `[查看完整变更 ${comparison}](${repository}/compare/${comparison})`
    : `版本范围 \`${comparison}\``);
}
process.stdout.write(`${lines.join('\n')}\n`);
