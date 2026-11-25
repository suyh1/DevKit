import type { Article, KnowledgePage } from './knowledge-api';

export type WritingDraft = {
  token: string;
  form: Article;
  documentId?: string;
  revision?: number;
  changed: boolean;
  time: number;
  position?: { anchor: number; head: number; top: number };
};
export function draftPrefix(portal: boolean, visitor: string, section: 'knowledge' | 'dev-docs' = 'knowledge') {
  return 'devkit:' + section + '-draft:2:' + (portal ? 'visitor:' + encodeURIComponent(visitor) : 'desktop') + ':';
}
export function createDraft(form: Article, page?: KnowledgePage): WritingDraft {
  return {
    token: Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
      n.toString(16).padStart(8, '0'),
    ).join(''),
    form,
    documentId: page?.id,
    revision: page?.revision,
    changed: !page,
    time: Date.now(),
  };
}
export function readDraft(prefix: string, token: string): WritingDraft | undefined {
  try {
    const draft = JSON.parse(localStorage.getItem(prefix + token) || 'null');
    if (draft?.token === token && typeof draft.form?.body === 'string' && Array.isArray(draft.form.tags))
      return draft;
  } catch {
    /* Ignore an unreadable local draft; shared documents are independent. */
  }
}
export function savedDrafts(prefix: string) {
  try {
    return Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .flatMap((key) => {
        const value = readDraft(prefix, key.slice(prefix.length));
        return value?.changed ? [value] : [];
      })
      .sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
}
export function articleFields({ title, project, folder, tags, body }: Article): Article {
  return { title, project, folder, tags, body };
}
