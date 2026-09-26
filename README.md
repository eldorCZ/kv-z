# KvizHub

Aplikace pro kvízy ve třídě, která běží na vašem vlastním serveru, a k ní skill pro agenta na Telegramu.

Učitel pošle soubor (DOCX, PDF, PPTX) svému agentovi. Agent z něj vyrobí kvíz, u každé otázky uvede zdroj
(soubor, stranu nebo slide a doslovnou citaci), otázky strojově zkontroluje a vloží je přes API do KvizHubu.
Učitel kvíz v KvizHubu zkontroluje a upraví a spustí hru: žáci se připojí PINem nebo QR kódem na telefonu,
žebříček běží na projektoru. Kvíz jde exportovat do Kahootu, Moodlu (GIFT) nebo do JSON.

- **Zdroj u každé otázky.** Agent citaci strojově ověří a učitel ji vidí u otázky.
- **Otázky s výhradou** (stav „ke kontrole“, `flagged`) se do hry ani exportu nedostanou, dokud je učitel neschválí.
  Agent je schválit nemůže.
- **Data zůstávají na vašem serveru.** Žáci nemají účty ani hesla. U hry bez třídy se ukládá jen přezdívka a odpovědi;
  u volitelných **tříd** (průběžná evidence za školní rok) jen školní přihlašovací jméno žáka (např. `novak12`, nebo
  pseudonym či číslo), číslo v třídním výkazu, hash osobního kódu a výsledky. Žádná křestní ani celá jména. Pokrok vidí jen učitelé třídy, nikdy agent ani Telegram (viz [Třídy](#třídy-a-průběžná-evidence)).
- **6 typů otázek:** jedna správná, více správných, pravda/nepravda, krátká odpověď, číselná odpověď a seřazení.
- **Aplikace nevolá žádný jazykový model.** Otázky vyrábí agent (skill `kviz-z-materialu`). Kvíz jde vytvořit
  i bez agenta, ručně v editoru nebo nahráním JSON.

```
Učitel ──Telegram──> Agent (Claude Code, skill kviz-z-materialu)
                       extract.py → tvorba otázek → validate_quiz.py + slepé řešení → post_quiz.py
                                                                     │ POST /api/v1/quizzes (Bearer token)
                                                                     ▼
                                                 KvizHub (Docker, jeden kontejner)
                                  kontrola a úpravy · hra (Socket.IO) · exporty · výsledky
```

## Spuštění (3 příkazy)

```bash
cp .env.example .env && sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
docker compose up -d --build
curl -s http://127.0.0.1:3000/healthz    # {"status":"ok",...}; pak otevřete http://127.0.0.1:3000 a zaregistrujte se
```

Kontejner naslouchá jen na `127.0.0.1:3000`. Pro přístup žáků ze školní Wi‑Fi je potřeba HTTPS na doméně
(viz [Nasazení na sdíleném VPS](#nasazení-na-sdíleném-vps-s-https)).

Ukázka bez Dockeru (Node.js 22, pnpm): `pnpm install && pnpm demo`. Skript spustí dočasný server, přes API vloží
vzorový kvíz, odehraje hru s pěti simulovanými hráči a vypíše výsledky.

## Konfigurace (`.env`)

| Proměnná | Výchozí | Význam |
|---|---|---|
| `PUBLIC_URL` | `http://localhost:3000` | Veřejná adresa (z ní se skládají odkazy `reviewUrl`, `joinUrl`, `hostUrl` a QR kód). Za proxy např. `https://kviz.skola.cz`. |
| `SESSION_SECRET` | – | Min. 32 znaků, povinné v produkci. `openssl rand -hex 32`. |
| `BIND_ADDR` / `APP_PORT` | `127.0.0.1` / `3000` | Adresa a port na hostiteli, kde kontejner naslouchá. |
| `GAME_PIN_LENGTH` | `6` | Délka PINu hry. |
| `RETENTION_DAYS` | `365` | Po kolika dnech se mažou výsledky her a hráči. Kvízy zůstávají. |
| `HEARTBEAT_GAP_SEC` | `25` | Hlídání okna: výpadek heartbeatu delší než N s se zapíše jako nepotvrzená nepřítomnost (nepočítá se). |
| `TEST_NAME_RETENTION_DAYS` | `30` | Testovací režim: po kolika dnech se jména žáků nahradí „Žák N“ (výsledky zůstávají). |
| `API_WEBHOOK_URL` / `API_WEBHOOK_SECRET` | – | Webhook po skončení hry: `POST {gameId, quizId, status:"finished"}`, hlavička `X-KvizHub-Signature: sha256=<HMAC-SHA256 těla>`. |
| `EXPORT_KAHOOT_MAX_Q` / `EXPORT_KAHOOT_MAX_A` | `95` / `60` | Délkové limity exportu do Kahootu (otázka / odpověď). |
| `ALLOW_REGISTRATION` | `1` | `0` vypne registraci nových učitelů. Po založení vlastního účtu doporučeno. |
| `AUTH_PROVIDER` | `local` | `local` (e‑mail + heslo). `oidc` zatím existuje jen jako rozhraní pro pozdější Microsoft Entra ID. |
| `TRUST_PROXY` | `1` | Aplikace běží za reverzní proxy a čte IP adresu z `X-Forwarded-For` (kvůli rate limitům). |
| `JOIN_RATE_LIMIT` / `API_RATE_LIMIT` | `10` / `60` | Pokusy o připojení do hry za minutu na IP adresu / požadavky API za minutu na token. |
| `CODE_PEPPER` | – | Tajný klíč pro hash osobních kódů žáků, min. 32 znaků (`openssl rand -hex 32`). **Bez něj jsou třídy vypnuté.** Změna zneplatní všechny kódy. |
| `CLASS_RETENTION_MONTHS` | `12` | Po kolika měsících od konce školního roku (nebo archivace, je-li pozdější) se osobní údaje třídy anonymizují. |
| `ACCESS_LOG_RETENTION_MONTHS` | `24` | Jak dlouho se drží přístupový log tříd. |
| `MIN_TOPIC_ITEMS` | `5` | Kolik odpovědí je potřeba, než se ukáže zvládnutí tématu (u třídy trojnásobek a aspoň 3 žáci). |
| `MIN_AGGREGATE_STUDENTS` | `5` | Pod tento počet žáků nebo výsledků vrací API souhrnů místo čísla `null` („malá skupina“). |
| `MAX_STUDENTS_PER_CLASS` | `60` | Horní mez velikosti soupisky. |

Pozor: pokud je celá třída za jednou veřejnou IP (NAT školy) **a** proxy nepředává `X-Forwarded-For`,
narazí žáci na limit 10 připojení za minutu. Caddy tuto hlavičku předává automaticky.

## API token pro agenta

1. Přihlaste se do KvizHubu → **API tokeny** → **Vytvořit token** (výchozí oprávnění: `quizzes:write`,
   `quizzes:read`, `games:write`, `games:read`).
2. Token se zobrazí **jen jednou**, v databázi je uložen jen jeho SHA-256 otisk. Zkopírujte ho do proměnné
   `KVIZHUB_TOKEN` na serveru agenta. Nikdy ho neposílejte do chatu.
3. Oprávnění schvalovat otázky (`quizzes:approve`) token dostat nemůže. Schvaluje jen učitel v aplikaci.
   Oprávnění `results:pii` (jména žáků ve výsledcích testu) token standardně nemá. Agent na Telegramu ho nepotřebuje.
4. Token jde kdykoli odvolat. V seznamu uvidíte, kdy byl naposledy použit. Každé volání API se zapíše do audit logu
   (čas, token, endpoint, stav, bez obsahu).

Přehled API: `GET /api/v1/openapi.json` (generováno ze zod schémat). Hlavní endpointy:

| Metoda | Cesta | Popis |
|---|---|---|
| POST | `/api/v1/quizzes[?dry_run=1]` | Vložení kvízu (hlavička `Idempotency-Key` doporučena). 201 `{quizId, reviewUrl, stats}`, 422 `{errors:[{path,code,message}]}` |
| GET | `/api/v1/quizzes/{id}?format=json\|kahoot\|gift[&includeFlagged=1]` | Kvíz nebo export, souhrn v hlavičce `X-Export-Summary` |
| POST/PATCH/DELETE | `/api/v1/quizzes/{id}/questions[/{qid}]` | Přidání, úprava a smazání otázky |
| POST | `/api/v1/quizzes/{id}/games` | Hra → `{gameId, pin, joinUrl, hostUrl}` (409, když jsou všechny otázky ke kontrole) |
| GET | `/api/v1/games/{id}`, `/api/v1/games/{id}/results` | Stav a výsledky hry |

## Testovací režim

Kromě živé hry jde kvíz zadat jako **test**. Každý žák ho prochází sám na svém zařízení, vlastním tempem,
s časovým limitem a do termínu. Nic se nepromítá a body za rychlost se nepočítají, výsledek je v procentech.
Specifikace je v [docs/TESTOVACI-REZIM.md](docs/TESTOVACI-REZIM.md).

- **Spuštění:** v kvízu **Spustit hru**, pak **Test**. Nastavíte limit v minutách, termín uzavření, zda žák zadává
  jméno a příjmení, návrat k předchozím otázkám a co žák uvidí po odevzdání (nic, procenta, nebo procenta
  se správnými odpověďmi). Přes API: `POST /api/v1/quizzes/{id}/games {"mode":"test","settings":{"test":{…}}}`.
- **Žáci:** otevřou `/play` nebo QR kód a zadají PIN. Aplikace pozná test a vyžádá jméno. Odpovědi se ukládají
  průběžně. Po obnovení stránky nebo výpadku Wi‑Fi žák pokračuje tam, kde skončil (technický token je
  v localStorage). Po vypršení limitu se test odevzdá sám.
- **Přehled testu** (`/tests/{id}`, jen pro učitele): stav žáků, zbývající čas a procenta. Akce: **Povolit návrat**
  (stejné jméno z jiného zařízení převezme pokus), **Znovu otevřít** (+N minut), **Ukončit test**.
  Detail žáka ukáže jeho odpovědi.
- **Výsledky:** průměr, medián, úspěšnost po otázkách a export CSV. Agent dostane jen souhrn bez jmen.
- **Hodnocení:** každá otázka dá 0–1 (u „více správných“ volitelně částečně). Váha je standard 1, dvojnásobné
  body 2, bez bodů 0. Procenta = součet / maximum.

### Hlídání opuštění okna (v testu)

Když žák během testu opustí okno testu, učitel se to dozví. Opuštěním se myslí přepnutí karty nebo aplikace,
minimalizace, zamknutí obrazovky, klik do jiného okna nebo vystoupení z celé obrazovky. Aplikace pak zareaguje
podle nastavení v sekci **Hlídání okna** při spuštění testu:

| nastavení | hodnoty | výchozí |
|---|---|---|
| režim | vypnuto / jen zaznamenávat / zaznamenávat a varovat | varovat |
| tolerovaná opuštění | 0–10 (reakce nastane při dalším započteném) | 2 |
| po překročení | upozornit učitele (test běží dál) / zamknout test | upozornit |
| nepočítat kratší než | 0,5–5 s | 1 s |
| vyžadovat celou obrazovku | jen kde to zařízení umí (ne iPhone) | ne |

Žák se o hlídání dozví na úvodní obrazovce, a to i v režimu „jen zaznamenávat“. Po návratu do okna vidí
varování, které musí potvrdit. Zamčený test čeká na učitele: v přehledu testu je **Odemknout** (volitelně
s kompenzací +N minut) a **Nehlídat okno** (výjimka pro jednoho žáka, např. kvůli asistenčním pomůckám).
Čas testu běží i během zámku. Učitel vidí u žáka počet opuštění, dobu mimo okno a časovou osu událostí.
Mezery v heartbeatu (výpadek Wi‑Fi nebo uspaný telefon) se zobrazí jako „nepotvrzená nepřítomnost“ a
nepočítají se.

**Poctivé limity:**

- Webová stránka nemůže opuštění okna **zabránit**, jen ho zjistit. Skutečnou izolaci zařízení zajistí správa
  zařízení: režim kiosku přes Intune nebo Guided Access (Asistovaný přístup) na iPadu [OVĚŘ konkrétní postup
  u správce školních zařízení].
- Aplikace **nepozná** druhé zařízení (telefon vedle notebooku), papírové taháky, spolužáka, snímek obrazovky,
  rozdělenou obrazovku nebo plovoucí okno, které stránku neodebere z popředí, ani upraveného klienta
  (JavaScript v prohlížeči lze obejít).
- **Falešné poplachy** jsou možné: oznámení, systémové dialogy, ztráta zaostření při zobrazení klávesnice.
  Krátké obnovení stránky se také zaznamená, ale kvůli limitu 1 s se většinou nezapočítá. Proto výchozí reakce
  nic automaticky neznehodnotí a o důsledcích rozhoduje učitel. **Procenta se kvůli opuštění okna nikdy
  nesnižují** a test se kvůli tomu nikdy automaticky neodevzdá.

**Soukromí:** ukládá se jen typ události (skrytá stránka, ztráta zaostření, opuštění celé obrazovky), čas
a délka. Aplikace nezjišťuje obsah jiných oken a aplikací, nepořizuje snímky obrazovky, nepoužívá kameru
ani mikrofon, nečte schránku a neblokuje kopírování. Události se mažou spolu s výsledky (`RETENTION_DAYS`).
Agent na Telegramu dostane jen souhrnný počet žáků nad limitem, nikdy jména ani jednotlivé události.

**Ruční kontrolní seznam zařízení (G8).** Automaticky ověřit to nelze. Ověřeno zatím jen v Chromiu
(Playwright): simulace skrytí stránky a ztráty zaostření vyvolaná událostmi stránky. Na skutečných zařízeních
prosím doplňte:

| zařízení | akce | zjištěno (ano/ne) | jak rychle |
|---|---|---|---|
| notebook, Chrome/Edge | přepnutí karty | ano (simulace v Chromiu) | ihned |
| notebook, Chrome/Edge | Alt+Tab do jiné aplikace | ano (simulace ztráty zaostření) | po 0,3 s |
| notebook, Chrome/Edge | minimalizace okna | neověřeno | |
| notebook, Chrome/Edge | klik do jiného okna / na druhý monitor | neověřeno | |
| notebook, Chrome/Edge | F11 / Esc v celé obrazovce | neověřeno | |
| notebook, Chrome/Edge | otevření nástrojů vývojáře | neověřeno (zaostření často zůstane → pravděpodobně ne) | |
| notebook, Chrome/Edge | dělená obrazovka / plovoucí okno | neověřeno (známý limit) | |
| Android, Chrome | přepnutí do jiné aplikace | neověřeno | |
| Android, Chrome | zamknutí obrazovky | neověřeno | |
| Android, Chrome | stažení oznámení | neověřeno | |
| Android, Chrome | dělená obrazovka / plovoucí okno | neověřeno (známý limit) | |
| iPhone/iPad, Safari | přepnutí aplikace, zamknutí | neověřeno | |
| iPhone/iPad, Safari | celá obrazovka | iPhone ji nepodporuje (učitel vidí „celá obrazovka nepodporována“) | |

## Třídy a průběžná evidence

Třída je volitelná. Hra bez třídy funguje stejně jako dřív. Třídy se zapnou nastavením `CODE_PEPPER` v `.env`.

1. **Třídy → Nová třída** (např. „8.A Fyzika“, školní rok se doplní sám).
2. **Soupiska:** žák se v aplikaci jmenuje stejně jako jeho školní účet, bez domény (např. `novak12`). Vložte seznam
   (jeden žák na řádek: přihlašovací jméno nebo celá adresa `novak12@skola.cz`, volitelně číslo na začátku), nebo
   nahrajte CSV (středník, čárka i tabulátor, UTF‑8 i windows‑1250). Sloupec s přihlašovacím jménem se pozná podle
   názvu (`login`, `SamAccountName`, `ucet`, `UPN`), jinak je to první sloupec; volitelný sloupec `cislo`.
   **Soubor se zpracuje v prohlížeči** a na server se pošle jen přihlašovací jméno a číslo; ostatní sloupce
   (jména z exportu) se zahodí. Před zápisem uvidíte náhled (duplicity, neplatné znaky, limit třídy).
   Aplikace není napojená na Entra ID, Teams ani jiný školní systém; shoda se školním účtem je jen formální.
   Pokud škola nepovolí ani přihlašovací jména, vložte čísla nebo pseudonymy (např. `z12`); vše funguje stejně.

   Příklad exportu z Active Directory (OU třídy doplňte; správný atribut si ověřte [OVĚŘ]):
   ```powershell
   Get-ADUser -SearchBase "<OU třídy>" -Filter * | Select-Object @{n='login';e={$_.SamAccountName}} | Export-Csv 8A.csv -Delimiter ';' -Encoding UTF8 -NoTypeInformation
   ```
3. **Osobní kódy** (8 znaků, např. `K7MQ-2XRT`) se ukážou **jen jednou**: vytiskněte karty (A4, 10 na list, s QR kódem),
   nebo stáhněte CSV s kódy. Ztracený kód nahradíte tlačítkem „Nový kód“ (starý okamžitě přestane platit).
4. Při spuštění hry nebo testu vyberte **Třídu**. Žák zadá PIN, pak svůj kód a potvrdí „Jsi to ty, novak12?“.
   V živé hře vidí spolužáci a projektor přihlašovací jména, nebo „Žák <číslo>“, když to nastavíte ve třídě
   (Nastavení → Jména v živé hře). V testu žák nevidí nikoho. Učitel i ovládání přes `hostUrl` vidí přihlašovací jména.
5. Výsledky se zapisují do **evidence třídy**: matice žáci × aktivity (testy a kvízy zvlášť, „chybí“, „dopsáno“, „nezapočteno“),
   trend, účast, příznak „Ke sledování“ podle pevných pravidel, zvládnutí témat, nejslabší otázky, profil žáka s grafy,
   tisk (A4) a CSV. U testu jde vytvořit **náhradní termín** se stejnými otázkami jen pro nepřítomné.
   Do evidence jde jen správnost (ne body za rychlost) a hlídání okna procenta nikdy nesnižuje.

Aplikace počítá a zobrazuje, ale **nehodnotí**: žádné automatické známky ani závěry o žákovi.

Vyzkoušení bez skutečných žáků (jen mimo produkci): `pnpm seed:demo-class` vytvoří třídu s 24 pseudonymy
(`zak01` až `zak24`, čísla 1–24; přihlašovací jméno nesmí obsahovat mezeru) a 10 aktivitami a vypíše přihlašovací
údaje ukázkového učitele. Přepínač „Skrýt jména“ je v přehledech ukáže jako „Žák 1“ až „Žák 24“.

Agent (API token se scope `classes:read`) vidí jen názvy tříd a **souhrny** (průměry, účast, slabá témata); přihlašovací
jména, kódy ani výsledky jednotlivých žáků přes API nedostane (výsledky třídních her jako „Žák N“, jména jen se scope
`results:pii`). Soupisku lze vkládat jen v aplikaci.

## Osobní údaje žáků

**Co se ukládá:** přihlašovací jméno (školní účet bez domény, např. `novak12`, nebo pseudonym či číslo), číslo
v třídním výkazu, data „ve třídě od / do“, příslušnost ke třídě, **hash** osobního kódu (HMAC‑SHA256 s `CODE_PEPPER`)
a výsledky. Přihlašovací jméno obsahuje příjmení a v rámci třídy identifikuje dítě: jde o **pseudonymizovaný** osobní
údaj, ne anonymní.
**Co se neukládá:** křestní ani celá jména, doména účtu, poznámky o žácích, podpůrná opatření, zdravotní ani jiné citlivé údaje, e‑mail, datum narození,
rodné číslo, fotografie, IP adresy, identifikace zařízení. Aplikace nemá volné textové pole o žákovi.

- **Kódy:** otevřený kód se nikdy neukládá ani neloguje; posílá se jen v těle požadavku. Proto ho nejde zobrazit znovu,
  ale únik databáze nedá použitelné kódy. Po 20 chybných kódech za 5 minut se zadávání v dané hře na 60 s zablokuje
  a učitel vidí upozornění. **Změna `CODE_PEPPER` zneplatní všechny kódy** (bude třeba vytisknout nové karty).
- **Kdo co vidí:** žák jen přihlašovací jména spolužáků v živé hře (nebo „Žák <číslo>“), v testu nikoho, nikdy cizí kód;
  ovládání přes `hostUrl` jen přihlašovací jména; učitel s rolí ve třídě přihlašovací jména, čísla a výsledky;
  agent jen souhrny; Telegram nic z toho.
- **Přístupový log:** zobrazení soupisky, matice a profilu, tisk, export, rotace kódů a výmaz se zapisují
  (jen metadata). Vlastník třídy ho vidí v Nastavení třídy. Retence `ACCESS_LOG_RETENTION_MONTHS`.
- **Retence:** po `CLASS_RETENTION_MONTHS` od konce školního roku se třída anonymizuje: přihlašovací jména a kódy se smažou,
  výsledky zůstanou jen jako nespojitelné souhrny a hráči ve výsledcích her se přejmenují na „Žák N“. Datum je vidět
  v přehledu třídy a vlastník může anonymizovat dříve. Přepínač „Skrýt jména (promítání)“ v přehledech nahradí
  přihlašovací jména označením „Žák <číslo>“. Mazání her podle `RETENTION_DAYS` evidenci nemění.
- **Výmaz:** „Smazat osobní údaje“ u žáka (vlastník) smaže přihlašovací jméno a kód, výsledky se odpojí. „Smazat třídu“ smaže
  i evidenci. „Žák odešel“ je jen deaktivace (kód přestane platit).
- **Zálohy** obsahují osobní údaje: šifrujte je (`BACKUP_AGE_RECIPIENT` nebo `BACKUP_GPG_RECIPIENT`, viz
  [Zálohování](#zálohování)) a držte je nejvýš 30 dní, aby po anonymizaci nezůstávaly starší kopie.
- **Účty učitelů:** heslo aspoň 12 znaků, omezení pokusů o přihlášení, relace nejvýš 12 hodin a 60 minut bez aktivity.
  Dvoufázové přihlášení je možné pozdější rozšíření.

### Kontrolní seznam před ostrým použitím

Není to právní posudek a nenahrazuje rozhodnutí školy.

- [ ] **Souhlas vedení školy a konzultace s pověřencem pro ochranu osobních údajů:** kdo je správce údajů a na jakém
      právním základě se evidence vede.
- [ ] **Informování žáků a zákonných zástupců** (vzor níže si škola upraví).
- [ ] **Umístění serveru a smlouva s poskytovatelem VPS** (zpracovatelská smlouva, region datového centra).
      [OVĚŘ region a podmínky u poskytovatele.]
- [ ] **Přihlašovací jméno obsahuje příjmení**, pro školu jde o (pseudonymizovaný) osobní údaj. Když škola nepovolí
      ani to, vložte místo přihlašovacích jmen čísla nebo pseudonymy; aplikace funguje stejně a párování se žáky
      zůstane u učitele mimo aplikaci.
- [ ] **Přístupy:** kdo zná heslo učitele, kdo má přístup na VPS; šifrované zálohy a doba jejich uchování.
- [ ] **Postup při úniku údajů** a kontakt na pověřence.

### Vzor informace pro žáky a zákonné zástupce

> Ve výuce předmětu **[předmět]** používáme aplikaci KvizHub, která běží na serveru školy / pronajatém serveru
> **[kde]**. Pro třídu **[třída]** v ní vedeme průběžný přehled výsledků kvízů a testů, abychom viděli, která témata
> je potřeba zopakovat. Ukládáme jen školní přihlašovací jméno žáka (bez jména a příjmení), číslo v třídním výkazu
> a výsledky. Žáci v aplikaci nemají účty; přihlašují se osobním kódem z karty. Výsledky vidí jen vyučující třídy,
> spolužáci vidí v kvízu nanejvýš přihlašovací jméno (nebo „Žák <číslo>“). Aplikace nic neznámkuje ani nehodnotí automaticky. Osobní údaje se anonymizují **[datum, 12 měsíců
> po konci školního roku]**, zálohy se drží nejvýš 30 dní. Správcem údajů je **[škola]**, s dotazy se obracejte
> na **[vyučující]** nebo pověřence pro ochranu osobních údajů **[kontakt]**.

## Instalace skillu na agenta (Claude Code v tmux)

Skill je v `agent-skill/kviz-z-materialu/`. Postup pro suchý běh na VPS:

```bash
# 1) zkopírujte skill k ostatním osobním skillům Claude Code
cp -r agent-skill/kviz-z-materialu ~/.claude/skills/
cd ~/.claude/skills/kviz-z-materialu
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 2) proměnné prostředí pro relaci agenta (např. v ~/.bashrc nebo v souboru, který načítá tmux relace agenta)
export KVIZHUB_URL=http://127.0.0.1:3000          # agent běží na stejném VPS
export KVIZHUB_TOKEN=khp_...                      # token z KvizHubu (API tokeny)
chmod 600 ~/.bashrc                               # token nesmí být čitelný pro ostatní uživatele

# 3) kontrola bez jazykového modelu: skripty proti běžící aplikaci
.venv/bin/python scripts/extract.py fixtures/optika.docx --out /tmp/s.json
.venv/bin/python scripts/validate_quiz.py /tmp/s.json fixtures/quiz.json --out /tmp/q.json
.venv/bin/python scripts/post_quiz.py /tmp/q.json --dry-run      # → {"valid": true, "stats": {...}}
```

4. Restartujte relaci agenta (aby načetla skill a proměnné) a pošlete mu v Telegramu testovací soubor, např.
   `fixtures/optika.docx`, se zprávou „udělej z toho kvíz na 8 otázek pro 8. třídu“.
5. **Očekávaný výsledek:** agent nejdřív odpoví „Zpracovávám optika.docx (…)“. Po několika minutách pošle zprávu
   „Kvíz "…" je v KvizHubu.“ s počtem otázek (v pořádku / ke kontrole) a odkazem na kontrolu. V KvizHubu se objeví
   kvíz se zdroji u otázek. Na zprávu „spusť“ agent pošle PIN, odkaz pro žáky a odkaz pro projektor.

Skill (SKILL.md) popisuje 10 kroků: příjem, extrakci, plán, tvorbu, kontrolu, slepé řešení podagentem, odeslání,
odpověď, hru a výsledky a úklid. Obsahuje i šablony zpráv a ruční kontrolní seznam pro kroky, které dělá
jazykový model.

## Nasazení na sdíleném VPS s HTTPS

Na serveru už běží další služby a agenti v tmux. KvizHub proto neobsazuje porty 80/443, nesahá mimo svůj
adresář a nic neinstaluje globálně. Všechno běží v Dockeru.

**Před instalací zkontrolujte porty a místo:**

```bash
ss -tlnp | grep -E ':(3000|80|443)\b'   # port 3000 musí být volný (jinak změňte APP_PORT)
df -h .                                 # image má cca 470 MB, data jsou malá (SQLite)
```

**Instalace:**

```bash
git clone <repo> /opt/kvizhub && cd /opt/kvizhub
cp .env.example .env
sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://kviz.mojeskola.cz#" .env
docker compose up -d --build
```

**Caddy – nová subdoména** (Caddy zajistí certifikát Let's Encrypt; DNS záznam `kviz.mojeskola.cz` musí
mířit na VPS):

```caddy
kviz.mojeskola.cz {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

**Caddy už běží pro jiné služby:** jen přidejte blok výše do stávajícího `Caddyfile` a načtěte konfiguraci
bez restartu ostatních služeb:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

WebSocket (Socket.IO, cesta `/socket.io/`) projde přes `reverse_proxy` bez další konfigurace. Pokud používáte
nginx, potřebujete `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`
a `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`.

Žáci se připojují ze školní Wi‑Fi, proto používejte jen HTTPS na portu 443 s veřejnou doménou a žádné
neobvyklé porty.

**Provoz:**

- `docker compose ps`: stav (healthcheck volá `/healthz`). `docker compose logs -f`: strukturované logy (pino,
  JSON). Rotace logů je nastavená na 3 × 10 MB.
- Kontejner má limity `mem_limit: 512m`, `cpus: 1.0`, read-only systém souborů, `no-new-privileges` a běží jako
  neprivilegovaný uživatel. Data jsou ve volume `kvizhub-data` (`/data/kvizhub.db`).
- **Naměřená spotřeba** (kontejner, `docker stats`, 2 vCPU): v klidu cca 50 MiB RAM, hra s 35 hráči cca 55 MiB,
  hra se 150 hráči cca 62 MiB a krátce až 85 % jednoho CPU. Latence odhalení odpovědi byla při 35 hráčích 5 ms
  a při 150 hráčích 10 ms (`pnpm loadtest 35`, `pnpm loadtest 150` proti kontejneru).
- Aktualizace: `git pull && docker compose up -d --build`. Hry, které právě běží, se restartem ukončí
  (stav her je v paměti).

## Zálohování

`scripts/backup.sh` vytvoří konzistentní kopii databáze za běhu (`VACUUM INTO`), zkomprimuje ji a smaže zálohy
starší než N dní:

```bash
/opt/kvizhub/scripts/backup.sh /var/backups/kvizhub 30
# cron (každý den 2:15):
15 2 * * * /opt/kvizhub/scripts/backup.sh /var/backups/kvizhub 30 >> /var/log/kvizhub-backup.log 2>&1
```

**Obnova:**

```bash
docker compose stop
gunzip -c /var/backups/kvizhub/kvizhub-YYYYMMDD-HHMMSS.db.gz > /tmp/kvizhub.db
docker run --rm -v kvizhub_kvizhub-data:/data -v /tmp:/backup alpine \
  sh -c 'rm -f /data/kvizhub.db-wal /data/kvizhub.db-shm && cp /backup/kvizhub.db /data/kvizhub.db && chown 1000:1000 /data/kvizhub.db'
docker compose start
```

(Název volume ověřte příkazem `docker volume ls`. Tvoří ho název adresáře projektu + `_kvizhub-data`.)

**Šifrování záloh** (doporučeno, jakmile používáte třídy): nastavte `BACKUP_AGE_RECIPIENT=age1…` (veřejný klíč
z `age-keygen`) nebo `BACKUP_GPG_RECIPIENT=…` a skript uloží `…db.gz.age` / `…db.gz.gpg` s právy 600. Bez šifrování
skript vypíše varování. Soukromý klíč držte mimo server. Obnova: `age -d -i klic.txt zaloha.db.gz.age | gunzip > /tmp/kvizhub.db`.
Doporučená doba uchování záloh je 30 dní (druhý parametr skriptu).

## Soukromí a bezpečnost (A7, odškrtnuto; doplněno Dodatkem 3)

- [x] Hesla argon2id. Session je httpOnly cookie se `SameSite=Lax` (aby odkaz z Telegramu otevřel kontrolu kvízu přihlášenému učiteli) a při HTTPS i `Secure`. Mutující
      požadavky z prohlížeče vyžadují CSRF token (API tokeny ho nepotřebují).
- [x] API tokeny jsou uložené jen jako SHA-256, mají oprávnění (scopes), volitelnou expiraci a jdou odvolat.
      Rate limit je 60 požadavků za minutu na token. Audit log obsahuje jen metadata.
- [x] Logy neobsahují tokeny, cookies ani těla požadavků, jen metodu, cestu bez parametrů, velikost, stav a dobu.
- [x] Aplikace nepřijímá dokumenty, jen JSON do 2 MB.
- [x] Žáci nemají účty ani hesla. Bez třídy se ukládá jen přezdívka a odpovědi, žádné IP adresy. Jediný technický token hry je
      v sessionStorage. Nejsou tu analytické skripty, externí fonty ani CDN.
- [x] **Změna pravidla (Dodatek 3):** u tříd se navíc ukládají jména, číslo v třídním výkazu, hash osobního kódu
      a výsledky za školní rok, viz [Osobní údaje žáků](#osobní-údaje-žáků). Logy neobsahují jména ani kódy (ověřuje test).
- [x] Retence: výsledky her a hráči se mažou po `RETENTION_DAYS` (denní úloha). Kvízy zůstávají.
      Jména žáků v testech se po `TEST_NAME_RETENTION_DAYS` nahradí „Žák N“.
      Evidence tříd na `RETENTION_DAYS` nezávisí; anonymizuje se po `CLASS_RETENTION_MONTHS`.
- [x] Hlavičky CSP, `X-Content-Type-Options`, `Referrer-Policy: no-referrer` a `frame-ancestors 'none'`.
      Rate limity platí na přihlášení, API a připojení do hry.
- [x] Autentizace je výměnný provider (`local` | `oidc`).
- [x] Hlídání okna v testu zná jen události stránky testu a jejich čas. Nepoužívá kameru, mikrofon, snímky obrazovky ani schránku, neblokuje kopírování a nikdy nesnižuje procenta.
- [x] Správné odpovědi se klientům před odhalením nikdy neposílají (ověřuje E2E test na úrovni WebSocket rámců).
      Čas se měří na serveru a po limitu platí tolerance 300 ms.
- [x] Odkaz pro ovládání hry obsahuje náhodný klíč (32 bajtů) ve fragmentu URL, takže se nedostane do logů
      serveru ani proxy. Stránka projektoru ho po načtení z adresního řádku odstraní.

## Vývoj a testy

```bash
pnpm install
pnpm dev                 # server :3000 (tsx watch) + Vite :5173 s proxy
pnpm check               # typecheck + lint + unit/API/engine testy + zátěžový test 150 hráčů
pnpm build && pnpm test:e2e   # Playwright: učitel, token, API, schválení, hra 1 host + 3 hráči, reconnect, WebSocket rámce,
                              # test, hlídání okna, třídy (soupiska, kódy, třídní test, náhradní termín, matice, projektor)
pnpm seed:demo-class     # ukázková třída s 24 pseudonymy (jen mimo produkci, potřebuje DB_PATH a CODE_PEPPER)
pnpm loadtest 150        # zátěž (volitelně proti KVIZHUB_URL + KVIZHUB_TOKEN)
pnpm demo

# skill (Python 3.11+)
cd agent-skill/kviz-z-materialu && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q     # extract, validate, post (mock server) a end-to-end proti aplikaci
```

Struktura: `apps/server` (Fastify + Socket.IO + Drizzle/SQLite), `apps/web` (React + Vite + Tailwind),
`packages/core` (kontrakt v zod, bodování, vyhodnocení odpovědí, typy událostí), `packages/export`
(Kahoot, GIFT, JSON), `agent-skill/` (část B), `fixtures/` (vzorové kvízy a šablona Kahoot),
`scripts/` (demo, zátěž, záloha). Rozhodnutí, která zadání neurčovalo, jsou v [DECISIONS.md](DECISIONS.md).

## Známá omezení a neověřené body

- **Šablona Kahoot [neověřeno].** Z prostředí, kde aplikace vznikala, nebyl dostupný web support.kahoot.com.
  `fixtures/kahoot-template.xlsx` je proto rekonstrukce oficiální šablony (hlavičky „Question - max 120
  characters“, „Answer 1–4 - max 75 characters“, „Time limit (sec) …“, „Correct answer(s) - choose at least one“
  na řádku 8, data od řádku 9). **Nahraďte ji oficiální šablonou** z nápovědy Kahootu („How to import questions
  from a spreadsheet to your kahoot“) pod stejným názvem. Export hledá řádek a sloupce podle textu hlaviček,
  takže bez úprav kódu použije i oficiální soubor. Doporučujeme jednou vyzkoušet import do Kahootu.
  Limity (95/60 znaků, časy 5–120 s, max. 4 odpovědi) jsou podle zadání. Podmínky Kahootu pro žáky do 16 let
  ani limity Waygroundu nebyly ověřeny.
- **Moodle GIFT [neověřeno proti Moodlu].** docs.moodle.org nebyl dostupný. Syntaxe (escapování `~ = # { } :`,
  váhy `%50%`, `{TRUE}`, `{#hodnota:tolerance}`, obecná zpětná vazba `####`) odpovídá známé dokumentaci
  a kontroluje ji test syntaxe, skutečný import do Moodlu ale vyzkoušen nebyl.
- Stav živých her je v paměti jednoho procesu. Po restartu se rozehrané hry ukončí (v databázi mají stav
  `aborted`). Pro škálování na více instancí je potřeba Socket.IO Redis adapter a sdílený stav her. Záměrně není
  součástí (jedna třída = desítky hráčů).
- SQLite: repository vrstva (Drizzle) je oddělená, přechod na Postgres vyžaduje hlavně nové migrace.
- Testovací režim vznikl podle vlastní specifikace (docs/TESTOVACI-REZIM.md), protože text původního dodatku nebyl k dispozici.
- Přihlášení přes Microsoft Entra ID / OIDC je připravené jen jako rozhraní (`AuthProvider`).
- Tvorbu otázek a slepé řešení dělá jazykový model agenta. Automatické testy je nahrazují hotovým
  `fixtures/quiz.json`, pro tyto kroky je v SKILL.md ruční kontrolní seznam.
- **Třídy (Dodatek 3):** sdílení třídy s dalším učitelem (role editor/viewer) a převod do nového školního roku (C-M8)
  zatím nejsou; oprávnění rolí jsou ale implementovaná a otestovaná. Dvoufázové přihlášení učitele není.
  Vybrat jen některé žáky pro hru jde jen v aplikaci, ne přes API (záměrně). Vyřazení otázky z hodnocení (D6.4)
  v kódu neexistuje, takže se po něm evidence nepřepočítává.
- **Právní rámec tříd [OVĚŘ]:** kontrolní seznam v [Osobní údaje žáků](#osobní-údaje-žáků) není právní posudek;
  region serveru a smluvní podmínky poskytovatele VPS je potřeba ověřit u poskytovatele.
