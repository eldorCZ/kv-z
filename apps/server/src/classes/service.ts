import {
  classInputSchema,
  classSettingsSchema,
  currentSchoolYear,
  derivePublicName,
  formatCode,
  generateCode,
  normalizeCode,
  parseRosterCsv,
  parseRosterLines,
  rosterWarnings,
  schoolYearEnd,
  studentInputSchema,
  validateWith,
  type ClassSettings,
  type RosterRow,
} from '@kvizhub/core';
import { randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { HttpError } from '../game/service.js';
import { hmac, newId } from '../util.js';

export type ClassRole = 'owner' | 'editor' | 'viewer';
const RANK: Record<ClassRole, number> = { viewer: 1, editor: 2, owner: 3 };

export interface ClassRow {
  id: string;
  name: string;
  schoolYear: string;
  subject: string | null;
  status: 'active' | 'archived';
  settings: ClassSettings;
  schoolYearEnd: string;
  archivedAt: number | null;
  createdAt: number;
  role: ClassRole;
}

export interface StudentRow {
  id: string;
  classId: string;
  familyName: string;
  givenName: string;
  publicName: string;
  rosterNo: number | null;
  active: boolean;
  since: string;
  leftAt: string | null;
  codeRotatedAt: number | null;
  createdAt: number;
}

type Raw = Record<string, unknown>;

function toClass(r: Raw, role: ClassRole): ClassRow {
  return {
    id: r.id as string,
    name: r.name as string,
    schoolYear: r.school_year as string,
    subject: (r.subject as string | null) ?? null,
    status: r.status as ClassRow['status'],
    settings: classSettingsSchema.parse(JSON.parse(r.settings_json as string)),
    schoolYearEnd: r.school_year_end as string,
    archivedAt: (r.archived_at as number | null) ?? null,
    createdAt: r.created_at as number,
    role,
  };
}

export function toStudent(r: Raw): StudentRow {
  return {
    id: r.id as string,
    classId: r.class_id as string,
    familyName: r.family_name as string,
    givenName: r.given_name as string,
    publicName: r.public_name as string,
    rosterNo: (r.roster_no as number | null) ?? null,
    active: r.active === 1,
    since: r.since as string,
    leftAt: (r.left_at as string | null) ?? null,
    codeRotatedAt: (r.code_rotated_at as number | null) ?? null,
    createdAt: r.created_at as number,
  };
}

const collator = new Intl.Collator('cs');
export function sortStudents<T extends { rosterNo: number | null; familyName: string; givenName: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      (a.rosterNo ?? 1000) - (b.rosterNo ?? 1000) || collator.compare(a.familyName, b.familyName) || collator.compare(a.givenName, b.givenName),
  );
}

const today = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * Classes, roster and personal codes (Dodatek 3, C4). Only the HMAC of a code is stored (C4.4).
 * Every operation goes through assertClassAccess (C4.8).
 */
export class ClassService {
  private readonly sql: Database.Database;

  constructor(
    private readonly cfg: Config,
    db: Db,
    private readonly now: () => number,
  ) {
    this.sql = db.$client;
  }

  codeLookup(normalized: string) {
    return hmac(this.cfg.codePepper, `code:${normalized}`);
  }

  // ---------------------------------------------------------------- access

  /** 404 when the teacher has no role in the class (existence is not revealed), 403 when the role is too low. */
  assertClassAccess(teacherId: string, classId: string, minRole: ClassRole): ClassRow {
    const r = this.sql
      .prepare('SELECT c.*, ct.role FROM classes c JOIN class_teachers ct ON ct.class_id = c.id WHERE c.id = ? AND ct.teacher_id = ?')
      .get(classId, teacherId) as Raw | undefined;
    if (!r) throw new HttpError(404, 'Třída nenalezena.', 'not_found');
    const role = r.role as ClassRole;
    if (RANK[role] < RANK[minRole]) throw new HttpError(403, 'K této akci nemáte ve třídě oprávnění.', 'forbidden');
    return toClass(r, role);
  }

  log(teacherId: string, action: string, classId: string, studentId: string | null = null, itemCount: number | null = null) {
    this.sql.prepare('INSERT INTO access_log (at, teacher_id, action, class_id, student_id, item_count) VALUES (?, ?, ?, ?, ?, ?)').run(this.now(), teacherId, action, classId, studentId, itemCount);
  }

