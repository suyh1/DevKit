import { describe, expect, it } from 'vitest';
import { createTask, editTask, importWorkspace, validatePreferences, workspaceSnapshot } from './workbench';
import { searchTools } from './discovery';
import { categories } from './catalog';
import { tools } from './tools';
import { diffRows, jsonTree, nodePath } from './result-model';
import { readText } from './files';

describe('workbench workflows', () => {
  it('assigns every existing tool to exactly one task category', () => {
    const ids = categories.flatMap(category => category.ids);
    expect(new Set(ids).size).toBe(44);
    expect(ids.sort()).toEqual(tools.map(tool => tool.id).sort());
    for (const tool of tools) expect(categories.find(category => category.ids.includes(tool.id))?.name).toBe(tool.category);
  });
  it('shares alias, multi-term and fuzzy search with stable preference ranking', () => {
    expect(searchTools('令牌')[0].id).toBe('jwt');
    expect(searchTools('pojo')[0].id).toBe('json-code');
    expect(searchTools('json 表格').map(tool => tool.id)).toContain('json-csv');
    expect(searchTools('bs64')[0].id).toBe('base64');
    expect(searchTools('unlikely-nonexistent-tool')).toHaveLength(0);
    expect(searchTools('', ['hash'], ['json'])[0].id).toBe('hash');
  });
  it('keeps independent duplicate tasks and preserves the last result on edit', () => {
    const first = createTask('json', '4'), second = createTask('json');
    expect(first.id).not.toBe(second.id);
    expect(first.input).toBe('');
    const changed = editTask({ ...first, output: '{"a":1}', elapsed: 8, status: 'success' }, { input: '{"a":2}' });
    expect(changed.output).toBe('{"a":1}');
    expect(changed.status).toBe('stale');
    expect(second.options.indent).toBe('2');
    expect(first.options.indent).toBe('4');
  });
  it('excludes passwords, JWTs and color tasks unless explicitly appropriate', () => {
    const tasks = [createTask('json'), createTask('password'), createTask('jwt'), createTask('color-picker')];
    const standard = JSON.parse(workspaceSnapshot(tasks, tasks[0].id));
    expect(standard.tasks.map((task: { toolId: string }) => task.toolId)).toEqual(['json']);
    const explicit = JSON.parse(workspaceSnapshot(tasks, tasks[2].id, true));
    expect(explicit.tasks).toHaveLength(3);
    expect(explicit.active).toBe(2);
  });
  it('restores validated tasks with fresh IDs and untrusted results marked stale', () => {
    const task = { ...createTask('diff'), input: 'before', output: 'old result' };
    const restored = importWorkspace(workspaceSnapshot([task], task.id));
    expect(restored.tasks[0].id).not.toBe(task.id);
    expect(restored.tasks[0].input).toBe('before');
    expect(restored.tasks[0].options.target).toBe(task.options.target);
    expect(restored.tasks[0].status).toBe('stale');
    expect(restored.tasks[0].elapsed).toBeNull();
    expect(editTask(restored.tasks[0], { input: 'edited' }).status).toBe('stale');
  });
  it('rejects invalid and oversized workspace imports and drops unknown option keys', () => {
    expect(() => importWorkspace('{"tasks":[]}')).toThrow();
    const fixture = JSON.parse(workspaceSnapshot([createTask('json')], null));
    fixture.tasks[0].options.__protoField = 'injected';
    expect(Object.hasOwn(importWorkspace(JSON.stringify(fixture)).tasks[0].options, '__protoField')).toBe(false);
    fixture.tasks[0].toolId = 'unknown';
    expect(() => importWorkspace(JSON.stringify(fixture))).toThrow();
    fixture.tasks[0].toolId = 'json'; fixture.tasks[0].input = 'a'.repeat(2_000_001);
    expect(() => importWorkspace(JSON.stringify(fixture))).toThrow();
    fixture.tasks = Array.from({ length: 13 }, () => ({ ...createTask('json') }));
    expect(() => importWorkspace(JSON.stringify(fixture))).toThrow();
  });
  it('validates corrupted preferences rather than trusting local storage', () => {
    const prefs = validatePreferences({ theme: 'invalid', fontSize: 2000, indent: '4', wrap: 'false', startup: 'missing' });
    expect(prefs.theme).toBe('system'); expect(prefs.fontSize).toBe(13);
    expect(prefs.indent).toBe('4'); expect(prefs.wrap).toBe(true); expect(prefs.startup).toBe('home');
  });
});

describe('structured results', () => {
  it('preserves integer precision, exponent notation, repeated keys and special paths', () => {
    const tree = jsonTree('{"id":9007199254740993123,"id":1e+9,"a.b":[null,"汉字"]}');
    expect(tree.children[0].node.raw).toBe('9007199254740993123');
    expect(tree.children[1].key).toBe('id');
    expect(tree.children[1].node.raw).toBe('1e+9');
    expect(tree.children[2].node.children[1].node.raw).toBe('"汉字"');
    expect(nodePath('$', 'a.b', false)).toBe('$["a.b"]');
    expect(nodePath('$', '0', true)).toBe('$[0]');
    expect(() => jsonTree('[1,]')).toThrow();
  });
  it('bounds preview work for large and deeply nested documents', () => {
    expect(() => jsonTree(JSON.stringify(Array.from({ length: 8100 }, () => 1)))).toThrow(/节点/);
    expect(() => jsonTree('['.repeat(102) + '0' + ']'.repeat(102))).toThrow();
  });
  it('aligns additions, removals and empty-file diff hunks', () => {
    const rows = diffRows('--- a\n+++ b\n@@ -1,2 +1,2 @@\n same\n-old\n+new\n');
    expect(rows[2]).toMatchObject({ left: 'old', right: 'new', leftLine: 2, rightLine: 2, kind: 'change' });
    const added = diffRows('--- a\n+++ b\n@@ -0,0 +1,1 @@\n+new\n');
    expect(added[1]).toMatchObject({ right: 'new', rightLine: 1, kind: 'change' });
  });
});

describe('local text import', () => {
  it('decodes UTF-8 and BOM-marked UTF-16 without changing content', async () => {
    expect(await readText(new File(['你好'], 'data.json'))).toEqual({ text: '你好', encoding: 'UTF-8' });
    expect(await readText(new File([new Uint8Array([255, 254, 65, 0, 66, 0])], 'utf16.txt'))).toEqual({ text: 'AB', encoding: 'UTF-16LE' });
    await expect(readText(new File([new Uint8Array([0, 5, 8])], 'binary.bin'))).rejects.toThrow(/二进制/);
    await expect(readText(new File([new Uint8Array([0xff, 0x89])], 'bad.txt'))).rejects.toThrow(/编码/);
  });
});


