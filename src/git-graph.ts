import type { Commit } from './git-api';

type Lane = { target: string; color: number };
export type GraphCursor = { lanes: Lane[]; nextColor: number };
export const graphStart: GraphCursor = { lanes: [], nextColor: 0 };

// An active lane follows a parent hash. Its color moves with it when adjacent lanes close.
export function layoutGraph(commits: Pick<Commit, 'id' | 'parents'>[], start = graphStart) {
  let { lanes, nextColor } = start;
  let width = lanes.length;
  const rows = commits.map(({ id, parents }) => {
    const incoming = lanes;
    const found = incoming.findIndex((lane) => lane.target === id);
    const column = found < 0 ? incoming.length : found;
    const color = found < 0 ? nextColor++ : incoming[column].color;
    const active = incoming.filter((lane) => lane.target !== id);
    const parentIds = [...new Set(parents)];
    const newLanes = parentIds.flatMap((target, index) =>
      active.some((lane) => lane.target === target) ? [] : [{ target, color: index === 0 ? color : nextColor++ }],
    );
    lanes = [...active.slice(0, column), ...newLanes, ...active.slice(column)];
    const exits = new Map(lanes.map((lane, i) => [lane.target, { to: i, color: lane.color }]));
    const edges = incoming.flatMap((lane, i) => (lane.target === id ? [] : [{ from: i, ...exits.get(lane.target)! }]));
    for (const target of parentIds) edges.push({ from: column, ...exits.get(target)! });
    width = Math.max(width, column + 1, lanes.length);
    return { column, color, incoming, edges };
  });
  return { rows, width, next: { lanes, nextColor } };
}
