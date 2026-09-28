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
