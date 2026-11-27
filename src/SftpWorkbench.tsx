import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FolderOpen, Pause, Play, X } from 'lucide-react';
import SegmentedControl from './SegmentedControl';
import { Modal, ModalCancel } from './project-components';
import { TextInput } from './TextControl';
import SftpSitePane, { formatSize, type FileSelection } from './SftpSitePane';
import { BrowserSite, directoryPicker, serverSite, validName, type Side } from './sftp-sites';
import { SftpQueue, type Decision } from './sftp-queue';
import './sftp-workbench.css';

type Conflict = { name: string; resolve: (decision: Decision) => void };
const status = {
  held: '待启动',
  waiting: '排队中',
  running: '传输中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};
const groups = { queue: ['held', 'waiting', 'running'], failed: ['failed', 'cancelled'], done: ['done'] };
export default function SftpWorkbench({ session, portal }: { session: string; portal: boolean }) {
  const [, update] = useReducer((v) => v + 1, 0);
  const [browser, setBrowser] = useState(() => (portal ? new BrowserSite() : undefined));
  const [rootVersion, setRootVersion] = useState(0);
  const [revision, setRevision] = useState({ local: 0, remote: 0 });
  const [paths, setPaths] = useState({ local: '', remote: '' });
  const [tab, setTab] = useState<keyof typeof groups>('queue'),
    [page, setPage] = useState(0);
  const [conflict, setConflict] = useState<Conflict>(),
    [newName, setNewName] = useState(''),
    [applyAll, setApplyAll] = useState(false);
  const [error, setError] = useState('');
  const files = useRef<HTMLInputElement>(null),
    folders = useRef<HTMLInputElement>(null),
    drag = useRef<FileSelection | null>(null);
  const sites = useMemo(
    () => ({ local: serverSite(session, 'local'), remote: serverSite(session, 'remote') }),
    [session],
  );
  const queue = useMemo(
    () =>
      new SftpQueue(
        update,
        (side) => setRevision((current) => ({ ...current, [side]: current[side] + 1 })),
        (name, signal) =>
          new Promise((resolve, reject) => {
            function abort() {
              setConflict(undefined);
              reject(new Error('已取消'));
            }
            signal.throwIfAborted();
            signal.addEventListener('abort', abort, { once: true });
            setError('');
            setNewName(name);
            setApplyAll(false);
            setConflict({
              name,
              resolve: (decision) => {
                signal.removeEventListener('abort', abort);
                setConflict(undefined);
                setError('');
                resolve(decision);
              },
            });
          }),
      ),
    [],
  );
  useEffect(() => {
    queue.attach(session, sites);
    return () => queue.dispose();
  }, [queue, session, sites]);
  function enqueue(selection: FileSelection, hold: boolean, destination?: string) {
    const to = destination || paths[selection.side === 'local' ? 'remote' : 'local'];
    if (!to) return;
    setTab('queue');
    setPage(0);
    setError('');
    queue.add(selection.side, selection.entries, selection.from, to, hold, browser);
  }
  async function choose() {
    try {
      const picker = directoryPicker();
      if (!picker) {
        folders.current?.click();
        return;
      }
      const root = await picker.call(window, { mode: 'readwrite' });
      setBrowser(new BrowserSite(root));
      setRootVersion((v) => v + 1);
      setPaths((current) => ({ ...current, local: '' }));
      setError('');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    }
  }
  function addInput(input: HTMLInputElement) {
    if (!input.files?.length || !browser) return;
    try {
      browser.add(Array.from(input.files));
      setRevision((current) => ({ ...current, local: current.local + 1 }));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
    input.value = '';
  }
  const matching = queue.jobs.filter((job) => groups[tab].includes(job.state));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matching.length / 50) - 1));
  const pending = queue.jobs.filter((job) => groups.queue.includes(job.state));
  const localTools = portal && (
    <>
      {!browser?.root && (
        <>
          <input hidden type="file" multiple ref={files} onChange={(e) => addInput(e.target)} />
          <input
            hidden
            type="file"
            multiple
            ref={(el) => {
              folders.current = el;
              el?.setAttribute('webkitdirectory', '');
            }}
            onChange={(e) => addInput(e.target)}
          />
          <button className="text-button" onClick={() => files.current?.click()}>
            选择文件
          </button>
          <button className="text-button" onClick={() => folders.current?.click()}>
            选择文件夹
          </button>
        </>
      )}
      {directoryPicker() && (
        <button className="text-button" onClick={() => void choose()}>
          <FolderOpen size={14} /> 选择可写目录
        </button>
      )}
    </>
  );
  return (
    <section className="sftp-workbench" aria-label="SFTP 文件传输">
      {portal && !browser?.root && (
        <p className="lan-note">
          左栏显示已选择的本机文件。下载由浏览器保存，文件夹保存为 ZIP。
          {directoryPicker() ? '选择可写目录可直接写入本机。' : ''}
        </p>
      )}
      <div className="sftp-sites" inert={!session}>
        {(['local', 'remote'] as Side[]).map((side) => (
          <SftpSitePane
            key={side === 'local' ? 'local-' + rootVersion : 'remote'}
            side={side}
            site={side === 'local' && browser ? browser : sites[side]}
            label={side === 'local' ? '本机' : '目标'}
            toolbar={side === 'local' ? localTools : undefined}
            writable={side === 'remote' || !portal || !!browser?.root}
            native={!portal && side === 'local'}
            connected={!!session}
            revision={revision[side]}
            drag={drag}
            ready={!!paths[side === 'local' ? 'remote' : 'local']}
            onDirectory={(path) =>
              setPaths((current) => (current[side] === path ? current : { ...current, [side]: path }))
            }
            enqueue={enqueue}
          />
        ))}
      </div>
      <section className="sftp-queue" aria-label="传输队列">
        <header>
          <h3>传输队列</h3>
          <span>{formatSize(pending.reduce((n, j) => n + Math.max(0, j.total - j.bytes), 0))} 待处理</span>
          <button className="text-button" disabled={!session || !pending.length} onClick={() => queue.process()}>
            <Play size={13} /> 开始队列
          </button>
          <button className="text-button" disabled={!pending.length || queue.paused} onClick={() => queue.pause()}>
            <Pause size={13} /> {queue.paused ? '已暂停' : '暂停队列'}
          </button>
        </header>
        <div className="sftp-queue-nav">
          <SegmentedControl
            label="传输记录"
            value={tab}
            options={(['queue', 'failed', 'done'] as const).map((value, i) => ({
              value,
              label:
                ['队列', '失败 / 取消', '成功'][i] +
                ' (' +
                queue.jobs.filter((j) => groups[value].includes(j.state)).length +
                ')',
            }))}
            onChange={(value) => {
              setTab(value);
              setPage(0);
            }}
          />
          {tab !== 'queue' && matching.length > 0 && (
            <button
              className="text-button"
              onClick={() => queue.clear(tab === 'done' ? ['done'] : ['failed', 'cancelled'])}
            >
              清除此栏记录
            </button>
          )}
        </div>
        {matching.length ? (
          <ul className="sftp-jobs">
            {matching.slice(currentPage * 50, (currentPage + 1) * 50).map((job) => {
              const busy = job.state === 'running',
                percent = job.total ? Math.min(100, Math.floor((job.bytes / job.total) * 100)) : 0;
              return (
                <li key={job.id}>
                  <div>
                    <strong>
                      {job.side === 'local' ? '上传 ↑' : '下载 ↓'} {job.source.name}
                    </strong>
                    <span>{status[job.state]}</span>
                    {groups.queue.includes(job.state) ? (
                      <button className="text-button" onClick={() => queue.cancel(job)}>
                        <X size={13} /> 取消
                      </button>
                    ) : (
                      job.state !== 'done' && (
                        <button
                          className="text-button"
                          disabled={!session}
                          onClick={() => {
                            queue.retry(job);
                            setTab('queue');
                          }}
                        >
                          重试
                        </button>
                      )
                    )}
                  </div>
                  <small title={job.source.path + ' → ' + job.to}>
                    {job.source.path} → {job.to}
                  </small>
                  {busy && (
                    <>
                      <progress max={100} value={percent} aria-label={job.source.name + '传输进度'} />
                      <small>
                        {percent}% · {formatSize(job.bytes)} / {formatSize(job.total)} · {formatSize(job.speed)}/s
                        {job.speed > 0 &&
                          ' · 剩余约 ' + Math.ceil(Math.max(0, job.total - job.bytes) / job.speed) + ' 秒'}{' '}
                        · {job.count}/{job.files} 个文件 · {job.current}
                        {job.source.kind === 'directory' &&
                          job.fileSize > 0 &&
                          ' · 当前文件 ' + formatSize(job.fileBytes) + ' / ' + formatSize(job.fileSize)}
                      </small>
                    </>
                  )}
                  {job.state === 'done' && (
                    <small>
                      已处理 {job.count} 个文件{job.skipped > 0 && ' · 跳过 ' + job.skipped + ' 项'}
                    </small>
                  )}
                  {job.error && (
                    <small className="pc-error">
                      {job.current} · {job.error}
                    </small>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="lan-note">{tab === 'queue' ? '暂无待传输项目' : '暂无记录'}</p>
        )}
        {matching.length > 50 && (
          <footer>
            <button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
              上一页
            </button>{' '}
            {currentPage + 1} / {Math.ceil(matching.length / 50)}{' '}
            <button disabled={(currentPage + 1) * 50 >= matching.length} onClick={() => setPage(currentPage + 1)}>
              下一页
            </button>
          </footer>
        )}
      </section>
      {error && !conflict && (
        <p className="pc-error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <Modal
          title="目标文件已存在"
          closeLabel="取消传输"
          close={() => {
            const job = queue.jobs.find((j) => j.state === 'running');
            if (job) queue.cancel(job);
            setError('');
          }}
        >
          <p>{conflict.name}</p>
          {error && (
            <p className="pc-error" role="alert">
              {error}
            </p>
          )}
          <label className="lan-field">
            另存名称
            <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <label>
            <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} />{' '}
            跳过或覆盖应用到本任务后续冲突
          </label>
          <footer>
            <ModalCancel />
            <button onClick={() => conflict.resolve({ action: 'skip', all: applyAll })}>跳过</button>
            <button onClick={() => conflict.resolve({ action: 'overwrite', all: applyAll })}>覆盖</button>
            <button
              disabled={!newName || newName === conflict.name}
              onClick={() => {
                try {
                  validName(newName);
                  conflict.resolve({ action: 'rename', name: newName });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              改名传输
            </button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
