# Testovací režim (specifikace D0–D13)

Tento dokument **nahrazuje chybějící text „DODATEK: TESTOVACÍ REŽIM“**. Sestavil ho kódovací agent z milníku A-M6
původního zadání („žák prochází kvíz sám přes odkaz do termínu; bez živého žebříčku, výsledky vidí učitel“)
a z odkazů v „Dodatku 2: hlídání opuštění okna“ (D2, D3.5, D5.6–D5.8, D6, D7, D8.1–D8.4, D9, D10, D11, D13).
Je to interpretace: pokud originální dodatek existuje a liší se, platí originál a rozdíly se zapíší do DECISIONS.md.

## D0 Postup
Milníky T-M0 až T-M6 (sekce D12), po každém testy a commit. Živá hra se nemění.

## D1 Cíl
Učitel spustí nad kvízem **test**: každý žák ho prochází sám na svém zařízení, vlastním tempem, s časovým
limitem na pokus a do termínu. Nic se nepromítá, žádný žebříček ani body za rychlost. Učitel sleduje průběh
v ovládacím panelu a vidí výsledky v procentech.

## D2 Nastavení testu (`games.settings_json.test`)
| pole | hodnoty | výchozí |
|---|---|---|
| `timeLimitMin` | 1–240 nebo `null` (bez limitu) | 20 |
| `opensAt` | ISO čas nebo `null` (hned) | `null` |
| `closesAt` | ISO čas (termín), musí být v budoucnu | za 7 dní |
| `requireName` | žák zadá jméno a příjmení (jinak jen přezdívku) | `true` |
| `allowBackNavigation` | návrat k předchozím otázkám | `true` |
| `showResultsToStudent` | `none` \| `score` \| `full` | `score` |
| `leaveGuard` | viz Dodatek 2 (G2) | – |

Dále platí společné `shuffleQuestions`, `shuffleOptions`, `partialMulti`, `ignoreDiacritics`.
Test se vytváří `POST /api/v1/quizzes/{id}/games` s `mode: "test"` (`"selfpaced"` je přijímán jako synonymum).
Validace přes zod v `packages/core` (`testSettingsSchema`).

## D3 Kontrakt (rozšíření sekce 2.4)
- **D3.1** `POST /api/v1/quizzes/{id}/games {mode:"test", settings:{test:{…}}}` → 201
  `{gameId, pin, joinUrl, qrUrl, dashboardUrl, questionCount}` (409 jako u živé hry, když není hratelná otázka).
- **D3.2** `GET /api/v1/games/{id}` → `{mode:"test", status, counts:{joined, inProgress, submitted, notStarted}, closesAt}`.
- **D3.3** `GET /api/v1/games/{id}/results` → `{mode:"test", summary:{students, submitted, avgPercent, medianPercent},
  students:[{student, percent, status, submittedAt}], perQuestion:[{questionId, number, prompt, successRate}]}`.
- **D3.4** `POST /api/v1/games/{id}/end` ukončí test: rozpracované pokusy se odevzdají a ohodnotí.
- **D3.5** Jména: pole `student` obsahuje jméno žáka jen pro přihlášeného učitele nebo token s oprávněním
  `results:pii` (token ho standardně nemá). Jinak `Žák N` (pořadí připojení). Agent na Telegramu `results:pii` nepotřebuje.

## D4 Datový model
`attempts(id, game_id, player_id UNIQUE, status[not_started|in_progress|submitted|expired], started_at, deadline_at,
submitted_at, allow_return, percent, score, max_score, question_ids_json, option_perms_json, created_at)`.
Odpovědi se ukládají do stávající tabulky `answers` (jedna na otázku a žáka, přepisuje se až do odevzdání).
Jméno žáka je v `players.nickname`.

## D5 Průběh
- **D5.1** Žák otevře `/play` (nebo QR `/play?pin=…`), zadá PIN; aplikace pozná test a vyžádá jméno.
  `POST /play/test/join {pin, name}` → `{playerToken}` (token jen v localStorage žáka).
- **D5.2** Úvodní obrazovka (název, počet otázek, limit, termín, pravidla). „Začít test“ → `POST /play/test/start`
  nastaví `deadline_at = min(now + timeLimit, closesAt)`.
