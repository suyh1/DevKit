import { describe, it, expect } from "vitest";
import { Validator } from "@cfworker/json-schema";
import {
  initialApiState,
  newApiEndpoint,
  validateApiState,
  parseApiSchema,
} from "../shared/api-workspace.mjs";
import {
  buildApiRequest,
  fillApiJson,
  responseContract,
  requestSchemaBody,
} from "./api-request";
import {
  importApiProject,
  exportOpenApi,
  newApiProject,
  exportApiProject,
  exportApiMarkdown,
} from "./api-formats";
import { checkApiSchema } from "./api-schema-validation";
import { schemaFields } from "./ApiSchemaView";
import type { ApiParameter } from "../shared/api-workspace.mjs";
import type { HttpResponse } from "./http-model";
const row = (
  name: string,
  location: ApiParameter["location"],
  example: string,
  type: ApiParameter["type"] = "string",
): ApiParameter => ({
  id: crypto.randomUUID(),
  name,
  location,
  example,
  type,
  required: false,
  enabled: true,
  description: "",
  schema: "",
});
const fixture = () => {
  const project = newApiProject("测试API"),
    endpoint = newApiEndpoint("one");
  endpoint.path = "/users/{id}";
  endpoint.parameters = [
    { ...row("id", "path", "a/b"), required: true },
    row("tag", "query", "甲 & 乙"),
    row("tag", "query", "second"),
    row("empty", "query", ""),
  ];
  project.endpoints = [endpoint];
  return { project, endpoint };
};
describe("API project validation and request construction", () => {
  it("keeps project identities independent and rejects duplicate operations and schema errors", () => {
    const { project, endpoint } = fixture(),
      state = {
        ...initialApiState(),
        projects: [
          project,
          { ...structuredClone(project), id: "other", name: "其他项目" },
        ],
      };
    expect(validateApiState(state).projects).toHaveLength(2);
    expect(() =>
      validateApiState({
        ...state,
        projects: [
          {
            ...project,
            endpoints: [
              endpoint,
              { ...endpoint, id: "other", path: "/users/{other}" },
            ],
          },
        ],
      }),
    ).toThrow("不能重复");
    expect(() => parseApiSchema("[]")).toThrow("对象");
    expect(() => parseApiSchema("{")).toThrow();
    expect(() =>
      validateApiState({
        ...initialApiState(),
        projects: [{ ...project, groups: ["same", "same"] }],
      }),
    ).toThrow("目录");
  });
  it("encodes path values, preserves duplicate/empty query values and validates variables before sending", () => {
    const { project, endpoint } = fixture();
    const request = buildApiRequest(project, endpoint);
    const url = new URL(request.url);
    expect(url.pathname).toBe("/users/a%2Fb");
    expect(url.searchParams.getAll("tag")).toEqual(["甲 & 乙", "second"]);
    expect(url.searchParams.has("empty")).toBe(true);
    endpoint.parameters[1].example = "{{missing}}";
    expect(() => buildApiRequest(project, endpoint)).toThrow("缺少环境变量");
    endpoint.parameters[0].enabled = false;
    expect(() => buildApiRequest(project, endpoint)).toThrow("路径参数");
  });
  it("applies environments, typed values, auth and rejects ambiguous headers without exposing credentials in URLs", () => {
    const { project, endpoint } = fixture();
    const environment = {
      id: "local",
      name: "本地",
      baseUrl: "http://localhost:9999",
      variables: [{ key: "token", value: "secret", enabled: true }],
    };
    endpoint.auth = { ...endpoint.auth, type: "bearer", token: "{{token}}" };
    endpoint.parameters.push(row("count", "query", "not-number", "integer"));
    expect(() => buildApiRequest(project, endpoint, environment)).toThrow(
      "integer",
    );
    endpoint.parameters.at(-1)!.example = "42";
    let request = buildApiRequest(project, endpoint, environment);
    expect(request.headers.Authorization).toBe("Bearer secret");
    expect(request.url).toMatch(/^http:\/\/localhost:9999/);
    endpoint.parameters.push(row("authorization", "header", "duplicate"));
    expect(() => buildApiRequest(project, endpoint, environment)).toThrow(
      "重复",
    );
    endpoint.parameters.pop();
    project.baseUrl = "https://user:pass@example.test";
    expect(() => buildApiRequest(project, endpoint)).toThrow();
  });
  it("substitutes JSON strings with correct escaping without rounding body numbers and encodes form values", () => {
    const values = new Map([["value", '甲"\\\n&=']]);
    const raw = '{"id":9007199254740993,"n":1.00,"text":"{{value}}"}';
    const filled = fillApiJson(raw, values);
    expect(filled).toContain("9007199254740993");
    expect(filled).toContain("1.00");
    expect(JSON.parse(filled).text).toBe(values.get("value"));
    const { project, endpoint } = fixture();
    endpoint.method = "POST";
    endpoint.bodyKind = "form";
    endpoint.body = "q={{value}}&q=two";
    const env = {
      id: "env",
      name: "env",
      baseUrl: "",
      variables: [{ key: "value", value: "a&b=c", enabled: true }],
    };
    const body = buildApiRequest(project, endpoint, env).body;
    expect(new URLSearchParams(body).getAll("q")).toEqual(["a&b=c", "two"]);
    endpoint.method = "GET";
    expect(() => buildApiRequest(project, endpoint, env)).toThrow("GET/HEAD");
  });
  it("matches exact/range/default responses, handles wildcard content types and reports missing contracts", () => {
    const endpoint = newApiEndpoint("a");
    endpoint.responses = [
      {
        id: "range",
        status: "2XX",
        description: "成功",
        contentType: "application/*",
        schema: '{"type":"object"}',
        example: "",
      },
    ];
    const response = {
      status: 201,
      headers: [["Content-Type", "application/json; charset=utf-8"]],
    } as HttpResponse;
    let report = responseContract(endpoint, response);
    expect(report.checks.every((row) => row.state === "pass")).toBe(true);
    expect(report.schema).toEqual({ type: "object" });
    response.status = 400;
    expect(responseContract(endpoint, response).checks[0].state).toBe("fail");
    endpoint.responses = [];
    expect(responseContract(endpoint, response).checks[0].state).toBe("skip");
  });
});
describe("offline API format conversion", () => {
  const document = {
    openapi: "3.1.0",
    info: { title: "Users", version: "1" },
    servers: [{ url: "http://localhost:8000" }],
    components: {
      schemas: {
        User: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            friend: { $ref: "#/components/schemas/User" },
          },
        },
      },
    },
    paths: {
      "/users/{id}": {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            example: 3,
          },
        ],
        get: {
          summary: "用户详情",
          tags: ["用户"],
          responses: {
            "200": {
              description: "成功",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/User" },
                  example: { name: "甲" },
                },
              },
            },
          },
        },
      },
    },
  };
  it("imports local recursive refs and exports a valid self-contained round trip", () => {
    const imported = importApiProject(JSON.stringify(document));
    expect(imported.project.endpoints[0].parameters[0].type).toBe("integer");
    expect(imported.project.groups).toEqual(["用户"]);
    const schema = JSON.parse(
      imported.project.endpoints[0].responses[0].schema,
    );
    expect(
      new Validator(schema).validate({ name: "甲", friend: { name: "乙" } })
        .valid,
    ).toBe(true);
    expect(new Validator(schema).validate({ friend: {} }).valid).toBe(false);
    const exported = exportOpenApi(imported.project),
      again = importApiProject(exported);
    expect(again.project.endpoints[0].name).toBe("用户详情");
    const round = JSON.parse(again.project.endpoints[0].responses[0].schema);
    expect(new Validator(round).validate({ name: "甲" }).valid).toBe(true);
    const fields = schemaFields(again.project.endpoints[0].responses[0].schema);
    expect(fields.some((field) => field.type === "循环引用")).toBe(true);
    expect(fields.length).toBeLessThan(20);
  });
  it("rejects unresolved/external references, duplicate YAML keys and unsupported bodies before import", () => {
    const external = structuredClone(document);
    external.components.schemas.User.properties.friend.$ref =
      "https://example.test/user.json";
    expect(() => importApiProject(JSON.stringify(external))).toThrow(
      "外部引用",
    );
    expect(() =>
      importApiProject("openapi: 3.1.0\nopenapi: 3.0.0\npaths: {}"),
    ).toThrow();
    const broken = structuredClone(document);
    broken.components.schemas.User.properties.friend.$ref = "#/missing";
    expect(() => importApiProject(JSON.stringify(broken))).toThrow("不存在");
    expect(() =>
      importApiProject(
        JSON.stringify({
          openapi: "3.1.0",
          info: { title: "x" },
          paths: {
            "/file": {
              post: {
                requestBody: { content: { "multipart/form-data": {} } },
                responses: {},
              },
            },
          },
        }),
      ),
    ).toThrow("文件/二进制");
  });
  it("imports Swagger2 and YAML definitions, preserving base paths and inline response schemas", () => {
    const result = importApiProject(
      'swagger: "2.0"\ninfo:\n  title: Legacy\nhost: localhost:9000\nbasePath: /api\nschemes: [http]\npaths:\n  /ping:\n    get:\n      responses:\n        "200":\n          description: ok\n          schema:\n            type: string\n',
    );
    expect(result.project.baseUrl).toBe("http://localhost:9000/api");
    expect(JSON.parse(result.project.endpoints[0].responses[0].schema)).toEqual(
      { type: "string" },
    );
  });
  it("keeps native backups complete while OpenAPI excludes environments/auth values", () => {
    const { project, endpoint } = fixture();
    project.environments = [
      {
        id: "env",
        name: "开发",
        baseUrl: "",
        variables: [{ key: "password", value: "do-not-export", enabled: true }],
      },
    ];
    endpoint.auth = { ...endpoint.auth, type: "bearer", token: "secret-token" };
    const exported = exportOpenApi(project);
    expect(exported).not.toContain("do-not-export");
    expect(exported).not.toContain("secret-token");
    expect(
      JSON.parse(exported).components.securitySchemes.auth_one.scheme,
    ).toBe("bearer");
    const backup = importApiProject(exportApiProject(project)).project;
    expect(backup.environments[0].variables[0].value).toBe("do-not-export");
    expect(backup.id).not.toBe(project.id);
    expect(exportApiMarkdown(project)).toContain("GET /users/{id}");
  });
  it("imports old request collections without mutating their text and rejects ambiguous Postman inheritance", () => {
    const text = JSON.stringify({
      format: "devkit-http-collection",
      version: 1,
      entries: [
        {
          id: "old",
          name: "旧请求",
          config:
            '{"url":"http://localhost/a?a=1&a=2","method":"GET","headers":{}}',
          timeout: 15000,
          sensitive: false,
        },
      ],
    });
    const imported = importApiProject(text);
    expect(imported.project.endpoints[0].parameters).toHaveLength(2);
    expect(() =>
      importApiProject(
        JSON.stringify({
          info: {
            schema:
              "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
          },
          variable: [{ key: "host", value: "localhost" }],
          item: [],
        }),
      ),
    ).toThrow("继承鉴权或变量");
  });
});

