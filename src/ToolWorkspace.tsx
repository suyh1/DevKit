import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowRight, Check, Copy, Download, ClipboardPaste, FlaskConical, Trash2, WrapText, LoaderCircle, AlertCircle, TerminalSquare, Upload, Undo2, Maximize2, Minimize2, Columns2, Rows2, Square, Send } from 'lucide-react';
import CodeEditor from './CodeEditor';
import type { EditorLanguage } from './CodeEditor';
import ToolOptions from './ToolOptions';
import ResultView from './ResultView';
import { tools } from './tools';
import type { ToolId } from './tools';
import type { Preferences, Task } from './workbench';
import { readText, saveText } from './files';
import { developerPresentation } from './tool-presentation';

type Props = { task: Task; preferences: Preferences; onEdit: (patch: Partial<Task>) => void; onRun: () => void; onCancel: () => void; onNotice: (message: string) => void; onSend: (tool: ToolId, text: string) => void };
const statusLabels = { idle: '等待处理', running: '正在处理', success: '已完成', stale: '结果待更新', error: '处理失败', cancelled: '已取消' };
const structuredTools = ['json', 'yaml', 'csv-json', 'jwt', 'regex', 'url-inspect', 'password', 'uuid', 'diff'];

export default function ToolWorkspace({ task, preferences, onEdit, onRun, onCancel, onNotice, onSend }: Props) {
  const active = task.toolId, busy = task.status === 'running';
  const tool = tools.find(item => item.id === active)!;
  const [wrap, setWrap] = useState<boolean | null>(null), [layout, setLayout] = useState<'split' | 'stack' | null>(null);
  const [ratio, setRatio] = useState(50), [focus, setFocus] = useState(''), [preview, setPreview] = useState(true);
  const [undo, setUndo] = useState<Task | null>(null), [fileBusy, setFileBusy] = useState(false), [dragging, setDragging] = useState(false);
  const [destination, setDestination] = useState<ToolId>('base64');
  const inputFile = useRef<HTMLInputElement>(null), split = useRef<HTMLDivElement>(null);
  const presentation = developerPresentation(active, task.options);
  const inputLanguage: EditorLanguage = presentation?.input ?? (active === 'yaml' ? task.options.mode === 'json-yaml' ? 'json' : 'yaml' : active === 'sql' ? 'sql' : ['json', 'json-code', 'json-csv'].includes(active) ? 'json' : 'text');
  const outputLanguage: EditorLanguage = presentation?.output ?? (active === 'yaml' ? task.options.mode === 'json-yaml' ? 'yaml' : 'json' : active === 'sql' ? 'sql' : active === 'diff' ? 'diff' : ['json', 'jwt', 'regex', 'csv-json', 'url-inspect'].includes(active) ? 'json' : 'text');
  const canPreview = (presentation?.preview || structuredTools.includes(active)) && !(active === 'yaml' && outputLanguage === 'yaml') && !!task.output;
  const showPreview = preview && canPreview && task.status !== 'stale' && task.status !== 'running' && task.status !== 'error';
  const wrapping = wrap ?? preferences.wrap, arrangement = layout ?? preferences.layout;
  const generated = active === 'uuid' || active === 'password';
  let jsonOutput = false;
  if (task.output && task.output.length <= 300_000) { try { JSON.parse(task.output); jsonOutput = true; } catch { jsonOutput = false; } }
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
      setUndo(task); onEdit({ input: text, fileName: file.name, encoding }); onNotice(`已导入 ${file.name} · ${encoding}`);
    } catch (error) { onNotice(error instanceof Error ? error.message : '文件导入失败'); }
    finally { setFileBusy(false); }
  }
  async function download() {
    const extension = presentation?.extension ?? (active === 'json-csv' ? task.options.delimiter === 'tab' ? 'tsv' : 'csv' : outputLanguage === 'typescript' ? 'ts' : outputLanguage === 'diff' ? 'patch' : outputLanguage === 'text' ? 'txt' : outputLanguage);
    const root = /^[A-Za-z_$][A-Za-z\d_$]*$/.test(task.options.rootName || '') ? task.options.rootName : 'Root';
    const name = active === 'json-code' ? root : `devkit-${active}`;
    try { onNotice(await saveText(task.output, `${name}.${extension}`)); }
    catch (error) { onNotice(`保存失败：${String(error)}`); }
  }
  function clear() { setUndo(task); onEdit({ input: '', fileName: undefined, encoding: undefined }); }
  const editorProps = { wrap: wrapping, tabSize: Number(preferences.indent) };
  return <div className={`text-workbench ${generated ? 'generator-workbench' : ''}`}>
    <div className="toolbar"><ToolOptions toolId={active} options={task.options} busy={busy || fileBusy} onChange={(key, value) => onEdit({ options: { ...task.options, [key]: value } })} /><div className="run-actions">{busy ? <button className="secondary-button" onClick={onCancel}><Square size={13} />取消</button> : null}<button className="run-button" disabled={busy || fileBusy} onClick={onRun}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowRight size={15} />}{busy ? '正在处理' : generated ? '生成结果' : active === 'diff' ? '对比文本' : '开始处理'}<kbd>Ctrl ↵</kbd></button></div></div>
    <div className="workbench-controls"><span className={`task-status status-${task.status}`}><span />{statusLabels[task.status]}{task.elapsed !== null && ` · ${task.elapsed || '<1'} ms`}</span><div><button className="text-button" onClick={() => setWrap(!wrapping)} aria-pressed={wrapping}><WrapText size={14} />换行</button><button className="text-button" onClick={() => setLayout(arrangement === 'split' ? 'stack' : 'split')} aria-label="切换编辑区布局">{arrangement === 'split' ? <Rows2 size={14} /> : <Columns2 size={14} />}{arrangement === 'split' ? '上下布局' : '左右布局'}</button></div></div>
    {task.status === 'stale' && task.output && <div className="stale-banner">输入或配置已变化。此处保留上次结果，重新处理后更新。</div>}
    {task.error && <div className="task-error" role="alert"><AlertCircle size={17} /><div><strong>本次处理失败</strong><p>{task.error}</p></div><button className="text-button" onClick={onRun}>重试</button></div>}
    <div className={`editors editors-${arrangement}`} data-focus={focus || undefined} ref={split} style={{ '--split': `${ratio}%` } as CSSProperties}>
      <section className={`editor-card input-card ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy && !generated) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!generated) void load(event.dataTransfer.files[0]); }}>
        <div className="editor-title"><div className="editor-label"><span className="panel-dot" /><strong>{generated ? '生成配置' : active === 'diff' ? '原始文本' : '输入'}</strong><small>{generated ? 'GENERATOR' : inputLanguage.toUpperCase()}</small></div><div className="editor-actions">{!generated && <><button className="icon-button" title="导入文本文件" aria-label="导入文本文件" disabled={busy || fileBusy} onClick={() => inputFile.current?.click()}><Upload size={14} /></button><button className="icon-button" title="粘贴" aria-label="粘贴输入内容" disabled={busy || fileBusy} onClick={async () => { try { const text = await navigator.clipboard.readText(); setUndo(task); onEdit({ input: text }); } catch { onNotice('请在编辑器内使用 Ctrl / Cmd + V 粘贴。'); } }}><ClipboardPaste size={14} /></button><button className="icon-button" title="清空输入（可撤销）" aria-label="清空输入" disabled={busy || fileBusy} onClick={clear}><Trash2 size={14} /></button></>}<button className="icon-button" title="最大化输入区" aria-label="最大化输入区" onClick={() => setFocus(focus === 'input' ? '' : 'input')}>{focus === 'input' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button></div></div>
        <input ref={inputFile} type="file" className="sr-only" aria-label="选择输入文件" accept=".json,.yaml,.yml,.csv,.tsv,.sql,.txt,.log,.xml,.md,.js,.ts,.java,.css,.html,.patch,.env,.properties,.scss,.jsx,.tsx,.sh" onChange={event => { void load(event.target.files?.[0]); event.target.value = ''; }} />
        {generated ? <div className="generator-config"><span className="generator-icon"><TerminalSquare size={30} /></span><h2>{active === 'uuid' ? '唯一标识，随用随取' : '为下一次登录生成密码'}</h2><p>使用系统安全随机源，在本地生成。</p>{active === 'uuid' ? <label>生成数量<input aria-label="UUID 生成数量" type="number" min="1" max="1000" disabled={busy} value={task.input} onChange={event => onEdit({ input: event.target.value })} /><small>每次 1–1,000 个 UUID v4</small></label> : <dl><div><dt>长度</dt><dd>{task.options.length}<small> 位</small></dd></div><div><dt>数量</dt><dd>{task.options.count}<small> 条</small></dd></div></dl>}<small>生成结果默认不落盘，请按需复制或保存。</small></div> : <>
          {task.fileName && <div className="file-meta">{task.fileName}<span>{task.encoding || '文本'}</span></div>}
          <div className="editor-body"><CodeEditor label={active === 'diff' ? '原始文本' : '输入内容'} language={inputLanguage} value={task.input} onChange={input => onEdit({ input })} readOnly={busy || fileBusy} {...editorProps} placeholder="粘贴内容，或拖入本地文本文件…" /></div>
          {active === 'diff' && <><div className="editor-title diff-target-heading"><strong>修改后文本</strong><button className="text-button" disabled={busy} onClick={() => onEdit({ input: task.options.target || '', options: { ...task.options, target: task.input } })}>交换两侧</button></div><div className="editor-body"><CodeEditor label="修改后文本" value={task.options.target || ''} onChange={target => onEdit({ options: { ...task.options, target } })} readOnly={busy} {...editorProps} /></div></>}
        </>}
        <div className="editor-footer"><span>{generated ? '安全随机源' : `${task.input.split('\n').length} 行 · ${task.input.length.toLocaleString()} 字符`}</span><div>{undo && <button disabled={busy || fileBusy} onClick={() => { onEdit({ input: undo.input, options: undo.options, fileName: undo.fileName, encoding: undo.encoding }); setUndo(null); }}><Undo2 size={13} />撤销</button>}{!generated && <button disabled={busy || fileBusy} onClick={() => { setUndo(task); onEdit({ input: presentation?.sample ?? (active === 'yaml' && task.options.mode === 'json-yaml' ? '{"name":"DevKit","offline":true}' : tool.sample), fileName: undefined, encoding: undefined }); }}><FlaskConical size={13} />示例</button>}</div></div>
      </section>
      <div className="split-handle" role="separator" aria-label="调整输入与结果宽度" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={ratio} tabIndex={0} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setRatio(value => Math.max(25, Math.min(75, value + (event.key === 'ArrowLeft' ? -2 : 2)))); } }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId) || !split.current) return; const rect = split.current.getBoundingClientRect(); setRatio(Math.max(25, Math.min(75, (event.clientX - rect.left) / rect.width * 100))); }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)}><span /></div>
      <section className="editor-card output-card"><div className="editor-title"><div className="editor-label"><span className="panel-dot green" /><strong>结果</strong>{canPreview && <div className="view-toggle"><button aria-pressed={!preview} onClick={() => setPreview(false)}>源码</button><button aria-pressed={preview} onClick={() => setPreview(true)} disabled={task.status === 'stale' || busy || task.status === 'error'}>预览</button></div>}</div><div className="editor-actions"><button className="icon-button" title="复制结果" aria-label="复制结果" disabled={!task.output || busy} onClick={() => void copy(task.output)}><Copy size={14} /></button><button className="icon-button" title="另存结果" aria-label="导出结果文件" disabled={!task.output || busy} onClick={() => void download()}><Download size={14} /></button><button className="icon-button" title="最大化结果区" aria-label="最大化结果区" onClick={() => setFocus(focus === 'output' ? '' : 'output')}>{focus === 'output' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button></div></div>
        <div className="editor-body output-body"><div className="raw-result" hidden={showPreview}><CodeEditor label="处理结果" language={outputLanguage} value={task.output} readOnly {...editorProps} /></div>{showPreview && <div className="result-preview"><ResultView toolId={active} text={task.output} source={task.input} onCopy={text => void copy(text)} /></div>}{!task.output && <div className="empty-state"><TerminalSquare size={30} strokeWidth={1.4} /><strong>{busy ? '正在你的设备上处理' : '准备好后，开始处理'}</strong><p>{busy ? '可切换任务继续工作，也可以取消。' : generated ? '调整生成配置，结果会显示在这里。' : '输入内容或使用示例，按 Ctrl / Cmd + Enter。'}</p></div>}</div>
        <div className="editor-footer"><span>{task.output.length.toLocaleString()} 字符 · {outputLanguage.toUpperCase()}</span>{task.status === 'success' && <span className="success-text"><Check size={12} />处理完成</span>}</div>
      </section>
    </div>
    {task.output && <div className="result-routing"><span><Send size={14} />继续处理结果</span><select aria-label="结果发送目标" value={destination} onChange={event => setDestination(event.target.value as ToolId)}>{destinations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="secondary-button" disabled={busy || task.output.length > 2_000_000} onClick={() => onSend(destination, task.output)}>在新任务中打开<ArrowRight size={13} /></button>{task.status !== 'success' && <small>使用上次结果</small>}</div>}
    <details className="tool-help"><summary>使用提示与边界</summary><p>{tool.description}</p><p>输入上限 2,000,000 字符。正则任务超时 3 秒，其他文本任务 10 秒；可主动取消。JSON 结构预览保留数字原文与重复字段，支持最多 8,000 节点。</p><p>编辑器支持 Ctrl / Cmd + F 查找、撤销与重做；按 Esc 再按 Tab 离开编辑区。拖入文件会替换当前输入，可通过底部“撤销”恢复。</p></details>
  </div>;
}


