import { useMemo, useRef, useState } from 'react';
import { parseCsv } from '../practical';
export function PlanTree({ text }: { text: string }) {
  const rows = useMemo(() => parseCsv(text, ',').slice(1), [text]),
    [hidden, setHidden] = useState<string[]>([]);
  const childParents = new Set(rows.map((r) => r[0].split('.').slice(0, -1).join('.')));
  const tree = rows.filter((r) => !hidden.some((k) => r[0].startsWith(k + '.')));
  return (
    <details open>
      <summary>执行计划树</summary>
      <div className="analysis-plan">
        {tree.slice(0, 400).map((r, i) => {
          const expandable = childParents.has(r[0]),
            level = r[0].split('.').length;
          return (
            <div key={r[0]} style={{ marginInlineStart: Math.min(level - 1, 12) * 15 }}>
              {expandable ? (
                <button
                  aria-label={'展开或折叠节点 ' + r[0]}
                  aria-expanded={!hidden.includes(r[0])}
                  onClick={() =>
                    setHidden(hidden.includes(r[0]) ? hidden.filter((x) => x !== r[0]) : [...hidden, r[0]])
                  }
                >
                  {hidden.includes(r[0]) ? '▸' : '▾'}
                </button>
              ) : (
                <span>·</span>
              )}
              <strong>{r[1].trim()}</strong> {r[2]} <small>{r[3] ? r[3] + ' ms' : '成本 ' + r[4]}</small>
              {r[3] && (
                <meter
                  min={0}
                  max={100}
                  value={Math.min(100, parseFloat(r[9]) || 0)}
                  aria-label={'耗时占比 ' + r[9]}
                />
              )}{' '}
              {i > 0 && Number(r[7]) >= 10 && <small>实际行数为估计的 {r[7]} 倍</small>}
            </div>
          );
        })}
      </div>
    </details>
  );
}
export function PauseChart({ text }: { text: string }) {
  const all = useMemo(
      () =>
        parseCsv(text, ',')
          .slice(1)
          .filter((r) => r[0]),
      [text],
    ),
    [at, setAt] = useState(0),
    rows = all.slice(at, at + 200);
  const max = Math.max(1, ...rows.map((r) => +r[3]));
  return (
    <details open>
      <summary>GC 停顿 · {all.length} 次</summary>
      <svg viewBox="0 0 800 130" role="img" aria-label="按日志先后绘制的停顿毫秒">
        {rows.map((r, i) => {
          const height = (+r[3] / max) * 118;
          return (
            <rect
              key={r[0]}
              x={(800 * i) / rows.length}
              y={125 - height}
              height={Math.max(1, height)}
              width={Math.max(1, 800 / rows.length - 1)}
              fill="var(--accent)"
            >
              <title>
                {r[1]} · {r[2]} · {r[3]} ms · {r[4]}
              </title>
            </rect>
          );
        })}
      </svg>
      {all.length > 200 && (
        <label>
          起始事件 {at + 1}
          <input
            type="range"
            value={at}
            min={0}
            max={all.length - 200}
            onChange={(e) => setAt(+e.target.value)}
          />
        </label>
      )}
    </details>
  );
}
export function Calendar({ output, zone }: { output: string; zone: string }) {
  const groups = useMemo(() => {
      const fmt = new Intl.DateTimeFormat('sv-SE', {
          timeZone: zone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }),
        map = new Map<string, Set<number>>();
      for (const r of parseCsv(output, ',').slice(1)) {
        const date = fmt.format(new Date(r[1])),
          month = date.slice(0, 7),
          days = map.get(month) ?? new Set();
        days.add(Number(date.slice(8)));
        map.set(month, days);
      }
      return map;
    }, [output, zone]),
    [page, move] = useState(0),
    months = [...groups.keys()],
    index = Math.min(page, months.length - 1);
  if (index < 0) return null;
  const month = months[index],
    [year, num] = month.split('-').map(Number),
    offset = (new Date(Date.UTC(year, num - 1, 1)).getUTCDay() + 6) % 7,
    last = new Date(Date.UTC(year, num, 0)).getUTCDate();
  return (
    <details open>
      <summary>发生日期 · {zone}</summary>
      <nav>
        <button disabled={!index} onClick={() => move(index - 1)}>
          上一月
        </button>{' '}
        {month}{' '}
        <button disabled={index === months.length - 1} onClick={() => move(index + 1)}>
          下一月
        </button>
      </nav>
      <div className="analysis-calendar">
        {Array.from('一二三四五六日', (d) => (
          <strong key={d}>{d}</strong>
        ))}
        {Array.from({ length: offset + last }, (_, i) => {
          const day = i - offset + 1;
          return (
            <span key={i} data-occurs={groups.get(month)!.has(day) || undefined}>
              {day > 0 ? day : ''}
            </span>
          );
        })}
      </div>
    </details>
  );
}
export function GridPreview({
  input,
  options,
  change,
}: {
  input: string;
  options: Record<string, string>;
  change: (value: string) => void;
}) {
  const stage = useRef<HTMLDivElement>(null),
    drag = useRef<{ index: number; x: number; before: number[]; width: number } | null>(null);
  const tracks = options.tracks.trim().split(/\s+/).map(Number),
    rows = input
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/)),
    sum = tracks.reduce((n, x) => n + x, 0);
  if (!input.trim() || tracks.some((n) => !Number.isFinite(n) || n <= 0) || sum <= 0) return null;
  function setPair(before: number[], i: number, n: number) {
    const total = before[i] + before[i + 1],
      v = Math.max(0.01, Math.min(total - 0.01, n)),
      next = [...before];
    next[i] = Number(v.toFixed(3));
    next[i + 1] = Number((total - v).toFixed(3));
    change(next.join(' '));
  }
  return (
    <div
      className="analysis-grid"
      ref={stage}
      style={{
        gridTemplateColumns: tracks.map((n) => n + 'fr').join(' '),
        gap: Math.max(0, Math.min(Number(options.gap) || 0, 100)),
      }}
    >
      {rows
        .flat()
        .slice(0, 500)
        .map((n, i) => (
          <span key={i}>{n}</span>
        ))}
      {tracks.slice(0, -1).map((n, i) => (
        <button
          key={'bar' + i}
          type="button"
          className="grid-divider"
          style={{ left: (tracks.slice(0, i + 1).reduce((v, x) => v + x, 0) / sum) * 100 + '%' }}
          aria-label={'拖动或用方向键调整第 ' + (i + 1) + ' 条列线'}
          title="拖动或使用左右方向键"
          onPointerDown={(e) => {
            drag.current = { index: i, x: e.clientX, before: tracks, width: stage.current!.clientWidth };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.index !== i) return;
            setPair(d.before, i, d.before[i] + ((e.clientX - d.x) / d.width) * sum);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
              e.preventDefault();
              setPair(tracks, i, n + (e.key === 'ArrowLeft' ? -0.1 : 0.1));
            }
          }}
        />
      ))}
    </div>
  );
}
