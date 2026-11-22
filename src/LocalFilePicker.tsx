import { useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { FolderOpen, ImagePlus, Upload } from 'lucide-react';
import { MotionDrop } from './Motion';
import FileMeta from './FileMeta';
import { useCardLight } from './tool-card-motion';
import './local-file-picker.css';

type Props = {
  label: string;
  hint?: string;
  accept?: string;
  disabled?: boolean;
  directory?: boolean;
  onFiles: (files: File[]) => void;
};

export default function LocalFilePicker({ label, hint, accept, disabled, directory, onFiles }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<{ name: string; detail: string }>();
  useCardLight(host, Boolean(hint) && !disabled, '.file-drop-target');
  const Icon = directory ? FolderOpen : accept === 'image/*' ? ImagePlus : Upload;
  function select(files: File[]) {
    if (disabled || !files.length) return;
    const [first] = files;
    if (!hint)
      setSelection({
        name: directory ? first.webkitRelativePath.split('/')[0] || first.name : first.name,
        detail: directory ? files.length + ' 个文件' : first.size.toLocaleString() + ' 字节',
      });
    onFiles(files);
  }
  function change(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    select(files);
  }
  function over(event: DragEvent) {
    if (directory || !event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    setDragging(!disabled);
  }
  return (
    <div ref={host} className="local-file-picker" data-expanded={Boolean(hint)}>
      <label
        className="file-drop-target"
        data-dragging={dragging}
        data-resource-card={hint ? '' : undefined}
        onDragOver={over}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (directory || !event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          event.stopPropagation();
          setDragging(false);
          select(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          className="sr-only"
          type="file"
          aria-label={label}
          aria-describedby={hint ? hintId : undefined}
          accept={accept}
          disabled={disabled}
          multiple={directory}
          ref={(node) => {
            if (directory) node?.setAttribute('webkitdirectory', '');
          }}
          onChange={change}
        />
        <span className="file-picker-symbol" aria-hidden="true">
          <Icon size={hint ? 28 : 15} />
        </span>
        <span className="file-picker-label">{label}</span>
        {hint && <small id={hintId}>{hint}</small>}
        {hint && <MotionDrop active={dragging} />}
      </label>
      {selection && <FileMeta name={selection.name} encoding={selection.detail} />}
    </div>
  );
}
