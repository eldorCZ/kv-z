# Rozhodnutí

Rozhodnutí, která zadání neurčovalo. Každé je popsané jednou větou (rozhodnutí a důvod).

## Architektura a stack

- **Workspace balíčky se nekompilují zvlášť.** `packages/core` a `packages/export` exportují zdrojové TypeScript soubory. Vite, Vitest i tsx je čtou přímo a server se pro produkci sbalí přes esbuild do `dist/index.js`, takže odpadá krok sestavení balíčků a mapování `.d.ts`.
- **Migrace databáze jsou ručně psané SQL soubory řízené přes `PRAGMA user_version`** a Drizzle slouží jen jako query builder. Nepotřebujeme tak `drizzle-kit`, schéma je čitelné v jednom souboru a jde snadno přepsat pro Postgres.
- **Identifikátory jsou náhodné řetězce base64url (12 bajtů), ne autoinkrement,** aby ID kvízů a her v URL nešlo uhodnout.
- **Session jsou uložené v tabulce `sessions` (hash ID, expirace 30 dní).** Datový model tabulku nezmiňoval, ale bez ní by nešlo spolehlivě odhlásit ani zneplatnit přihlášení.
- **UI používá stejné `/api/v1` jako agent.** Přihlášený učitel má všechna oprávnění včetně `quizzes:approve`, mutace z prohlížeče ale musí nést CSRF token (HMAC ID session). API tak existuje jen jednou.
- **Pro UI je navíc několik endpointů mimo kontrakt:** seznam kvízů, `PATCH`/`DELETE` kvízu, klonování, `PUT /order`, duplikace otázky, `approve`, `approve-ok`, `export-summary`, seznam her, `results.csv` a `end`. Rozšiřují kontrakt, nemění ho.
- **Tokeny nemohou oprávnění `quizzes:approve` získat vůbec** (ne jen „standardně nemají“). Tím je pravidlo 2.5 vynucené na serveru bez výjimek.
- **API token má tvar `khp_` + 32 náhodných bajtů,** aby byl v logu nebo úniku snadno rozpoznatelný.
- **Rate limity jsou vlastní jednoduchý limiter v paměti (pevné okno)** místo `@fastify/rate-limit`. Limit na token se musí vyhodnotit až po ověření tokenu a aplikace běží jako jedna instance.
- **Cookie session má `SameSite=Lax`.** Se `Strict` by odkaz `reviewUrl` otevřený z Telegramu nenesl cookie a učitel by se musel znovu přihlašovat; mutace chrání CSRF token.
- **Registrace je ve výchozím stavu zapnutá (`ALLOW_REGISTRATION=1`),** aby šel první účet založit bez konzole. README doporučuje ji potom vypnout.
- **Nový učitel dostane ukázkový kvíz (`SEED_SAMPLE_QUIZ=1`)** a může hned vyzkoušet kontrolu, hru i exporty.

## Kontrakt

- **Chyby mimo validaci (401, 403, 404, 409, 429, 500) mají tvar `{error, code}`,** 422 má tvar `{errors:[…]}` podle kontraktu, aby agent i UI mohly zprávy přímo zobrazit.
- **`id` otázky je v kontraktu volitelné pole:** při `POST` se ignoruje a `GET ?format=json` ho vrací (agent ho potřebuje pro `PATCH`), takže odpověď `GET` jde znovu poslat přes `POST`. Čistý export ke stažení (`&download=1`) ID neobsahuje.
- **`bloom`, `difficulty` a `sourceRef` jsou volitelné (mohou být `null`),** protože ručně vytvořené otázky v editoru je nemají. Agent je podle SKILL.md vyplňuje vždy.
- **U typu `order` je povoleno 3–5 položek** (zadání počet neurčovalo; méně než 3 nedává smysl, 5 je limit možností).
- **`PATCH` otázky aplikuje jen poslaná pole, sloučenou otázku validuje celou a při změně typu vymaže typově specifická pole, která nebyla poslána.**
- **Když `PATCH` přes token mění `flagged` na `ok`, vrátí 403** (pravidlo 2.5). U přihlášeného učitele se taková změna počítá jako schválení.
- **Idempotence:** otisk požadavku je SHA-256 kanonického JSON těla (seřazené klíče) a původní odpověď se ukládá u kvízu. Opakovaný požadavek s týmž klíčem a obsahem vrátí přesně původní 201.
- **Hlavička `X-Export-Summary` je JSON s ne-ASCII znaky escapovanými jako `\uXXXX`,** protože HTTP hlavičky musí být ASCII. `JSON.parse` je vrátí zpět.

## Hra

