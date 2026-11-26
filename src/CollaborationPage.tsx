import { Modal as WorkspaceDialog } from './project-components';
import { createPortal } from 'react-dom';
import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { QrCode, ArrowLeftRight, Braces, Network, ScanLine } from 'lucide-react';
import { workspaceModules } from './catalog';
import { useSharingStatus } from './Sharing';
import { copyText } from './motion-primitives';
import { useWorkspaceResource, workspaceHash } from './workspace-links';
import { type CollabModule, type PageProps } from './collab-api';
import { QuickTransfer } from './QuickTransfer';
import { TransferLinkSettings } from './TransferLinkSettings';
import { MockService } from './MockService';
import { WireGuardWorkspace } from './WireGuardWorkspace';
import { ScreenshotBoard } from './ScreenshotBoard';
import { CreateRelated } from './related-workspaces';
import './collaboration.css';

export function CollaborationPage({ module, active, edit, portalActions }: PageProps & {
  module: CollabModule;
  portalActions?: HTMLElement | null;
}) {
  const status = useSharingStatus(),
    resource = useWorkspaceResource(module);
  const [invite, setInvite] = useState(false),
    [copyStatus, setCopyStatus] = useState(''),
    [address, setAddress] = useState('');
  const addresses = status?.running && status.services[module]?.enabled ? status.addresses : [];
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
  const PageIcon = { transfer: ArrowLeftRight, mock: Braces, whiteboard: ScanLine, wireguard: Network }[module];
  const title = workspaceModules.find((item) => item.id === module)?.name;
  const inviteButton = (
    <button
      className="secondary-button"
      aria-expanded={invite}
      aria-controls={invite ? module + '-invite' : undefined}
      onClick={() => {
        setInvite(!invite);
        setCopyStatus('');
      }}
    >
      <QrCode size={16} />
      邀请设备
    </button>
  );
  return (
    <section className="collab-page" data-module={module}>
      {portalActions !== undefined ? <>
        <h1 className="sr-only">{title}</h1>
        {active && portalActions && createPortal(inviteButton, portalActions)}
      </> : <header className="collab-header workspace-banner">
        <div className="collab-identity">
          <span className="collab-emblem">
            <PageIcon size={25} />
          </span>
          <div>
            <h1>{title}</h1>
            {window.devkitCollab && (
              <span className="collab-host" data-online={!!origin && !localOnly}>
                {origin ? (localOnly ? '本机共享' : '局域网共享') : '本机工作区'}
                {origin && <code>{new URL(origin).host}</code>}
              </span>
            )}
          </div>
        </div>
        {module === 'transfer' && window.devkitCollab ? (
          <div className="collab-actions">
            {inviteButton}
            <TransferLinkSettings />
          </div>
        ) : inviteButton}
      </header>}
      {active && invite && (
        <WorkspaceDialog title="邀请设备" closeLabel="关闭邀请设备" close={() => setInvite(false)}><div className="collab-invite" id={module + '-invite'}>
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
                {module !== 'transfer' && <CreateRelated from={module} page="transfer" resource={href}>在快传中填写邀请链接</CreateRelated>}
              </div>
            </>
          ) : (
            <span>在桌面顶栏的“局域网共享”中开放此栏目，并选择局域网监听地址，即可邀请其他设备。</span>
          )}
        </div></WorkspaceDialog>
      )}
      {module === 'transfer' ? (
        <QuickTransfer origin={origin} active={active} edit={edit} directory={window.devkitCollab ? status?.directory : undefined} />
      ) : module === 'mock' ? (
        <MockService active={active} edit={edit} origin={origin} />
      ) : module === 'wireguard' ? (
        <WireGuardWorkspace active={active} edit={edit} resource={resource} />
      ) : (
        <ScreenshotBoard active={active} edit={edit} />
      )}
    </section>
  );
}
