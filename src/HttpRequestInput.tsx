import { useState } from 'react';
import CodeEditor from './CodeEditor';

export default function HttpRequestInput({ value, disabled, onChange, wrap, tabSize }: { value: string; disabled: boolean; onChange: (value: string) => void; wrap: boolean; tabSize: number }) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  let config: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(value || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
  } catch { /* Keep invalid JSON editable without replacing it. */ }
  function update(key: string, next: unknown) { onChange(JSON.stringify({ ...config, [key]: next }, null, 2)); }
  return <div className="request-builder"><div className="request-input-tabs"><button aria-pressed={mode === 'form'} onClick={() => setMode('form')}>请求表单</button><button aria-pressed={mode === 'json'} onClick={() => setMode('json')}>配置 JSON</button></div>{mode === 'json' || !config ? <>{!config && <p className="preview-note">配置不是有效 JSON 对象，请先在源码中修正。</p>}<div className="editor-body"><CodeEditor label="输入内容" language="json" value={value} onChange={onChange} readOnly={disabled} wrap={wrap} tabSize={tabSize} /></div></> : <div className="request-form"><div><label>HTTP 方法<select aria-label="HTTP 方法" disabled={disabled} value={String(config.method || 'GET').toUpperCase()} onChange={event => update('method', event.target.value)}>{[...new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', String(config.method || 'GET').toUpperCase()])].map(method => <option key={method}>{method}</option>)}</select></label><label>请求 URL<input aria-label="请求 URL" disabled={disabled} value={typeof config.url === 'string' ? config.url : ''} onChange={event => update('url', event.target.value)} placeholder="https://example.com/api/users" /></label></div><p className="preview-note">Headers 与 body 请在「配置 JSON」中编辑，内容会同步到下方预览。</p><div><span>Headers · 预览</span><pre>{JSON.stringify(config.headers ?? {}, null, 2)}</pre></div><div><span>Body · 预览</span><pre>{typeof config.body === 'string' ? config.body : JSON.stringify(config.body ?? null, null, 2)}</pre></div></div>}</div>;
}
