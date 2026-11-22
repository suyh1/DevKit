import { TextArea } from './TextControl';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { readText } from './files';
import { lanRequest, type HostDraft, type HostImportRow, type LanHost } from './lan-api';
import { parseHostCsv, parseSshHosts } from './lan-import';
import { Modal, ModalCancel } from './project-components';

export default function LanHostImport({ close, onImport }: { close: () => void; onImport: (hosts: LanHost[]) => void }) {
  const [format, setFormat] = useState('csv'), [source, setSource] = useState('');
  const [rows, setRows] = useState<HostImportRow[]>(), [selected, setSelected] = useState<number[]>([]);
  const [drafts, setDrafts] = useState<HostDraft[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  function change(text: string) { setSource(text); setRows(undefined); setError(''); }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <Modal title="导入主机连接" icon={<Upload size={18} />} closeLabel="关闭主机导入" close={close} busy={busy}>
    <div className="lan-import-fields">
      <label className="lan-field"><span>文件格式</span><select value={format} disabled={busy} onChange={event => { setFormat(event.target.value); change(''); }}>
        <option value="csv">CSV</option><option value="ssh">OpenSSH config</option>
      </select></label>
      <input ref={file} hidden type="file" onChange={event => {
        const input = event.currentTarget, selectedFile = input.files?.[0]; input.value = '';
        if (selectedFile) void run(async () => { if (selectedFile.size > 262144) throw new Error('文件最多 256 KiB。'); change((await readText(selectedFile)).text); });
      }} />
      <button className="secondary-button" disabled={busy} onClick={() => file.current?.click()}>选择文件</button>
    </div>
    <label className="lan-field lan-import-source"><span>连接内容</span><TextArea value={source} disabled={busy} maxLength={262144} rows={6} spellCheck={false} onChange={event => change(event.target.value)}
      placeholder={format === 'csv' ? 'name,address,user,port,group,tags\n测试机,192.168.1.20,dev,22,测试,linux|api' : 'Host test\n  HostName 192.168.1.20\n  User dev\n  Port 22'} /></label>
    <p className="lan-note">{format === 'csv' ? '必填列 address。可选列 name、mode、user、port、platform、auth、group、tags、pinned、jar、nginx。标签用 | 分隔。' : '读取 Host、HostName、User 和 Port。密钥和跳板机可在导入后配置。'}</p>
    {rows && <ul className="lan-import-results">{rows.map(row => <li key={row.index}>
      <label><input className="form-check" type="checkbox" disabled={!!row.error || busy} checked={selected.includes(row.index)} onChange={event => setSelected(current => event.target.checked ? [...current, row.index] : current.filter(index => index !== row.index))} />
      <strong>{row.host?.name || `第 ${row.index + 1} 条`}</strong><span>{row.host?.address} {row.error}</span></label>
    </li>)}</ul>}
    {error && <p className="pc-error" role="alert">{error}</p>}
    <footer><ModalCancel />{rows ? <button className="run-button" disabled={busy || !selected.length} onClick={() => void run(async () => {
      onImport(await lanRequest<LanHost[]>('import-connections', drafts.filter((_, index) => selected.includes(index))));
    })}>导入选中的 {selected.length} 条</button> : <button className="run-button" disabled={busy || !source.trim()} onClick={() => void run(async () => {
      const parsed = format === 'csv' ? parseHostCsv(source) : parseSshHosts(source);
      if (!parsed.length) throw new Error('没有可导入的连接。');
      const preview = await lanRequest<HostImportRow[]>('import-preview', parsed);
      setDrafts(parsed); setRows(preview); setSelected(preview.filter(row => !row.error).map(row => row.index));
    })}>预览导入</button>}</footer>
  </Modal>;
}
