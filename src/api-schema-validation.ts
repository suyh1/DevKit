import { Validator } from "@cfworker/json-schema";
import type { Schema } from "@cfworker/json-schema";
import meta from "./api-schema-meta/schema.json";
import core from "./api-schema-meta/meta-core.json";
import applicator from "./api-schema-meta/meta-applicator.json";
import unevaluated from "./api-schema-meta/meta-unevaluated.json";
import validation from "./api-schema-meta/meta-validation.json";
import metadata from "./api-schema-meta/meta-meta-data.json";
import format from "./api-schema-meta/meta-format-annotation.json";
import content from "./api-schema-meta/meta-content.json";
import type { ApiCheck } from "./api-request";
const metaValidator = new Validator(
  structuredClone(meta) as Schema,
  "2020-12",
  false,
);
for (const schema of [
  core,
  applicator,
  unevaluated,
  validation,
  metadata,
  format,
  content,
])
  metaValidator.addSchema(structuredClone(schema) as Schema);
export function checkApiSchema(
  schema: Schema | boolean,
  body: string,
): ApiCheck {
  try {
    const stack: (Schema | boolean)[] = [schema];
    while (stack.length) {
      const current = stack.pop()!;
      const result = metaValidator.validate(current);
      if (!result.valid)
        return {
          name: "JSON Schema",
          state: "fail",
          detail:
            "Schema定义无效：" +
            result.errors
              .slice(0, 5)
              .map((error) => `${error.instanceLocation} ${error.error}`)
              .join("\n"),
        };
      if (typeof current === "boolean") continue;
      if (current.$dynamicRef || current.$dynamicAnchor)
        return {
          name: "JSON Schema",
          state: "skip",
          detail: "当前校验器不支持动态引用，未判定为通过。",
        };
      // Validate each nested schema explicitly; the local engine intentionally does not implement dynamic meta references.
      const object = current as Record<string, unknown>;
      for (const key of [
        "$defs",
        "definitions",
        "properties",
        "patternProperties",
        "dependentSchemas",
      ])
        if (object[key] && typeof object[key] === "object")
          stack.push(
            ...Object.values(object[key] as Record<string, Schema | boolean>),
          );
      for (const key of ["allOf", "anyOf", "oneOf", "prefixItems"])
        if (Array.isArray(object[key]))
          stack.push(...(object[key] as (Schema | boolean)[]));
      for (const key of [
        "items",
        "contains",
        "additionalProperties",
        "unevaluatedProperties",
        "unevaluatedItems",
        "propertyNames",
        "not",
        "if",
        "then",
        "else",
        "contentSchema",
      ])
        if (object[key] !== undefined)
          stack.push(object[key] as Schema | boolean);
      if (object.pattern !== undefined) new RegExp(object.pattern as string);
    }
    const tokens = body.replace(/"(?:[^"\\]|\\.)*"/g, "");
    if (
      [...tokens.matchAll(/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g)].some(
        (match) =>
          !Number.isFinite(Number(match[0])) ||
          (Number.isInteger(Number(match[0])) &&
            !Number.isSafeInteger(Number(match[0]))),
      )
    )
      return {
        name: "JSON Schema",
        state: "skip",
        detail:
          "正文包含超出JavaScript安全范围的数值，无法精确校验；原文已保留。",
      };
    const result = new Validator(schema, "2020-12", false).validate(
      JSON.parse(body),
    );
    return {
      name: "JSON Schema",
      state: result.valid ? "pass" : "fail",
      detail: result.valid
        ? "响应正文符合已定义的Schema。"
        : result.errors
            .slice(0, 20)
            .map((error) => `${error.instanceLocation || "/"} ${error.error}`)
            .join("\n"),
    };
  } catch (error) {
    return {
      name: "JSON Schema",
      state: "fail",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
