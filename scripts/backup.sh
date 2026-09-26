#!/usr/bin/env bash
# Online backup of the Lore SQLite database (safe while the app is running) and of the uploaded
# background images (MEDIA_DIR, default /data/media next to the database).
# Usage:   scripts/backup.sh [target-dir] [keep-days]
# Cron:    15 2 * * * /opt/kvizhub/scripts/backup.sh /var/backups/kvizhub 30 >> /var/log/kvizhub-backup.log 2>&1
# Encryption (recommended, backups contain personal data of students when classes are used):
#   BACKUP_AGE_RECIPIENT=age1...        encrypt with age (public key)
#   BACKUP_GPG_RECIPIENT=admin@skola.cz  encrypt with gpg (public key in the keyring)
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

# custom background images (Dodatek 4, V8): a tar next to the database copy
MEDIA_OUT="$TARGET_DIR/kvizhub-media-$STAMP.tar.gz"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
  docker exec "$CONTAINER" sh -c 'd="${MEDIA_DIR:-$(dirname "$DB_PATH")/media}"; [ -d "$d" ] && tar -C "$d" -czf - . || true' > "$MEDIA_OUT"
elif [ -n "${DB_PATH:-}" ]; then
  MEDIA="${MEDIA_DIR:-$(dirname "$DB_PATH")/media}"
  if [ -d "$MEDIA" ]; then tar -C "$MEDIA" -czf "$MEDIA_OUT" .; else : > "$MEDIA_OUT"; fi
fi
[ -s "$MEDIA_OUT" ] || rm -f "$MEDIA_OUT"

encrypt() {
  local f="$1"
  if [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    command -v age >/dev/null || { echo "BACKUP_AGE_RECIPIENT je nastavené, ale příkaz age chybí." >&2; rm -f "$f"; exit 1; }
    age -r "$BACKUP_AGE_RECIPIENT" -o "$f.age" "$f" && rm -f "$f"
    echo "$f.age"
  elif [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
    command -v gpg >/dev/null || { echo "BACKUP_GPG_RECIPIENT je nastavené, ale příkaz gpg chybí." >&2; rm -f "$f"; exit 1; }
    gpg --batch --yes --trust-model always -r "$BACKUP_GPG_RECIPIENT" -o "$f.gpg" -e "$f" && rm -f "$f"
    echo "$f.gpg"
  else
    echo "$f"
  fi
}

FINAL="$(encrypt "$OUT.gz")"
if [ -z "${BACKUP_AGE_RECIPIENT:-}${BACKUP_GPG_RECIPIENT:-}" ]; then
  echo "Varování: záloha není šifrovaná. Obsahuje-li databáze třídy, obsahuje i osobní údaje žáků (nastavte BACKUP_AGE_RECIPIENT nebo BACKUP_GPG_RECIPIENT)." >&2
fi
if [ -f "$MEDIA_OUT" ]; then
  MEDIA_FINAL="$(encrypt "$MEDIA_OUT")"
  chmod 600 "$MEDIA_FINAL"
fi
chmod 600 "$FINAL"
find "$TARGET_DIR" \( -name 'kvizhub-*.db.gz' -o -name 'kvizhub-*.db.gz.age' -o -name 'kvizhub-*.db.gz.gpg' -o -name 'kvizhub-media-*.tar.gz' -o -name 'kvizhub-media-*.tar.gz.age' -o -name 'kvizhub-media-*.tar.gz.gpg' \) -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) záloha hotová: $FINAL"
