import { Fragment, useId, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { parseCsv } from '../practical';

export default function AnalysisTable({ text }: { text: string }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, select] = useState<string[] | null>(null);
  const detailId = useId();
  const [header, ...rows] = useMemo(() => parseCsv(text, ',', true, Number.MAX_SAFE_INTEGER), [text]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? rows.filter((row) => row.some((cell) => cell.toLocaleLowerCase().includes(needle)))
    : rows;
  const pages = Math.max(1, Math.ceil(visible.length / 50));
  const current = Math.min(page, pages - 1);

  function move(next: number) {
    setPage(next);
    select(null);
  }
  return (
    <div className="data-table analysis-data">
      <div className="analysis-table-tools">
        <label className="analysis-table-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label="筛选结果"
            placeholder="筛选结果"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              move(0);
            }}
          />
        </label>
        <span role="status">
          {needle ? visible.length + ' / ' + rows.length + ' 条匹配' : '共 ' + rows.length + ' 条'}
        </span>
      </div>
      <div className="analysis-table-scroll">
        <table>
          <thead>
            <tr>
              {header.map((label, i) => (
                <th scope="col" key={i}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.slice(current * 50, current * 50 + 50).map((row, index) => {
              const open = selected === row;
              return (
                <Fragment key={index}>
                  <tr data-selected={open || undefined}>
                    {row.map((value, i) => (
                      <td key={i}>
                        {i === 0 ? (
                          <button
                            className="analysis-row-toggle"
                            aria-expanded={open}
                            aria-controls={open ? detailId : undefined}
                            onClick={() => select(open ? null : row)}
                          >
                            <ChevronRight size={14} aria-hidden="true" />
                            {value || '查看记录'}
                          </button>
                        ) : (
                          value
                        )}
                      </td>
                    ))}
                  </tr>
                  {open && (
                    <tr className="analysis-row-detail" id={detailId}>
                      <td colSpan={header.length}>
                        <dl>
                          {header.map((label, i) => (
                            <div key={i}>
                              <dt>{label}</dt>
                              <dd>
                                <pre>{row[i]}</pre>
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {!visible.length && <p className="analysis-table-empty">{needle ? '没有匹配的记录' : '没有记录'}</p>}
      </div>
      {pages > 1 && (
        <nav aria-label="结果分页" className="analysis-pagination">
          <button
            className="icon-button"
            aria-label="上一页"
            disabled={!current}
            onClick={() => move(current - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {current + 1} / {pages}
          </span>
          <button
            className="icon-button"
            aria-label="下一页"
            disabled={current >= pages - 1}
            onClick={() => move(current + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </nav>
      )}
    </div>
  );
}
