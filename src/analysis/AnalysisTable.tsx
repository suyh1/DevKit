import { TextInput } from '../TextControl';
import { Modal } from '../project-components';
import { useId, useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import ResultPager from '../ResultPager';
import { parseCsv } from '../practical';

export default function AnalysisTable({ text }: { text: string }) {
  const records = useMemo(() => parseCsv(text, ',', true, Number.MAX_SAFE_INTEGER), [text]);
  return <ResultTable records={records} />;
}

export function ResultTable({ records, columnLimit }: { records: string[][]; columnLimit?: number }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, select] = useState<string[] | null>(null);
  const detailId = useId();
  const [columns = [], ...rows] = records;
  const header = columns.slice(0, columnLimit);
  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? rows.filter((row) =>
        row.some(
          (cell, i) => (columnLimit === undefined || i < columnLimit) && cell.toLocaleLowerCase().includes(needle),
        ),
      )
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
          <TextInput
            embedded
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
          {header.length < columns.length && ' · 预览前 ' + header.length + ' 列'}
        </span>
      </div>
      <div className="analysis-table-scroll">
        <table>
          <thead>
            <tr>
              {header.map((label, i) => (
                <th scope="col" key={i}>
                  {label || '空列名'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.slice(current * 50, current * 50 + 50).map((row, index) => {
              const open = selected === row;
              return (
                <tr key={index} data-selected={open || undefined}>
                  {row.slice(0, columnLimit).map((value, i) => (
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
              );
            })}
          </tbody>
        </table>
        {!visible.length && <p className="analysis-table-empty">{needle ? '没有匹配的记录' : '没有记录'}</p>}
      </div>
      {selected && (
        <Modal title="记录详情" closeLabel="关闭记录详情" close={() => select(null)}>
          <div className="analysis-row-detail" id={detailId}>
            <dl>
              {header.map((label, i) => (
                <div key={i}>
                  <dt>{label || '空列名'}</dt>
                  <dd>
                    <pre>{selected[i]}</pre>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </Modal>
      )}
      <ResultPager page={current} pages={pages} onPage={move} />
    </div>
  );
}
