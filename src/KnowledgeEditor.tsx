import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { ArrowLeft, Link2, PanelRightOpen, Save } from 'lucide-react';
import CodeEditor from './CodeEditor';
import SegmentedControl from './SegmentedControl';
import { useBeforeUnload, useConfirmation } from './Confirmation';
import { knowledgeRequest, type Article, type KnowledgePage, type Template } from './knowledge-api';
import { articleFields, type WritingDraft } from './knowledge-drafts';
import { useCodeBlockColors } from './knowledge-code-blocks';
import { referenceText, renderArticle } from './knowledge-markdown';
import { KnowledgeResourcePicker, type ResourceChoice } from './KnowledgeResourcePicker';

export const outlines: Record<Template, string> = {
  部署手册: '## 准备工作\n\n\n## 部署步骤\n\n1. \n\n## 验证\n\n\n## 回退\n',
  故障排查: '## 故障现象\n\n\n## 排查步骤\n\n1. \n\n## 处理与验证\n',
  项目交接: '## 项目概况\n\n\n## 日常维护\n\n\n## 待跟进事项\n',
};
type Props = {
  initial: WritingDraft;
  prefix: string;
  active: boolean;
  folders: string[];
  projects: string[];
  saved: (page: KnowledgePage) => void;
  leave: (id?: string) => void;
};
export function KnowledgeEditor({ initial, prefix, active, folders, projects, saved, leave }: Props) {
  const [draft, setDraft] = useState(initial),
    live = useRef(draft),
    view = useRef<EditorView | null>(null);
  const [mode, setMode] = useState<'write' | 'split' | 'preview'>('write'),
    [properties, setProperties] = useState(false),
    [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false),
    lock = useRef(false),
    discarded = useRef(false);
  const [error, setError] = useState(''),
    [diskError, setDiskError] = useState(''),
    [stored, setStored] = useState(initial.time);
  const [conflict, setConflict] = useState<KnowledgePage | null | undefined>();
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 740px)').matches);
  const confirm = useConfirmation();
  const storageKey = prefix + initial.token;
  const sourceTop = useRef(initial.position?.top ?? 0);
  function changeMode(next: typeof mode) {
    if (mode !== 'preview' && view.current) sourceTop.current = view.current.scrollDOM.scrollTop;
    setMode(next);
  }
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor || mode === 'preview') return;
    editor.requestMeasure();
    editor.scrollDOM.scrollTop = sourceTop.current;
  }, [mode]);
  function update(next: WritingDraft) {
    live.current = next;
    setDraft(next);
  }
  function patch(fields: Partial<Article>) {
    update({ ...live.current, form: { ...live.current.form, ...fields }, changed: true, time: Date.now() });
  }
  const persist = useCallback(() => {
    if (discarded.current) return true;
    const editor = view.current,
      value = live.current;
    if (editor) {
      const { anchor, head } = editor.state.selection.main;
      if (editor.dom.getClientRects().length) sourceTop.current = editor.scrollDOM.scrollTop;
      value.position = { anchor, head, top: sourceTop.current };
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }, [storageKey]);
  useLayoutEffect(() => {
    const ok = persist();
    setDiskError(ok ? '' : '设备存储空间不足，草稿尚未写入本机。请保存到知识库。');
    if (ok) setStored(draft.time);
  }, [draft, persist]);
  useEffect(() => {
    const flush = () => {
      persist();
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      if (!live.current.changed && !location.hash.endsWith(live.current.token)) {
        discarded.current = true;
        localStorage.removeItem(storageKey);
      } else flush();
    };
  }, [persist, storageKey]);
  useBeforeUnload(!!diskError && draft.changed);
  useEffect(() => {
    const media = matchMedia('(max-width: 740px)');
    const resize = () => {
      setNarrow(media.matches);
      if (media.matches) setMode((old) => (old === 'split' ? 'write' : old));
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  function ready(editor: EditorView | null) {
    if (!editor) {
      persist();
      view.current = null;
      return;
    }
    view.current = editor;
    const pos = live.current.position;
    if (pos) {
      const size = editor.state.doc.length;
      editor.dispatch({ selection: { anchor: Math.min(pos.anchor, size), head: Math.min(pos.head, size) } });
      requestAnimationFrame(() => {
        editor.scrollDOM.scrollTop = pos.top;
      });
    }
  }
  function clearDraft() {
    discarded.current = true;
    localStorage.removeItem(storageKey);
  }
  function back() {
    if (lock.current) return;
    if (draft.changed && !persist()) {
      setDiskError('无法保存本机草稿。请保存文档或明确丢弃草稿。');
      return;
    }
    if (!draft.changed) clearDraft();
    leave(draft.documentId);
  }
  async function save(finish = false, copy = false, revision?: number) {
    if (lock.current || !live.current.form.title.trim()) return;
    const original = live.current;
    if (!original.changed && original.documentId && !copy && revision === undefined) {
      if (finish) {
        clearDraft();
        leave(original.documentId);
      }
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const data = copy
        ? { ...original.form, title: original.form.title.slice(0, 115) + '（副本）' }
        : original.form;
      const page = await knowledgeRequest<KnowledgePage>(original.documentId && !copy ? 'save' : 'create', {
        ...data,
        id: copy ? undefined : original.documentId,
        revision: revision ?? original.revision,
      });
      const changed = live.current.form !== original.form;
      update({
        ...live.current,
        form: changed ? live.current.form : articleFields(page),
        revision: page.revision,
        documentId: page.id,
        changed,
        time: Date.now(),
      });
      saved(page);
      setConflict(undefined);
      if (finish && !changed) {
        clearDraft();
        leave(page.id);
      }
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError((e as Error).message);
      if (status === 404) setConflict(null);
      if (status === 409) {
        try {
          const pages = await knowledgeRequest<KnowledgePage[]>('list');
          setConflict(pages.find((p) => p.id === original.documentId) ?? null);
        } catch (failure) {
          setError((failure as Error).message);
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!picker && conflict === undefined) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  function insert(rows: ResourceChoice[]) {
    const editor = view.current;
    if (!editor) return;
    const { from, to } = editor.state.selection.main;
    const links = rows.map((r) => referenceText(r.page, r.id, r.label + (r.host ? ' · ' + r.host : '')));
    const text =
      links.length === 1
        ? links[0]
        : (from > 0 && editor.state.doc.lineAt(from).from !== from ? '\n' : '') +
          links.map((s) => '- ' + s).join('\n') +
          '\n';
    editor.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
    });
    setPicker(false);
    requestAnimationFrame(() => editor.focus());
  }
  const rendered = useMemo(
    () => (mode === 'write' ? '' : renderArticle(draft.form.body)),
    [mode, draft.form.body],
  );
  const preview = useRef<HTMLDivElement>(null);
  useCodeBlockColors(preview, rendered);
  return (
    <section className="kb-writing" aria-label="知识库写作页">
      <header className="kb-writing-bar">
        <button className="text-button" onClick={back} disabled={busy}>
          <ArrowLeft size={16} />
          知识库
        </button>
        <span role="status" className="kb-save-state">
          {busy
            ? '正在保存…'
            : diskError
              ? '草稿未保存'
              : draft.changed
                ? '本机草稿 · ' + new Date(stored).toLocaleTimeString()
                : '已保存 · v' + draft.revision}
        </span>
        <button
          className="secondary-button"
          disabled={busy || !draft.form.title.trim() || conflict !== undefined}
          onClick={() => void save()}
        >
          <Save size={15} />
          保存
        </button>
        <button
          className="run-button"
          disabled={busy || !draft.form.title.trim() || conflict !== undefined}
          onClick={() => void save(true)}
        >
          完成编辑
        </button>
      </header>
      <div className="kb-manuscript">
        <input
          className="kb-title-input"
          aria-label="文档标题"
          placeholder="无标题文档"
          autoFocus
          maxLength={120}
          value={draft.form.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
        <div className="kb-writing-tools">
          <SegmentedControl
            label="写作视图"
            value={mode}
            options={[
              { value: 'write', label: '编辑' },
              ...(!narrow ? [{ value: 'split' as const, label: '分栏' }] : []),
              { value: 'preview', label: '预览' },
            ]}
            onChange={changeMode}
          />
          <button
            className="text-button"
            disabled={mode === 'preview' || busy}
            onClick={() => setPicker(true)}
          >
            <Link2 size={15} />
            插入资源
          </button>
          <button
            className="text-button"
            aria-expanded={properties}
            onClick={() => setProperties(!properties)}
          >
            <PanelRightOpen size={15} />
            文档属性
          </button>
        </div>
        {properties && (
          <div className="kb-properties">
            <label>
              目录
              <input
                list="kb-folders"
                placeholder="未归档，如 基础知识 / 网络"
                maxLength={240}
                value={draft.form.folder}
                onChange={(e) => patch({ folder: e.target.value })}
              />
            </label>
            <datalist id="kb-folders">
              {folders.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </datalist>
            <label>
              所属项目
              <input
                list="kb-projects"
                maxLength={120}
                value={draft.form.project}
                onChange={(e) => patch({ project: e.target.value })}
              />
            </label>
            <datalist id="kb-projects">
              {projects.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </datalist>
            <label>
              标签（逗号分隔）
              <input
                value={draft.form.tags.join('，')}
                onChange={(e) => patch({ tags: e.target.value.split(/[,，]/) })}
              />
            </label>
          </div>
        )}
        {(diskError || error) && (
          <p className="pc-notice" role="alert">
            {diskError || error}
          </p>
        )}
        {conflict !== undefined && (
          <aside className="kb-conflict">
            <h3>{conflict ? '处理版本冲突' : '原文档已删除'}</h3>
            {conflict && (
              <>
                <details open>
                  <summary>
                    主机版本 v{conflict.revision} · {conflict.actor}
                  </summary>
                  <p>
                    {[conflict.title, conflict.project, conflict.folder, ...conflict.tags]
                      .filter(Boolean)
                      .join(' / ')}
                  </p>
                  <pre>{conflict.body}</pre>
                </details>
                <p>在下方草稿中合并需要保留的内容，再保存为新版本。</p>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void save(false, false, conflict.revision)}
                >
                  基于 v{conflict.revision} 保存草稿
                </button>
              </>
            )}
            <button className="secondary-button" disabled={busy} onClick={() => void save(false, true)}>
              另存副本
            </button>
          </aside>
        )}
        <div className="kb-sheet" data-view={mode}>
          <div className="kb-source-pane" hidden={mode === 'preview'}>
            <CodeEditor
              language="markdown"
              label="Markdown 正文"
              value={draft.form.body}
              onReady={ready}
              onChange={(body) => patch({ body })}
              placeholder="开始写作…"
            />
          </div>
          {mode !== 'write' && (
            <div
              ref={preview}
              className="kb-prose kb-live-preview"
              aria-label="正文预览"
              onClick={(e) => {
                if ((e.target as Element).closest('a')) e.preventDefault();
              }}
              dangerouslySetInnerHTML={{ __html: rendered }}
            />
          )}
        </div>
        {draft.changed && (
          <button
            className="text-button kb-discard"
            onClick={async () => {
              if (
                !busy &&
                (await confirm({
                  title: '丢弃本机草稿？',
                  detail: '此设备上的未保存修改将被移除。',
                  confirm: '丢弃草稿',
                }))
              ) {
                clearDraft();
                leave(draft.documentId);
              }
            }}
          >
            丢弃草稿
          </button>
        )}
      </div>
      {active && picker && (
        <KnowledgeResourcePicker
          documentId={draft.documentId}
          close={() => setPicker(false)}
          insert={insert}
        />
      )}
    </section>
  );
}
