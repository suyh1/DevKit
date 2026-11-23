import { TextArea, TextInput } from '../TextControl';
import { useEffect, useRef, useState } from 'react';
import { ChevronsLeftRight, ClipboardCopy, Download, FileInput, FileSearch, Play, X } from 'lucide-react';
import LocalFilePicker from '../LocalFilePicker';
import SegmentedControl from '../SegmentedControl';
import { MotionButton, MotionDetails } from '../Motion';
import FaviconPreview from './FaviconPreview';
import FileMeta from '../FileMeta';
import Skeleton from '../Skeleton';
import AnalysisTable from './AnalysisTable';
import { byAnalysis } from './catalog';
import { downloadBlob } from '../files';
import { copyText } from '../motion-primitives';
import type { FileReport } from './file-analysis';
import { imageReport, imageTools, type ImageReport } from './images';
import './analysis.css';

function useUrl(blob?: Blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) {
      setUrl('');
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
const accept: Record<string, string> = {
  'excel-inspect': '.xlsx',
  'jar-inspect': '.jar,.war,.zip',
  'zip-inventory': '.zip,.jar',
  'parquet-view': '.parquet,.pq',
  'cert-inspect': '.pem,.der,.crt,.cer',
};
export default function FileWorkbench({ id, preset }: { id: string; preset?: Record<string, string> }) {
  const [file, setFile] = useState<File>(),
    [right, setRight] = useState<File>(),
    [o, options] = useState<Record<string, string>>({});
  const [report, setReport] = useState<FileReport>(),
    [images, setImages] = useState<ImageReport>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [sheetNames, setSheets] = useState<string[]>([]);
  const [columnNames, setColumns] = useState<string[]>([]);
  const [idx, choose] = useState(0),
    [split, slider] = useState(50),
    [zoom, magnify] = useState(100),
    [pasteText, setText] = useState('');
  const seq = useRef(0),
    worker = useRef<Worker | null>(null);
  const original = useUrl(file),
    second = useUrl(right),
    chosen = images?.files[idx],
    out = useUrl(chosen?.blob);
  function reset() {
    seq.current++;
    worker.current?.terminate();
    worker.current = null;
    setBusy(false);
    setReport(undefined);
    setImages(undefined);
    setError('');
    choose(0);
  }
  useEffect(() => {
    reset();
  }, [preset]);
  function option(k: string, v: string) {
    reset();
    options({ ...o, [k]: v });
  }
  function pick(f: File | undefined, other = false) {
    reset();
    if (other) setRight(f);
    else {
      setFile(f);
      setSheets([]);
      setColumns([]);
      options((old) => ({ ...old, sheet: '' }));
    }
  }
  useEffect(
    () => () => {
      seq.current++;
      worker.current?.terminate();
    },
    [],
  );
  async function run() {
    reset();
    const job = seq.current;
    const source =
      file ?? (id === 'encoding-repair' && pasteText ? new File([pasteText], '粘贴文本.txt') : undefined);
    if (!source) {
      setError('请先选择本地文件');
      return;
    }
    setBusy(true);
    try {
      if (imageTools.has(id)) {
        const result = await imageReport(id, source, o, right);
        if (job !== seq.current) return;
        setImages(result);
        if (id === 'image-compress')
          choose(
            Math.max(
              0,
              result.files.findIndex((f) => f.name.startsWith('quality-' + (o.quality ?? 80) + '.')),
            ),
          );
      } else {
        const w = new Worker(new URL('./file.worker.ts', import.meta.url), { type: 'module' });
        worker.current = w;
        const data = await new Promise<FileReport>((resolve, reject) => {
          w.onmessage = (e) => (e.data.error ? reject(Error(e.data.error)) : resolve(e.data.report));
          w.onerror = () => reject(Error('文件处理模块加载失败'));
          w.postMessage({ id, file: source, right, options: { ...preset, ...o } });
        });
        if (job !== seq.current) return;
        setReport(data);
        if (data.choices) setSheets(data.choices);
        if (data.columnNames) setColumns(data.columnNames);
      }
    } catch (e) {
      if (job === seq.current) setError((e as Error).message);
    } finally {
      if (job === seq.current) {
        worker.current?.terminate();
        worker.current = null;
        setBusy(false);
      }
    }
  }
  const select = (key: string, label: string, values: string[], fallback: string) => (
    <label>
      {label}
      <select value={o[key] ?? fallback} onChange={(e) => option(key, e.target.value)}>
        {values.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
  const text = (key: string, label: string, example = '') => (
    <label>
      {label}
      <TextInput value={o[key] ?? ''} placeholder={example} onChange={(e) => option(key, e.target.value)} />
    </label>
  );
  const isImage = imageTools.has(id);
  const isKit = id === 'favicon-kit';
  const hasSecond = ['zip-inventory', 'pixel-diff', 'bundle-size', 'source-map'].includes(id);
  const sourceLabel = isKit ? '图标母图' : id === 'pixel-diff' ? '原始截图' : isImage ? '源图片' : '源文件';
  const secondLabels: Record<string, string> = {
    'zip-inventory': '对照归档（可选）',
    'source-map': '堆栈文件（可选）',
    'bundle-size': '新版构建统计',
  };
  function drop(files: File[], other = false) {
    if (files[0]) pick(files[0], other);
    if (!other && hasSecond && files[1]) pick(files[1], true);
  }
  const field = (other = false) => {
    const selected = other ? right : file;
    const label = other ? (secondLabels[id] ?? '第二张截图') : sourceLabel;
    const format = isImage ? '图片' : accept[id]?.replaceAll('.', '').split(',').join(' / ').toUpperCase();
    return (
      <div className="file-source">
        {hasSecond && <strong>{label}</strong>}
        <LocalFilePicker
          label={(selected ? '更换' : '选择') + label.replace('（可选）', '')}
          hint={['或拖入此处', format, isImage ? '≤ 64 MiB' : '≤ 128 MiB'].filter(Boolean).join(' · ')}
          accept={isImage ? 'image/*' : accept[id]}
          onFiles={(files) => drop(files, other)}
        />
        {selected && (
          <div className="file-selected">
            <FileMeta name={selected.name} encoding={selected.size.toLocaleString() + ' 字节'} />
            <button
              type="button"
              className="icon-button"
              aria-label={'移除' + label}
              onClick={() => pick(undefined, other)}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    );
  };
  const summary = report?.summary ?? images?.summary,
    exportText = report?.data ?? report?.rows ?? images?.text;
  return (
    <section
      className="analysis-file file-workbench"
      data-file-tool={id}
      tabIndex={id === 'qr-code' ? 0 : undefined}
      onPaste={(e) => {
        if (id === 'qr-code' && e.clipboardData.files[0]) {
          e.preventDefault();
          pick(e.clipboardData.files[0]);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        drop(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="devkit-bento file-layout">
        <section className="file-input-panel">
          <div className="file-panel-title">
            <FileInput size={18} />
            <h2>{isKit ? '制作图标包' : '文件输入'}</h2>
          </div>
          <div className="file-sources">
            {field()}
            {hasSecond && field(true)}
          </div>
          <div className="analysis-fields file-options">
            {id === 'encoding-repair' && (
              <>
                {select('encoding', '源编码', ['auto', 'utf-8', 'gb18030', 'utf-16le', 'utf-16be'], 'auto')}
                {select('dest', '导出编码', ['utf-8', 'gb18030', 'utf-16le', 'utf-16be'], 'utf-8')}
                <label>
                  文本修复
                  <select value={o.repair ?? ''} onChange={(e) => option('repair', e.target.value)}>
                    <option value="">直接读取</option>
                    <option value="gbk">还原被当作 GBK 读取的 UTF-8</option>
                    <option value="latin1">还原被当作 Latin-1 读取的 UTF-8</option>
                  </select>
                </label>
                <label>
                  或粘贴乱码文本
                  <TextArea
                    value={pasteText}
                    onChange={(e) => {
                      reset();
                      setText(e.target.value);
                      setFile(undefined);
                    }}
                  />
                </label>
              </>
            )}
            {id === 'cert-inspect' && text('host', '核对域名', 'www.example.com')}
            {id === 'parquet-view' && (
              <>
                {text('columns', '导出列（默认全部）', 'id,name')}
                {text('offset', '起始行偏移', '0')}
                {text('limit', '读取行数', '按单元格上限自动读取')}
                {columnNames.length > 0 && (
                  <label>
                    选择导出列
                    <select
                      multiple
                      value={o.columns?.trim() ? o.columns.split(',') : columnNames}
                      onChange={(e) =>
                        option('columns', Array.from(e.target.selectedOptions, (x) => x.value).join(','))
                      }
                    >
                      {columnNames.map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {id === 'excel-inspect' &&
              sheetNames.length > 0 &&
              select('sheet', '工作表', sheetNames, o.sheet || sheetNames[0])}
            {id === 'pixel-diff' && (
              <>
                <label>
                  色差容差 {o.tolerance ?? '0.1'}
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step=".01"
                    value={o.tolerance ?? '.1'}
                    onChange={(e) => option('tolerance', e.target.value)}
                  />
                </label>
                <label>
                  <input
                    className="form-check" type="checkbox"
                    checked={o.aa === 'on'}
                    onChange={(e) => option('aa', e.target.checked ? 'on' : 'off')}
                  />
                  计入抗锯齿像素
                </label>
              </>
            )}
            {id === 'image-compress' && (
              <>
                <div className="file-format">
                  <span>导出格式</span>
                  <SegmentedControl
                    label="导出格式"
                    value={o.format ?? 'webp'}
                    options={[
                      { value: 'webp', label: 'WebP' },
                      { value: 'jpeg', label: 'JPEG' },
                    ]}
                    onChange={(v) => option('format', v)}
                  />
                </div>
                <label>
                  目标质量 {o.quality ?? 80}
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={o.quality ?? 80}
                    onChange={(e) => option('quality', e.target.value)}
                  />
                </label>
              </>
            )}
            {id === 'favicon-kit' && text('name', '应用名称', '应用')}
          </div>
          {id === 'encoding-repair' && !file && pasteText && (
            <small>将按 UTF-8 读取粘贴文本，再应用所选修复。</small>
          )}
          <div className="analysis-actions file-run-actions">
            <MotionButton
              className="run-button"
              busy={busy}
              disabled={
                busy || !(file || (id === 'encoding-repair' && pasteText)) || (id === 'pixel-diff' && !right)
              }
              onClick={() => void run()}
            >
              <Play size={15} />
              {busy ? '处理中…' : isKit ? '生成图标包' : '开始处理'}
            </MotionButton>
            {busy && (
              <button className="secondary-button" onClick={reset}>
                取消
              </button>
            )}
          </div>
          <MotionDetails className="file-guide"><summary>文件格式与使用说明</summary>
          <p className="file-description">
            {byAnalysis.get(id)?.description ?? '选择二维码图片，或聚焦此区域后粘贴截图。'}
          </p>
          </MotionDetails>
        </section>
        <section className="file-output-panel">
          {isKit ? (
            <FaviconPreview
              src={file && file.size <= 64 * 1024 * 1024 ? original : ''}
              name={o.name ?? ''}
              hasFile={!!file}
            />
          ) : (
            <div className="file-panel-title">
              <FileSearch size={18} />
              <h2>处理结果</h2>
            </div>
          )}
          {error && (
            <p className="file-error" role="alert">
              {error}
            </p>
          )}
          {!isKit && !busy && !summary && !error && (
            <div className="file-result-empty">
              <FileSearch size={32} strokeWidth={1.4} />
              <strong>{file || pasteText ? '等待处理' : '等待输入'}</strong>
              <span>
                {id === 'pixel-diff'
                  ? '选择两张截图后可查看对照和像素差异。'
                  : '处理完成后可在此查看和导出结果。'}
              </span>
            </div>
          )}
          {busy && <Skeleton kind="list" label="正在分析本地文件" />}
          {summary && <pre role="status">{summary}</pre>}
          {report?.rows && <AnalysisTable text={report.rows} />}
          {report?.sourceText && <pre>{report.sourceText}</pre>}
          {report?.data && (
            <MotionDetails>
              <summary>查看导出数据</summary>
              <pre>{report.data.slice(0, 16000)}</pre>
            </MotionDetails>
          )}
          {images?.text && <pre>{images.text}</pre>}
          {images && images.files.length > 1 ? (
            <label>
              导出版本
              <select value={idx} onChange={(e) => choose(Number(e.target.value))}>
                {images.files.map((x, i) => (
                  <option key={x.name} value={i}>
                    {x.name} · {x.blob.size.toLocaleString()} 字节
                  </option>
                ))}
              </select>
            </label>
          ) : (
            chosen && <FileMeta name={chosen.name} encoding={chosen.blob.size.toLocaleString() + ' 字节'} />
          )}
          {images && ['pixel-diff', 'image-compress'].includes(id) && (
            <>
              <div className="analysis-fields">
                <label>
                  缩放 {zoom}%
                  <input
                    type="range"
                    min="25"
                    max="300"
                    value={zoom}
                    onChange={(e) => magnify(+e.target.value)}
                  />
                </label>
              </div>
              <div className="image-scroll">
                <div className="analysis-overlay" style={{ width: zoom + '%' }}>
                  <img src={original} alt="原图" />
                  <img
                    style={{ clipPath: 'inset(0 0 0 ' + split + '%)' }}
                    src={id === 'pixel-diff' ? second : out}
                    alt="对照图"
                  />
                  <i className="image-compare-line" style={{ left: split + '%' }} aria-hidden="true">
                    <ChevronsLeftRight size={18} />
                  </i>
                  <input
                    className="image-compare-range"
                    type="range"
                    aria-label="对照分界"
                    aria-valuetext={'原图 ' + split + '%'}
                    value={split}
                    onChange={(event) => slider(Number(event.target.value))}
                  />
                </div>
              </div>
              <div className="image-compare-legend">
                <span>原图</span>
                <span>{id === 'pixel-diff' ? '第二张截图' : '压缩结果'}</span>
              </div>
              {id === 'pixel-diff' && <img className="analysis-heatmap" src={out} alt="不同像素热图" />}
            </>
          )}
          <div className="analysis-actions">
            {exportText !== undefined && (
              <MotionButton
                variant="copy"
                className="secondary-button"
                onClick={() => void copyText(exportText).catch(() => setError('复制失败，请手动选择结果'))}
              >
                <ClipboardCopy size={15} />
                复制结果
              </MotionButton>
            )}
            {(report || chosen) && (
              <MotionButton
                className="secondary-button"
                onClick={() =>
                  downloadBlob(
                    chosen?.blob ?? report?.blob ?? new Blob([exportText ?? '']),
                    chosen?.name ?? (file?.name ?? 'result') + '.' + (report?.ext ?? 'csv'),
                  )
                }
              >
                <Download size={15} />
                下载结果
              </MotionButton>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
