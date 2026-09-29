# Pravidla pro agenty (Claude, Codex, …)

Na tomhle repozitáři pracuje víc agentů a střídají se. Tenhle soubor je pro ně;
Zdeněk (učitel, majitel) ho číst nemusí.

## Adresáře — tohle je nejdůležitější

| cesta | co to je | smí se v tom sestavovat? |
|---|---|---|
| `~/kviz` | **ostrá verze, běží z ní server** (port 3010) | **NE**, jen `./nasad.sh` |
| `~/kviz-demo` | demo (port 3011) | ano, přes `~/obnov-demo.sh` |
| `~/kviz-prace` | worktree Claude, větev `prace/kviz` | ano |
| `~/kviz-codex` | worktree Codex, větev `codex/kviz` | ano |

Server si úvodní stránku drží v paměti od startu a odkazuje na soubory
s otiskem v názvu (`assets/index-<hash>.js`). Když v `~/kviz` spustíš `pnpm build`,
staré soubory zmizí, prohlížeč sáhne po neexistujícím a **aplikace se přestane
načítat, aniž by server spadl** — `/healthz` dál hlásí ok. Stalo se to 29. 9. 2026
uprostřed vyučování. Sestavuj jen ve svém worktree.

## Než něco předáš dál

```
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e
```

Všechno musí být zelené. `pnpm test:e2e` potřebuje `pnpm build` (server servíruje
`apps/web/dist`) a zabere ~4 minuty. Když e2e selže na obsazeném portu 3210,
zůstal po předchozím běhu server — najdi ho přes `ss -ltnp | grep 3210` a ukonči.

## Nasazení

Nasazuje **jen jeden agent a jen na výslovné zadání**. Postup:

```
cd ~/kviz && git merge --ff-only <vetev> && ./nasad.sh && git push origin main
```

`nasad.sh` zálohuje databázi, sestaví a **restartuje** — proto po něm index.html
i soubory sedí. Restart ukončí běžící hry, takže ne během vyučování.

Demo: `cd ~/kviz-demo && git fetch && git reset --hard origin/main && pnpm build && ~/obnov-demo.sh`.
Na demo jde nasadit i větev (náhled pro Zdeňka) — pak místo `origin/main` použij
`origin/<vetev>` a po schválení vrať demo na `main`.

Po každém nasazení ověř, že stránka odkazuje na existující soubor:

```
A=$(curl -s https://lore.zdenekstasta.cz/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
curl -s -o /dev/null -w "%{http_code}\n" "https://lore.zdenekstasta.cz/$A"   # musí být 200
```

## Střídání agentů

- Každý pracuje **na své větvi ve svém worktree**, nikdy v cizím.
- `git stash` je sdílený přes všechny worktree. Nepoužívat holé `git stash pop` —
  radši dočasný commit na vlastní větvi.
- Předání jde přes GitHub: `git push origin <vetev>`, druhý si ji vyzvedne.
- Než začneš, `git fetch` a podívej se, jestli na `main` nepřibylo cizí.
- Větev po sloučení smaž, ať se omylem nenasadí stará (`git merge --ff-only`
  na sloučenou větev projde jako „Already up to date" a nasadí starý stav).

## Co v aplikaci nerozbít

- **Ochrana osobních údajů žáků.** Aplikace záměrně neukládá jména žáků, jen
  školní login (`novak12`) a číslo ve výkazu. Souřadnice správných odpovědí
  a osobní kódy se k žákovi nesmí dostat před vyhodnocením — hlídají to testy
  v `apps/server/test/security-classes.test.ts` a `packages/core/test`.
- **Registrace je na ostré vypnutá** (`ALLOW_REGISTRATION=0`), účet je jeden.
- **Klientský vstup `@kvizhub/core/client` je bez zod** kvůli velikosti balíku
  pro žákovské telefony. Učitelské obrazovky používají plný `@kvizhub/core`.
- Texty jsou česky v `apps/web/src/locales/cs.json`, v kódu jen klíče.

## Jak psát

- Komentáře a commit messages česky, kód anglicky (názvy proměnných v obou —
  drž se toho, co je v souboru kolem).
- Komentář vysvětluje **proč**, ne co. Viz existující kód.
- Ke každé opravě chování test, který by bez ní spadl.
