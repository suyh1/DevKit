import { basicAuthorization } from "./http-builder";
import { parseHttpConfig } from "./http-model";
import {
  parseApiSchema,
  validateApiState,
  initialApiState,
} from "../shared/api-workspace.mjs";
import type {
  ApiEndpoint,
  ApiProject,
  ApiEnvironment,
  ApiParameter,
} from "../shared/api-workspace.mjs";
import type { HttpInput, HttpResponse } from "./http-model";

export function apiVariables(
  project: ApiProject,
  environment?: ApiEnvironment,
) {
  const values = new Map<string, string>([
    ["baseUrl", environment?.baseUrl || project.baseUrl],
  ]);
  for (const row of environment?.variables ?? [])
    if (row.enabled) values.set(row.key, row.value);
  return values;
}
export function fillApiVariables(text: string, values: Map<string, string>) {
  const missing = new Set<string>();
  const result = text.replace(
    /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
    (_, key: string) => {
      if (!values.has(key)) {
        missing.add(key);
        return "";
      }
      return values.get(key)!;
    },
  );
  if (missing.size) throw new Error(`缺少环境变量：${[...missing].join("、")}`);
  if (/\{\{|\}\}/.test(result))
    throw new Error("变量未完全解析；不支持嵌套变量或不合法的变量名。");
  return result;
}
export function fillApiJson(text: string, values: Map<string, string>) {
  JSON.parse(text);
  return text.replace(/"(?:[^"\\]|\\.)*"/g, (token) =>
    JSON.stringify(fillApiVariables(JSON.parse(token), values)),
  );
}
function typedValue(row: ApiParameter, value: string): unknown {
  if (row.type === "string") return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`参数“${row.name}”需要有效的${row.type}值。`);
  }
  const okay =
    row.type === "integer"
      ? typeof parsed === "number" && Number.isSafeInteger(parsed)
      : row.type === "number"
        ? typeof parsed === "number" && Number.isFinite(parsed)
        : row.type === "array"
          ? Array.isArray(parsed)
          : row.type === "object"
            ? parsed !== null &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            : typeof parsed === "boolean";
  if (!okay) throw new Error(`参数“${row.name}”的值与${row.type}类型不符。`);
  return parsed;
}
const scalar = (value: unknown): string =>
  typeof value === "string" ? value : JSON.stringify(value);
