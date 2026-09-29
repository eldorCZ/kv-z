# Jednotný moderní UI plán pro Lore

## 1. Cíl

Lore má působit jako jedna současná aplikace, ale ne jako generický SaaS dashboard.
Vizuální systém proto zachová jednu značku a rozdělí její intenzitu podle situace:

- **Učitel (`focus`)** – klidný, přesný a datově hutný pracovní nástroj.
- **Žák (`play`, mobil)** – jednoduché, přátelské a výrazné ovládání jednou rukou.
- **Projektor (`play`, velká obrazovka)** – čitelné z dálky, energické přechody a řízené „wow“ momenty.

Moderní zde znamená: jasná hierarchie, méně dekorativních ploch, více prostoru,
konzistentní komponenty, kultivovaná typografie, rychlá odezva a pohyb pouze tam,
kde vysvětluje změnu stavu nebo podporuje atmosféru hry.

## 2. Směr a mantinely

### Co zachovat

- React 19, Tailwind CSS 4, Radix UI a Lucide.
- Vlastní komponenty v `apps/web/src/ui` a tokeny v `theme/tokens.css`.
- Fialovou barvu Lore, logo, Loríka, Baloo 2 a Nunito.
- Světlé/tmavé téma, režimy `focus/play`, čitelné písmo a omezení pohybu.
- Barevné odpovědi doplněné tvarem a písmenem.

### Co nepřidávat

- Celý shadcn, HeroUI, Mantine ani další paralelní komponentovou knihovnu.
- Glow, gradient border, glassmorphism nebo 3D hover v učitelské části.
- Animaci ke každému kliknutí; efekt je odměna a informace, ne výplň.
- Emoji jako hlavní ikony. Pro rozhraní používat Lucide, emoji jen v obsahu.

### Vizuální zásada

**Jedna značka, dvě nálady, tři kontexty.** Značka, význam barev a základní
komponenty jsou společné. Hustota, radius, velikost textu a pohyb se mění podle
kontextu. Učitel není bezbarvý a hra není chaotická.

## 3. Design systém Lore UI

### 3.1 Barvy

Současné sémantické tokeny zůstávají zdrojem pravdy. Doplnit jen chybějící role,
ne odstíny pojmenované podle konkrétní obrazovky:

- `surface-raised` – menu, dialog a plovoucí panel,
- `surface-sunken` – filtry, tabulkové hlavičky a vnořená plocha,
- `line-subtle` – oddělení uvnitř komponent,
- `shadow-raised` – jednotný stín dialogu/menu,
- `ring` – jednotný výběr mimo stav klávesového focusu.

Ve `focus` režimu se primární barva používá jen pro hlavní akci, aktivní navigaci,
odkaz a vybraný stav. Velké fialové plochy patří do `play`, nikoli do administrace.
Stavy success/warning/danger nikdy neslouží jako dekorace.

### 3.2 Typografie

- **Nunito**: veškerý pracovní text, formuláře, tabulky a navigace.
- **Baloo 2**: značka, titulní herní momenty, PIN, odpočet a skóre.
- V učitelské části Baloo omezit na hlavní nadpis stránky; podnadpisy mohou být Nunito.
- Nepoužívat verzálky pro běžné hlavičky tabulek; místo nich menší velikost a vyšší váhu.
- Čísla ve statistikách, PINu, čase a skóre vždy `tabular-nums`.

Navržená škála:

| Role | Desktop | Mobil | Použití |
|---|---:|---:|---|
| Display | 40–56 px | 34–44 px | projektor, PIN, výsledek |
| Page title | 30–36 px | 26–30 px | hlavní nadpis stránky |
| Section title | 20–24 px | 18–22 px | sekce a dialogy |
| Body | 15–16 px | 16 px | běžný obsah |
| Meta | 13–14 px | 14 px | doplňující informace |

### 3.3 Prostor a layout

- Základní rastr 4 px; běžné mezery 8, 12, 16, 24, 32 a 48 px.
- Učitel: maximální šířka obsahu 1200–1280 px; datové tabulky mohou využít celou.
- Nadpis stránky vždy přes společný `PageHeader`: breadcrumb/context, titul, popis,
  primární akce, sekundární akce.
