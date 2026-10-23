import { useEffect, useRef, useState } from 'react';
import type { Dispatch, PointerEvent, SetStateAction } from 'react';
import { Pipette, Copy, Check, ImagePlus, Shuffle, Star, X, ArrowLeftRight, Plus, Minus, Palette, Download } from 'lucide-react';
import { parseColor, hexColor, colorFormats, readableInk, harmonyColors, shadeColors, shadeLabels, paletteExport, gradientCss, contrastReport, mixColors, clamp, composite } from './colors';
import type { Color, ColorToolId } from './colors';
import CodeEditor from './CodeEditor';
import { saveText } from './files';

type Parsed = { color: Color; error?: never } | { color?: never; error: string };
function parsed(input: string): Parsed { try { return { color: parseColor(input) }; } catch (error) { return { error: error instanceof Error ? error.message : '颜色格式无效。' }; } }
type EyeDropperWindow = Window & { EyeDropper?: new () => { open: (options: { signal: AbortSignal }) => Promise<{ sRGBHex: string }> } };
const initialColor = '#147D64';
export function savedColors(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('devkit:colors') || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(item)).map(item => item.toUpperCase()))].slice(0, 40) : [];
  } catch { return []; }
}
function randomColor(): string { const bytes = crypto.getRandomValues(new Uint8Array(3)); return hexColor({ r: bytes[0], g: bytes[1], b: bytes[2], a: 1 }); }

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const result = parsed(value);
  return <div className="color-field"><label><span>{label}</span><div className="color-field-row"><input type="color" aria-label={`${label}色板`} value={result.color ? hexColor(result.color, false) : initialColor} onChange={event => onChange(event.target.value.toUpperCase())} /><input className="color-value-input" aria-label={label} value={value} onChange={event => onChange(event.target.value)} spellCheck={false} maxLength={200} /></div></label>{result.error && <small role="alert" className="color-error">{result.error}</small>}</div>;
}
function Swatches({ colors, labels, onPick }: { colors: Color[]; labels?: string[]; onPick: (hex: string) => void }) {
  return <div className="color-swatches">{colors.map((color, index) => <button key={index} className="color-swatch" style={{ background: hexColor(composite(color, { r: 255, g: 255, b: 255, a: 1 })), color: readableInk(color) }} onClick={() => onPick(hexColor(color))} aria-label={`复制颜色 ${hexColor(color)}`}><strong>{labels?.[index] || String(index + 1).padStart(2, '0')}</strong><code>{hexColor(color)}</code><Copy size={12} /></button>)}</div>;
}
function FormatList({ color, onCopy }: { color: Color; onCopy: (text: string) => void }) {
  return <div className="color-formats">{Object.entries(colorFormats(color)).map(([name, value]) => <button key={name} onClick={() => onCopy(value)} aria-label={`复制 ${name} ${value}`}><span>{name}</span><code>{value}</code><Copy size={14} /></button>)}</div>;
}

