import FloatingDetails from './FloatingDetails';
import { TextInput } from './TextControl';
import { useEffect, useState } from 'react';
import { collab, useOperation } from './collab-api';
import { copyText } from './motion-primitives';

type Link = { port: number; short: boolean; addresses: string[]; error?: string };

export function TransferLinkSettings() {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<Link[]>();
  const [ports, setPorts] = useState('');
  const [shorten, setShorten] = useState<number[]>([]);
  const [loadError, setLoadError] = useState('');
  const op = useOperation();
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadError('');
    setShorten([]);
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

  function savePorts() {
    void op.run(async () => {
      const values = ports.trim() ? ports.trim().split(/[，,、\s]+/u) : [];
      if (values.some((value) => !/^\d+$/.test(value)))
        throw new Error('请输入端口数字，多个端口用逗号分隔。');
      const selected = values.map(Number);
      const result = await collab<Link[]>('transfer', 'links-save', {
        ports: selected, shorten: shorten.filter(port => selected.includes(port)),
      });
      setLinks(result);
      setShorten([]);
      setPorts(result.map((link) => link.port).join(', '));
      return result.length ? '快速链接已生效' : '已关闭全部快速链接';
    });
  }

  return (
    <FloatingDetails className="transfer-link-settings" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>快速链接设置</summary>
      {open && (
        <div>
          <p>新端口只需告诉对方局域网 IP 和端口，例如 192.168.1.20:8780。能连到该端口的人可直接收发同一收件箱的内容，无需共享口令或访客账号。已设取件密码的内容仍需凭密码领取。</p>
          <div className="transfer-port-fields">
            <label>
              监听端口
              <TextInput
                value={ports}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); savePorts(); } }}
                disabled={!links || op.busy}
                onChange={(event) => setPorts(event.target.value)}
                placeholder="例如 8780, 8781"
              />
              <small>多个端口用逗号分隔。移除端口并保存即可关闭对应链接。</small>
            </label>
            {links?.filter(link => !link.short).map(link => (
              <label key={link.port}>
                <input className="form-check" type="checkbox" disabled={op.busy} checked={shorten.includes(link.port)}
                  onChange={event => {
                    const checked = event.target.checked;
                    setShorten(current => checked ? [...current, link.port] : current.filter(port => port !== link.port));
                  }} />
                为旧端口 {link.port} 开启短地址（原长链接仍可用）
              </label>
            ))}
            <button type="button" className="secondary-button" onClick={savePorts} disabled={!links || op.busy}>
              保存端口
            </button>
          </div>
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
                    type="button"
                    className="text-button" disabled={op.busy}
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
    </FloatingDetails>
  );
}
