import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./generate-release-notes.mjs', import.meta.url));
const repository = 'example/DevKit';

function fixture(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'devkit-release-notes-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  git('init', '--quiet');
  git('config', 'user.name', 'Release Notes Test');
  git('config', 'user.email', 'release-notes@example.com');
  git('config', 'commit.gpgSign', 'false');
  git('config', 'tag.gpgSign', 'false');
  return {
    git,
    commit(subject) {
      git('commit', '--quiet', '--allow-empty', '-m', subject);
      return git('rev-parse', 'HEAD').trim();
    },
    notes(tag, publishedTags) {
      const file = path.join(cwd, 'published-tags.txt');
      writeFileSync(file, publishedTags.join('\n'));
      return execFileSync(process.execPath, [script, tag, file], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: repository },
      });
    },
  };
}

test('release notes use the latest reachable, published stable version as their base', t => {
  const { git, commit, notes } = fixture(t);
  commit('Initial workspace');
  git('tag', '1.9.0');
  git('switch', '--quiet', '--detach', '1.9.0');
  commit('Unrelated maintenance branch');
  git('tag', '1.11.9');
  git('switch', '--quiet', '--detach', '1.9.0');
  commit('Previously released change');
  git('tag', 'v1.10.0');
  const feature = commit('feat: improve [SSH] workspace');
  git('tag', '1.11.0');
  const fix = commit('fix: allow deleting shared todo lists');
  git('tag', '1.12.0-rc.1');
  git('tag', '-a', '1.12.0', '-m', '- 改进 SSH 工作区。\n- 支持删除共享待办清单。');
  git('tag', '1.12.1');

  const body = notes('1.12.0', ['1.9.0', '1.11.9', '1.12.0-rc.1', 'v1.10.0', '1.12.1']);
  assert.ok(body.includes('## 本次更新\n\n- 改进 SSH 工作区。\n- 支持删除共享待办清单。'));
  assert.ok(body.includes(`feat: improve \\[SSH\\] workspace ([${feature.slice(0, 7)}](https://github.com/${repository}/commit/${feature}))`));
  assert.ok(body.includes(`fix: allow deleting shared todo lists ([${fix.slice(0, 7)}](https://github.com/${repository}/commit/${fix}))`));
  assert.ok(body.includes(`https://github.com/${repository}/compare/v1.10.0...1.12.0`));
  assert.doesNotMatch(body, /Initial workspace|Unrelated maintenance branch|Previously released change/);
});

test('lightweight tags and the first release get commit notes without a copied annotation', t => {
  const { git, commit, notes } = fixture(t);
  commit('feat: create shared workspace');
  git('tag', 'v1.0.0');
  commit('fix: complete shared todo deletion');
  git('tag', 'v1.1.0');

  const first = notes('v1.1.0', []);
  assert.match(first, /feat: create shared workspace/);
  assert.match(first, /fix: complete shared todo deletion/);
  assert.doesNotMatch(first, /本次更新|\/compare\//);

  const update = notes('v1.1.0', ['v1.0.0']);
  assert.match(update, /fix: complete shared todo deletion/);
  assert.doesNotMatch(update, /本次更新|feat: create shared workspace/);
});

test('an annotation copied from the prior release is omitted', t => {
  const { git, commit, notes } = fixture(t);
  commit('feat: previous feature');
  git('tag', '-a', '1.0.0', '-m', 'Previous feature summary');
  commit('fix: current issue');
  git('tag', '-a', '1.0.1', '-m', 'Previous feature summary');

  const body = notes('1.0.1', ['1.0.0']);
  assert.match(body, /fix: current issue/);
  assert.doesNotMatch(body, /Previous feature summary|feat: previous feature/);
});
