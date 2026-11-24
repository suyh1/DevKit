import { useEffect, useRef, useState } from 'react';
import { fileBase64 } from './file-base64';
import { jarRequest, serviceLocation, type JarInstance } from './jar-api';
import { Field, Modal } from './project-components';
import { MotionButton } from './Motion';

type Result = { backup: string; started: boolean; startError?: string };
export default function JarReplaceDialog({ item, host, close }: { item: JarInstance; host: string; close: () => void }) {
  const [ready, setReady] = useState(false), [file, setFile] = useState<File>();
  const [backup, setBackup] = useState(true), [start, setStart] = useState(true);
  const [progress, setProgress] = useState(''), [error, setError] = useState('');
  const [result, setResult] = useState<Result>();
  const token = useRef(''), mounted = useRef(false), pending = useRef(false);
  const id = item.id, target = serviceLocation(item);
  const isJar = !item.kind || item.kind === 'jar';

  function cancelUpload() {
    const current = token.current;
    token.current = '';
    if (current) return jarRequest('replace-cancel', { id, token: current });
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void cancelUpload()?.catch(() => {}); };
  }, [id]);

  async function submit() {
    if (pending.current) return;
    pending.current = true;
    setError('');
    try {
      if (!ready) {
        setProgress('正在确认服务停止…');
        const response = await jarRequest<{ token: string }>('replace-begin', { id, expectedPath: target });
        token.current = response.token;
        if (!mounted.current) { await cancelUpload(); return; }
        setReady(true);
        return;
      }
      if (!file?.size || (isJar && !/\.jar$/i.test(file.name))) {
        setError(isJar ? '请选择非空的 .jar 文件。' : '请选择非空的服务文件。');
        return;
      }
      const session = { id, token: token.current };
      const chunkSize = 2 * 1024 * 1024;
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        setProgress('正在上传 ' + Math.floor(offset / file.size * 100) + '%');
        const data = await fileBase64(file.slice(offset, offset + chunkSize));
        if (!mounted.current) return;
        await jarRequest('replace-chunk', { ...session, offset, data });
      }
      if (!mounted.current) return;
      setProgress(start ? '正在替换文件并启动服务…' : '正在替换文件…');
      const completed = await jarRequest<Result>('replace-finish', { ...session, size: file.size, backup, start });
      token.current = '';
      setResult(completed);
    } catch (failure) {
      await cancelUpload()?.catch(() => {});
      setReady(false);
      setFile(undefined);
      setError((failure as Error).message);
    } finally { pending.current = false; setProgress(''); }
  }
  return <Modal title="替换服务文件" description={host + ' · ' + item.name} close={close}
    closeLabel="关闭替换服务文件窗口" busy={!!progress}
    footer={<footer className="pc-actions"><button className="secondary-button" onClick={close}>{result ? '关闭' : '取消'}</button>
      {!result && <MotionButton className="run-button" busy={!!progress} disabled={!!progress || ready && !file} onClick={() => void submit()}>
        {ready ? '上传并替换' : '停止服务并继续'}</MotionButton>}</footer>}>
    <p className="pc-field"><span>目标主机上的原文件</span><code className="jar-replace-path">{target}</code></p>
    {result ? <div role="status">
      <p>{result.started ? '文件已替换，服务已启动。' : result.startError ? '文件已替换，启动失败。' : '文件已替换，服务已停止。'}</p>
      {result.startError && <p className="jar-error">{result.startError}</p>}
      {result.backup && <p className="jar-replace-path">原文件备份：{result.backup}</p>}
    </div> : <>
      <p>{ready ? '服务已停止。取消后可在服务列表手动启动。' : '确认后先停止此服务，再从当前设备选择新文件。'}</p>
      {ready && <>
        <Field label={isJar ? '新的 JAR 文件' : '新的服务文件'}><input type="file" accept={isJar ? '.jar' : undefined}
          onChange={event => setFile(event.target.files?.[0])} /></Field>
        <label className="jar-replace-option"><input type="checkbox" checked={backup} onChange={event => setBackup(event.target.checked)} />在原目录保留带时间戳的备份</label>
        <label className="jar-replace-option"><input type="checkbox" checked={start} onChange={event => setStart(event.target.checked)} />替换后启动服务</label>
      </>}
    </>}
    {progress && <p role="status">{progress}</p>}
    {error && <p className="jar-error" role="alert">{error}</p>}
  </Modal>;
}
