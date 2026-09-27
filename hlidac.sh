#!/usr/bin/env bash
# Hlídač produkčního Lore: když /healthz neodpoví, nahodí server znovu.
# Produkce běží jako holý nohup proces, bez systemd — tohle je jediná pojistka.
set -u
D=/home/medivh/kviz
NODE=/home/medivh/.hermes/node/bin/node

curl -sf -m 8 http://127.0.0.1:3010/healthz >/dev/null && exit 0

echo "$(date '+%F %H:%M') Lore neodpovídá, startuji znovu"
PID=$(ss -ltnp 2>/dev/null | grep 3010 | grep -oE "pid=[0-9]+" | cut -d= -f2)
[ -n "${PID:-}" ] && kill "$PID" 2>/dev/null
sleep 3
cd "$D" && set -a && . ./.env && set +a
setsid nohup "$NODE" apps/server/dist/index.js >> "$D/lore.log" 2>&1 < /dev/null &
sleep 8
if curl -sf -m 8 http://127.0.0.1:3010/healthz >/dev/null; then
  echo "$(date '+%F %H:%M') Lore znovu běží"
else
  echo "$(date '+%F %H:%M') Lore se nepodařilo nahodit, viz lore.log"
fi
