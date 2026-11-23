import { scenarioRules, validField, type FieldHint, type Rule } from '../shared/mock-request.mjs';
import { resolveSchemaObject } from '../shared/mock-schema.mjs';
import MockScenarioRules from './MockScenarioRules';
import MockDatasetEditor, { orderDataset, type Dataset } from './MockDatasetEditor';
import { TextInput } from './TextControl';
import type { ApiEndpoint } from '../shared/api-workspace.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { collab, useLive, useCollabList, useOperation, type PageProps } from './collab-api';
import {
  Braces,
  ListTree,
  Plus,
  Search,
  Radio,
  Save,
  Copy,
  KeyRound,
  History,
  FileInput,
  CircleDot,
} from 'lucide-react';
import MockResponseEditor, { defaultGeneration, type ResponseBody } from './MockResponseEditor';
import { copyText } from './motion-primitives';
import { useBeforeUnload, useConfirmation } from './Confirmation';
import { useWorkspaceResource, openWorkspaceLink } from './workspace-links';
import { apiLibrary } from './api-library';
import { CreateRelated, useRelatedCreation, useWorkspaceGuard } from './related-workspaces';

type Scenario = ResponseBody & {
  name: string;
  status: number;
  delay: number;
  rules?: Rule[];
  queryKey?: string;
  queryValue?: string;
};
type Route = {
  id?: string;
  revision?: number;
  key?: string;
  name: string;
  path: string;
  method: string;
  published: boolean;
  cors: boolean;
  active: number;
  scenarios: Scenario[];
  fields?: FieldHint[];
  project?: string;
  projectKey?: string;
  dataset?: Dataset;
  size?: number;
};
type Summary = Route & { id: string; scenario: string };
type Log = {
  at: number;
  scenario: string;
  method: string;
  status: number;
  delay: number;
  elapsed?: number;
  path?: string;
  reason?: string;
  headers?: Record<string, string>;
  body?: string;
  omitted?: boolean;
  replayable?: boolean;
};
const verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const sample = (): Route => ({
  name: '',
  path: '/orders',
  method: 'GET',
  published: false,
  cors: false,
  active: 0,
  scenarios: [
    { name: '成功', status: 200, delay: 0, ...defaultGeneration, body: '{\n  "items": [{"id": 1}]\n}' },
    { name: '空数据', status: 200, delay: 0, format: 'json', body: '{"items":[]}' },
    { name: '服务异常', status: 503, delay: 800, format: 'json', body: '{"error":"temporarily unavailable"}' },
  ],
});
function mockTemplate(projectName: string, endpoint: ApiEndpoint): Route {
  const next: Route = {
    ...sample(),
    project: projectName,
    name: projectName + ' / ' + endpoint.name,
    method: endpoint.method,
    path: endpoint.path.split('?')[0],
  };
  const fields: FieldHint[] = [];
  for (const { location, name } of endpoint.parameters) {
    if (fields.length < 80 && location !== 'cookie' && validField(location, name))
      fields.push({ source: location, key: name });
  }
  try {
    const root = JSON.parse(endpoint.requestSchema || '{}');
    let visited = 0;
    function collect(properties: unknown, prefix: string, depth: number) {
      if (!properties || typeof properties !== 'object' || depth > 8) return;
      for (const [name, child] of Object.entries(properties)) {
        if (fields.length >= 80 || ++visited > 512) return;
        const key = prefix + name;
        const nested = resolveSchemaObject(root, child)?.properties;
        if (nested) collect(nested, key + '.', depth + 1);
        else if (validField('body', key)) fields.push({ source: 'body', key });
      }
    }
    collect(resolveSchemaObject(root, root)?.properties, '', 0);
  } catch {
    /* Request definitions may contain a draft schema. Response import is independent. */
  }
  next.fields = fields;
  if (endpoint.responses.length)
    next.scenarios = endpoint.responses.slice(0, 12).map((r) => ({
      name: r.description.slice(0, 60) || r.status,
      status: Number(r.status) || 200,
      delay: 0,
      format: r.contentType.includes('json') ? (!r.example && r.schema ? 'schema' : 'json') : 'text',
      schema: r.schema || undefined,
      body: r.example || (r.contentType.includes('json') ? '{}' : ''),
    }));
  return next;
}

