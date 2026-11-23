import FloatingDetails from './FloatingDetails';
import { TextArea } from './TextControl';
import { useRef, useState } from 'react';
import { ArrowRight, ClipboardPaste, ScanLine } from 'lucide-react';
import { MotionButton } from './Motion';
import { DETECTION_LIMIT, detectTools, type Suggestion } from './detection';

export default function SmartOpen({ onOpen }: { onOpen: (match: Suggestion) => void }) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  const desktop = window.devkitDesktop;

  function updateInput(value: string) {
    setInput(value);
    setSuggestions([]);
    setError('');
  }

  function inspect(value: string) {
    try {
      setSuggestions(detectTools(value));
      setError('');
    } catch (failure) {
      setSuggestions([]);
      setError(failure instanceof Error ? failure.message : '无法识别内容');
    }
  }

  async function pasteAndInspect() {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      editor.current?.focus();
      setError('无法读取剪贴板，请在文本框内按 Ctrl / Cmd + V。');
      return;
    }
    if (!text.trim()) {
      setError('剪贴板中没有文本，请直接输入内容。');
      return;
    }
    if (text.length > DETECTION_LIMIT) {
      setError('剪贴板超过 200,000 字符，请直接在目标工具中导入。');
      return;
    }
    setInput(text);
    inspect(text);
  }

  return <section className="smart-open" aria-label="内容识别">
    <div className="smart-open-input">
        <TextArea ref={editor} aria-label="待识别内容" rows={3} maxLength={DETECTION_LIMIT} value={input}
          placeholder="例如色值、链接、配置片段或工具名…" spellCheck={false}
          onPaste={event => {
            const { selectionStart, selectionEnd, value } = event.currentTarget;
            const text = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
            if (text.length + value.length - (selectionEnd - selectionStart) > DETECTION_LIMIT) {
              event.preventDefault();
              setError('内容超过 200,000 字符，请直接在目标工具中导入。');
            }
          }}
          onChange={event => {
            const value = event.target.value;
            updateInput(value);
            if (event.nativeEvent instanceof InputEvent && event.nativeEvent.inputType === 'insertFromPaste') inspect(value);
          }} />
      <div className="smart-open-actions">
        {desktop ? <MotionButton className="secondary-button smart-open-paste" onClick={() => editor.current?.focus()}>
          <ClipboardPaste size={14} />输入内容<kbd>{desktop.platform === 'darwin' ? '⌘ V' : 'Ctrl V'}</kbd>
        </MotionButton> : <MotionButton className="secondary-button smart-open-paste" onClick={pasteAndInspect}>
          <ClipboardPaste size={14} />粘贴并识别
        </MotionButton>}
        {input && <button type="button" className="text-button" onClick={() => updateInput('')}>清空</button>}
        <MotionButton className="run-button" disabled={!input.trim()} onClick={() => inspect(input)}><ScanLine size={15} aria-hidden="true" />识别内容</MotionButton>
      </div>
    </div>
    {error && <p role="alert" className="smart-open-error">{error}</p>}
    {(['tool', 'workspace'] as const).map(kind => {
      const matches = suggestions.filter(match => match.kind === kind);
      if (!matches.length) return null;
      const button = (match: Suggestion) => <button type="button" className="smart-suggestion" key={match.id} onClick={() => onOpen(match)}>
        <span><strong>{match.name}</strong><small>{match.reason}</small></span><ArrowRight size={15} aria-hidden="true" />
      </button>;
      return <section key={kind} className="smart-open-results" aria-label={kind === 'tool' ? '本机工具' : '共享栏目'}>
        <p role="status">{kind === 'tool' ? '本机工具' : '共享栏目'} <span>{matches.length}</span></p>
        <div className="smart-suggestions">{matches.slice(0, 6).map(button)}</div>
        {matches.length > 6 && <FloatingDetails><summary>更多匹配（{matches.length - 6}）</summary>
          <div className="smart-suggestions">{matches.slice(6).map(button)}</div></FloatingDetails>}
      </section>;
    })}
  </section>;
}