  accessLog(classId: string, limit = 200) {
    return this.sql
      .prepare(
        'SELECT a.at, a.action, a.student_id AS studentId, a.item_count AS itemCount, t.email AS teacher FROM access_log a LEFT JOIN teachers t ON t.id = a.teacher_id WHERE a.class_id = ? ORDER BY a.id DESC LIMIT ?',
      )
      .all(classId, limit);
  }

  // ---------------------------------------------------------------- classes

  list(teacherId: string, minRole: ClassRole = 'viewer'): ClassRow[] {
    const rows = this.sql
      .prepare('SELECT c.*, ct.role FROM classes c JOIN class_teachers ct ON ct.class_id = c.id WHERE ct.teacher_id = ? ORDER BY c.status, c.school_year DESC, c.name')
      .all(teacherId) as Raw[];
    return rows.map((r) => toClass(r, r.role as ClassRole)).filter((c) => RANK[c.role] >= RANK[minRole]);
  }

  create(teacherId: string, input: unknown): ClassRow {
    const v = validateWith(classInputSchema, input);
    if (!v.ok) throw Object.assign(new HttpError(422, 'Neplatné údaje třídy.', 'validation'), { errors: v.errors });
    const schoolYear = v.data.schoolYear ?? currentSchoolYear(new Date(this.now()));
    const id = newId();
    this.sql.transaction(() => {
      this.sql
        .prepare('INSERT INTO classes (id, name, school_year, subject, status, settings_json, school_year_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, v.data.name, schoolYear, v.data.subject || null, 'active', JSON.stringify(classSettingsSchema.parse(v.data.settings ?? {})), schoolYearEnd(schoolYear), this.now());
      this.sql.prepare("INSERT INTO class_teachers (class_id, teacher_id, role) VALUES (?, ?, 'owner')").run(id, teacherId);
    })();
    return this.assertClassAccess(teacherId, id, 'owner');
  }

  update(c: ClassRow, input: unknown): void {
    const v = validateWith(classInputSchema.partial(), input);
    if (!v.ok) throw Object.assign(new HttpError(422, 'Neplatné údaje třídy.', 'validation'), { errors: v.errors });
    if (v.data.name !== undefined) this.sql.prepare('UPDATE classes SET name = ? WHERE id = ?').run(v.data.name, c.id);
    if (v.data.subject !== undefined) this.sql.prepare('UPDATE classes SET subject = ? WHERE id = ?').run(v.data.subject || null, c.id);
    if (v.data.schoolYear !== undefined) this.sql.prepare('UPDATE classes SET school_year = ?, school_year_end = ? WHERE id = ?').run(v.data.schoolYear, schoolYearEnd(v.data.schoolYear), c.id);
    if (v.data.settings) this.sql.prepare('UPDATE classes SET settings_json = ? WHERE id = ?').run(JSON.stringify(classSettingsSchema.parse({ ...c.settings, ...v.data.settings })), c.id);
  }

  archive(c: ClassRow) {
    this.sql.prepare("UPDATE classes SET status = 'archived', archived_at = ? WHERE id = ?").run(this.now(), c.id);
  }

  /** Deletes the class and its records (cascade). Games stay, without a class. */
  delete(c: ClassRow, confirmName: unknown) {
    if (typeof confirmName !== 'string' || confirmName.trim() !== c.name) throw new HttpError(400, 'Pro smazání opište přesný název třídy.', 'confirm_name');
    this.sql.transaction(() => {
      this.renamePlayersOfClass(c.id);
      this.sql.prepare('DELETE FROM classes WHERE id = ?').run(c.id);
      this.sql.prepare('DELETE FROM access_log WHERE class_id = ?').run(c.id);
    })();
  }

  // ---------------------------------------------------------------- students

  students(classId: string): StudentRow[] {
    return sortStudents((this.sql.prepare('SELECT * FROM students WHERE class_id = ?').all(classId) as Raw[]).map(toStudent));
  }

  student(classId: string, studentId: string): StudentRow {
    const r = this.sql.prepare('SELECT * FROM students WHERE id = ? AND class_id = ?').get(studentId, classId) as Raw | undefined;
    if (!r) throw new HttpError(404, 'Žák nenalezen.', 'not_found');
    return toStudent(r);
  }

  preview(c: ClassRow, body: { text?: unknown; format?: unknown; order?: unknown }) {
    const text = typeof body.text === 'string' ? body.text.slice(0, 200_000) : '';
    const rows: RosterRow[] =
      body.format === 'csv' ? parseRosterCsv(text) : parseRosterLines(text, body.order === 'given-family' ? 'given-family' : 'family-given');
    const existing = this.students(c.id);
    const taken = existing.map((s) => s.publicName);
    const withNames = rows.map((r) => {
      if (r.error) return { ...r, publicName: null };
      const publicName = derivePublicName(r.givenName, r.familyName, taken);
      taken.push(publicName);
      return { ...r, publicName };
    });
    const warnings = rosterWarnings(rows, existing, this.cfg.maxStudentsPerClass);
    return { rows: withNames, warnings, valid: rows.filter((r) => !r.error).length, total: existing.length + rows.filter((r) => !r.error).length };
  }

  private newCode(): { code: string; lookup: string } {
    for (let i = 0; i < 5; i++) {
      const code = generateCode((max) => randomInt(max));
      const lookup = this.codeLookup(code);
      if (!this.sql.prepare('SELECT 1 FROM students WHERE code_lookup = ?').get(lookup)) return { code, lookup };
    }
    throw new HttpError(500, 'Nepodařilo se vytvořit jedinečný kód, zkuste to znovu.', 'code_collision');
  }

  /** Adds students; the plain codes are returned exactly once (C4.4). */
  addStudents(c: ClassRow, input: unknown[]): { student: StudentRow; code: string }[] {
    if (c.status !== 'active') throw new HttpError(409, 'Třída je archivovaná.', 'archived');
    const existing = this.students(c.id);
    if (existing.length + input.length > this.cfg.maxStudentsPerClass) {
      throw new HttpError(422, `Třída může mít nejvýše ${this.cfg.maxStudentsPerClass} žáků.`, 'too_many_students');
    }
    const taken = existing.map((s) => s.publicName);
    const parsed = input.map((raw, i) => {
      const v = validateWith(studentInputSchema, raw);
      if (!v.ok) throw Object.assign(new HttpError(422, `Řádek ${i + 1}: ${v.errors[0]!.message}`, 'validation'), { errors: v.errors });
      return v.data;
    });
    const out: { student: StudentRow; code: string }[] = [];
    const now = this.now();
    this.sql.transaction(() => {
      for (const s of parsed) {
        const publicName = s.publicName ?? derivePublicName(s.givenName, s.familyName, taken);
        taken.push(publicName);
        const { code, lookup } = this.newCode();
        const id = newId();
        this.sql
          .prepare(
            'INSERT INTO students (id, class_id, family_name, given_name, public_name, roster_no, code_lookup, code_rotated_at, active, since, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
          )
          .run(id, c.id, s.familyName, s.givenName, publicName, s.rosterNo ?? null, lookup, now, s.since ?? today(now), now);
        out.push({ student: this.student(c.id, id), code: formatCode(code) });
      }
    })();
    return out;
  }

  updateStudent(c: ClassRow, studentId: string, input: unknown) {
    const cur = this.student(c.id, studentId);
    const v = validateWith(studentInputSchema.partial(), input);
    if (!v.ok) throw Object.assign(new HttpError(422, v.errors[0]!.message, 'validation'), { errors: v.errors });
    const d = v.data;
    this.sql
      .prepare('UPDATE students SET family_name = ?, given_name = ?, public_name = ?, roster_no = ?, since = ? WHERE id = ?')
      .run(d.familyName ?? cur.familyName, d.givenName ?? cur.givenName, d.publicName ?? cur.publicName, d.rosterNo === undefined ? cur.rosterNo : d.rosterNo, d.since ?? cur.since, studentId);
    return this.student(c.id, studentId);
  }

  /** New code for a student: the old one stops working immediately. */
  rotate(c: ClassRow, studentIds: string[]): { student: StudentRow; code: string }[] {
    if (c.status !== 'active') throw new HttpError(409, 'Třída je archivovaná, kódy neplatí.', 'archived');
    const out: { student: StudentRow; code: string }[] = [];
    this.sql.transaction(() => {
      for (const id of studentIds) {
        this.student(c.id, id);
        const { code, lookup } = this.newCode();
        this.sql.prepare('UPDATE students SET code_lookup = ?, code_rotated_at = ? WHERE id = ?').run(lookup, this.now(), id);
        out.push({ student: this.student(c.id, id), code: formatCode(code) });
      }
    })();
    return out;
  }

  setActive(c: ClassRow, studentId: string, active: boolean) {
    this.student(c.id, studentId);
    this.sql.prepare('UPDATE students SET active = ?, left_at = ? WHERE id = ?').run(active ? 1 : 0, active ? null : today(this.now()), studentId);
    return this.student(c.id, studentId);
  }

  /** C9.5: erase the personal data of one student; results stay only as unlinkable class aggregates. */
  eraseStudent(c: ClassRow, studentId: string) {
    this.student(c.id, studentId);
    this.sql.transaction(() => {
      this.renamePlayers('SELECT id, game_id FROM players WHERE student_id = ?', studentId);
      this.sql.prepare('DELETE FROM students WHERE id = ?').run(studentId);
    })();
  }

  /** Player names of a class game become "Žák N" (N = join order in that game). */
  private renamePlayers(select: string, arg: string) {
    const rows = this.sql.prepare(select).all(arg) as { id: string; game_id: string }[];
    for (const p of rows) {
      const all = this.sql.prepare('SELECT id FROM players WHERE game_id = ? ORDER BY joined_at, id').all(p.game_id) as { id: string }[];
      const n = all.findIndex((x) => x.id === p.id) + 1;
      this.sql.prepare('UPDATE players SET nickname = ? WHERE id = ?').run(`Žák ${n}`, p.id);
    }
  }

  private renamePlayersOfClass(classId: string) {
    this.renamePlayers('SELECT p.id, p.game_id FROM players p JOIN students s ON s.id = p.student_id WHERE s.class_id = ?', classId);
  }

  /** C9.4: anonymise the class (students deleted, results unlinked, player names replaced). */
  anonymize(classId: string) {
    this.sql.transaction(() => {
      this.renamePlayersOfClass(classId);
      this.sql.prepare('DELETE FROM students WHERE class_id = ?').run(classId);
    })();
  }

  /** Date of the anonymisation: max(school_year_end, archived_at) + CLASS_RETENTION_MONTHS. */
  anonymizeAt(c: Pick<ClassRow, 'schoolYearEnd' | 'archivedAt'>): number {
    const end = Math.max(Date.parse(`${c.schoolYearEnd}T23:59:59Z`), c.archivedAt ?? 0);
    const d = new Date(end);
    d.setUTCMonth(d.getUTCMonth() + this.cfg.classRetentionMonths);
    return d.getTime();
  }

  /** Daily job. */
  runRetention(now: number) {
    let classes = 0;
    const rows = this.sql.prepare('SELECT id, school_year_end, archived_at FROM classes').all() as Raw[];
    for (const r of rows) {
      const at = this.anonymizeAt({ schoolYearEnd: r.school_year_end as string, archivedAt: (r.archived_at as number | null) ?? null });
      if (at <= now) {
        const has = this.sql.prepare('SELECT 1 FROM students WHERE class_id = ?').get(r.id);
        if (has) {
          this.anonymize(r.id as string);
          classes++;
        }
      }
    }
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - this.cfg.accessLogRetentionMonths);
    const log = this.sql.prepare('DELETE FROM access_log WHERE at < ?').run(cutoff.getTime()).changes;
    return { classes, accessLog: log };
  }

  // ---------------------------------------------------------------- identification by code

  /** Active student of the class with this code, or undefined (never reveals why). */
  findByCode(classId: string, rawCode: unknown): StudentRow | undefined {
    const code = normalizeCode(rawCode);
    if (!code) return undefined;
    const r = this.sql
      .prepare("SELECT s.* FROM students s JOIN classes c ON c.id = s.class_id WHERE s.code_lookup = ? AND s.class_id = ? AND s.active = 1 AND c.status = 'active'")
      .get(this.codeLookup(code), classId) as Raw | undefined;
    return r ? toStudent(r) : undefined;
  }
}
