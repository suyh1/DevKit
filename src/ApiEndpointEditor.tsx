import { newProjectId } from './project-api';
import { Plus, Trash2 } from "lucide-react";
import CodeEditor from "./CodeEditor";
import { API_METHODS, parseApiSchema } from "../shared/api-workspace.mjs";
import type { ApiEndpoint, ApiParameter } from "../shared/api-workspace.mjs";
import { schemaFromExample } from "./api-request";

const uid = () => newProjectId();
export function ApiParameters({
  rows,
  onChange,
  valuesOnly = false,
}: {
  rows: ApiParameter[];
  onChange: (rows: ApiParameter[]) => void;
  valuesOnly?: boolean;
}) {
  const patch = (id: string, change: Partial<ApiParameter>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  return (
    <div className="api-parameters">
      <div className="api-table-scroll">
        <table aria-label={valuesOnly ? "调试参数" : "接口参数定义"}>
          <thead>
            <tr>
              <th>启用</th>
              <th>位置 / 参数</th>
              {!valuesOnly && (
                <>
                  <th>类型</th>
                  <th>必填</th>
                  <th>说明</th>
                </>
              )}
              <th>{valuesOnly ? "本次请求值" : "示例 / 默认调试值"}</th>
              {!valuesOnly && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`参数${index + 1}启用`}
                    checked={row.enabled}
                    onChange={(event) =>
                      patch(row.id, { enabled: event.target.checked })
                    }
                  />
                </td>
                <td>
                  {valuesOnly ? (
                    <>
                      <small>{row.location}</small>
                      <strong>
                        {row.name}
                        {row.required ? " *" : ""}
                      </strong>
                    </>
                  ) : (
                    <div className="api-parameter-name">
                      <select
                        aria-label={`参数${index + 1}位置`}
                        value={row.location}
                        onChange={(event) =>
                          patch(row.id, {
                            location: event.target
                              .value as ApiParameter["location"],
                            required:
                              event.target.value === "path" || row.required,
                          })
                        }
                      >
                        {["query", "path", "header", "cookie"].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                      <input
                        aria-label={`参数${index + 1}名称`}
                        value={row.name}
                        onChange={(event) =>
                          patch(row.id, { name: event.target.value })
                        }
                      />
                      <details className="api-parameter-schema">
                        <summary>约束Schema</summary>
                        <textarea
                          aria-label={`参数${index + 1}Schema`}
                          rows={4}
                          value={row.schema}
                          onChange={(event) =>
                            patch(row.id, { schema: event.target.value })
                          }
                          placeholder='{"minLength":1}'
                        />
                      </details>
                    </div>
                  )}
                </td>
                {!valuesOnly && (
                  <>
                    <td>
                      <select
                        aria-label={`参数${index + 1}类型`}
                        value={row.type}
                        onChange={(event) =>
                          patch(row.id, {
                            type: event.target.value as ApiParameter["type"],
                          })
                        }
                      >
                        {[
                          "string",
                          "integer",
                          "number",
                          "boolean",
                          "array",
                          "object",
                        ].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`参数${index + 1}必填`}
                        checked={row.required}
                        onChange={(event) =>
                          patch(row.id, { required: event.target.checked })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`参数${index + 1}说明`}
                        value={row.description}
                        onChange={(event) =>
                          patch(row.id, { description: event.target.value })
                        }
                      />
                    </td>
                  </>
                )}
                <td>
                  <input
                    aria-label={`参数${index + 1}示例`}
                    value={row.example}
                    onChange={(event) =>
                      patch(row.id, { example: event.target.value })
                    }
                    placeholder={
                      row.type === "string"
                        ? "支持 {{变量}}"
                        : "JSON值或 {{变量}}"
                    }
                  />
                </td>
                {!valuesOnly && (
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`删除接口参数${index + 1}`}
                      onClick={() =>
                        onChange(rows.filter((item) => item.id !== row.id))
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="api-empty-note">尚未定义参数。</p>}
      {!valuesOnly && (
        <button
          className="text-button"
          onClick={() =>
            onChange([
              ...rows,
              {
                id: uid(),
                name: "",
                location: "query",
                type: "string",
                required: false,
                enabled: true,
                description: "",
                example: "",
                schema: "",
              },
            ])
          }
        >
          <Plus size={14} />
          添加参数
        </button>
      )}
    </div>
  );
}
export function ApiAuthEditor({
  endpoint,
  onChange,
}: {
  endpoint: ApiEndpoint;
  onChange: (value: ApiEndpoint) => void;
}) {
  const auth = endpoint.auth,
    patch = (change: Partial<typeof auth>) =>
      onChange({ ...endpoint, auth: { ...auth, ...change } });
  return (
    <section className="api-section">
      <h3>鉴权</h3>
      <div className="api-form-grid">
        <label>
          鉴权方式
          <select
            aria-label="API鉴权方式"
            value={auth.type}
            onChange={(event) =>
              patch({ type: event.target.value as typeof auth.type })
            }
          >
            <option value="none">无鉴权</option>
            <option value="bearer">Bearer Token</option>
            <option value="basic">Basic Auth</option>
            <option value="apiKey">API Key</option>
          </select>
        </label>
        {auth.type === "bearer" && (
          <label>
            Token
            <input
              aria-label="API Bearer Token"
              value={auth.token}
              onChange={(event) => patch({ token: event.target.value })}
              placeholder="{{token}}"
            />
          </label>
        )}
        {auth.type === "basic" && (
          <>
            <label>
              用户名
              <input
                aria-label="API Basic 用户名"
                value={auth.username}
                onChange={(event) => patch({ username: event.target.value })}
              />
            </label>
            <label>
              密码
              <input
                aria-label="API Basic 密码"
                type="password"
                value={auth.password}
                onChange={(event) => patch({ password: event.target.value })}
              />
            </label>
          </>
        )}
        {auth.type === "apiKey" && (
          <>
            <label>
              位置
              <select
                value={auth.location}
                onChange={(event) =>
                  patch({ location: event.target.value as "header" | "query" })
                }
              >
                <option value="header">Header</option>
                <option value="query">Query</option>
              </select>
            </label>
            <label>
              键名
              <input
                aria-label="API Key 名称"
                value={auth.key}
                onChange={(event) => patch({ key: event.target.value })}
              />
            </label>
            <label>
              值
              <input
                aria-label="API Key 值"
                value={auth.value}
                onChange={(event) => patch({ value: event.target.value })}
              />
            </label>
          </>
        )}
      </div>
      <p className="api-empty-note">
        使用环境变量引用凭据，例如 {"{{token}}"}
        ；保存项目会将定义和环境变量以明文保存在项目所在的主机。
      </p>
    </section>
  );
}
export function ApiBodyEditor({
  endpoint,
  onChange,
}: {
  endpoint: ApiEndpoint;
  onChange: (value: ApiEndpoint) => void;
}) {
  return (
    <section className="api-section">
      <div className="api-section-heading">
        <h3>请求正文</h3>
        <select
          aria-label="API正文类型"
          value={endpoint.bodyKind}
          onChange={(event) =>
            onChange({
              ...endpoint,
              bodyKind: event.target.value as ApiEndpoint["bodyKind"],
            })
          }
        >
          <option value="none">无正文</option>
          <option value="json">JSON</option>
          <option value="text">纯文本</option>
          <option value="form">URL Encoded</option>
        </select>
      </div>
      {endpoint.bodyKind !== "none" && (
        <div className="api-code-editor">
          <CodeEditor
            label="API请求正文"
            value={endpoint.body}
            language={endpoint.bodyKind === "json" ? "json" : "text"}
            onChange={(body) => onChange({ ...endpoint, body })}
            wrap
          />
        </div>
      )}
    </section>
  );
}
export default function ApiEndpointEditor({
  endpoint,
  groups,
  onChange,
  onError,
}: {
  endpoint: ApiEndpoint;
  groups: string[];
  onChange: (value: ApiEndpoint) => void;
  onError: (message: string) => void;
}) {
  const patch = (change: Partial<ApiEndpoint>) =>
    onChange({ ...endpoint, ...change });
  return (
    <div className="api-definition">
      <section className="api-section">
        <h3>基本信息</h3>
        <div className="api-form-grid">
          <label>
            接口名称
            <input
              aria-label="API接口名称"
              maxLength={100}
              value={endpoint.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label>
            目录
            <select
              aria-label="API接口目录"
              value={endpoint.group}
              onChange={(event) => patch({ group: event.target.value })}
            >
              <option value="">未分组</option>
              {groups.map((group) => (
                <option key={group}>{group}</option>
              ))}
            </select>
          </label>
          <label>
            HTTP方法
            <select
              aria-label="API接口方法"
              value={endpoint.method}
              onChange={(event) => patch({ method: event.target.value })}
            >
              {API_METHODS.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            接口路径
            <input
              aria-label="API接口路径"
              value={endpoint.path}
              onChange={(event) => patch({ path: event.target.value })}
              placeholder="/users/{id}"
            />
          </label>
          <label className="api-wide">
            接口说明
            <textarea
              aria-label="API接口说明"
              rows={3}
              value={endpoint.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </label>
          <label className="api-wide">
            独立服务地址（留空使用项目/环境）
            <input
              aria-label="API独立服务地址"
              value={endpoint.server}
              onChange={(event) => patch({ server: event.target.value })}
              placeholder="http://127.0.0.1:8080 或 {{serviceUrl}}"
            />
          </label>
        </div>
      </section>
      <section className="api-section">
        <h3>路径、Query、Header与Cookie参数</h3>
        <ApiParameters
          rows={endpoint.parameters}
          onChange={(parameters) => patch({ parameters })}
        />
      </section>
      <ApiAuthEditor endpoint={endpoint} onChange={onChange} />
      <ApiBodyEditor endpoint={endpoint} onChange={onChange} />
      {endpoint.bodyKind !== "none" && (
        <section className="api-section">
          <div className="api-section-heading">
            <h3>请求正文 Schema</h3>
            <button
              className="text-button"
              onClick={() => {
                try {
                  patch({
                    requestSchema: JSON.stringify(
                      schemaFromExample(JSON.parse(endpoint.body)),
                      null,
                      2,
                    ),
                  });
                } catch (error) {
                  onError(String(error));
                }
              }}
            >
              从正文生成结构
            </button>
          </div>
          <div className="api-code-editor">
            <CodeEditor
              label="API请求Schema"
              value={endpoint.requestSchema}
              language="json"
              onChange={(requestSchema) => patch({ requestSchema })}
              wrap
            />
          </div>
        </section>
      )}
      <section className="api-section">
        <div className="api-section-heading">
          <h3>响应定义</h3>
          <button
            className="text-button"
            onClick={() =>
              patch({
                responses: [
                  ...endpoint.responses,
                  {
                    id: uid(),
                    status: "201",
                    description: "成功",
                    contentType: "application/json",
                    schema: "",
                    example: "",
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            添加响应定义
          </button>
        </div>
        {endpoint.responses.map((row, index) => (
          <article className="api-response-definition" key={row.id}>
            <div className="api-form-grid">
              <label>
                状态码
                <input
                  aria-label={`响应${index + 1}状态码`}
                  value={row.status}
                  onChange={(event) =>
                    patch({
                      responses: endpoint.responses.map((item) =>
                        item.id === row.id
                          ? { ...item, status: event.target.value }
                          : item,
                      ),
                    })
                  }
                  placeholder="200 / 2XX / default"
                />
              </label>
              <label>
                说明
                <input
                  aria-label={`响应${index + 1}说明`}
                  value={row.description}
                  onChange={(event) =>
                    patch({
                      responses: endpoint.responses.map((item) =>
                        item.id === row.id
                          ? { ...item, description: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <label>
                Content-Type
                <input
                  aria-label={`响应${index + 1}类型`}
                  value={row.contentType}
                  onChange={(event) =>
                    patch({
                      responses: endpoint.responses.map((item) =>
                        item.id === row.id
                          ? { ...item, contentType: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <button
                className="text-button api-danger"
                aria-label={`删除响应定义${index + 1}`}
                onClick={() =>
                  patch({
                    responses: endpoint.responses.filter(
                      (item) => item.id !== row.id,
                    ),
                  })
                }
              >
                <Trash2 size={14} />
                删除响应
              </button>
            </div>
            <div className="api-schema-grid">
              <div>
                <div className="api-section-heading">
                  <h4>JSON Schema</h4>
                  <button
                    className="text-button"
                    onClick={() => {
                      try {
                        patch({
                          responses: endpoint.responses.map((item) =>
                            item.id === row.id
                              ? {
                                  ...item,
                                  schema: JSON.stringify(
                                    schemaFromExample(JSON.parse(row.example)),
                                    null,
                                    2,
                                  ),
                                }
                              : item,
                          ),
                        });
                      } catch (error) {
                        onError(String(error));
                      }
                    }}
                  >
                    由示例生成结构
                  </button>
                </div>
                <div className="api-code-editor">
                  <CodeEditor
                    label={`响应${index + 1}Schema`}
                    value={row.schema}
                    language="json"
                    onChange={(schema) =>
                      patch({
                        responses: endpoint.responses.map((item) =>
                          item.id === row.id ? { ...item, schema } : item,
                        ),
                      })
                    }
                    wrap
                  />
                </div>
              </div>
              <div>
                <h4>响应示例</h4>
                <div className="api-code-editor">
                  <CodeEditor
                    label={`响应${index + 1}示例`}
                    value={row.example}
                    language="json"
                    onChange={(example) =>
                      patch({
                        responses: endpoint.responses.map((item) =>
                          item.id === row.id ? { ...item, example } : item,
                        ),
                      })
                    }
                    wrap
                  />
                </div>
              </div>
            </div>
            {(() => {
              try {
                parseApiSchema(row.schema);
                return null;
              } catch (error) {
                return (
                  <p className="api-error" role="status">
                    {String(error)}
                  </p>
                );
              }
            })()}
          </article>
        ))}
        {!endpoint.responses.length && (
          <p className="api-empty-note">
            未定义响应时，调试不会把状态和Schema校验标记为通过。
          </p>
        )}
      </section>
    </div>
  );
}
