import SegmentedControl from './SegmentedControl';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { collab, useLive, useCollabList, useOperation, type PageProps } from './collab-api';
import { drawMark, prepareScreenshot, type Board, type BoardInfo, type Brush, type Point } from './board-canvas';
import { openWorkspaceLink, useWorkspaceResource } from './workspace-links';
import { useConfirmation } from './Confirmation';
import {
  ArrowUpRight,
  Pencil,
  Square,
  Circle,
  Type,
  PanelsTopLeft,
  ImagePlus,
  Plus,
  FolderOpen,
  ChevronDown,
  Download,
  Scan,
  Undo2,
  Image as ImageIcon,
  Search,
} from 'lucide-react';
import { downloadBlob } from './files';

const brushIcons = { pen: Pencil, rect: Square, ellipse: Circle, arrow: ArrowUpRight, text: Type };
const tools: Record<Brush['tool'], string> = {
  pen: '画笔',
  rect: '矩形',
  ellipse: '椭圆',
  arrow: '箭头',
  text: '文字',
};
export function ScreenshotBoard({ active, edit }: PageProps) {
  const list = useCollabList<BoardInfo>('whiteboard', active);
  const resource = useWorkspaceResource('whiteboard'),
    selected = resource || list.value?.[0]?.id;
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [title, setTitle] = useState(''),
    [query, setQuery] = useState('');
  const picker = useRef<HTMLInputElement>(null),
    op = useOperation();
  function create(file?: File) {
    if (!edit) return;
    void op.run(async () => {
      const image = file ? await prepareScreenshot(file) : { width: 1280, height: 800 };
      const board = await collab<BoardInfo>('whiteboard', 'create', {
        ...image,
        name: title.trim() || file?.name || '未命名白板',
      });
      setTitle('');
      setLibraryOpen(false);
      openWorkspaceLink('whiteboard', board.id);
      await list.refresh();
    });
  }
  return (
    <div
      className="board-layout"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files[0]) create(e.dataTransfer.files[0]);
      }}
      onPaste={(e) => {
        if (e.clipboardData.files[0]) {
          e.preventDefault();
          create(e.clipboardData.files[0]);
        }
      }}
    >
      {selected && (
        <div className="board-library-bar">
          <button
            aria-expanded={libraryOpen}
            aria-controls="board-library-panel"
            onClick={() => setLibraryOpen(!libraryOpen)}
          >
            <FolderOpen />
            画板库 <span className="collab-count">{list.value?.length ?? 0}</span>
            <ChevronDown size={15} />
          </button>
        </div>
      )}
      {(!selected || libraryOpen) && (
        <aside id="board-library-panel" className="board-library">
          <div className="board-create">
            <h2 className="section-title">
              <PanelsTopLeft />
              {selected ? '新建画板' : '画板库'}
            </h2>
            {edit && (
              <>
                <label>
                  画板名称
                  <input
                    aria-label="新画板名称"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    placeholder="为这次讨论起个名字（可选）"
                  />
                </label>
                <button className="primary-button" disabled={op.busy} onClick={() => picker.current?.click()}>
                  <ImagePlus size={17} />
                  从截图新建
                </button>
                <button disabled={op.busy} onClick={() => create()}>
                  <Plus size={17} />
                  新建空白画板
                </button>
                <small>也可拖入或粘贴截图</small>
                <input
                  ref={picker}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    if (e.target.files?.[0]) create(e.target.files[0]);
                    e.target.value = '';
                  }}
                />
              </>
            )}
          </div>
          <div className="board-index">
            <h2>已有画板</h2>
            <label className="collab-search">
              <Search size={16} />
              <input
                aria-label="查找白板"
                placeholder="查找白板"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {list.value
              ?.filter((b) => b.name.toLowerCase().includes(query.toLowerCase()))
              .map((b) => (
                <button
                  className="collab-record"
                  aria-pressed={b.id === selected}
                  key={b.id}
                  onClick={() => {
                    setLibraryOpen(false);
                    openWorkspaceLink('whiteboard', b.id);
                  }}
                >
                  <strong>{b.name}</strong>
                  <small>
                    {b.width} × {b.height} · {b.count} 个标注
                  </small>
                </button>
              ))}
            {!list.value?.length && <p className="collab-muted">暂无画板</p>}
          </div>
          {(op.message || list.error) && <p role="status">{op.message || list.error}</p>}
        </aside>
      )}
      {selected ? (
        <BoardEditor key={selected} id={selected} active={active} edit={edit} refreshList={list.refresh} />
      ) : (
        <div className="board-waiting">
          <ImageIcon size={36} />
          <strong>{edit ? '拖入截图，开始标注' : '等待共享画板'}</strong>
          {edit && <span>支持 PNG、JPEG、WebP，也可以直接粘贴</span>}
        </div>
      )}
    </div>
  );
}
function BoardEditor({ id, active, edit, refreshList }: PageProps & { id: string; refreshList: () => Promise<void> }) {
  const cache = useRef<Board | undefined>(undefined);
  const load = useCallback(async () => {
    const board = await collab<Board | null>('whiteboard', 'read', { id, revision: cache.current?.revision });
    if (board && (!cache.current || board.revision >= cache.current.revision)) cache.current = board;
    return cache.current;
  }, [id]);
  const live = useLive(active, load, 850),
    board = live.value;
  const [image, setImage] = useState<HTMLImageElement>(),
    [imageError, setImageError] = useState('');
  const [tool, setTool] = useState<Brush['tool']>('pen'),
    [color, setColor] = useState('#dc384b'),
    [width, setWidth] = useState(4),
    [text, setText] = useState('');
  const [preview, setPreview] = useState<Brush>(),
    [history, setHistory] = useState<string[]>([]),
    [zoom, setZoom] = useState(false);
  const [rename, setRename] = useState<string>();
  const canvas = useRef<HTMLCanvasElement>(null),
    stroke = useRef<{ pointer: number; brush: Brush } | null>(null);
  const confirm = useConfirmation(),
    op = useOperation();
  useEffect(() => {
    if (!active || !board?.image || image) return;
    let alive = true;
    void collab<string>('whiteboard', 'image', { id })
      .then(async (data) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + data;
        await img.decode();
        if (alive) {
          setImage(img);
          setImageError('');
        }
      })
      .catch((e) => {
        if (alive) setImageError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id, board?.image, active, image]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx || !board) return;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, board.width, board.height);
    if (image) ctx.drawImage(image, 0, 0);
    for (const mark of board.marks) drawMark(ctx, mark);
    if (preview) drawMark(ctx, preview);
  }, [board, image, preview]);
  function point(e: PointerEvent<HTMLCanvasElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(board!.width, Math.round(((e.clientX - r.left) * board!.width) / r.width))),
      Math.max(0, Math.min(board!.height, Math.round(((e.clientY - r.top) * board!.height) / r.height))),
    ];
  }
  function begin(e: PointerEvent<HTMLCanvasElement>) {
    if (
      !edit ||
      op.busy ||
      !board ||
      (board.image && !image) ||
      stroke.current ||
      e.button !== 0 ||
      (tool === 'text' && !text.trim())
    )
      return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    const brush = { tool, color, width, text, points: tool === 'pen' || tool === 'text' ? [p] : [p, p] };
    stroke.current = { pointer: e.pointerId, brush };
    setPreview(brush);
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    const current = stroke.current;
    if (current?.pointer !== e.pointerId) return;
    const brush = current.brush,
      p = point(e);
    if (brush.tool === 'text') return;
    const points = brush.tool === 'pen' ? [...brush.points, p] : [brush.points[0], p];
    current.brush = { ...brush, points: points.length > 1024 ? points.filter((_, i) => i % 2 === 0) : points };
    setPreview(current.brush);
  }
  function finish(e: PointerEvent<HTMLCanvasElement>) {
    if (stroke.current?.pointer !== e.pointerId) return;
    move(e);
    const mark = stroke.current.brush;
    stroke.current = null;
    void op.run(async () => {
      try {
        const result = await collab<{ markId: string }>('whiteboard', 'mark', { id, mark });
        setHistory((h) => [...h, result.markId]);
        await Promise.all([live.refresh(), refreshList()]);
      } finally {
        setPreview(undefined);
      }
    });
  }
  const undo = history.filter((markId) => board?.marks.some((m) => m.id === markId)).at(-1);
  const ready = board && (!board.image || image);
  return (
    <section className="collab-detail board-editor">
      <div className="collab-bar">
        <div className="board-name">
          <h2>{board?.name || '画板'}</h2>
          {board && (
            <small>
              {board.width} × {board.height} px
            </small>
          )}
        </div>
        <div className="collab-actions">
          <button onClick={() => setZoom(!zoom)}>
            <Scan size={16} />
            {zoom ? '适应宽度' : '原始尺寸'}
          </button>
          <button
            disabled={!ready || !!preview}
            onClick={() =>
              void op.run(async () => {
                const blob = await new Promise<Blob>((resolve, reject) =>
                  canvas.current!.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败。'))), 'image/png'),
                );
                return downloadBlob(blob, board!.name + '.png');
              })
            }
          >
            <Download size={16} />
            导出 PNG
          </button>
        </div>
      </div>
      {(op.message || live.error || imageError) && <p role="status">{op.message || live.error || imageError}</p>}
      <div className="board-stage">
        {edit && (
          <div className="board-tools" role="group" aria-label="绘图工具">
            {(Object.keys(tools) as Brush['tool'][]).map((t) => {
              const Icon = brushIcons[t];
              return (
                <button
                  key={t}
                  aria-label={tools[t]}
                  title={tools[t]}
                  aria-pressed={tool === t}
                  onClick={() => setTool(t)}
                >
                  <Icon size={19} />
                </button>
              );
            })}
            <button
              className="board-undo"
              title="撤销我的上一笔"
              aria-label="撤销我的上一笔"
              disabled={!undo || op.busy}
              onClick={() =>
                void op.run(async () => {
                  await collab('whiteboard', 'erase', { id, markId: undo });
                  await live.refresh();
                })
              }
            >
              <Undo2 size={19} />
            </button>
          </div>
        )}
        {board && (
          <div className={'collab-canvas' + (zoom ? ' native' : '')}>
            <canvas
              ref={canvas}
              width={board.width}
              height={board.height}
              aria-label="共享标注画布"
              style={{ touchAction: edit ? 'none' : 'auto' }}
              onPointerDown={begin}
              onPointerMove={move}
              onPointerUp={finish}
              onPointerCancel={() => {
                stroke.current = null;
                setPreview(undefined);
              }}
            />
          </div>
        )}
      </div>
      {edit && (
        <div className="brush-options">
          <strong>{tools[tool]}</strong>
          <label>
            颜色
            <input type="color" aria-label="标注颜色" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <div className="choice-field">
            <span>线宽</span>
            <SegmentedControl label="线宽" value={String(width)}
              options={[{ value: '2', label: '2 px' }, { value: '4', label: '4 px' }, { value: '8', label: '8 px' }]} onChange={value => setWidth(Number(value))} />
          </div>
          {tool === 'text' && (
            <input
              autoFocus
              aria-label="标注文字"
              placeholder="输入文字，再点画布定位"
              maxLength={240}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </div>
      )}
      {board && (
        <details>
          <summary>标注记录（{board.marks.length}）</summary>
          {[...board.marks].reverse().map((mark) => (
            <div className="collab-log" key={mark.id}>
              <span>{mark.author}</span>
              <strong>{tools[mark.tool]}</strong>
              <span>{mark.text}</span>
              {edit && (
                <button
                  disabled={op.busy}
                  onClick={() =>
                    void op.run(async () => {
                      await collab('whiteboard', 'erase', { id, markId: mark.id });
                      await live.refresh();
                    })
                  }
                >
                  移除此标注
                </button>
              )}
            </div>
          ))}
        </details>
      )}
      {edit && board && (
        <details className="board-manage">
          <summary>管理画板</summary>
          <div className="collab-actions">
            {rename === undefined ? (
              <button onClick={() => setRename(board.name)}>重命名</button>
            ) : (
              <>
                <input
                  aria-label="画板名称"
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                  maxLength={100}
                />
                <button
                  onClick={() =>
                    void op.run(async () => {
                      await collab('whiteboard', 'rename', { id, revision: board.revision, name: rename });
                      setRename(undefined);
                      await live.refresh();
                      await refreshList();
                    })
                  }
                >
                  保存名称
                </button>
                <button onClick={() => setRename(undefined)}>取消</button>
              </>
            )}
            <button
              onClick={() =>
                void op.run(async () => {
                  if (
                    !(await confirm({
                      title: '删除整张白板？',
                      detail: '所有设备上的截图与标注都将移除。',
                      confirm: '删除白板',
                    }))
                  )
                    return;
                  await collab('whiteboard', 'remove', { id, revision: board.revision });
                  openWorkspaceLink('whiteboard');
                  await refreshList();
                })
              }
            >
              删除白板
            </button>
          </div>
        </details>
      )}
    </section>
  );
}
