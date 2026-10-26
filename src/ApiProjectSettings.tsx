import { newProjectId } from './project-api';
import type { ApiProject } from "../shared/api-workspace.mjs";
import { Plus, Trash2 } from "lucide-react";
import { Modal, ModalCancel } from "./project-components";
import HttpKeyValues from "./HttpKeyValues";

export default function ApiProjectSettings({
  draft,
  onChange,
  onSave,
  onClose,
  busy,
  error,
}: {
  draft: ApiProject;
  onChange: (project: ApiProject) => void;
  onSave: () => void;
  onClose: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <Modal
      title="API项目设置"
      closeLabel="关闭API项目设置"
      close={onClose}
      draft={draft}
      busy={busy}
      wide
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
        className="api-settings"
      >
        <div className="api-form-grid">
          <label>
            项目名称
            <input
              aria-label="API项目名称"
              required
              maxLength={100}
              value={draft.name}
              onChange={(event) =>
                onChange({ ...draft, name: event.target.value })
              }
            />
          </label>
          <label>
            默认服务地址
            <input
              aria-label="API默认服务地址"
              value={draft.baseUrl}
              onChange={(event) =>
                onChange({ ...draft, baseUrl: event.target.value })
              }
              placeholder="http://127.0.0.1:8080"
            />
          </label>
          <label>
            文档版本
            <input
              aria-label="API文档版本"
              value={draft.version}
              onChange={(event) =>
                onChange({ ...draft, version: event.target.value })
              }
            />
          </label>
          <label className="api-wide">
            项目说明
            <textarea
              aria-label="API项目说明"
              rows={3}
              value={draft.description}
              onChange={(event) =>
                onChange({ ...draft, description: event.target.value })
              }
            />
          </label>
        </div>
        <section className="api-section">
          <div className="api-section-heading">
            <h3>接口目录</h3>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                onChange({
                  ...draft,
                  groups: [...draft.groups, `新目录${draft.groups.length + 1}`],
                })
              }
            >
              <Plus size={14} />
              添加目录
            </button>
          </div>
          {draft.groups.map((name, index) => (
            <div className="api-settings-row" key={index}>
              <input
                aria-label={`目录${index + 1}名称`}
                value={name}
                onChange={(event) =>
                  onChange({
                    ...draft,
                    groups: draft.groups.map((item, i) =>
                      i === index ? event.target.value : item,
                    ),
                    endpoints: draft.endpoints.map((item) =>
                      item.group === name
                        ? { ...item, group: event.target.value }
                        : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="icon-button"
                aria-label={`移除目录${index + 1}`}
                title="移除目录，接口移到未分组"
                onClick={() =>
                  onChange({
                    ...draft,
                    groups: draft.groups.filter((_, i) => i !== index),
                    endpoints: draft.endpoints.map((item) =>
                      item.group === name ? { ...item, group: "" } : item,
                    ),
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <p className="api-empty-note">
            目录名可使用 / 组织层级。移除目录会将接口移到未分组。
          </p>
        </section>
        <section className="api-section">
          <div className="api-section-heading">
            <h3>环境与变量</h3>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                onChange({
                  ...draft,
                  environments: [
                    ...draft.environments,
                    {
                      id: newProjectId(),
                      name: `环境${draft.environments.length + 1}`,
                      baseUrl: "",
                      variables: [],
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              添加环境
            </button>
          </div>
          {draft.environments.map((env, index) => (
            <section className="api-environment-card" key={env.id}>
              <div className="api-form-grid">
                <label>
                  环境名称
                  <input
                    aria-label={`环境${index + 1}名称`}
                    value={env.name}
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        environments: draft.environments.map((item) =>
                          item.id === env.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  服务地址
                  <input
                    aria-label={`环境${index + 1}服务地址`}
                    value={env.baseUrl}
                    placeholder="留空使用项目默认地址"
                    onChange={(event) =>
                      onChange({
                        ...draft,
                        environments: draft.environments.map((item) =>
                          item.id === env.id
                            ? { ...item, baseUrl: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <HttpKeyValues
                label={`环境${index + 1}变量`}
                rows={env.variables.map((row) => ({
                  key: row.key,
                  value: row.value,
                  enabled: row.enabled,
                }))}
                disabled={busy}
                onChange={(variables) =>
                  onChange({
                    ...draft,
                    environments: draft.environments.map((item) =>
                      item.id === env.id ? { ...item, variables } : item,
                    ),
                  })
                }
              />
              <button
                type="button"
                className="text-button api-danger"
                onClick={() =>
                  onChange({
                    ...draft,
                    environments: draft.environments.filter(
                      (item) => item.id !== env.id,
                    ),
                  })
                }
              >
                <Trash2 size={14} />
                移除此环境
              </button>
            </section>
          ))}
          {!draft.environments.length && (
            <p className="api-empty-note">
              未配置环境时使用默认服务地址。新增环境后，参数、鉴权和正文可引用{" "}
              {"{{变量名}}"}。
            </p>
          )}
          <p className="api-empty-note">
            环境和鉴权值以明文保存在本机；导出OpenAPI不会带出环境变量与鉴权凭据，原生项目备份会完整包含。
          </p>
        </section>
        {error && (
          <p className="api-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <ModalCancel />
          <button className="run-button" disabled={busy} type="submit">
            保存API项目
          </button>
        </footer>
      </form>
    </Modal>
  );
}
