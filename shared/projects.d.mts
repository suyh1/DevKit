export type QueryRow = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};
export type Project = {
  id: string;
  name: string;
  code: string;
  group: string;
  description: string;
  url: string;
  enabled: boolean;
  query: QueryRow[];
};
export type Profile = {
  id: string;
  name: string;
  description: string;
  variables: { key: string; value: string }[];
  projects: Project[];
};
export type ProjectState = {
  schemaVersion: 2;
  revision: number;
  profiles: Profile[];
};
export const LIMITS: {
  projects: number;
  profiles: number;
  variables: number;
  query: number;
  bytes: number;
};
export function validateState(input: unknown): ProjectState;
export function initialState(): ProjectState;
export function resolveProject(
  project: Project,
  profile: Profile,
): {
  url: string;
  enabled: boolean;
  error: string;
  localOnly: boolean;
  missingVariables: string[];
};
export function importState(input: string): ProjectState;
export function exportState(state: ProjectState): string;
export function mergeProjectState(
  current: ProjectState,
  imported: ProjectState,
): ProjectState;
