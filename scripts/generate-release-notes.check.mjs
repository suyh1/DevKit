import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    writeNotes(version, content) {
      const folder = path.join(cwd, 'docs/releases');
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, version + '.md'), content);
      git('add', 'docs/releases');
    },
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

test('publishes the tagged Chinese notes and links to the latest reachable published stable version', t => {
  const { git, commit, notes, writeNotes } = fixture(t);
  commit('Initial workspace');
  git('tag', '1.9.0');
  git('switch', '--quiet', '--detach', '1.9.0');
  commit('Unrelated maintenance branch');
  git('tag', '1.11.9');
  git('switch', '--quiet', '--detach', '1.9.0');
  commit('Previously released change');
  git('tag', 'v1.10.0');
  commit('feat: improve SSH workspace');
  git('tag', '1.11.0');
  git('tag', '1.12.0-rc.1');
  const summary = '- 改进 SSH 工作区。\n- 支持删除共享待办清单。';
  writeNotes('1.12.0', summary);
  commit('fix: allow deleting shared todo lists');
  git('tag', '-a', 'v1.12.0', '-m', 'Release DevKit');
  writeNotes('1.12.0', '标签创建后的草稿。');

  const body = notes('v1.12.0', ['1.9.0', '1.11.9', '1.12.0-rc.1', 'v1.10.0']);
  assert.equal(body, `## 本次更新\n\n${summary}\n\n[查看完整变更 v1.10.0...v1.12.0](https://github.com/${repository}/compare/v1.10.0...v1.12.0)\n`);
  assert.equal(notes('v1.12.0', []), `## 本次更新\n\n${summary}\n`);
});

test('missing, empty and English-only release descriptions stop publication', t => {
  const { git, commit, notes, writeNotes } = fixture(t);
  for (const [version, content] of [['1.0.0', null], ['1.0.1', '  '], ['1.0.2', '## 本次更新\n\nEnglish commit title']]) {
    if (content !== null) writeNotes(version, content);
    commit('English commit title');
    git('tag', '-a', version, '-m', 'Release');
    assert.throws(() => notes(version, []), error => {
      assert.ok(error.stderr.includes(`docs/releases/${version}.md`));
      return true;
    });
  }
});
