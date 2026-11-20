import { Component, lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import Skeleton from './Skeleton';

export type EditorLanguage = 'json' | 'javascript' | 'typescript' | 'html' | 'xml' | 'java' | 'css' | 'yaml' | 'sql' | 'nginx' | 'diff' | 'text';
export type CodeEditorProps = { value: string; onChange?: (value: string) => void; label: string; language?: EditorLanguage; readOnly?: boolean; wrap?: boolean; placeholder?: string; tabSize?: number };
const Editor = lazy(() => import('./CodeEditorView'));
class EditorRecovery extends Component<{ children: ReactNode; editor: CodeEditorProps }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const { editor } = this.props;
    return <div className="editor-recovery"><p role="status">代码编辑器加载失败，已切换为纯文本模式。</p><textarea aria-label={editor.label} value={editor.value} readOnly={editor.readOnly} onChange={event => editor.onChange?.(event.target.value)} spellCheck={false} /></div>;
  }
}
function EditorPlaceholder({ show, onShow }: { show: boolean; onShow: (show: boolean) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onShow(true), 150);
    return () => window.clearTimeout(timer);
  }, [onShow]);
  return show ? <Skeleton /> : null;
}

export default function CodeEditor(props: CodeEditorProps) {
  const [showSkeleton, setShowSkeleton] = useState(false);
  return <div className="motion-editor-stage" data-waited={showSkeleton}>
    <EditorRecovery editor={props}>
      <Suspense fallback={<EditorPlaceholder show={showSkeleton} onShow={setShowSkeleton} />}>
        <Editor {...props} />
      </Suspense>
    </EditorRecovery>
  </div>;
}
