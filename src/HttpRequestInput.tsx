import { MotionGroup } from './Motion';
import { useState } from 'react';
import CodeEditor from './CodeEditor';
import { jsonObjectFields, patchJsonField } from './result-model';

export default function HttpRequestInput({ value, disabled, onChange, wrap, tabSize }: { value: string; disabled: boolean; onChange: (value: string) => void; wrap: boolean; tabSize: number }) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  let config: Record<string, unknown> | null = null;
  let headers = '{}', body = 'null', reason = '';
  try {
    const fields = jsonObjectFields(value || '{}');
    const parsed: unknown = JSON.parse(value || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
    headers = fields.get('headers')?.raw ?? '{}'; body = fields.get('body')?.raw ?? 'null';
  } catch (error) { reason = error instanceof Error ? error.message : '配置无效'; }
  function update(key: string, next: string) { onChange(patchJsonField(value, key, next)); }
  return <div className="request-builder"><MotionGroup className="request-input-tabs"><button aria-pressed={mode === 'form'} onClick={() => setMode('form')}>请求表单</button><button aria-pressed={mode === 'json'} onClick={() => setMode('json')}>配置 JSON</button></MotionGroup><div className="request-json motion-mode" hidden={mode !== 'json' && !!config} inert={mode !== 'json' && !!config}>{!config && <p className="preview-note">{reason} 请先在配置 JSON 中修正，原文未改动。</p>}<div className="editor-body"><CodeEditor label="输入内容" language="json" value={value} onChange={onChange} readOnly={disabled} wrap={wrap} tabSize={tabSize} /></div></div>{config && <div className="request-form motion-mode" hidden={mode === "json"} inert={mode === "json"}><div><label>HTTP 方法<select aria-label="HTTP 方法" disabled={disabled} value={String(config.method || 'GET').toUpperCase()} onChange={event => update('method', event.target.value)}>{[...new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', String(config.method || 'GET').toUpperCase()])].map(method => <option key={method}>{method}</option>)}</select></label><label>请求 URL<input aria-label="请求 URL" disabled={disabled} value={typeof config.url === 'string' ? config.url : ''} onChange={event => update('url', event.target.value)} placeholder="https://example.com/api/users" /></label></div><p className="preview-note">Headers 与 body 请在「配置 JSON」中编辑，内容会同步到下方预览。</p><div><span>Headers · 预览</span><pre>{headers}</pre></div><div><span>Body · 预览</span><pre>{body}</pre></div></div>}</div>;
}
