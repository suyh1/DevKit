import { TextInput } from './TextControl';
import { useEffect, useRef, useState } from 'react';
import { Plus, Radar } from 'lucide-react';
import { lanRequest, type HostDraft } from './lan-api';
import { Modal, ModalCancel } from './project-components';

type Network = { name: string; address: string; suggestion: string };
type ScanResult = { scanned: number; devices: { address: string; name?: string; mac?: string; portOpen: boolean; response: string; elapsed?: number }[] };
const networkId = (network: Network) => JSON.stringify([network.name, network.address]);

export default function LanDiscovery({ close, onChoose }: { close: () => void; onChoose?: (draft: Partial<HostDraft>) => void }) {
  const [interfaces, setInterfaces] = useState<Network[]>([]), [selected, setSelected] = useState('');
  const [range, setRange] = useState(''), [port, setPort] = useState(22);
  const [error, setError] = useState(''), [result, setResult] = useState<ScanResult>(), [busy, setBusy] = useState(false);
  const activeScan = useRef('');
  useEffect(() => {
    let mounted = true;
    void lanRequest<Network[]>('scan-interfaces').then(networks => {
      if (!mounted) return;
      setInterfaces(networks);
      if (networks[0]) { setSelected(networkId(networks[0])); setRange(networks[0].suggestion); }
      else setError('未找到可用的 IPv4 网卡。');
    }).catch(error => { if (mounted) setError(error.message); });
    return () => { mounted = false; if (activeScan.current) void lanRequest('scan-cancel', { id: activeScan.current }).catch(() => {}); };
  }, []);
  async function scan() {
    const network = interfaces.find(item => networkId(item) === selected);
    if (!network || activeScan.current) return;
    const bytes = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    const id = `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20)}`;
    activeScan.current = id;
    setResult(undefined); setError(''); setBusy(true);
    try { setResult(await lanRequest<ScanResult>('scan-start', { id, name: network.name, address: network.address, range, port })); }
    catch (failure) { const message = (failure as Error).message; setError(/abort/i.test(message) ? '扫描已取消。' : message); }
    finally { activeScan.current = ''; setBusy(false); }
  }
  return <Modal title="发现局域网主机" icon={<Radar size={18} />} closeLabel="关闭主机扫描" close={close} busy={busy}>
    <form id="lan-scan-form" className="lan-scan-fields" onSubmit={event => { event.preventDefault(); void scan(); }}>
      <label className="lan-field"><span>网卡</span><select value={selected} disabled={busy || !interfaces.length} onChange={event => {
        const network = interfaces.find(item => networkId(item) === event.target.value)!;
        setSelected(event.target.value); setRange(network.suggestion); setResult(undefined);
      }}>{interfaces.map(item => <option key={networkId(item)} value={networkId(item)}>{item.name} · {item.address}</option>)}</select></label>
      <label className="lan-field"><span>IPv4 网段或起止地址</span><TextInput value={range} maxLength={45} required disabled={busy} onChange={event => { setRange(event.target.value); setResult(undefined); }} /></label>
      <label className="lan-field"><span>SSH 探测端口</span><input type="number" min={1} max={65535} required value={port || ''} disabled={busy} onChange={event => { setPort(Number(event.target.value)); setResult(undefined); }} /></label>
    </form>
    <p className="lan-note">每次最多扫描所选网卡直连网段内的 256 个 IPv4 地址。邻居缓存仅供识别设备。</p>
    {result && <><p className="lan-note" role="status">已扫描 {result.scanned} 个地址，发现 {result.devices.length} 台设备。</p>
      <ul className="lan-scan-results">{result.devices.map(device => <li key={device.address}>
        <div><strong>{device.name || device.address}</strong><small>{device.name ? `${device.address} · ` : ''}{device.mac || '未取得 MAC'}</small></div>
        <span>{device.portOpen ? `端口可达 · ${device.elapsed} ms` : device.response === 'refused' ? '端口拒绝连接' : '见于邻居缓存'}</span>
        {onChoose && <button className="secondary-button" onClick={() => onChoose({ address: device.address, name: device.name || '', port, mac: device.mac })}><Plus size={14} />添加</button>}
      </li>)}</ul></>}
    {error && <p className="pc-error" role="alert">{error}</p>}
    <footer>{busy ? <button className="secondary-button" onClick={() => void lanRequest('scan-cancel', { id: activeScan.current }).catch(error => setError(error.message))}>取消扫描</button> : <ModalCancel />}
      <button type="submit" form="lan-scan-form" className="run-button" disabled={busy || !selected}>{busy ? '扫描中…' : '扫描网段'}</button>
    </footer>
  </Modal>;
}
