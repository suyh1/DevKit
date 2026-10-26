import { parseDocument } from "yaml";
import {
  newApiEndpoint,
  validateApiState,
  initialApiState,
} from "../shared/api-workspace.mjs";
import type { ApiProject, ApiParameter } from "../shared/api-workspace.mjs";
import { readHttpCollection, parseHttpConfig } from "./http-model";
import { schemaFromExample } from "./api-request";
const uid = () => crypto.randomUUID();
type Node = Record<string, any>;
const object = (value: unknown): value is Node =>
  !!value && typeof value === "object" && !Array.isArray(value);
const json = (value: unknown) =>
  value === undefined ? "" : JSON.stringify(value, null, 2);
function parsed(text: string): Node {
  if (text.length > 8_000_000) throw new Error("导入文件超过8MB。");
  const doc = parseDocument(text, { uniqueKeys: true, version: "1.2" });
  if (doc.errors.length) throw new Error(doc.errors[0].message);
  const value: unknown = doc.toJS({ maxAliasCount: 100 });
  if (!object(value)) throw new Error("文件根节点必须是对象。");
  // Bound traversal and explicitly require an offline self-contained specification.
  const stack: { value: unknown; depth: number; path: (string | number)[] }[] =
    [{ value, depth: 0, path: [] }];
  let nodes = 0;
  while (stack.length) {
    const row = stack.pop()!;
    if (++nodes > 100000 || row.depth > 80)
      throw new Error("导入文档过于复杂。");
    if (
      object(row.value) &&
      typeof row.value.$ref === "string" &&
      !row.value.$ref.startsWith("#/")
    )
      throw new Error(
        `外部引用无法离线解析：${row.value.$ref}。请先将引用打包到同一个文档。`,
      );
    if (
      object(row.value) &&
      Object.hasOwn(row.value, "example") &&
      text.trimStart().startsWith("{")
    ) {
      const node = doc.getIn([...row.path, "example"], true) as
        { range?: [number, number, number] } | undefined;
      if (node?.range)
        row.value["x-devkit-raw-example"] = text.slice(
          node.range[0],
          node.range[1],
        );
    }
    if (row.value && typeof row.value === "object")
      for (const [key, child] of Object.entries(row.value))
        stack.push({
          value: child,
          depth: row.depth + 1,
          path: [...row.path, Array.isArray(row.value) ? Number(key) : key],
        });
  }
  return value;
}
function pointer(root: Node, ref: string): Node {
  let value: unknown = root;
  for (const key of ref
    .slice(2)
    .split("/")
    .map((key) =>
      decodeURIComponent(key).replaceAll("~1", "/").replaceAll("~0", "~"),
    )) {
    if (
      (!object(value) && !Array.isArray(value)) ||
      !Object.hasOwn(value!, key)
    )
      throw new Error(`引用不存在：${ref}`);
    value = (value as Node)[key];
  }
  if (!object(value)) throw new Error(`引用不是对象：${ref}`);
  return value;
}
function resolved(root: Node, value: Node): Node {
  const seen = new Set<string>();
  while (value?.$ref) {
    if (seen.has(value.$ref)) throw new Error("非Schema对象出现循环引用。");
    seen.add(value.$ref);
    value = {
      ...pointer(root, value.$ref),
      ...Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "$ref"),
      ),
    };
  }
  if (!object(value)) throw new Error("接口定义对象无效。");
  return value;
}
export function bundleApiSchema(schema: unknown, root: Node): string {
  if (schema === undefined) return "";
  const definitions: Node = Object.create(null),
    refs = new Map<string, string>();
  function visit(value: any, depth = 0): any {
    if (depth > 64) throw new Error("Schema嵌套超过64层。");
    if (Array.isArray(value))
      return value.map((item) => visit(item, depth + 1));
    if (!object(value)) return value;
    const result = Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "$ref")
        .map(([key, value]) => [key, visit(value, depth + 1)]),
    );
    // OpenAPI 3.0 nullable is normalized to JSON Schema without changing the source document.
    if (result.nullable === true && typeof result.type === "string")
      result.type = [result.type, "null"];
    delete result.nullable;
    for (const [exclusive, inclusive] of [
      ["exclusiveMinimum", "minimum"],
      ["exclusiveMaximum", "maximum"],
    ]) {
      if (typeof result[exclusive] === "boolean") {
        if (result[exclusive] && typeof result[inclusive] === "number") {
          result[exclusive] = result[inclusive];
          delete result[inclusive];
        } else delete result[exclusive];
      }
    }
    if (value.$ref) {
      if (!value.$ref.startsWith("#/"))
        throw new Error("Schema包含外部引用，无法离线导入。");
      let name = refs.get(value.$ref);
      if (!name) {
        name = `ref${refs.size}`;
        refs.set(value.$ref, name);
        definitions[name] = {};
        definitions[name] = visit(pointer(root, value.$ref), depth + 1);
      }
      result.$ref = `#/$defs/${name}`;
    }
    return result;
  }
  const result = visit(schema);
  return json(
    Object.keys(definitions).length
      ? { ...result, $defs: { ...result.$defs, ...definitions } }
      : result,
  );
}
function parameter(root: Node, input: Node): ApiParameter {
  const row = resolved(root, input),
    schema = resolved(root, row.schema ?? row);
  if (!["path", "query", "header", "cookie"].includes(row.in))
    throw new Error(`不支持参数位置：${row.in}`);
  const expected =
    row.in === "query"
      ? ["form", true]
      : row.in === "cookie"
        ? ["form", false]
        : ["simple", false];
  if (
    (row.style && row.style !== expected[0]) ||
    (row.explode !== undefined &&
      row.explode !== expected[1] &&
      ["array", "object"].includes(schema.type))
  )
    throw new Error(
      `参数${row.name}的序列化方式尚不支持，请改用${expected[0]} / explode=${expected[1]}。`,
    );
  const sample =
    row.example ??
    schema.example ??
    schema.default ??
    row.examples?.[Object.keys(row.examples || {})[0]]?.value ??
    "";
  return {
    id: uid(),
    name: row.name,
    location: row.in,
    type: ["integer", "number", "boolean", "array", "object"].includes(
      schema.type,
    )
      ? schema.type
      : "string",
    required: row.in === "path" || !!row.required,
    enabled: row["x-devkit-enabled"] !== false,
    description: row.description || "",
    example: typeof sample === "string" ? sample : JSON.stringify(sample),
    schema: bundleApiSchema(
      row.schema ??
        Object.fromEntries(
          Object.entries(row).filter(([key]) =>
            ["type", "items", "enum", "format", "default"].includes(key),
          ),
        ),
      root,
    ),
  };
}
export function newApiProject(name = "新API项目"): ApiProject {
  return {
    id: uid(),
    name,
    description: "",
    baseUrl: "http://127.0.0.1:8080",
    version: "1.0.0",
    groups: [],
    environments: [],
    endpoints: [],
  };
}
function checked(project: ApiProject) {
  return validateApiState({ ...initialApiState(), projects: [project] })
    .projects[0];
}
function fromOpenApi(root: Node): { project: ApiProject; warnings: string[] } {
  if (!/^3\.[01]\./.test(root.openapi || "") && root.swagger !== "2.0")
    throw new Error("支持OpenAPI 3.0/3.1或Swagger 2.0。");
  if (!object(root.paths)) throw new Error("OpenAPI文档缺少paths对象。");
  const project = newApiProject(root.info?.title || "导入API项目"),
    warnings: string[] = [];
  project.description = root.info?.description || "";
  project.version = String(root.info?.version || "1.0.0");
  const serverUrl = (server: Node) =>
    String(server.url).replace(/\{([^{}]+)\}/g, (_, name: string) => {
      if (server.variables?.[name]?.default === undefined)
        throw new Error("服务器变量缺少默认值：" + name);
      return String(server.variables[name].default);
    });
  project.baseUrl =
    (root.servers?.[0] ? serverUrl(root.servers[0]) : "") ||
    (root.host
      ? `${root.schemes?.[0] || "https"}://${root.host}${root.basePath || ""}`
      : "");
  for (const server of root.servers?.slice(1) || [])
    project.environments.push({
      id: uid(),
      name: `服务 ${project.environments.length + 2}`,
      baseUrl: serverUrl(server),
      variables: [],
    });
  for (const [path, pathInput] of Object.entries(root.paths)) {
    if (path.startsWith("x-")) continue;
    const item = resolved(root, pathInput as Node);
    if (item.trace)
      throw new Error(
        `${path}包含当前传输层不支持的TRACE方法；导入未写入数据。`,
      );
    for (const method of [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options",
    ]) {
      const operation = item[method];
      if (!operation) continue;
      const endpoint = newApiEndpoint(uid(), operation.tags?.[0] || "");
      if (endpoint.group && !project.groups.includes(endpoint.group))
        project.groups.push(endpoint.group);
      endpoint.name =
        operation.summary ||
        operation.operationId ||
        `${method.toUpperCase()} ${path}`;
      endpoint.timeout = operation["x-devkit-timeout"] ?? 15000;
      endpoint.description = operation.description || "";
      if (operation.tags?.length > 1)
        warnings.push(`${endpoint.name}：按首个tag组织目录，其余tag未转换。`);
      endpoint.method = method.toUpperCase();
      endpoint.path = path;
      endpoint.server = operation.servers?.[0]
        ? serverUrl(operation.servers[0])
        : item.servers?.[0]
          ? serverUrl(item.servers[0])
          : "";
      if (operation.deprecated)
        (warnings.push(
          `${endpoint.name}：原文标记为deprecated，已在说明中保留。`,
        ),
          (endpoint.description += "\n[已弃用]"));
      if (operation.callbacks || operation["x-codeSamples"])
        warnings.push(
          `${endpoint.name}：callbacks/自定义代码示例仅存在原文件，未转换。`,
        );
      const merged = new Map<string, Node>();
      for (const raw of [
        ...(item.parameters || []),
        ...(operation.parameters || []),
      ]) {
        const row = resolved(root, raw);
        merged.set(`${row.in}:${row.name}`, row);
      }
      for (const row of merged.values()) {
        if (row.in === "body") {
          endpoint.bodyKind = "json";
          endpoint.requestSchema = bundleApiSchema(row.schema, root);
          endpoint.body = json(row.schema?.example ?? {});
        } else if (row.in === "formData")
          throw new Error(
            "Swagger formData/multipart请先转换为OpenAPI文本正文定义。",
          );
        else endpoint.parameters.push(parameter(root, row));
      }
      if (operation.requestBody) {
        const body = resolved(root, operation.requestBody),
          contents = body.content || {},
          media = Object.keys(contents)[0];
        if (!media)
          throw new Error(`${endpoint.name}的requestBody没有content。`);
        if (media.includes("multipart") || media === "application/octet-stream")
          throw new Error(
            `${endpoint.name}包含文件/二进制正文；当前导入不支持此类型，原工作区未改动。`,
          );
        const def = contents[media];
        endpoint.bodyKind = media.includes("json")
          ? "json"
          : media.includes("x-www-form-urlencoded")
            ? "form"
            : "text";
        endpoint.requestSchema = bundleApiSchema(def.schema, root);
        const sample =
          def.example ??
          def.examples?.[Object.keys(def.examples || {})[0]]?.value ??
          (endpoint.bodyKind === "json" ? {} : "");
        endpoint.body =
          def["x-devkit-raw-example"] && endpoint.bodyKind === "json"
            ? def["x-devkit-raw-example"]
            : typeof sample === "string"
              ? sample
              : json(sample);
        endpoint.parameters.push({
          id: uid(),
          name: "Content-Type",
          location: "header",
          type: "string",
          required: false,
          enabled: true,
          description: "",
          example: media,
          schema: "",
        });
        if (Object.keys(contents).length > 1)
          warnings.push(`${endpoint.name}：多种请求媒体类型，已选择${media}。`);
      }
      endpoint.responses = [];
      for (const [status, raw] of Object.entries(operation.responses || {})) {
        if (status.startsWith("x-")) continue;
        const response = resolved(root, raw as Node),
          media =
            Object.keys(response.content || {})[0] ||
            (response.schema ? "application/json" : "");
        const def = response.content?.[media] || response;
        endpoint.responses.push({
          id: uid(),
          status,
          description: response.description || "",
          contentType: media,
          schema: bundleApiSchema(def.schema, root),
          example:
            def["x-devkit-raw-example"] ||
            json(
              def.example ??
                def.examples?.[Object.keys(def.examples || {})[0]]?.value,
            ),
        });
      }
      const requirements = operation.security ?? root.security ?? [];
      if (requirements.length) {
        const first = requirements[0];
        const keys = Object.keys(first);
        if (keys.length > 1)
          throw new Error(
            `${endpoint.name}需要多种同时鉴权；请转成显式请求头后导入。`,
          );
        const scheme = resolved(
          root,
          root.components?.securitySchemes?.[keys[0]] ||
            root.securityDefinitions?.[keys[0]] ||
            {},
        );
        if (scheme.type === "http" && scheme.scheme?.toLowerCase() === "bearer")
          ((endpoint.auth.type = "bearer"),
            (endpoint.auth.token = "{{token}}"));
        else if (
          scheme.type === "basic" ||
          (scheme.type === "http" && scheme.scheme?.toLowerCase() === "basic")
        )
          ((endpoint.auth.type = "basic"),
            (endpoint.auth.username = "{{username}}"),
            (endpoint.auth.password = "{{password}}"));
        else if (
          scheme.type === "apiKey" &&
          ["header", "query"].includes(scheme.in)
        )
          ((endpoint.auth.type = "apiKey"),
            (endpoint.auth.key = scheme.name),
            (endpoint.auth.location = scheme.in),
            (endpoint.auth.value = "{{apiKey}}"));
        else if (scheme.type === "oauth2" || scheme.type === "openIdConnect")
          ((endpoint.auth.type = "bearer"),
            (endpoint.auth.token = "{{accessToken}}"),
            warnings.push(
              `${endpoint.name}：需在环境中手动提供accessToken，不自动执行授权或登录。`,
            ));
        else if (keys.length)
          warnings.push(
            `${endpoint.name}：${scheme.type || "未知"}鉴权需手动填写请求头；未执行授权流程。`,
          );
        if (requirements.length > 1)
          warnings.push(`${endpoint.name}：多个可选鉴权已选第一种。`);
      }
      project.endpoints.push(endpoint);
    }
  }
  if (!project.baseUrl)
    warnings.push("原文没有绝对服务地址，请在项目设置或环境中填写后再发送。");
  return { project: checked(project), warnings };
}
function fromRequests(entries: { name: string; config: string }[]): ApiProject {
  const project = newApiProject("请求集合");
  const operations = new Set<string>();
  for (const entry of entries) {
    const input = parseHttpConfig(entry.config),
      url = new URL(input.url),
      endpoint = newApiEndpoint(uid());
    if (!project.endpoints.length) project.baseUrl = url.origin;
    endpoint.server = url.origin === project.baseUrl ? "" : url.origin;
    endpoint.name = entry.name;
    endpoint.method = input.method;
    endpoint.path = url.pathname;
    if (operations.has(`${endpoint.method} ${endpoint.path}`))
      throw new Error(
        `集合存在重复接口${endpoint.method} ${endpoint.path}，请先整理不同请求场景。`,
      );
    operations.add(`${endpoint.method} ${endpoint.path}`);
    endpoint.parameters = [...url.searchParams].map(([name, example]) => ({
      id: uid(),
      name,
      example,
      location: "query",
      type: "string",
      required: false,
      enabled: true,
      description: "",
      schema: "",
    }));
    for (const [name, example] of Object.entries(input.headers))
      endpoint.parameters.push({
        id: uid(),
        name,
        example,
        location: "header",
        type: "string",
        required: false,
        enabled: true,
        description: "",
        schema: "",
      });
    if (input.body) {
      endpoint.body = input.body;
      try {
        const value = JSON.parse(input.body);
        endpoint.bodyKind = "json";
        endpoint.requestSchema = json(schemaFromExample(value));
      } catch {
        endpoint.bodyKind = "text";
      }
    }
    project.endpoints.push(endpoint);
  }
  return checked(project);
}
export function importApiProject(text: string): {
  project: ApiProject;
  warnings: string[];
} {
  const root = parsed(text);
  if (root.format === "devkit-api-project" && root.version === 1)
    return { project: checked({ ...root.project, id: uid() }), warnings: [] };
  if (root.format === "devkit-http-collection")
    return {
      project: fromRequests(readHttpCollection(text)),
      warnings: ["已按原集合保存的内容导入；原来已排除的正文与鉴权不会恢复。"],
    };
  if (root.info?.schema?.includes("schema.getpostman.com")) {
    const entries: { name: string; config: string }[] = [];
    const visit = (items: Node[], prefix = "") => {
      for (const item of items) {
        if (item.item) {
          visit(item.item, prefix + item.name + "/");
          continue;
        }
        const request = item.request;
        if (!request) continue;
        const url =
          typeof request.url === "string" ? request.url : request.url?.raw;
        if (!url) throw new Error("Postman请求缺少URL。");
        if (request.body && !["raw", "urlencoded"].includes(request.body.mode))
          throw new Error(
            "Postman文件/GraphQL正文尚不支持转换，请先转为文本请求。",
          );
        if (request.auth && request.auth.type !== "noauth")
          throw new Error(
            "Postman鉴权请先转换为显式请求头后导入，避免丢失继承鉴权。",
          );
        const headers = Object.fromEntries(
          (request.header || [])
            .filter((row: Node) => !row.disabled)
            .map((row: Node) => [row.key, row.value]),
        );
        const body =
          request.body?.mode === "urlencoded"
            ? new URLSearchParams(
                request.body.urlencoded
                  .filter((row: Node) => !row.disabled)
                  .map((row: Node) => [row.key, row.value]),
              ).toString()
            : request.body?.raw;
        entries.push({
          name: prefix + item.name,
          config: JSON.stringify({
            method: request.method,
            url,
            headers,
            ...(body ? { body } : {}),
          }),
        });
      }
    };
    if (root.auth || root.variable?.length)
      throw new Error(
        "Postman集合含继承鉴权或变量，请先在Postman中解析为完整请求后导入。",
      );
    visit(root.item || []);
    return {
      project: fromRequests(entries),
      warnings: ["Postman请求已转换；脚本与自动测试未导入，也不会执行。"],
    };
  }
  return fromOpenApi(root);
}
export function exportOpenApi(project: ApiProject): string {
  const paths: Node = Object.create(null),
    schemes: Node = Object.create(null),
    schemas: Node = Object.create(null);
  const rawExamples = new Map<string, string>();
  const rawExample = (value: string) => {
    try {
      JSON.parse(value);
      const key = "devkit_raw_" + uid();
      rawExamples.set(key, value);
      return key;
    } catch {
      return value;
    }
  };
  const exportedSchema = (raw: string) => {
    const key = "schema" + Object.keys(schemas).length;
    const source = JSON.parse(raw);
    const rewrite = (value: any): any =>
      Array.isArray(value)
        ? value.map(rewrite)
        : object(value)
          ? Object.fromEntries(
              Object.entries(value).map(([name, child]) => [
                name,
                name === "$ref" &&
                typeof child === "string" &&
                child.startsWith("#")
                  ? "#/components/schemas/" + key + child.slice(1)
                  : rewrite(child),
              ]),
            )
          : value;
    schemas[key] = rewrite(source);
    return { $ref: "#/components/schemas/" + key };
  };
  for (const endpoint of project.endpoints) {
    const operation: Node = {
      operationId: endpoint.id,
      "x-devkit-timeout": endpoint.timeout,
      summary: endpoint.name,
      description: endpoint.description,
      ...(endpoint.group ? { tags: [endpoint.group] } : {}),
      parameters: [],
      responses: {},
    };
    for (const row of endpoint.parameters) {
      const schema = row.schema
        ? exportedSchema(row.schema)
        : { type: row.type };
      operation.parameters.push({
        name: row.name,
        in: row.location,
        description: row.description,
        required: row.location === "path" || row.required,
        "x-devkit-enabled": row.enabled,
        schema,
        example: row.example,
        style: ["query", "cookie"].includes(row.location) ? "form" : "simple",
        explode: row.location === "query",
      });
    }
    if (endpoint.server) operation.servers = [{ url: endpoint.server }];
    if (endpoint.bodyKind !== "none") {
      const media = {
        json: "application/json",
        text: "text/plain",
        form: "application/x-www-form-urlencoded",
      }[endpoint.bodyKind];
      let example: unknown = endpoint.body;
      try {
        if (endpoint.bodyKind === "json") example = rawExample(endpoint.body);
      } catch {
        /* A draft example may be incomplete. */
      }
      operation.requestBody = {
        content: {
          [media]: {
            schema: endpoint.requestSchema
              ? exportedSchema(endpoint.requestSchema)
              : {},
            example,
          },
        },
      };
    }
    for (const row of endpoint.responses)
      operation.responses[row.status] = {
        description: row.description,
        ...(row.contentType
          ? {
              content: {
                [row.contentType]: {
                  ...(row.schema ? { schema: exportedSchema(row.schema) } : {}),
                  ...(row.example ? { example: rawExample(row.example) } : {}),
                },
              },
            }
          : {}),
      };
    if (!Object.keys(operation.responses).length)
      operation.responses.default = { description: "未定义响应" };
    const auth = endpoint.auth,
      key = `auth_${endpoint.id}`;
    if (auth.type !== "none") {
      schemes[key] =
        auth.type === "apiKey"
          ? { type: "apiKey", name: auth.key, in: auth.location }
          : {
              type: "http",
              scheme: auth.type === "bearer" ? "bearer" : "basic",
            };
      operation.security = [{ [key]: [] }];
    }
    paths[endpoint.path] ??= {};
    paths[endpoint.path][endpoint.method.toLowerCase()] = operation;
  }
  let output = json({
    openapi: "3.1.0",
    info: {
      title: project.name,
      description: project.description,
      version: project.version,
    },
    servers: project.baseUrl ? [{ url: project.baseUrl }] : [],
    paths,
    ...(Object.keys(schemes).length || Object.keys(schemas).length
      ? {
          components: {
            ...(Object.keys(schemes).length
              ? { securitySchemes: schemes }
              : {}),
            ...(Object.keys(schemas).length ? { schemas } : {}),
          },
        }
      : {}),
  });
  for (const [key, raw] of rawExamples)
    output = output.replace(JSON.stringify(key), raw);
  return output;
}
export const exportApiProject = (project: ApiProject) =>
  json({ format: "devkit-api-project", version: 1, project });

