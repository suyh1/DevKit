import { tools } from './tools';
import type { ToolId } from './tools';
import { aliases } from './catalog';

export function searchTools(query: string, favorites: ToolId[] = [], recent: ToolId[] = []) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return tools.map((tool, position) => {
    const name = `${tool.name} ${tool.english} ${tool.id}`.toLowerCase();
    const alias = (aliases[tool.id] ?? '').toLowerCase();
    const searchable = `${name} ${tool.category} ${tool.description} ${alias}`.toLowerCase();
    const matches = terms.every(term => searchable.includes(term) || subsequence(term, name));
    const score = terms.reduce((total, term) => total + (name.includes(term) ? 30 : alias.includes(term) ? 20 : searchable.includes(term) ? 5 : 1), 0)
      + (favorites.includes(tool.id) ? 5 : 0) + Math.max(0, 4 - recent.indexOf(tool.id)) * Number(recent.includes(tool.id));
    return { tool, matches, score, position };
  }).filter(item => item.matches).sort((left, right) => right.score - left.score || left.position - right.position).map(item => item.tool);
}

function subsequence(term: string, text: string): boolean {
  if (term.length < 2) return false;
  let position = 0;
  for (const character of text) if (character === term[position]) position++;
  return position === term.length;
}
