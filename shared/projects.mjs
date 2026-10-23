export const LIMITS = {
  projects: 300,
  profiles: 30,
  variables: 100,
  query: 100,
  bytes: 1_000_000,
};
const fail = (message) => {
  throw new Error(message);
};
const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, label, max = 2000, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /\0/.test(value) ||
    (required && !value.trim())
  )
    fail(`${label}无效（最多 ${max} 字符）。`);
  return value;
};
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value)
    ? value
    : fail("标识无效。");
const bool = (value) =>
  typeof value === "boolean" ? value : fail("启用状态无效。");
const list = (value, max, label) =>
  Array.isArray(value) && value.length <= max
    ? value
    : fail(`${label}最多 ${max} 项。`);
function unique(items, key, label) {
  if (new Set(items.map((item) => item[key])).size !== items.length)
    fail(`${label}不能重复。`);
  return items;
}
export function validateState(input) {
  if (
    !record(input) ||
    input.schemaVersion !== 1 ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  )
    fail("不是受支持的项目中心数据。");
  const projects = unique(
    list(input.projects, LIMITS.projects, "项目").map((item) => {
      if (!record(item)) fail("项目无效。");
      const query = unique(
        list(item.query, LIMITS.query, "参数").map((row) => ({
          id: id(row.id),
          key: text(row.key, "参数名", 200).trim(),
          value: text(row.value, "参数值"),
          enabled: bool(row.enabled),
        })),
        "id",
        "参数 ID",
      );
      for (const row of query)
        if (row.enabled && !row.key && row.value)
          fail("已启用的查询参数填写了值，请同时填写参数名。");
      const url = text(item.url, "地址模板", 4000, true).trim();
      if (!/^https?:\/\//i.test(url))
        fail("入口地址必须以 http:// 或 https:// 开头。");
      return {
        id: id(item.id),
        name: text(item.name, "项目名称", 100, true).trim(),
        code: text(item.code, "项目编码", 100, true).trim(),
        group: text(item.group, "分组", 80).trim(),
        description: text(item.description, "说明", 1000),
        url,
        enabled: bool(item.enabled),
        query,
      };
    }),
    "id",
    "项目 ID",
  );
  unique(projects, "code", "项目编码");
  const projectIds = new Set(projects.map((item) => item.id));
  const profiles = unique(
    list(input.profiles, LIMITS.profiles, "配置档案").map((item) => {
      if (!record(item)) fail("配置档案无效。");
      const variables = unique(
        list(item.variables, LIMITS.variables, "变量").map((row) => {
          if (!record(row) || !/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(row.key))
            fail("变量名只能包含字母、数字和下划线，且不能以数字开头。");
          return { key: row.key, value: text(row.value, "变量值", 2000) };
        }),
        "key",
        "变量名",
      );
      const overrides = unique(
        list(item.overrides, LIMITS.projects, "环境覆盖").map((row) => {
          if (!record(row) || !projectIds.has(row.projectId))
            fail("覆盖项关联了不存在的项目。");
          return {
            projectId: row.projectId,
            url: text(row.url, "覆盖地址", 4000).trim(),
            enabled: bool(row.enabled),
          };
        }),
        "projectId",
        "项目覆盖",
      );
      return {
        id: id(item.id),
        name: text(item.name, "档案名称", 100, true).trim(),
        description: text(item.description, "档案说明", 1000),
        variables,
        overrides,
      };
    }),
    "id",
    "档案 ID",
  );
  if (!profiles.length) fail("至少保留一个配置档案。");
  unique(profiles, "name", "档案名称");
  const result = {
    schemaVersion: 1,
    revision: input.revision,
    projects,
    profiles,
  };
  if (JSON.stringify(result).length > LIMITS.bytes)
    fail("项目中心数据超过 1,000,000 字符。");
  return result;
}
export function resolveProject(project, profile) {
  const override = profile.overrides.find(
    (item) => item.projectId === project.id,
  );
  const variables = new Map(
    profile.variables.map((item) => [item.key, item.value]),
  );
  const missing = new Set();
  const fill = (value) =>
    value.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, key) => {
      if (!variables.has(key)) {
        missing.add(key);
        return "";
      }
      return variables.get(key);
    });
  try {
    const raw = fill(override?.url || project.url).trim();
    const rows = project.query
      .filter((item) => item.enabled)
      .map((item) => ({ key: fill(item.key).trim(), value: fill(item.value) }));
    if (missing.size) fail(`缺少变量：${[...missing].join("、")}`);
    if (/[{}]/.test(raw)) fail("地址模板包含不受支持的占位符。");
    const url = new URL(raw);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      fail("入口仅支持 HTTP(S)，不能在地址中包含用户名或密码。");
    for (const row of rows) {
      if (!row.key) {
        if (row.value) fail("已启用的查询参数缺少参数名。");
        continue;
      }
      url.searchParams.append(row.key, row.value);
    }
    return {
      url: url.href,
      enabled: override?.enabled ?? project.enabled,
      error: "",
      overridden: !!override,
      localOnly: ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(
        url.hostname,
      ),
    };
  } catch (error) {
    return {
      url: "",
      enabled: override?.enabled ?? project.enabled,
      error: error.message || "地址无效",
      overridden: !!override,
      localOnly: false,
    };
  }
}
export function initialState() {
  return {
    schemaVersion: 1,
    revision: 0,
    projects: [],
    profiles: [
      {
        id: "default",
        name: "默认环境",
        description: "填写共享环境变量，再添加项目入口。",
        variables: [{ key: "host", value: "127.0.0.1" }],
        overrides: [],
      },
    ],
  };
}
export function importState(input) {
  if (typeof input !== "string" || input.length > LIMITS.bytes)
    fail("请选择不超过 1,000,000 字符的项目中心 JSON。");
  const source = JSON.parse(input);
  if (
    source.format &&
    (source.format !== "devkit-project-center" || source.version !== 1)
  )
    fail("项目中心文件版本不受支持。");
  return validateState(
    source.format === "devkit-project-center" ? source.data : source,
  );
}
export function exportState(state) {
  return JSON.stringify(
    { format: "devkit-project-center", version: 1, data: validateState(state) },
    null,
    2,
  );
}

