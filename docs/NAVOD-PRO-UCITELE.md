# KvizHub — návod pro učitele


Kvízy a testy ve třídě na vlastním serveru. Žáci nepotřebují účty, výsledky nikam neodcházejí. Tenhle návod projde první kvíz, hru ve třídě, třídy s evidencí a nakonec agenta, který kvízy vyrábí z vašich materiálů.

## Než začnete

Aplikace běží na adrese, kterou máte od správce. Přihlašujete se e-mailem a heslem. **Žáci se nepřihlašují** — do hry vstupují PINem, v testu ještě svým osobním kódem.

## První kvíz za pět minut

1.  **Přihlaste se** a jděte na **Moje kvízy**.
2.  **Nový kvíz** → napište název a přidejte otázky. Nebo **Nahrát JSON**, když máte kvíz ze souboru.
3.  U kvízu dejte **Spustit**. Vyberte, jestli jde o **hru** (společně, na body) nebo **test** (samostatně, se známkou).
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

Hra je společná: všichni vidí otázku na projektoru, odpovídají na mobilu a po každé otázce se ukáže žebříček. Body jsou za správnost i za rychlost.

  - **Projektor** — obrazovka s otázkou, odpočtem a po vyhodnocení s žebříčkem.
  - **Mobil žáka** — jen barevná tlačítka, otázku čte z projektoru.
  - **Konec hry** — pořadí a úspěšnost po otázkách, takže hned vidíte, co třída nepochopila.



**Odkaz na projektor nedávejte žákům.** Obsahuje klíč, kterým se hra ovládá. Žákům patří jen PIN nebo QR kód.



## Test místo hry

Test žáci píší každý svým tempem, bez žebříčku a bez bodů za rychlost. Používá se s třídou, takže víte, kdo co odevzdal.

  - Žák zadá PIN a pak **svůj osobní kód** — tím se ví, komu výsledek patří.
  - Aplikace hlídá **opuštění okna**: když žák přepne na jinou aplikaci, zaznamená se to.
  - **Náhradní termín** pro nemocné se zakládá v kartě třídy, v záložce Aktivity.

## Třídy a osobní kódy

Třída je skupina žáků na jeden školní rok. Zakládá se v menu **Třídy**, žáci se vloží jako soupiska. Každý dostane **osmiznakový kód**, kterým se v testu identifikuje.



### Co s kódy prakticky

  - Kódy se ukážou **jen jednou**. Hned je vytiskněte — aplikace nabízí kartičky na A4.
  - V kódu nejsou znaky, které se pletou: chybí I, L, O, nula i jednička.
  - Kód se zobrazuje po čtyřech (`K7MQ-2XRT`) a při zadávání se pomlčky ignorují.
  - **Zapomenutý kód není problém** — jde vygenerovat nový jednomu žákovi i celé třídě naráz.





**Tip do praxe.** Kartičky si nechte u sebe a rozdávejte je na začátku hodiny, nebo je nalepte do žákovských knížek. Když je dostanou domů volně, polovina je ztratí do týdne.



## Výsledky a vysvědčení

  - **Hry a výsledky** — přehled odehraných her, úspěšnost po otázkách, pořadí.
  - **Karta třídy** — matice žáků a aktivit, profil jednotlivého žáka, témata a jejich zvládnutí.
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
    
        read -s -p "Token: " T && printf '%s' "$T" > ~/.secrets/kvizhub.token \
          && chmod 600 ~/.secrets/kvizhub.token && unset T

3.  Nainstalujte dovednost k agentovi:
    
        cp -r agent-skill/kviz-z-materialu ~/.claude/skills/
        cd ~/.claude/skills/kviz-z-materialu
        python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

4.  Nastavte agentovi proměnné prostředí (v souboru, který si jeho relace načítá):
    
        export KVIZHUB_URL="http://127.0.0.1:3010"
        export KVIZHUB_TOKEN="$(cat ~/.secrets/kvizhub.token)"

5.  Restartujte relaci agenta a pošlete mu v Telegramu soubor se zprávou *„udělej z toho kvíz na 8 otázek pro 8. třídu"*.



**Soupisku žáků agentovi neposílejte.** Jména, známky ani kontakty do chatu nepatří — soubory procházejí Telegramem. Soupisku vkládejte přímo v aplikaci v kartě třídy. Agent je nastavený tak, že takový soubor odmítne.



## Časté otázky

Potřebují žáci účty nebo e-maily?

Ne. Do hry vstupují PINem a přezdívkou, do testu ještě osobním kódem. Ukládá se jen přezdívka nebo kód a odpovědi.

Co když žák zapomene kód?

V kartě třídy mu vygenerujete nový, buď jemu, nebo celé třídě naráz. Starý tím přestane platit.

Co když si žák kódy vymění s kamarádem?

Kód je jen identifikace, ne heslo. Pokud na tom v testu záleží, rozdejte kartičky až ve třídě a vyberte je po hodině.

Celá třída je na jedné Wi-Fi. Není to problém?

Aplikace omezuje počet připojení z jedné adresy za minutu. Když jsou všichni za jednou školní IP, může se stát, že se poslední žáci nepřipojí napoprvé. Řekněte správci, ať limit zvýší.

Dá se kvíz použít i v Kahootu?

Ano, exportem do formátu Kahootu (tabulka XLSX). Otázky a odpovědi se při tom zkracují na délku, kterou Kahoot povoluje.

Jak dlouho se data drží?

Výsledky her a hráči se po roce mažou, kvízy zůstávají. Dobu nastavuje správce.

Může kvíz vytvořit agent úplně sám, bez mé kontroly?

Vloží ho, ale nejisté otázky označí a ty se do hry nedostanou, dokud je neschválíte. Schvalovací právo token agenta nemá.

Vidí na výsledky někdo jiný?

Ne. Data jsou na vašem serveru a vidí je jen přihlášený učitel. Aplikace nikam nevolá a nepoužívá žádný jazykový model — ten je jen na straně agenta, když kvíz vyrábí.

Co když během hry vypadne internet nebo se zavře stránka?

Žák se vrátí na stejnou adresu a připojí se znovu. V testu se zavření okna zaznamená, ať víte, že k němu došlo.



Návod ke KvizHubu ve verzi z 26. 9. 2026. Zdrojový projekt: [github.com/eldorCZ/kv-z](https://github.com/eldorCZ/kv-z).
