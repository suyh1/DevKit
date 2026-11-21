import { useEffect, useRef, useState } from 'react';
import { Field, Modal, ModalCancel, ModalForm } from './project-components';
import SegmentedControl from './SegmentedControl';
import { kinds, type Article, type KnowledgeKind } from './knowledge-api';
import {
  referenceText,
  renderArticle,
  resourceKinds,
  resourceNames,
  type ResourceKind,
} from './knowledge-markdown';
import { workspaceSearch, type WorkspaceResult } from './workspace-links';
import { workspaceRestriction } from './related-workspaces';
import { lanRequest, sharedLanInventory, type LanHost } from './lan-api';

export const outlines: Record<KnowledgeKind, string> = {
  部署手册: '## 准备工作\n\n\n## 部署步骤\n\n1. \n\n## 验证\n\n\n## 回退\n',
  故障排查: '## 故障现象\n\n\n## 排查步骤\n\n1. \n\n## 处理与验证\n',
  项目交接: '## 项目概况\n\n\n## 日常维护\n\n\n## 待跟进事项\n',
};

function ResourcePicker({ onInsert }: { onInsert: (page: ResourceKind, id: string, name: string) => void }) {
  const [kind, setKind] = useState<ResourceKind | ''>('');
  const [rows, setRows] = useState<WorkspaceResult[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setRows([]);
    setError('');
    setLoading(!!kind);
    if (!kind) return;
    async function load(page: ResourceKind) {
      if (page === 'lan-hosts') {
        const hosts = window.devkitDesktop?.lanHosts
          ? await lanRequest<LanHost[]>('list')
          : (await sharedLanInventory()).hosts;
        if (live)
          setRows(hosts.map((host) => ({ page, id: host.id, label: host.name, detail: host.address })));
      } else {
        const results = await workspaceSearch([page], (chunk) => {
          if (live) setRows((old) => [...old, ...chunk.filter((row) => row.id)]);
        });
        if (results.some((result) => result.status === 'rejected')) throw new Error('资源清单读取失败。');
      }
    }
    void load(kind)
      .catch((failure) => {
        if (live) setError(failure.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [kind]);
  return (
    <div className="kb-picker">
      <label>
        插入资源链接
        <select value={kind} onChange={(e) => setKind(e.target.value as ResourceKind | '')}>
          <option value="">选择栏目（可选）</option>
          {resourceKinds
            .filter((page) => !workspaceRestriction(page))
            .map((page) => (
              <option key={page} value={page}>
                {resourceNames[page]}
              </option>
            ))}
        </select>
      </label>
      {kind && (
        <label>
          {resourceNames[kind]}
          <select
            value=""
            disabled={!rows.length}
            onChange={(e) => {
              const row = rows.find((item) => item.id === e.target.value);
              if (row?.id) onInsert(kind, row.id, row.label);
            }}
          >
            <option value="">
              {loading ? '正在读取…' : rows.length ? '选择后插入正文' : '暂无可选资源'}
            </option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label} · {row.detail}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

export function KnowledgeEditor({
  initial,
  projects,
  editing,
  active,
  close,
  save,
  busy,
  error,
}: {
  initial: Article;
  projects: string[];
  editing: boolean;
  active: boolean;
  close: () => void;
  save: (value: Article) => void;
  busy: boolean;
  error: string;
}) {
  const [form, setForm] = useState(initial);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const area = useRef<HTMLTextAreaElement>(null);
  const patch = (next: Partial<Article>) => setForm((old) => ({ ...old, ...next }));
  function insert(page: ResourceKind, id: string, label: string) {
    const input = area.current;
    if (!input) return;
    const link = referenceText(page, id, label),
      { selectionStart: start, selectionEnd: end } = input;
    patch({ body: form.body.slice(0, start) + link + form.body.slice(end) });
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + link.length, start + link.length);
    });
  }
  return (
    <Modal
      title={editing ? '编辑文档' : '新建文档'}
      closeLabel="关闭文档编辑"
      close={close}
      active={active}
      busy={busy}
      draft={form}
      wide
    >
      <ModalForm
        onSubmit={(event) => {
          event.preventDefault();
          save(form);
        }}
        footer={
          <footer>
            <ModalCancel />
            <button className="run-button" disabled={busy || !form.title.trim()}>
              保存文档
            </button>
          </footer>
        }
      >
        <Field label="文档标题">
          <input
            data-modal-focus
            required
            maxLength={120}
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
          />
        </Field>
        <div className="kb-fields">
          <Field label="所属项目">
            <input
              list="kb-projects"
              placeholder="通用"
              maxLength={120}
              value={form.project}
              onChange={(e) => patch({ project: e.target.value })}
            />
            <datalist id="kb-projects">
              {projects.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="文档类型">
            <select
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as KnowledgeKind;
                patch({
                  kind,
                  ...(!editing && form.body === outlines[form.kind] ? { body: outlines[kind] } : {}),
                });
              }}
            >
              {kinds.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </Field>
        </div>
        <SegmentedControl
          label="正文模式"
          value={mode}
          options={[
            { value: 'write', label: 'Markdown' },
            { value: 'preview', label: '预览' },
          ]}
          onChange={setMode}
        />
        {mode === 'write' ? (
          <>
            <ResourcePicker onInsert={insert} />
            <Field label="正文">
              <textarea
                className="kb-source"
                ref={area}
                rows={12}
                maxLength={120000}
                value={form.body}
                onChange={(e) => patch({ body: e.target.value })}
              />
            </Field>
          </>
        ) : (
          <div
            className="kb-prose"
            onClick={(e) => {
              if ((e.target as Element).closest('a')) e.preventDefault();
            }}
            dangerouslySetInnerHTML={{ __html: renderArticle(form.body) }}
          />
        )}
        {error && (
          <p className="pc-notice" role="alert">
            {error}
          </p>
        )}
      </ModalForm>
    </Modal>
  );
}
