import { parseApiSchema } from "../shared/api-workspace.mjs";
export type SchemaField = {
  path: string;
  type: string;
  required: boolean;
  description: string;
  depth: number;
};
export function schemaFields(text: string): SchemaField[] {
  const root = parseApiSchema(text);
  if (root === null) return [];
  const rows: SchemaField[] = [];
  function visit(
    value: any,
    path: string,
    required: boolean,
    depth: number,
    seen: Set<string>,
  ) {
    if (rows.length >= 500 || depth > 16) return;
    if (typeof value === "boolean") {
      rows.push({
        path,
        type: value ? "任意值" : "不允许任何值",
        required,
        description: "",
        depth,
      });
      return;
    }
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string") {
      if (seen.has(value.$ref)) {
        rows.push({
          path,
          type: "循环引用",
          required,
          description: value.$ref,
          depth,
        });
        return;
      }
      const ref = value.$ref;
      if (!ref.startsWith("#/")) {
        rows.push({ path, type: "引用", required, description: ref, depth });
        return;
      }
      let resolved: any = root;
      for (const key of ref
        .slice(2)
        .split("/")
        .map((key: string) => key.replaceAll("~1", "/").replaceAll("~0", "~")))
        resolved = resolved?.[key];
      if (!resolved) {
        rows.push({
          path,
          type: "未解析引用",
          required,
          description: ref,
          depth,
        });
        return;
      }
      visit(
        {
          ...resolved,
          ...Object.fromEntries(
            Object.entries(value).filter(([key]) => key !== "$ref"),
          ),
        },
        path,
        required,
        depth,
        new Set([...seen, ref]),
      );
      return;
    }
    const type = Array.isArray(value.type)
      ? value.type.join(" | ")
      : value.type ||
        ["oneOf", "anyOf", "allOf"].find((key) => value[key]) ||
        "object";
    const limits = [
      value.format ? `格式: ${value.format}` : "",
      value.enum ? `枚举: ${JSON.stringify(value.enum)}` : "",
      value.minimum !== undefined ? `最小: ${value.minimum}` : "",
      value.maximum !== undefined ? `最大: ${value.maximum}` : "",
    ].filter(Boolean);
    rows.push({
      path,
      type,
      required,
      description: [value.description, ...limits].filter(Boolean).join(" · "),
      depth,
    });
    for (const [key, child] of Object.entries(value.properties || {}))
      visit(
        child,
        key,
        value.required?.includes(key) || false,
        depth + 1,
        seen,
      );
    if (value.items && !Array.isArray(value.items))
      visit(value.items, "[item]", false, depth + 1, seen);
    for (const union of ["oneOf", "anyOf", "allOf"])
      if (Array.isArray(value[union]))
        value[union].forEach((child: any, index: number) =>
          visit(child, `${union}[${index + 1}]`, false, depth + 1, seen),
        );
  }
  visit(root, "(root)", false, 0, new Set());
  return rows;
}
export default function ApiSchemaView({ value }: { value: string }) {
  try {
    const fields = schemaFields(value);
    return fields.length ? (
      <div className="api-table-scroll">
        <table aria-label="Schema字段结构">
          <thead>
            <tr>
              <th>字段</th>
              <th>类型</th>
              <th>必填</th>
              <th>说明 / 约束</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => (
              <tr key={index}>
                <td style={{ paddingLeft: 12 + field.depth * 15 }}>
                  <code>{field.path}</code>
                </td>
                <td>{field.type}</td>
                <td>{field.required ? "是" : "否"}</td>
                <td>{field.description || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {fields.length >= 500 && (
          <p className="api-empty-note">
            结构表仅显示前500项，原始Schema仍完整保留。
          </p>
        )}
      </div>
    ) : null;
  } catch (error) {
    return <p className="api-error">{String(error)}</p>;
  }
}
