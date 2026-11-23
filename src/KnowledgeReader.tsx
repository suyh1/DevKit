import FloatingDetails from './FloatingDetails';
import { useEffect, useMemo, useRef } from 'react';
import type { KnowledgePage } from './knowledge-api';
import { useCodeBlockColors } from './knowledge-code-blocks';
import { articleLayout, resourceTarget } from './knowledge-markdown';
import { openWorkspaceLink, ResourceLink, workspaceHash } from './workspace-links';
import { useWorkspaceGuard } from './related-workspaces';

export function KnowledgeReader({
  page,
  anchor,
  jump,
}: {
  page: KnowledgePage;
  anchor?: string;
  jump?: { id: string; line: number };
}) {
  const content = useMemo(() => articleLayout(page.body), [page.body]);
  const root = useRef<HTMLDivElement>(null),
    guard = useWorkspaceGuard();
  useCodeBlockColors(root, content.html);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let target: HTMLElement | undefined;
    if (anchor)
      target = [...node.querySelectorAll<HTMLElement>('[data-kb-heading]')].find(
        (n) => n.dataset.kbHeading === anchor,
      );
    else if (jump?.id === page.id)
      target = [...node.querySelectorAll<HTMLElement>('[data-kb-line]')]
        .filter((n) => Number(n.dataset.kbLine) <= jump.line)
        .at(-1);
    target?.scrollIntoView({ block: 'center' });
    if (target) {
      target.classList.add('kb-location');
      return () => target.classList.remove('kb-location');
    }
  }, [content, anchor, jump, page.id]);
  return (
    <>
      {content.headings.length > 0 && (
        <FloatingDetails className="kb-toc">
          <summary>本文目录 · {content.headings.length}</summary>
          <nav aria-label="本文目录">
            {content.headings.map((h) => (
              <div key={h.key} style={{ paddingInlineStart: Math.max(0, h.level - 2) * 10 }}>
                <button
                  className="text-button"
                  onClick={() => {
                    openWorkspaceLink('knowledge', page.id + '~' + h.key);
                    root.current
                      ?.querySelector('[data-kb-heading="' + h.key + '"]')
                      ?.scrollIntoView({ block: 'center' });
                  }}
                >
                  {h.title}
                </button>
                <ResourceLink page="knowledge" id={page.id + '~' + h.key} compact />
              </div>
            ))}
          </nav>
        </FloatingDetails>
      )}
      <div
        className="kb-prose"
        ref={root}
        onClick={(event) => {
          const link = resourceTarget((event.target as Element).closest('a')?.getAttribute('href') ?? '');
          if (!link) return;
          event.preventDefault();
          if (guard(link.page)) {
            history.replaceState(
              history.state,
              '',
              workspaceHash('knowledge', page.id + (anchor ? '~' + anchor : '')),
            );
            openWorkspaceLink(link.page, link.id);
          }
        }}
        dangerouslySetInnerHTML={{ __html: content.html }}
      />
    </>
  );
}
