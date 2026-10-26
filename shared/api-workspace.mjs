export const API_LIMITS = {
  projects: 30,
  endpoints: 500,
  environments: 30,
  parameters: 200,
  bytes: 16_000_000,
};
export const API_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message) => {
  throw new Error(message);
};
const text = (value, label, max = 2000, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /\0/.test(value) ||
    (required && !value.trim())
  )
    fail(`${label}无效（最多${max}字符）。`);
  return value;
};
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value)
    ? value
    : fail("标识无效。");
const list = (value, max, label) =>
  Array.isArray(value) && value.length <= max
    ? value
    : fail(`${label}最多${max}项。`);
const bool = (value) =>
  typeof value === "boolean" ? value : fail("启用或必填状态无效。");
const choice = (value, values, label) =>
  values.includes(value) ? value : fail(`${label}无效。`);
const unique = (items, key, label) => {
  if (new Set(items.map((item) => item[key])).size !== items.length)
    fail(`${label}不能重复。`);
  return items;
};
export function parseApiSchema(value) {
  text(value, "JSON Schema", 512_000);
  if (!value.trim()) return null;
  const schema = JSON.parse(value);
  if (typeof schema !== "boolean" && !object(schema))
    fail("Schema必须是JSON对象或布尔值。");
  const stack = [{ value: schema, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (++count > 20000 || depth > 64)
      fail("Schema过于复杂（最多64层、20000节点）。");
    if (value && typeof value === "object")
      for (const child of Object.values(value))
        stack.push({ value: child, depth: depth + 1 });
  }
  return schema;
}
export function initialApiState() {
  return { schemaVersion: 1, revision: 0, projects: [] };
}
export function validateApiState(input) {
  if (
    !object(input) ||
    input.schemaVersion !== 1 ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0
  )
    fail("API工作区格式或版本无效。");
  const projects = unique(
    list(input.projects, API_LIMITS.projects, "API项目").map((project) => {
      if (!object(project)) fail("API项目无效。");
      const groups = list(project.groups, 100, "目录").map((value) =>
        text(value, "目录名称", 100, true).trim(),
      );
      if (new Set(groups).size !== groups.length) fail("目录名称不能重复。");
      const environments = unique(
        list(project.environments, API_LIMITS.environments, "环境").map(
          (env) => ({
            id: id(env.id),
            name: text(env.name, "环境名称", 100, true).trim(),
            baseUrl: text(env.baseUrl, "环境服务地址", 4000),
            variables: unique(
              list(env.variables, 100, "环境变量").map((row) => {
                if (!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(row.key))
                  fail("变量名只能使用字母数字下划线，且不能以数字开头。");
                return {
                  key: row.key,
                  value: text(row.value, "变量值", 12000),
                  enabled: bool(row.enabled),
                };
              }),
              "key",
              "变量名",
            ),
          }),
        ),
        "id",
        "环境ID",
      );
      unique(environments, "name", "环境名称");
      const endpoints = unique(
        list(project.endpoints, API_LIMITS.endpoints, "接口").map(
          (endpoint) => {
            const group = text(endpoint.group, "接口目录", 100);
            const timeout = endpoint.timeout ?? 15000;
            if (!Number.isInteger(timeout) || timeout < 100 || timeout > 120000)
              fail("接口超时必须为100–120000毫秒。");
            if (group && !groups.includes(group)) fail("接口目录不存在。");
            const parameters = unique(
              list(endpoint.parameters, API_LIMITS.parameters, "参数").map(
                (row) => ({
                  id: id(row.id),
                  name: text(row.name, "参数名称", 200, true).trim(),
                  location: choice(
                    row.location,
                    ["path", "query", "header", "cookie"],
                    "参数位置",
                  ),
                  type: choice(
                    row.type,
                    [
                      "string",
                      "integer",
                      "number",
                      "boolean",
                      "object",
                      "array",
                    ],
                    "参数类型",
                  ),
                  required: bool(row.required),
                  enabled: bool(row.enabled),
                  description: text(row.description, "参数说明"),
                  example: text(row.example, "参数示例", 12000),
                  schema: text(row.schema ?? "", "参数Schema", 512000),
                }),
              ),
              "id",
              "参数ID",
            );
            const paramKeys = parameters
              .filter((row) => row.location !== "query")
              .map(
                (row) =>
                  `${row.location}:${row.location === "header" ? row.name.toLowerCase() : row.name}`,
              );
            if (new Set(paramKeys).size !== paramKeys.length)
              fail("同位置的非Query参数名称不能重复。");
            for (const parameter of parameters)
              parseApiSchema(parameter.schema);
            const auth = endpoint.auth;
            if (!object(auth)) fail("鉴权配置无效。");
            const responses = unique(
              list(endpoint.responses, 20, "响应定义").map((row) => {
                if (!/^(?:[1-5][0-9]{2}|[1-5]XX|default)$/.test(row.status))
                  fail("响应状态应为100–599、2XX等范围或default。");
                parseApiSchema(row.schema);
                return {
                  id: id(row.id),
                  status: row.status,
                  description: text(row.description, "响应说明"),
                  contentType: text(row.contentType, "响应类型", 200),
                  schema: row.schema,
                  example: text(row.example, "响应示例", 2_000_000),
                };
              }),
              "status",
              "响应状态",
            );
            unique(responses, "id", "响应ID");
            const path = text(endpoint.path, "接口路径", 4000, true).trim();
            if (!path.startsWith("/") || /[?#\r\n]/.test(path))
              fail("接口路径需要以/开头，Query请在参数表中定义。");
            parseApiSchema(endpoint.requestSchema);
            return {
              id: id(endpoint.id),
              name: text(endpoint.name, "接口名称", 100, true).trim(),
              group,
              description: text(endpoint.description, "接口说明", 12000),
              method: choice(endpoint.method, API_METHODS, "请求方法"),
              path,
              server: text(endpoint.server ?? "", "接口服务地址", 4000),
              timeout,
              parameters,
              auth: {
                type: choice(
                  auth.type,
                  ["none", "bearer", "basic", "apiKey"],
                  "鉴权类型",
                ),
                token: text(auth.token, "Token", 12000),
                username: text(auth.username, "用户名", 2000),
                password: text(auth.password, "密码", 12000),
                key: text(auth.key, "鉴权键名", 200),
                value: text(auth.value, "鉴权值", 12000),
                location: choice(
                  auth.location,
                  ["header", "query"],
                  "鉴权位置",
                ),
              },
              bodyKind: choice(
                endpoint.bodyKind,
                ["none", "json", "text", "form"],
                "正文类型",
              ),
              body: text(endpoint.body, "请求正文", 2_000_000),
              requestSchema: endpoint.requestSchema,
              responses,
            };
          },
        ),
        "id",
        "接口ID",
      );
      const operations = endpoints.map(
        (item) => `${item.method} ${item.path.replace(/\{[^{}]+\}/g, "{}")}`,
      );
      if (new Set(operations).size !== operations.length)
        fail("同一项目内HTTP方法和路径不能重复（路径变量名不区分）。");
      return {
        id: id(project.id),
        name: text(project.name, "项目名称", 100, true).trim(),
        description: text(project.description, "项目说明", 12000),
        baseUrl: text(project.baseUrl, "服务地址", 4000),
        version: text(project.version ?? "1.0.0", "文档版本", 100, true),
        groups,
        environments,
        endpoints,
      };
    }),
    "id",
    "项目ID",
  );
  unique(projects, "name", "API项目名称");
  const result = { schemaVersion: 1, revision: input.revision, projects };
  if (JSON.stringify(result).length > API_LIMITS.bytes)
    fail("API工作区超过16MB。");
  return result;
}
export function newApiEndpoint(id, group = "") {
  return {
    id,
    name: "新接口",
    group,
    description: "",
    method: "GET",
    path: "/new-endpoint",
    server: "",
    timeout: 15000,
    parameters: [],
    auth: {
      type: "none",
      token: "",
      username: "",
      password: "",
      key: "X-API-Key",
      value: "",
      location: "header",
    },
    bodyKind: "none",
    body: "",
    requestSchema: "",
    responses: [
      {
        id: `${id}_ok`,
        status: "200",
        description: "成功",
        contentType: "application/json",
        schema: "",
        example: "",
      },
    ],
  };
}
