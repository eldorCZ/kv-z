/**
 * pnpm seed:demo-class – creates a demo class with 24 made-up students and 10 activities (tests and quizzes)
 * so the class overviews can be tried without real pupils. Deterministic: the same results on every run.
 * Not for production: refuses to run with NODE_ENV=production.
 *
 * Uses the database from DB_PATH (like the server) and the teacher DEMO_EMAIL (created when missing,
 * password DEMO_PASSWORD, default "demo-heslo-1234").
 */
import { buildApp } from '../apps/server/src/app.js';
import { hashPassword } from '../apps/server/src/auth/password.js';
import { insertActivity, type SeedItem } from '../apps/server/src/classes/seed.js';
import { classesEnabled, loadConfig } from '../apps/server/src/config.js';

if (process.env.NODE_ENV === 'production') {
  console.error('seed:demo-class se nesmí spouštět v produkci (NODE_ENV=production).');
  process.exit(1);
}

// made-up names only (pseudonyms), never real pupils
const NAMES = [
  'Adámková Alžběta', 'Bartoš Bohumil', 'Cibulková Cecílie', 'Doležal Dalibor', 'Erbenová Eliška', 'Fiala Filip',
  'Gregorová Gabriela', 'Havlík Hynek', 'Ilčíková Ivana', 'Jelínek Jáchym', 'Kolářová Klára', 'Lukeš Lubomír',
  'Mašková Magdaléna', 'Novotný Norbert', 'Ondrová Olga', 'Pokorný Přemysl', 'Říhová Radka', 'Stejskal Svatopluk',
  'Šimková Šárka', 'Tichý Tadeáš', 'Urbanová Uršula', 'Vávra Vojtěch', 'Zemanová Zdislava', 'Žák Žofín',
];
const TOPICS = ['Lom světla', 'Odraz světla', 'Čočky', 'Barvy a spektrum'];
const ACTIVITIES: { kind: 'test' | 'quiz'; label: string; topics: number[]; count?: boolean }[] = [
  { kind: 'quiz', label: 'Rozcvička: světlo', topics: [0, 1] },
  { kind: 'test', label: 'Test 1: odraz', topics: [1] },
  { kind: 'quiz', label: 'Kvíz: zrcadla', topics: [1] },
  { kind: 'test', label: 'Test 2: lom', topics: [0] },
  { kind: 'quiz', label: 'Zkušební kvíz', topics: [0], count: false },
  { kind: 'quiz', label: 'Kvíz: čočky', topics: [2] },
  { kind: 'test', label: 'Test 3: čočky', topics: [2] },
  { kind: 'quiz', label: 'Kvíz: barvy', topics: [3] },
  { kind: 'test', label: 'Test 4: barvy', topics: [3, 0] },
  { kind: 'test', label: 'Pololetní test', topics: [0, 1, 2, 3] },
];

/** mulberry32 – small deterministic PRNG */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cfg = loadConfig();
if (!classesEnabled(cfg)) {
  console.error('Třídy nejsou zapnuté: nastavte CODE_PEPPER (aspoň 32 znaků, např. openssl rand -hex 32).');
  process.exit(1);
}
const { app, services: s } = await buildApp({ ...cfg, logLevel: 'warn' });
const email = process.env.DEMO_EMAIL ?? 'demo@kvizhub.local';
const password = process.env.DEMO_PASSWORD ?? 'demo-heslo-1234';
let teacher = s.accounts.findTeacherByEmail(email);
if (!teacher) {
  s.accounts.createTeacher(email, await hashPassword(password));
  teacher = s.accounts.findTeacherByEmail(email)!;
  console.log(`Vytvořen učitel ${email} (heslo: ${password})`);
}

const cls = s.classes.create(teacher.id, { name: 'Demo 8.A (smyšlená data)', subject: 'Fyzika' });
const created = s.classes.addStudents(
  cls,
  NAMES.map((n, i) => {
    const [familyName, givenName] = n.split(' ');
    return { familyName, givenName, rosterNo: i + 1 };
  }),
);
const ids = created.map((c) => c.student.id);
const db = s.db.$client;

