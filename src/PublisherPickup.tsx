import { useEffect, useRef, useState } from 'react';
import { collab } from './collab-api';

export default function PublisherPickup({ id, receipt }: { id: string; receipt: string }) {
  const [password, setPassword] = useState<string>(), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const hide = () => { generation.current++; setPassword(undefined); setLoading(false); };
    const visibility = () => { if (document.hidden) hide(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    return () => { generation.current++; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide); };
  }, []);
  async function toggle() {
    if (password !== undefined) { setPassword(undefined); return; }
    const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await collab<{ password: string }>('transfer', 'recall', { id, key: receipt });
      if (request === generation.current) setPassword(result.password);
    } catch (failure) {
      if (request === generation.current) setError((failure as Error).message);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  return <div className="publisher-pickup">
    <button type="button" aria-expanded={password !== undefined} disabled={loading} onClick={() => void toggle()}>
      {password !== undefined ? '隐藏取件密码' : '查看我的取件密码'}
    </button>
    {password !== undefined && <code aria-label="我发布的取件密码">{password}</code>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
