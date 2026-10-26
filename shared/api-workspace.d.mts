export type ApiParameter = {
  id: string;
  name: string;
  location: "path" | "query" | "header" | "cookie";
  type: "string" | "integer" | "number" | "boolean" | "object" | "array";
  required: boolean;
  enabled: boolean;
  description: string;
  example: string;
  schema: string;
};
export type ApiResponse = {
  id: string;
  status: string;
  description: string;
  contentType: string;
  schema: string;
  example: string;
};
export type ApiAuth = {
  type: "none" | "bearer" | "basic" | "apiKey";
  token: string;
  username: string;
  password: string;
  key: string;
  value: string;
  location: "header" | "query";
};
export type ApiEndpoint = {
  id: string;
  name: string;
  group: string;
  description: string;
  method: string;
  path: string;
  server: string;
  timeout: number;
  parameters: ApiParameter[];
  auth: ApiAuth;
  bodyKind: "none" | "json" | "text" | "form";
  body: string;
  requestSchema: string;
  responses: ApiResponse[];
};
export type ApiEnvironment = {
  id: string;
  name: string;
  baseUrl: string;
  variables: { key: string; value: string; enabled: boolean }[];
};
export type ApiProject = {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  version: string;
  groups: string[];
  environments: ApiEnvironment[];
  endpoints: ApiEndpoint[];
};
export type ApiState = {
  schemaVersion: 1;
  revision: number;
  projects: ApiProject[];
};
export const API_LIMITS: {
  projects: number;
  endpoints: number;
  environments: number;
  parameters: number;
  bytes: number;
};
export const API_METHODS: string[];
export function initialApiState(): ApiState;
export function validateApiState(input: unknown): ApiState;
export function newApiEndpoint(id: string, group?: string): ApiEndpoint;
export function parseApiSchema(
  value: string,
): Record<string, unknown> | boolean | null;
