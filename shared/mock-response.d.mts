export const mockFieldNames: string[];
export function prepareMockResponse(body: string, count: number): (request?: import('./mock-request.mjs').MockContext) => Promise<unknown>;
