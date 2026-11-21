import { desktopRequest } from './planning-share-api';
import { remoteRequest } from './workspace-remote';

export const kinds = ['部署手册', '故障排查', '项目交接'] as const;
export type KnowledgeKind = (typeof kinds)[number];
export type Article = { title: string; project: string; kind: KnowledgeKind; body: string };
export type KnowledgePage = Article & { id: string; revision: number; updated: string; actor: string };
export function knowledgeRequest<T>(action: string, value?: unknown) {
  return window.devkitKnowledge
    ? desktopRequest<T>(window.devkitKnowledge, action, value)
    : remoteRequest<T>('knowledge', action, value);
}
