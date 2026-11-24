import FloatingDetails from '../FloatingDetails';
import { TextArea } from '../TextControl';
import { useEffect, useRef, useState } from 'react';
import type { Options } from '../tools';
export type RegressionCase = { input: string; expected: string; step?: number };
export function validCases(v: unknown): v is RegressionCase[] {
  return (
    Array.isArray(v) &&
    v.length <= 30 &&
    v.every(
      (c) =>
        c &&
        typeof c.input === 'string' &&
        typeof c.expected === 'string' &&
        (c.step === undefined || (Number.isInteger(c.step) && c.step >= 1)),
    )
  );
}
export function CaseList({
  cases,
  change,
  steps,
}: {
  cases: RegressionCase[];
  change: (c: RegressionCase[]) => void;
  steps?: number;
}) {
  const list = useRef<HTMLDivElement>(null);
  return (
    <div className="regression-cases">
      <button
        className="secondary-button"
        disabled={cases.length >= 30}
        onClick={() => {
          change([...cases, { input: '', expected: '' }]);
          requestAnimationFrame(() => list.current?.lastElementChild?.querySelector('textarea')?.focus());
        }}
      >
        新增样例
      </button>
      <div className="case-rows" ref={list}>
        {cases.map((item, i) => (
          <fieldset key={i}>
            <legend>样例 {i + 1}</legend>
            {(['input', 'expected'] as const).map((k) => (
              <label key={k}>
                {k === 'input' ? '输入' : '期望输出'}
                <TextArea
                  value={item[k]}
                  onChange={(e) => change(cases.map((c, j) => (i === j ? { ...c, [k]: e.target.value } : c)))}
                />
              </label>
            ))}
            {steps && (
              <label>
                验证位置
                <select
                  value={item.step ?? 0}
                  onChange={(e) =>
                    change(cases.map((c, j) => (j === i ? { ...c, step: +e.target.value || undefined } : c)))
                  }
                >
                  <option value="0">最终输出</option>
                  {Array.from({ length: steps }, (_, i) => (
                    <option key={i} value={i + 1}>
                      步骤 {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="text-button" onClick={() => change(cases.filter((_, j) => i !== j))}>
              移除样例
            </button>
          </fieldset>
        ))}
      </div>
    </div>
  );
}
export default function RegexCases({ options }: { options: Options }) {
  const key = 'devkit:regex-cases:v1',
    [open, toggle] = useState(false),
    [cases, change] = useState<RegressionCase[]>(() => {
      try {
        const data = JSON.parse(localStorage.getItem(key) ?? '[]');
        return validCases(data) ? data : [];
      } catch {
        return [];
      }
    }),
    [rows, setRows] = useState<string[]>([]),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (!open) return;
    let live = true,
      w: Worker | undefined,
      timeout: ReturnType<typeof setTimeout> | undefined;
    async function test() {
      const results: string[] = [];
      for (const [i, c] of cases.entries()) {
        if (!live) break;
        try {
          const raw = await new Promise<string>((ok, no) => {
            w = new Worker(new URL('../tool.worker.ts', import.meta.url), { type: 'module' });
            timeout = setTimeout(() => no(Error('正则执行超时')), 3000);
            w.onmessage = (e) => (e.data.error ? no(Error(e.data.error)) : ok(e.data.output));
            w.onerror = () => no(Error('执行失败'));
            w.postMessage({ id: 'regex', input: c.input, options });
          });
          const actual =
            options.mode === 'replace'
              ? raw
              : JSON.parse(raw)
                  .matches.map((m: { match: string }) => m.match)
                  .join('\n');
          results.push(
            '样例 ' + (i + 1) + (actual === c.expected ? ' · 通过' : ' · 失败，实际输出：' + JSON.stringify(actual)),
          );
        } catch (e) {
          results.push('样例 ' + (i + 1) + ' · ' + String(e));
        } finally {
          clearTimeout(timeout);
          w?.terminate();
        }
      }
      if (live) setRows(results);
    }
    setRows([]);
    const timer = setTimeout(() => void test(), 300);
    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(timeout);
      w?.terminate();
    };
  }, [cases, options, open]);
  return (
    <FloatingDetails className="analysis-file" data-upgrade="regex" onToggle={(e) => toggle(e.currentTarget.open)}>
      <summary>正则回归样例</summary>
      <p>匹配模式每行填写一个期望匹配。替换模式填写替换后的全文。</p>
      <button
        onClick={() => {
          try {
            localStorage.setItem(key, JSON.stringify(cases));
            setMessage('样例已保存到本机');
          } catch {
            setMessage('本机存储不可用');
          }
        }}
      >
        保存样例
      </button>
      <CaseList cases={cases} change={change} />
      {rows.map((s, i) => (
        <pre key={i}>{s}</pre>
      ))}
      <small>{message}</small>
    </FloatingDetails>
  );
}
