import { TextInput } from './TextControl';
import { useEffect, useRef, useState } from 'react';
import { Modal } from './project-components';
import { workspaceRestriction } from './related-workspaces';
import { useDocumentLibrary } from './knowledge-api';
import { resourceKinds, resourceNames, type ResourceKind } from './knowledge-markdown';
import { workspaceSearch, type WorkspaceResult } from './workspace-links';
import { lanRequest, sharedLanInventory, type LanHost } from './lan-api';

export type ResourceChoice = { page: ResourceKind; id: string; label: string; detail: string; host?: string };
export async function loadResources(kind: ResourceKind, add: (rows: ResourceChoice[]) => void) {
  if (workspaceRestriction(kind)) throw new Error('当前访客没有此栏目的查看权限。');
  if (kind === 'lan-hosts') {
    const hosts = window.devkitDesktop?.lanHosts
      ? await lanRequest<LanHost[]>('list')
      : (await sharedLanInventory()).hosts;
    add(hosts.map((host) => ({ page: kind, id: host.id, label: host.name, detail: host.address })));
    return;
  }
  const results = await workspaceSearch([kind], (batch: WorkspaceResult[]) =>
    add(batch.flatMap((row) => (row.id ? [{ ...row, id: row.id, page: kind }] : []))),
  );
  if (results.some((row) => row.status === 'rejected')) throw new Error('清单读取失败。');
}
const key = (row: ResourceChoice) => row.page + '/' + row.id;
export function KnowledgeResourcePicker({
  close,
  insert,
  documentId,
}: {
  close: () => void;
  insert: (rows: ResourceChoice[]) => void;
  documentId?: string;
}) {
  const { section } = useDocumentLibrary();
  const allowed = resourceKinds.filter((kind) => !workspaceRestriction(kind));
  const [filters, setFilters] = useState<ResourceKind[]>([section]);
  const [selected, setSelected] = useState<ResourceChoice[]>([]),
    [rows, setRows] = useState<ResourceChoice[]>([]);
  const [query, setQuery] = useState(''),
    [errors, setErrors] = useState<string[]>([]),
    [pending, setPending] = useState(0);
  const loaded = useRef(new Set<ResourceKind>()),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    for (const kind of filters) {
      if (loaded.current.has(kind)) continue;
      loaded.current.add(kind);
      setPending((n) => n + 1);
      void loadResources(kind, (batch) => {
        if (mounted.current) setRows((old) => [...old, ...batch]);
      })
        .catch((e) => {
          if (mounted.current) setErrors((old) => [...old, resourceNames[kind] + ' · ' + e.message]);
        })
        .finally(() => {
          if (mounted.current) setPending((n) => n - 1);
        });
    }
  }, [filters]);
  const term = query.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      filters.includes(row.page) &&
      !(row.page === section && row.id === documentId) &&
      [row.label, row.detail, row.host].join(' ').toLowerCase().includes(term),
  );
  function toggle(row: ResourceChoice) {
    setSelected((old) =>
      old.some((item) => key(item) === key(row))
        ? old.filter((item) => key(item) !== key(row))
        : [...old, row],
    );
  }
  return (
    <Modal
      title="插入资源链接"
      className="kb-resource-dialog"
      close={close}
      closeLabel="关闭资源选择"
      wide
      footer={
        <footer>
          <button className="secondary-button" onClick={close}>
            取消
          </button>
          <button className="run-button" disabled={!selected.length} onClick={() => insert(selected)}>
            插入 {selected.length} 项
          </button>
        </footer>
      }
    >
      <TextInput
        type="search"
        aria-label="搜索资源"
        data-modal-focus
        placeholder="搜索资源名称、主机或路径"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <fieldset className="kb-filters">
        <legend>栏目</legend>
        {allowed.map((kind) => (
          <label key={kind}>
            <input
              className="form-check" type="checkbox"
              checked={filters.includes(kind)}
              onChange={() =>
                setFilters((old) => (old.includes(kind) ? old.filter((k) => k !== kind) : [...old, kind]))
              }
            />
            {resourceNames[kind]}
          </label>
        ))}
      </fieldset>
      <div className="kb-choices">
        {visible.map((row) => (
          <label key={key(row)}>
            <input
              className="form-check" type="checkbox"
              checked={selected.some((s) => key(s) === key(row))}
              onChange={() => toggle(row)}
            />
            <span>
              <strong>{row.label}</strong>
              <small>
                {resourceNames[row.page]} · {row.detail}
              </small>
            </span>
          </label>
        ))}
        {pending > 0 && <p role="status">正在读取资源…</p>}
        {!pending && !visible.length && <p>没有匹配的资源。</p>}
        {errors.map((e) => (
          <p key={e} role="alert">
            {e}
          </p>
        ))}
      </div>
      {!!selected.length && (
        <details className="kb-selected">
          <summary><strong>已选 {selected.length} 项</strong></summary>
          <div>
            {selected.map((row) => (
              <button
                key={key(row)}
                className="text-button"
                aria-label={'移除 ' + row.label}
                onClick={() => toggle(row)}
              >
                {row.label}
                {row.host && ' · ' + row.host} ×
              </button>
            ))}
          </div>
        </details>
      )}
    </Modal>
  );
}
