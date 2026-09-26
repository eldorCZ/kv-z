# Jiskra (dříve KvizHub) — návod pro učitele


Kvízy a testy ve třídě na vlastním serveru. Žáci nepotřebují účty, výsledky nikam neodcházejí. Tenhle návod projde první kvíz, hru ve třídě, třídy s evidencí a nakonec agenta, který kvízy vyrábí z vašich materiálů.

## Než začnete

Aplikace běží na adrese, kterou máte od správce. Přihlašujete se e-mailem a heslem. **Žáci se nepřihlašují** — do hry vstupují PINem a přezdívkou; u hry nebo testu spuštěného pro třídu místo přezdívky zadají svůj osobní kód.

## První kvíz za pět minut

1.  **Přihlaste se** a jděte na **Moje kvízy**.
2.  **Nový kvíz** → napište název a přidejte otázky. Nebo **Nahrát JSON**, když máte kvíz ze souboru.
3.  U kvízu dejte **Spustit**. Vyberte, jestli jde o **hru** (společně, na body) nebo **test** (samostatně, výsledek v procentech; známku dáváte vy).
4.  Na projektor promítněte obrazovku s **PINem a QR kódem**.
5.  Žáci otevřou adresu na mobilu, zadají PIN a přezdívku. Vy spustíte první otázku.

### Šest typů otázek

| Typ               | Jak to vypadá u žáka           | Kdy se hodí                    |
| ----------------- | ------------------------------ | ------------------------------ |
| Jedna správná     | Čtyři barevná tlačítka s tvary | Nejrychlejší, základ hry       |
| Více správných    | Zaškrtne víc možností a odešle | „Která z těchto tvrzení platí" |
| Pravda / nepravda | Dvě velká tlačítka             | Rychlé prověření pojmů         |
| Krátká odpověď    | Napíše slovo                   | Pojmy, jednotky, názvy         |
| Číselná odpověď   | Napíše číslo                   | Výpočty, dá se uznat rozmezí   |
| Seřazení          | Přesouvá položky šipkami       | Postupy, časové osy, velikosti |



**Otázky „ke kontrole".** Když otázku vyrobí agent a není si jistý, označí ji. Taková otázka se **nedostane do hry ani do exportu**, dokud ji neschválíte. Agent si ji schválit nemůže — to je vaše slovo.



## Hra ve třídě

Hra je společná: všichni vidí otázku na projektoru, odpovídají na mobilu a po každé otázce se ukáže žebříček (dá se vypnout). Body jsou za správnost i za rychlost.

  - **Projektor** — obrazovka s otázkou, odpočtem a po vyhodnocení s žebříčkem.
  - **Mobil žáka** — znění otázky a velká barevná tlačítka s odpověďmi.
  - **Konec hry** — pořadí a úspěšnost po otázkách, takže hned vidíte, co třída nepochopila.



**Odkaz na projektor nedávejte žákům.** Obsahuje klíč, kterým se hra ovládá. Žákům patří jen PIN nebo QR kód.

**Ovládání projektoru z klávesnice:** mezerník = další krok, Enter = odhalit odpověď, F = celá obrazovka, T = světlý/tmavý režim, ? = přehled zkratek. Myš se po třech vteřinách schová. Žáci mohou odpovídat i klávesami A–E nebo 1–5.



## Test místo hry

Test žáci píší každý svým tempem, bez žebříčku a bez bodů za rychlost. Jde spustit i bez třídy (žák pak zadá jméno), ale s třídou se výsledky zapíšou do evidence a víte, kdo chybí.

  - U třídního testu žák zadá PIN a pak **svůj osobní kód** — tím se ví, komu výsledek patří.
  - Aplikace hlídá **opuštění okna** (dá se vypnout): když žák přepne na jinou aplikaci, zaznamená se to a vy to vidíte v přehledu testu. Procenta se kvůli tomu nikdy nesnižují.
  - **Náhradní termín** pro nemocné se zakládá v kartě třídy, v záložce Aktivity.

## Vzhled: motiv pozadí a barvy

