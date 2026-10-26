import { sharingServices } from "../shared/sharing.mjs";

// Explicit environment variables override saved choices, one service at a time.
export function sharingFromEnvironment(env, saved = {}) {
  const services = sharingServices(saved);
  const read = (name, fallback) => {
    if (env[name] === undefined) return fallback;
    if (!["true", "false"].includes(env[name]))
      throw new Error(`${name} 只能为 true 或 false。`);
    return env[name] === "true";
  };
  for (const [id, variables] of Object.entries({
    projects: {
      enabled: "DEVKIT_SHARE_PROJECTS",
      edit: "DEVKIT_PROJECT_EDIT",
      probe: "DEVKIT_PROJECT_PROBE",
    },
    nginx: {
      enabled: "DEVKIT_SHARE_NGINX",
      edit: "DEVKIT_NGINX_EDIT",
      control: "DEVKIT_NGINX_CONTROL",
    },
    http: {
      enabled: "DEVKIT_SHARE_HTTP",
      edit: "DEVKIT_HTTP_EDIT",
      send: "DEVKIT_HTTP_SEND",
    },
  }))
    for (const [key, variable] of Object.entries(variables))
      services[id][key] = read(variable, services[id][key]);
  return sharingServices({ services });
}
