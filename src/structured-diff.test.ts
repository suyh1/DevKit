import { describe, expect, it } from 'vitest';
import { structuredDiff } from './structured-diff';

describe('JSON structure diff', () => {
  it('ignores object ordering and escaped strings, preserves exact number tokens', () => {
    expect(structuredDiff('{"b":"中","a":9007199254740993}', '{"a":9007199254740993,"b":"\\u4e2d"}')).toEqual([]);
    expect(structuredDiff('{"n":9007199254740993}', '{"n":9007199254740992}')).toEqual([{ kind: 'changed', path: '$["n"]', before: '9007199254740993', after: '9007199254740992' }]);
  });
  it('reports additions, removals, type changes and keyed moves', () => {
    const result = structuredDiff('[{"id":1,"n":"a"},{"id":2,"n":"b"}]', '[{"id":2,"n":"c"},{"id":3}]', 'id');
    expect(result.map(row => row.kind)).toEqual(['removed', 'moved', 'changed', 'added']);
    expect(result.find(row => row.kind === 'changed')?.path).toBe('$[0]["n"]');
    expect(structuredDiff('{"__proto__":1}', '{"new":null}').map(row => row.kind)).toEqual(['removed', 'added']);
  });
  it('rejects duplicate keys and ambiguous identities', () => {
    expect(() => structuredDiff('{"x":1,"x":2}', '{}')).toThrow('重复');
    expect(() => structuredDiff('[{"id":1},{"id":1}]', '[]', 'id')).toThrow('重复');
    expect(() => structuredDiff('[{}]', '[]', 'id')).toThrow('缺少');
  });
});
