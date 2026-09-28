#!/usr/bin/env bash
# Hlídač produkčního Lore: když /healthz neodpoví, nahodí server znovu.
# Produkce běží jako holý nohup proces, bez systemd — tohle je jediná pojistka.
set -u
D=/home/medivh/kviz
NODE=/home/medivh/.hermes/node/bin/node
URL=http://127.0.0.1:3010

nahod() {
  echo "$(date '+%F %H:%M') $1, startuji znovu"
  PID=$(ss -ltnp 2>/dev/null | grep 3010 | grep -oE "pid=[0-9]+" | cut -d= -f2)
  [ -n "${PID:-}" ] && kill "$PID" 2>/dev/null
  sleep 3
  cd "$D" && set -a && . ./.env && set +a
  setsid nohup "$NODE" apps/server/dist/index.js >> "$D/lore.log" 2>&1 < /dev/null &
  sleep 8
  if curl -sf -m 8 "$URL/healthz" >/dev/null; then
    echo "$(date '+%F %H:%M') Lore znovu běží"
  else
    echo "$(date '+%F %H:%M') Lore se nepodařilo nahodit, viz lore.log"
  fi
}

curl -sf -m 8 "$URL/healthz" >/dev/null || { nahod "Lore neodpovídá"; exit 0; }

# Server si index.html drží v paměti od startu. Když se aplikace přestaví a
# nerestartuje, odkazuje na soubory s jiným otiskem, které už na disku nejsou —
# prohlížeč pak místo skriptu dostane index.html a učiteli se načte stará nebo
# rozbitá stránka. Stalo se 28. 9. 2026. Tady to poznáme a server nahodíme.
HLAVNI=$(curl -sf -m 8 "$URL/" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
if [ -n "${HLAVNI:-}" ]; then
  TYP=$(curl -sf -m 8 -o /dev/null -w '%{content_type}' "$URL$HLAVNI" || echo chyba)
  case "$TYP" in
    *javascript*) ;;
    *) nahod "Lore servíruje neexistující $HLAVNI (typ $TYP)" ;;
  esac
fi
