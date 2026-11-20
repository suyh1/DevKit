import { useEffect, useState } from 'react';
import { collab, useOperation } from './collab-api';
import { copyText } from './motion-primitives';

type Link = { port: number; addresses: string[]; error?: string };

export function TransferLinkSettings() {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<Link[]>();
  const [ports, setPorts] = useState('');
  const [loadError, setLoadError] = useState('');
  const op = useOperation();
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadError('');
    setLinks(undefined);
    collab<Link[]>('transfer', 'links-get').then(
      (result) => {
        if (!active) return;
        setLinks(result);
        setPorts(result.map((link) => link.port).join(', '));
      },
      (error) => {
        if (active) setLoadError(error.message);
      },
    );
    return () => {
      active = false;
    };
  }, [open]);

  return (
    <details className="transfer-link-settings" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>快速链接设置</summary>
      {open && (
        <div>
          <p>持有链接的人可直接进入这个收件箱收发内容。已设取件密码的内容仍需凭密码领取。</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void op.run(async () => {
                const values = ports.trim() ? ports.trim().split(/[，,、\s]+/u) : [];
                if (values.some((value) => !/^\d+$/.test(value)))
                  throw new Error('请输入端口数字，多个端口用逗号分隔。');
                const result = await collab<Link[]>('transfer', 'links-save', values.map(Number));
                setLinks(result);
                setPorts(result.map((link) => link.port).join(', '));
                return result.length ? '快速链接已生效' : '已关闭全部快速链接';
              });
            }}
          >
            <label>
              监听端口
              <input
                value={ports}
                disabled={!links || op.busy}
                onChange={(event) => setPorts(event.target.value)}
                placeholder="例如 8780, 8781"
              />
              <small>多个端口用逗号分隔。移除端口并保存即可关闭对应链接。</small>
            </label>
            <button type="submit" disabled={!links || op.busy}>
              保存端口
            </button>
          </form>
          {links?.map((link) => (
            <div key={link.port} className="transfer-port-links">
              {link.error && (
                <p role="status">
                  {link.port} · {link.error}
                </p>
              )}
              {link.addresses.map((address) => (
                <div key={address}>
                  <code>{address}</code>
                  <button
                    disabled={op.busy}
                    onClick={() =>
                      void op.run(async () => {
                        await copyText(address);
                        return '已复制快速链接';
                      })
                    }
                  >
                    复制链接
                  </button>
                </div>
              ))}
            </div>
          ))}
          {(loadError || op.message) && <p role="status">{loadError || op.message}</p>}
        </div>
      )}
    </details>
  );
}
