import { resolveProject } from '../shared/projects.mjs';
import type { ProjectState, Profile } from '../shared/projects.mjs';

export function compareProfiles(state: ProjectState, ids: string[]) {
  const profiles = ids.map(id => state.profiles.find(profile => profile.id === id)).filter((profile): profile is Profile => !!profile);
  if (profiles.length < 2) throw new Error('请选择至少两个环境档案。');
  const variables = [...new Set(profiles.flatMap(profile => profile.variables.map(row => row.key)))].sort().map(key => {
    const values = profiles.map(profile => profile.variables.find(row => row.key === key)?.value);
    return { key, values, different: values.some(value => value !== values[0]) };
  });
  const projects = state.projects.map(project => {
    const values = profiles.map(profile => {
      const resolved = resolveProject(project, profile);
      const template = profile.overrides.find(row => row.projectId === project.id)?.url || project.url;
      const missing = [...new Set([...`${template}\n${project.query.filter(row => row.enabled).map(row => row.key + '\n' + row.value).join('\n')}`.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map(match => match[1]))].filter(key => !profile.variables.some(row => row.key === key));
      const override = profile.overrides.find(row => row.projectId === project.id);
      return { ...resolved, missing, override: override ? { url: override.url, enabled: override.enabled } : null };
    });
    return { id: project.id, name: project.name, code: project.code, values, different: values.some(value => JSON.stringify(value) !== JSON.stringify(values[0])) };
  });
  return { profiles: profiles.map(profile => ({ id: profile.id, name: profile.name })), variables, projects };
}
