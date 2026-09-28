#!/usr/bin/env bash
# Nastaví nové heslo účtu učitele přímo v databázi Lore.
#
# Registrace je vypnutá a aplikace nemá obnovu hesla, takže tohle je jediná cesta
# zpět, kdyby se heslo ztratilo. Spouštět na serveru pod uživatelem medivh.
# Použití:  ~/kviz/heslo.sh zstasta86@gmail.com
set -eu

D=/home/medivh/kviz
NODE=/home/medivh/.hermes/node/bin/node
DB="${LORE_DB:-$D/data/kvizhub.db}"

[ $# -eq 1 ] || { echo "použití: heslo.sh <e-mail účtu>" >&2; exit 1; }
EMAIL="$1"

# echo vypínáme jen v terminálu; ze skriptu jde heslo podstrčit na vstupu
if [ -t 0 ]; then
  printf 'Nové heslo (min. 12 znaků, nezobrazuje se): '
  stty -echo; read -r HESLO; stty echo; echo
else
  read -r HESLO
fi
[ "${#HESLO}" -ge 12 ] || { echo "Heslo musí mít aspoň 12 znaků." >&2; exit 1; }

# běží z apps/server, kde leží @node-rs/argon2 i better-sqlite3 (pnpm workspace)
cat > "$D/apps/server/.heslo-docasne.mjs" <<'JS'
import { hash } from '@node-rs/argon2';
import Database from 'better-sqlite3';

const db = new Database(process.env.DB);
const email = process.env.EMAIL.trim().toLowerCase();
const ucet = db.prepare('SELECT id, email FROM teachers WHERE lower(email) = ?').get(email);
if (!ucet) {
  const kdo = db.prepare('SELECT email FROM teachers').all().map((r) => r.email);
  console.error(`Účet ${email} v databázi není. Existující: ${kdo.join(', ') || '(žádné)'}`);
  process.exit(1);
}
// stejné parametry jako apps/server/src/auth/password.ts – jinak by heslo neprošlo
const h = await hash(process.env.HESLO, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
db.prepare('UPDATE teachers SET password_hash = ? WHERE id = ?').run(h, ucet.id);
console.log(`Heslo účtu ${ucet.email} nastaveno.`);
JS

cd "$D/apps/server"
DB="$DB" EMAIL="$EMAIL" HESLO="$HESLO" "$NODE" .heslo-docasne.mjs
rm -f "$D/apps/server/.heslo-docasne.mjs"
echo "Přihlas se na https://lore.zdenekstasta.cz"
