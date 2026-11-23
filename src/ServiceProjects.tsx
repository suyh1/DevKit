import { useEffect, useState } from 'react';
import { Modal } from './project-components';
import { projectRequest, saveProjects } from './project-api';
import { CreateRelated, RelatedLink } from './related-workspaces';
import { remoteAccess } from './workspace-remote';
import type { ProjectState } from '../shared/projects.mjs';
import Skeleton from './Skeleton';
import type { JarInstance } from './jar-api';

export default function ServiceProjects({ service, close }: { service: JarInstance; close: () => void }) {
  const [state, setState] = useState<ProjectState>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const editable = !remoteAccess() || remoteAccess()?.services?.projects.edit;
  useEffect(() => {
    let active = true;
    projectRequest<ProjectState>('get').then(data => { if (active) setState(data); }, e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  async function associate(profileId: string, projectId: string, link: boolean) {
    if (!state || busy || !editable) return;
    setBusy(true); setError('');
    const next = structuredClone(state);
    const project = next.profiles.find(p => p.id === profileId)!.projects.find(p => p.id === projectId)!;
    if (link) project.resources = { ...project.resources, jar: service.id };
    else delete project.resources?.jar;
    try {
      const saved = await saveProjects(next, state.revision);
      setState(saved);
      window.dispatchEvent(new CustomEvent('devkit:project-associations', { detail: saved }));
    } catch (e) {
      setError((e as Error).message);
      try { setState(await projectRequest<ProjectState>('get')); } catch { /* Allow reopening after reconnect. */ }
    } finally { setBusy(false); }
  }
  return <Modal title="关联项目" description={service.name} close={close} busy={busy}>
    {editable && <CreateRelated from="jar" page="projects" resource={service.id} beforeOpen={() => { close(); return true; }}>新建关联项目</CreateRelated>}
    {error && <p role="alert" className="pc-error">{error}</p>}
    {!state && !error && <Skeleton kind="list" label="正在读取项目…" />}
    {state?.profiles.map(profile => {
      const projects = profile.projects.filter(project => editable || project.resources?.jar === service.id);
      if (!projects.length) return null;
      return <section key={profile.id} className="service-projects"><h3>{profile.name}</h3><ul>{projects.map(project => {
        const linked = project.resources?.jar === service.id;
        return <li key={project.id}><strong>{project.name}</strong>
          <RelatedLink page="projects" id={profile.id + ':' + project.id} onOpen={close}>查看项目</RelatedLink>
          {editable && <button className="secondary-button" disabled={busy || (!linked && !!project.resources?.jar)}
            onClick={() => void associate(profile.id, project.id, !linked)}>{linked ? '解除关联' : project.resources?.jar ? '已关联其他服务' : '关联项目'}</button>}
        </li>;
      })}</ul></section>;
    })}
    {state && !state.profiles.some(p => p.projects.some(project => editable || project.resources?.jar === service.id)) && <p>暂无{editable ? '可关联的' : '关联'}项目。</p>}
  </Modal>;
}
