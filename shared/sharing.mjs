const fields = {
  projects: ["edit", "probe"],
  nginx: ["edit", "control"],
  http: ["edit", "send"],
};
const own = (value, key) => Object.hasOwn(value, key);
export function emptySharingServices() {
  return Object.fromEntries(
    Object.entries(fields).map(([id, permissions]) => [
      id,
      Object.fromEntries(
        ["enabled", ...permissions].map((key) => [key, false]),
      ),
    ]),
  );
}
export function hasLegacySharing(value = {}) {
  return (
    !own(value, "services") &&
    [
      "canEdit",
      "shareProjects",
      "shareNginx",
      "shareHttp",
      "nginxControl",
    ].some((key) => own(value, key))
  );
}
export function sharingServices(value = {}) {
  if (value.services !== undefined) {
    if (
      !value.services ||
      typeof value.services !== "object" ||
      Array.isArray(value.services) ||
      Object.keys(value.services).some((key) => !own(fields, key))
    )
      throw new Error("共享服务设置无效。");
    const result = emptySharingServices();
    for (const [id, permissions] of Object.entries(fields)) {
      const service = value.services[id];
      if (
        !service ||
        typeof service !== "object" ||
        Array.isArray(service) ||
        typeof service.enabled !== "boolean" ||
        Object.keys(service).some(
          (key) => !["enabled", ...permissions].includes(key),
        )
      )
        throw new Error(`共享服务 ${id} 的设置无效。`);
      result[id].enabled = service.enabled;
      for (const key of permissions) {
        if (service[key] !== undefined && typeof service[key] !== "boolean")
          throw new Error(`共享权限 ${id}.${key} 必须为布尔值。`);
        result[id][key] = service.enabled && service[key] === true;
      }
    }
    return result;
  }
  if (value.accessVersion !== undefined)
    throw new Error("缺少共享服务权限配置。");
  const result = emptySharingServices();
  if (!hasLegacySharing(value)) return result;
  for (const key of [
    "canEdit",
    "shareProjects",
    "shareNginx",
    "shareHttp",
    "nginxControl",
  ])
    if (value[key] !== undefined && typeof value[key] !== "boolean")
      throw new Error("旧版共享权限设置无效。");
  const edit = value.canEdit === true;
  result.projects = {
    enabled: value.shareProjects !== false,
    edit: value.shareProjects !== false && edit,
    probe: value.shareProjects !== false && edit,
  };
  result.nginx = {
    enabled: value.shareNginx === true,
    edit: value.shareNginx === true && edit,
    control: value.shareNginx === true && edit && value.nginxControl === true,
  };
  result.http = {
    enabled: value.shareHttp === true,
    edit: value.shareHttp === true && edit,
    send: value.shareHttp === true && edit,
  };
  return result;
}
export function sharingAliases(services) {
  return {
    canEdit: services.projects.edit,
    shareProjects: services.projects.enabled,
    shareNginx: services.nginx.enabled,
    shareHttp: services.http.enabled,
    nginxControl: services.nginx.control,
  };
}
