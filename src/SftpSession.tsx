import { useEffect, useState } from 'react';
import { lanRequest } from './lan-api';
import SftpPanel from './SftpPanel';

export default function SftpSession({ id, portal }: { id: string; portal: boolean }) {
  const [session, setSession] = useState(''), [running, setRunning] = useState(true);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!running) return;
    let disposed = false, connection = '', timer: ReturnType<typeof setTimeout>;
    const close = () => { if (connection) void lanRequest('terminal-close', { id: connection }).catch(() => {}); };
    function failed(error: Error) {
      if (!disposed) { setStatus(error.message); setRunning(false); }
    }
    async function check() {
      try {
        const state = await lanRequest<{ closed: boolean }>('file-status', { id: connection });
        if (disposed) return;
        if (state.closed) throw new Error('SFTP 已断开');
        timer = setTimeout(check, 10000);
      } catch (error) { failed(error as Error); }
    }
    setSession(''); setStatus('正在连接 SFTP…');
    void lanRequest<{ id: string }>('file-open', { id }).then(result => {
      connection = result.id;
      if (disposed) { close(); return; }
      setSession(connection); setStatus('SFTP 已连接'); void check();
    }).catch(failed);
    return () => { disposed = true; clearTimeout(timer); close(); };
  }, [id, running]);
  return <div className="lan-file-session"><div className="lan-terminal-message"><span role="status">{status}</span>
    <button className="text-button" onClick={() => { if (running) setStatus('已断开连接'); setRunning(!running); }}>{running ? '断开连接' : '重新连接'}</button>
  </div>{running && session && <SftpPanel key={session} session={session} portal={portal} />}</div>;
}