function simple(value: unknown) {
  return Array.isArray(value)
    ? value.map(scalar).join(",")
    : value && typeof value === "object"
      ? Object.entries(value)
          .flatMap(([key, value]) => [key, scalar(value)])
          .join(",")
      : scalar(value);
}
export function buildApiRequest(
  project: ApiProject,
  endpoint: ApiEndpoint,
  environment?: ApiEnvironment,
  timeout = endpoint.timeout ?? 15000,
): HttpInput {
  validateApiState({
    ...initialApiState(),
    projects: [{ ...project, endpoints: [endpoint] }],
  });
  const values = apiVariables(project, environment),
    fill = (value: string) => fillApiVariables(value, values);
  let base = fill(endpoint.server || values.get("baseUrl") || "").replace(
    /\/+$/,
    "",
  );
  if (!base) throw new Error("请在项目或当前环境中填写服务地址。");
  const parsedBase = new URL(base);
  if (parsedBase.search || parsedBase.hash)
    throw new Error("服务地址不能包含Query或锚点。");
  let pathname = endpoint.path;
  const query = new URLSearchParams(),
    headers: Record<string, string> = Object.create(null),
    cookies: string[] = [];
  for (const row of endpoint.parameters) {
    if (!row.enabled) {
      if (row.location === "path")
        throw new Error(`路径参数“${row.name}”必须启用。`);
      continue;
    }
    const value = fill(row.example);
    if (row.required && !value.trim())
      throw new Error(`必填参数“${row.name}”没有填写值。`);
    if (!value && !row.required && row.type !== "string") continue;
    const typed = typedValue(row, value);
    if (row.location === "path")
      pathname = pathname.replaceAll(
        `{${row.name}}`,
        encodeURIComponent(simple(typed)),
      );
    else if (row.location === "query") {
      if (Array.isArray(typed))
        typed.forEach((item) => query.append(row.name, scalar(item)));
      else if (typed && typeof typed === "object")
        Object.entries(typed).forEach(([key, value]) =>
          query.append(key, scalar(value)),
        );
      else query.append(row.name, String(typed));
    } else if (row.location === "header") headers[row.name] = simple(typed);
    else
      cookies.push(
        `${encodeURIComponent(row.name)}=${encodeURIComponent(simple(typed))}`,
      );
  }
  if (/\{[^{}]*\}/.test(pathname))
    throw new Error("接口路径包含未填写的路径参数。");
  const url = new URL(base + pathname);
  for (const [key, value] of query) url.searchParams.append(key, value);
  if (cookies.length) {
    if (Object.keys(headers).some((key) => key.toLowerCase() === "cookie"))
      throw new Error("Cookie参数与Cookie请求头重复，请保留一种定义。");
    headers.Cookie = cookies.join("; ");
  }
  const setAuth = (key: string, value: string) => {
    if (
      Object.keys(headers).some(
        (name) => name.toLowerCase() === key.toLowerCase(),
      )
    )
      throw new Error(`鉴权与请求头${key}重复，请保留一种定义。`);
    headers[key] = value;
  };
  if (endpoint.auth.type === "bearer") {
    const token = fill(endpoint.auth.token);
    if (!token.trim()) throw new Error("Bearer Token为空。");
    setAuth("Authorization", `Bearer ${token}`);
  }
  if (endpoint.auth.type === "basic")
    setAuth(
      "Authorization",
      basicAuthorization(
        fill(endpoint.auth.username),
        fill(endpoint.auth.password),
      ),
    );
  if (endpoint.auth.type === "apiKey") {
    const key = fill(endpoint.auth.key),
      value = fill(endpoint.auth.value);
    if (!key.trim() || !value) throw new Error("API Key名称和值不能为空。");
    if (endpoint.auth.location === "header") setAuth(key, value);
    else {
      if (url.searchParams.has(key))
        throw new Error("API Key与Query参数重复。");
      url.searchParams.append(key, value);
    }
  }
  const body =
    endpoint.bodyKind === "none"
      ? ""
      : endpoint.bodyKind === "json"
        ? fillApiJson(endpoint.body || "{}", values)
        : endpoint.bodyKind === "form"
          ? new URLSearchParams(
              [...new URLSearchParams(endpoint.body)].map(([key, value]) => [
                fill(key),
                fill(value),
              ]),
            ).toString()
          : fill(endpoint.body);
  if (body && ["GET", "HEAD"].includes(endpoint.method))
    throw new Error("GET/HEAD不支持非空请求正文。");
  if (
    body &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")
  )
    headers["Content-Type"] = {
      json: "application/json",
      text: "text/plain",
      form: "application/x-www-form-urlencoded",
    }[endpoint.bodyKind as "json" | "text" | "form"];
  return parseHttpConfig(
    JSON.stringify({
      method: endpoint.method,
      url: url.href,
      headers,
      ...(body ? { body } : {}),
    }),
    timeout,
  );
}
export type ApiCheck = {
  name: string;
  state: "pass" | "fail" | "skip";
  detail: string;
};
export function responseContract(
  endpoint: ApiEndpoint,
  response: HttpResponse,
): {
  checks: ApiCheck[];
  schema: ReturnType<typeof parseApiSchema>;
  body: string;
} {
  const rule =
    endpoint.responses.find((row) => row.status === String(response.status)) ||
    endpoint.responses.find(
      (row) => row.status === `${Math.floor(response.status / 100)}XX`,
    ) ||
    endpoint.responses.find((row) => row.status === "default");
  const checks: ApiCheck[] = [
    {
      name: "响应状态",
      state: !endpoint.responses.length ? "skip" : rule ? "pass" : "fail",
      detail: rule
        ? `匹配 ${rule.status} · ${rule.description}`
        : `收到 ${response.status}，没有匹配的响应定义`,
    },
  ];
  const actualType =
    response.headers
      .find(([key]) => key.toLowerCase() === "content-type")?.[1]
      .split(";")[0]
      .trim()
      .toLowerCase() || "";
  if (rule?.contentType) {
    const expected = rule.contentType.split(";")[0].trim().toLowerCase();
    const matches =
      !!actualType &&
      (expected === "*/*" ||
        (expected.endsWith("/*") &&
          actualType.startsWith(expected.slice(0, -1))) ||
        actualType === expected);
    checks.push({
      name: "Content-Type",
      state: matches ? "pass" : "fail",
      detail: `期望 ${rule.contentType}，收到 ${actualType || "未提供"}`,
    });
  }
  return {
    checks,
    schema: rule ? parseApiSchema(rule.schema) : null,
    body: /json/i.test(actualType || rule?.contentType || "")
      ? response.body
      : JSON.stringify(response.body),
  };
}
function runSchemaWorker(payload: unknown): Promise<ApiCheck> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("./api-validation.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      resolve({
        name: "JSON Schema",
        state: "skip",
        detail: "校验Worker无法启动，未判定为通过。",
      });
      return;
    }
    const done = (result: ApiCheck) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        done({
          name: "JSON Schema",
          state: "skip",
          detail: "校验超过2秒，已终止；未判定为通过。",
        }),
      2000,
    );
    worker.onmessage = (event) => done(event.data);
    worker.onerror = () =>
      done({
        name: "JSON Schema",
        state: "skip",
        detail: "校验器运行失败，未判定为通过。",
      });
    worker.postMessage(payload);
  });
}
export const validateResponseSchema = (
  schema: Record<string, unknown> | boolean,
  body: string,
) => runSchemaWorker({ schema, body });
export function validateRequestSchemas(
  project: ApiProject,
  endpoint: ApiEndpoint,
  environment: ApiEnvironment | undefined,
  body: string,
): Promise<ApiCheck> {
  const values = apiVariables(project, environment);
  const checks = endpoint.parameters
    .filter(
      (row) =>
        row.enabled &&
        row.schema.trim() &&
        (row.required ||
          row.type === "string" ||
          fillApiVariables(row.example, values) !== ""),
    )
    .map((row) => {
      const value = fillApiVariables(row.example, values);
      return {
        name: `参数 ${row.name}`,
        schema: parseApiSchema(row.schema),
        body: row.type === "string" ? JSON.stringify(value) : value,
      };
    });
  if (endpoint.requestSchema.trim() && body)
    checks.push({
      name: "请求正文",
      schema: parseApiSchema(endpoint.requestSchema),
      body: requestSchemaBody(endpoint, body),
    });
  return checks.length
    ? runSchemaWorker({ checks })
    : Promise.resolve({
        name: "请求Schema",
        state: "pass",
        detail: "未配置请求Schema，已完成参数必填及基本类型检查。",
      });
}
export function requestSchemaBody(endpoint: ApiEndpoint, body: string): string {
  if (endpoint.bodyKind === "json") return body;
  if (endpoint.bodyKind === "form") {
    const schema = parseApiSchema(endpoint.requestSchema);
    const properties =
      typeof schema === "object" && schema
        ? (schema.properties as Record<string, { type?: string }> | undefined)
        : undefined;
    const values: Record<string, unknown> = Object.create(null);
    for (const [key, value] of new URLSearchParams(body)) {
      let typed: unknown = value;
      if (
        ["integer", "number", "boolean"].includes(properties?.[key]?.type || "")
      ) {
        try {
          typed = JSON.parse(value);
        } catch {
          /* validator reports the type mismatch */
        }
      }
      values[key] = Object.hasOwn(values, key)
        ? Array.isArray(values[key])
          ? [...(values[key] as unknown[]), typed]
          : [values[key], typed]
        : typed;
    }
    return JSON.stringify(values);
  }
  return JSON.stringify(body);
}
export function schemaFromExample(
  value: unknown,
  depth = 0,
): Record<string, unknown> {
  if (depth > 12) return {};
  if (value === null) return { type: "null" };
  if (Array.isArray(value))
    return {
      type: "array",
      items: value.length ? schemaFromExample(value[0], depth + 1) : {},
    };
  if (typeof value === "object")
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(value)
          .slice(0, 200)
          .map(([key, value]) => [key, schemaFromExample(value, depth + 1)]),
      ),
    };
  return {
    type:
      typeof value === "number" && Number.isInteger(value)
        ? "integer"
        : typeof value,
  };
}
