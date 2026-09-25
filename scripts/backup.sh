#!/usr/bin/env bash
# Online backup of the KvizHub SQLite database (safe while the app is running).
# Usage:   scripts/backup.sh [target-dir] [keep-days]
# Cron:    15 2 * * * /opt/kvizhub/scripts/backup.sh /var/backups/kvizhub 30 >> /var/log/kvizhub-backup.log 2>&1
set -euo pipefail

TARGET_DIR="${1:-./backups}"
KEEP_DAYS="${2:-30}"
CONTAINER="${KVIZHUB_CONTAINER:-kvizhub}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$TARGET_DIR"
OUT="$TARGET_DIR/kvizhub-$STAMP.db"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  # VACUUM INTO produces a consistent copy without stopping the app (uses better-sqlite3 inside the container)
  docker exec "$CONTAINER" rm -f /data/.backup-tmp.db
  docker exec "$CONTAINER" node -e "
    const db = require('better-sqlite3')(process.env.DB_PATH, { readonly: false });
    db.exec(\"VACUUM INTO '/data/.backup-tmp.db'\");
    db.close();
  "
  docker cp "$CONTAINER:/data/.backup-tmp.db" "$OUT"
  docker exec "$CONTAINER" rm -f /data/.backup-tmp.db
elif [ -n "${DB_PATH:-}" ] && command -v sqlite3 >/dev/null; then
  sqlite3 "$DB_PATH" ".backup '$OUT'"
else
  echo "Kontejner $CONTAINER neběží a DB_PATH + sqlite3 nejsou k dispozici." >&2
  exit 1
fi

gzip -f "$OUT"
find "$TARGET_DIR" -name 'kvizhub-*.db.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) záloha hotová: $OUT.gz"
