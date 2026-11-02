export type SharingServices = {
  projects: { enabled: boolean; edit: boolean; probe: boolean };
  nginx: { enabled: boolean; edit: boolean; control: boolean };
  http: { enabled: boolean; edit: boolean; send: boolean };
  jar: { enabled: boolean; edit: boolean; control: boolean };
  monitor: { enabled: boolean; edit: boolean; control: boolean };
  logs: { enabled: boolean; jar: boolean; nginx: boolean; export: boolean };
};
export function emptySharingServices(): SharingServices;
export function hasLegacySharing(value?: unknown): boolean;
export function sharingServices(value?: unknown): SharingServices;
export function sharingAliases(services: SharingServices): { canEdit: boolean; shareProjects: boolean; shareNginx: boolean; shareHttp: boolean; nginxControl: boolean };