- **Hru vytváří REST (UI i API), ne socketová událost `create_game`.** Hostitel se k existující hře připojí událostí `host_attach {gameId, hostKey}` a učitel přihlášený v aplikaci může i bez klíče, podle cookie. Oprávnění se tak řeší na jednom místě.
- **Událost hráče pro opětovné připojení se jmenuje `reconnect_player`,** protože `reconnect` je v klientovi Socket.IO vyhrazená událost Manageru.
- **`hostKey` je ve fragmentu URL (`/host/{id}#key=…`),** takže se nedostane do logů serveru, proxy ani do hlavičky Referer. Stránka projektoru ho po načtení uloží do sessionStorage a z adresy odstraní.
- **Po uplynutí času nebo po odpovědi všech připojených hráčů se odpověď odhalí automaticky.** Enter ji odhalí dřív a mezerník posouvá hru dál (odhalení → žebříček → další otázka).
- **Po poslední otázce se žebříček nezobrazuje a hra jde rovnou na pódium.**
- **Míchání možností je pro všechny hráče ve hře stejné,** aby projektor a telefony ukazovaly stejné pořadí a tvary. U `truefalse` se nemíchá. U `order` se položky vždy zamíchají tak, aby nikdy nebyly ve správném pořadí.
- **Úspěšnost otázky ve výsledcích = počet správných / počet hráčů ve hře** (kdo neodpověděl, počítá se jako špatně) a průměrný čas se počítá jen z odeslaných odpovědí.
- **Při shodě skóre mají hráči stejné pořadí** (např. 1, 2, 2, 4).
- **Bonus za sérii = +100 za každou další správnou odpověď v řadě (druhá v řadě +100, …), max. +500;** u přeskočené otázky se body i série vrátí.
- **Částečné body u `multi` = (správně zvolené − špatně zvolené) / počet správných,** oříznuto na 0..1.
- **Krátká odpověď ignoruje koncovou interpunkci a ve výchozím stavu i diakritiku,** 1 překlep se toleruje u odpovědí delších než 5 znaků (Levenshtein).
- **Dokončená hra zůstane v paměti ještě 10 minut** (hráči po obnovení stránky uvidí pódium), její PIN se ale uvolní hned.
- **Rozehrané hry se po restartu serveru označí jako `aborted`,** protože živý stav je podle zadání jen v paměti.
- **Pozastavená hra (odpojený hostitel) odmítá odpovědi a po návratu hostitele se čas otázky prodlouží o dobu pauzy.**
- **Maximální počet hráčů ve hře je 500.**
- **Filtr vulgarit porovnává text bez diakritiky, s běžnými záměnami znaků (0→o, 4→a, …) a se sloučenými opakovanými písmeny.** Slova s 5 a více znaky hledá i uvnitř přezdívky, kratší jen jako celá slova, aby neblokoval běžná jména. Seznam je v `packages/core/data/profanity.json`.

## Exporty

- **Šablonu Kahoot nešlo stáhnout (síťová politika prostředí blokuje support.kahoot.com),** proto je v repozitáři rekonstrukce. Export hledá hlavičky podle textu, takže oficiální soubor jde vložit bez změny kódu (viz README, [OVĚŘ]).
- **Otázky delší než limit Kahootu se do xlsx nezapíšou vůbec (nezkracují se)** a vypíšou se v souhrnu; stejně se vynechají `multi` s 5 možnostmi (Kahoot bere max. 4).
- **V GIFT je vysvětlení jako obecná zpětná vazba `####`,** která funguje u všech typů otázek. Odpovědi uvnitř bloku jsou každá na vlastním řádku.
- **U `multi` v GIFT se váha správných odpovědí zaokrouhlí na nejbližší hodnotu, kterou Moodle přijímá** (např. 33,33333) a špatné mají −100 %.
- **CSV výsledků používá středník a UTF-8 BOM** (kvůli českému Excelu) a hodnoty začínající `= + - @` dostanou prefix `'` (ochrana proti vložení vzorce).

## Frontend

- **Automatické ukládání v editoru otázky:** změna se validuje stejným zod schématem jako na serveru. Platný stav se po 800 ms odešle přes `PATCH`, neplatný se neodešle a ukáže chyby. Rozpracovaný koncept je v localStorage, dokud se neuloží.
- **Pořadí otázek jde měnit přetažením (HTML5 drag & drop) i tlačítky ▲▼** (kvůli klávesnici a dotykovým zařízením).
- **„Schválit všechny v pořádku“ označí otázky ve stavu `ok` jako zkontrolované učitelem (`approved_at`)** a otázky ve stavu `flagged` nemění, protože ty se schvalují jednotlivě.
- **QR kód se generuje v prohlížeči (knihovna `qrcode` je v bundlu)** a aplikace nepoužívá žádné externí služby ani CDN.