export default function ColorWorkbench({ mode, primary, onPrimary: setPrimary, favorites, onFavorites: setFavorites }: { mode: ColorToolId; primary: string; onPrimary: Dispatch<SetStateAction<string>>; favorites: string[]; onFavorites: Dispatch<SetStateAction<string[]>> }) {
  const [secondary, setSecondary] = useState('#FFFFFF');
  const [message, setMessage] = useState('');
  const [harmony, setHarmony] = useState('analogous'), [exportFormat, setExportFormat] = useState('css');
  const [gradientType, setGradientType] = useState('linear'), [angle, setAngle] = useState(135), [extraStops, setExtraStops] = useState<string[]>([]);
  const [amount, setAmount] = useState(50), [space, setSpace] = useState('srgb');
  const [imageInfo, setImageInfo] = useState<{ name: string; width: number; height: number } | null>(null);
  const [coordinates, setCoordinates] = useState({ x: 0, y: 0 });
  const [hoverColor, setHoverColor] = useState<string | null>(null);
  const imageSource = useRef<HTMLCanvasElement | null>(null), imageCanvas = useRef<HTMLCanvasElement>(null), zoomCanvas = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null), imageGeneration = useRef(0), eyeAbort = useRef<AbortController | null>(null);
  const objectUrls = useRef(new Set<string>());
  const first = parsed(primary), second = parsed(secondary);
  const supportsEyeDropper = !!(window as EyeDropperWindow).EyeDropper;
  useEffect(() => () => { imageGeneration.current++; eyeAbort.current?.abort(); objectUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!imageInfo || mode !== 'color-picker' || !imageSource.current || !imageCanvas.current) return;
    const source = imageSource.current, canvas = imageCanvas.current;
    canvas.width = Math.min(source.width, 1000); canvas.height = Math.max(1, Math.round(source.height * canvas.width / source.width));
    canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [imageInfo, mode]);
  useEffect(() => {
    if (!imageSource.current || !zoomCanvas.current || mode !== 'color-picker') return;
    const context = zoomCanvas.current.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, 90, 90); context.imageSmoothingEnabled = false;
    context.drawImage(imageSource.current, coordinates.x - 4, coordinates.y - 4, 9, 9, 0, 0, 90, 90);
    context.strokeStyle = '#FFFFFF'; context.lineWidth = 2; context.strokeRect(40, 40, 10, 10);
    context.strokeStyle = '#000000'; context.lineWidth = 1; context.strokeRect(39, 39, 12, 12);
  }, [coordinates, imageInfo, mode]);

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setMessage(`已复制${text.length < 40 ? '：' + text : '到剪贴板'}`); }
    catch { setMessage('剪贴板不可用，可从下方导出内容中手动复制。'); }
  }
  function saveColor() {
    if (!first.color) return;
    const hex = hexColor(first.color);
    if (favorites.includes(hex)) { setMessage('这个颜色已经在收藏中。'); return; }
    if (favorites.length >= 40) { setMessage('最多收藏 40 个颜色，请先移除不需要的颜色。'); return; }
    setFavorites(old => [...old, hex]); setMessage(`已收藏 ${hex}，保存在本机。`);
  }
  async function pickScreen() {
    const EyeDropper = (window as EyeDropperWindow).EyeDropper;
    if (!EyeDropper) return;
    eyeAbort.current?.abort(); const controller = new AbortController(); eyeAbort.current = controller;
    try { const result = await new EyeDropper().open({ signal: controller.signal }); if (controller.signal.aborted) return; setPrimary(result.sRGBHex.toUpperCase()); setMessage('已获取屏幕像素颜色。'); }
    catch (error) { if (!controller.signal.aborted) setMessage(error instanceof DOMException && error.name === 'AbortError' ? '已取消屏幕取色。' : '当前环境无法打开屏幕吸管，请使用图片取色。'); }
  }
  function readPixel(x: number, y: number, commit: boolean) {
    const source = imageSource.current;
    if (!source) return;
    const point = { x: clamp(Math.floor(x), 0, source.width - 1), y: clamp(Math.floor(y), 0, source.height - 1) };
    const pixel = source.getContext('2d')?.getImageData(point.x, point.y, 1, 1).data;
    if (!pixel) return;
    const hex = hexColor({ r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 });
    setCoordinates(point); setHoverColor(hex);
    if (commit) { setPrimary(hex); setMessage(`已选取像素 (${point.x}, ${point.y})：${hex}`); }
  }
  function canvasPoint(event: PointerEvent<HTMLCanvasElement>, commit: boolean) {
    if (!imageInfo) return;
    const rect = event.currentTarget.getBoundingClientRect();
    readPixel((event.clientX - rect.left) / rect.width * imageInfo.width, (event.clientY - rect.top) / rect.height * imageInfo.height, commit);
  }
  function useImage(source: HTMLCanvasElement, name: string) {
    imageSource.current = source; setImageInfo({ name, width: source.width, height: source.height }); setCoordinates({ x: 0, y: 0 }); setHoverColor(null); setMessage('图片已载入，点击图片或输入坐标取色。');
  }
  function sampleImage() {
    imageGeneration.current++;
    const source = document.createElement('canvas'); source.width = 640; source.height = 240;
    const context = source.getContext('2d')!;
    ['#EF4444', '#22C55E', '#3B82F6', '#F5B041'].forEach((color, index) => { context.fillStyle = color; context.fillRect(index * 160, 0, 160, 240); });
    useImage(source, '示例色卡');
  }
  function loadImage(file: File | undefined) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024 || !/\.(png|jpe?g|webp|bmp)$/i.test(file.name)) { setMessage('请选择不超过 20 MB 的 PNG、JPEG、WebP 或 BMP 图片。'); return; }
    const generation = ++imageGeneration.current, url = URL.createObjectURL(file), image = new Image(); objectUrls.current.add(url);
    const release = () => { URL.revokeObjectURL(url); objectUrls.current.delete(url); };
    setMessage('正在本地解码图片…');
    image.onload = () => {
      release(); if (generation !== imageGeneration.current) return;
      if (image.width * image.height > 20_000_000 || !image.width || !image.height) { setMessage('图片超过 2000 万像素，请缩小后重试。'); return; }
      const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
      const context = source.getContext('2d');
      if (!context) { setMessage('无法创建图片画布。'); return; }
      context.drawImage(image, 0, 0); useImage(source, file.name);
    };
    image.onerror = () => { release(); if (generation === imageGeneration.current) setMessage('图片无法解码，请尝试 PNG 或 JPEG。'); };
    image.src = url;
  }
  async function download(text: string, filename: string, _mime = 'text/css') {
    try { setMessage(await saveText(text, filename)); }
    catch (error) { setMessage(`保存失败：${String(error)}`); }
  }
  function exportPanel(text: string, filename: string, json = false) {
    return <section className="color-panel color-export"><div className="color-panel-heading"><h2>可直接使用的代码</h2><div><button className="text-button" onClick={() => copy(text)}><Copy size={14} />复制</button><button className="text-button" onClick={() => download(text, filename, json ? 'application/json' : 'text/css')}><Download size={14} />导出</button></div></div><div className="color-code-editor"><CodeEditor label="颜色导出代码" value={text} language={json ? 'json' : 'css'} readOnly /></div></section>;
  }
  const harmonyList = first.color ? harmonyColors(first.color, harmony) : [];
  const shades = first.color ? shadeColors(first.color) : [];
  const stops = [primary, ...extraStops, secondary].map(parsed);
  const gradient = stops.every(stop => !!stop.color) ? gradientCss(stops.map(stop => stop.color!), angle, gradientType) : null;
  const report = first.color && second.color ? contrastReport(first.color, second.color) : null;
  const mixed = first.color && second.color ? mixColors(first.color, second.color, amount / 100, space) : null;
  const primaryControls = <><ColorField label={mode === 'color-contrast' ? '文字颜色' : '主颜色'} value={primary} onChange={setPrimary} /><label className="color-range">透明度 <strong>{first.color ? Math.round(first.color.a * 100) : 100}%</strong><input aria-label="主颜色透明度" type="range" min="0" max="100" value={first.color ? Math.round(first.color.a * 100) : 100} disabled={!first.color} onChange={event => first.color && setPrimary(hexColor({ ...first.color, a: Number(event.target.value) / 100 }, true))} /></label></>;

  return <div className="color-workbench">
    <div className="color-workspace-grid">
      <section className="color-panel color-control-panel"><div className="color-panel-heading"><h2>{mode === 'color-contrast' ? '颜色组合' : '颜色控制'}</h2><button className="text-button" onClick={() => setPrimary(randomColor())}><Shuffle size={14} />随机色</button></div>{primaryControls}
        {(mode === 'color-contrast' || mode === 'color-mix' || mode === 'color-gradient') && <><div className="color-separator" /><ColorField label={mode === 'color-contrast' ? '背景颜色' : '终点颜色'} value={secondary} onChange={setSecondary} /><button className="color-secondary-button" onClick={() => { setPrimary(secondary); setSecondary(primary); }}><ArrowLeftRight size={14} />交换颜色</button></>}
        {mode === 'color-picker' && <><button className="run-button color-screen-button" disabled={!supportsEyeDropper} onClick={pickScreen}><Pipette size={16} />屏幕取色</button><p className="color-note">{supportsEyeDropper ? '点击后选择屏幕像素，Esc 取消。' : '当前环境不支持屏幕吸管，可使用色板或下方图片取色。'}</p></>}
        {mode === 'color-palette' && <label className="color-select">配色规则<select aria-label="配色规则" value={harmony} onChange={event => setHarmony(event.target.value)}><option value="analogous">类似色</option><option value="complementary">互补色</option><option value="triadic">三角色</option><option value="split">分裂互补色</option><option value="tetradic">四角色</option><option value="mono">单色系</option></select></label>}
        {mode === 'color-gradient' && <><label className="color-select">渐变类型<select aria-label="渐变类型" value={gradientType} onChange={event => setGradientType(event.target.value)}><option value="linear">线性渐变</option><option value="radial">径向渐变</option></select></label><label className="color-range">方向 <strong>{angle}°</strong><input aria-label="渐变角度" type="range" min="0" max="360" value={angle} disabled={gradientType === 'radial'} onChange={event => setAngle(Number(event.target.value))} /></label>{extraStops.map((value, index) => <div className="color-extra-stop" key={index}><ColorField label={`中间色 ${index + 1}`} value={value} onChange={next => setExtraStops(old => old.map((item, position) => position === index ? next : item))} /><button className="icon-button" aria-label={`删除中间色 ${index + 1}`} onClick={() => setExtraStops(old => old.filter((_, position) => position !== index))}><Minus size={16} /></button></div>)}<button className="color-secondary-button" disabled={extraStops.length >= 3} onClick={() => setExtraStops(old => [...old, randomColor()])}><Plus size={14} />添加色标（最多 5 个）</button></>}
        {mode === 'color-mix' && <><label className="color-range">终点颜色占比 <strong>{amount}%</strong><input aria-label="混色比例" type="range" min="0" max="100" value={amount} onChange={event => setAmount(Number(event.target.value))} /></label><label className="color-select">混合空间<select aria-label="混合空间" value={space} onChange={event => setSpace(event.target.value)}><option value="srgb">sRGB 通道混合</option><option value="linear">线性光混合</option></select></label><p className="color-note">按透明度预乘后混合；线性光模式先校正 sRGB 伽马。</p></>}
        <button className="color-secondary-button" disabled={!first.color} onClick={saveColor}><Star size={15} />收藏主颜色</button>
      </section>
      <section className="color-panel color-result-panel"><div className="color-panel-heading"><h2>{mode === 'color-gradient' ? '渐变预览' : mode === 'color-contrast' ? '对比度预览' : mode === 'color-mix' ? '混合结果' : '颜色预览'}</h2><span className="color-live">实时更新</span></div>
        {mode === 'color-gradient' ? gradient && <><div className="color-gradient-preview color-checker"><div style={{ background: gradient }} /><span>MAKE SOMETHING COLORFUL.</span></div><p className="color-note">色标按位置等距分布；CSS 渐变由系统 WebView 渲染。</p></> : mode === 'color-contrast' ? report && <><div className="color-contrast-preview" style={{ color: hexColor(report.foreground), background: hexColor(report.background) }}><span>Aa</span><strong>让每一个字都清晰可读。</strong><p>The quick brown fox jumps over the lazy dog.</p></div><div className="color-ratio"><strong>{report.ratio.toFixed(2)}<small>: 1</small></strong><span>WCAG 2.2 对比度</span></div><div className="color-verdicts">{[['AA 普通文字', report.aa], ['AA 大文字', report.aaLarge], ['AAA 普通文字', report.aaa], ['AAA 大文字', report.aaaLarge], ['UI 图形 / 控件', report.ui]].map(([label, pass]) => <div key={String(label)} className={pass ? 'pass' : 'fail'}>{pass ? <Check size={14} /> : <X size={14} />}<span>{label}</span><strong>{pass ? '通过' : '未通过'}</strong></div>)}</div><p className="color-note">透明背景先叠加白色；按原始比值判定。大文字为 ≥24px 或粗体 ≥18.67px。</p></> : (mode === 'color-mix' ? mixed : first.color) && <><div className="color-large-swatch color-checker"><div style={{ background: hexColor((mode === 'color-mix' ? mixed : first.color)!) }} /><strong style={{ color: readableInk((mode === 'color-mix' ? mixed : first.color)!) }}>{hexColor((mode === 'color-mix' ? mixed : first.color)!)}</strong></div><FormatList color={(mode === 'color-mix' ? mixed : first.color)!} onCopy={copy} /><p className="color-note">HEX / RGB / HSL 支持透明度。HSV 与 CMYK 为分量换算；CMYK 不包含印刷 ICC 配置。</p></>}
        {(first.error || ((mode === 'color-contrast' || mode === 'color-mix') && second.error) || (mode === 'color-gradient' && !gradient)) && <p role="alert" className="color-error color-empty-error">请修正左侧颜色输入，预览将在有效后自动恢复。</p>}
      </section>
    </div>
    {mode === 'color-picker' && <section className="color-panel color-image-panel"><div className="color-panel-heading"><h2><ImagePlus size={17} />图片取色</h2><div><button className="text-button" onClick={sampleImage}>示例图片</button><button className="text-button" onClick={() => fileRef.current?.click()}><ImagePlus size={14} />导入本地图片</button></div></div><input type="file" ref={fileRef} accept=".png,.jpg,.jpeg,.webp,.bmp" aria-label="导入取色图片" className="sr-only" onChange={event => { loadImage(event.target.files?.[0]); event.target.value = ''; }} />{!imageInfo && <button className="color-image-empty" onClick={() => fileRef.current?.click()}><ImagePlus size={32} /><strong>从图片中找到你的颜色</strong><span>PNG / JPEG / WebP / BMP，最大 20 MB，仅在本地处理</span></button>}<div className="color-image-scroll" hidden={!imageInfo}><canvas ref={imageCanvas} aria-label="图片取色区域，点击像素或使用下方坐标取色" onPointerMove={event => canvasPoint(event, false)} onPointerDown={event => canvasPoint(event, true)} /></div>{imageInfo && <div className="color-image-meta"><div><p>{imageInfo.name} · {imageInfo.width} × {imageInfo.height}</p><div className="color-coordinates"><label>X <input type="number" aria-label="像素 X 坐标" min="0" max={imageInfo.width - 1} value={coordinates.x} onChange={event => setCoordinates(old => ({ ...old, x: clamp(Number(event.target.value) || 0, 0, imageInfo.width - 1) }))} /></label><label>Y <input type="number" aria-label="像素 Y 坐标" min="0" max={imageInfo.height - 1} value={coordinates.y} onChange={event => setCoordinates(old => ({ ...old, y: clamp(Number(event.target.value) || 0, 0, imageInfo.height - 1) }))} /></label><button className="text-button" onClick={() => readPixel(coordinates.x, coordinates.y, true)}><Pipette size={14} />取此像素</button></div><code>{hoverColor || '移动鼠标查看像素颜色'}</code></div><canvas ref={zoomCanvas} width="90" height="90" className="color-zoom color-checker" aria-label="像素放大预览" /></div>}</section>}
    {mode === 'color-palette' && first.color && <><section className="color-panel"><div className="color-panel-heading"><h2><Palette size={17} />配色方案</h2><label className="color-inline-select">导出格式<select aria-label="调色板导出格式" value={exportFormat} onChange={event => setExportFormat(event.target.value)}><option value="css">CSS 变量</option><option value="json">JSON</option></select></label></div><Swatches colors={harmonyList} onPick={copy} /><p className="color-note">点击色块复制色值；配色依据 HSL 色相轮生成。</p></section><section className="color-panel"><div className="color-panel-heading"><h2>50–950 明度阶梯</h2><button className="text-button" onClick={() => copy(paletteExport(shades, shadeLabels, exportFormat))}><Copy size={14} />复制色阶</button></div><Swatches colors={shades} labels={shadeLabels} onPick={copy} /><p className="color-note">固定 HSL 明度阶梯，非感知均匀色阶。</p></section>{exportPanel(paletteExport(harmonyList, undefined, exportFormat), `devkit-palette.${exportFormat === 'json' ? 'json' : 'css'}`, exportFormat === 'json')}</>}
    {mode === 'color-gradient' && gradient && exportPanel(`.gradient {\n  background: ${gradient};\n}`, 'devkit-gradient.css')}
    {mode === 'color-mix' && first.color && second.color && <section className="color-panel"><div className="color-panel-heading"><h2>混合色阶</h2><span className="color-note">0% → 100%</span></div><Swatches colors={Array.from({ length: 11 }, (_, index) => mixColors(first.color!, second.color!, index / 10, space))} labels={Array.from({ length: 11 }, (_, index) => `${index * 10}%`)} onPick={copy} /></section>}
    <section className="color-panel color-favorites"><div className="color-panel-heading"><h2><Star size={16} />我的收藏色 <span>{favorites.length}/40</span></h2><div><button className="text-button" disabled={!favorites.length} onClick={() => download(paletteExport(favorites.map(parseColor), undefined, 'json'), 'devkit-colors.json', 'application/json')}><Download size={14} />导出 JSON</button><button className="text-button" disabled={!favorites.length} onClick={() => { setFavorites([]); setMessage('已清空收藏色。'); }}>清空</button></div></div>{favorites.length ? <div className="color-saved-list">{favorites.map(hex => <div className="color-saved" key={hex}><button onClick={() => setPrimary(hex)} aria-label={`使用收藏色 ${hex}`}><span className="color-saved-dot color-checker"><span style={{ background: hex }} /></span><code>{hex}</code></button><button className="icon-button" aria-label={`移除收藏色 ${hex}`} onClick={() => setFavorites(old => old.filter(item => item !== hex))}><X size={12} /></button></div>)}</div> : <p className="color-note">收藏常用品牌色，在这些颜色工具中随时复用。只保存在本机，可导出备份。</p>}</section>
    <p className="color-status" role="status">{message || '所有颜色计算在本机完成；导入图片不会上传。'}</p>
  </div>;
}
