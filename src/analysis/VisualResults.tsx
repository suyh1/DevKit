import { TextArea } from '../TextControl';
import { MotionButton, MotionDetails } from '../Motion';
import { useEffect, useMemo, useState } from 'react';
import { PlanTree, PauseChart, Calendar, GridPreview } from './Charts';
import { parseCsv } from '../practical';
import { shapes } from './visual';
import { saveText } from '../files';
function SvgImage({ text, alt }: { text: string; alt: string }) {
  const [url, set] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    set(u);
    return () => URL.revokeObjectURL(u);
  }, [text]);
  return <img className="analysis-heatmap" src={url || undefined} alt={alt} />;
}
function MapPreview({ source }: { source: string }) {
  const features = useMemo(
    () =>
      shapes(source).map((s) => ({
        ...s,
        paths: s.paths
          .map((path) =>
            path.filter(
              (p) =>
                Array.isArray(p) &&
                Number.isFinite(p[0]) &&
                Number.isFinite(p[1]) &&
                Math.abs(p[0]) <= 180 &&
                Math.abs(p[1]) <= 90,
            ),
          )
          .filter((path) => path.length),
      })),
    [source],
  );
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const feature of features)
    for (const path of feature.paths)
      for (const [x, y] of path) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
  const scale = Math.min(560 / (maxX - minX || 1), 230 / (maxY - minY || 1));
  const pt = ([x, y]: number[]) => [
    300 + (x - (maxX + minX) / 2) * scale,
    125 - (y - (maxY + minY) / 2) * scale,
  ];
  return (
    <svg viewBox="0 0 600 250" role="img" aria-label="经纬坐标平面预览">
      {features.map(({ type, paths, name }) =>
        type === 'Point' && paths.length ? (
          <circle key={name} cx={pt(paths[0][0])[0]} cy={pt(paths[0][0])[1]} r="4" fill="var(--accent)" />
        ) : (
          <path
            key={name}
            d={paths
              .map(
                (path) =>
                  'M' + path.map((p) => pt(p).join(',')).join(' L') + (type === 'Polygon' ? ' Z' : ''),
              )
              .join(' ')}
            fill={type === 'Polygon' ? 'var(--soft)' : 'none'}
            fillRule="evenodd"
            stroke="var(--accent)"
            strokeWidth="2"
          >
            <title>
              {name} · {type}
            </title>
          </path>
        ),
      )}
    </svg>
  );
}
function Timeline({ source, cpu }: { source: string; cpu: boolean }) {
  const [head, ...rows] = useMemo(() => parseCsv(source, ',', true, Number.MAX_SAFE_INTEGER), [source]);
  if (!cpu && !head.includes('起点 ms')) return null;
  const timeline = cpu && head[0] === '起点 ms',
    stackIdx = cpu ? (timeline ? 2 : 3) : 0;
  const bars = rows.slice(0, 180).map((r) => ({
    label: r[stackIdx],
    start: cpu ? (timeline ? +r[0] : 0) : +r[3],
    parts: cpu ? [+r[1]] : r.slice(6, 12).map(Number),
    duration: cpu ? +r[1] : +r[4],
  }));
  const total = bars.reduce((n, r) => Math.max(n, r.start + r.duration), 1),
    palette = ['#71899c', '#816cb1', '#4390ae', '#c38b49', '#4d9273', '#577ac2'];
  if (cpu && timeline) {
    const depth = Math.min(
      35,
      bars.reduce((n, b) => Math.max(n, b.label.split(' → ').length), 0),
    );
    return (
      <svg viewBox={'0 0 1000 ' + Math.max(1, depth * 20)} role="img" aria-label="调用栈火焰图">
        {bars.flatMap((bar, i) =>
          bar.label
            .split(' → ')
            .slice(0, depth)
            .map((name, j) => (
              <rect
                key={i + '-' + j}
                x={(bar.start / total) * 1000}
                y={j * 20}
                width={(bar.duration / total) * 1000}
                height={19}
                fill={palette[(name.length + j) % 6]}
              >
                <title>
                  {name} · {bar.duration} ms
                </title>
              </rect>
            )),
        )}
      </svg>
    );
  }
  return (
    <MotionDetails className="workbench-disclosure" open>
      <summary>
        {cpu ? '采样自身用时' : '请求瀑布'} · 前 {bars.length} 项
      </summary>
      {!cpu && <small>阶段依次为阻塞、DNS、连接、发送、首字节等待、下载</small>}
      <div className="analysis-bars">
        {bars.map((r, i) => (
          <div key={i}>
            <small title={r.label}>{r.label}</small>
            <span>
              {r.parts.map((n, j) => (
                <i
                  key={j}
                  style={{ marginLeft: j === 0 ? (r.start / total) * 100 + '%' : 0, width: (Math.max(0, n) / total) * 100 + '%', background: palette[j] }}
                  title={n + ' ms'}
                />
              ))}
            </span>
          </div>
        ))}
      </div>
    </MotionDetails>
  );
}
function EditableNotes({ text }: { text: string }) {
  const [draft, set] = useState(text);
  const [status, setStatus] = useState('');
  useEffect(() => set(text), [text]);
  return (
    <section className="workbench-disclosure editable-notes">
      <label>编辑更新说明<TextArea rows={10} value={draft} onChange={(e) => { set(e.target.value); setStatus(''); }} /></label>
      <MotionButton className="secondary-button" onClick={() => void saveText(draft, '更新说明.md').then(setStatus).catch(e => setStatus(String(e)))}>保存编辑后的 Markdown</MotionButton>
      {status && <small role="status">{status}</small>}
    </section>
  );
}
export default function VisualResults({
  id,
  input,
  output,
  options,
  onOption,
}: {
  id: string;
  input: string;
  output: string;
  options: Record<string, string>;
  onOption: (key: string, val: string) => void;
}) {
  if (id === 'css-grid')
    return <GridPreview input={input} options={options} change={(v) => onOption('tracks', v)} />;
  if (!output) return null;
  if (id === 'mermaid-diagram') return <SvgImage text={output} alt="Mermaid 图" />;
  if (id === 'pg-plan') return <PlanTree text={output} />;
  if (id === 'gc-pauses') return <PauseChart text={output} />;
  if (id === 'rrule') return <Calendar output={output} zone={options.zone} />;
  if (id === 'changelog') return <EditableNotes text={output} />;
  if (id === 'geojson-map') return <MapPreview source={input} />;
  if (id === 'har-waterfall' || id === 'cpu-profile')
    return <Timeline source={output} cpu={id === 'cpu-profile'} />;
  if (id === 'svg-optimize')
    return (
      <div className="svg-comparison">
        {[input, output].map((s, i) => (
          <figure key={i}>
            <SvgImage text={s} alt={i ? '优化结果' : '原始图像'} />
            <figcaption>
              {i ? '优化后' : '原图'} · {new Blob([s]).size} 字节
            </figcaption>
          </figure>
        ))}
      </div>
    );
  return null;
}
