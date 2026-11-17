import { redactLog } from './log-redaction.mjs';

const sensitive = /authorization|cookie|token|password|passwd|secret|api[_.-]?key|signature|session|credential/i;
const safeUrl = (value, isSensitive = name => sensitive.test(name)) => {
  if (!value) return value;
  try {
    const url = new URL(value);
    let changed = !!(url.username || url.password);
    if (changed) { url.username = ''; url.password = ''; }
    for (const name of [...url.searchParams.keys()]) {
      if (isSensitive(name)) { url.searchParams.delete(name); changed = true; }
    }
    return redactLog(changed ? url.href : value);
  } catch { return redactLog(value); }
};

function safeExample(value, isSensitive) {
  if (/^\s*[\[{]/.test(value)) {
    try {
      let changed = false;
      const result = JSON.parse(value, (key, item, context) => {
        if (isSensitive(key)) { changed = true; return '[已隐藏]'; }
        if (typeof item === 'number') return JSON.rawJSON(context.source);
        if (typeof item !== 'string') return item;
        const masked = redactLog(item);
        changed ||= masked !== item;
        return masked;
      });
      return changed ? JSON.stringify(result, null, 2) : value;
    } catch { /* Handle a plain text example with the log rules. */ }
  }
  return redactLog(value);
}

function readOnlyEndpoint(endpoint) {
  const authKey = endpoint.auth.type === 'apiKey' ? endpoint.auth.key.toLowerCase() : '';
  const isSensitive = name => sensitive.test(name) || !!authKey && name.toLowerCase() === authKey;
  const safeSchema = value => {
    if (!value) return value;
    const scrub = (node, confidential = false) => {
      if (!node || typeof node !== 'object') return typeof node === 'string' ? redactLog(node) : node;
      if (Array.isArray(node)) return node.map(item => scrub(item, confidential));
      return Object.fromEntries(Object.entries(node).map(([key, item]) => {
        if (confidential && ['default', 'example', 'examples', 'enum', 'const'].includes(key)) return [key, key === 'examples' || key === 'enum' ? [] : null];
        if (key === 'properties' && item && typeof item === 'object') return [key, Object.fromEntries(Object.entries(item).map(([name, schema]) => [name, scrub(schema, confidential || isSensitive(name))]))];
        return [key, scrub(item, confidential || isSensitive(key))];
      }));
    };
    try {
      const original = JSON.parse(value), masked = scrub(original);
      return JSON.stringify(original) === JSON.stringify(masked) ? value : JSON.stringify(masked, null, 2);
    } catch { return redactLog(value); }
  };
  let body = safeExample(endpoint.body, isSensitive);
  if (endpoint.bodyKind === 'form') {
    const fields = new URLSearchParams(endpoint.body);
    const confidential = [...fields.keys()].filter(isSensitive);
    if (confidential.length) {
      for (const name of confidential) fields.delete(name);
      body = redactLog(fields.toString());
    }
  }
  return {
    ...endpoint,
    server: safeUrl(endpoint.server, isSensitive),
    auth: { ...endpoint.auth, token: '', username: '', password: '', value: '' },
    parameters: endpoint.parameters.map(parameter => ({
      ...parameter,
      example: parameter.location === 'cookie' || isSensitive(parameter.name) ? '' : safeExample(parameter.example, isSensitive),
      schema: safeSchema(parameter.schema),
    })),
    body,
    requestSchema: safeSchema(endpoint.requestSchema),
    responses: endpoint.responses.map(response => ({ ...response, schema: safeSchema(response.schema), example: safeExample(response.example, isSensitive) })),
  };
}

export function apiSharingView(result) {
  return { ...result, state: { ...result.state, projects: result.state.projects.map(project => ({
    ...project,
    baseUrl: safeUrl(project.baseUrl),
    environments: project.environments.map(environment => ({
      ...environment, baseUrl: safeUrl(environment.baseUrl), variables: environment.variables.map(variable => ({ ...variable, value: '' })),
    })),
    endpoints: project.endpoints.map(readOnlyEndpoint),
  })) } };
}
