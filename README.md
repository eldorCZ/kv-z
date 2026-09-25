# KvizHub

Aplikace pro kvízy ve třídě, která běží na vašem vlastním serveru, a k ní skill pro agenta na Telegramu.

Učitel pošle soubor (DOCX, PDF, PPTX) svému agentovi. Agent z něj vyrobí kvíz, u každé otázky uvede zdroj
(soubor, stranu nebo slide a doslovnou citaci), otázky strojově zkontroluje a vloží je přes API do KvizHubu.
Učitel kvíz v KvizHubu zkontroluje a upraví a spustí hru: žáci se připojí PINem nebo QR kódem na telefonu,
žebříček běží na projektoru. Kvíz jde exportovat do Kahootu, Moodlu (GIFT) nebo do JSON.

- **Zdroj u každé otázky.** Agent citaci strojově ověří a učitel ji vidí u otázky.
- **Otázky s výhradou** (stav „ke kontrole“, `flagged`) se do hry ani exportu nedostanou, dokud je učitel neschválí.
  Agent je schválit nemůže.
- **Data zůstávají na vašem serveru.** Žáci nemají účty; ukládá se jen přezdívka a odpovědi.
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
| `API_WEBHOOK_URL` / `API_WEBHOOK_SECRET` | – | Webhook po skončení hry: `POST {gameId, quizId, status:"finished"}`, hlavička `X-KvizHub-Signature: sha256=<HMAC-SHA256 těla>`. |
| `EXPORT_KAHOOT_MAX_Q` / `EXPORT_KAHOOT_MAX_A` | `95` / `60` | Délkové limity exportu do Kahootu (otázka / odpověď). |
| `ALLOW_REGISTRATION` | `1` | `0` vypne registraci nových učitelů. Po založení vlastního účtu doporučeno. |
| `AUTH_PROVIDER` | `local` | `local` (e‑mail + heslo). `oidc` zatím existuje jen jako rozhraní pro pozdější Microsoft Entra ID. |
| `TRUST_PROXY` | `1` | Aplikace běží za reverzní proxy a čte IP adresu z `X-Forwarded-For` (kvůli rate limitům). |
| `JOIN_RATE_LIMIT` / `API_RATE_LIMIT` | `10` / `60` | Pokusy o připojení do hry za minutu na IP adresu / požadavky API za minutu na token. |

Pozor: pokud je celá třída za jednou veřejnou IP (NAT školy) **a** proxy nepředává `X-Forwarded-For`,
narazí žáci na limit 10 připojení za minutu. Caddy tuto hlavičku předává automaticky.

## API token pro agenta

1. Přihlaste se do KvizHubu → **API tokeny** → **Vytvořit token** (výchozí oprávnění: `quizzes:write`,
   `quizzes:read`, `games:write`, `games:read`).
2. Token se zobrazí **jen jednou**, v databázi je uložen jen jeho SHA-256 otisk. Zkopírujte ho do proměnné
   `KVIZHUB_TOKEN` na serveru agenta. Nikdy ho neposílejte do chatu.
3. Oprávnění schvalovat otázky (`quizzes:approve`) token dostat nemůže. Schvaluje jen učitel v aplikaci.
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

## Soukromí a bezpečnost (A7, odškrtnuto)

- [x] Hesla argon2id. Session je httpOnly cookie se `SameSite=Lax` (aby odkaz z Telegramu otevřel kontrolu kvízu přihlášenému učiteli) a při HTTPS i `Secure`. Mutující
      požadavky z prohlížeče vyžadují CSRF token (API tokeny ho nepotřebují).
- [x] API tokeny jsou uložené jen jako SHA-256, mají oprávnění (scopes), volitelnou expiraci a jdou odvolat.
      Rate limit je 60 požadavků za minutu na token. Audit log obsahuje jen metadata.
- [x] Logy neobsahují tokeny, cookies ani těla požadavků, jen metodu, cestu bez parametrů, velikost, stav a dobu.
- [x] Aplikace nepřijímá dokumenty, jen JSON do 2 MB.
- [x] Žáci nemají účty. Ukládá se jen přezdívka a odpovědi, žádné IP adresy. Jediný technický token hry je
      v sessionStorage. Nejsou tu analytické skripty, externí fonty ani CDN.
- [x] Retence: výsledky her a hráči se mažou po `RETENTION_DAYS` (denní úloha). Kvízy zůstávají.
- [x] Hlavičky CSP, `X-Content-Type-Options`, `Referrer-Policy: no-referrer` a `frame-ancestors 'none'`.
      Rate limity platí na přihlášení, API a připojení do hry.
- [x] Autentizace je výměnný provider (`local` | `oidc`).
- [x] Správné odpovědi se klientům před odhalením nikdy neposílají (ověřuje E2E test na úrovni WebSocket rámců).
      Čas se měří na serveru a po limitu platí tolerance 300 ms.
- [x] Odkaz pro ovládání hry obsahuje náhodný klíč (32 bajtů) ve fragmentu URL, takže se nedostane do logů
      serveru ani proxy. Stránka projektoru ho po načtení z adresního řádku odstraní.

## Vývoj a testy

```bash
pnpm install
pnpm dev                 # server :3000 (tsx watch) + Vite :5173 s proxy
pnpm ci                  # typecheck + lint + unit/API/engine testy + zátěžový test 150 hráčů
pnpm build && pnpm test:e2e   # Playwright: učitel, token, API, schválení, hra 1 host + 3 hráči, reconnect, WebSocket rámce
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
- Samostatný režim (`selfpaced`, volitelný milník A-M6) není implementován; API vrací 422.
- Přihlášení přes Microsoft Entra ID / OIDC je připravené jen jako rozhraní (`AuthProvider`).
- Tvorbu otázek a slepé řešení dělá jazykový model agenta. Automatické testy je nahrazují hotovým
  `fixtures/quiz.json`, pro tyto kroky je v SKILL.md ruční kontrolní seznam.
