import type { ApiEndpoint, ApiProject } from "../shared/api-workspace.mjs";
import ApiSchemaView from "./ApiSchemaView";
import CodeEditor from "./CodeEditor";
export default function ApiDocumentation({
  project,
  endpoint,
}: {
  project: ApiProject;
  endpoint: ApiEndpoint;
}) {
  return (
    <article className="api-documentation">
      <div className="api-doc-heading">
        <span className={`api-method method-${endpoint.method.toLowerCase()}`}>
          {endpoint.method}
        </span>
        <code>{endpoint.path}</code>
      </div>
      <h2>{endpoint.name}</h2>
      <p className="api-prose">{endpoint.description || "暂无接口说明。"}</p>
      <div className="api-doc-facts">
        <div>
          <small>服务地址</small>
          <code>{endpoint.server || project.baseUrl || "尚未设置"}</code>
        </div>
        <div>
          <small>目录</small>
          <strong>{endpoint.group || "未分组"}</strong>
        </div>
        <div>
          <small>鉴权</small>
          <strong>
            {endpoint.auth.type === "none" ? "无鉴权" : endpoint.auth.type}
          </strong>
        </div>
      </div>
      {["path", "query", "header", "cookie"].map((location) => {
        const rows = endpoint.parameters.filter(
          (row) => row.location === location,
        );
        return rows.length ? (
          <section key={location} className="api-section">
            <h3>{location.toUpperCase()} 参数</h3>
            <div className="api-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>类型</th>
                    <th>必填</th>
                    <th>说明</th>
                    <th>示例</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.name}</strong>
                        {!row.enabled && <small>已停用</small>}
                      </td>
                      <td>{row.type}</td>
                      <td>
                        {row.required || row.location === "path" ? "是" : "否"}
                      </td>
                      <td>
                        {row.description || "—"}
                        {row.schema && (
                          <details>
                            <summary>Schema约束</summary>
                            <pre>{row.schema}</pre>
                          </details>
                        )}
                      </td>
                      <td>
                        <code>{row.example || "—"}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null;
      })}
      {endpoint.bodyKind !== "none" && (
        <section className="api-section">
          <h3>请求正文 · {endpoint.bodyKind.toUpperCase()}</h3>
          <div className="api-code-editor">
            <CodeEditor
              label="文档请求示例"
              readOnly
              language={endpoint.bodyKind === "json" ? "json" : "text"}
              value={endpoint.body}
              wrap
            />
          </div>
          {endpoint.requestSchema && (
            <ApiSchemaView value={endpoint.requestSchema} />
          )}{" "}
          {endpoint.requestSchema && (
            <details>
              <summary>请求Schema</summary>
              <div className="api-code-editor">
                <CodeEditor
                  label="文档请求Schema"
                  value={endpoint.requestSchema}
                  language="json"
                  readOnly
                  wrap
                />
              </div>
            </details>
          )}
        </section>
      )}
      <section className="api-section">
        <h3>响应</h3>
        {endpoint.responses.map((row) => (
          <section className="api-doc-response" key={row.id}>
            <h4>
              <span className="api-status">{row.status}</span>
              {row.description}
            </h4>
            <small>{row.contentType || "未限定Content-Type"}</small>
            <div className="api-schema-grid">
              {row.schema && (
                <div>
                  <h4>JSON Schema</h4>
                  <ApiSchemaView value={row.schema} />
                  <details>
                    <summary>原始Schema</summary>
                    <div className="api-code-editor">
                      <CodeEditor
                        label={`文档${row.status}响应Schema`}
                        value={row.schema}
                        readOnly
                        language="json"
                        wrap
                      />
                    </div>
                  </details>
                </div>
              )}
              {row.example && (
                <div>
                  <h4>示例</h4>
                  <div className="api-code-editor">
                    <CodeEditor
                      label={`文档${row.status}响应示例`}
                      value={row.example}
                      readOnly
                      language="json"
                      wrap
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        ))}
        {!endpoint.responses.length && <p>暂无响应定义。</p>}
      </section>
    </article>
  );
}
