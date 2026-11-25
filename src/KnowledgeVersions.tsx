import { useEffect, useState } from 'react';
import { useDocumentLibrary, type KnowledgePage } from './knowledge-api';
import { Modal } from './project-components';
import Skeleton from './Skeleton';
import { renderArticle } from './knowledge-markdown';
export function Versions({
  page,
  close,
  restore,
  busy,
  editable,
  error,
}: {
  page: KnowledgePage;
  close: () => void;
  restore: (version: number) => void;
  busy: boolean;
  editable: boolean;
  error: string;
}) {
  const { request } = useDocumentLibrary();
  const [entries, setEntries] = useState<KnowledgePage[]>();
  const [failure, setFailure] = useState(''),
    [selected, setSelected] = useState(0);
  useEffect(() => {
    let live = true;
    void request<KnowledgePage[]>('history', { id: page.id }).then(
      (rows) => {
        if (live) setEntries(rows);
      },
      (err) => {
        if (live) setFailure(err.message);
      },
    );
    return () => {
      live = false;
    };
  }, [page.id, page.revision, request]);
  const item = entries?.find((entry) => entry.revision === selected) ?? entries?.[0];
  return (
    <Modal
      title="版本历史"
      description={page.title}
      closeLabel="关闭版本历史"
      close={close}
      busy={busy}
      wide
      footer={
        <footer>
          <button className="secondary-button" onClick={close}>
            关闭
          </button>
          {editable && item && (
            <button className="run-button" onClick={() => restore(item.revision)}>
              恢复为新版本
            </button>
          )}
        </footer>
      }
    >
      {(error || failure) && <p role="alert">{error || failure}</p>}
      {!entries && !failure && <Skeleton kind="list" label="正在读取历史版本" />}
      {entries && !item && <p>首次保存后还没有旧版本。</p>}
      {item && (
        <>
          <label className="pc-field">
            选择旧版本
            <select value={item.revision} onChange={(e) => setSelected(Number(e.target.value))}>
              {entries?.map((row) => (
                <option key={row.revision} value={row.revision}>
                  v{row.revision} · {new Date(row.updated).toLocaleString()} · {row.actor}
                </option>
              ))}
            </select>
          </label>
          <p>{[item.folder || '未归档', item.project, ...item.tags].filter(Boolean).join(' / ')}</p>
          <h3>{item.title}</h3>
          <div
            className="kb-prose"
            onClick={(e) => {
              if ((e.target as Element).closest('a')) e.preventDefault();
            }}
            dangerouslySetInnerHTML={{ __html: renderArticle(item.body) }}
          />
        </>
      )}
    </Modal>
  );
}
