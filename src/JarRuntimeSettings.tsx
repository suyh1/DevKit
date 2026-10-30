import type { JarInstance, JarPolicies } from './jar-api';

export type RuntimeDraft = Omit<JarPolicies, 'env' | 'profiles'> & { envText: string; profiles: { id: string; name: string; text: string }[] };
const envText = (env: Record<string, string> = {}) => Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n');
export function runtimeDraft(instance?: JarInstance): RuntimeDraft {
  return { health: instance?.health || { type: 'none', url: 'http://127.0.0.1:8080/actuator/health', host: '127.0.0.1', port: 8080, interval: 10, timeout: 3, grace: 30, failures: 3, status: 200 }, rotation: instance?.rotation || { enabled: true, maxMB: 10, days: 7, files: 10 }, restart: instance?.restart || { enabled: false, maxRetries: 5, delay: 2, maxDelay: 60, stable: 60 }, profile: instance?.profile || '', envText: envText(instance?.env), profiles: instance ? instance.profiles.map(profile => ({ id: profile.id, name: profile.name, text: envText(profile.env) })) : [{ id: 'development', name: '开发', text: '' }, { id: 'test', name: '测试', text: '' }, { id: 'production', name: '生产', text: '' }] };
}
function parseEnv(text: string) {
  const result: Record<string, string> = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const equal = line.indexOf('='), key = line.slice(0, equal).trim();
    if (equal < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.hasOwn(result, key)) throw new Error('环境变量每行填写唯一的 KEY=value，不使用 export 或引号包裹值。');
    result[key] = line.slice(equal + 1);
  }
  return result;
}
export function runtimePayload(draft: RuntimeDraft): JarPolicies {
  return { health: draft.health, rotation: draft.rotation, restart: draft.restart, env: parseEnv(draft.envText), profile: draft.profile, profiles: draft.profiles.map(profile => ({ id: profile.id, name: profile.name, env: parseEnv(profile.text) })) };
}
export default function JarRuntimeSettings({ value, onChange }: { value: RuntimeDraft; onChange: (value: RuntimeDraft) => void }) {
  const patch = (values: Partial<RuntimeDraft>) => onChange({ ...value, ...values });
  const h = value.health, r = value.restart, l = value.rotation;
  const number = (label: string, content: number, change: (value: number) => void, min: number, max: number) => <label>{label}<input type="number" value={content} min={min} max={max} required onChange={event => change(Number(event.target.value))} /></label>;
  return <div className="jar-runtime-settings">
    <details className="jar-setting-section" open={h.type !== 'none'}><summary>HTTP / TCP 健康检查</summary>
      <label>检测方式<select value={h.type} onChange={event => patch({ health: { ...h, type: event.target.value as typeof h.type } })}><option value="none">不检测</option><option value="http">HTTP(S) 请求</option><option value="tcp">TCP 端口连接</option></select></label>
      {h.type === 'http' && <><label>健康检查 URL<input type="url" required value={h.url} onChange={event => patch({ health: { ...h, url: event.target.value } })} /></label>{number('预期 HTTP 状态码', h.status, status => patch({ health: { ...h, status } }), 100, 599)}</>}
      {h.type === 'tcp' && <div className="jar-form-grid"><label>TCP 主机<input required value={h.host} onChange={event => patch({ health: { ...h, host: event.target.value } })} /></label>{number('TCP 端口', h.port, port => patch({ health: { ...h, port } }), 1, 65535)}</div>}
      {h.type !== 'none' && <div className="jar-form-grid">{number('检测间隔（秒）', h.interval, interval => patch({ health: { ...h, interval } }), 2, 3600)}{number('检测超时（秒）', h.timeout, timeout => patch({ health: { ...h, timeout } }), 1, 60)}{number('启动宽限（秒）', h.grace, grace => patch({ health: { ...h, grace } }), 0, 3600)}{number('连续失败阈值', h.failures, failures => patch({ health: { ...h, failures } }), 1, 20)}</div>}
      <p className="jar-help">从运行 DevKit 的主机检测，不跟随 HTTP 重定向；HTTPS 校验证书。连续失败先显示波动，达到阈值标记不健康，不自动重启。</p>
    </details>
    <details className="jar-setting-section"><summary>日志大小与保留策略</summary>
      <label className="jar-check"><input type="checkbox" checked={l.enabled} onChange={event => patch({ rotation: { ...l, enabled: event.target.checked } })} />启用日志轮转</label>
      {l.enabled && <div className="jar-form-grid">{number('单文件大小（MB）', l.maxMB, maxMB => patch({ rotation: { ...l, maxMB } }), 1, 1024)}{number('归档保留天数', l.days, days => patch({ rotation: { ...l, days } }), 1, 3650)}{number('最多归档文件数', l.files, files => patch({ rotation: { ...l, files } }), 1, 1000)}</div>}
      <p className="jar-help">仅轮转本工具接收的标准输出与错误。归档保存在 JAR 同目录；超过天数或数量后删除工具生成的旧归档。静默模式不写日志。</p>
    </details>
    <details className="jar-setting-section"><summary>环境变量与开发 / 测试 / 生产档案</summary>
      <label>公共环境变量<textarea rows={4} placeholder={'TZ=Asia/Shanghai\nAPP_NAME=order-service'} value={value.envText} onChange={event => patch({ envText: event.target.value })} /></label>
      <label>本次启动的环境档案<select value={value.profile} onChange={event => patch({ profile: event.target.value })}><option value="">仅使用公共变量</option>{value.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name || '未命名环境'}</option>)}</select></label>
      {value.profiles.map((profile, index) => <details className="jar-profile" key={profile.id}><summary>{profile.name || '未命名环境'}{profile.id === value.profile ? ' · 当前' : ''}</summary><label>环境名称<input required maxLength={100} value={profile.name} onChange={event => patch({ profiles: value.profiles.map((old, i) => i === index ? { ...old, name: event.target.value } : old) })} /></label><label>此环境的覆盖变量<textarea rows={4} value={profile.text} placeholder={'SPRING_PROFILES_ACTIVE=test\nSERVER_PORT=8081'} onChange={event => patch({ profiles: value.profiles.map((old, i) => i === index ? { ...old, text: event.target.value } : old) })} /></label><button type="button" className="text-button jar-danger" onClick={() => patch({ profiles: value.profiles.filter((_, i) => i !== index), profile: profile.id === value.profile ? '' : value.profile })}>移除此环境</button></details>)}
      <button type="button" className="text-button" disabled={value.profiles.length >= 20} onClick={() => patch({ profiles: [...value.profiles, { id: `env-${crypto.randomUUID().slice(0, 8)}`, name: '新环境', text: '' }] })}>添加环境档案</button>
      <p className="jar-help">每行 KEY=value，值原样使用，不额外包引号；支持 # 注释。继承系统环境，再由公共变量、当前档案依次覆盖。切换环境需先停止应用。</p>
    </details>
    <details className="jar-setting-section" open={r.enabled}><summary>崩溃自动重启</summary>
      <label className="jar-check"><input type="checkbox" checked={r.enabled} onChange={event => patch({ restart: { ...r, enabled: event.target.checked } })} />非正常退出后自动重启</label>
      {r.enabled && <div className="jar-form-grid">{number('重试上限', r.maxRetries, maxRetries => patch({ restart: { ...r, maxRetries } }), 1, 100)}{number('初次重试间隔（秒）', r.delay, delay => patch({ restart: { ...r, delay } }), 1, 3600)}{number('最大重试间隔（秒）', r.maxDelay, maxDelay => patch({ restart: { ...r, maxDelay } }), 1, 86400)}{number('稳定运行后重置（秒）', r.stable, stable => patch({ restart: { ...r, stable } }), 5, 86400)}</div>}
      <p className="jar-help">重试间隔按 2 倍增长，到上限后保持不变。正常退出（代码 0）、手动停止及身份不明不会自动拉起；达到重试上限后需手动启动。</p>
    </details>
  </div>;
}
