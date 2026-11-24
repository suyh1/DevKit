import { useEffect, useRef, useState, type RefObject } from 'react';
import { CircleDot, Layers, Minus, Plus } from 'lucide-react';
import ResultPager from './ResultPager';
import type { Change } from './git-api';

const pageSize = 50;
const statusNames: Record<string, string> = {
  M: '修改',
  A: '新增',
  D: '删除',
  T: '类型变化',
  U: '冲突',
  '?': '未跟踪',
};

export default function GitFileGroup({
  files,
  staged,
  activePath,
  headingRef,
  edit,
  busy,
  onSelect,
  onApply,
}: {
  files: Change[];
  staged: boolean;
  activePath?: string;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  edit: boolean;
  busy: boolean;
  onSelect: (path: string) => void;
  onApply: (paths: string[]) => Promise<boolean>;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const activeIndex = activePath ? files.findIndex((file) => file.path === activePath) : -1;
  const activePage = Math.floor(activeIndex / pageSize);
  const [requestedPage, setPage] = useState(Math.max(0, activePage));
  const pages = Math.max(1, Math.ceil(files.length / pageSize));
  const page = Math.min(requestedPage, pages - 1);
  const shown = files.slice(page * pageSize, (page + 1) * pageSize);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activePage >= 0) setPage(activePage);
  }, [activePage]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = 0;
  }, [page]);
  const all = useRef<HTMLInputElement>(null);
  const eligible = files.filter((file) => !file.conflict).map((file) => file.path);
  useEffect(() => {
    const remaining = new Set(files.filter((file) => !file.conflict).map((file) => file.path));
    setChecked((previous) =>
      previous.every((path) => remaining.has(path)) ? previous : previous.filter((path) => remaining.has(path)),
    );
  }, [files]);
  const picked = new Set(checked);
  const selected = eligible.filter((path) => picked.has(path));
  const onPage = shown.filter((file) => !file.conflict).map((file) => file.path);
  const pagePicked = onPage.filter((path) => picked.has(path)).length;
  const name = staged ? '已暂存' : '未暂存';
  const action = staged ? '取消暂存' : '暂存';
  const Icon = staged ? Minus : Plus;
  useEffect(() => {
    if (all.current) all.current.indeterminate = pagePicked > 0 && pagePicked < onPage.length;
  }, [pagePicked, onPage.length]);
  const apply = async (paths: string[]) => {
    if (await onApply(paths)) {
      const applied = new Set(paths);
      setChecked((previous) => previous.filter((path) => !applied.has(path)));
    }
  };
  return (
    <section className="git-file-group" aria-label={name}>
      <header>
        {edit && (
          <input
            type="checkbox"
            ref={all}
            aria-label={'全选本页' + name + '文件'}
            disabled={busy || !onPage.length}
            checked={!!onPage.length && pagePicked === onPage.length}
            title={'选择本页' + name + '文件'}
            onChange={(e) => {
              const next = new Set(selected);
              for (const path of onPage) {
                if (e.target.checked) next.add(path);
                else next.delete(path);
              }
              setChecked([...next]);
            }}
          />
        )}
        <h4 ref={headingRef} tabIndex={-1}>
          {staged ? <Layers size={14} /> : <CircleDot size={14} />} {name} <small>{files.length}</small>
        </h4>
        {edit && selected.length > 0 && (
          <button
            type="button"
            className="text-button git-batch-action"
            disabled={busy}
            onClick={() => void apply(selected)}
          >
            {action}所选（{selected.length}）
          </button>
        )}
      </header>
      {pages > 1 && (
        <div className="git-file-page-tools">
          <ResultPager
            page={page}
            pages={pages}
            label={name + '文件分页'}
            onPage={(next) => {
              setPage(next);
              onSelect(files[next * pageSize].path);
            }}
          />
          {edit && selected.length > 0 && (
            <>
              {pagePicked === onPage.length && selected.length < eligible.length && (
                <button type="button" className="text-button" disabled={busy} onClick={() => setChecked(eligible)}>
                  选中全部 {eligible.length} 个匹配文件
                </button>
              )}
              <button type="button" className="text-button" disabled={busy} onClick={() => setChecked([])}>
                清除勾选
              </button>
            </>
          )}
        </div>
      )}
      <div className="git-group-rows" ref={scroll}>
        {shown.map((file) => {
          const status = staged ? file.index : file.work;
          return (
            <div key={file.path} className="git-file-row" data-selected={file.path === activePath}>
              {edit && (
                <input
                  type="checkbox"
                  aria-label={'选择' + name + '文件 ' + file.path}
                  disabled={busy || file.conflict}
                  checked={!file.conflict && picked.has(file.path)}
                  onChange={(e) =>
                    setChecked(e.target.checked ? [...selected, file.path] : selected.filter((p) => p !== file.path))
                  }
                />
              )}
              <button
                type="button"
                className="git-path"
                aria-pressed={file.path === activePath}
                onClick={() => onSelect(file.path)}
                title={file.path}
              >
                <span dir="auto">{file.path}</span>
                <em data-code={status}>{file.conflict ? '冲突' : statusNames[status] || '改动'}</em>
              </button>
              {edit && !file.conflict && (
                <button
                  type="button"
                  className="icon-button git-file-action"
                  aria-label={action + ' ' + file.path}
                  title={action + '整个文件'}
                  disabled={busy}
                  onClick={() => void apply([file.path])}
                >
                  <Icon size={16} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
