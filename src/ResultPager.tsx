import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ResultPager({ page, pages, onPage, label = '结果分页' }: {
  label?: string;
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav className="analysis-pagination" aria-label={label}>
      <button type="button" className="icon-button" aria-label="上一页" disabled={page === 0} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={16} />
      </button>
      <span aria-live="polite">{page + 1} / {pages}</span>
      <button type="button" className="icon-button" aria-label="下一页" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