// Merge by business identity, remapping imported IDs before attaching overrides.
// Existing entries outside the import are retained; matching entries are updated.
export function mergeProjectState(currentInput, importedInput) {
  const current = validateState(currentInput),
    imported = validateState(importedInput);
  const projects = structuredClone(current.projects),
    profiles = structuredClone(current.profiles);
  const projectIds = new Set(projects.map((item) => item.id)),
    profileIds = new Set(profiles.map((item) => item.id));
  let counter = 0;
  function available(preferred, used) {
    let value = preferred;
    while (used.has(value)) value = `imported_${++counter}`;
    used.add(value);
    return value;
  }
  const mapped = new Map();
  for (const source of imported.projects) {
    const index = projects.findIndex((item) => item.code === source.code);
    const id =
      index >= 0 ? projects[index].id : available(source.id, projectIds);
    mapped.set(source.id, id);
    const project = { ...structuredClone(source), id };
    if (index >= 0) projects[index] = project;
    else projects.push(project);
  }
  for (const source of imported.profiles) {
    const index = profiles.findIndex((item) => item.name === source.name);
    const existing = index >= 0 ? profiles[index] : null;
    const overrides = new Map(
      (existing?.overrides || []).map((item) => [item.projectId, item]),
    );
    const variables = new Map(
      (existing?.variables || []).map((item) => [item.key, item]),
    );
    for (const row of source.variables)
      variables.set(row.key, structuredClone(row));
    for (const row of source.overrides) {
      const projectId = mapped.get(row.projectId);
      overrides.set(projectId, { ...row, projectId });
    }
    const profile = {
      ...structuredClone(source),
      id: existing?.id || available(source.id, profileIds),
      variables: [...variables.values()],
      overrides: [...overrides.values()],
    };
    if (index >= 0) profiles[index] = profile;
    else profiles.push(profile);
  }
  return validateState({ ...current, projects, profiles });
}
