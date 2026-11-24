import FloatingDetails from './FloatingDetails';
import { TextInput } from './TextControl';
import { useEffect, useRef, useState } from 'react';
import { defaultOptions, tools, type Options, type ToolId } from './tools';
import { CaseList, validCases, type RegressionCase } from './analysis/Cases';
import ToolOptions from './ToolOptions';
import { MotionDetails, MotionButton } from './Motion';
import { copyText } from './motion-primitives';

const allowed: ToolId[] = [
  'base64',
  'json',
  'json-path',
  'url',
  'unicode',
  'gzip',
  'yaml',
  'json-lines',
  'markdown-table',
  'csv-json',
  'json-csv',
  'text',
];
const previewLimit = 8192;
const previewLength = (text: string) =>
  text.length > previewLimit
    ? `（预览前 ${previewLimit.toLocaleString()} / 共 ${text.length.toLocaleString()} 字符）`
    : '';
const prefix = 'devkit:recipe:';
type Step = { tool: ToolId; options: Options };
const makeStep = (tool: ToolId): Step => ({ tool, options: { ...defaultOptions[tool] } });
const label = (id: ToolId) => tools.find((t) => t.id === id)!.name;

export default function ToolRecipes({ input }: { input: string }) {
  const [open, setOpen] = useState(false);
  const [cases, setCases] = useState<RegressionCase[]>([]);
  const [steps, setSteps] = useState<Step[]>([makeStep('json')]);
  const [name, setName] = useState(''),
    [names, setNames] = useState<string[]>([]);
  const [report, setReport] = useState<{ name: string; input: string; output: string; error?: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const stepList = useRef<HTMLDivElement>(null);
  const interrupted = useRef(false);
  const cancel = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => {
      interrupted.current = true;
      cancel.current?.();
    },
    [],
  );
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
      const saved = JSON.parse(localStorage.getItem(prefix + key) || 'null');
      const data: Step[] = Array.isArray(saved) ? saved : saved?.steps;
      const checks = Array.isArray(saved) ? [] : saved?.cases;
      if (!validCases(checks)) throw Error('流程样例无效');
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
      setCases(checks);
      change(data);
      setName(key);
      setMessage('');
    } catch (error) {
      setMessage(String(error));
    }
  }
  async function run(regression = false) {
    const results = [];
    interrupted.current = false;
    const notices: string[] = [];
    setBusy(true);
    setReport([]);
    setMessage('');
    try {
      for (const [index, test] of (regression ? cases : [{ input, expected: '', step: undefined }]).entries()) {
        if (interrupted.current) break;
        let value = test.input;
        for (const [si, step] of steps.entries()) {
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
            if (!regression) results.push({ name: label(step.tool), input: value, output });
            value = output;
            if (regression && si + 1 === (test.step ?? steps.length)) {
              notices.push(
                '样例 ' +
                  (index + 1) +
                  ' · 步骤 ' +
                  (si + 1) +
                  ' ' +
                  label(step.tool) +
                  (output === test.expected ? ' · 通过' : ' · 失败，实际 ' + JSON.stringify(output.slice(0, 200))),
              );
              break;
            }
          } catch (error) {
            results.push({ name: label(step.tool), input: value, output: '', error: String(error) });
            if (regression)
              notices.push(
                '样例 ' + (index + 1) + ' · 步骤 ' + (si + 1) + ' ' + label(step.tool) + ' · ' + String(error),
              );
            break;
          }
        }
        if (regression && test.step && test.step > steps.length)
          notices.push('样例 ' + (index + 1) + ' 指定的步骤不存在');
      }
      setReport(results);
      setMessage(notices.join('\n'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FloatingDetails
      className="devkit-panel recipe-panel"
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (e.currentTarget.open) refresh();
      }}
    >
      <summary>工具处理流程</summary>
      {busy && (
        <button
          className="secondary-button"
          onClick={() => {
            interrupted.current = true;
            cancel.current?.();
          }}
        >
          取消流程
        </button>
      )}
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
                <TextInput value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </label>
              <button
                className="secondary-button"
                disabled={!name.trim()}
                onClick={() => {
                  try {
                    localStorage.setItem(prefix + name.trim(), JSON.stringify({ version: 2, steps, cases }));
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
          <div className="recipe-actions">
            <button
              className="secondary-button"
              disabled={steps.length >= 12}
              onClick={() => {
                change([...steps, makeStep('json-path')]);
                requestAnimationFrame(() => stepList.current?.lastElementChild?.querySelector('select')?.focus());
              }}
            >
              追加步骤
            </button>
            <button className="run-button" onClick={() => void run()}>
              用当前原文运行
            </button>
          </div>
          <div className="recipe-steps" ref={stepList}>
            {steps.map((step, i) => (
              <section className="recipe-step" key={i} aria-label={`步骤 ${i + 1}`}>
                <header>
                  <label>
                    步骤 {i + 1}
                    <select
                      value={step.tool}
                      onChange={(e) => change(steps.map((s, j) => (i === j ? makeStep(e.target.value as ToolId) : s)))}
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
                    change(steps.map((s, j) => (i === j ? { ...s, options: { ...s.options, [key]: value } } : s)))
                  }
                />
              </section>
            ))}
          </div>
          <FloatingDetails>
            <summary>流程回归样例</summary>
            <button className="secondary-button" disabled={!cases.length} onClick={() => void run(true)}>
              运行全部样例
            </button>
            <CaseList cases={cases} change={setCases} steps={steps.length} />
          </FloatingDetails>
        </fieldset>
      )}
      <pre role="status">{message}</pre>
      {report.map((row, i) => (
        <MotionDetails key={i} className="workbench-disclosure recipe-result">
          <summary>
            {i + 1}. {row.name} · {row.error ? '失败' : '完成'}
          </summary>
          <div className="recipe-result-values disclosure-scroll">
            <figure>
              <figcaption>输入{previewLength(row.input)}</figcaption>
              <pre>{row.input.slice(0, previewLimit)}</pre>
            </figure>
            <figure>
              <figcaption>
                {row.error ? '错误' : '输出'}
                {previewLength(row.output)}
              </figcaption>
              {row.error && <p className="task-error">{row.error}</p>}
              <pre>{row.output.slice(0, previewLimit)}</pre>
            </figure>
          </div>
          {!row.error && (
            <MotionButton
              variant="copy"
              className="secondary-button"
              aria-label="复制完整输出"
              onClick={() =>
                void copyText(row.output)
                  .then(() => setMessage('已复制完整结果'))
                  .catch((e) => setMessage(String(e)))
              }
            >
              复制完整输出
            </MotionButton>
          )}
        </MotionDetails>
      ))}
    </FloatingDetails>
  );
}
