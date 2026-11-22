import { CronExpressionParser } from 'cron-parser';
import { csv, type Opt } from './tabular';
// Enumerate civil times in UTC, then resolve them against the chosen zone.
// A wall time can correspond to zero instants in a gap or two during a fold.
export function zonedCron(input: string, o: Opt) {
  if (input.trim().split(/\s+/).length !== 5) throw Error('需要五字段 Cron');
  const start = +new Date(o.start || Date.now()),
    count = Number(o.count);
  if (!Number.isFinite(start) || !Number.isInteger(count) || count < 1 || count > 100)
    throw Error('检查起始时刻及预览次数（1–100）');
  const format = new Intl.DateTimeFormat('sv-SE', {
    timeZone: o.zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  function wall(t: number) {
    return Date.parse(format.format(t).replace(' ', 'T') + 'Z');
  }
  function offsets(t: number) {
    return [
      ...new Set(
        [-36, 0, 36].map((hours) => {
          const n = t + hours * 3600000;
          return wall(n) - n;
        }),
      ),
    ];
  }
  const rounded = Math.floor(start / 1000) * 1000,
    near = offsets(rounded),
    first = wall(rounded) - (Math.max(...near) - Math.min(...near)) - 60000;
  const expr = CronExpressionParser.parse(input, { currentDate: new Date(first), tz: 'UTC' }),
    results = new Set<number>();
  let latest = -Infinity;
  for (let i = 0; i < 100000; i++) {
    const local = +expr.next().toDate(),
      possible = offsets(local);
    if (results.size >= count && local - Math.max(...possible) > latest) break;
    for (const offset of possible) {
      const t = local - offset;
      if (t > start && wall(t) === local) {
        results.add(t);
        latest = Math.max(latest, t);
      }
    }
    if (results.size >= count && possible.length === 1) break;
  }
  const times = [...results].sort((a, b) => a - b).slice(0, count);
  const output = new Intl.DateTimeFormat('sv-SE', {
    timeZone: o.zone,
    dateStyle: 'short',
    timeStyle: 'long',
  });
  return csv([
    ['UTC', o.zone, '与上次间隔（小时）'],
    ...times.map((t, i) => [
      new Date(t).toISOString(),
      output.format(t),
      i ? (t - times[i - 1]) / 3600000 : '',
    ]),
  ]);
}
