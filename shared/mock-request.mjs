const sources = ['path', 'query', 'header', 'body'];
const secret = /authorization|cookie|token|password|passwd|secret|api[-_]?key|signature|session|credential/i;
export const privateField = (name) => secret.test(name);
export function validField(source, key) {
  return (
    sources.includes(source) &&
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= 100 &&
    /^[\w.-]+$/.test(key) &&
    !(source === 'header' && privateField(key))
  );
}
export function requestValue(context, source, key) {
  const parts = source === 'body' ? key.split('.') : [source === 'header' ? key.toLowerCase() : key];
  let value = context?.[source];
  for (const part of parts) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}
export function scenarioRules(scenario) {
  return (
    scenario.rules ??
    (scenario.queryKey ? [{ source: 'query', key: scenario.queryKey, value: scenario.queryValue ?? '' }] : [])
  );
}
export function chooseScenario(route, context) {
  const misses = [];
  for (const scenario of route.scenarios) {
    const rules = scenarioRules(scenario);
    if (!rules.length) continue;
    let reason;
    for (const { source, key, value } of rules) {
      const actual = requestValue(context, source, key);
      const values = Array.isArray(actual) && source === 'query' ? actual : [actual];
      if (
        !values.some(
          (entry) =>
            entry !== undefined && entry !== null && typeof entry !== 'object' && String(entry) === value,
        )
      ) {
        if (privateField(key)) reason = '敏感字段未匹配';
        else {
          const observed = values
            .slice(0, 3)
            .map((entry) =>
              entry !== null && typeof entry === 'object' ? '[对象]' : String(entry).slice(0, 60),
            )
            .join('、');
          reason =
            source +
            '.' +
            key +
            (actual === undefined ? ' 未提供' : ' 收到 ' + observed) +
            '（预期 ' +
            value.slice(0, 60) +
            '）';
        }
        break;
      }
    }
    if (!reason)
      return { scenario, reason: '命中条件：' + rules.map((r) => r.source + '.' + r.key).join('、') };
    misses.push(scenario.name + '：' + reason);
  }
  return {
    scenario: route.scenarios[route.active],
    reason: '使用默认场景' + (misses.length ? '。' + misses.join('；') : '（未配置条件）'),
  };
}