- Sekce oddělovat především prostorem. Kartu použít jen pro skutečně samostatný celek.
- Mobilní akce nezalamovat do nepřehledné řady; hlavní akce zůstává viditelná,
  vedlejší jsou v menu nebo spodním sheetu.

### 3.4 Tvar, border a stín

- `focus`: radius 10–12 px, border 1 px, velmi jemný stín pouze u zvednutých vrstev.
- `play`: radius 16–24 px, výraznější tlačítka a odpovědi, zachovaný „press“ efekt.
- Karty ve focus režimu nemají automaticky stín. Hover zvýrazní border a případně pozadí,
  ne celý blok prudkým posunem.
- Pill patří stavům, krátkým filtrům, hráčům a skóre; ne každému tlačítku.

### 3.5 Pohyb

Povolené časy: 120 ms pro odezvu, 180–220 ms pro komponentu, 320–500 ms pro herní
přechod. Animovat jen `opacity` a `transform`, s plnou podporou `reduced motion`.

- Učitel: otevření dialogu/sheetu, skeleton, změna tabů a nenápadné zvýraznění uložení.
- Žák: potvrzení klepnutí, odeslání odpovědi, správně/chybně, změna otázky.
- Projektor: příchod otázky, odhalení správné odpovědi, změna pořadí, odpočet a pódium.
- Konfety pouze po konci hry nebo výjimečném milníku, nikdy po běžné odpovědi.

## 4. Sdílené komponenty – cílový stav

Nejdřív rozšířit vlastní vrstvu `apps/web/src/ui`, potom měnit stránky.

### Základní prvky

- `Button` – doplnit jasné `default/secondary/ghost/destructive/success`, jednotné loading
  a ikonu; současné API lze zachovat kompatibilní.
- `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch` – společná výška,
  focus, chyba, disabled a help text.
- `Badge` – pouze stav nebo krátká metadata; sjednotit velikosti a význam tónů.
- `IconButton`, `Tooltip`, `Menu`, `Dialog`, `Sheet`, `Tabs` – jednotné vrstvy a focus.

### Kompoziční prvky

- `PageHeader` – titul, kontext, popis a akce.
- `SectionHeader` – název sekce a lokální akce.
- `Toolbar` – hledání, filtry, řazení a počet výsledků.
- `Card`, `CardHeader`, `CardContent`, `CardFooter` – varianty `plain`, `interactive`, `metric`.
- `StatCard` – hodnota, popisek, trend/kontext; pro výsledky a třídy.
- `DataTable` – sticky hlavička, řazení, prázdný stav, horizontální scroll a mobilní varianta.
- `ProgressBar` – jeden komponent pro témata, otázky i úspěšnost.
- `Alert` – info/success/warning/danger bez ručního skládání barevných boxů.
- `EmptyState`, `Skeleton`, `Toast` – sjednocené stavy načítání a výsledků.
- `Breadcrumbs` – detail kvízu, třídy, žáka a hry.

### Herní prvky

- `GameShell` – společný základ pro projektor a žáka, ale odlišné layout varianty.
- `AnswerTile` – stejný tvar, písmeno, barva a stav na mobilu i projektoru.
- `GameTopBar` – PIN, průběh, spojení a ovládání bez přeplnění.
- `ScoreTicker`, `Countdown`, `Leaderboard`, `Podium` – izolované animované komponenty.

Výsledek: stránky už nemají ručně psát desítky kombinací `rounded-md border ...`.
Pokud se vzor objeví potřetí, má se přesunout do UI vrstvy.

## 5. Informační architektura

### Desktop učitele

Levá navigace zůstane, ale bude vizuálně klidnější a stabilnější:

1. Kvízy
2. Třídy
3. Výsledky (dnešní „Hry“ přejmenovat v UI, pokud terminologie dovolí)
4. Nastavení – Vzhled a API tokeny jako podsekce

Logo nahoře, účet a režim dole. Aktivní položka má měkké fialové pozadí a tenký akcent,
ne výraznou plnou plochu. Sbalený stav používá tooltipy.

### Mobil učitele

