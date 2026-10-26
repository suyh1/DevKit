import type { ApiEndpoint } from "../shared/api-workspace.mjs";

// Request values are local overrides, never a replacement for the shared definition.
const requestKeys = [
  "method",
  "path",
  "server",
  "timeout",
  "parameters",
  "auth",
  "bodyKind",
  "body",
  "requestSchema",
] as const;
export type DebugOverrides = Partial<
  Pick<ApiEndpoint, (typeof requestKeys)[number]>
>;
export function debugOverrides(
  definition: ApiEndpoint,
  request: ApiEndpoint,
): DebugOverrides {
  return Object.fromEntries(
    requestKeys
      .filter(
        (key) =>
          JSON.stringify(request[key]) !== JSON.stringify(definition[key]),
      )
      .map((key) => [key, structuredClone(request[key])]),
  ) as DebugOverrides;
}
export function debugRequest(
  definition: ApiEndpoint,
  overrides: DebugOverrides,
): ApiEndpoint {
  return { ...definition, ...overrides };
}