## Provoz

- **Build stage v Dockerfile používá plný image `node:22-bookworm`** (obsahuje python3 a g++ pro případný překlad `better-sqlite3`), runtime je `node:22-bookworm-slim` s uživatelem `node`.
- **Kontejner má read-only systém souborů a zapisuje jen do volume `/data` a tmpfs `/tmp`.**
- **Záloha používá `VACUUM INTO` přes `better-sqlite3` uvnitř kontejneru,** takže na hostiteli není potřeba `sqlite3` a aplikaci není nutné zastavit.
- **Retenční úloha maže i expirované session a záznamy audit logu starší než `RETENTION_DAYS`.**

## Skill (část B)

- **Pravidla kontraktu jsou v Pythonu zrcadlená (`scripts/contract.py`) a test je porovnává se stejnými fixtures jako server,** protože požadované závislosti skillu neobsahují knihovnu pro JSON Schema.
- **`post_quiz.py` odmítne odeslat kvíz, kde má některá otázka poznámku „citace nenalezena ve zdroji“** (návratový kód 2). Pravidlo „s nenalezenou citací otázku neodesílá“ tak vynucuje skript, ne jen agent.
- **Idempotency-Key = SHA-256 z hashů zdrojových souborů, názvu, ročníku, jazyka, počtu otázek a volitelného `--params`.** Nový kvíz ze stejných podkladů vytvoří až přepínač `--new-key`.
- **Pracovní adresář je `${CLAUDE_SKILL_DIR}/work/<datum-čas>`** a skripty se volají přes `${CLAUDE_SKILL_DIR}/.venv/bin/python`. Cestu a proměnnou jsem ověřil v dokumentaci Claude Code (code.claude.com/docs/en/skills) a spolu s `allowed-tools` to umožní spouštět skripty bez potvrzování.
- **Extrakce DOCX považuje za nadpisy i styly „Title“ a „Název“ a české „Nadpis 1–3“** (Word v češtině).
- **U PDF bez záložek se stránky seskupují po 3 (průměrně méně než 2 000 znaků na stranu), jinak po 2.** Opakované řádky na začátku a konci aspoň poloviny stran se berou jako záhlaví nebo zápatí.

## Testovací režim (docs/TESTOVACI-REZIM.md)

- **Text „DODATEK: TESTOVACÍ REŽIM“ nebyl k dispozici, proto jsem specifikaci D0–D13 sestavil sám.** Vychází z milníku A-M6 a z odkazů v Dodatku 2 a číslování sekcí odpovídá těmto odkazům.
- **Režim se jmenuje `test`, `selfpaced` z původního kontraktu je přijímán jako synonymum,** takže původní kontrakt zůstává platný.
- **PIN je unikátní mezi živými hrami i otevřenými testy** a žák zadává PIN na stejné stránce `/play`. Aplikace test pozná přes `GET /play/test/lookup` a přesměruje na `/test`.
- **Studentské endpointy leží pod `/play/test` (ne `/api/v1`) a autorizují se hlavičkou `X-Player-Token`,** takže se nemíchají s tokeny učitelů ani s CSRF.
- **Token pokusu je v localStorage (ne sessionStorage),** aby žák po zavření prohlížeče pokračoval ve stejném pokusu. U živé hry zůstává sessionStorage.
- **Jméno žáka se ukládá do `players.nickname`** (žádný nový sloupec). Po `TEST_NAME_RETENTION_DAYS` se přepíše na „Žák N“.
- **Pořadí otázek a míchání možností se určí pro každý pokus zvlášť při připojení** a ukládá se k pokusu, takže se po obnovení stránky nemění.
- **Odpovědi testu používají stávající tabulku `answers`** (jedna na žáka a otázku, přepisuje se do odevzdání).
- **Tolerance po termínu je 5 s.** Úloha každých 5 s pokus po termínu odevzdá (`expired`) a každý požadavek žáka ho vyhodnotí i sám (líně).
- **Obsah testu se čte z aktuálního kvízu:** když učitel během testu upraví nebo smaže otázku, projeví se to. Neschválené otázky se nezobrazují.
- **Akce přehledu (povolit návrat, znovu otevřít, detail) jsou jen pro přihlášeného učitele,** API tokeny k nim nemají přístup.
- **Oprávnění `results:pii` je nový scope tokenu, token ho standardně nemá.** Bez něj jsou jména ve výsledcích testu nahrazena „Žák N“ (D3.5).
- **„Povolit návrat“ platí jednou:** další připojení se stejným jménem převezme pokus a starý token přestane platit.

