import { useCallback, useMemo, useState } from 'react';

/**
 * Progressive list rendering.
 *
 * The app's queue screens are plain `ScrollView`s inside a tab that also
 * renders search, filters and stat cards. Mapping a few hundred record cards
 * into that tree mounted every card's timeline, photo and action stack on the
 * first frame, which is what made opening Repair Management / a department's
 * assets feel slow. This hook keeps the full (already filtered) array in memory
 * — search and filtering still see every record — but only hands the screen the
 * first page, growing it as the admin scrolls.
 *
 * `items` must be a stable reference (wrap the filtered array in `useMemo`):
 * a new array each render resets the window, which would make the list collapse
 * while the user scrolls.
 */
export const PAGE_SIZE = 25;

export type PagedList<T> = {
  /** The slice to render now. */
  visible: T[];
  /** How many records the current filter matched. */
  total: number;
  /** How many are on screen right now. */
  shown: number;
  hasMore: boolean;
  /** Reveal the next page. Safe to call repeatedly. */
  loadMore: () => void;
  /** Collapse back to the first page (e.g. after a refresh). */
  reset: () => void;
};

export function usePagedList<T>(items: T[], pageSize: number = PAGE_SIZE): PagedList<T> {
  const [page, setPage] = useState(1);
  // A new filtered array means a different query, so the window starts over.
  // Adjusting it during render (React's documented "derive from props" pattern)
  // avoids an effect that would paint one frame with the previous filter's
  // window still open.
  const [seen, setSeen] = useState<{ items: T[]; pageSize: number }>({ items, pageSize });
  const changed = seen.items !== items || seen.pageSize !== pageSize;
  if (changed) {
    setSeen({ items, pageSize });
    setPage(1);
  }

  const currentPage = changed ? 1 : page;
  const visible = useMemo(
    () => items.slice(0, currentPage * pageSize),
    [items, currentPage, pageSize],
  );

  const loadMore = useCallback(() => {
    setPage((current) => {
      const next = current + 1;
      return next * pageSize - pageSize >= items.length ? current : next;
    });
  }, [items.length, pageSize]);

  const reset = useCallback(() => setPage(1), []);

  return {
    visible,
    total: items.length,
    shown: visible.length,
    hasMore: visible.length < items.length,
    loadMore,
    reset,
  };
}