export function MockService({ active, edit, origin }: PageProps & { origin?: string }) {
  const guard = useWorkspaceGuard();
  const list = useCollabList<Summary>('mock', active);
  const resource = useWorkspaceResource('mock');
  const lastResource = useRef(resource);
  const [draft, setDraft] = useState<Route>(),
    [dirty, setDirty] = useState(false),
    [tab, setTab] = useState(0),
    [query, setQuery] = useState('');
  const [panel, setPanel] = useState<'response' | 'calls'>('response');
  const [listOpen, setListOpen] = useState(false);
  const [imports, setImports] = useState<Route[]>([]);
  useBeforeUnload(dirty);
  const op = useOperation(),
    confirm = useConfirmation();
  const selected = resource || list.value?.[0]?.id;
  const load = useCallback(
    () =>
      selected
        ? collab<Route & { history: Log[] }>('mock', 'read', { id: selected })
        : Promise.resolve(undefined),
    [selected],
  );
  const detail = useLive(active && !!selected, load);
  const saved = detail.value?.id === selected ? detail.value : undefined;
  const row = dirty ? draft : saved;
  const index = Math.min(tab, (row?.scenarios.length || 1) - 1),
    scenario = row?.scenarios[index];
  const href =
    origin && saved && saved.published
      ? new URL('/mock/' + saved.key + saved.path.replace(/\/(?:\{\w+\}|:\w+)(?=\/|$)/g, '/1'), origin).href
      : '';
  useEffect(() => {
    if (resource && resource !== lastResource.current) {
      lastResource.current = resource;
      setDirty(false);
      setTab(0);
    }
  }, [resource]);
  function patch(values: Partial<Route>) {
    if (row) {
      setDraft({ ...row, ...values });
      setDirty(true);
    }
  }
  function changeScenario(values: Partial<Scenario>) {
    if (row)
      patch({ scenarios: row.scenarios.map((item, i) => (i === index ? { ...item, ...values } : item)) });
  }
  const leave = () =>
    !dirty ||
    confirm({ title: '放弃未保存的接口修改？', detail: '主机仍保留最近保存的接口定义。', confirm: '放弃修改' });
  async function start(template: Route) {
    if (!(await leave())) return false;
    setPanel('response');
    setListOpen(false);
    setDraft(template);
    setDirty(true);
    setTab(0);
    setImports([]);
    return true;
  }
  const finishCreation = useRelatedCreation('mock', active && edit && !op.busy, (_from, resource) => {
    if (!resource || !guard('http')) return;
    void op.run(async () => {
      const [projectId, endpointId] = resource.split(':');
      const library = await apiLibrary('get-library');
      const project = library.state.projects.find((item) => item.id === projectId);
      const endpoint = project?.endpoints.find((item) => item.id === endpointId);
      if (!project || !endpoint) throw new Error('接口已移除或当前访客无权访问。');
      if (!verbs.includes(endpoint.method)) throw new Error('模拟服务不支持此请求方法。');
      if (!(await start(mockTemplate(project.name, endpoint)))) finishCreation();
    });
  });
  function openRequest(entry?: Log) {
    if (!saved || !href || !guard('http', 'send')) return;
    const url = entry?.path ? new URL('/mock/' + saved.key + entry.path, href).href : href;
    openWorkspaceLink('http');
    window.dispatchEvent(
      new CustomEvent('devkit:prepare-http-request', {
        detail: {
          name: saved.name,
          method: entry?.method ?? saved.method,
          url,
          headers: entry?.headers,
          body: entry?.body,
        },
      }),
    );
  }
  const matches = (list.value || []).filter((item) =>
    (item.name + item.path + (item.project || '')).toLowerCase().includes(query.toLowerCase()),
  );
  const notice = list.error || detail.error || op.message;
  return (
    <div className="collab-layout mock-layout">
      {row && (
        <button
          className="mock-directory-toggle"
          aria-expanded={listOpen}
          aria-controls="mock-directory"
          onClick={() => setListOpen(!listOpen)}
        >
          <ListTree size={17} />
          接口列表 <span className="collab-count">{list.value?.length ?? 0}</span>
        </button>
      )}
      <aside id="mock-directory" className="collab-rail" data-open={listOpen || !row}>
        <div className="collab-bar">
          <h2>
            接口列表 <span className="collab-count">{list.value?.length ?? 0}</span>
          </h2>
          {edit && (
            <button onClick={() => void start(sample())}>
              <Plus size={15} />
              新建接口
            </button>
          )}
        </div>
        <label className="collab-search">
          <Search size={16} />
          <TextInput
            aria-label="查找接口"
            placeholder="查找名称、路径或项目"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {!!list.value?.length && !matches.length && <p role="status">没有匹配的接口。</p>}
        {matches.map((item) => (
          <button
            className="collab-record"
            key={item.id}
            aria-pressed={row?.id === item.id}
            onClick={async () => {
              if (await leave()) {
                setDirty(false);
                setListOpen(false);
                setPanel('response');
                openWorkspaceLink('mock', item.id);
              }
            }}
          >
            <strong>{item.name}</strong>
            <span className="route-line">
              <b>{item.method}</b>
              <code>{item.path}</code>
            </span>
            <small>
              {item.project ? item.project + ' · ' : ''}
              {item.published ? (item.dataset ? '已发布数据集' : '已发布 · ' + item.scenario) : '未发布'}
            </small>
          </button>
        ))}
        {edit && (
          <details className="mock-library-tools">
            <summary>导入与数据集</summary>
            <button
              onClick={() =>
                guard('http') &&
                void op.run(async () => {
                  const library = await apiLibrary('get-library');
                  const choices = library.state.projects.flatMap((project) =>
                    project.endpoints
                      .filter((endpoint) => verbs.includes(endpoint.method))
                      .map((endpoint) => mockTemplate(project.name, endpoint)),
                  );
                  setImports(choices);
                  return choices.length ? '选择要导入的接口' : 'HTTP 工作台中暂无可导入的接口';
                })
              }
            >
              <FileInput size={15} />从 HTTP 工作台导入
            </button>
            <button
              onClick={() => void start({ ...sample(), name: '订单数据集', dataset: { ...orderDataset } })}
            >
              新建项目数据集
            </button>
            <CreateRelated from="mock" page="http">
              新建 HTTP 接口
            </CreateRelated>
            {imports.map((item, i) => (
              <button key={i} onClick={() => void start(item)}>
                {item.name}
              </button>
            ))}
          </details>
        )}
      </aside>
      <section className="collab-detail">
        {notice && (
          <p className="mock-notice" role="status">
            {notice}
          </p>
        )}
        {!row || !scenario ? (
          <div className="collab-empty mock-empty">
            <ListTree size={40} />
            <strong>{list.value?.length ? '选择一个接口' : '还没有模拟接口'}</strong>
            <p>
              {edit
                ? '创建接口并定义响应，供同一局域网内的应用调用。'
                : '已发布接口的调用地址与响应场景将在这里显示。'}
            </p>
            {edit && !list.value?.length && (
              <button className="primary-button" onClick={() => void start(sample())}>
                <Plus size={16} />
                创建第一个接口
              </button>
            )}
          </div>
        ) : (
          <>
            <header className="mock-heading">
              <div>
                <span className="request-method">{row.method}</span>
                <h2>{row.name || '新建模拟接口'}</h2>
              </div>
              <span className="mock-state" data-published={!dirty && !!saved?.published && row.id === saved.id}>
                {dirty ? '有未保存修改' : saved?.published ? '已发布' : '草稿'}
              </span>
              {edit && (
                <div className="collab-actions mock-save">
                  <button
                    className="primary-button"
                    disabled={!dirty || op.busy}
                    onClick={() =>
                      void op.run(async () => {
                        const result = await collab<Route>('mock', row.id ? 'save' : 'create', row);
                        setDirty(false);
                        setPanel(result.published ? 'calls' : 'response');
                        if (!finishCreation()) openWorkspaceLink('mock', result.id);
                        await list.refresh();
                        if (selected === result.id) await detail.refresh();
                        return '接口已保存';
                      })
                    }
                  >
                    <Save size={16} />
                    保存接口
                  </button>
                  {dirty && (
                    <button
                      onClick={() => {
                        setDirty(false);
                        finishCreation();
                      }}
                    >
                      放弃草稿
                    </button>
                  )}
                </div>
              )}
            </header>
            <nav className="mock-sections" aria-label="接口详情">
              <button aria-pressed={!row.id || panel === 'response'} onClick={() => setPanel('response')}>
                <Braces size={16} />
                响应配置
              </button>
              {saved && row.id === saved.id && (
                <button aria-pressed={panel === 'calls'} onClick={() => setPanel('calls')}>
                  <Radio size={16} />
                  调用与记录
                </button>
              )}
            </nav>
            {(!saved || row.id !== saved.id || panel === 'response') && (
              <div className="mock-editor">
                <details className="mock-route" key={row.id || 'new'} open={!row.id}>
                  <summary>
                    接口设置 <code>{row.path}</code>
                  </summary>
                  <fieldset disabled={!edit || op.busy}>
                    <div className="collab-fields">
                      <label>
                        接口名称
                        <TextInput
                          value={row.name}
                          maxLength={100}
                          onChange={(e) => patch({ name: e.target.value })}
                        />
                      </label>
                      <label>
                        方法
                        <select
                          disabled={!!row.dataset}
                          value={row.method}
                          onChange={(e) => patch({ method: e.target.value })}
                        >
                          {verbs.map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        路径
                        <TextInput value={row.path} onChange={(e) => patch({ path: e.target.value })} />
                      </label>
                      <label>
                        所属项目{row.dataset ? '（必填）' : '（可选）'}
                        <input
                          list="mock-project-names"
                          maxLength={60}
                          value={row.project || ''}
                          onChange={(e) => patch({ project: e.target.value })}
                          placeholder="选择或输入项目名称"
                        />
                        <datalist id="mock-project-names">
                          {[...new Set(list.value?.map((item) => item.project).filter(Boolean))].map((name) => (
                            <option value={name} key={name} />
                          ))}
                        </datalist>
                      </label>
                    </div>
                  </fieldset>
                </details>
                {row.dataset ? (
                  <MockDatasetEditor
                    dataset={row.dataset}
                    saved={!!row.id}
                    size={saved?.size}
                    disabled={!edit || op.busy}
                    change={(dataset) => patch({ dataset })}
                    reset={() =>
                      void op.run(async () => {
                        if (dirty) throw new Error('请先保存或放弃接口草稿。');
                        if (
                          !(await confirm({
                            title: '恢复初始数据？',
                            detail: '此数据集将恢复到首次生成的记录，之后的增删改会被覆盖。',
                            confirm: '恢复数据',
                          }))
                        )
                          return;
                        await collab('mock', 'reset', { id: row.id, revision: row.revision });
                        await detail.refresh();
                        return '数据集已恢复';
                      })
                    }
                  />
                ) : (
                  <>
                    <section className="mock-scenarios" aria-label="响应场景">
                      <header>
                        <h3>响应场景</h3>
                        {edit && (
                          <button
                            disabled={op.busy || row.scenarios.length >= 12}
                            onClick={() => {
                              patch({
                                scenarios: [...row.scenarios, { ...sample().scenarios[0], name: '新场景' }],
                              });
                              setTab(row.scenarios.length);
                            }}
                          >
                            <Plus size={14} />
                            添加场景
                          </button>
                        )}
                      </header>
                      <span className="sr-only">默认场景 {row.scenarios[row.active].name}</span>
                      {dirty && saved?.published && (
                        <small>当前已发布 · {saved.scenarios[saved.active].name}</small>
                      )}
                      <div className="collab-tools">
                        <select
                          className="mock-scenario-select"
                          aria-label="选择响应场景"
                          value={index}
                          onChange={(e) => setTab(Number(e.target.value))}
                        >
                          {row.scenarios.map((item, i) => (
                            <option key={i} value={i}>
                              {item.status} · {item.name}
                              {row.active === i ? '（当前配置）' : ''}
                            </option>
                          ))}
                        </select>
                        {row.scenarios.map((item, i) => (
                          <button key={i} aria-pressed={index === i} onClick={() => setTab(i)}>
                            <code data-family={Math.floor(item.status / 100)}>{item.status}</code>
                            {item.name}
                            {row.active === i && (
                              <CircleDot size={13} aria-label="生效场景">
                                <title>生效场景</title>
                              </CircleDot>
                            )}
                          </button>
                        ))}
                      </div>
                    </section>
                    <MockResponseEditor
                      key={(row.id || 'draft') + ':' + index}
                      scenario={scenario}
                      path={row.path}
                      fields={row.fields}
                      disabled={!edit || op.busy}
                      change={changeScenario}
                    />
                    <details className="mock-advanced">
                      <summary>
                        场景设置{' '}
                        <small>
                          {scenario.status} · {scenario.delay} ms
                        </small>
                      </summary>
                      <fieldset disabled={!edit || op.busy}>
                        <div className="collab-fields">
                          <label>
                            场景名称
                            <TextInput
                              value={scenario.name}
                              maxLength={60}
                              onChange={(e) => changeScenario({ name: e.target.value })}
                            />
                          </label>
                          <label>
                            状态码
                            <input
                              type="number"
                              min={200}
                              max={599}
                              value={scenario.status}
                              onChange={(e) => changeScenario({ status: Number(e.target.value) })}
                            />
                          </label>
                          <label>
                            延迟（ms）
                            <input
                              type="number"
                              min={0}
                              max={10000}
                              value={scenario.delay}
                              onChange={(e) => changeScenario({ delay: Number(e.target.value) })}
                            />
                          </label>
                          <div className="delay-stepper">
                            <button
                              type="button"
                              aria-label="减少延迟"
                              onClick={() => changeScenario({ delay: Math.max(0, scenario.delay - 50) })}
                            >
                              −
                            </button>
                            <input
                              aria-label="拖动调整延迟"
                              type="range"
                              min={0}
                              max={10000}
                              value={scenario.delay}
                              onChange={(e) => changeScenario({ delay: Number(e.target.value) })}
                            />
                            <button
                              type="button"
                              aria-label="增加延迟"
                              onClick={() => changeScenario({ delay: Math.min(10000, scenario.delay + 50) })}
                            >
                              ＋
                            </button>
                          </div>
                        </div>
                        <MockScenarioRules
                          rules={scenarioRules(scenario)}
                          disabled={!edit || op.busy}
                          change={(rules) => changeScenario({ rules, queryKey: '', queryValue: '' })}
                        />
                        {edit && (
                          <div className="collab-actions">
                            <button disabled={row.active === index} onClick={() => patch({ active: index })}>
                              设为生效场景
                            </button>
                            <button
                              disabled={row.scenarios.length === 1}
                              onClick={() => {
                                patch({
                                  scenarios: row.scenarios.filter((_, i) => i !== index),
                                  active: row.active === index ? 0 : row.active - Number(row.active > index),
                                });
                                setTab(0);
                              }}
                            >
                              移除场景
                            </button>
                          </div>
                        )}
                      </fieldset>
                    </details>
                  </>
                )}
                <fieldset disabled={!edit || op.busy}>
                  <div className="mock-publish">
                    <label className="collab-check">
                      <input
                        role="switch"
                        className="liquid-toggle"
                        type="checkbox"
                        checked={row.cors}
                        onChange={(e) => patch({ cors: e.target.checked })}
                      />
                      允许跨域调用
                    </label>
                    <label className="collab-check">
                      <input
                        role="switch"
                        className="liquid-toggle"
                        type="checkbox"
                        checked={row.published}
                        onChange={(e) => patch({ published: e.target.checked })}
                      />
                      发布到局域网，持调用地址即可访问
                    </label>
                  </div>
                </fieldset>
                {edit && (
                  <div className="collab-actions">
                    {' '}
                    {!dirty && saved && (
                      <button
                        onClick={() =>
                          void op.run(async () => {
                            if (
                              !(await confirm({
                                title: '删除模拟接口？',
                                detail: '调用地址和场景将同时移除。',
                                confirm: '删除',
                              }))
                            )
                              return;
                            await collab('mock', 'remove', saved);
                            openWorkspaceLink('mock');
                            await list.refresh();
                          })
                        }
                      >
                        删除接口
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {saved && row.id === saved.id && panel === 'calls' && (
              <section className="mock-calls">
                <h3>调用地址</h3>
                {href ? (
                  <>
                    <code className="collab-url">{href}</code>
                    {saved.projectKey && (
                      <details>
                        <summary>{saved.project} · 项目基础地址</summary>
                        <code className="collab-url">{new URL('/mock/' + saved.projectKey, href).href}</code>
                        <button
                          onClick={() =>
                            void op.run(async () => {
                              await copyText(new URL('/mock/' + saved.projectKey, href).href);
                              return '项目基础地址已复制';
                            })
                          }
                        >
                          复制基础地址
                        </button>
                      </details>
                    )}
                    <div className="collab-actions">
                      <button onClick={() => openRequest()}>用 HTTP 调试打开</button>
                      <button
                        onClick={() =>
                          void op.run(async () => {
                            await copyText(href);
                            return '调用地址已复制';
                          })
                        }
                      >
                        <Copy size={15} />
                        复制调用地址
                      </button>
                      {edit && (
                        <button
                          disabled={dirty || op.busy}
                          onClick={() =>
                            void op.run(async () => {
                              if (
                                !(await confirm({
                                  title: '更换调用地址？',
                                  detail: '使用本接口独立地址的客户端需要更新地址。项目基础地址单独共享。',
                                  confirm: '更换',
                                }))
                              )
                                return;
                              await collab('mock', 'rotate', saved);
                              await detail.refresh();
                            })
                          }
                        >
                          <KeyRound size={15} />
                          更换地址
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <p>开启栏目共享并发布接口后，这里会显示调用地址。</p>
                )}
                <h3>
                  <History size={17} />
                  最近调用
                </h3>
                {!saved.history.length && <p>等待首次调用。</p>}
                {saved.history.map((entry, i) => (
                  <details className="mock-call" key={entry.at + ':' + i}>
                    <summary>
                      <time>{new Date(entry.at).toLocaleTimeString()}</time>
                      <b>{entry.status}</b>
                      <span>
                        {entry.method} {entry.path || entry.scenario}
                      </span>
                      <small>{entry.elapsed ?? entry.delay} ms</small>
                    </summary>
                    <p>
                      {entry.scenario} · {entry.reason || '默认场景'} · 配置延迟 {entry.delay} ms
                    </p>
                    {entry.path && (
                      <pre>
                        {entry.method} {entry.path}
                      </pre>
                    )}
                    {entry.headers && Object.keys(entry.headers).length > 0 && (
                      <details>
                        <summary>请求头</summary>
                        <pre>
                          {Object.entries(entry.headers)
                            .map(([name, value]) => name + ': ' + value)
                            .join('\n')}
                        </pre>
                      </details>
                    )}
                    {entry.body && <pre>{entry.body}</pre>}
                    {entry.omitted && <small>敏感字段、超长或非 JSON 正文已省略。</small>}
                    {entry.replayable && href && (
                      <button onClick={() => openRequest(entry)}>带入 HTTP 调试</button>
                    )}
                  </details>
                ))}
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}
