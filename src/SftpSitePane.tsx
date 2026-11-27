import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUp,
  Download,
  Ellipsis,
  File,
  Folder,
  FolderPlus,
  HardDrive,
  RefreshCw,
  Server,
  Upload,
} from 'lucide-react';
import { lanRequest } from './lan-api';
import { useConfirmation } from './Confirmation';
import { Modal, ModalCancel } from './project-components';
import { TextInput } from './TextControl';
import LanHostMenu from './LanHostMenu';
import { validName, type Entry, type Listing, type Side, type Site } from './sftp-sites';

export const formatSize = (bytes = 0) =>
  bytes < 1024
    ? bytes + ' B'
    : bytes < 1048576
      ? (bytes / 1024).toFixed(1) + ' KiB'
      : (bytes / 1048576).toFixed(1) + ' MiB';
export type FileSelection = { side: Side; from: string; entries: Entry[] };
type Props = {
  side: Side;
  site: Site;
  revision: number;
  label: string;
  writable: boolean;
  toolbar?: ReactNode;
  onDirectory: (path: string) => void;
  enqueue: (source: FileSelection, hold: boolean, destination?: string) => void;
  drag: React.RefObject<FileSelection | null>;
  ready: boolean;
  connected: boolean;
  native?: boolean;
};
const perPage = 100;
export default function SftpSitePane({
  side,
  site,
  revision,
  label,
  writable,
  toolbar,
  onDirectory,
  enqueue,
  drag,
  ready,
  connected,
  native,
}: Props) {
  const [listing, setListing] = useState<Listing>(),
    [address, setAddress] = useState('.'),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(false),
    [editing, setEditing] = useState<{ kind: 'mkdir' | 'rename'; parent: string; original: string }>(),
    [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]),
    [filter, setFilter] = useState(''),
    [page, setPage] = useState(0);
  const [sort, setSort] = useState<'name' | 'size' | 'modified'>('name'),
    [reverse, setReverse] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; anchor: HTMLElement }>();
  const sequence = useRef(0),
    directory = useRef('.'),
    requested = useRef('.'),
    anchor = useRef(''),
    confirm = useConfirmation();
  const [mutating, setMutating] = useState(false),
    [editError, setEditError] = useState('');
  const selectedPaths = useMemo(() => new Set(picked), [picked]);
  const selected = useMemo(
    () => listing?.entries.filter((item) => selectedPaths.has(item.path)) || [],
    [listing, selectedPaths],
  );
  const items = useMemo(
    () =>
      (listing?.entries || [])
        .filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
        .sort(
          (a, b) =>
            Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
            (reverse ? -1 : 1) *
              (sort === 'name'
                ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
                : (a[sort] || 0) - (b[sort] || 0)),
        ),
    [listing, filter, sort, reverse],
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(items.length / perPage) - 1));
  const visible = items.slice(currentPage * perPage, (currentPage + 1) * perPage);
  const verb = side === 'local' ? '上传' : '下载',
    Icon = side === 'local' ? Upload : Download;
  async function load(path: string) {
    const seq = ++sequence.current;
    requested.current = path;
    setLoading(true);
    setError('');
    try {
      const next = await site.list(path);
      if (seq !== sequence.current) return;
      if (directory.current !== next.directory) {
        setPicked([]);
        setPage(0);
        anchor.current = '';
      } else {
        const paths = new Set(next.entries.map((item) => item.path));
        setPicked((current) => current.filter((item) => paths.has(item)));
      }
      requested.current = directory.current = next.directory;
      setAddress(next.directory);
      setListing(next);
      onDirectory(next.directory);
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (connected) void load(requested.current);
    return () => {
      sequence.current++;
    };
  }, [site, revision, connected]);
  function transfer(entries: Entry[], hold = false) {
    if (listing && ready) enqueue({ side, from: listing.directory, entries }, hold);
  }
  function select(entry: Entry, extend: boolean, toggle: boolean) {
    if (extend && anchor.current) {
      const first = items.findIndex((item) => item.path === anchor.current),
        last = items.indexOf(entry);
      if (first >= 0) {
        setPicked(items.slice(Math.min(first, last), Math.max(first, last) + 1).map((item) => item.path));
        return;
      }
    }
    anchor.current = entry.path;
    setPicked((current) =>
      toggle
        ? current.includes(entry.path)
          ? current.filter((path) => path !== entry.path)
          : [...current, entry.path]
        : [entry.path],
    );
  }
  function popup(el: HTMLElement, entry?: Entry, x?: number, y?: number) {
    if (entry && !picked.includes(entry.path)) select(entry, false, false);
    if (!entry && el.tagName !== 'BUTTON') setPicked([]);
    const rect = el.getBoundingClientRect();
    setMenu({ id: side, x: x ?? rect.left, y: y ?? rect.bottom, anchor: el });
  }
  function edit(kind: 'mkdir' | 'rename') {
    if (!listing || (kind === 'rename' && selected.length !== 1)) return;
    const original = kind === 'rename' ? selected[0].name : '';
    setName(original);
    setEditError('');
    setEditing({ kind, parent: listing.directory, original });
  }
  async function saveName() {
    if (!editing) return;
    setMutating(true);
    try {
      validName(name);
      if (editing.kind === 'mkdir') await site.mkdir(editing.parent, name);
      else if (name !== editing.original) await site.rename(editing.parent, editing.original, name);
      setEditing(undefined);
      await load(directory.current);
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setMutating(false);
    }
  }
  const [operation, setOperation] = useState('');
  async function remove() {
    if (!listing || !selected.length) return;
    const path = listing.directory;
    if (
      !(await confirm({
        title: '删除' + label + '的所选项目？',
        detail:
          path +
          ' · ' +
          selected
            .slice(0, 3)
            .map((e) => e.name)
            .join('、') +
          (selected.length > 3 ? ' 等 ' + selected.length + ' 项' : '') +
          '。文件夹中的内容也会删除。',
        confirm: '删除',
      }))
    )
      return;
    setMutating(true);
    let problem = '';
    try {
      for (const [index, entry] of selected.entries()) {
        setOperation(`正在删除 ${index + 1}/${selected.length} · ${entry.name}`);
        await site.remove(path, entry.name);
      }
    } catch (e) {
      problem = (e as Error).message;
    } finally {
      await load(path);
      setOperation('');
      if (problem) setError(problem);
      setMutating(false);
    }
  }
  const transferable = selected.some((e) => e.kind !== 'other') && ready;
  return (
    <section
      className="sftp-site"
      aria-label={label}
      onDragOver={(e) => {
        if (drag.current && drag.current.side !== side) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const source = drag.current;
        if (source && source.side !== side && listing) {
          e.preventDefault();
          const folder = (e.target as Element).closest<HTMLElement>('[data-directory]')?.dataset.directory;
          enqueue(source, false, folder || listing.directory);
          drag.current = null;
        }
      }}
    >
      <header>
        <h3>
          {side === 'local' ? <HardDrive size={16} /> : <Server size={16} />} {label}
        </h3>
        {toolbar}
        {native && (
          <button
            className="text-button"
            onClick={async () => {
              try {
                const path = await lanRequest<string | null>('pick-sftp-directory');
                if (path) await load(path);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            选择目录
          </button>
        )}
        <button
          className="icon-button"
          disabled={!writable || !listing || mutating}
          aria-label={label + '新建文件夹'}
          onClick={() => edit('mkdir')}
        >
          <FolderPlus size={16} />
        </button>
        <button
          className="icon-button"
          disabled={!listing || mutating}
          aria-label={label + '操作'}
          onClick={(e) => popup(e.currentTarget)}
        >
          <Ellipsis size={17} />
        </button>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(address);
        }}
      >
        <button
          className="icon-button"
          type="button"
          aria-label={label + '上级目录'}
          disabled={!listing || listing.directory === listing.parent}
          onClick={() => void load(listing!.parent)}
        >
          <ArrowUp size={15} />
        </button>
        <TextInput
          value={address}
          aria-label={label + '路径'}
          onChange={(e) => setAddress(e.target.value)}
          spellCheck={false}
        />
        <button className="icon-button" aria-label={label + '打开或刷新'}>
          <RefreshCw size={15} />
        </button>
      </form>
      <div className="sftp-filter">
        <TextInput
          aria-label={label + '筛选文件名'}
          placeholder="筛选文件名"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
            setPicked([]);
          }}
        />
        <button className="secondary-button" disabled={!transferable || mutating} onClick={() => transfer(selected)}>
          <Icon size={14} /> {verb}
        </button>
      </div>
      <div className="sftp-cols sftp-head">
        {(['name', 'size', 'modified'] as const).map((key, i) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setReverse(sort === key && !reverse);
              setSort(key);
            }}
          >
            {['名称', '大小', '修改时间'][i]} {sort === key && (reverse ? '↓' : '↑')}
          </button>
        ))}
      </div>
      <div
        className="sftp-entries"
        role="listbox"
        tabIndex={0}
        aria-label={label + '文件列表'}
        aria-multiselectable="true"
        aria-busy={loading}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!mutating) popup(e.currentTarget, undefined, e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          if (e.ctrlKey || e.metaKey) {
            if (e.key.toLowerCase() === 'a') {
              e.preventDefault();
              setPicked(items.map((i) => i.path));
            }
            return;
          }
          if (e.key === 'F5') {
            e.preventDefault();
            void load(directory.current);
          }
          if (e.key === 'F2' && writable && selected.length === 1) {
            e.preventDefault();
            edit('rename');
          }
          if (e.key === 'Delete' && writable && !mutating) {
            e.preventDefault();
            void remove();
          }
          if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && !mutating) {
            e.preventDefault();
            popup(e.target as HTMLElement, selected[0]);
          }
        }}
      >
        {visible.map((entry) => (
          <button
            key={entry.path}
            type="button"
            role="option"
            aria-selected={picked.includes(entry.path)}
            title={entry.name}
            className="sftp-cols sftp-entry"
            data-directory={entry.kind === 'directory' ? entry.path : undefined}
            draggable={entry.kind !== 'other'}
            onDragStart={(e) => {
              if (!listing) return;
              const entries = picked.includes(entry.path) ? selected : [entry];
              setPicked(entries.map((i) => i.path));
              drag.current = { side, entries, from: listing.directory };
              e.dataTransfer.effectAllowed = 'copy';
              e.dataTransfer.setData('text/plain', entry.name);
            }}
            onDragEnd={() => {
              drag.current = null;
            }}
            onClick={(e) => select(entry, e.shiftKey, e.ctrlKey || e.metaKey)}
            onDoubleClick={() => (entry.kind === 'directory' ? void load(entry.path) : transfer([entry]))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (entry.kind === 'directory') void load(entry.path);
                else transfer(picked.includes(entry.path) ? selected : [entry]);
              }
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const next =
                  e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
                if (next instanceof HTMLButtonElement) {
                  next.focus();
                  const index = visible.indexOf(entry) + (e.key === 'ArrowDown' ? 1 : -1);
                  select(visible[index], e.shiftKey, false);
                }
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!mutating) popup(e.currentTarget, entry, e.clientX, e.clientY);
            }}
          >
            <span>
              {entry.kind === 'directory' ? <Folder size={15} /> : <File size={15} />}
              <span>{entry.name}</span>
            </span>
            <small>{entry.kind === 'file' ? formatSize(entry.size) : entry.kind === 'other' ? '特殊' : '—'}</small>
            <small>{entry.modified ? new Date(entry.modified).toLocaleDateString() : '—'}</small>
          </button>
        ))}
        {!visible.length && (
          <p className="lan-note">{loading ? '正在读取…' : filter ? '没有匹配的文件' : '目录为空'}</p>
        )}
      </div>
      <footer>
        <span>
          {items.length} 项 · 已选 {selected.length}
        </span>
        {items.length > perPage && (
          <>
            <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>
            <span>
              {currentPage + 1}/{Math.ceil(items.length / perPage)}
            </span>
            <button disabled={(currentPage + 1) * perPage >= items.length} onClick={() => setPage(currentPage + 1)}>
              下一页
            </button>
          </>
        )}
      </footer>
      {operation && (
        <p className="lan-note" role="status">
          {operation}
        </p>
      )}
      {error && (
        <p className="pc-error" role="alert">
          {error}
        </p>
      )}
      {menu && (
        <LanHostMenu
          position={menu}
          anchorElement={menu.anchor}
          label={label + '文件操作'}
          close={() => setMenu(undefined)}
        >
          <div className="lan-menu-actions">
            <button role="menuitem" disabled={!transferable} onClick={() => transfer(selected)}>
              {verb}所选项目
            </button>
            <button role="menuitem" disabled={!transferable} onClick={() => transfer(selected, true)}>
              加入传输队列
            </button>
            <button
              role="menuitem"
              disabled={selected.length !== 1 || selected[0].kind !== 'directory'}
              onClick={() => void load(selected[0].path)}
            >
              打开目录
            </button>
            <button role="menuitem" disabled={!writable} onClick={() => edit('mkdir')}>
              新建文件夹
            </button>
            <button role="menuitem" disabled={!writable || selected.length !== 1} onClick={() => edit('rename')}>
              重命名
            </button>
            <button role="menuitem" disabled={!writable || !selected.length} onClick={() => void remove()}>
              删除所选项目
            </button>
            <button role="menuitem" onClick={() => void load(directory.current)}>
              刷新目录
            </button>
          </div>
        </LanHostMenu>
      )}
      {editing && (
        <Modal
          title={editing.kind === 'mkdir' ? '新建文件夹' : '重命名'}
          closeLabel="关闭文件操作"
          close={() => setEditing(undefined)}
          busy={mutating}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <label className="lan-field">
              {label} · {editing.parent}
              <TextInput
                aria-label="名称"
                data-modal-focus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {editError && (
              <p className="pc-error" role="alert">
                {editError}
              </p>
            )}
            <footer>
              <ModalCancel />
              <button className="run-button" disabled={mutating}>
                确定
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
