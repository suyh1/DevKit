import { useEffect, useId, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { lanRequest, type HostDraft } from './lan-api';
import { TextInput } from './TextControl';

type Props = { draft: HostDraft; patch: (value: Partial<HostDraft>) => void };
export function SerialAddress({ draft, patch }: Props) {
  const [devices, setDevices] = useState<{ path: string; manufacturer?: string }[]>();
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0), list = useId();
  useEffect(() => {
    let active = true;
    setError(''); setDevices(undefined);
    void lanRequest<NonNullable<typeof devices>>('serial-list').then(rows => { if (active) setDevices(rows); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [refresh]);
  return <div className="lan-field lan-address"><label htmlFor={list + '-input'}>串口设备</label>
    <div className="lan-device-picker"><TextInput id={list + '-input'} data-modal-focus list={list} required value={draft.address} placeholder="COM3 或 /dev/ttyUSB0" onChange={e => patch({ address: e.target.value })} />
      <button type="button" className="icon-button" aria-label="刷新串口设备" onClick={() => setRefresh(i => i + 1)}><RefreshCw size={15} /></button></div>
    <datalist id={list}>{devices?.map(device => <option key={device.path} value={device.path}>{device.manufacturer}</option>)}</datalist>
    {error ? <small role="alert">{error}</small> : <small role="status">{devices === undefined ? '正在读取串口设备…' :
      devices.length ? '已发现 ' + devices.length + ' 个串口' : '未检测到串口。可先保存档案，接入设备后刷新。'}</small>}
  </div>;
}
export default function SessionProtocolFields({ draft, patch }: Props) {
  const serial = draft.mode === 'serial';
  if (!serial && draft.mode !== 'telnet' && draft.mode !== 'ftp') return null;
  return <fieldset className="lan-host-section"><legend>{serial ? '串口参数' : draft.mode === 'ftp' ? 'FTP 登录与传输' : '终端设置'}</legend><div className="lan-host-fields">
    {draft.mode === 'ftp' ? <>
      <label className="lan-field">传输加密<select value={draft.ftpSecurity || 'plain'} onChange={e => {
        const ftpSecurity = e.target.value as HostDraft['ftpSecurity'];
        patch({ ftpSecurity, port: draft.port === 21 || draft.port === 990 ? (ftpSecurity === 'implicit' ? 990 : 21) : draft.port, password: '' });
      }}><option value="plain">FTP（明文）</option><option value="explicit">显式 TLS（FTPS）</option><option value="implicit">隐式 TLS（FTPS）</option></select></label>
      <label className="lan-field">用户名<TextInput value={draft.user || ''} placeholder="anonymous" onChange={e => patch({ user: e.target.value })} maxLength={120} /></label>
      <label className="lan-field">起始目录<TextInput value={draft.startDirectory || ''} placeholder="登录目录" onChange={e => patch({ startDirectory: e.target.value })} maxLength={2048} /></label>
    </> : <>
      {serial ? <>
        <label className="lan-field">波特率<input type="number" required min="1" max="4000000" value={draft.baudRate ?? 115200} onChange={e => patch({ baudRate: Number(e.target.value) })} /></label>
        <label className="lan-field">数据位<select value={draft.dataBits ?? 8} onChange={e => patch({ dataBits: Number(e.target.value) })}>{[5,6,7,8].map(n => <option key={n}>{n}</option>)}</select></label>
        <label className="lan-field">停止位<select value={draft.stopBits ?? 1} onChange={e => patch({ stopBits: Number(e.target.value) })}><option>1</option><option>2</option></select></label>
        <label className="lan-field">校验位<select value={draft.parity ?? 'none'} onChange={e => patch({ parity: e.target.value })}><option value="none">无</option><option value="even">偶校验</option><option value="odd">奇校验</option></select></label>
        <label className="lan-field">流控<select value={draft.flowControl ?? 'none'} onChange={e => patch({ flowControl: e.target.value })}><option value="none">无</option><option value="hardware">RTS/CTS</option><option value="software">XON/XOFF</option></select></label>
      </> : <label className="lan-field">终端类型<select value={draft.terminalType || 'xterm-256color'} onChange={e => patch({ terminalType: e.target.value })}>{['xterm-256color','vt100','ansi'].map(type => <option key={type}>{type}</option>)}</select></label>}
      <label className="lan-field">回车发送<select value={draft.lineEnding || (serial ? 'cr' : 'crlf')} onChange={e => patch({ lineEnding: e.target.value })}><option value="crlf">CRLF</option><option value="cr">CR</option>{serial && <option value="lf">LF</option>}</select></label>
    </>}
  </div></fieldset>;
}
