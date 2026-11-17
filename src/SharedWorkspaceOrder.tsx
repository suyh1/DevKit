import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { workspaceModules } from './catalog';
import type { WorkspaceModule, WorkspaceModuleId } from './catalog';
import { workspaceModuleNav } from './ui';

export default function SharedWorkspaceOrder({ modules, onClose, onSave }: {
  modules: WorkspaceModule[];
  onClose: () => void;
  onSave: (order: WorkspaceModuleId[]) => void;
}) {
  const [draft, setDraft] = useState(modules);
  const [announcement, setAnnouncement] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const movedControl = useRef<HTMLButtonElement>(null);
  const changed = draft.some((item, index) => item.id !== modules[index]?.id);
  const isDefault = draft.every((item, index) => item.id === workspaceModules[index]?.id);

  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  useLayoutEffect(() => {
    movedControl.current?.focus({ preventScroll: true });
    movedControl.current?.scrollIntoView({ block: 'nearest' });
    movedControl.current = null;
  }, [draft]);

  function move(index: number, offset: -1 | 1, button: HTMLButtonElement) {
    const next = index + offset;
    if (next < 0 || next >= draft.length) return;
    const reordered = [...draft];
    const [item] = reordered.splice(index, 1);
    reordered.splice(next, 0, item);
    movedControl.current = button;
    setDraft(reordered);
    setAnnouncement(`${item.name}已移到第 ${next + 1} 位`);
  }

  return <dialog ref={dialog} className="shared-order-dialog motion-native" aria-labelledby="shared-order-title" aria-describedby="shared-order-description" onClose={onClose}>
    <header className="shared-order-heading">
      <div><h2 id="shared-order-title">排列共享栏目</h2><p id="shared-order-description">顶部和侧栏使用相同顺序</p></div>
      <button className="icon-button" aria-label="关闭栏目排序" onClick={() => dialog.current?.close()}><X size={16} /></button>
    </header>
    <ol className="shared-order-list">
      {draft.map((item, index) => {
        const { Icon } = workspaceModuleNav[item.id];
        return <li key={item.id}>
          <span className="shared-order-position" aria-hidden="true">{index + 1}</span>
          <Icon size={16} aria-hidden="true" />
          <span className="shared-order-name">{item.name}</span>
          <button aria-label={`上移${item.name}`} title="上移" aria-disabled={index === 0} onClick={event => move(index, -1, event.currentTarget)}><ArrowUp size={16} /></button>
          <button aria-label={`下移${item.name}`} title="下移" aria-disabled={index === draft.length - 1} onClick={event => move(index, 1, event.currentTarget)}><ArrowDown size={16} /></button>
        </li>;
      })}
    </ol>
    <p className="sr-only" role="status">{announcement}</p>
    <footer className="shared-order-footer">
      <button className="text-button" disabled={isDefault} onClick={() => { setDraft([...workspaceModules]); setAnnouncement('已恢复默认顺序'); }}>恢复默认</button>
      <button className="secondary-button" onClick={() => dialog.current?.close()}>取消</button>
      <button className="run-button" disabled={!changed} onClick={() => {
        onSave(draft.map(item => item.id));
        dialog.current?.close();
      }}>保存顺序</button>
    </footer>
  </dialog>;
}