describe("schema validator safeguards", () => {
  it("rejects invalid keywords in nested schemas and never passes unsupported dynamic refs or unsafe numbers", () => {
    expect(checkApiSchema({ minLength: -1 }, "{}").state).toBe("fail");
    expect(
      checkApiSchema({ properties: { a: { required: "x" } } } as never, "{}")
        .state,
    ).toBe("fail");
    expect(checkApiSchema({ pattern: "[" }, '"x"').state).toBe("fail");
    expect(checkApiSchema({ $dynamicRef: "#node" } as never, "{}").state).toBe(
      "skip",
    );
    expect(
      checkApiSchema({ type: "object" }, '{"id":9007199254740993}').state,
    ).toBe("skip");
    expect(
      checkApiSchema(
        {
          type: "object",
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
        '{"ok":true}',
      ).state,
    ).toBe("pass");
  });
});

describe("OpenAPI numeric examples", () => {
  it("round trips raw JSON example numbers without rounding", () => {
    const project = newApiProject("numbers"),
      endpoint = newApiEndpoint("numeric");
    project.endpoints = [endpoint];
    endpoint.method = "POST";
    endpoint.bodyKind = "json";
    endpoint.body = '{"n":9007199254740993,"decimal":1.00}';
    endpoint.responses[0].example = '{"n":9007199254740993}';
    const exported = exportOpenApi(project);
    expect(exported).toContain("9007199254740993");
    expect(exported).toContain("1.00");
    const again = importApiProject(exported).project.endpoints[0];
    expect(again.body).toBe(endpoint.body);
    expect(again.responses[0].example).toBe(endpoint.responses[0].example);
  });
});

describe("non-JSON contracts", () => {
  it("validates text as strings and form fields by their schema types", () => {
    const endpoint = newApiEndpoint("text");
    endpoint.bodyKind = "text";
    endpoint.requestSchema = '{"type":"string"}';
    expect(
      checkApiSchema({ type: "string" }, requestSchemaBody(endpoint, "hello"))
        .state,
    ).toBe("pass");
    endpoint.bodyKind = "form";
    endpoint.requestSchema =
      '{"type":"object","properties":{"n":{"type":"integer"}}}';
    expect(JSON.parse(requestSchemaBody(endpoint, "n=42&tag=a&tag=b"))).toEqual(
      { n: 42, tag: ["a", "b"] },
    );
    const response = {
      status: 200,
      headers: [["Content-Type", "text/plain"]],
      body: "hello",
    } as HttpResponse;
    endpoint.responses[0].contentType = "text/plain";
    endpoint.responses[0].schema = '{"type":"string"}';
    const contract = responseContract(endpoint, response);
    expect(checkApiSchema(contract.schema!, contract.body).state).toBe("pass");
  });
});
