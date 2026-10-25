import { MotionGroup } from './Motion';
import { useEffect, useRef, useState } from 'react';
import CodeEditor from './CodeEditor';
import HttpKeyValues from './HttpKeyValues';
import { jsonObjectFields, patchJsonField } from './result-model';
import {
  basicAuthorization,
  httpHeaderEntries,
  queryRows,
  withAuthorization,
  withHeaderRows,
  withHttpBody,
  withQueryRows
} from './http-builder';
import type { HttpRow } from './http-builder';
import './http-builder.css';

type BodyKind = 'json' | 'text' | 'form';
export default function HttpRequestInput({
  value,
  disabled,
  onChange,
  wrap,
  tabSize,
  onValidityChange,
  advanced = false
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  wrap: boolean;
  tabSize: number;
  onValidityChange?: (invalid: boolean) => void;
  advanced?: boolean;
}) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [tab, setTab] = useState('params'),
    [error, setError] = useState('');
  const [params, setParams] = useState<HttpRow[]>([]),
    [headers, setHeaders] = useState<HttpRow[]>([]),
    [form, setForm] = useState<HttpRow[]>([]);
  const [body, setBody] = useState(''),
    [kind, setKind] = useState<BodyKind>('json');
  const [authKind, setAuthKind] = useState('bearer'),
    [token, setToken] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const emitted = useRef<string | null>(null);
  let config: Record<string, unknown> | null = null,
    reason = '';
  try {
    const fields = jsonObjectFields(value || '{}');
    if (advanced && fields.has('headers')) {
      for (const node of jsonObjectFields(fields.get('headers')!.raw).values()) {
        if (typeof JSON.parse(node.raw) !== 'string') throw new Error('请求头值必须为字符串。');
      }
    }
    const parsed: unknown = JSON.parse(value || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
  } catch (error) {
    reason = error instanceof Error ? error.message : '配置无效';
  }
  function sync(source: string) {
    try {
      const fields = jsonObjectFields(source || '{}'),
        parsed = JSON.parse(source || '{}');
      setParams(queryRows(typeof parsed.url === 'string' ? parsed.url : ''));
      const entries = [...jsonObjectFields(fields.get('headers')?.raw ?? '{}')];
      setHeaders(entries.map(([key, node]) => ({ key, value: String(JSON.parse(node.raw)), enabled: true })));
      const raw = fields.get('body')?.raw;
      const type = entries.find(([key]) => key.toLowerCase() === 'content-type')?.[1].raw ?? '';
      const nextKind = type.includes('application/x-www-form-urlencoded')
        ? 'form'
        : type.includes('json')
          ? 'json'
          : raw && raw.startsWith('"')
            ? 'text'
            : 'json';
      const text = raw ? (raw.startsWith('"') ? (JSON.parse(raw) as string) : raw) : '';
      setBody(text);
      setKind(nextKind);
      setForm(nextKind === 'form' ? formRows(text) : []);
      setToken('');
      setUsername('');
      setPassword('');
      setError('');
    } catch {
      /* Keep incomplete source untouched and expose the JSON editor. */
    }
  }
  useEffect(() => {
    if (value !== emitted.current) sync(value);
    emitted.current = null;
  }, [value]);
  function emit(next: string) {
    emitted.current = next;
    onChange(next);
  }
  function attempt(action: () => string) {
    try {
      emit(action());
      setError('');
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function update(key: string, next: string) {
    attempt(() => patchJsonField(value, key, next));
  }
  function syncHeader(source: string, name: string) {
    const active = [...jsonObjectFields(jsonObjectFields(source).get('headers')?.raw ?? '{}')]
      .filter(([key]) => key.toLowerCase() === name.toLowerCase())
      .map(([key, node]) => ({ key, value: String(JSON.parse(node.raw)), enabled: true }));
    // A body/auth change must not discard unrelated, temporarily invalid header rows.
    setHeaders((current) => {
      const index = current.findIndex((row) => row.enabled && row.key.toLowerCase() === name.toLowerCase());
      const next = current.filter((row) => !row.enabled || row.key.toLowerCase() !== name.toLowerCase());
      next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, ...active);
      return next;
    });
  }
  function changeBody(text: string, nextKind = kind) {
    setBody(text);
    attempt(() => {
      const next = withHttpBody(value, text, nextKind);
      syncHeader(next, 'Content-Type');
      return next;
    });
  }
  let headerProblem = '';
  try {
    httpHeaderEntries(headers);
  } catch (error) {
    headerProblem = (error as Error).message;
  }
  const bodyPending = !!error || !!headerProblem;
  useEffect(() => {
    onValidityChange?.(bodyPending);
  }, [bodyPending, onValidityChange]);
  useEffect(() => {
    if (!bodyPending) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [bodyPending]);
  function formRows(text: string): HttpRow[] {
    return [...new URLSearchParams(text)].map(([key, value]) => ({ key, value, enabled: true }));
  }
  return (
    <div className="request-builder">
      <MotionGroup className="request-input-tabs">
        <button
          aria-pressed={mode === 'form'}
          onClick={() => {
            if (mode !== 'form') sync(value);
            setMode('form');
          }}
        >
          请求表单
        </button>
        <button aria-pressed={mode === 'json'} disabled={bodyPending} onClick={() => setMode('json')}>
          配置 JSON
        </button>
      </MotionGroup>
      <div className="request-json motion-mode" hidden={mode !== 'json' && !!config} inert={mode !== 'json' && !!config}>
        {!config && <p className="preview-note">{reason} 请先在配置 JSON 中修正，原文未改动。</p>}
        <div className="editor-body">
          <CodeEditor
            label="输入内容"
            language="json"
            value={value}
            onChange={onChange}
            readOnly={disabled}
            wrap={wrap}
            tabSize={tabSize}
          />
        </div>
      </div>
      {config && (
        <div className="request-form motion-mode" hidden={mode === 'json'} inert={mode === 'json'}>
          <div className="http-address">
            <label>
              HTTP 方法
              <select
                aria-label="HTTP 方法"
                disabled={disabled}
                value={String(config.method || 'GET').toUpperCase()}
                onChange={(event) => update('method', event.target.value)}
              >
                {[
                  ...new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', String(config.method || 'GET').toUpperCase()])
                ].map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
            </label>
            <label>
              请求 URL
              <input
                aria-label="请求 URL"
                disabled={disabled}
                value={typeof config.url === 'string' ? config.url : ''}
                onChange={(event) => {
                  const next = patchJsonField(value, 'url', event.target.value);
                  setParams(queryRows(event.target.value));
                  emit(next);
                }}
                placeholder="https://example.com/api/users"
              />
            </label>
          </div>
          {advanced ? (
            <>
              <div className="http-edit-tabs" aria-label="请求编辑区域">
                {[
                  ['params', `参数 ${params.filter((row) => row.key && row.enabled).length}`],
                  ['headers', `请求头 ${headers.filter((row) => row.key && row.enabled).length}`],
                  ['auth', '鉴权'],
                  ['body', '正文']
                ].map(([id, label]) => (
                  <button className="text-button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
              </div>
              {tab === 'params' && (
                <HttpKeyValues
                  label="参数"
                  rows={params}
                  disabled={disabled}
                  onChange={(rows) => {
                    setParams(rows);
                    update('url', withQueryRows(String(config!.url || ''), rows));
                  }}
                />
              )}
              {tab === 'headers' && (
                <HttpKeyValues
                  label="请求头"
                  rows={headers}
                  disabled={disabled}
                  onChange={(rows) => {
                    setHeaders(rows);
                    attempt(() => withHeaderRows(value, rows));
                  }}
                />
              )}
              {tab === 'auth' && (
                <div className="http-auth">
                  <label>
                    鉴权类型
                    <select
                      aria-label="鉴权类型"
                      value={authKind}
                      disabled={disabled}
                      onChange={(event) => setAuthKind(event.target.value)}
                    >
                      <option value="bearer">Bearer Token</option>
                      <option value="basic">Basic Auth</option>
                      <option value="none">无鉴权</option>
                    </select>
                  </label>
                  {authKind === 'bearer' && (
                    <label>
                      Token
                      <input
                        aria-label="Bearer Token"
                        type="password"
                        autoComplete="off"
                        value={token}
                        disabled={disabled}
                        onChange={(event) => setToken(event.target.value)}
                      />
                    </label>
                  )}
                  {authKind === 'basic' && (
                    <>
                      <label>
                        用户名
                        <input
                          aria-label="Basic 用户名"
                          autoComplete="off"
                          value={username}
                          disabled={disabled}
                          onChange={(event) => setUsername(event.target.value)}
                        />
                      </label>
                      <label>
                        密码
                        <input
                          aria-label="Basic 密码"
                          type="password"
                          autoComplete="off"
                          value={password}
                          disabled={disabled}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </label>
                    </>
                  )}
                  <button
                    className="secondary-button"
                    disabled={disabled}
                    onClick={() =>
                      attempt(() => {
                        const next = withAuthorization(
                          value,
                          authKind === 'bearer' ? 'Bearer ' + token : authKind === 'basic' ? basicAuthorization(username, password) : ''
                        );
                        syncHeader(next, 'Authorization');
                        return next;
                      })
                    }
                  >
                    应用到请求头
                  </button>
                  <p className="preview-note">显式应用后写入 Authorization；可在请求头中检查或修改。</p>
                </div>
              )}
              {tab === 'body' && (
                <div className="http-body">
                  <div className="feature-toolbar">
                    <label>
                      正文类型
                      <select
                        aria-label="正文类型"
                        value={kind}
                        disabled={disabled}
                        onChange={(event) => {
                          const nextKind = event.target.value as BodyKind;
                          setKind(nextKind);
                          setError('');
                          if (nextKind === 'form') setForm(formRows(body));
                          if (body) changeBody(body, nextKind);
                        }}
                      >
                        {[
                          ['json', 'JSON'],
                          ['text', '纯文本'],
                          ['form', '表单 URL Encoded']
                        ].map(([key, label]) => (
                          <option value={key} key={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="text-button"
                      disabled={disabled}
                      onClick={() => {
                        const fields = jsonObjectFields(value || '{}'),
                          node = fields.get('body');
                        setBody('');
                        setForm([]);
                        setError('');
                        if (node) emit(value.slice(0, node.start) + '""' + value.slice(node.end));
                      }}
                    >
                      清空正文
                    </button>
                  </div>
                  {kind === 'form' ? (
                    <HttpKeyValues
                      label="表单字段"
                      rows={form}
                      disabled={disabled}
                      onChange={(rows) => {
                        setForm(rows);
                        changeBody(
                          new URLSearchParams(rows.filter((row) => row.enabled && row.key).map((row) => [row.key, row.value])).toString(),
                          'form'
                        );
                      }}
                    />
                  ) : (
                    <div className="http-body-editor">
                      <CodeEditor
                        label="HTTP 请求正文"
                        language={kind === 'json' ? 'json' : 'text'}
                        value={body}
                        onChange={changeBody}
                        readOnly={disabled}
                        wrap={wrap}
                        tabSize={tabSize}
                      />
                    </div>
                  )}
                  <p className="preview-note">JSON 保留大整数原文；GET / HEAD 请清空正文。类型会同步 Content-Type。</p>
                </div>
              )}
              {(headerProblem || error) && (
                <p className="task-error" role="alert">
                  {headerProblem || error} 请修正后继续。
                </p>
              )}
            </>
          ) : (
            <>
              <p className="preview-note">Headers 与 body 请在「配置 JSON」中编辑，内容会同步到下方预览。</p>
              <div>
                <span>Headers · 预览</span>
                <pre>{jsonObjectFields(value || '{}').get('headers')?.raw ?? '{}'}</pre>
              </div>
              <div>
                <span>Body · 预览</span>
                <pre>{jsonObjectFields(value || '{}').get('body')?.raw ?? 'null'}</pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
