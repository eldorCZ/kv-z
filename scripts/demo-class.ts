/**
 * Deterministic demo class (Dodatek 3, C11): 24 pseudonyms, 10 activities with topics, absences, a makeup,
 * a falling and rising trend. Shared by `pnpm seed:demo-class` and `pnpm docs:screens`.
 */
import type { Services } from "../apps/server/src/app.js";
import {
  insertActivity,
  type SeedItem,
} from "../apps/server/src/classes/seed.js";

// pseudonyms only (an account name may not contain a space, so "Žák 01" becomes zak01), never real pupils
const NAMES = Array.from(
  { length: 24 },
  (_, i) => `zak${String(i + 1).padStart(2, "0")}`,
);
const TOPICS = ["Lom světla", "Odraz světla", "Čočky", "Barvy a spektrum"];
const ACTIVITIES: {
  kind: "test" | "quiz";
  label: string;
  topics: number[];
  count?: boolean;
}[] = [
  { kind: "quiz", label: "Rozcvička: světlo", topics: [0, 1] },
  { kind: "test", label: "Test 1: odraz", topics: [1] },
  { kind: "quiz", label: "Kvíz: zrcadla", topics: [1] },
  { kind: "test", label: "Test 2: lom", topics: [0] },
  { kind: "quiz", label: "Zkušební kvíz", topics: [0], count: false },
  { kind: "quiz", label: "Kvíz: čočky", topics: [2] },
  { kind: "test", label: "Test 3: čočky", topics: [2] },
  { kind: "quiz", label: "Kvíz: barvy", topics: [3] },
  { kind: "test", label: "Test 4: barvy", topics: [3, 0] },
  { kind: "test", label: "Pololetní test", topics: [0, 1, 2, 3] },
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

export function createDemoClass(s: Services, teacherId: string) {
  const cls = s.classes.create(teacherId, {
    name: "Demo 8.A (smyšlená data)",
    subject: "Fyzika",
  });
  const created = s.classes.addStudents(
    cls,
    NAMES.map((accountName, i) => ({ accountName, rosterNo: i + 1 })),
  );
  const ids = created.map((c) => c.student.id);
  const db = s.db.$client;

  const DAY = 86_400_000;
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  // activities spread over the current school year up to today (at least one day apart)
  const yearStart = new Date(
    `${cls.schoolYear.slice(0, 4)}-09-01T10:00:00`,
  ).getTime();
  const step = Math.max(
    DAY,
    Math.floor((today.getTime() - yearStart) / ACTIVITIES.length / DAY) * DAY,
  );
  const firstDay = today.getTime() - ACTIVITIES.length * step;
  const dateOf = (ms: number) =>
    new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 10);
  db.prepare("UPDATE students SET since = ? WHERE class_id = ?").run(
    dateOf(firstDay - DAY),
    cls.id,
  );
  // one pupil left the class after the fifth activity, one joined after the third
  db.prepare("UPDATE students SET active = 0, left_at = ? WHERE id = ?").run(
    dateOf(firstDay + 4 * step),
    ids[22],
  );
  db.prepare("UPDATE students SET since = ? WHERE id = ?").run(
    dateOf(firstDay + 3 * step - DAY),
    ids[23],
  );

  const rand = rng(20250901);
  // base skill per pupil; pupil 3 declines, pupils 5 and 15 improve, pupil 7 is weak, pupil 11 is often absent
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
        if (a.kind === "test") (absentFromTest[ai] ??= []).push(sid);
        return [];
      }
      let p = skill[si]!;
      if (si === 3) p = 0.9 - ai * 0.06;
      if (si === 5 || si === 15) p = 0.35 + ai * 0.06;
      const items: SeedItem[] = [];
      for (let q = 0; q < 8; q++) {
        const topic = TOPICS[a.topics[q % a.topics.length]!]!;
        const hard = q === 5 ? 0.25 : 0;
        items.push({
          topic,
          prompt: `${a.label} – otázka ${q + 1}`,
          questionId: `demo-${ai}-${q}`,
          scoreMilli: rand() < p - hard ? 1000 : 0,
        });
      }
      const percent = Math.round(
        (100 * items.reduce((x, i) => x + i.scoreMilli, 0)) / 8000,
      );
      return [{ studentId: sid, percent, items }];
    });
    const id = insertActivity(db, {
      classId: cls.id,
      kind: a.kind,
      label: a.label,
      playedAt,
      rosterSize: ai > 4 ? 23 : ai < 3 ? 23 : 24,
      countInStats: a.count !== false,
      results,
    });
    if (a.kind === "test") {
      tests++;
      // the first test with absent pupils gets a makeup two days later for half of them
      const missing = absentFromTest[ai] ?? [];
      if (tests === 2 && missing.length) {
        const back = missing.slice(0, Math.ceil(missing.length / 2));
        insertActivity(db, {
          classId: cls.id,
          kind: "test",
          label: `${a.label} – dopsání`,
          playedAt: playedAt + Math.max(1, Math.floor(step / DAY / 2)) * DAY,
          rosterSize: missing.length,
          rootActivityId: id,
          results: back.map((sid) => ({
            studentId: sid,
            percent: Math.round(skill[ids.indexOf(sid)]! * 100),
          })),
        });
      }
    }
  });

  return { cls, created, activities: ACTIVITIES.length };
}
