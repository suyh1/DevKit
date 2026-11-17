const sensitiveAssignment = /((?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credentials?|session[_-]?id|signature)["']?\s*[:=]\s*)("(?:\\[^\r\n]|[^"\\\r\n])*"?|'(?:\\[^\r\n]|[^'\\\r\n])*'?|[^\s,"'}&;]+)/gi;
const credentialHeader = /(^|[^\w"'_.-])((?:set-cookie|cookie|authorization|proxy-authorization)[ \t]*:[ \t]*)[^\r\n]*/gim;

export function redactLog(text) {
  return text
    .replace(credentialHeader, '$1$2[已隐藏]')
    .replace(/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[已隐藏]')
    .replace(sensitiveAssignment, (_match, field, value) => {
      const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
      return `${field}${quote}[已隐藏]${quote}`;
    })
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[已隐藏]@');
}

export function redactLogResult(result, { tail = false, assumePartial = false } = {}) {
  if (typeof result.text !== 'string') return result;
  // A fragment can begin inside a secret whose field name was in the last chunk.
  const partial = result.startsMidline ?? (!result.reset && assumePartial);
  const chunks = result.text.split('\n');
  if (partial || tail && result.truncated) chunks[0] = chunks[0] ? '[已隐藏不完整行]' : '';
  if ((result.more || result.cursor != null && result.end > result.cursor) && chunks.at(-1)) chunks[chunks.length - 1] = '[已隐藏不完整行]';
  return { ...result, text: redactLog(chunks.join('\n')) };
}
