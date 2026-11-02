/// <reference lib="webworker" />
export {};
const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage = ({ data }: MessageEvent<{ text: string; query: string; regex: boolean; level: string; redact: boolean }>) => {
  try {
    const expression = data.query && data.regex ? new RegExp(data.query, 'i') : null;
    const query = data.query.toLocaleLowerCase();
    const lines = data.text.split('\n');
    const matches = lines.filter(line => (!data.query || (expression ? expression.test(line) : line.toLocaleLowerCase().includes(query))) && (data.level === 'all' || new RegExp(`\\b${data.level === 'error' ? '(?:error|fatal|crit|emerg|alert)' : data.level === 'warn' ? 'warn(?:ing)?' : data.level}\\b`, 'i').test(line)));
    let text = matches.join('\n');
    if (data.redact) text = text.replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[已隐藏]').replace(/((?:password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi, '$1[已隐藏]');
    worker.postMessage({ text, count: matches.length });
  } catch (error) { worker.postMessage({ error: (error as Error).message }); }
};
