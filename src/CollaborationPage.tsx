import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { QrCode, ArrowLeftRight, Braces, ScanLine } from 'lucide-react';
import { workspaceModules } from './catalog';
import { SharingButton, useSharingStatus } from './Sharing';
import { copyText } from './motion-primitives';
import { useWorkspaceResource, workspaceHash } from './workspace-links';
import { type CollabModule, type PageProps } from './collab-api';
import { QuickTransfer } from './QuickTransfer';
import { MockService } from './MockService';
import { ScreenshotBoard } from './ScreenshotBoard';
import './collaboration.css';

export function CollaborationPage({ module, active, edit }: PageProps & { module: CollabModule }) {
  const status = useSharingStatus(),
    resource = useWorkspaceResource(module);
  const [invite, setInvite] = useState(false),
    [copyStatus, setCopyStatus] = useState(''),
    [address, setAddress] = useState('');
  const addresses = status?.running && status.services[module].enabled ? status.addresses : [];
  const origin = window.devkitCollab
    ? addresses.find((item) => item === address) ||
      addresses.find((item) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(new URL(item).hostname)) ||
      addresses.find((item) => !['127.0.0.1', 'localhost'].includes(new URL(item).hostname)) ||
      addresses[0]
    : location.origin;
  const localOnly = origin && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname);
  const target = resource && /^[a-f0-9-]{36}$/.test(resource) ? resource : undefined;
  const href = origin && !localOnly ? new URL('/' + workspaceHash(module, target), origin).href : '';
  const qr = useMemo(() => {
    if (!invite || !href) return '';
    const code = qrcode(0, 'M');
    code.addData(href);
    code.make();
    return code.createDataURL(4);
  }, [href, invite]);
  const PageIcon = { transfer: ArrowLeftRight, mock: Braces, whiteboard: ScanLine }[module];
  return (
    <section className="collab-page" data-module={module}>
      <header className="collab-header">
        <div className="collab-identity">
          <span className="collab-emblem">
            <PageIcon size={25} />
          </span>
          <div>
            <h1>{workspaceModules.find((item) => item.id === module)?.name}</h1>
            {window.devkitCollab && (
              <span className="collab-host" data-online={!!origin && !localOnly}>
                {origin ? (localOnly ? '本机共享' : '局域网共享') : '本机工作区'}
                {origin && <code>{new URL(origin).host}</code>}
              </span>
            )}
          </div>
        </div>
        <button
          className="secondary-button"
          aria-expanded={invite}
          onClick={() => {
            setInvite(!invite);
            setCopyStatus('');
          }}
        >
          <QrCode size={16} />
          邀请设备
        </button>
      </header>
      {invite && (
        <div className="collab-invite">
          {addresses.length > 1 && (
            <label>
              共享主机地址
              <select
                value={origin}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setCopyStatus('');
                }}
              >
                {addresses.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          )}
          {href ? (
            <>
              <img src={qr} alt="共享页面二维码" />
              <div>
                <strong>同一局域网内扫码打开</strong>
                <p>{href}</p>
                <button
                  onClick={() =>
                    void copyText(href).then(
                      () => setCopyStatus('已复制'),
                      () => setCopyStatus('请手动复制上方链接'),
                    )
                  }
                >
                  {copyStatus || '复制邀请链接'}
                </button>
              </div>
            </>
          ) : (
            <>
              <span>在主机的局域网共享中开放此栏目，并选择局域网监听地址，即可邀请其他设备。</span>
              <SharingButton global />
            </>
          )}
        </div>
      )}
      {module === 'transfer' ? (
        <QuickTransfer active={active} edit={edit} directory={window.devkitCollab ? status?.directory : undefined} />
      ) : module === 'mock' ? (
        <MockService active={active} edit={edit} origin={origin} />
      ) : (
        <ScreenshotBoard active={active} edit={edit} />
      )}
    </section>
  );
}
