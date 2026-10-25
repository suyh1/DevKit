import { MotionButton } from './Motion';
import { useState } from 'react';
import { ClipboardPaste, ScanLine, ArrowRight } from 'lucide-react';
import { tools } from './tools';
import type { Options, ToolId } from './tools';
import { detectTools, DETECTION_LIMIT } from './detection';
import type { Suggestion } from './detection';

export default function SmartOpen({ onOpen }: { onOpen: (id: ToolId, text: string, options?: Options) => void }) {
  const [input, setInput] = useState(''), [suggestions, setSuggestions] = useState<Suggestion[] | null>(null), [error, setError] = useState('');
  function inspect(value: string) {
    try { setSuggestions(detectTools(value)); setError(''); }
    catch (failure) { setSuggestions(null); setError(failure instanceof Error ? failure.message : '无法识别内容'); }
  }
  return <section className="smart-open" aria-labelledby="smart-open-title">
    <div className="section-heading"><h2 id="smart-open-title"><ScanLine size={16} />根据内容推荐工具</h2><small>内容仅在内存，识别后由你选择</small></div>
    <div className="smart-open-input"><textarea aria-label="待识别内容" rows={2} maxLength={DETECTION_LIMIT} value={input} placeholder="粘贴 JSON、XML、URL、时间戳、类型声明或其他文本…" onChange={event => { setInput(event.target.value); setSuggestions(null); setError(''); }} /><div><button className="secondary-button" onClick={async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text.length > DETECTION_LIMIT) { setError('剪贴板超过 200,000 字符，请直接在目标工具中导入。'); return; }
        setInput(text); inspect(text);
      } catch { setError('无法读取剪贴板，请在文本框内按 Ctrl / Cmd + V。'); }
    }}><ClipboardPaste size={14} />粘贴并识别</button><MotionButton className="run-button" disabled={!input.trim()} onClick={() => inspect(input)}><ScanLine size={14} />识别内容</MotionButton>{input && <button className="text-button" onClick={() => { setInput(''); setSuggestions(null); setError(''); }}>清空</button>}</div></div>
    {error && <p role="alert" className="smart-open-error">{error}</p>}
    {suggestions && <div className="smart-suggestions" role="status">{suggestions.map(suggestion => <button className="smart-suggestion" key={suggestion.id} onClick={() => { onOpen(suggestion.id, input, suggestion.options); }}><span><strong>{tools.find(tool => tool.id === suggestion.id)!.name}</strong><small>{suggestion.reason}</small></span><ArrowRight size={15} /></button>)}</div>}
  </section>;
}
