import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowRight, Check, Copy, Download, ClipboardPaste, FlaskConical, Trash2, WrapText, LoaderCircle, AlertCircle, TerminalSquare, Upload, Undo2, Maximize2, Minimize2, Columns2, Rows2, Square, Send } from 'lucide-react';
import CodeEditor from './CodeEditor';
import type { EditorLanguage } from './CodeEditor';
import ToolOptions from './ToolOptions';
import ToolInput from './ToolInput';
import HttpRequestInput from './HttpRequestInput';
import ToolResult from './ToolResult';
import { tools } from './tools';
import type { ToolId } from './tools';
import type { Preferences, Task } from './workbench';
import { readText, saveText } from './files';
import { developerPresentation } from './tool-presentation';
import { experienceFor } from './tool-experience';

type Props = { task: Task; preferences: Preferences; onEdit: (patch: Partial<Task>) => void; onRun: () => void; onCancel: () => void; onNotice: (message: string) => void; onSend: (tool: ToolId, text: string) => void };
const statusLabels = { idle: '等待处理', running: '正在处理', success: '已完成', stale: '结果待更新', error: '处理失败', cancelled: '已取消' };
const previewTools = ['json', 'yaml', 'csv-json', 'json-csv', 'jwt', 'regex', 'url-inspect', 'password', 'uuid', 'diff', 'hash', 'hmac', 'timestamp', 'radix', 'css-unit'];

