import type { Faker } from '@faker-js/faker';
export function buildSchemaNode(
  value: unknown,
  path: string,
  index: number,
  depth: number,
  build: (value: unknown, path: string, index: number, depth: number) => unknown,
  faker: Faker,
  date: () => string,
): unknown;
export function resolveSchemaObject(root: unknown, value: unknown): Record<string, unknown> | undefined;
export function generateSchemaResponse(
  text: string,
  context?: import('./mock-request.mjs').MockContext,
): Promise<unknown>;

export function bounds(
  min: unknown,
  max: unknown,
  low: number,
  high: number,
  integer?: boolean,
): [number, number];