Každý kvíz může mít vlastní **motiv pozadí** (vesmír, les, konfety, podzim, jen barevný přechod…) a **barvu akcentu**. Klikněte v kvízu na **Vzhled**: vlevo vyberete motiv a barvu, vpravo hned vidíte lobby, otázku i test očima žáka, na telefonu i na projektoru, světle i tmavě. **Náhodný** vybere za vás.

  - Při **Spustit hru** jde vzhled změnit **jen pro tuto hru**, nebo ho **uložit ke kvízu**.
  - **Nastavení → Vzhled** určí výchozí motiv všech nových kvízů (i těch od agenta).
  - **Test je vždy klidný:** motiv se nehýbe a leží pod výrazným závojem, bez konfet, bodů a žebříčku. Pro testy jsou nejvhodnější motivy s lístkem (Klidné).
  - Můžete **nahrát vlastní fotku** (JPEG, PNG nebo WebP). Aplikace z ní odstraní údaje o místě a přístroji. Používejte jen vlastní fotky bez tváří žáků.
  - Agent motiv sám nevybírá. Když ho chcete, napište mu třeba „dej tomu vesmírné pozadí“.

Žáci i vy si můžete kdykoli přepnout **světlý nebo tmavý režim**, omezit pohyb nebo zapnout čitelnější písmo (tlačítko vpravo nahoře). Žákům se volba pamatuje jen v jejich telefonu.

## Třídy a osobní kódy

Třída je skupina žáků na jeden školní rok. Zakládá se v menu **Třídy**, žáci se vloží jako soupiska. Každý dostane **osmiznakový kód**, kterým se ve třídní hře a testu identifikuje.

**Soupiska obsahuje jen přihlašovací jména** školních účtů bez domény, např. `novak12` (adresu `novak12@skola.cz` stačí vložit, doména se odstraní), případně číslo v třídním výkazu. Žádná jména a příjmení. Seznam jde vložit po řádcích, nebo nahrát CSV (i export z AD); soubor se zpracuje ve vašem prohlížeči a na server se pošle jen přihlašovací jméno a číslo. Když škola nechce ani přihlašovací jména, vložte čísla nebo pseudonymy.



### Co s kódy prakticky

  - Kódy se ukážou **jen jednou**. Hned je vytiskněte — aplikace nabízí kartičky na A4.
  - V kódu nejsou znaky, které se pletou: chybí I, L, O, nula i jednička.
  - Kód se zobrazuje po čtyřech (`K7MQ-2XRT`) a při zadávání se pomlčky ignorují.
  - **Zapomenutý kód není problém** — jde vygenerovat nový jednomu žákovi i celé třídě naráz.





**Tip do praxe.** Kartičky si nechte u sebe a rozdávejte je na začátku hodiny, nebo je nalepte do žákovských knížek. Když je dostanou domů volně, polovina je ztratí do týdne.



## Výsledky a přehledy

  - **Hry a výsledky** — přehled odehraných her, úspěšnost po otázkách, pořadí.
  - **Karta třídy** — matice žáků a aktivit, profil jednotlivého žáka, témata a jejich zvládnutí. Při promítání skryjte jména přepínačem **Skrýt jména**.
  - Aplikace počítá a ukazuje, ale **neznámkuje** — známky a závěry jsou na vás.
  - **Export** — kvíz jde vyvézt do **Kahootu**, **Moodlu** (formát GIFT) nebo do JSON. Výsledky třídy jdou do CSV pro Excel.

## Agent na serveru — jak si ho zařídit

Agent je Claude Code běžící na stejném serveru, kterému pošlete soubor přes Telegram a on z něj vyrobí kvíz. Sám ho vloží do KvizHubu, vy ho tam jen zkontrolujete a spustíte.



### Co agent umí

  - Přijme **DOCX, PDF, PPTX, TXT nebo Markdown** a vyrobí z něj otázky (výchozí počet 15).
  - U každé otázky uvede **zdroj** — soubor, stranu nebo snímek a doslovnou citaci.
  - Otázky si strojově zkontroluje a nejisté označí jako **ke kontrole**.
  - Na pokyn „spusť" pošle PIN, odkaz pro žáky i odkaz na projektor.



