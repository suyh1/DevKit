import { useMemo, useState } from 'react';
import { parseCsv } from '../practical';
export default function AnalysisTable({ text }: { text: string }) {
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(0),
    [selected, select] = useState<string[] | null>(null);
  const [header, ...rows] = useMemo(() => parseCsv(text, ',', true, Number.MAX_SAFE_INTEGER), [text]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = rows.filter(
    (row) => !needle || row.some((cell) => cell.toLocaleLowerCase().includes(needle)),
  );
  const pages = Math.max(1, Math.ceil(visible.length / 50)),
    current = Math.min(page, pages - 1);
  return (
    <div className="data-table">
      <label>
        筛选结果{' '}
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
            select(null);
          }}
        />
      </label>
      <p className="preview-note">
        共 {rows.length} 条 · 当前匹配 {visible.length} 条
      </p>
      <table>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.slice(current * 50, current * 50 + 50).map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j}>
                  {j === 0 ? <button onClick={() => select(row)}>{v || '查看记录'}</button> : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <nav>
          <button disabled={!current} onClick={() => setPage(current - 1)}>
            上一页
          </button>{' '}
          {current + 1} / {pages}{' '}
          <button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            下一页
          </button>
        </nav>
      )}
      {selected && (
        <section>
          <button onClick={() => select(null)}>关闭详情</button>
          <dl>
            {header.map((h, i) => (
              <div key={i}>
                <dt>{h}</dt>
                <dd>
                  <pre>{selected[i]}</pre>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
