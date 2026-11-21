import { useEffect, type RefObject } from 'react';
export function useCodeBlockColors(root: RefObject<HTMLDivElement | null>, html: string) {
  useEffect(() => {
    const blocks = Array.from(
      root.current?.querySelectorAll<HTMLElement>('pre > code[class^="language-"]') ?? [],
    );
    if (!blocks.length) return;
    let live = true;
    void import('./knowledge-language')
      .then(({ colorCodeBlocks }) => {
        if (live) colorCodeBlocks(blocks);
      })
      .catch(() => {
        /* Formatted plain code remains readable offline. */
      });
    return () => {
      live = false;
    };
  }, [root, html]);
}
