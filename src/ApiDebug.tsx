import { canSendHttp, canWriteWorkspace, remoteAccess } from './workspace-remote';
import { newProjectId } from './project-api';
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Send,
  Square,
  Copy,
  Download,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import type {
  ApiEndpoint,
  ApiProject,
  ApiEnvironment,
} from "../shared/api-workspace.mjs";
import type { HttpResponse } from "./http-model";
import {
  buildApiRequest,
  responseContract,
  validateResponseSchema,
  validateRequestSchemas,
  schemaFromExample,
} from "./api-request";
import type { ApiCheck } from "./api-request";
import {
  ApiParameters,
  ApiAuthEditor,
  ApiBodyEditor,
} from "./ApiEndpointEditor";
import { sendHttp, cancelHttp } from "./http-api";
import CodeEditor from "./CodeEditor";
import { formatJson } from "./tools";
import { saveText } from "./files";
import { copyText } from "./motion-primitives";

export type ApiHistory = {
  id: string;
  projectId: string;
  endpoint: ApiEndpoint;
  environmentId: string;
  status: string;
  time: string;
  url: string;
};
export default function ApiDebug({
  project,
  endpoint,
  environment,
  onChange,
  onBusy,
  onHistory,
  onGenerate,
  onNotice,
}: {
  project: ApiProject;
  endpoint: ApiEndpoint;
  environment?: ApiEnvironment;
  onChange: (endpoint: ApiEndpoint) => void;
  onBusy: (value: boolean) => void;
  onHistory: (row: ApiHistory) => void;
  onGenerate: (config: string) => void;
  onNotice: (text: string) => void;
}) {
  const timeout = endpoint.timeout;
  const [running, setRunning] = useState(false),
    [response, setResponse] = useState<HttpResponse | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState<"body" | "headers" | "checks">("body"),
    [checks, setChecks] = useState<ApiCheck[]>([]),
    [validating, setValidating] = useState(false),
    [pretty, setPretty] = useState(true),
    [headerFilter, setHeaderFilter] = useState("");
  const live = useRef(""),
    mounted = useRef(true),
    sent = useRef(""),
    generation = useRef(0);
  const signature = JSON.stringify({
    endpoint,
    environment,
    baseUrl: project.baseUrl,
  });
  const request = useMemo(() => {
    try {
      return {
        value: buildApiRequest(project, endpoint, environment, timeout),
        error: "",
      };
    } catch (error) {
      return { value: null, error: String(error) };
    }
  }, [project, endpoint, environment, timeout]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      if (live.current) void cancelHttp(live.current);
    };
  }, []);
  async function check(result: HttpResponse, definition: ApiEndpoint) {
    const serial = ++generation.current;
    const contract = responseContract(definition, result);
    setChecks(contract.checks);
    if (contract.schema !== null) {
      setValidating(true);
      const next = result.binary
        ? {
            name: "JSON Schema",
            state: "skip" as const,
            detail: "二进制正文不进行JSON Schema校验。",
          }
        : await validateResponseSchema(contract.schema, contract.body);
      if (mounted.current && serial === generation.current) {
        setChecks([...contract.checks, next]);
        setValidating(false);
      }
    } else
      setChecks([
        ...contract.checks,
        {
          name: "JSON Schema",
          state: "skip",
          detail: "没有匹配的Schema定义，未进行结构校验。",
        },
      ]);
  }
  async function send() {
    if (live.current || !request.value) return;
    const input = request.value,
      snapshot = structuredClone(endpoint),
      id = newProjectId();
    live.current = id;
    setRunning(true);
    onBusy(true);
    setError("");
    setResponse(null);
    setChecks([]);
    setValidating(false);
    generation.current++;
    sent.current = signature;
    try {
      {
        const validation = await validateRequestSchemas(
          project,
          snapshot,
          environment,
          input.body,
        );
        if (live.current !== id) return;
        if (validation.state !== "pass")
          throw new Error(`请求未通过Schema校验：${validation.detail}`);
      }
      if (live.current !== id) return;
      const result = await sendHttp(id, input);
      if (!mounted.current || live.current !== id) return;
      setResponse(result);
      setTab("body");
      onHistory({
        id,
        projectId: project.id,
        endpoint: snapshot,
        environmentId: environment?.id || "",
        status: String(result.status),
        time: new Date().toLocaleTimeString(),
        url: input.url,
      });
      void check(result, snapshot);
    } catch (error) {
      if (mounted.current && live.current === id) {
        setError(String(error));
        onHistory({
          id,
          projectId: project.id,
          endpoint: snapshot,
          environmentId: environment?.id || "",
          status: "失败 / 取消",
          time: new Date().toLocaleTimeString(),
          url: input.url,
        });
      }
    } finally {
      if (live.current === id) {
        live.current = "";
        if (mounted.current) {
          setRunning(false);
          onBusy(false);
        }
      }
    }
  }
  async function cancel() {
    const id = live.current;
    if (!id) return;
    await cancelHttp(id).catch((error) => setError(String(error)));
    live.current = "";
    generation.current++;
    setRunning(false);
    onBusy(false);
    setError("请求已取消。");
  }
  let body = response?.body || "";
  if (response && !response.binary && pretty && body.length <= 1_000_000)
    try {
      body = formatJson(body, { indent: "2" });
    } catch {
      /* retain raw text */
    }
  const headers =
    response?.headers.filter((row) =>
      row.join(": ").toLowerCase().includes(headerFilter.toLowerCase()),
    ) || [];
  return (
    <div className="api-debug">
      <div className="api-request-bar">
        <span className={`api-method method-${endpoint.method.toLowerCase()}`}>
          {endpoint.method}
        </span>
        <code>{request.value?.url || endpoint.path}</code>
        <label>
          超时
          <input
            aria-label="API请求超时"
            type="number"
            min={100}
            max={120000}
            value={timeout}
            disabled={running}
            onChange={(event) =>
              onChange({ ...endpoint, timeout: Number(event.target.value) })
            }
          />
        </label>
        <button
          className="run-button"
          disabled={!running && (!request.value || !canSendHttp() || (!window.devkitHttp && !remoteAccess()))}
          onClick={() => void (running ? cancel() : send())}
        >
          {running ? <Square size={14} /> : <Send size={14} />}{" "}
          {running ? "取消API请求" : "发送API请求"}
        </button>
      </div>
      {!canSendHttp() && <p className="preview-note">当前可查看与填写本地请求草稿，未授予从主机发送请求的权限。</p>}
      {request.error && (
        <p className="api-error" role="status">
          {request.error}
        </p>
      )}
      {error && (
        <p className="api-error" role="alert">
          {error}
        </p>
      )}
      <fieldset className="api-debug-inputs" disabled={running}>
        <section className="api-section">
          <h3>请求参数</h3>
          <ApiParameters
            rows={endpoint.parameters}
            valuesOnly
            onChange={(parameters) => onChange({ ...endpoint, parameters })}
          />
        </section>
        <ApiAuthEditor endpoint={endpoint} onChange={onChange} />
        <ApiBodyEditor endpoint={endpoint} onChange={onChange} />
      </fieldset>
      <details className="api-section">
        <summary>查看最终请求配置</summary>
        {request.value && (
          <>
            <div className="api-code-editor">
              <CodeEditor
                label="API最终请求配置"
                value={JSON.stringify(request.value, null, 2)}
                language="json"
                readOnly
                wrap
              />
            </div>
            <button
              className="text-button"
              onClick={() => {
                const { timeout: _timeout, ...config } = request.value!;
                onGenerate(JSON.stringify(config, null, 2));
              }}
            >
              生成请求代码
            </button>
          </>
        )}
      </details>
      {running && (
        <p role="status">正在发送请求；取消和超时将终止连接、读取或解压。</p>
      )}
      {!response && !running && (
        <div className="api-response-empty">
          <Send size={23} />
          <h3>响应将在这里展示</h3>
          <p>
            发送后查看正文、响应头及接口契约校验。只有点击发送才访问目标服务。
          </p>
        </div>
      )}
      {response && (
        <section className="api-section api-live-response">
          <div className="api-section-heading">
            <strong
              className={response.status < 400 ? "success-text" : "api-danger"}
            >
              {response.status} {response.statusText}
            </strong>
            <span>
              {response.elapsed} ms · {response.bytes.toLocaleString()} 字节
              {response.status >= 300 && response.status < 400
                ? " · 未跟随重定向"
                : ""}
            </span>
            <div className="api-actions">
              <button
                className="text-button"
                onClick={() =>
                  void copyText(
                    tab === "headers"
                      ? headers.map((row) => row.join(": ")).join("\n")
                      : body,
                  )
                    .then(() => onNotice("已复制响应。"))
                    .catch((error) => setError(String(error)))
                }
              >
                <Copy size={14} />
                复制
              </button>
              <button
                className="text-button"
                onClick={() =>
                  void saveText(
                    tab === "headers"
                      ? headers.map((row) => row.join(": ")).join("\n")
                      : body,
                    tab === "headers"
                      ? "api-headers.txt"
                      : response.binary
                        ? "api-response.base64.txt"
                        : "api-response.txt",
                  ).catch((error) => setError(String(error)))
                }
              >
                <Download size={14} />
                导出
              </button>
            </div>
          </div>
          {signature !== sent.current && (
            <p className="stale-banner">
              定义或环境已修改，此处仍是上次发送的响应；校验采用发送时的定义。
            </p>
          )}
          <div className="api-tabs" role="tablist" aria-label="API响应区域">
            {[
              ["body", "响应正文"],
              ["headers", `响应头 ${response.headers.length}`],
              [
                "checks",
                `校验 ${checks.filter((row) => row.state === "pass").length}/${checks.length}`,
              ],
            ].map(([id, name]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id as typeof tab)}
              >
                {name}
              </button>
            ))}
          </div>
          {tab === "body" && (
            <>
              <div className="api-section-heading">
                <div className="api-actions">
                  <button
                    className="text-button"
                    aria-pressed={pretty}
                    onClick={() => setPretty(true)}
                  >
                    格式化
                  </button>
                  <button
                    className="text-button"
                    aria-pressed={!pretty}
                    onClick={() => setPretty(false)}
                  >
                    原始正文
                  </button>
                </div>
                <button
                  className="text-button"
                  disabled={response.binary || !canWriteWorkspace('http')}
                  onClick={() => {
                    try {
                      const data = JSON.parse(response.body),
                        status = String(response.status),
                        current = endpoint.responses.find(
                          (row) => row.status === status,
                        );
                      const row = {
                        id: current?.id || newProjectId(),
                        status,
                        description:
                          current?.description || response.statusText,
                        contentType:
                          response.headers
                            .find(
                              ([key]) => key.toLowerCase() === "content-type",
                            )?.[1]
                            .split(";")[0] || "application/json",
                        schema:
                          current?.schema ||
                          JSON.stringify(schemaFromExample(data), null, 2),
                        example: response.body,
                      };
                      onChange({
                        ...endpoint,
                        responses: current
                          ? endpoint.responses.map((item) =>
                              item.id === current.id ? row : item,
                            )
                          : [...endpoint.responses, row],
                      });
                      onNotice("已填入响应定义草稿，保存接口后写入文档。");
                    } catch (error) {
                      setError(`响应不是JSON，无法生成结构：${error}`);
                    }
                  }}
                >
                  采用为响应示例
                </button>
              </div>
              {response.binary && (
                <p className="api-empty-note">二进制正文以Base64展示。</p>
              )}
              <div className="api-response-code">
                <CodeEditor
                  label="API响应正文"
                  value={body}
                  language="json"
                  readOnly
                  wrap
                />
              </div>
            </>
          )}
          {tab === "headers" && (
            <>
              <input
                aria-label="API筛选响应头"
                placeholder="筛选名称或值"
                value={headerFilter}
                onChange={(event) => setHeaderFilter(event.target.value)}
              />
              <div className="api-table-scroll">
                <table aria-label="API响应头">
                  <tbody>
                    {headers.map(([name, value], index) => (
                      <tr key={index}>
                        <th>{name}</th>
                        <td>
                          <code>{value}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {tab === "checks" && (
            <>
              <p className="api-empty-note">
                验证状态码、Content-Type及JSON
                Schema；缺少规则、超时和无法校验均不会算作通过。
              </p>
              {validating && <p role="status">正在本地校验Schema…</p>}
              <ul className="api-checks">
                {checks.map((row, index) => (
                  <li key={index} data-result={row.state}>
                    {row.state === "pass" ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <AlertCircle size={17} />
                    )}
                    <div>
                      <strong>
                        {row.name} ·{" "}
                        {row.state === "pass"
                          ? "通过"
                          : row.state === "fail"
                            ? "失败"
                            : "未验证"}
                      </strong>
                      <pre>{row.detail}</pre>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