export function exportApiMarkdown(project: ApiProject): string {
  const escape = (text: string) =>
    text.replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
  const code = (text: string, language = "json") => {
    const longest = Math.max(
      2,
      ...[...text.matchAll(/`+/g)].map((match) => match[0].length),
    );
    const fence = "`".repeat(longest + 1);
    return `${fence}${language}\n${text}\n${fence}`;
  };
  const sections = [
    `# ${project.name}`,
    project.description,
    `服务地址：${project.baseUrl || "未设置"}`,
  ];
  for (const endpoint of project.endpoints) {
    sections.push(
      `## ${endpoint.method} ${endpoint.path} — ${endpoint.name}`,
      endpoint.description,
      `目录：${endpoint.group || "未分组"} · 鉴权：${endpoint.auth.type}`,
    );
    if (endpoint.parameters.length)
      sections.push(
        "### 参数",
        "| 名称 | 位置 | 类型 | 必填 | 说明 | 示例 |\n| --- | --- | --- | --- | --- | --- |\n" +
          endpoint.parameters
            .map(
              (row) =>
                `| ${escape(row.name)} | ${row.location}${row.enabled ? "" : "（停用）"} | ${row.type} | ${row.required ? "是" : "否"} | ${escape(row.description)} | ${escape(row.example)} |`,
            )
            .join("\n"),
      );
    if (endpoint.bodyKind !== "none")
      sections.push(
        "### 请求正文",
        code(endpoint.body, endpoint.bodyKind === "json" ? "json" : "text"),
      );
    if (endpoint.requestSchema)
      sections.push("### 请求Schema", code(endpoint.requestSchema));
    for (const response of endpoint.responses) {
      sections.push(
        `### 响应 ${response.status} — ${response.description}`,
        `Content-Type：${response.contentType || "未限定"}`,
      );
      if (response.schema) sections.push(code(response.schema));
      if (response.example) sections.push("示例：", code(response.example));
    }
  }
  return sections.filter(Boolean).join("\n\n") + "\n";
}
