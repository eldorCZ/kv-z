#!/usr/bin/env bash
# Nasadí Lore na produkci (port 3010): záloha databáze, build, restart, kontrola.
# Absolutní cesta k Nodu schválně – cron ani jiné prostředí nemá Node 22 v PATH.
set -eu
D=/home/medivh/kviz
NODE=/home/medivh/.hermes/node/bin/node
export PATH="/home/medivh/.hermes/node/lib/node_modules/corepack/shims:/home/medivh/.hermes/node/bin:$PATH"

cd "$D"
mkdir -p zalohy
cp data/kvizhub.db "zalohy/kvizhub-$(date +%F-%H%M).db"
ls -1t zalohy/*.db | tail -n +11 | xargs -r rm      # držíme posledních 10

pnpm -s build

PID=$(ss -ltnp 2>/dev/null | grep 3010 | grep -oE "pid=[0-9]+" | cut -d= -f2 || true)
[ -n "${PID:-}" ] && kill "$PID" 2>/dev/null || true
sleep 3

set -a; . ./.env; set +a
setsid nohup "$NODE" apps/server/dist/index.js >> "$D/lore.log" 2>&1 < /dev/null &
sleep 7
if curl -sf -m 8 http://127.0.0.1:3010/healthz >/dev/null; then
  echo "$(date '+%F %H:%M') nasazeno, $(git -C "$D" log --oneline -1)"
else
  echo "$(date '+%F %H:%M') NENABĚHLO, viz lore.log"; tail -5 "$D/lore.log"; exit 1
fi