export default function ToolWorkspace({ task, preferences, onEdit, onRun, onCancel, onNotice, onSend }: Props) {
  const active = task.toolId, busy = task.status === 'running';
  const tool = tools.find(item => item.id === active)!;
  const experience = experienceFor(active, task.options), workflow = experience.workflow;
  const generated = workflow === 'generate', compact = ['lookup', 'calculate', 'permissions', 'schedule', 'inspect'].includes(workflow);
  const adjustable = ['convert', 'table', 'match'].includes(workflow);
  const [wrap, setWrap] = useState<boolean | null>(null), [layout, setLayout] = useState<'split' | 'stack' | null>(null);
  const [ratio, setRatio] = useState(50), [focus, setFocus] = useState(''), [preview, setPreview] = useState(true);
  const [documentTab, setDocumentTab] = useState('input'), [expected, setExpected] = useState('');
  const [undo, setUndo] = useState<Task | null>(null), [fileBusy, setFileBusy] = useState(false), [dragging, setDragging] = useState(false);
  const [destination, setDestination] = useState<ToolId>('base64');
  const inputFile = useRef<HTMLInputElement>(null), split = useRef<HTMLDivElement>(null);
  const presentation = developerPresentation(active, task.options);
  const inputLanguage: EditorLanguage = presentation?.input ?? (active === 'yaml' ? task.options.mode === 'json-yaml' ? 'json' : 'yaml' : active === 'sql' ? 'sql' : ['json', 'json-code', 'json-csv'].includes(active) ? 'json' : 'text');
  const outputLanguage: EditorLanguage = presentation?.output ?? (active === 'yaml' ? task.options.mode === 'json-yaml' ? 'yaml' : 'json' : active === 'sql' ? 'sql' : active === 'diff' ? 'diff' : ['json', 'jwt', 'regex', 'csv-json', 'url-inspect'].includes(active) ? 'json' : 'text');
  const canPreview = (presentation?.preview || previewTools.includes(active)) && !(active === 'yaml' && outputLanguage === 'yaml') && !!task.output;
  const currentResult = task.status === 'success';
  const showPreview = preview && canPreview && currentResult;
  const wrapping = wrap ?? preferences.wrap, arrangement = layout ?? preferences.layout;
  useEffect(() => { if (task.status === 'success') setDocumentTab('output'); }, [task.status]);
  let jsonOutput = false;
  if (task.output && task.output.length <= 300_000) { try { JSON.parse(task.output); jsonOutput = true; } catch { /* Plain text routing. */ } }
  const destinations = tools.filter(item => ['base64', 'url', 'html', 'hash', 'text', 'text-stats', 'xml', 'gzip', 'regex', 'diff', 'unicode', 'code-format', 'type-json', ...(jsonOutput ? ['json', 'json-code', 'json-csv', 'yaml', 'json-path', 'json-schema'] : [])].includes(item.id));

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); onNotice('已复制到剪贴板'); }
    catch { onNotice('剪贴板不可用，请选中文本后手动复制。'); }
  }
  async function load(file?: File) {
    if (!file || busy || fileBusy) return;
    setFileBusy(true);
    try {
      const { text, encoding } = await readText(file);
      setUndo(task); onEdit({ input: text, fileName: file.name, encoding }); setDocumentTab('input'); onNotice(`已导入 ${file.name} · ${encoding}`);
    } catch (error) { onNotice(error instanceof Error ? error.message : '文件导入失败'); }
    finally { setFileBusy(false); }
  }
  async function download() {
    const extension = presentation?.extension ?? (active === 'json-csv' ? task.options.delimiter === 'tab' ? 'tsv' : 'csv' : outputLanguage === 'typescript' ? 'ts' : outputLanguage === 'diff' ? 'patch' : outputLanguage === 'text' ? 'txt' : outputLanguage);
    const root = /^[A-Za-z_$][A-Za-z\d_$]*$/.test(task.options.rootName || '') ? task.options.rootName : 'Root';
    try { onNotice(await saveText(task.output, `${active === 'json-code' ? root : `devkit-${active}`}.${extension}`)); }
    catch (error) { onNotice(`保存失败：${String(error)}`); }
  }
  function editInput(input: string) { onEdit({ input }); }
  function sample() {
    setUndo(task); setDocumentTab('input');
    onEdit({ input: presentation?.sample ?? (active === 'yaml' && task.options.mode === 'json-yaml' ? '{"name":"DevKit","offline":true}' : tool.sample), fileName: undefined, encoding: undefined });
  }
  const editorProps = { wrap: wrapping, tabSize: Number(preferences.indent) };
  const options = <ToolOptions toolId={active} options={task.options} busy={busy || fileBusy} onChange={(key, value) => {
    // ULID switches between a quantity and an identifier; restore a usable input.
    if (active === 'ulid' && key === 'mode') { setUndo(task); onEdit({ input: value === 'parse' ? '01ARZ3NDEKTSV4RRFFQ69G5FAV' : '5', options: { ...task.options, [key]: value } }); }
    else onEdit({ options: { ...task.options, [key]: value } });
  }} />;
  const run = <div className="run-actions">{busy && <button className="secondary-button" onClick={onCancel}><Square size={13} />取消</button>}<button className="run-button" disabled={busy || fileBusy} onClick={onRun}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}{busy ? '正在处理' : experience.action}<kbd>Ctrl ↵</kbd></button></div>;
  const inputActions = !generated && <><button className="icon-button" title="导入文本文件" aria-label="导入文本文件" disabled={busy || fileBusy} onClick={() => inputFile.current?.click()}><Upload size={14} /></button><button className="icon-button" title="粘贴" aria-label="粘贴输入内容" disabled={busy || fileBusy} onClick={async () => { try { const text = await navigator.clipboard.readText(); setUndo(task); editInput(text); } catch { onNotice('请在编辑器内使用 Ctrl / Cmd + V 粘贴。'); } }}><ClipboardPaste size={14} /></button><button className="icon-button" title="清空输入（可撤销）" aria-label="清空输入" disabled={busy || fileBusy} onClick={() => { setUndo(task); onEdit({ input: '', fileName: undefined, encoding: undefined }); }}><Trash2 size={14} /></button></>;
  const maximize = (area: string) => <button className="icon-button" title={`最大化${area === 'input' ? '输入' : '结果'}区`} aria-label={`最大化${area === 'input' ? '输入' : '结果'}区`} onClick={() => setFocus(focus === area ? '' : area)}>{focus === area ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>;
  const inputPanel = <section className={`editor-card input-card ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy && !generated) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!generated) void load(event.dataTransfer.files[0]); }}>
    <div className="editor-title"><div className="editor-label"><span className="panel-dot" /><strong>{experience.input}</strong>{!compact && !generated && <small>{inputLanguage.toUpperCase()}</small>}</div><div className="editor-actions">{inputActions}{maximize('input')}</div></div>
    <input ref={inputFile} type="file" className="sr-only" aria-label="选择输入文件" accept=".json,.yaml,.yml,.csv,.tsv,.sql,.txt,.log,.xml,.md,.js,.ts,.java,.css,.html,.patch,.env,.properties,.scss,.jsx,.tsx,.sh" onChange={event => { void load(event.target.files?.[0]); event.target.value = ''; }} />
    {generated ? <div className="generator-config"><span className="result-kicker">{active === 'password' ? 'SECURE PASSWORD' : active.toUpperCase()}</span><h2>{active === 'password' ? '按需构造随机密码' : '批量生成唯一标识'}</h2>{options}{active !== 'password' && <label>生成数量<input aria-label={`${active.toUpperCase()} 生成数量`} type="number" min="1" max="1000" disabled={busy} value={task.input} onChange={event => editInput(event.target.value)} /><small>每次 1–1,000 个</small></label>}{run}<small>{active === 'ulid' ? 'ULID 含可见时间，不用于密码或令牌。' : '使用系统安全随机源，生成结果默认不落盘。'}</small></div> : <>
      {task.fileName && <div className="file-meta">{task.fileName}<span>{task.encoding || '文本'}</span></div>}
      {compact ? <div className="compact-form" onKeyDown={event => { if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !event.nativeEvent.isComposing && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox' && !busy && !fileBusy) { event.preventDefault(); onRun(); } }}><div className="compact-options">{options}</div><ToolInput id={active} value={task.input} options={task.options} label={experience.input} placeholder={experience.placeholder} disabled={busy || fileBusy} onChange={editInput} /><div className="compact-run">{run}</div></div> : active === 'http-code' ? <HttpRequestInput value={task.input} disabled={busy || fileBusy} onChange={editInput} {...editorProps} /> : <div className="editor-body"><CodeEditor label={active === 'diff' ? '原始文本' : '输入内容'} language={inputLanguage} value={task.input} onChange={editInput} readOnly={busy || fileBusy} {...editorProps} placeholder="粘贴内容，或拖入本地文本文件…" /></div>}
    </>}
    <div className="editor-footer"><span>{generated ? '本地生成' : `${task.input.split('\n').length} 行 · ${task.input.length.toLocaleString()} 字符`}</span><div>{undo && <button disabled={busy || fileBusy} onClick={() => { onEdit({ input: undo.input, options: undo.options, fileName: undo.fileName, encoding: undo.encoding }); setUndo(null); }}><Undo2 size={13} />撤销</button>}{!generated && <button disabled={busy || fileBusy} onClick={sample}><FlaskConical size={13} />示例</button>}</div></div>
  </section>;
  const outputPanel = <section className="editor-card output-card"><div className="editor-title"><div className="editor-label"><span className="panel-dot green" /><strong>{experience.output}</strong>{canPreview && <div className="view-toggle"><button aria-pressed={!preview} onClick={() => setPreview(false)}>源码</button><button aria-pressed={preview} onClick={() => setPreview(true)} disabled={!currentResult}>预览</button></div>}</div><div className="editor-actions"><button className="icon-button" title="复制结果" aria-label="复制结果" disabled={!task.output || busy} onClick={() => void copy(task.output)}><Copy size={14} /></button><button className="icon-button" title="另存结果" aria-label="导出结果文件" disabled={!task.output || busy} onClick={() => void download()}><Download size={14} /></button>{maximize('output')}</div></div>
    <div className="editor-body output-body"><div className="raw-result" hidden={showPreview}><CodeEditor label="处理结果" language={outputLanguage} value={task.output} readOnly {...editorProps} /></div>{showPreview && <div className="result-preview"><ToolResult id={active} text={task.output} source={task.input} options={task.options} expected={expected} onExpected={setExpected} onCopy={text => void copy(text)} /></div>}{!task.output && <div className="empty-state"><TerminalSquare size={30} strokeWidth={1.4} /><strong>{busy ? '正在你的设备上处理' : experience.output}</strong><p>{busy ? '可切换任务继续工作，也可以取消。' : generated ? '设置左侧参数后生成，可逐项复制结果。' : experience.hint}</p></div>}</div>
    {currentResult && workflow === 'codec' && <div className="conversion-summary"><span>输入 {task.input.length.toLocaleString()} 字符</span><ArrowRight size={13} /><span>输出 {task.output.length.toLocaleString()} 字符</span><small>差值 {task.output.length - task.input.length >= 0 ? '+' : ''}{(task.output.length - task.input.length).toLocaleString()}</small></div>}
    <div className="editor-footer"><span>{task.output.length.toLocaleString()} 字符 · {outputLanguage.toUpperCase()}</span>{currentResult && <span className="success-text"><Check size={12} />处理完成</span>}</div>
  </section>;
  return <div className={`text-workbench workflow-${workflow}`} data-tool={active}>
    <p className="workflow-intro">{experience.hint}</p>
    {!generated && !compact && <div className="toolbar">{options}{run}</div>}
    <div className="workbench-controls"><span className={`task-status status-${task.status}`} role="status"><span />{statusLabels[task.status]}{task.elapsed !== null && ` · ${task.elapsed || '<1'} ms`}</span><div>{!compact && !generated && <button className="text-button" onClick={() => setWrap(!wrapping)} aria-pressed={wrapping}><WrapText size={14} />换行</button>}{adjustable && <button className="text-button" onClick={() => setLayout(arrangement === 'split' ? 'stack' : 'split')} aria-label="切换编辑区布局">{arrangement === 'split' ? <Rows2 size={14} /> : <Columns2 size={14} />}{arrangement === 'split' ? '上下布局' : '左右布局'}</button>}</div></div>
    {task.status === 'stale' && task.output && <div className="stale-banner">输入或配置已变化。此处保留上次结果，重新处理后更新。</div>}
    {task.error && <div className="task-error" role="alert"><AlertCircle size={17} /><div><strong>本次处理失败</strong><p>{task.error}</p></div><button className="text-button" onClick={onRun}>重试</button></div>}
    {workflow === 'format' && <div className="document-tabs" aria-label="文档视图"><button aria-pressed={documentTab === 'input'} onClick={() => { setDocumentTab('input'); setFocus(''); }}>编辑原文</button><button aria-pressed={documentTab === 'output'} onClick={() => { setDocumentTab('output'); setFocus(''); }}>查看结果</button><small>原始文档与处理结果分别保留</small></div>}
    <div className={`editors experience-layout ${adjustable ? `editors-${arrangement}` : ''}`} data-focus={focus || undefined} data-document={documentTab} ref={split} style={{ '--split': `${ratio}%` } as CSSProperties}>
      {inputPanel}
      {workflow === 'compare' && <section className="editor-card target-card"><div className="editor-title"><strong>修改后文本</strong><div className="editor-actions"><button className="text-button" disabled={busy || fileBusy} onClick={() => onEdit({ input: task.options.target || '', options: { ...task.options, target: task.input } })}>交换两份文本</button><button className="icon-button" aria-label="清空修改后文本" disabled={busy} onClick={() => { setUndo(task); onEdit({ options: { ...task.options, target: '' } }); }}><Trash2 size={14} /></button></div></div><div className="editor-body"><CodeEditor label="修改后文本" value={task.options.target || ''} onChange={target => onEdit({ options: { ...task.options, target } })} readOnly={busy} {...editorProps} /></div><div className="editor-footer">{(task.options.target || '').length.toLocaleString()} 字符</div></section>}
      {adjustable && <div className="split-handle" role="separator" aria-label="调整输入与结果宽度" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={ratio} tabIndex={0} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setRatio(value => Math.max(25, Math.min(75, value + (event.key === 'ArrowLeft' ? -2 : 2)))); } }} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId) || !split.current) return; const rect = split.current.getBoundingClientRect(); setRatio(Math.max(25, Math.min(75, (event.clientX - rect.left) / rect.width * 100))); }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}><span /></div>}
      {outputPanel}
    </div>
    {task.output && <div className="result-routing"><span><Send size={14} />继续处理结果</span><select aria-label="结果发送目标" value={destination} onChange={event => setDestination(event.target.value as ToolId)}>{destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="secondary-button" disabled={busy || task.output.length > 2_000_000} onClick={() => onSend(destination, task.output)}>在新任务中打开<ArrowRight size={13} /></button>{!currentResult && <small>使用上次结果</small>}</div>}
    <details className="tool-help"><summary>使用提示与边界</summary><p>{tool.description}</p><p>输入上限 2,000,000 字符。正则任务超时 3 秒，其他文本任务 10 秒；可主动取消。JSON 结构预览保留数字原文与重复字段，支持最多 8,000 节点。</p><p>代码编辑器支持 Ctrl / Cmd + F 查找、撤销与重做；按 Esc 再按 Tab 离开编辑区。拖入文件会替换当前输入，可通过底部“撤销”恢复。</p></details>
  </div>;
}
