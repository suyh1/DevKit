import { SharingButton } from './Sharing';
import { canSendHttp, remoteAccess } from './workspace-remote';
import { newProjectId } from './project-api';
import { MotionReveal, MotionGroup, useMotionList, MotionButton, MotionPresence } from './Motion';
import { buttonFeedback, copyText } from './motion-primitives';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Square, Save, Plus, Trash2, Download, Upload, Copy } from 'lucide-react';
import ApiWorkspace from './ApiWorkspace';
import HttpRequestInput from './HttpRequestInput';
import CodeEditor from './CodeEditor';
import { parseHttpConfig, savedHttpConfig, readHttpCollection, collectionText } from './http-model';
import type { HttpEntry, HttpResponse } from './http-model';
import { sendHttp, cancelHttp } from './http-api';
import { saveText } from './files';
import { useBeforeUnload, useConfirmation } from './Confirmation';
import { formatJson } from './tools';
import './features.css';

const example = '{\n  "method": "GET",\n  "url": "http://127.0.0.1:8080/",\n  "headers": {}\n}';
const storageKey = 'devkit:http-collection';
function initialCollection() {
  try {
    const text = localStorage.getItem(storageKey);
    return { entries: text ? readHttpCollection(text) : [], error: '' };
  } catch {
    return { entries: [] as HttpEntry[], error: '本地请求集合无法读取，原记录已保留；请导入备份或检查浏览器存储。' };
  }
}
export default function HttpWorkbench({
  initial,
  onNotice,
  onGenerate
}: {
  initial: { config: string; key: number } | null;
  onNotice: (message: string) => void;
  onGenerate: (config: string) => void;
}) {
  const [workspaceMode, setWorkspaceMode] = useState<'api'|'quick'>('api');
  const [apiBusy, setApiBusy] = useState(false);
  const [loaded] = useState(initialCollection);
  const [entries, setEntries] = useState(loaded.entries),
    [error, setError] = useState(loaded.error);
  const [config, setConfig] = useState(example),
    [name, setName] = useState('新请求'),
    [timeout, setTimeoutValue] = useState(15000);
  const [selected, setSelected] = useState(''),
    [includeSensitive, setIncludeSensitive] = useState(false),
    [response, setResponse] = useState<HttpResponse | null>(null),
    [running, setRunning] = useState('');
  const [responseTab, setResponseTab] = useState<'body' | 'headers'>('body'),
    [baseline, setBaseline] = useState({ config: example, name: '新请求', timeout: 15000, includeSensitive: false });
  const [editorKey, setEditorKey] = useState(0);
  const [stale, setStale] = useState(false),
    [invalidDraft, setInvalidDraft] = useState(false);
  const [pretty, setPretty] = useState(true),
    [headerFilter, setHeaderFilter] = useState(''),
    [search, setSearch] = useState('');
  const [history, setHistory] = useState<
    { id: string; config: string; name: string; timeout: number; method: string; url: string; status: string; time: string }[]
  >([]);
  const responseBody = useMemo(() => {
    if (!response || response.binary || !pretty || response.body.length > 1_000_000) return response?.body ?? '';
    try {
      return formatJson(response.body, { indent: '2' });
    } catch {
      return response.body;
    }
  }, [response, pretty]);
  const responseHeaders = response?.headers.filter((row) => row.join(': ').toLowerCase().includes(headerFilter.toLowerCase())) ?? [];
  const liveRequest = useRef(''),
    mounted = useRef(true),
    file = useRef<HTMLInputElement>(null);
  const collection = useRef<HTMLElement>(null);
  useMotionList(collection, entries.map((entry) => entry.id).join('|'));
  const confirm = useConfirmation();
  const dirty =
    invalidDraft ||
    config !== baseline.config ||
    name !== baseline.name ||
    timeout !== baseline.timeout ||
    includeSensitive !== baseline.includeSensitive;
  useBeforeUnload(dirty || !!running);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (liveRequest.current) void cancelHttp(liveRequest.current);
    };
  }, []);
  function reset(config: string, name = '新请求', timeout = 15000, id = '', sensitive = false) {
    setEditorKey((key) => key + 1);
    setInvalidDraft(false);
    setConfig(config);
    setName(name);
    setTimeoutValue(timeout);
    setSelected(id);
    setIncludeSensitive(sensitive);
    setResponse(null);
    setStale(false);
    setError('');
    onNotice('');
    setBaseline({ config, name, timeout, includeSensitive: sensitive });
  }
  const latest = useRef({ dirty, running });
  latest.current = { dirty, running };
  async function allowReplace() {
    if (latest.current.running) {
      onNotice('请先取消或等待当前请求完成。');
      return false;
    }
    return (
      !latest.current.dirty ||
      confirm({
        title: '放弃当前请求草稿？',
        detail: '未保存的请求配置会被替换；响应不会写入请求集合。',
        confirm: '放弃草稿',
        cancel: '继续编辑',
        context: 'HTTP 调试'
      })
    );
  }
  useEffect(() => {
    if (initial) { setWorkspaceMode('quick'); }
    if (initial)
      void allowReplace().then((allow) => {
        if (allow) reset(initial.config, '从代码生成器导入');
      });
  }, [initial?.key]);
  function persist(next: HttpEntry[]) {
    const text = collectionText(next);
    readHttpCollection(text);
    localStorage.setItem(storageKey, text);
    setEntries(next);
  }
  async function send() {
    if (liveRequest.current) return;
    setError('');
    let request;
    try {
      request = parseHttpConfig(config, timeout);
    } catch (error) {
      setError((error as Error).message);
      return;
    }
    const sent = {
      id: newProjectId(),
      config,
      name,
      timeout,
      method: request.method,
      url: request.url,
      time: new Date().toLocaleTimeString()
    };
    const record = (status: string) => {
      if (mounted.current)
        setHistory((current) => {
          let budget = 0;
          return [{ ...sent, status }, ...current].filter((item) => (budget += item.config.length) <= 4_000_000).slice(0, 20);
        });
    };
    const id = sent.id;
    liveRequest.current = id;
    setRunning(id);
    setResponse(null);
    setStale(false);
    try {
      const result = await sendHttp(id, request);
      if (mounted.current && liveRequest.current === id) {
        setResponse(result);
        record(String(result.status));
      }
    } catch (error) {
      if (mounted.current) {
        setError((error as Error).message);
        record('失败 / 取消');
      }
    } finally {
      if (liveRequest.current === id) {
        liveRequest.current = '';
        if (mounted.current) setRunning('');
      }
    }
  }
  function save() {
    const feedback = buttonFeedback();
    try {
      if (!name.trim() || name.trim().length > 100) throw new Error('请求名称需要 1–100 字符。');
      const stored = savedHttpConfig(config, includeSensitive),
        id = selected || newProjectId();
      const entry = { id, name: name.trim(), config: stored, timeout, sensitive: includeSensitive };
      const next = entries.some((item) => item.id === id) ? entries.map((item) => (item.id === id ? entry : item)) : [...entries, entry];
      persist(next);
      setSelected(id);
      setError('');
      setBaseline({ config, name, timeout, includeSensitive });
      onNotice(includeSensitive ? '请求已保存；集合中包含明文 Headers、正文和参数。' : '请求已保存；鉴权头、常见敏感参数和正文已排除。');
      feedback(true);
    } catch (error) {
      setError((error as Error).message);
      feedback(false);
    }
  }
  async function remove(entry: HttpEntry) {
    if (
      !(await confirm({
        title: `删除请求“${entry.name}”？`,
        detail: '仅删除本地集合中的这一项。',
        confirm: '删除请求',
        context: 'HTTP 调试'
      }))
    )
      return;
    try {
      persist(entries.filter((item) => item.id !== entry.id));
      if (selected === entry.id) {
        setSelected('');
        setBaseline({ config: '', name, timeout, includeSensitive });
      }
    } catch (error) {
      setError(String(error));
    }
  }
  return (
    <><div className="http-workspace-topline"><div className="http-product-tabs" role="tablist" aria-label="HTTP工作台模式"><button role="tab" aria-selected={workspaceMode==='api'} disabled={!!running} onClick={()=>setWorkspaceMode('api')}>接口项目 · 文档与调试</button><button role="tab" aria-selected={workspaceMode==='quick'} disabled={apiBusy} onClick={()=>setWorkspaceMode('quick')}>快速请求</button></div><SharingButton /></div><div hidden={workspaceMode!=='api'} inert={workspaceMode!=='api'}><ApiWorkspace onBusy={setApiBusy} onGenerate={onGenerate} onNotice={onNotice}/></div><section className="http-workbench" hidden={workspaceMode!=='quick'} inert={workspaceMode!=='quick'}>
      <div className="page-heading">
        <div className="page-title">
          <div className="eyebrow">HTTP CLIENT</div>
          <h1>HTTP 调试</h1>
        </div>
        <button
          className="secondary-button"
          disabled={!!running}
          onClick={() =>
            void allowReplace().then((allow) => {
              if (allow) reset(example);
            })
          }
        >
          <Plus size={14} />
          新请求
        </button>
      </div>
      <p className="workflow-intro">
        请求由共享主机或桌面本机发出，点击发送才访问目标。支持 HTTP(S)、文本/JSON 正文；不自动跟随重定向。响应仅在内存。{remoteAccess() && " 请求集合保存在当前浏览器；接口项目才与主机共享。"}
      </p>
      <div className="http-layout">
        <aside ref={collection} className="http-collection">
          <h2>
            请求集合 <small>{entries.length}/100</small>
          </h2>
          <input
            className="http-collection-search"
            aria-label="搜索请求集合"
            placeholder="搜索集合…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {entries
            .filter((entry) => (entry.name + entry.config).toLowerCase().includes(search.toLowerCase()))
            .map((entry) => (
              <div className={selected === entry.id ? 'selected' : ''} key={entry.id} data-motion-key={entry.id}>
                <button
                  disabled={!!running}
                  onClick={() =>
                    void allowReplace().then((allow) => {
                      if (allow) reset(entry.config, entry.name, entry.timeout, entry.id, entry.sensitive);
                    })
                  }
                >
                  {entry.name}
                  <small>{entry.sensitive ? '含明文请求数据' : '已排除鉴权与正文'}</small>
                </button>
                <button
                  className="icon-button"
                  aria-label={`删除请求 ${entry.name}`}
                  disabled={!!running}
                  onClick={() => void remove(entry)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          {!entries.length && <p className="preview-note">保存常用请求后，可在这里切换。</p>}
          <div className="feature-toolbar">
            <button
              className="text-button"
              disabled={!entries.length}
              onClick={() =>
                void saveText(collectionText(entries), 'devkit-http-collection.json').catch((error) => setError(String(error)))
              }
            >
              <Download size={14} />
              导出
            </button>
            <button className="text-button" disabled={!!running} onClick={() => file.current?.click()}>
              <Upload size={14} />
              导入
            </button>
          </div>
          <input
            className="sr-only"
            type="file"
            accept=".json"
            aria-label="导入请求集合"
            ref={file}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (!chosen) return;
              void (async () => {
                try {
                  if (chosen.size > 4_000_000) throw new Error('请求集合文件超过 4MB。');
                  const imported = readHttpCollection(await chosen.text());
                  if (
                    !(await confirm({
                      title: '合并导入请求集合？',
                      detail: `导入 ${imported.length} 项，使用新标识保留现有条目。文件中的明文请求数据会保存在本机。`,
                      confirm: '合并导入',
                      context: 'HTTP 调试'
                    }))
                  )
                    return;
                  persist([...entries, ...imported.map((entry) => ({ ...entry, id: newProjectId() }))]);
                  setError('');
                  onNotice('请求集合已合并导入。');
                } catch (error) {
                  setError(String(error));
                }
              })();
            }}
          />
          <section className="http-history">
            <h3>
              会话历史 <small>{history.length}/20 · 仅内存</small>
            </h3>
            {history.length > 0 && (
              <button className="text-button" onClick={() => setHistory([])}>
                清空历史
              </button>
            )}
            {history.map((item) => (
              <button
                key={item.id}
                disabled={!!running}
                onClick={() =>
                  void allowReplace().then((allow) => {
                    if (allow) reset(item.config, item.name, item.timeout);
                  })
                }
              >
                <strong>
                  {item.method} · {item.status}
                </strong>
                <small>{item.url}</small>
                <small>{item.time} · 点击恢复请求</small>
              </button>
            ))}
            {!history.length && <p className="preview-note">发送后记录最近 20 次请求。</p>}
          </section>
        </aside>
        <div className="http-main">
          <div className="feature-toolbar">
            <label>
              请求名称
              <input
                aria-label="请求名称"
                disabled={!!running}
                value={name}
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              超时（毫秒）
              <input
                aria-label="HTTP 超时"
                disabled={!!running}
                type="number"
                min={100}
                max={120000}
                value={timeout}
                onChange={(event) => setTimeoutValue(Number(event.target.value))}
              />
            </label>
            <MotionButton className="secondary-button" disabled={!!running || invalidDraft} onClick={save}>
              <Save size={14} />
              保存请求
            </MotionButton>
            <button
              className="secondary-button"
              disabled={!!running || invalidDraft}
              onClick={() => {
                try {
                  parseHttpConfig(config);
                  onGenerate(config);
                } catch (error) {
                  setError(String(error));
                }
              }}
            >
              生成请求代码
            </button>
            <MotionButton
              trackBusy
              className="run-button"
              busy={!!running}
              outcome={error ? 'error' : response ? 'success' : ''}
              disabled={!running && (!canSendHttp() || (!window.devkitHttp && !remoteAccess()) || invalidDraft)}
              onClick={() => {
                if (running) void cancelHttp(running).catch((error) => setError(String(error)));
                else void send();
              }}
            >
              {running ? <Square size={14} /> : <Send size={14} />}
              {running ? '取消请求' : '发送请求'}
            </MotionButton>
          </div>
          <label className="http-sensitive">
            <input
              type="checkbox"
              checked={includeSensitive}
              disabled={!!running}
              onChange={(event) => setIncludeSensitive(event.target.checked)}
            />
            保存时包含完整 Headers、正文与敏感参数（明文）
          </label>
          {dirty && <p className="preview-note">请求草稿尚未保存。</p>}
          {!window.devkitHttp && !remoteAccess() && <p>请在桌面端或已登录的共享工作台发送请求。</p>}
          <div className="http-request">
            <HttpRequestInput
              advanced
              key={editorKey}
              onValidityChange={setInvalidDraft}
              value={config}
              onChange={(value) => {
                setConfig(value);
                if (response) setStale(true);
              }}
              disabled={!!running}
              wrap
              tabSize={2}
            />
          </div>
          <MotionReveal>
            <MotionPresence kind="panel" present={!!error}>
              {error && (
                <p className="task-error" role="alert">
                  {error}
                </p>
              )}
            </MotionPresence>
            {running && <p role="status">正在等待响应…</p>}
            <MotionPresence present={!!response}>
              {response && (
                <section className="http-response">
                  <div className="feature-toolbar">
                    <strong className={response.status >= 400 ? 'pc-invalid' : 'success-text'}>
                      {response.status} {response.statusText}
                    </strong>
                    <span>
                      {response.elapsed} ms · {response.bytes.toLocaleString()} 字节
                    </span>
                    {response.status >= 300 && response.status < 400 && <span>未跟随重定向</span>}
                    <MotionGroup className="http-response-tabs">
                      <button className="text-button" aria-pressed={responseTab === 'body'} onClick={() => setResponseTab('body')}>
                        响应正文
                      </button>
                      <button className="text-button" aria-pressed={responseTab === 'headers'} onClick={() => setResponseTab('headers')}>
                        响应头
                      </button>
                    </MotionGroup>
                    <MotionButton
                      variant="copy"
                      className="text-button"
                      onClick={() =>
                        void copyText(responseTab === 'body' ? responseBody : responseHeaders.map((row) => row.join(': ')).join('\n'))
                          .then(() => onNotice('响应已复制。'))
                          .catch((error) => setError(String(error)))
                      }
                    >
                      <Copy size={14} />
                      复制
                    </MotionButton>
                    <button
                      className="text-button"
                      onClick={() =>
                        void saveText(
                          responseTab === 'body' ? responseBody : responseHeaders.map((row) => row.join(': ')).join('\n'),
                          responseTab === 'body' && response.binary ? 'http-response.base64.txt' : 'http-response.txt'
                        ).catch((error) => setError(String(error)))
                      }
                    >
                      导出
                    </button>
                  </div>
                  <MotionPresence kind="panel" present={!!stale}>
                    {stale && <p className="stale-banner">请求已修改，此处为上次发送的响应。</p>}
                  </MotionPresence>
                  {response.binary && responseTab === 'body' && <p className="preview-note">二进制或无法解码的正文以 Base64 展示。</p>}
                  <div className="http-response-controls">
                    {responseTab === 'body' ? (
                      <>
                        <button className="text-button" aria-pressed={pretty} onClick={() => setPretty(true)}>
                          格式化
                        </button>
                        <button className="text-button" aria-pressed={!pretty} onClick={() => setPretty(false)}>
                          原始正文
                        </button>
                        <span className="preview-note">Ctrl / Cmd + F 搜索正文</span>
                      </>
                    ) : (
                      <input
                        aria-label="筛选响应头"
                        placeholder="筛选响应头…"
                        value={headerFilter}
                        onChange={(event) => setHeaderFilter(event.target.value)}
                      />
                    )}
                  </div>
                  {responseTab === 'headers' ? (
                    <div className="http-headers-table">
                      <table aria-label="HTTP 响应头">
                        <tbody>
                          {responseHeaders.map(([key, value], index) => (
                            <tr key={index}>
                              <td>{key}</td>
                              <td>{value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!responseHeaders.length && <p className="preview-note">没有匹配的响应头。</p>}
                    </div>
                  ) : (
                    <div className="http-response-editor">
                      <CodeEditor
                        label={responseTab === 'body' ? 'HTTP 响应正文' : 'HTTP 响应头'}
                        value={responseBody}
                        language={
                          responseTab === 'body' &&
                          response.headers.some(([key, value]) => key.toLowerCase() === 'content-type' && value.includes('json')) &&
                          !response.binary
                            ? 'json'
                            : 'text'
                        }
                        readOnly
                        wrap
                      />
                    </div>
                  )}
                </section>
              )}
            </MotionPresence>
          </MotionReveal>
        </div>
      </div>
    </section></>
  );
}