Horní lišta: menu, značka, případná hlavní kontextová akce. Navigace v levém sheetu.
Tabulky se nemají pouze zmenšit: prioritní údaje zůstanou v řádku, zbytek se otevře
v detailu nebo kartě.

## 6. Obrazovky

### 6.1 Kvízy – první referenční redesign

- `PageHeader`: „Moje kvízy“, stručný popis, primární „Nový kvíz“.
- Import JSON přesunout do sekundárního menu.
- `Toolbar`: hledání, později filtr předmětu/třídy/stavu a řazení.
- Desktop umožní přepnout kompaktní seznam a karty; výchozí je přehledný seznam/karty
  s menším náhledem, názvem, počtem otázek, stavem a poslední změnou.
- Celá karta je klikací, menu akcí zůstává nad ní a má jednoznačný focus.
- Prázdný stav nabídne vytvoření kvízu a import, Lorík zůstane nenápadný.

### 6.2 Detail a editor kvízu

- Nahoře breadcrumb, název, stav připravenosti a hlavní „Spustit“.
- Sticky lokální toolbar pouze při delším seznamu.
- Otázka je pracovní blok: pořadí a typ vlevo, obsah uprostřed, stav a akce vpravo.
- Editace se otevírá v širokém dialogu/sheetu; automatické uložení má klidný stavový text.
- Varování „ke kontrole“ je viditelné, ale nevytlačuje obsah velkou barevnou plochou.

### 6.3 Třídy a žáci

- Seznam tříd: kompaktní karty s ročníkem, počtem žáků a poslední aktivitou.
- Detail třídy: hlavička + taby `Přehled / Žáci / Témata / Aktivity / Kódy`.
- Přehled: 3–4 `StatCard`, slabá témata a poslední aktivity.
- Matice zůstane tabulkou; sticky první sloupec, čitelné legendy, filtry nad tabulkou.
- Profil žáka: souhrnné metriky, vývoj, témata a historie; barva nesmí být jediný nositel informace.

### 6.4 Výsledky a test dashboard

- První řada: žáci, průměrná úspěšnost, počet odpovědí, průměrný čas.
- Druhá řada: úspěšnost podle témat/otázek s jednotným `ProgressBar`.
- Nejtěžší otázky zobrazit jako insight panel, ne trvalé varování.
- Tabulka pořadí a žáků dostane řazení, sticky hlavičku a konzistentní číselné zarovnání.
- Kritické akce (ukončit, odemknout, znovu otevřít) mají jasnou hierarchii a potvrzení.

### 6.5 Připojení a hra žáka

- Jedna soustředěná karta: logo/Lorík, nadpis, PIN, jméno, avatar a „Připojit“.
- PIN používá číselnou klávesnici, velké číslice a automatické formátování.
- Minimální dotykový cíl 48 px; hlavní akce přes celou šířku.
- Otázka a odpovědi využijí celou výšku telefonu bez zbytečných rámečků.
- Stav odesláno/správně/chybně je okamžitě srozumitelný textem, ikonou i barvou.
- Offline/reconnect stav je viditelný a neblokuje obsah déle, než musí.

### 6.6 Projektor

- Obsah musí být čitelný z poslední lavice; používat `clamp()` a bezpečné maximální řádky.
- Ovládání učitele zmenšit do klidné horní lišty, během otázky dát prioritu obsahu.
- Otázka vstoupí krátkým fade/slide, odpovědi postupně s malým zpožděním.
- Odhalení: správná odpověď dostane pulse/glow v rámci Lore barev, ostatní ztlumí.
- Pořadí: změnu místa animovat, ale po 500 ms musí být vše v klidu.
- Pódium: nejsilnější vizuální moment – nástup stupňů, number ticker, Lorík a krátké konfety.

## 7. Responzivita a přístupnost

