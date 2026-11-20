import { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Download,
  Inbox,
  Send,
  File,
  Link2,
  AlignLeft,
  LockKeyhole,
  Copy,
  Trash2,
  X,
  Paperclip,
} from 'lucide-react';
import { collab, useCollabList, useOperation, type PageProps } from './collab-api';
import { copyText } from './motion-primitives';
import { useConfirmation } from './Confirmation';
import { RelatedLink, useRelatedCreation } from './related-workspaces';
import { parseWorkspaceLink } from './workspace-links';
import { DirectSender, receiveDirect } from './direct-transfer';

type Entry = {
  id: string;
  kind: 'file' | 'text' | 'link';
  name?: string;
  text?: string;
  sender: string;
  locked: boolean;
  direct?: boolean;
  size: number;
  expires: number;
};
function sizeOf(bytes: number) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let unit = 0;
  while (bytes >= 1024 && unit < units.length - 1) {
    bytes /= 1024;
    unit++;
  }
  return bytes.toFixed(unit ? 1 : 0) + ' ' + units[unit];
}
function base64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('文件读取失败。'));
    reader.readAsDataURL(blob);
  });
}
function sharedDestination(text: string | undefined, origin: string | undefined) {
  if (!text || !origin) return;
  try {
    const url = new URL(text);
    if (url.origin === new URL(origin).origin && url.pathname === '/' && !url.search && !url.username && !url.password) return parseWorkspaceLink(url.hash);
  } catch { /* Other links can still be copied. */ }
}
export function QuickTransfer({ active, edit, directory, origin, quickLink = false }: PageProps & { directory?: string; origin?: string; quickLink?: boolean }) {
  const feed = useCollabList<Entry>('transfer', active);
  const op = useOperation(),
    confirm = useConfirmation(),
    picker = useRef<HTMLInputElement>(null),
    cancelled = useRef(false);
  const [pane, setPane] = useState<'send' | 'receive'>('receive');
  const [text, setText] = useState(''),
    [hours, setHours] = useState(24),
    [filter, setFilter] = useState('all'),
    [progress, setProgress] = useState('');
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );
  const [password, setPassword] = useState(''),
    [pickupId, setPickupId] = useState(''),
    [pickup, setPickup] = useState('');
  const [revealed, setRevealed] = useState<{ id: string; text: string }>();
  const [files, setFiles] = useState<File[]>([]);
  const [direct, setDirect] = useState(true);
  const stagedInvite = useRef('');
  const finishInvite = useRelatedCreation('transfer', active && edit && !quickLink && !op.busy, (_from, invite) => {
    if (!invite) return;
    setPane('send');
    if (files.length || text.trim()) {
      void op.run(async () => '快传已有待发送的内容。处理完成后可从邀请入口再次加入链接。');
      return;
    }
    stagedInvite.current = invite;
    setDirect(false);
    setText(invite);
  });
  const [sender] = useState(() => new DirectSender());
  const [ready, setReady] = useState<{ id: string; ticket: string }>();
  const [receiving, setReceiving] = useState('');
  const receiver = useRef<AbortController | null>(null);
  useEffect(() => {
    const close = () => {
      sender.close();
      receiver.current?.abort();
    };
    window.addEventListener('pagehide', close);
    return () => {
      window.removeEventListener('pagehide', close);
      close();
    };
  }, [sender]);
  useEffect(() => {
    if (!active) {
      setReady(undefined);
      setRevealed(undefined);
      setPickupId('');
      setPickup('');
    }
  }, [active]);
  function choose(selected: File[]) {
    if (!edit || op.busy) return;
    setFiles((current) => [...current, ...selected]);
  }
  function send() {
    if (!edit || (!files.length && !text.trim())) return;
    void op.run(async () => {
      cancelled.current = false;
      let sent = 0;
      try {
        for (const file of files) {
          if (cancelled.current) break;
          if (direct) {
            if (typeof RTCPeerConnection === 'undefined') throw new Error('当前浏览器不支持 WebRTC 直传。');
            const { id } = await collab<{ id: string }>('transfer', 'publish', {
              name: file.name,
              size: file.size,
              hours,
              password,
            });
            if (cancelled.current) {
              await collab('transfer', 'remove', { id });
              break;
            }
            sender.add(id, file);
            setFiles((current) => current.slice(1));
            sent++;
            continue;
          }
          const { id } = await collab<{ id: string }>('transfer', 'begin', {
            name: file.name,
            size: file.size,
            hours,
            password,
          });
          try {
            for (let offset = 0; offset < file.size; offset += 1048576) {
              if (cancelled.current) break;
              setProgress(file.name + ' · ' + Math.floor((offset / file.size) * 100) + '%');
              const data = await base64(file.slice(offset, offset + 1048576));
              await collab('transfer', 'part', { id, offset, data });
            }
            if (cancelled.current) {
              await collab('transfer', 'cancel', { id });
              break;
            }
            await collab('transfer', 'finish', { id });
            sent++;
            setFiles((current) => current.slice(1));
          } catch (error) {
            await collab('transfer', 'cancel', { id }).catch(() => {});
            throw error;
          }
        }
        if (!direct && !cancelled.current && text.trim()) {
          await collab('transfer', 'send', { text, hours, password });
          setText('');
          sent++;
        }
        if (!cancelled.current) {
          setPassword('');
          setPane('receive');
          if (stagedInvite.current && text === stagedInvite.current && !files.length) finishInvite();
          stagedInvite.current = '';
        }
        return direct
          ? '已发布 ' + sent + ' 个直传文件，请保持此页面在线。'
          : (cancelled.current ? '已取消后续发送，' : '') + '已发送 ' + sent + ' 项';
      } finally {
        setProgress('');
        await feed.refresh();
      }
    });
  }
  async function download(item: Entry, ticket?: string) {
    if (window.devkitCollab) return collab<string>('transfer', 'save-file', { id: item.id, ticket });
    const url = new URL('api/transfer/download/' + item.id, document.baseURI);
    if (ticket) url.searchParams.set('ticket', ticket);
    const link = document.createElement('a');
    link.href = url.href;
    link.download = item.name!;
    link.click();
    return '已请求下载 ' + item.name + '，可在浏览器下载列表查看进度';
  }
  const storedBytes = feed.value?.reduce(
    (sum, item) => sum + (item.kind === 'file' && !item.direct ? item.size : 0),
    0,
  );
  const entries = (feed.value || []).filter((row) => filter === 'all' || filter === row.kind);
  return (
    <div className="collab-transfer" data-pane={edit ? pane : 'receive'}>
      {edit && (
        <nav className="transfer-switch" aria-label="收发视图">
          <button aria-pressed={pane === 'receive'} onClick={() => setPane('receive')}>
            <Inbox />
            收件箱
          </button>
          <button aria-pressed={pane === 'send'} onClick={() => setPane('send')}>
            <Send />
            发送内容
          </button>
        </nav>
      )}
      {edit && (
        <section
          className="collab-compose"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            choose(Array.from(e.dataTransfer.files));
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              choose(files);
            }
          }}
        >
          <h2 className="section-title">
            <Send />
            发送内容
          </h2>
          <label>
            发送方式
            <select
              aria-label="发送方式"
              disabled={op.busy}
              value={direct ? 'direct' : 'stored'}
              onChange={(e) => setDirect(e.target.value === 'direct')}
            >
              <option value="direct">在线直传</option>
              <option value="stored">主机暂存</option>
            </select>
            {direct && <small>文件从你的设备直接发给取件人。请保持页面在线，手机保持亮屏。</small>}
          </label>
          <button className="collab-drop" disabled={op.busy} onClick={() => picker.current?.click()}>
            <span className="transfer-upload-icon">
              <Upload size={25} />
            </span>
            <strong>选择或拖入文件</strong>
            <small>可多选文件，也可粘贴截图</small>
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              choose(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
          {!!files.length && (
            <div className="collab-pending">
              {files.map((file, i) => (
                <div key={i}>
                  <span>
                    <Paperclip size={15} /> {file.name} · {sizeOf(file.size)}
                  </span>
                  <button
                    disabled={op.busy}
                    aria-label={'取消选择 ' + file.name}
                    onClick={() => setFiles((current) => current.filter((_, index) => index !== i))}
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {!direct && (
            <label className="transfer-note">
              文字或链接
              <textarea
                disabled={op.busy}
                aria-label="待发送内容"
                maxLength={64000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="粘贴文字或网址，可随文件一起发送"
              />
            </label>
          )}
          <div className="transfer-options">
            <label>
              <span>
                <LockKeyhole size={14} />
                取件密码 <small>{direct ? '必填' : '可选'}</small>
              </span>
              <input
                disabled={op.busy}
                type="password"
                maxLength={128}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={direct ? '为直传设置密码' : '留空可直接取件'}
              />
            </label>
            <label>
              有效期
              <select disabled={op.busy} value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                <option value={1}>1 小时</option>
                <option value={24}>24 小时</option>
                <option value={168}>7 天</option>
              </select>
            </label>
          </div>
          <div className="transfer-submit">
            <button
              className="primary-button"
              disabled={op.busy || (direct ? !password.trim() || !files.length : !text.trim() && !files.length)}
              onClick={send}
            >
              <Send size={16} />
              {direct
                ? '发布直传文件（' + files.length + '）'
                : files.length
                  ? '发送所选内容（' + (files.length + Number(!!text.trim())) + '）'
                  : '发送文字或链接'}
            </button>
          </div>
          {progress && (
            <p role="status">
              {progress}{' '}
              <button
                onClick={() => {
                  cancelled.current = true;
                }}
              >
                取消上传
              </button>
            </p>
          )}
        </section>
      )}
      <section className="collab-inbox">
        <div className="collab-bar">
          <h2 className="section-title">
            <Inbox />
            共享收件箱 <span className="collab-count">{feed.value?.length ?? 0}</span>
          </h2>
          <select aria-label="筛选收件箱" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">全部类型</option>
            <option value="file">文件</option>
            <option value="text">文字</option>
            <option value="link">链接</option>
          </select>
        </div>
        <details className="transfer-storage">
          <summary>主机存储{storedBytes !== undefined && ' · 暂存文件 ' + sizeOf(storedBytes)}</summary>
          <p>主机暂存的文件在移除或到期时释放空间。在线直传的文件保留在发送设备，由收件人直接下载。</p>
          <small>
            存放位置{' '}
            <code>
              {directory ? directory + (directory.includes('\\') ? '\\' : '/') : '主机数据目录/'}collaboration
            </code>
          </small>
        </details>
        {(op.message || feed.error) && <p role="status">{op.message || feed.error}</p>}
        {receiving && (
          <p role="status">
            {receiving} <button onClick={() => receiver.current?.abort()}>取消接收</button>
          </p>
        )}
        {entries.map(item => {
          const visibleText = item.locked ? (revealed?.id === item.id ? revealed.text : undefined) : item.text;
          const destination = !quickLink && item.kind === 'link' ? sharedDestination(visibleText, origin) : undefined;
          return <article className="collab-entry" key={item.id}>
            <div className="entry-glyph" aria-hidden="true">
              {item.kind === 'file' ? <File /> : item.kind === 'link' ? <Link2 /> : <AlignLeft />}
            </div>
            <div className="entry-content">
              {item.kind === 'file' ? (
                <strong>{item.name}</strong>
              ) : (
                <pre>
                  {item.locked
                    ? revealed?.id === item.id
                      ? visibleText
                      : '需密码领取的' + (item.kind === 'link' ? '链接' : '文字')
                    : item.text}
                </pre>
              )}
              <div className="entry-meta">
                {item.direct && <strong>在线直传</strong>}
                <span>{item.sender}</span>
                <span>{sizeOf(item.size)}</span>
                <time dateTime={new Date(item.expires).toISOString()} title={new Date(item.expires).toLocaleString()}>
                  {new Date(item.expires).toLocaleString('zh-CN', {
                    month: 'numeric',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  到期
                </time>
              </div>
            </div>
            <div className="collab-actions">
              {item.direct && ready?.id === item.id ? (
                <button
                  disabled={op.busy}
                  onClick={() =>
                    void op.run(async () => {
                      const controller = new AbortController();
                      receiver.current = controller;
                      try {
                        return await receiveDirect(item, ready.ticket, controller.signal, setReceiving);
                      } finally {
                        receiver.current = null;
                        setReady(undefined);
                        setReceiving('');
                      }
                    })
                  }
                >
                  <Download size={15} />
                  保存直传文件
                </button>
              ) : item.locked && revealed?.id !== item.id ? (
                <button
                  disabled={op.busy}
                  onClick={() => {
                    setPickupId(item.id);
                    setPickup('');
                  }}
                >
                  <LockKeyhole size={15} />
                  凭密码取件
                </button>
              ) : item.kind === 'file' ? (
                <button disabled={op.busy} onClick={() => void op.run(() => download(item))}>
                  <Download size={14} />
                  下载
                </button>
              ) : (
                <button
                  disabled={op.busy}
                  onClick={() =>
                    void op.run(async () => {
                      await copyText(item.locked ? revealed!.text : item.text!);
                      return '已复制';
                    })
                  }
                >
                  <Copy size={15} />
                  复制{item.kind === 'link' ? '链接' : '文字'}
                </button>
              )}
              {edit && (!quickLink || sender.owns(item.id)) && (
                <button
                  className="icon-action"
                  title={item.direct ? '撤回直传' : '移除'}
                  aria-label={item.direct ? '撤回直传文件' : '从收件箱移除'}
                  disabled={op.busy}
                  onClick={() =>
                    void op.run(async () => {
                      if (
                        !(await confirm({
                          title: '从共享收件箱移除？',
                          detail: '所有设备都将失去此项的访问入口。',
                          confirm: '移除',
                        }))
                      )
                        return;
                      await collab('transfer', 'remove', { id: item.id });
                      if (item.direct) sender.remove(item.id);
                      await feed.refresh();
                    })
                  }
                >
                  <Trash2 size={16} />
                  {item.direct && '撤回'}
                </button>
              )}
            </div>
            {pickupId === item.id && (
              <form
                className="collab-bar"
                onSubmit={(e) => {
                  e.preventDefault();
                  void op.run(async () => {
                    const result = await collab<{ ticket?: string; text?: string }>('transfer', 'unlock', {
                      id: item.id,
                      password: pickup,
                    });
                    setPickup('');
                    setPickupId('');
                    if (item.direct && result.ticket) {
                      setReady({ id: item.id, ticket: result.ticket });
                      return '密码正确，请选择保存直传文件。';
                    }
                    if (item.kind === 'file') return download(item, result.ticket);
                    setRevealed({ id: item.id, text: result.text! });
                  });
                }}
              >
                <input
                  autoFocus
                  required
                  type="password"
                  autoComplete="off"
                  aria-label="输入取件密码"
                  placeholder="输入取件密码"
                  maxLength={128}
                  value={pickup}
                  onChange={(e) => setPickup(e.target.value)}
                />
                <button disabled={op.busy}>确认取件</button>
                <button
                  type="button"
                  onClick={() => {
                    setPickupId('');
                    setPickup('');
                  }}
                >
                  取消
                </button>
              </form>
            )}
            {destination && <RelatedLink {...destination}>打开共享资源</RelatedLink>}
            {revealed?.id === item.id && <button onClick={() => setRevealed(undefined)}>隐藏内容</button>}
          </article>;
        })}
        {!entries.length && (
          <div className="collab-empty">
            <Inbox size={32} />
            <strong>{!feed.value ? '正在读取收件箱…' : filter === 'all' ? '收件箱是空的' : '没有这类内容'}</strong>
            {feed.value && filter === 'all' && <p>已发送的文件、文字和链接会出现在这里。</p>}
          </div>
        )}
      </section>
    </div>
  );
}
