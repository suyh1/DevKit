import SegmentedControl from './SegmentedControl';
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
import CodeEditor from './CodeEditor';
import { copyText } from './motion-primitives';
import { useBeforeUnload, useConfirmation } from './Confirmation';
import { useWorkspaceResource, openWorkspaceLink } from './workspace-links';
import { apiLibrary } from './api-library';
import { CreateRelated, useRelatedCreation, useWorkspaceGuard } from './related-workspaces';

type Scenario = {
  name: string;
  status: number;
  delay: number;
  format: string;
  body: string;
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
};
type Summary = Route & { id: string; scenario: string };
type Log = { at: number; scenario: string; method: string; status: number; delay: number };
const verbs = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const sample = (): Route => ({
  name: '',
  path: '/orders',
  method: 'GET',
  published: false,
  cors: false,
  active: 0,
  scenarios: [
    { name: '成功', status: 200, delay: 0, format: 'json', body: '{\n  "items": [{"id": 1}]\n}' },
    { name: '空数据', status: 200, delay: 0, format: 'json', body: '{"items":[]}' },
    { name: '服务异常', status: 503, delay: 800, format: 'json', body: '{"error":"temporarily unavailable"}' },
  ],
});
function mockTemplate(projectName: string, endpoint: ApiEndpoint): Route {
  const next = {
    ...sample(),
    name: projectName + ' / ' + endpoint.name,
    method: endpoint.method,
    path: endpoint.path.split('?')[0],
  };
  if (endpoint.responses.length)
    next.scenarios = endpoint.responses.slice(0, 12).map((r) => ({
      name: r.description.slice(0, 60) || r.status,
      status: Number(r.status) || 200,
      delay: 0,
      format: r.contentType.includes('json') ? 'json' : 'text',
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
      selected ? collab<Route & { history: Log[] }>('mock', 'read', { id: selected }) : Promise.resolve(undefined),
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
    if (row) patch({ scenarios: row.scenarios.map((item, i) => (i === index ? { ...item, ...values } : item)) });
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
      const project = library.state.projects.find(item => item.id === projectId);
      const endpoint = project?.endpoints.find(item => item.id === endpointId);
      if (!project || !endpoint) throw new Error('接口已移除或当前访客无权访问。');
      if (!verbs.includes(endpoint.method)) throw new Error('模拟服务不支持此请求方法。');
      if (!await start(mockTemplate(project.name, endpoint))) finishCreation();
    });
  });
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
          <input
            aria-label="查找接口"
            placeholder="查找名称或路径"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {(list.value || [])
          .filter((item) => (item.name + item.path).toLowerCase().includes(query.toLowerCase()))
          .map((item) => (
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
              <small>{item.published ? '已发布 · ' + item.scenario : '未发布'}</small>
            </button>
          ))}
        {edit && <>
          <button
            onClick={() => guard('http') &&
              void op.run(async () => {
                const library = await apiLibrary('get-library');
                const choices = library.state.projects.flatMap((project) =>
                  project.endpoints
                    .filter((endpoint) => verbs.includes(endpoint.method))
                    .map(endpoint => mockTemplate(project.name, endpoint)),
                );
                setImports(choices);
                return choices.length ? '选择接口以载入响应示例' : 'HTTP 工作台中暂无可导入的接口';
              })
            }
          >
            <FileInput size={15} />从 HTTP 工作台导入
          </button>
          <CreateRelated from="mock" page="http">新建 HTTP 接口</CreateRelated>
        </>}
        {imports.map((item, i) => (
          <button key={i} onClick={() => void start(item)}>
            {item.name}
          </button>
        ))}
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
              {edit ? '创建接口并定义响应，供同一局域网内的应用调用。' : '已发布接口的调用地址与响应场景将在这里显示。'}
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
                        <input value={row.name} maxLength={100} onChange={(e) => patch({ name: e.target.value })} />
                      </label>
                      <label>
                        方法
                        <select value={row.method} onChange={(e) => patch({ method: e.target.value })}>
                          {verbs.map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        路径
                        <input value={row.path} onChange={(e) => patch({ path: e.target.value })} />
                      </label>
                    </div>
                  </fieldset>
                </details>
                <h3>响应场景</h3>
                <div className="collab-tools">
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
                  {edit && (
                    <button
                      disabled={op.busy || row.scenarios.length >= 12}
                      onClick={() => {
                        patch({ scenarios: [...row.scenarios, { ...sample().scenarios[0], name: '新场景' }] });
                        setTab(row.scenarios.length);
                      }}
                    >
                      添加场景
                    </button>
                  )}
                </div>
                <fieldset disabled={!edit || op.busy}>
                  <div className="mock-code-panel">
                    <div>
                      <strong>
                        <Braces size={16} />
                        响应正文
                      </strong>
                      <small>
                        {scenario.format.toUpperCase()} · {scenario.body.split('\n').length} 行
                      </small>
                    </div>
                    <CodeEditor
                      label="响应正文"
                      language={scenario.format === 'json' ? 'json' : 'text'}
                      readOnly={!edit || op.busy}
                      value={scenario.body}
                      onChange={(body) => changeScenario({ body })}
                      wrap
                    />
                  </div>
                  <div className="collab-fields">
                    <label>
                      场景名称
                      <input value={scenario.name} onChange={(e) => changeScenario({ name: e.target.value })} />
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
                    <div className="choice-field">
                      <span>格式</span>
                      <SegmentedControl label="响应格式" value={scenario.format}
                        options={[{ value: 'json', label: 'JSON' }, { value: 'text', label: '纯文本' }]} onChange={format => changeScenario({ format })} />
                    </div>
                  </div>
                  <details className="mock-match">
                    <summary>
                      查询参数匹配
                      {scenario.queryKey && (
                        <code>
                          {scenario.queryKey}={scenario.queryValue}
                        </code>
                      )}
                    </summary>
                    <div className="collab-fields">
                      <label>
                        参数名
                        <input
                          value={scenario.queryKey || ''}
                          onChange={(e) => changeScenario({ queryKey: e.target.value })}
                          placeholder="可选，例如 mode"
                        />
                      </label>
                      <label>
                        参数值
                        <input
                          value={scenario.queryValue || ''}
                          onChange={(e) => changeScenario({ queryValue: e.target.value })}
                          placeholder="例如 empty"
                        />
                      </label>
                    </div>
                  </details>
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
                  <div className="mock-publish">
                    <label className="collab-check">
                      <input type="checkbox" checked={row.cors} onChange={(e) => patch({ cors: e.target.checked })} />
                      允许跨域调用
                    </label>
                    <label className="collab-check">
                      <input
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
                    {dirty && <button onClick={() => { setDirty(false); finishCreation(); }}>放弃草稿</button>}
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
                    <div className="collab-actions">
                      <button onClick={() => {
                        if (!guard('http', 'send')) return;
                        openWorkspaceLink('http');
                        window.dispatchEvent(new CustomEvent('devkit:prepare-http-request', { detail: { name: saved.name, method: saved.method, url: href } }));
                      }}>用 HTTP 调试打开</button>
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
                                  detail: '使用旧地址的客户端需要更新地址。',
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
                  <div className="collab-log" key={i}>
                    <time>{new Date(entry.at).toLocaleTimeString()}</time>
                    <strong>{entry.status}</strong>
                    <span>{entry.scenario}</span>
                    <small>{entry.delay} ms</small>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </section>
    </div>
  );
}
