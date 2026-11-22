// Expand JavaScript replacement tokens against each match, checking the output
// budget before appending repeated captures, prefixes or suffixes.
export function replaceMatches(input: string, pattern: RegExp, template: string) {
  const chunks: string[] = [];
  let size = 0, count = 0, end = 0;
  function append(value: string) {
    size += value.length;
    if (size > 4_000_000) throw new Error('替换结果超过 4,000,000 字符。');
    if (value) chunks.push(value);
  }
  let tokens: string[] | undefined;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    count++;
    append(input.slice(end, match.index));
    end = match.index + match[0].length;
    tokens ??= template.split(match.groups
      ? /(\$\$|\$&|\$\x60|\$'|\$\d{1,2}|\$<[^>]*>)/
      : /(\$\$|\$&|\$\x60|\$'|\$\d{1,2})/);
    for (const [index, token] of tokens.entries()) {
      if (index % 2 === 0) append(token);
      else if (token === '$$') append('$');
      else if (token === '$&') append(match[0]);
      else if (token === '$\x60') append(input.slice(0, match.index));
      else if (token === "$'") append(input.slice(end));
      else if (token.startsWith('$<') && match.groups) append(match.groups[token.slice(2, -1)] ?? '');
      else if (/^\$\d/.test(token)) {
        const digits = token.slice(1), n = Number(digits), first = Number(digits[0]);
        if (n > 0 && n < match.length) append(match[n] ?? '');
        else if (digits.length === 2 && first > 0 && first < match.length) append((match[first] ?? '') + digits[1]);
        else append(token);
      } else append(token);
    }
    if (!pattern.global) break;
    if (!match[0]) pattern.lastIndex += (pattern.unicode || pattern.flags.includes('v')) && (input.codePointAt(end) ?? 0) > 0xffff ? 2 : 1;
  }
  append(input.slice(end));
  return { text: chunks.join(''), count };
}
