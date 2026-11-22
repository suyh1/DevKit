import { MotionDetails } from './Motion';
import { useEffect, useRef, useState } from 'react';
import type { ApiEnvironment, ApiProject } from '../shared/api-workspace.mjs';
import {
  buildApiRequest,
  validateRequestSchemas,
  responseContract,
  validateResponseSchema,
} from './api-request';
import { sendHttp, cancelHttp } from './http-api';
import { newProjectId } from './project-api';
import { canSendHttp, remoteAccess } from './workspace-remote';
import { jsonTree } from './result-model';
import { saveText } from './files';

type Step = { id: string; status: string; pointer: string; variable: string };
const first = (id: string): Step => ({ id, status: '', pointer: '', variable: '' });
export function responseVariable(body: string, pointer: string) {
  if (pointer && !pointer.startsWith('/')) throw new Error('提取路径需为 JSON Pointer，如 /data/id。');
  let node = jsonTree(body, { length: 2_000_000, nodes: 100_000 });
  for (const segment of pointer.split('/').slice(1)) {
    if (/~(?![01])/.test(segment)) throw new Error('JSON Pointer 的 ~ 需要写为 ~0 或 ~1。');
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    const matches = node.children.filter((child) => child.key === key);
    if (matches.length !== 1) throw new Error('响应字段缺失或重复：' + pointer);
    node = matches[0].node;
  }
  if (node.kind !== 'value' || node.raw === 'null') throw new Error('请选择字符串、数字或布尔值。');
  return node.raw.startsWith('"') ? (JSON.parse(node.raw) as string) : node.raw;
}
export default function ApiRegression({
  project,
  environment,
  sending,
  onBusy,
}: {
  project: ApiProject;
  environment?: ApiEnvironment;
  sending: boolean;
  onBusy: (v: boolean) => void;
}) {
  const storageKey = 'devkit:regression:' + project.id;
  const [steps, setSteps] = useState<Step[]>(() => {
    try {
      const rows = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (
        Array.isArray(rows) &&
        rows.length &&
        rows.length <= 50 &&
        rows.every(
          (row) => row && ['id', 'status', 'pointer', 'variable'].every((k) => typeof row[k] === 'string'),
        )
      )
        return rows;
    } catch {
      /* start with the first endpoint */
    }
    return project.endpoints[0] ? [first(project.endpoints[0].id)] : [];
  });
  const [report, setReport] = useState<string[]>([]),
    [notice, setNotice] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  function change(next: Step[]) {
    setSteps(next);
    setReport([]);
    setNotice('');
  }
  function patch(i: number, value: Partial<Step>) {
    change(steps.map((s, j) => (j === i ? { ...s, ...value } : s)));
  }
  async function run() {
    if (sending || active.current || !canSendHttp()) return;
    const controller = new AbortController();
    active.current = controller;
    onBusy(true);
    setReport([]);
    setNotice('');
    const env: ApiEnvironment = structuredClone(
      environment || { id: 'run', name: '本次运行', baseUrl: project.baseUrl, variables: [] },
    );
    try {
      for (const [i, step] of steps.entries()) {
        const endpoint = project.endpoints.find((e) => e.id === step.id);
        const title = i + 1 + '. ' + (endpoint?.name || '接口已移除');
        try {
          controller.signal.throwIfAborted();
          if (!endpoint) throw new Error('请选择已有接口。');
          if (step.status && !/^[1-5]\d\d$/.test(step.status)) throw new Error('预期状态码无效。');
          if (step.variable && !/^[A-Za-z_]\w*$/.test(step.variable)) throw new Error('变量名无效。');
          if (step.pointer && !step.variable) throw new Error('请填写提取变量名。');
          const request = buildApiRequest(project, endpoint, env, endpoint.timeout);
          const check = await validateRequestSchemas(project, endpoint, env, request.body);
          if (check.state !== 'pass') throw new Error(check.detail);
          controller.signal.throwIfAborted();
          const id = newProjectId();
          const cancel = () => {
            void cancelHttp(id).catch(() => {});
          };
          controller.signal.addEventListener('abort', cancel, { once: true });
          const result = await sendHttp(id, request).finally(() =>
            controller.signal.removeEventListener('abort', cancel),
          );
          controller.signal.throwIfAborted();
          const contract = responseContract(endpoint, result);
          const checks = [...contract.checks];
          if (contract.schema !== null)
            checks.push(
              result.binary
                ? { name: 'JSON Schema', state: 'skip', detail: '二进制响应' }
                : await validateResponseSchema(contract.schema, contract.body),
            );
          if (step.status || !endpoint.responses.length) {
            const ok = step.status
              ? Number(step.status) === result.status
              : result.status >= 200 && result.status < 300;
            checks.push({ name: '预期状态', state: ok ? 'pass' : 'fail', detail: String(result.status) });
          }
          controller.signal.throwIfAborted();
          const summary = checks
            .map((c) => c.name + ' ' + { pass: '通过', fail: '失败', skip: '未验证' }[c.state])
            .join(' · ');
          if (checks.some((c) => c.state === 'fail' || (c.name === 'JSON Schema' && c.state === 'skip')))
            throw new Error(summary);
          if (step.variable)
            env.variables.push({
              key: step.variable,
              value: responseVariable(result.body, step.pointer),
              enabled: true,
            });
          setReport((rows) => [...rows, title + ' · HTTP ' + result.status + ' · ' + summary]);
        } catch (e) {
          setReport((rows) => [
            ...rows,
            title + ' · ' + (controller.signal.aborted ? '已取消' : '失败 · ' + String(e)),
          ]);
          break;
        }
      }
    } finally {
      active.current = null;
      onBusy(false);
    }
  }
  return (
    <MotionDetails className="devkit-panel api-regression">
      <summary>接口集合回归</summary>
      <fieldset disabled={sending}>
        {steps.map((s, i) => (
          <div className="devkit-fields regression-step" key={i}>
            <label>
              步骤 {i + 1}
              <select value={s.id} onChange={(e) => patch(i, { id: e.target.value })}>
                {!project.endpoints.some((e) => e.id === s.id) && <option value={s.id}>接口已移除</option>}
                {project.endpoints.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.method} · {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              预期状态码
              <input
                placeholder="按接口定义"
                value={s.status}
                maxLength={3}
                onChange={(e) => patch(i, { status: e.target.value })}
              />
            </label>
            <label>
              提取响应字段
              <input
                placeholder="/data/id"
                value={s.pointer}
                onChange={(e) => patch(i, { pointer: e.target.value })}
              />
            </label>
            <label>
              存为变量
              <input
                placeholder="projectId"
                value={s.variable}
                onChange={(e) => patch(i, { variable: e.target.value })}
              />
            </label>
            <button className="text-button" onClick={() => change(steps.filter((_, j) => j !== i))}>
              移除步骤
            </button>
          </div>
        ))}
        <div className="regression-actions">
          <button
            className="secondary-button"
            disabled={!project.endpoints.length || steps.length >= 50}
            onClick={() => change([...steps, first(project.endpoints[0].id)])}
          >
            追加接口
          </button>
          <button
            className="secondary-button"
            disabled={!steps.length}
            onClick={() => {
              try {
                localStorage.setItem(storageKey, JSON.stringify(steps));
                setNotice('回归步骤已保存到此设备');
              } catch (e) {
                setNotice(String(e));
              }
            }}
          >
            保存回归步骤
          </button>
          <button
            className="run-button"
            disabled={!steps.length || !canSendHttp() || (!window.devkitHttp && !remoteAccess())}
            onClick={() => void run()}
          >
            依次发送并校验
          </button>
        </div>
      </fieldset>
      {active.current && (
        <button className="secondary-button" onClick={() => active.current?.abort()}>
          停止回归
        </button>
      )}
      <ol aria-live="polite">
        {report.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ol>
      {!!report.length && (
        <button
          className="secondary-button"
          onClick={() =>
            void saveText(report.join('\n'), 'api-regression.txt')
              .then(setNotice)
              .catch((e) => setNotice(String(e)))
          }
        >
          导出运行报告
        </button>
      )}
      <p role="status">{notice}</p>
    </MotionDetails>
  );
}
