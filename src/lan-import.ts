import { defaultPort } from './lan-protocols';
import { parseCsv } from './practical';
import type { HostDraft } from './lan-api';

export function parseHostCsv(text: string): HostDraft[] {
  const [headers, ...rows] = parseCsv(text, ',');
  const keys = headers.map(value => value.trim().toLowerCase());
  if (!keys.includes('address') || new Set(keys).size !== keys.length) throw new Error('CSV 需要唯一的表头，并包含 address 列。');
  return rows.map(row => {
    const value = (key: string) => row[keys.indexOf(key)]?.trim() || '';
    const enabled = (key: string) => /^(true|1)$/i.test(value(key));
    const mode = (value('mode').toLowerCase() || 'ssh') as HostDraft['mode'];
    return {
      name: value('name'), address: value('address'), mode,
      user: value('user'), port: Number(value('port') || defaultPort[mode]), platform: (value('platform') || 'linux') as HostDraft['platform'],
      auth: value('auth') === 'password' ? 'password' : 'key',
      group: value('group'), tags: value('tags').split('|').map(tag => tag.trim()).filter(Boolean), pinned: enabled('pinned'),
      modules: { jar: enabled('jar'), nginx: enabled('nginx') },
    };
  });
}

export function parseSshHosts(text: string): HostDraft[] {
  const sections: { patterns: string[]; options: Map<string, string> }[] = [];
  let active: typeof sections[number] | undefined = { patterns: ['*'], options: new Map() };
  sections.push(active);
  const aliases = new Set<string>();
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^(\w+)(?:\s*=\s*|\s+)(.+)$/.exec(line);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const parts = match[2].match(/"[^"\r\n]*"|[^\s"#]+|#.*$/g) || [];
    if (parts.at(-1)?.startsWith('#')) parts.pop();
    const tokens = parts.map(value => value.replace(/^"|"$/g, '')).filter(value => value.length <= 253);
    if (key === 'match') { active = undefined; continue; }
    if (key === 'host') {
      active = { patterns: tokens, options: new Map() };
      sections.push(active);
      for (const alias of tokens) if (/^[\w.-]+$/.test(alias)) aliases.add(alias);
    } else if (active && ['hostname', 'user', 'port'].includes(key) && tokens[0] && !active.options.has(key)) active.options.set(key, tokens[0]);
  }
  if (!aliases.size) throw new Error('没有找到带有明确 Host 名称的 SSH 连接。');
  if (aliases.size > 200) throw new Error('每次最多预览 200 条连接。');
  function fits(pattern: string, alias: string) {
    pattern = pattern.toLowerCase(); alias = alias.toLowerCase();
    let position = 0, offset = 0, wildcard = -1, retry = 0;
    while (offset < alias.length) {
      if (pattern[position] === '*') { wildcard = position++; retry = offset; }
      else if (pattern[position] === '?' || pattern[position] === alias[offset]) { position++; offset++; }
      else if (wildcard >= 0) { position = wildcard + 1; offset = ++retry; }
      else return false;
    }
    return /^\**$/.test(pattern.slice(position));
  }
  return [...aliases].map(name => {
    const options = new Map<string, string>();
    for (const section of sections) {
      if (section.patterns.some(pattern => pattern.startsWith('!') && fits(pattern.slice(1), name))) continue;
      if (section.patterns.some(pattern => !pattern.startsWith('!') && fits(pattern, name))) for (const [key, value] of section.options) if (!options.has(key)) options.set(key, value);
    }
    return { name, address: (options.get('hostname') || name).replaceAll('%h', name), mode: 'ssh', user: options.get('user') || '', port: Number(options.get('port') || '22'), platform: 'linux', auth: 'key', modules: { jar: false, nginx: false } };
  });
}
