export type SharingServices = {
  projects: { enabled: boolean; edit: boolean; probe: boolean };
  nginx: { enabled: boolean; edit: boolean; control: boolean };
  http: { enabled: boolean; edit: boolean; send: boolean };
};
export function emptySharingServices(): SharingServices;
export function hasLegacySharing(value?: unknown): boolean;
export function sharingServices(value?: unknown): SharingServices;
export function sharingAliases(services: SharingServices): { canEdit: boolean; shareProjects: boolean; shareNginx: boolean; shareHttp: boolean; nginxControl: boolean };
