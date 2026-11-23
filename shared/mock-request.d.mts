export type Rule = { source: 'query' | 'path' | 'header' | 'body'; key: string; value: string };
export type MockContext = {
  path?: Record<string, string>;
  query?: Record<string, string | string[]>;
  header?: Record<string, string>;
  body?: unknown;
};
export function scenarioRules(scenario: { rules?: Rule[]; queryKey?: string; queryValue?: string }): Rule[];

export function validField(source: string, key: string): boolean;
export type FieldHint = { source: Rule['source']; key: string };
