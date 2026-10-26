import { Plus, Trash2 } from 'lucide-react';
import { blankHttpRow } from './http-builder';
import type { HttpRow } from './http-builder';

export default function HttpKeyValues({
  label,
  rows,
  onChange,
  disabled
}: {
  label: string;
  rows: HttpRow[];
  onChange: (rows: HttpRow[]) => void;
  disabled: boolean;
}) {
  function patch(index: number, change: Partial<HttpRow>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }
  return (
    <div className="http-key-values" aria-label={label}>
      <div className="http-kv-heading">
        <span>启用</span>
        <span>名称</span>
        <span>值</span>
        <span />
      </div>
      {rows.map((row, index) => (
        <div className="http-kv-row" key={index}>
          <input
            type="checkbox"
            aria-label={`${label} ${index + 1} 启用`}
            checked={row.enabled}
            disabled={disabled}
            onChange={(event) => patch(index, { enabled: event.target.checked })}
          />
          <input
            aria-label={`${label} ${index + 1} 名称`}
            placeholder="名称"
            value={row.key}
            disabled={disabled}
            onChange={(event) => patch(index, { key: event.target.value })}
          />
          <input
            aria-label={`${label} ${index + 1} 值`}
            placeholder="值"
            value={row.value}
            disabled={disabled}
            onChange={(event) => patch(index, { value: event.target.value })}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={`删除${label} ${index + 1}`}
            disabled={disabled}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="text-button" disabled={disabled} onClick={() => onChange([...rows, blankHttpRow()])}>
        <Plus size={14} />
        添加{label}
      </button>
    </div>
  );
}