- **D5.3** `GET /play/test/attempt` vrací otázky bez klíče (D11), uložené odpovědi a `remainingSec`.
- **D5.4** `PUT /play/test/answers/{questionId} {payload}` ukládá průběžně; po termínu (tolerance 5 s) 409.
- **D5.5** `POST /play/test/submit` odevzdá a ohodnotí; odpověď podle `showResultsToStudent`.
- **D5.6** Úloha každých 5 s: pokusy po `deadline_at` se automaticky odevzdají (`expired`), test po `closesAt`
  se uzavře (`finished`).
- **D5.7** „Povolit návrat“: učitel povolí žákovi znovu se připojit stejným jménem (např. jiné zařízení);
  další připojení převezme pokus (nový token, starý přestane platit). Bez povolení je jméno v testu obsazené.
- **D5.8** „Znovu otevřít pokus“: odevzdaný nebo vypršelý pokus se vrátí do `in_progress` s novým
  `deadline_at = now + N min` (1–60, výchozí 10). Odpovědi zůstávají.
- **D5.9** Odevzdaný pokus je neměnný (kromě D5.8).

## D6 Hodnocení
Pro každou otázku podíl 0–1 (`checkAnswer` z core, částečné body u `multi` podle `partialMulti`), váha
`standard` = 1, `double` = 2, `none` = 0. `percent = round(100 · Σ(podíl·váha) / Σ váha)`. Rychlost se nepočítá.
Funkce `scoreTest` v `packages/core`, čistá a testovaná.

## D7 Rozhraní žáka
1) PIN, 2) jméno, 3) úvodní obrazovka, 4) otázky jednotlivě s navigací (přehled otázek, zodpovězené označené),
automatické ukládání, časovač, 5) odevzdání s potvrzením (upozornění na nezodpovězené), 6) výsledek podle
nastavení. Po obnovení stránky pokračuje tam, kde byl. Mobile-first, texty přes i18n.

## D8 Rozhraní učitele
- **D8.1** Spuštění: v dialogu „Spustit“ volba „Živá hra“ / „Test“ s nastavením D2.
- **D8.2** Ovládací panel testu `/tests/{gameId}`: PIN a QR, tabulka žáků (stav, zodpovězeno x/n, zbývá času,
  procenta po odevzdání), akce Povolit návrat, Znovu otevřít, tlačítko Ukončit test. Obnovuje se každé 3 s.
- **D8.3** Detail žáka: odpovědi po otázkách (správně/špatně, zvolená odpověď).
- **D8.4** Tabulka výsledků a CSV (pořadí dle jména, procenta, stav, čas odevzdání, odpovědi).

## D9 Soukromí
Jména žáků jsou osobní údaje: v databázi jen `players.nickname`; po `TEST_NAME_RETENTION_DAYS` (výchozí 30) se
nahradí `Žák N`, výsledky zůstávají do `RETENTION_DAYS`. Nelogují se. ~~Bez proctoringu.~~ → Hlídání opuštění
okna podle Dodatku 2 (G1, G9): jen události stránky testu, žák je předem informován.

## D10 Skill
`post_quiz.py --game <quizId> --mode test [--time-limit N] [--closes-at ISO] [--show-results none|score|full]`.
Šablona po „výsledky testu“: „Test odevzdalo 24 z 27 žáků, průměr 72 %. Nejhůř zvládnuté otázky: …“.
Agent nikdy neposílá jména žáků.

## D11 Bezpečnost
Otázky pro žáka jen přes whitelist (`toPublicQuestion`): žádné `correctIndices`, `acceptedAnswers`,
`numericAnswer`, `numericTolerance`, `explanation`, `sourceRef` ani správné pořadí. Klíč a vysvětlení až po
odevzdání a jen při `showResultsToStudent: "full"`. Žák vidí jen svůj pokus (token). Rate limity na join a zápis.

## D12 Milníky
T-M0 specifikace, schémata, migrace · T-M1 backend žáka · T-M2 rozhraní žáka · T-M3 rozhraní učitele (panel, detail) ·
T-M4 výsledky, CSV, kontrakt, skill · T-M5 retence jmen, dokumentace · T-M6 zpevnění a e2e.

## D13 Mimo rozsah
Týmy, banky otázek, ruční hodnocení otevřených odpovědí, známky. ~~Nepřidávat proctoring.~~ → Platí Dodatek 2
(G1, G9, G11): hlídání opuštění okna bez kamery, mikrofonu, snímků obrazovky a čtení schránky.