### Zprovoznění (jednorázově)

1.  V KvizHubu jděte do **API tokeny** a vytvořte token pro agenta. **Ukáže se jen jednou.**

2.  Token uložte na serveru do souboru — **neposílejte ho chatem**:
    
        mkdir -p ~/.secrets && chmod 700 ~/.secrets
        read -s -p "Token: " T && printf '%s' "$T" > ~/.secrets/kvizhub.token \
          && chmod 600 ~/.secrets/kvizhub.token && unset T

3.  Nainstalujte dovednost k agentovi:
    
        cp -r agent-skill/kviz-z-materialu ~/.claude/skills/
        cd ~/.claude/skills/kviz-z-materialu
        python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

4.  Nastavte agentovi proměnné prostředí (v souboru, který si jeho relace načítá). Port je ten z `APP_PORT` v `.env` (výchozí 3000; v příkladu 3010):
    
        export KVIZHUB_URL="http://127.0.0.1:3010"
        export KVIZHUB_TOKEN="$(cat ~/.secrets/kvizhub.token)"

5.  Restartujte relaci agenta a pošlete mu v Telegramu soubor se zprávou *„udělej z toho kvíz na 8 otázek pro 8. třídu"*.



**Soupisku žáků agentovi neposílejte.** Jména, známky ani kontakty do chatu nepatří — soubory procházejí Telegramem. Soupisku vkládejte přímo v aplikaci v kartě třídy. Agent je nastavený tak, že takový soubor odmítne.



## Časté otázky

Potřebují žáci účty nebo e-maily?

Ne. Do hry bez třídy vstupují PINem a přezdívkou; ukládá se jen přezdívka a odpovědi. U třídy se ukládá přihlašovací jméno, číslo v třídním výkazu a výsledky; osobní kód se neukládá vůbec (jen jeho otisk), proto ho nejde zobrazit znovu, jen vytvořit nový.

Co když žák zapomene kód?

V kartě třídy mu vygenerujete nový, buď jemu, nebo celé třídě naráz. Starý tím přestane platit.

Co když si žák kódy vymění s kamarádem?

Kód je jen identifikace, ne heslo. Pokud na tom v testu záleží, rozdejte kartičky až ve třídě a vyberte je po hodině.

Celá třída je na jedné Wi-Fi. Není to problém?

Aplikace omezuje počet připojení z jedné adresy za minutu. Když jsou všichni za jednou školní IP, může se stát, že se poslední žáci nepřipojí napoprvé. Řekněte správci, ať limit zvýší.

Dá se kvíz použít i v Kahootu?

Ano, exportem do formátu Kahootu (tabulka XLSX). Otázky a odpovědi se při tom zkracují na délku, kterou Kahoot povoluje.

Jak dlouho se data drží?

Výsledky her a hráči se po roce mažou, kvízy zůstávají. Evidence třídy se drží dál, ale 12 měsíců po konci školního roku se anonymizuje (přihlašovací jména a kódy se smažou, zůstanou jen souhrny). Doby nastavuje správce.

Může kvíz vytvořit agent úplně sám, bez mé kontroly?

Vloží ho, ale nejisté otázky označí a ty se do hry nedostanou, dokud je neschválíte. Schvalovací právo token agenta nemá.

Vidí na výsledky někdo jiný?

Ne. Data jsou na vašem serveru a vidí je jen přihlášený učitel. Agent dostane o třídě jen souhrny (průměry, slabá témata), nikdy jména, kódy ani výsledky jednotlivých žáků. Aplikace nikam nevolá a nepoužívá žádný jazykový model — ten je jen na straně agenta, když kvíz vyrábí.

Co když během hry vypadne internet nebo se zavře stránka?

Žák se vrátí na stejnou adresu a připojí se znovu. V testu se zavření okna zaznamená, ať víte, že k němu došlo.



Návod k Jiskře (dříve KvizHub) ve verzi z 26. 9. 2026. Zdrojový projekt: [github.com/eldorCZ/kv-z](https://github.com/eldorCZ/kv-z).