- Navrhovat a testovat v šířkách 360, 390, 768, 1024, 1440 px a projektor 1920×1080.
- WCAG AA pro text a ovládací prvky; zachovat automatickou kontrolu kontrastu.
- Všechny akce ovladatelné klávesnicí, viditelný focus, smysluplné pořadí tabulátoru.
- Stav nesdělovat pouze barvou; přidat text, ikonu nebo tvar.
- Touch target žáka alespoň 48×48 px, učitele alespoň 44×44 px.
- `prefers-reduced-motion` a vlastní nastavení musí odstranit dekorativní pohyb.
- Zoom 200 % nesmí skrýt primární akci ani znemožnit dokončení formuláře.

## 8. Implementační pořadí

### Fáze 0 – vizuální baseline

1. Vygenerovat současných 21 světlých a tmavých screenshotů.
2. Vybrat referenční obrazovky: kvízy, detail kvízu, matice třídy, výsledky,
   připojení žáka, otázka žáka, otázka projektoru a pódium.
3. Přidat viewport 390 px a 1920×1080 do vizuální kontroly.

### Fáze 1 – základy systému

1. Doplnit tokeny pro vrstvy, border a stín.
2. Sjednotit typografii, výšku ovládacích prvků a radius pro `focus/play`.
3. Rozšířit `/_design` o všechny stavy komponent, velikosti a responzivní ukázky.
4. Vytvořit `PageHeader`, `Toolbar`, `Alert`, `StatCard`, `ProgressBar` a `DataTable`.

### Fáze 2 – učitelský shell a kvízy

1. Upravit sidebar, mobilní header a šířku obsahu.
2. Redesignovat seznam kvízů jako referenční obrazovku.
3. Redesignovat detail/editor kvízu a startovací dialog.
4. Po schválení vzoru přenést stejné hlavičky, toolbary a stavy na ostatní stránky.

### Fáze 3 – třídy, výsledky a testy

1. Sjednotit třídy a detail třídy.
2. Zavést metriky, progress bary a tabulky do výsledků.
3. Upravit test dashboard a profil žáka.
4. Ověřit hustotu na notebooku učitele a chování tabulek na mobilu.

### Fáze 4 – žák

1. Redesign připojení, avataru a chybových stavů.
2. Sjednotit `AnswerTile` pro všechny typy otázky.
3. Doladit využití výšky, safe-area a mobilní klávesnici.
4. Ověřit slabší telefon, pomalou síť a reconnect.

### Fáze 5 – projektor a oslava

1. Zjednodušit herní top bar a layout otázky.
2. Přidat přechody otázky, reveal a pořadí bez nové UI knihovny.
3. Vytvořit kultivované pódium a number ticker; konfety lazy-loadnout.
4. Ověřit 16:9, 4:3, fullscreen i reduced motion.

## 9. Kontrola kvality

Každá fáze je hotová, jen když:

- používá tokeny a sdílené UI komponenty bez nových nahodilých barev,
- funguje ve světlém i tmavém režimu a v relevantním `focus/play` kontextu,
- projde klávesnicí, čtečkou/axe a kontrolou kontrastu,
- má screenshoty pro desktop a relevantní mobil/projektor,
- nezvyšuje studentský route bundle bez odůvodnění,
- projde `pnpm typecheck`, `pnpm lint`, `pnpm check:contrast`, testy, build a E2E.

### Měřitelné cíle

- Žádná stránka neskládá vlastní primární tlačítko mimo `Button`/`AnswerTile`.
- Opakované alerty, tabulky, metriky a progress bary používají sdílenou komponentu.
- Primární akce je na každé učitelské obrazovce právě jedna.
- Žák zvládne připojení na 360 px bez horizontálního scrollu.
- Projektorová otázka a všechny odpovědi jsou použitelné na 1280×720 i 1920×1080.
- Dekorativní animace se při reduced motion nevykonají.

## 10. Doporučený první realizační balíček

První změna má být malá, ale ukázat celý cílový jazyk:

1. doplnění tokenů a typografických pravidel,
2. `PageHeader`, `Toolbar`, rozšířený `Card` a `Alert`,
3. modernizace sidebaru,
4. kompletní redesign `/quizzes`,
5. aktualizace `/_design` a vizuálních testů.

Tento balíček vytvoří referenci pro všechny další obrazovky bez zásahu do herní logiky.
Teprve po jeho vizuálním schválení se má stejný systém rozšířit do tříd a výsledků.
