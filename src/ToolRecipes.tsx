import { useEffect, useRef, useState } from 'react';
import { defaultOptions, tools, type Options, type ToolId } from './tools';
import ToolOptions from './ToolOptions';
import { copyText } from './motion-primitives';

const allowed: ToolId[] = [
  'base64',
  'json',
  'json-path',
  'url',
  'unicode',
  'gzip',
  'yaml',
  'csv-json',
  'json-csv',
  'text',
];
const prefix = 'devkit:recipe:';
type Step = { tool: ToolId; options: Options };
const makeStep = (tool: ToolId): Step => ({ tool, options: { ...defaultOptions[tool] } });
const label = (id: ToolId) => tools.find((t) => t.id === id)!.name;

export default function ToolRecipes({ input }: { input: string }) {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<Step[]>([makeStep('json')]);
  const [name, setName] = useState(''),
    [names, setNames] = useState<string[]>([]);
  const [report, setReport] = useState<{ name: string; input: string; output: string; error?: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const cancel = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancel.current?.(), []);
  function refresh() {
    try {
      setNames(
        Object.keys(localStorage)
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length))
          .sort(),
      );
    } catch {
      setMessage('本地存储不可用。');
    }
  }
  function change(next: Step[]) {
    setSteps(next);
    setReport([]);
  }
  function load(key: string) {
    try {
      const data: Step[] = JSON.parse(localStorage.getItem(prefix + key) || 'null');
      if (
        !Array.isArray(data) ||
        !data.length ||
        data.length > 12 ||
        data.some(
          (step) =>
            !allowed.includes(step?.tool) ||
            !step.options ||
            typeof step.options !== 'object' ||
            Object.values(step.options).some((v) => typeof v !== 'string'),
        )
      )
        throw new Error('流程文件无效');
      change(data);
      setName(key);
      setMessage('');
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function run() {
    const results = [];
    let value = input;
    setBusy(true);
    setReport([]);
    setMessage('');
    try {
      for (const step of steps) {
        try {
          if (value.length > 2_000_000) throw new Error('步骤输入超过 2,000,000 字符。');
          const output = await new Promise<string>((resolve, reject) => {
            const worker = new Worker(new URL('./tool.worker.ts', import.meta.url), { type: 'module' });
            const stop = (error?: string, result = '') => {
              clearTimeout(timer);
              worker.terminate();
              cancel.current = undefined;
              error ? reject(new Error(error)) : resolve(result);
            };
            const timer = setTimeout(() => stop('步骤处理超时。'), 10000);
            cancel.current = () => stop('已取消。');
            worker.onmessage = (event) => stop(event.data.error, event.data.output);
            worker.onerror = () => stop('步骤执行失败。');
            worker.postMessage({ id: step.tool, input: value, options: step.options });
          });
          results.push({ name: label(step.tool), input: value, output });
          value = output;
        } catch (error) {
          results.push({ name: label(step.tool), input: value, output: '', error: String(error) });
          break;
        }
      }
      setReport(results);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="devkit-panel recipe-panel"
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (e.currentTarget.open) refresh();
      }}
    >
      <summary>工具处理流程</summary>
      {open && (
        <fieldset disabled={busy}>
          <div className="recipe-library">
            <label>
              已存流程
              <select value="" onChange={(e) => load(e.target.value)}>
                <option value="">载入流程…</option>
                {names.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="recipe-save">
              <label>
                流程名称
                <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </label>
              <button
                className="secondary-button"
                disabled={!name.trim()}
                onClick={() => {
                  try {
                    localStorage.setItem(prefix + name.trim(), JSON.stringify(steps));
                    refresh();
                    setMessage('已保存步骤和参数');
                  } catch (e) {
                    setMessage(String(e));
                  }
                }}
              >
                保存流程
              </button>
            </div>
          </div>
          {steps.map((step, i) => (
            <section className="recipe-step" key={i} aria-label={`步骤 ${i + 1}`}>
              <header>
                <label>
                  步骤 {i + 1}
                  <select
                    value={step.tool}
                    onChange={(e) =>
                      change(steps.map((s, j) => (i === j ? makeStep(e.target.value as ToolId) : s)))
                    }
                  >
                    {allowed.map((id) => (
                      <option value={id} key={id}>
                        {label(id)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="text-button"
                  aria-label={`移除步骤 ${i + 1}`}
                  disabled={steps.length === 1}
                  onClick={() => change(steps.filter((_, j) => i !== j))}
                >
                  移除此步
                </button>
              </header>
              <ToolOptions
                toolId={step.tool}
                options={step.options}
                busy={busy}
                onChange={(key, value) =>
                  change(
                    steps.map((s, j) => (i === j ? { ...s, options: { ...s.options, [key]: value } } : s)),
                  )
                }
              />
            </section>
          ))}
          <div className="recipe-actions">
            <button
              className="secondary-button"
              disabled={steps.length >= 12}
              onClick={() => change([...steps, makeStep('json-path')])}
            >
              追加步骤
            </button>
            <button className="run-button" onClick={() => void run()}>
              用当前原文运行
            </button>
          </div>
        </fieldset>
      )}
      {busy && <button onClick={() => cancel.current?.()}>取消流程</button>}
      <p role="status">{message}</p>
      {report.map((row, i) => (
        <details key={i}>
          <summary>
            {i + 1}. {row.name} · {row.error ? '失败' : '完成'}
          </summary>
          <p>输入</p>
          <pre>{row.input.slice(0, 8192)}</pre>
          <p>{row.error || '输出'}</p>
          <pre>{row.output.slice(0, 8192)}</pre>
          {!row.error && (
            <button
              onClick={() =>
                void copyText(row.output)
                  .then(() => setMessage('已复制完整结果'))
                  .catch((e) => setMessage(String(e)))
              }
            >
              复制完整输出
            </button>
          )}
        </details>
      ))}
    </details>
  );
}
