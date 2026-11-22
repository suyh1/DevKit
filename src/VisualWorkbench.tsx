import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { downloadBlob, readText } from './files';
import { copyText } from './motion-primitives';
import { MotionButton } from './Motion';
import ToolOptions from './ToolOptions';
import { flexCss, flexStyle, makeQr } from './visual-tools';
import type { Task } from './workbench';
import type { Notify } from './ToastStack';
import './visual-workbench.css';

type Props = { task: Task; onEdit: (patch: Partial<Task>) => void; onNotice: Notify };

function QrPanel({ task, onEdit, onNotice }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(false);
  const size = Number(task.options.size);
  const result = useMemo(() => {
    if (!task.input) return {};
    try { return { qr: makeQr(task.input, task.options) }; }
    catch (error) { return { error: error instanceof Error ? error.message : '无法生成二维码。' }; }
  }, [task.input, task.options.level]);
  const validSize = [256, 384, 512, 1024].includes(size);
  useEffect(() => {
    const qr = result.qr, ctx = canvas.current?.getContext('2d');
    if (!qr || !ctx || !validSize) return;
    const count = qr.getModuleCount(), cell = Math.floor(size / (count + 8));
    const origin = Math.floor((size - count * cell) / 2);
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = 'black';
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
      if (qr.isDark(y, x)) ctx.fillRect(origin + x * cell, origin + y * cell, cell, cell);
    }
  }, [result, size, validSize]);
  async function importFile(file?: File) {
    if (!file || loading) return;
    setLoading(true);
    try { onEdit({ input: (await readText(file)).text, fileName: file.name }); }
    catch (error) { onNotice(String(error), 'error'); }
    finally { setLoading(false); }
  }
  return <>
    <section className="editor-card visual-controls" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void importFile(e.dataTransfer.files[0]); }}>
      <label>文本或链接<textarea maxLength={2_000_000} value={task.input} disabled={loading} onChange={e => onEdit({ input: e.target.value })} /></label>
      <label>导入文本文件<input type="file" disabled={loading} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
      <ToolOptions toolId="qr-code" options={task.options} busy={loading} onChange={(key, value) => onEdit({ options: { ...task.options, [key]: value } })} />
    </section>
    <section className="editor-card visual-preview">
      {result.qr && validSize ? <><canvas ref={canvas} width={size} height={size} aria-label="二维码预览" />
        <MotionButton className="secondary-button" onClick={() => canvas.current?.toBlob(blob => {
          if (blob) { downloadBlob(blob, 'devkit-qr.png'); onNotice('已请求保存 PNG', 'success'); }
          else onNotice('PNG 编码失败', 'error');
        }, 'image/png')}>保存 PNG</MotionButton></> : <p role="status">{result.error || (!validSize ? '请选择图片尺寸。' : '输入内容后预览二维码。')}</p>}
    </section>
  </>;
}

function FlexPanel({ task, onEdit, onNotice }: Props) {
  const options = task.options;
  let style: CSSProperties = {}, css = '', error = '';
  try { style = flexStyle(options) as CSSProperties; css = flexCss(options); }
  catch (e) { error = e instanceof Error ? e.message : '参数无效'; }
  return <>
    <section className="editor-card visual-controls"><ToolOptions toolId="css-flex" options={options} busy={false} onChange={(key, value) => onEdit({ options: { ...options, [key]: value } })} /></section>
    <section className="editor-card visual-preview">{error ? <p role="alert">{error}</p> : <>
      <div className="flex-scroll"><div className="flex-stage" style={style} aria-label="Flex 容器">{['A', 'B', 'C'].map(letter => <div key={letter}>{letter}</div>)}</div></div>
      <pre>{css}</pre><MotionButton className="secondary-button" variant="copy" onClick={async () => {
        try { await copyText(css); onNotice('已复制 CSS', 'success'); }
        catch { onNotice('复制失败，请选择代码手动复制。', 'error'); }
      }}>复制 CSS</MotionButton>
    </>}</section>
  </>;
}

export default function VisualWorkbench(props: Props) {
  return <div className="visual-workbench" data-live-tool={props.task.toolId}>{props.task.toolId === 'qr-code' ? <QrPanel {...props} /> : <FlexPanel {...props} />}</div>;
}