const DAY = 86_400_000;
const today = new Date();
today.setHours(10, 0, 0, 0);
// activities spread over the current school year up to today (at least one day apart)
const yearStart = new Date(`${cls.schoolYear.slice(0, 4)}-09-01T10:00:00`).getTime();
const step = Math.max(DAY, Math.floor((today.getTime() - yearStart) / ACTIVITIES.length / DAY) * DAY);
const firstDay = today.getTime() - ACTIVITIES.length * step;
const dateOf = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
db.prepare('UPDATE students SET since = ? WHERE class_id = ?').run(dateOf(firstDay - DAY), cls.id);
// one pupil left the class after the fifth activity, one joined after the third
db.prepare('UPDATE students SET active = 0, left_at = ? WHERE id = ?').run(dateOf(firstDay + 4 * step), ids[22]);
db.prepare('UPDATE students SET since = ? WHERE id = ?').run(dateOf(firstDay + 3 * step - DAY), ids[23]);

const rand = rng(20250901);
// base skill per pupil; pupil 3 declines, pupil 7 is weak, pupil 11 is often absent
const skill = ids.map((_, i) => 0.45 + ((i * 37) % 50) / 100);
skill[7] = 0.35;
let tests = 0;
const absentFromTest: Record<number, string[]> = {};
ACTIVITIES.forEach((a, ai) => {
  const playedAt = firstDay + ai * step;
  const results = ids.flatMap((sid, si) => {
    if (si === 22 && ai > 4) return [];
    if (si === 23 && ai < 3) return [];
    const absent = (si === 11 && ai % 2 === 1) || rand() < 0.06;
    if (absent) {
      if (a.kind === 'test') (absentFromTest[ai] ??= []).push(sid);
      return [];
    }
    let p = skill[si]!;
    if (si === 3) p = 0.9 - ai * 0.06;
    const items: SeedItem[] = [];
    for (let q = 0; q < 8; q++) {
      const topic = TOPICS[a.topics[q % a.topics.length]!]!;
      const hard = q === 5 ? 0.25 : 0;
      items.push({ topic, prompt: `${a.label} – otázka ${q + 1}`, questionId: `demo-${ai}-${q}`, scoreMilli: rand() < p - hard ? 1000 : 0 });
    }
    const percent = Math.round((100 * items.reduce((x, i) => x + i.scoreMilli, 0)) / 8000);
    return [{ studentId: sid, percent, items }];
  });
  const id = insertActivity(db, { classId: cls.id, kind: a.kind, label: a.label, playedAt, rosterSize: ai > 4 ? 23 : ai < 3 ? 23 : 24, countInStats: a.count !== false, results });
  if (a.kind === 'test') {
    tests++;
    // the first test with absent pupils gets a makeup two days later for half of them
    const missing = absentFromTest[ai] ?? [];
    if (tests === 2 && missing.length) {
      const back = missing.slice(0, Math.ceil(missing.length / 2));
      insertActivity(db, {
        classId: cls.id,
        kind: 'test',
        label: `${a.label} – dopsání`,
        playedAt: playedAt + Math.max(1, Math.floor(step / DAY / 2)) * DAY,
        rosterSize: missing.length,
        rootActivityId: id,
        results: back.map((sid) => ({ studentId: sid, percent: Math.round(skill[ids.indexOf(sid)]! * 100) })),
      });
    }
  }
});

console.log(`Třída „${cls.name}“ vytvořena: ${ids.length} žáků, ${ACTIVITIES.length} aktivit.`);
console.log(`Přihlaste se jako ${email} a otevřete ${cfg.publicUrl}/classes/${cls.id}`);
console.log('Ukázkové osobní kódy (zobrazí se jen teď):');
for (const c of created.slice(0, 3)) console.log(`  ${c.student.publicName}: ${c.code}`);
await app.close();
