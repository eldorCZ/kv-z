/**
 * pnpm seed:demo-class – creates a demo class with 24 students and 10 activities (tests and quizzes)
 * (pseudonyms zak01 to zak24 with numbers 1–24, shown as "Žák 01" … when names are hidden) so the class overviews can be tried without real pupils. Deterministic: the same results on every run.
 * Not for production: refuses to run with NODE_ENV=production.
 *
 * Uses the database from DB_PATH (like the server) and the teacher DEMO_EMAIL (created when missing,
 * password DEMO_PASSWORD, default "demo-heslo-1234").
 */
import { buildApp } from "../apps/server/src/app.js";
import { hashPassword } from "../apps/server/src/auth/password.js";
import { classesEnabled, loadConfig } from "../apps/server/src/config.js";
import { createDemoClass } from "./demo-class.js";

if (process.env.NODE_ENV === "production") {
  console.error(
    "seed:demo-class se nesmí spouštět v produkci (NODE_ENV=production).",
  );
  process.exit(1);
}

const cfg = loadConfig();
if (!classesEnabled(cfg)) {
  console.error(
    "Třídy nejsou zapnuté: nastavte CODE_PEPPER (aspoň 32 znaků, např. openssl rand -hex 32).",
  );
  process.exit(1);
}
const { app, services: s } = await buildApp({ ...cfg, logLevel: "warn" });
const email = process.env.DEMO_EMAIL ?? "demo@kvizhub.local";
const password = process.env.DEMO_PASSWORD ?? "demo-heslo-1234";
let teacher = s.accounts.findTeacherByEmail(email);
if (!teacher) {
  s.accounts.createTeacher(email, await hashPassword(password));
  teacher = s.accounts.findTeacherByEmail(email)!;
  console.log(`Vytvořen učitel ${email} (heslo: ${password})`);
}

const { cls, created } = createDemoClass(s, teacher.id);
const ids = created.map((c) => c.student.id);
console.log(`Třída „${cls.name}“ vytvořena: ${ids.length} žáků, 10 aktivit.`);
console.log(
  `Přihlaste se jako ${email} a otevřete ${cfg.publicUrl}/classes/${cls.id}`,
);
console.log("Ukázkové osobní kódy (zobrazí se jen teď):");
for (const c of created.slice(0, 3))
  console.log(`  ${c.student.accountName}: ${c.code}`);
await app.close();
