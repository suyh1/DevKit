import { copyText } from './motion-primitives';
import { MotionButton, MotionPresence, MotionDetails } from './Motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Copy, Download, FlaskConical, Square, Upload, Undo2 } from 'lucide-react';
import SegmentedControl from './SegmentedControl';
import type { Options } from './tools';
import type { Task } from './workbench';
import { geoDefaults, geoSample, geoSignature } from './geo-config';
import type { GeoMode } from './geo-config';
import { coordinateCells, coordinateInput, coordinatesText, decimalText, dmsText, splitCoordinatePair, readGeoCache } from './geography';
import type { GeoPoint } from './geography';
import { readText, saveText } from './files';

type Props = { task: Task; onEdit: (patch: Partial<Task>) => void; onRun: () => void; onCancel: () => void; onNotice: (message: string) => void };
const names: Record<string, string> = { north: '正北', east: '正东', south: '正南', west: '正西' };
const statuses = { idle: '等待处理', running: '正在处理', success: '已完成', error: '处理失败', stale: '参数已修改', cancelled: '已取消' };
export default function GeoWorkbench({ task, onEdit, onRun, onCancel, onNotice }: Props) {
  const o = { ...geoDefaults, ...task.options }, mode = o.mode as GeoMode, busy = task.status === 'running';
  const [pairInput, setPairInput] = useState(''), [page, setPage] = useState(0), [undo, setUndo] = useState<Task | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const cache = useMemo(() => readGeoCache(task.output), [task.output]);
  const result = cache[mode];
  const current = !!result && task.elapsed !== null && result.signature === geoSignature(task.input, o) && !['running', 'error', 'cancelled'].includes(task.status);
  const ready = current && !!result?.points.length;
  const status = current ? 'success' : task.status;
  useEffect(() => setPage(0), [task.output, mode]);
  function update(patch: Options) { onEdit({ options: { ...task.options, ...patch } }); }
  async function copy(text: string) {
    try { await copyText(text); onNotice('已复制坐标'); }
    catch { onNotice('剪贴板不可用，请选中结果后手动复制。'); }
  }
  function sample() {
    setUndo(task);
    if (mode === 'extract') onEdit({ input: geoSample });
    else if (mode === 'circle') update({ centerLon: '116.3913', centerLat: '39.9075', radius: '1000', unit: 'm' });
    else update({ lon: '东经116度23分28.68秒', lat: '北纬39度54分27秒' });
  }
  async function load(source?: File) {
    if (!source) return;
    try { const { text, encoding } = await readText(source); if (text.length > 300_000) throw new Error('文本提取最多支持 300,000 字符。'); setUndo(task); onEdit({ input: text, fileName: source.name, encoding }); }
    catch (error) { onNotice((error as Error).message); }
  }
  const field = (key: string, label: string, placeholder?: string) => <label className="geo-field"><span>{label}</span><input aria-label={label} value={o[key]} placeholder={placeholder} disabled={busy} autoComplete="off" spellCheck={false} onChange={e => update({ [key]: e.target.value })} /></label>;
  const select = (key: string, label: string, choices: [string, string][]) => <label className="geo-field"><span>{label}</span><select aria-label={label} value={o[key]} disabled={busy} onChange={e => update({ [key]: e.target.value })}>{choices.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>;
  const outputOptions = (representation: string) => ({ ...o, representation });
  function usePoint(point: GeoPoint, target: 'convert' | 'circle') {
    const fields = coordinateInput(point);
    setUndo(task);
    update(target === 'circle' ? { mode: target, centerLon: fields.lon, centerLat: fields.lat } : { mode: target, ...fields });
  }
  const pointActions = (point: GeoPoint) => <div className="geo-point-actions">
    <button className="text-button" disabled={!current} onClick={() => void copy(coordinatesText([point], { ...outputOptions('decimal'), headers: 'off' }))}>复制十进制度坐标对</button>
    <button className="text-button" disabled={!current} onClick={() => void copy(coordinatesText([point], { ...outputOptions('dms'), headers: 'off' }))}>复制度分秒坐标对</button>
    {mode !== 'convert' && <button className="text-button" disabled={!current} onClick={() => usePoint(point, 'convert')}>送到格式转换</button>}
    {mode !== 'circle' && <button className="text-button" disabled={!current} onClick={() => usePoint(point, 'circle')}>用作圆心</button>}
  </div>;
  return <div className="text-workbench geo-workbench workflow-geography" data-tool="geo-coordinates">
    <SegmentedControl label="经纬度功能" value={mode} options={[{ value: 'convert', label: '格式转换' }, { value: 'circle', label: '圆周点计算' }, { value: 'extract', label: '文本提取' }]} onChange={value => { if (!busy) update({ mode: value }); }} />
    <p className="workflow-intro">{mode === 'convert' ? '输入十进制度或度分秒，同时得到两种表示。格式转换不改变坐标基准。' : mode === 'circle' ? '按地表距离和起始方位角计算圆周点；正东/正西的终点纬度可能变化。' : '提取有度分秒特征的坐标对，按方向识别经纬；无标识时采用指定顺序。'}</p>
    <section className="geo-panel" aria-label="坐标输入">
      {mode !== 'extract' ? <>
        <div className="geo-input-grid">{field(mode === 'circle' ? 'centerLon' : 'lon', mode === 'circle' ? '圆心经度' : '经度', '116.3913 或 116°23′28.68″E')}{field(mode === 'circle' ? 'centerLat' : 'lat', mode === 'circle' ? '圆心纬度' : '纬度', '39.9075 或 39°54′27″N')}</div>
        <div className="geo-paste-pair"><label className="geo-field"><span>粘贴坐标对（仅拆分，保留原文格式）</span><input aria-label="粘贴坐标对" value={pairInput} disabled={busy} onChange={e => setPairInput(e.target.value)} placeholder="116.3913, 39.9075" /></label><button className="secondary-button" disabled={busy || !pairInput.trim()} onClick={() => { try { const p = splitCoordinatePair(pairInput, o.inputOrder); setUndo(task); update(mode === 'circle' ? { centerLon: p.lon, centerLat: p.lat } : p); } catch (error) { onNotice((error as Error).message); } }}>填入经纬字段</button></div>
        {mode === 'circle' && <><div className="geo-input-grid">
          {field('radius', '半径', '例如 1000')}{select('unit', '半径单位', [['m', '米'], ['km', '千米']])}
          {select('algorithm', '圆周算法', [['ellipsoid', '椭球测地线 · WGS84（默认）'], ['sphere', '球面大圆 · 平均半径']])}
          {select('direction', '方向', [['north', '正北 · 0°'], ['east', '正东 · 90°'], ['south', '正南 · 180°'], ['west', '正西 · 270°'], ['all', '全部四方向']])}
        </div><p className="preview-note">{o.algorithm === 'ellipsoid' ? 'WGS84 参考椭球 · Karney 算法。请使用 WGS84 圆心坐标。' : '球面半径 6,371,008.8 米；用于球面模型计算，与椭球结果可能不同。'} 半径 0～10,000 km。不自动转换高德/百度坐标。</p></>}
      </> : <><label className="geo-field"><span>包含度分秒坐标的文本</span><textarea aria-label="包含度分秒坐标的文本" value={task.input} disabled={busy} rows={8} spellCheck={false} placeholder="点位：东经116度23分28.68秒，北纬39度54分27秒" onChange={e => onEdit({ input: e.target.value })} /></label><div className="geo-inline">
        {select('dedupe', '重复点', [['off', '保留原文顺序与重复点'], ['on', '按未舍入坐标去重']])}
        <button className="secondary-button" disabled={busy} onClick={() => file.current?.click()}><Upload size={14} />导入文本</button>
        <input className="sr-only" type="file" ref={file} aria-label="导入坐标文本" accept=".txt,.csv,.tsv,.log,.md" onChange={e => { void load(e.target.files?.[0]); e.target.value = ''; }} />
        <span className="preview-note">{task.input.length.toLocaleString()} / 300,000 字符 · 最多 5,000 对</span>
      </div></>}
      <div className="geo-inline geo-settings">
        {select('inputOrder', '原文无标识时的顺序', [['lon-lat', '经度、纬度'], ['lat-lon', '纬度、经度']])}
        {select('decimals', '十进制度小数位', Array.from({ length: 11 }, (_, i) => [String(i), String(i)]))}
        {select('seconds', '秒的小数位', Array.from({ length: 7 }, (_, i) => [String(i), String(i)]))}
        {select('style', '度分秒样式', [['symbols', '符号 + E/W/N/S'], ['chinese', '中文度分秒']])}
      </div>
      <div className="editor-footer geo-run-row"><div><button disabled={busy} onClick={sample}><FlaskConical size={14} />示例</button>{undo && <button disabled={busy} onClick={() => { onEdit({ input: undo.input, options: undo.options, fileName: undo.fileName, encoding: undo.encoding }); setUndo(null); }}><Undo2 size={14} />撤销填入/示例/导入</button>}</div><div className="run-actions">{busy && <button className="secondary-button" onClick={onCancel}><Square size={13} />取消</button>}<MotionButton trackBusy outcome={task.status === "success" ? "success" : task.status === "error" ? "error" : ""} busy={busy} className="run-button" disabled={busy} onClick={onRun}><ArrowRight size={15} />{busy ? '正在处理' : mode === 'convert' ? '转换坐标' : mode === 'circle' ? '计算圆周点' : '提取坐标'}<kbd>Ctrl ↵</kbd></MotionButton></div></div>
    </section>
    <div className="geo-inline"><span role="status" className={`task-status status-${status}`}><span />{statuses[status]}{task.status === 'success' && task.elapsed !== null && ` · ${task.elapsed} ms`}</span>{result && !current && <span className="preview-note">保留上次结果，请重新处理后复制。</span>}</div>
    <MotionPresence kind="panel" present={!!(task.error)}>{task.error && <div className="task-error" role="alert">{task.error}</div>}</MotionPresence>
    <section className="geo-panel geo-output" aria-label="坐标结果">
      <div className="geo-result-heading"><h2>{mode === 'extract' ? '清洗结果' : '坐标结果'}</h2><span>{result ? `${result.points.length} 对${result.removed ? ` · 已去重 ${result.removed} 对` : ''}` : '等待处理'}</span></div>
      <div className="geo-inline">
        {select('representation', '复制格式', [['decimal', '十进制度'], ['dms', '度分秒']])}
        {select('order', '复制顺序', [['lon-lat', '经度、纬度'], ['lat-lon', '纬度、经度']])}
        {select('delimiter', '分隔符', [['comma', '逗号 CSV'], ['tab', '制表符 TSV']])}
        {select('headers', '表头', [['off', '不带表头'], ['on', '带表头']])}
      </div>
      <div className="geo-copy-actions">{([['全部坐标', undefined], ['经度列', 'lon'], ['纬度列', 'lat']] as const).map(([name, column]) => <MotionButton variant="copy" className="secondary-button" aria-label={`复制${name}`} key={name} disabled={!ready} onClick={() => void copy(coordinatesText(result!.points, o, column))}><Copy size={14} />复制{name}</MotionButton>)}<button className="secondary-button" disabled={!ready} onClick={async () => { try { onNotice(await saveText(coordinatesText(result!.points, o), `devkit-coordinates.${o.delimiter === 'tab' ? 'tsv' : 'csv'}`)); } catch (error) { onNotice(`导出失败：${String(error)}`); } }}><Download size={14} />导出坐标</button></div>
      {result?.points.length ? mode !== 'extract' ? <div className="geo-point-grid">{result.points.map((point, i) => <article className="geo-point" key={i}><h3>{point.direction ? names[point.direction] : '转换结果'}</h3>{(['lon', 'lat'] as const).map(axis => <div className="geo-value" key={axis}><span>{axis === 'lon' ? '经度' : '纬度'}</span><div>{(['decimal', 'dms'] as const).map(format => {
        const value = format === 'decimal' ? decimalText(point[axis], Number(o.decimals)) : dmsText(point[axis], axis, Number(o.seconds), o.style);
        return <div className={`geo-value-row geo-${format}`} key={format}><code>{value}</code><MotionButton variant="copy" className="icon-button" title={`复制${format === 'decimal' ? '十进制度' : '度分秒'}`} aria-label={`复制${axis === 'lon' ? '经度' : '纬度'}${format === 'decimal' ? '十进制度' : '度分秒'}`} disabled={!current} onClick={() => void copy(value)}><Copy size={14} /></MotionButton></div>;
      })}</div></div>)}{pointActions(point)}</article>)}</div> : <>
        <div className="geo-table-scroll"><table className="geo-table"><thead><tr><th>序号 / 来源行</th><th>{o.order === 'lat-lon' ? '纬度' : '经度'}</th><th>{o.order === 'lat-lon' ? '经度' : '纬度'}</th><th>原文 / 操作</th></tr></thead><tbody>{result.points.slice(page * 50, page * 50 + 50).map((point, i) => <tr key={page * 50 + i}><td>{page * 50 + i + 1} / 行 {point.line}</td>{coordinateCells(point, o).map((value, j) => <td key={j}><code>{value}</code></td>)}<td><span className="geo-source">{point.source}</span><button className="text-button" disabled={!current} onClick={() => void copy(coordinatesText([point], { ...o, headers: 'off' }))}>复制此行</button><button className="text-button" disabled={!current} onClick={() => usePoint(point, 'circle')}>用作圆心</button></td></tr>)}</tbody></table></div>
        {result.points.length > 50 && <div className="geo-inline"><button className="secondary-button" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.ceil(result.points.length / 50)} 页 · 复制全部包含所有页</span><button className="secondary-button" disabled={(page + 1) * 50 >= result.points.length} onClick={() => setPage(page + 1)}>下一页</button></div>}
      </> : <p className="preview-note">{result ? '没有确认有效的坐标对。请检查输入及下方待核对项。' : '填写坐标或载入示例后运行。结果可复制为十进制度或度分秒。'}</p>}
      {!!result?.issues.length && <MotionDetails className="geo-issues" open><summary>待核对 {result.issues.length} 项（不进入复制结果）</summary>{result.issues.slice(0, 200).map((issue, i) => <div key={i}><strong>行 {issue.line} · {issue.reason}</strong><code>{issue.source}</code></div>)}{result.issues.length > 200 && <p>仅展示前 200 项，请缩小输入以逐项核对。</p>}</MotionDetails>}
    </section>
  </div>;
}
