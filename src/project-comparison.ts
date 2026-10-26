import { resolveProject } from "../shared/projects.mjs";
import type { ProjectState, Profile } from "../shared/projects.mjs";

export function compareProfiles(state: ProjectState, ids: string[]) {
  const profiles = [...new Set(ids)]
    .map((id) => state.profiles.find((profile) => profile.id === id))
    .filter((profile): profile is Profile => !!profile);
  if (profiles.length < 2 || profiles.length > 4)
    throw new Error("请选择 2–4 个方案。");
  const variables = [
    ...new Set(
      profiles.flatMap((profile) => profile.variables.map((row) => row.key)),
    ),
  ]
    .sort()
    .map((key) => {
      const values = profiles.map(
        (profile) => profile.variables.find((row) => row.key === key)?.value,
      );
      return {
        key,
        values,
        different: values.some((value) => value !== values[0]),
      };
    });
  const codes = [
    ...new Set(
      profiles.flatMap((profile) =>
        profile.projects.map((project) => project.code),
      ),
    ),
  ];
  const projects = codes.map((code) => {
    const values = profiles.map((profile) => {
      const project = profile.projects.find((project) => project.code === code);
      if (!project) return null;
      const resolved = resolveProject(project, profile);
      const missing = [
        ...new Set(
          [
            ...`${project.url}\n${project.query
              .filter((row) => row.enabled)
              .map((row) => row.key + "\n" + row.value)
              .join("\n")}`.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g),
          ].map((match) => match[1]),
        ),
      ].filter((key) => !profile.variables.some((row) => row.key === key));
      return {
        name: project.name,
        description: project.description,
        group: project.group,
        template: project.url,
        query: project.query.map(({ key, value, enabled }) => ({
          key,
          value,
          enabled,
        })),
        ...resolved,
        missing,
      };
    });
    return {
      code,
      values,
      different: values.some(
        (value) => JSON.stringify(value) !== JSON.stringify(values[0]),
      ),
    };
  });
  return {
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: profile.description,
      projects: profile.projects.length,
    })),
    variables,
    projects,
  };
}
