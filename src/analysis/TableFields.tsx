import { MotionDetails } from '../Motion';
import { useMemo } from 'react';
import { parseCsv } from '../practical';
const eligible = new Set(['reconcile', 'pivot', 'pseudonym']);
export default function TableFields({
  id,
  input,
  options,
  onChange,
}: {
  id: string;
  input: string;
  options: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const header = useMemo(() => {
    if (!eligible.has(id) || !input.trim() || /^\s*[[{]/.test(input)) return [];
    // Only the header is needed. Quoted column names can contain newlines.
    let quoted = false,
      end = 0;
    for (; end < input.length; end++) {
      const c = input[end];
      if (c === '"') {
        if (quoted && input[end + 1] === '"') end++;
        else quoted = !quoted;
      } else if (!quoted && /[\r\n]/.test(c)) break;
    }
    const line = input.slice(0, end);
    try {
      return parseCsv(line, line.replace(/"(?:[^"]|"")*"/g, '').includes('\t') ? '\t' : ',')[0];
    } catch {
      return [];
    }
  }, [id, input]);
  if (!header.length) return null;
  const keys = options.keys
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    <MotionDetails className="analysis-file">
      <summary>从表头选择字段</summary>
      <div className="analysis-fields field-choices">
        {header.map((name, i) => (
          <label key={i}>
            <input
              className="form-check" type="checkbox"
              checked={keys.includes(name)}
              onChange={(e) =>
                onChange(
                  'keys',
                  (e.target.checked ? [...keys, name] : keys.filter((k) => k !== name)).join(','),
                )
              }
            />
            {name}
          </label>
        ))}
      </div>
      {id === 'pivot' && options.aggregate !== 'count' && (
        <label>
          汇总数值列
          <select value={options.value} onChange={(e) => onChange('value', e.target.value)}>
            {!header.includes(options.value) && <option value={options.value}>选择数值列</option>}
            {header.map((h, i) => (
              <option key={i}>{h}</option>
            ))}
          </select>
        </label>
      )}
    </MotionDetails>
  );
}
