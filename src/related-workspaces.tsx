import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { workspaceModules } from './catalog';
import type { WorkspaceModuleId } from './catalog';
import { remoteAccess } from './workspace-remote';
import { openWorkspaceLink, parseWorkspaceLink, workspaceHash } from './workspace-links';
import type { SharingServices } from '../shared/sharing.mjs';

const Feedback = createContext<(text: string) => void>(() => {});
export const useWorkspaceFeedback = () => useContext(Feedback);
export function WorkspaceFeedback({ children }: { children: ReactNode }) {
  const [bubble, setBubble] = useState<{ text: string; container: Element } | null>(null);
  useEffect(() => {
    if (!bubble) return;
    const clear = () => setBubble(null);
    const timer = window.setTimeout(clear, 5000);
    window.addEventListener('hashchange', clear);
    return () => { clearTimeout(timer); window.removeEventListener('hashchange', clear); };
  }, [bubble]);
  return <Feedback.Provider value={text => setBubble({ text, container: document.activeElement?.closest('dialog[open]') || document.body })}>
    {children}
    {bubble && createPortal(<div className="workspace-access-bubble" role="status">{bubble.text}</div>, bubble.container)}
  </Feedback.Provider>;
}

const permissions = { edit: '编辑', send: '发送请求', control: '运行管理', jar: '后端日志', nginx: 'Nginx 日志' } as const;
export function workspaceRestriction<P extends WorkspaceModuleId>(page: P, ...required: (keyof SharingServices[P] & keyof typeof permissions)[]) {
  const access = remoteAccess();
  if (!access) return '';
  const grant = access.services?.[page];
  const name = workspaceModules.find(item => item.id === page)!.name;
  if (!grant?.enabled) return `「${name}」未向当前访客共享。`;
  const missing = required.find(key => !grant[key]);
  return missing ? `当前访客没有「${name}」的${permissions[missing]}权限。` : '';
}

export function useWorkspaceGuard() {
  const feedback = useWorkspaceFeedback();
  return <P extends WorkspaceModuleId,>(page: P, ...required: (keyof SharingServices[P] & keyof typeof permissions)[]) => {
    const restriction = workspaceRestriction(page, ...required);
    if (restriction) feedback(restriction);
    return !restriction;
  };
}

export function RelatedLink({ page, id, children, onOpen }: { page: WorkspaceModuleId; id?: string; children: ReactNode; onOpen?: () => void }) {
  const guard = useWorkspaceGuard();
  return <button type="button" className="text-button" onClick={() => {
    if (guard(page)) { onOpen?.(); openWorkspaceLink(page, id); }
  }}>{children}</button>;
}

type CreatePage = 'lan-hosts' | 'projects' | 'jar' | 'nginx' | 'http' | 'mock' | 'project-todos' | 'transfer';
type Creation = { page: CreatePage; from: WorkspaceModuleId; resource?: string; pending: boolean };

// Keep the origin's resource hash and any outer creation when opening a nested form.
export function CreateRelated({ from, page, resource, beforeOpen, children }: { beforeOpen?: () => boolean; from: WorkspaceModuleId; page: CreatePage; resource?: string; children: ReactNode }) {
  const guard = useWorkspaceGuard();
  return <button type="button" className="text-button" onClick={() => {
    if (!guard(page, 'edit') || (beforeOpen && !beforeOpen())) return;
    if (parseWorkspaceLink(location.hash)?.page !== from) history.replaceState(history.state, '', workspaceHash(from));
    history.pushState({ creation: { page, from, resource, pending: true } satisfies Creation }, '', workspaceHash(page));
    window.dispatchEvent(new Event('hashchange'));
  }}>{children}</button>;
}

export function useRelatedCreation(page: CreatePage, ready: boolean, open: (from: WorkspaceModuleId, resource?: string) => void) {
  const opened = useRef(false);
  useEffect(() => {
    const request: Creation | undefined = history.state?.creation;
    if (ready && location.hash === workspaceHash(page) && request?.page === page && request.pending) {
      history.replaceState({ ...history.state, creation: { ...request, pending: false } }, '');
      opened.current = true;
      open(request.from, request.resource);
    }
  }, [ready, page, open]);
  return () => {
    if (opened.current && location.hash === workspaceHash(page) && history.state?.creation?.page === page) {
      opened.current = false;
      history.replaceState(null, '');
      history.back();
      return true;
    }
    return false;
  };
}
