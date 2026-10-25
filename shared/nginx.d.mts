export interface NginxNode { id: number; name: string; start: number; end: number; line: number; argsStart: number; argsEnd: number; args: string; values: string[]; block: boolean; bodyEnd: number; children: NginxNode[] }
export const MAX_CONFIG_SIZE: number;
export function parseNginx(source: string): NginxNode[];
export function unquoteNginx(value: string): string;
export function flattenNginx(nodes: NginxNode[]): NginxNode[];
export function editNginxArgs(source: string, node: NginxNode, args: string): string;
export function insertNginx(source: string, parent: NginxNode | null, snippet: string): string;
export const nginxFields: Record<string, [string, string]>;
