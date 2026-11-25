import FloatingDetails from './FloatingDetails';
import { useEffect, useMemo, useRef } from 'react';
import { useDocumentLibrary, type KnowledgePage } from './knowledge-api';
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
  const { section } = useDocumentLibrary();
  const content = useMemo(() => articleLayout(page.body), [page.body]);
  const ContentsDetails = content.headings.length > 6 ? FloatingDetails : 'details';
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
        <ContentsDetails className="kb-toc">
          <summary>本文目录 · {content.headings.length}</summary>
          <nav aria-label="本文目录" className={ContentsDetails === 'details' ? 'disclosure-scroll' : undefined}>
            {content.headings.map((h) => (
              <div key={h.key} style={{ paddingInlineStart: Math.max(0, h.level - 2) * 10 }}>
                <button
                  className="text-button"
                  onClick={event => {
                    const directory = event.currentTarget.closest('details');
                    if (directory) directory.open = false;
                    openWorkspaceLink(section, page.id + '~' + h.key);
                    const heading = root.current?.querySelector<HTMLElement>('[data-kb-heading="' + h.key + '"]');
                    if (heading) {
                      heading.tabIndex = -1;
                      heading.focus({ preventScroll: true });
                      heading.scrollIntoView({ block: 'center' });
                    }
                  }}
                >
                  {h.title}
                </button>
                <ResourceLink page={section} id={page.id + '~' + h.key} compact />
              </div>
            ))}
          </nav>
        </ContentsDetails>
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
              workspaceHash(section, page.id + (anchor ? '~' + anchor : '')),
            );
            openWorkspaceLink(link.page, link.id);
          }
        }}
        dangerouslySetInnerHTML={{ __html: content.html }}
      />
    </>
  );
}
