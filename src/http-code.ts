import type { Options } from "./tools";
import { jsonObjectFields } from "./result-model";
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function httpCode(input: string, options: Options) {
  const fields = jsonObjectFields(input);
  const config = JSON.parse(input);
  if (
    !config ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    typeof config.url !== "string"
  )
    throw new Error("配置必须包含 url 字符串。");
  const url = new URL(config.url);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("URL 仅支持 HTTP(S)，认证信息请放到 headers。");
  const method = String(config.method ?? "GET").toUpperCase();
  if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method))
    throw new Error("不支持此 HTTP method。");
  const headers = config.headers ?? {};
  const headerRaw = fields.get("headers")?.raw;
  if (headerRaw && headerRaw !== "null") jsonObjectFields(headerRaw);
  if (
    !headers ||
    typeof headers !== "object" ||
    Array.isArray(headers) ||
    Object.entries(headers).some(
      ([key, value]) =>
        !/^[!#$%&'*+.^_`|~\w-]+$/.test(key) ||
        typeof value !== "string" ||
        /[\r\n]/.test(value),
    )
  )
    throw new Error("headers 必须为合法名称与单行字符串值的对象。");
  const bodyRaw = fields.get("body")?.raw;
  const body =
    bodyRaw === undefined ||
    (config.body === "" && ["GET", "HEAD"].includes(method))
      ? undefined
      : typeof config.body === "string"
        ? config.body
        : bodyRaw;
  if (
    bodyRaw !== undefined &&
    typeof config.body !== "string" &&
    !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")
  )
    headers["Content-Type"] = "application/json";
  if (body !== undefined && ["GET", "HEAD"].includes(method))
    throw new Error("GET / HEAD 不支持请求体，请移除 body 或更换 method。");
  const shell = (text: string) => "'" + text.replace(/'/g, "'\\''") + "'";
  if (options.style === "curl")
    return [
      "curl",
      "--request",
      shell(method),
      "--url",
      shell(config.url),
      ...Object.entries(headers).flatMap(([key, value]) => [
        "--header",
        shell(`${key}: ${value}`),
      ]),
      ...(body === undefined ? [] : ["--data-raw", shell(body)]),
    ].join(" ");
  // Serialize JSON bodies as text for every client, retaining large integer and exponent tokens.
  const entries = [
    `"method": ${JSON.stringify(method)}`,
    `"headers": ${pretty(headers)}`,
  ];
  if (options.style === "axios")
    return `import axios from 'axios';\n\nconst response = await axios.request({\n  "url": ${JSON.stringify(config.url)},\n  ${entries.join(",\n  ")}${body === undefined ? "" : ',\n  "data": ' + JSON.stringify(body)}\n});\nconsole.log(response.data);\n`;
  return `const response = await fetch(${JSON.stringify(config.url)}, {\n  ${entries.join(",\n  ")}${body === undefined ? "" : ',\n  "body": ' + JSON.stringify(body)}\n});\nif (!response.ok) throw new Error(\`HTTP \${response.status}\`);\nconst text = await response.text();\nconsole.log(text);\n`;
}
