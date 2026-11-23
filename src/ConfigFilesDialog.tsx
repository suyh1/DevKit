import { useEffect, useState } from 'react';
import { FileCode, FolderOpen, History, RefreshCw, Save } from 'lucide-react';
import ChangePreview from './ChangePreview';
import CodeEditor from './CodeEditor';
import type { EditorLanguage } from './CodeEditor';
import { useConfirmation } from './Confirmation';
import { jarRequest } from './jar-api';
import type { JarConfigDocument, JarConfigList } from './jar-api';
import { Field, Modal } from './project-components';

const languages: Record<string, EditorLanguage> = { yml: 'yaml', yaml: 'yaml', json: 'json', xml: 'xml' };
const editorText = (content: string) => content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

function withOriginalFormat(text: string, original: string) {
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : '';
  const newline = original.match(/\r\n|\n|\r/)?.[0] ?? '\n';
  return bom + text.replaceAll('\n', newline);
}

export type ConfigRequest = <T>(action: 'config-list' | 'config-read' | 'config-save' | 'config-backup', payload: { id: string; name?: string; hash?: string; content?: string }) => Promise<T>;

export default function ConfigFilesDialog({ item, editable, close, request = jarRequest, kind = 'jar' }: {
  item: { id: string; name: string; path: string };
  editable: boolean;
  close: () => void;
  request?: ConfigRequest;
  kind?: 'jar' | 'nginx';
}) {
  const [listing, setListing] = useState<JarConfigList | null>(null);
  const [file, setFile] = useState<JarConfigDocument | null>(null);
  const [draft, setDraft] = useState('');
  const [backup, setBackup] = useState<JarConfigDocument | null>(null);
  const [mode, setMode] = useState<'edit' | 'changes' | 'backup'>('edit');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const confirm = useConfirmation();
  const dirty = file !== null && draft !== file.content;
  const identity = { id: item.id };

  useEffect(() => {
    let disposed = false;
    void request<JarConfigList>('config-list', { id: item.id })
      .then(result => { if (!disposed) setListing(result); })
      .catch((failure: Error) => { if (!disposed) setError(failure.message); })
      .finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, [item.id, request]);

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await operation(); }
    catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }

  async function read(name: string) {
    if (dirty && !await confirm({
      title: '放弃未保存的配置修改？',
      detail: '读取文件后，当前编辑内容将被替换。',
      confirm: '放弃修改并读取',
    })) return;
    await run(async () => {
      const document = await request<JarConfigDocument>('config-read', { ...identity, name });
      setFile(document);
      setDraft(document.content);
      setBackup(null);
      setMode('edit');
    });
  }

  async function loadBackup(name: string) {
    await run(async () => {
      const previous = await request<JarConfigDocument | null>('config-backup', { ...identity, name });
      setBackup(previous);
      if (previous) setMode('backup');
      else setNotice('此文件尚无备份。');
    });
  }

  async function fillBackup() {
    if (!backup || (dirty && !await confirm({
      title: '用上一版覆盖当前草稿？',
      detail: '上一版将填入编辑器，待保存后才会写入配置文件。',
      confirm: '填入上一版',
    }))) return;
    setDraft(backup.content);
    setMode('edit');
  }

  async function save(document: JarConfigDocument) {
    await run(async () => {
      const saved = await request<JarConfigDocument>('config-save', { ...identity, name: document.name, hash: document.hash, content: draft });
      setFile(saved);
      setDraft(saved.content);
      setBackup(null);
      setMode('edit');
      setNotice(kind === 'jar' ? '配置已保存，上一版已备份。应用何时读取新配置由应用自身决定。' : '配置已保存，上一版已备份。请检查配置后再重载。');
    });
  }

  const files = listing?.files ?? [];
  const jar = kind === 'jar';
  const actions = file && (
    <footer className="jar-config-actions">
      <div className="pc-actions">
        <button type="button" className="text-button" disabled={!editable} onClick={() => void read(file.name)}><RefreshCw size={13} />重新读取</button>
        <button type="button" className="text-button" disabled={!editable} onClick={() => void loadBackup(file.name)}><History size={14} />查看上一版</button>
      </div>
      <div className="pc-actions">
        {mode === 'edit' && <button type="button" className="secondary-button" disabled={!dirty} onClick={() => setMode('changes')}>预览修改</button>}
        {mode !== 'edit' && <button type="button" className="secondary-button" onClick={() => setMode('edit')}>返回编辑</button>}
        {mode === 'backup'
          ? <button type="button" className="run-button" disabled={!editable} onClick={() => void fillBackup()}>用上一版填入编辑器</button>
          : <button type="button" className="run-button" disabled={!editable || !dirty} onClick={() => void save(file)}><Save size={14} />保存配置</button>}
      </div>
    </footer>
  );
  return <Modal footer={actions} title="配置文件" description={item.name} icon={<FileCode size={19} />} className="jar-config-dialog" close={close} closeLabel={jar ? '关闭服务配置文件' : '关闭 Nginx 配置文件'} draft={dirty ? draft : undefined} busy={busy} wide feedback={notice}>
    <div className="jar-configs">
      <div className="jar-config-source">
        <div className="jar-config-directory">
          <FolderOpen size={16} aria-hidden="true" />
          <div><span>{listing?.directory ? '配置目录' : '应用路径'}</span><code>{listing?.directory || item.path}</code></div>
        </div>
        <div className="pc-field-action">
          <Field label={jar ? '同目录配置文件' : '已登记配置文件'}>
            <select value={file?.name || ''} disabled={!editable || !files.length} onChange={event => void read(event.target.value)}>
              <option value="" disabled>{busy && !listing ? '正在读取配置列表…' : '选择配置文件'}</option>
              {file && !files.includes(file.name) && <option value={file.name} disabled>{file.name}（已移出列表）</option>}
              {files.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </Field>
          <button type="button" className="secondary-button" disabled={!editable} onClick={() => void run(async () => setListing(await request<JarConfigList>('config-list', identity)))}><RefreshCw size={14} />刷新列表</button>
        </div>
        {listing && !files.length && <p className="jar-help">此目录暂无支持的配置文件。可读取 512 KiB 以内的 UTF-8 YAML、Properties、JSON、XML、TOML、INI、CONF 和 CFG 文件。</p>}
      </div>
      {error && <p className="jar-error" role="alert">{error}</p>}
      {file && <>
        <div className="jar-config-editor" hidden={mode !== 'edit'}>
          <CodeEditor key={file.name} label={`${jar ? '服务' : 'Nginx'} 配置 ${file.name}`} value={editorText(draft)} language={jar ? languages[file.name.split('.').pop()!.toLowerCase()] || 'text' : 'nginx'} readOnly={busy || !editable} onChange={value => setDraft(current => value === editorText(file.content) ? file.content : withOriginalFormat(value, current))} />
        </div>
        {mode === 'changes' && <ChangePreview before={file.content} after={draft} />}
        {mode === 'backup' && backup && <>
          <p className="jar-help">左侧为已保存的版本，右侧为上一次保存前的备份。</p>
          <ChangePreview before={file.content} after={backup.content} />
        </>}
      </>}
    </div>
  </Modal>;
}
