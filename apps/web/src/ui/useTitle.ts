import { useEffect } from 'react';
import { appName } from '../app-config';

/** Document title in the form "<page> · Lore" (Dodatek 4B, L1.3); without a page just the product name. */
export function useTitle(page?: string | null) {
  useEffect(() => {
    document.title = page ? `${page} · ${appName}` : appName;
  }, [page]);
}
