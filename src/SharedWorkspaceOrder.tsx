import { useLayoutEffect, useRef, useState } from 'react';
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, useSensor, useSensors,
} from '@dnd-kit/core';
import type { CollisionDetection, UniqueIdentifier } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import './shared-navigation.css';
import { workspaceModules } from './catalog';
import type { WorkspaceModule, WorkspaceModuleId } from './catalog';
import { workspaceModuleNav } from './ui';

type OrderControl = HTMLButtonElement | HTMLSelectElement;

function OrderRow({ item, index, count, onMove }: {
  item: WorkspaceModule;
  index: number;
  count: number;
  onMove: (from: number, to: number, control: OrderControl) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const { Icon } = workspaceModuleNav[item.id];

  return <li ref={setNodeRef} data-dragging={isDragging || undefined} style={{
    transform: transform ? `translateY(${transform.y}px)` : undefined,
    transition,
  }}>
    <button ref={setActivatorNodeRef} className="shared-order-handle" {...attributes} {...listeners}
      aria-label={`拖动${item.name}排序`} aria-roledescription="排序手柄" title="拖动排序">
      <GripVertical size={17} aria-hidden="true" />
    </button>
    <Icon size={16} aria-hidden="true" />
    <span className="shared-order-name">{item.name}</span>
    <select className="shared-order-position" aria-label={`${item.name}的位置`} value={index}
      onKeyDown={event => {
        if (event.key !== 'Home' && event.key !== 'End') return;
        const select = event.currentTarget;
        if (!CSS.supports('selector(select:open)') || select.matches(':open') || event.target !== select) return;
        event.preventDefault();
        onMove(index, event.key === 'Home' ? 0 : count - 1, select);
      }}
      onChange={event => onMove(index, Number(event.currentTarget.value), event.currentTarget)}>
      {Array.from({ length: count }, (_, position) => <option key={position} value={position}>第 {position + 1} 位</option>)}
    </select>
    <div className="shared-order-arrows">
      <button aria-label={`上移${item.name}`} title="上移" aria-disabled={index === 0}
        onClick={event => onMove(index, index - 1, event.currentTarget)}><ArrowUp size={16} aria-hidden="true" /></button>
      <button aria-label={`下移${item.name}`} title="下移" aria-disabled={index === count - 1}
        onClick={event => onMove(index, index + 1, event.currentTarget)}><ArrowDown size={16} aria-hidden="true" /></button>
    </div>
  </li>;
}

export default function SharedWorkspaceOrder({ modules, defaultModules = workspaceModules, onClose, onSave }: {
  modules: WorkspaceModule[];
  defaultModules?: readonly WorkspaceModule[];
  onClose: () => void;
  onSave: (order: WorkspaceModuleId[]) => void;
}) {
  const [draft, setDraft] = useState(modules);
  const [announcement, setAnnouncement] = useState('');
  const [draggedId, setDraggedId] = useState<UniqueIdentifier | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const movedControl = useRef<OrderControl>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const draggedItem = draft.find(item => item.id === draggedId);
  const DraggedIcon = draggedItem && workspaceModuleNav[draggedItem.id].Icon;
  const changed = draft.some((item, index) => item.id !== modules[index]?.id);
  const isDefault = draft.every((item, index) => item.id === defaultModules[index]?.id);

  useLayoutEffect(() => { dialog.current?.showModal(); }, []);
  useLayoutEffect(() => {
    movedControl.current?.focus({ preventScroll: true });
    movedControl.current?.scrollIntoView({ block: 'nearest' });
    movedControl.current = null;
  }, [draft]);

  function move(index: number, next: number, control?: OrderControl) {
    if (index < 0 || next < 0 || next >= draft.length || index === next) return;
    movedControl.current = control ?? null;
    setDraft(arrayMove(draft, index, next));
    if (control) setAnnouncement(`${draft[index].name}已移到第 ${next + 1} 位`);
  }

  const detectCollision: CollisionDetection = args => {
    if (!args.pointerCoordinates) return closestCenter(args);
    const { x, y } = args.pointerCoordinates;
    const bounds = list.current?.getBoundingClientRect();
    if (!bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return [];
    return pointerWithin(args);
  };
  const positionOf = (id?: UniqueIdentifier) => draft.findIndex(item => item.id === id);

  return <dialog ref={dialog} className="shared-order-dialog motion-native" aria-labelledby="shared-order-title" aria-describedby="shared-order-description" onClose={onClose}>
    <header className="shared-order-heading">
      <div><h2 id="shared-order-title">排列共享栏目</h2><p id="shared-order-description">拖动左侧手柄，或选择要移到的位置。</p></div>
      <button className="icon-button" aria-label="关闭栏目排序" onClick={() => dialog.current?.close()}><X size={16} /></button>
    </header>
    <DndContext sensors={sensors} collisionDetection={detectCollision}
      onDragStart={({ active }) => setDraggedId(active.id)}
      onDragCancel={() => setDraggedId(null)}
      onDragEnd={({ active, over }) => {
        setDraggedId(null);
        move(positionOf(active.id), positionOf(over?.id));
      }}
      accessibility={{
        screenReaderInstructions: {
          draggable: '按空格或回车键拿起栏目，使用上下方向键移动，再按空格或回车键放下，按 Esc 取消拖动。',
        },
        announcements: {
          onDragStart: ({ active }) => `已拿起${draft[positionOf(active.id)]?.name ?? '栏目'}`,
          onDragOver: ({ over }) => over ? `目标位置为第 ${positionOf(over.id) + 1} 位` : undefined,
          onDragEnd: ({ over }) => over ? `栏目已放在第 ${positionOf(over.id) + 1} 位` : '已取消拖动',
          onDragCancel: () => '已取消拖动',
        },
      }}>
      <SortableContext items={draft} strategy={verticalListSortingStrategy}>
        <ol ref={list} className="shared-order-list">
          {draft.map((item, index) => <OrderRow key={item.id} item={item} index={index} count={draft.length} onMove={move} />)}
        </ol>
      </SortableContext>
      <DragOverlay dropAnimation={null} modifiers={[({ transform }) => ({ ...transform, x: 0 })]} style={{ pointerEvents: 'none' }}>
        {draggedItem && DraggedIcon && <div className="shared-order-preview" aria-hidden="true">
          <GripVertical size={17} /><DraggedIcon size={16} /><span>{draggedItem.name}</span>
        </div>}
      </DragOverlay>
    </DndContext>
    <p className="sr-only" role="status">{announcement}</p>
    <footer className="shared-order-footer">
      <button className="text-button" disabled={isDefault} onClick={() => {
        setDraft([...defaultModules]);
        setAnnouncement('已恢复默认顺序');
        list.current?.scrollTo({ top: 0 });
      }}>恢复默认</button>
      <button className="secondary-button" onClick={() => dialog.current?.close()}>取消</button>
      <button className="run-button" disabled={!changed} onClick={() => {
        onSave(draft.map(item => item.id));
        dialog.current?.close();
      }}>保存顺序</button>
    </footer>
  </dialog>;
}