## Hlídání opuštění okna (Dodatek 2)

- **Dodatek 2 mění dvě pravidla testovacího režimu:** „Bez proctoringu“ (D9) a „Nepřidávat proctoring“ (D13) nově nahrazuje hlídání okna podle G1, G9 a G11. V docs/TESTOVACI-REZIM.md jsou původní body přeškrtnuté s odkazem na nová pravidla.
- **Stavový automat klienta (`LeaveTracker`) je v `packages/core`,** protože nezávisí na frameworku a jde testovat s vymyšlenými událostmi. Na napojení na DOM stačí malý modul `apps/web/src/leave-guard-client.ts`.
- **Důvod opuštění je nejdřívější z aktivních signálů:** blur, na který po 100 ms naváže hidden, se zapíše jako `blur`.
- **`seq` událostí začíná hodnotou `Date.now()` při startu stránky,** aby zůstal unikátní i po obnovení stránky. Server ho drží v unikátním indexu (idempotence).
- **Duplicitní `leave_start` během už otevřeného opuštění se uloží jen jako technický řádek s `seq`** (typ `leave_start_dup`, na časové ose se neukazuje), aby opakované doručení zůstalo idempotentní.
- **Nová stránka po obnovení pošle hned `leave_end`,** aby uzavřela opuštění, které otevřela předchozí stránka při `pagehide`. Když žádné otevřené není, server ho ignoruje.
- **Beacon při skrytí stránky nemaže frontu:** stejné události se po návratu pošlou znovu běžným voláním a server je díky `seq` započítá jen jednou.
- **Heartbeat běží při každém rozpracovaném pokusu** (i s vypnutým hlídáním), protože zároveň synchronizuje zbývající čas. Mezery se ale zapisují jen při zapnutém hlídání a bez výjimky.
- **Mezera v heartbeatu se nezobrazí, pokud se časově překrývá s opuštěním, které klient nahlásil** (G4.4).
- **Zamčený pokus vrací na `GET /play/test/attempt`, uložení i odevzdání 423 bez otázek.** Vypršení termínu ho odevzdá normálně (čas běží dál, G4.5).
- **Kompenzace při odemknutí (+N minut) posune `deadline_at` jen u rozpracovaného pokusu,** vypršelý pokus se znovu otevírá přes „Znovu otevřít“ (D5.8).
- **„Nad limitem“ (zvýraznění a `summary.leaveFlagged`) se počítá z `leave_total`** (všechna započtená opuštění), zámek z `leave_count` (od posledního odemknutí).
- **Výchozí hlídání (varovat, 2, upozornit) platí pro každý nový test,** i když ho vytvoří agent bez přepínačů. Tak to určuje G2.
- **Rate limit událostí a heartbeatu je 10 požadavků za sekundu na token,** ostatní požadavky žáka mají 20 za sekundu.

## Třídy a evidence (Dodatek 3)

Rozdíly mezi popisem v dodatku a skutečným kódem (platí kód):

- **`identityMode` z D2 v kódu neexistuje;** test má pole `requireName`. U třídní hry se identita určuje přítomností `classId` (identita „roster“) a `requireName` se ignoruje.
- **`games.snapshot_json` z D4 v kódu nebyl,** test četl otázky z aktuálního kvízu. Migrace 4 sloupec přidává a plní se jen u třídních her (živých i testů), takže chování testu bez třídy se nemění. Náhradní termín kopíruje snapshot původní hry.
- **Vyřazení otázky z hodnocení (D6.4) v kódu neexistuje,** proto se po něm nic nepřepočítává. `buildResultItems` ale množinu vyřazených otázek přijímá, takže ho jde později doplnit.
- **`players.display_name` je v kódu `players.nickname`.** U třídních her obsahuje `public_name`.
- **Počítání pořadí: `D5.5`/`D5.6` odpovídá v kódu `TestService.finalize`** (odevzdání `submitted` → výsledek `submitted`, vypršení `expired` → `auto_submitted`).
- **Test `ops.test.ts`, který kontroloval přesný seznam sloupců tabulky `players`, je upravený:** přibyly `student_id` a `is_guest` (C3), IP adresy dál nejsou.
- **`scoreQuestion` je vydělená z `scoreTest`.** Stejnou funkci používají testy, živé hry (pro evidenci) i `buildResultItems`.
- **Zaokrouhlení „půl nahoru“ používá `Math.floor(x + 0.5 + 1e-9)`,** aby hodnoty jako 62,5 nepadly kvůli plovoucí čárce dolů.
