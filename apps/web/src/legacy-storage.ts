/**
 * One-time move of browser storage keys from the earlier product names (Dodatek 4B, L1.3): keys like `kvizhub-player` and
 * `jiskra.ui` become `lore-player` and `lore.ui`. A key already written under the new name wins; the old one is
 * removed. Runs before the first render; storage may be unavailable (private mode), so all of it is guarded.
 */
const MOVES: [string, string][] = [
  ['kvizhub-', 'lore-'],
  ['jiskra.', 'lore.'],
];

export function migrateLegacyStorage() {
  for (const get of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const store = get();
      const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => !!k);
      for (const key of keys) {
        const move = MOVES.find(([from]) => key.startsWith(from));
        if (!move) continue;
        const next = move[1] + key.slice(move[0].length);
        if (store.getItem(next) === null) store.setItem(next, store.getItem(key) ?? '');
        store.removeItem(key);
      }
    } catch {
      /* storage blocked: nothing to move */
    }
  }
}
