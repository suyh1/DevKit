import { createContext, useContext } from 'react';
import { desktopRequest } from './planning-share-api';
import { remoteRequest } from './workspace-remote';

export const templates = ['部署手册', '故障排查', '项目交接'] as const;
export type Template = (typeof templates)[number];
export type Article = { title: string; project: string; folder: string; tags: string[]; body: string };
export type KnowledgePage = Article & { id: string; revision: number; updated: string; actor: string };
export function knowledgeRequest<T>(action: string, value?: unknown) {
  return window.devkitKnowledge
    ? desktopRequest<T>(window.devkitKnowledge, action, value)
    : remoteRequest<T>('knowledge', action, value);
}

export function developmentDocsRequest<T>(action: string, value?: unknown) {
  return window.devkitDevelopmentDocs
    ? desktopRequest<T>(window.devkitDevelopmentDocs, action, value)
    : remoteRequest<T>('dev-docs', action, value);
}
const libraries = {
  knowledge: { section: 'knowledge', name: '团队知识库', request: knowledgeRequest },
  'dev-docs': { section: 'dev-docs', name: '开发文档管理', request: developmentDocsRequest },
} as const;
export type DocumentSection = keyof typeof libraries;
export const DocumentSectionContext = createContext<DocumentSection>('knowledge');
export const useDocumentLibrary = () => libraries[useContext(DocumentSectionContext)];
