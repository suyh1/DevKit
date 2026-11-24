import { describe, expect, it } from 'vitest';
import { layoutGraph } from './git-graph';

describe('提交图泳道', () => {
  const commits = [
    { id: 'merge', parents: ['a', 'b', 'c'] },
    { id: 'a', parents: ['root'] },
    { id: 'b', parents: ['root'] },
    { id: 'c', parents: ['root'] },
    { id: 'root', parents: [] },
  ];
  it('三父合并和已占用的共同父节点正确连线，泳道移位时保持颜色', () => {
    const { rows, width, next } = layoutGraph(commits);
    expect(width).toBe(3);
    expect(rows[0].edges.map((edge) => edge.to)).toEqual([0, 1, 2]);
    expect(rows[2].edges).toContainEqual({ from: 2, to: 1, color: rows[3].color });
    expect(rows[3].edges).toContainEqual({ from: 1, to: 0, color: rows[4].color });
    expect(next.lanes).toEqual([]);
  });
  it('逐页布局与完整历史产生相同的节点、边和颜色', () => {
    const whole = layoutGraph(commits);
    const first = layoutGraph(commits.slice(0, 3));
    const second = layoutGraph(commits.slice(3), first.next);
    expect([...first.rows, ...second.rows]).toEqual(whole.rows);
    expect(second.next).toEqual(whole.next);
    expect(layoutGraph(commits.slice(3), first.next)).toEqual(second);
  });
});
