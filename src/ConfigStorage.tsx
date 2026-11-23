import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { Copy, FolderOpen, FolderCog } from 'lucide-react';
import ConfigFilesDialog from './ConfigFilesDialog';
import { jarRequest, serviceLocation, type JarInstance, type JarState } from './jar-api';
import { targetGroup } from './lan-api';
import { Modal, ModalCancel } from './project-components';
import { copyText } from './motion-primitives';
import { isProjectDesktop, projectRequest, type ProjectStorage } from './project-api';

export default function ConfigStorage({ portal = false }: { portal?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!portal && !isProjectDesktop()) return null;
  return <><button type="button" className="text-button config-storage-trigger" aria-haspopup="dialog" title="配置文件" aria-label="配置文件" onClick={() => setOpen(true)}>
    <FolderCog size={16} /><span>配置文件</span>
  </button>{open && createPortal(<StoragePanel portal={portal} close={() => setOpen(false)} />, document.body)}</>;
}

function StoragePanel({ portal, close }: { portal: boolean; close: () => void }) {
  const [storage, setStorage] = useState<ProjectStorage>();
  const [feedback, setFeedback] = useState('');
  const [services, setServices] = useState<JarState>();
  const [selected, setSelected] = useState<JarInstance>();
  const [inventoryError, setInventoryError] = useState('');
  useEffect(() => {
    let active = true;
    void jarRequest<JarState>('get', { scope: 'inventory' }).then(
      data => { if (active) setServices(data); },
      error => { if (active) setInventoryError(error.message); },
    );
    if (!portal) void projectRequest<ProjectStorage>('storage').then(
      data => { if (active) setStorage(data); },
      error => { if (active) setFeedback(error.message); },
    );
    return () => { active = false; };
  }, [portal]);
  const choices = services?.instances.filter(item => targetGroup(services.groups, item.hostId)?.edit !== false);
  if (selected) return <ConfigFilesDialog item={{ ...selected, path: serviceLocation(selected) }} editable close={close} />;
  return <Modal title={portal ? '服务配置文件' : '配置文件与迁移'} close={close} feedback={feedback}>
    <section className="config-source"><h3>服务配置文件</h3>
      {inventoryError ? <p role="alert" className="pc-error">{inventoryError}</p> : !services ? <p role="status">正在读取服务列表…</p> :
        choices?.length ? <label>选择服务<select aria-label="选择服务配置文件" value="" onChange={event => setSelected(choices.find(item => item.id === event.target.value))}>
          <option disabled value="">选择主机上的服务</option>{choices.map(item => <option key={item.id} value={item.id}>{targetGroup(services.groups, item.hostId)?.name || (portal ? '共享主机' : '本机')} · {item.name}</option>)}
        </select></label> : <p>暂无可编辑的服务。</p>}
      {services?.groups?.filter(group => group.error).map(group => <p key={group.id} role="status">{group.name} · {group.error}</p>)}
    </section>
    {!portal && <><h3>工作台配置目录</h3>
    {storage?.error && <p className="pc-error" role="alert">{storage.error}</p>}
    <div className="pc-path"><code>{storage?.directory}</code><div className="pc-actions">
      <button className="secondary-button" onClick={() => void projectRequest('open-configs').catch(e => setFeedback(e.message))}><FolderOpen size={15} />打开 configs 目录</button>
      <button className="secondary-button" disabled={!storage} onClick={() => void copyText(storage!.directory).then(() => setFeedback('路径已复制'), e => setFeedback(e.message))}><Copy size={15} />复制路径</button>
    </div></div>
    <dl className="pc-file-list">
      <div><dt>projects/</dt><dd>档案、项目、变量与最近 30 份快照</dd></div>
      <div><dt>sharing/</dt><dd>共享权限、访问口令哈希、审计、Git 仓库登记、文件共享和快传链接</dd></div>
      <div><dt>planning/</dt><dd>知识库和待办清单</dd></div>
    </dl>
    <p>升级时自动整理旧版散落的配置文件。迁移到其他电脑时，请先关闭两端的 DevKit 或独立服务，备份目标目录，再复制整个 configs。目录包含访问凭据。</p>
    {storage?.migratedFrom && <p>已从 {storage.migratedFrom} 迁入旧版项目。</p>}
    </>}
    <footer><ModalCancel>知道了</ModalCancel></footer>
  </Modal>;
}
