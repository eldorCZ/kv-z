import { and, desc, eq, lt } from 'drizzle-orm';
import { normalizeTheme, sanitizeUiPrefs, type QuizTheme, type UiPrefs } from '@kvizhub/core';
import type { Db } from '../db/index.js';
import { apiTokens, auditLog, sessions, teachers } from '../db/schema.js';
import { newId, sha256 } from '../util.js';

export const TOKEN_SCOPES = ['quizzes:write', 'quizzes:read', 'games:write', 'games:read', 'classes:read', 'results:pii'] as const;
/** Scopes a new token gets when none are specified; results:pii (student names) must be requested explicitly. */
export const DEFAULT_TOKEN_SCOPES = ['quizzes:write', 'quizzes:read', 'games:write', 'games:read', 'classes:read'] as const;
/** Only teacher sessions hold this scope; API tokens can never get it (contract 2.1, 2.5). */
export const APPROVE_SCOPE = 'quizzes:approve';
export type Scope = (typeof TOKEN_SCOPES)[number] | typeof APPROVE_SCOPE;

/** C9.10: at most 12 hours, and 60 minutes without activity. */
export const SESSION_TTL_MS = 12 * 3600 * 1000;
export const SESSION_IDLE_MS = 60 * 60 * 1000;

export class AccountRepo {
  constructor(private readonly db: Db) {}

  findTeacherByEmail(email: string) {
    return this.db.select().from(teachers).where(eq(teachers.email, email.toLowerCase())).get();
  }

  uiPrefs(teacherId: string): UiPrefs {
    const r = this.db.$client.prepare('SELECT ui_prefs_json FROM teachers WHERE id = ?').get(teacherId) as { ui_prefs_json: string | null } | undefined;
    return sanitizeUiPrefs(r?.ui_prefs_json ? JSON.parse(r.ui_prefs_json) : {});
  }

  setUiPrefs(teacherId: string, prefs: UiPrefs) {
    this.db.$client.prepare('UPDATE teachers SET ui_prefs_json = ? WHERE id = ?').run(JSON.stringify(prefs), teacherId);
  }

  /** Look of new quizzes (V7.3), null = Lore default. */
  defaultTheme(teacherId: string): QuizTheme | null {
    const r = this.db.$client.prepare('SELECT default_theme_json FROM teachers WHERE id = ?').get(teacherId) as { default_theme_json: string | null } | undefined;
    return r?.default_theme_json ? normalizeTheme(JSON.parse(r.default_theme_json), ['theme'], true).theme : null;
  }

  setDefaultTheme(teacherId: string, theme: QuizTheme | null) {
    this.db.$client.prepare('UPDATE teachers SET default_theme_json = ? WHERE id = ?').run(theme ? JSON.stringify(theme) : null, teacherId);
  }

  getTeacher(id: string) {
    return this.db.select().from(teachers).where(eq(teachers.id, id)).get();
  }

  createTeacher(email: string, passwordHash: string | null, provider = 'local') {
    const id = newId();
    this.db.insert(teachers).values({ id, email: email.toLowerCase(), passwordHash, authProvider: provider, createdAt: Date.now() }).run();
    return this.getTeacher(id)!;
  }

  createSession(teacherId: string, sessionId: string) {
    const now = Date.now();
    this.db.insert(sessions).values({ idHash: sha256(sessionId), teacherId, createdAt: now, expiresAt: now + SESSION_TTL_MS, lastSeenAt: now }).run();
  }

  getSession(sessionId: string) {
    const s = this.db.select().from(sessions).where(eq(sessions.idHash, sha256(sessionId))).get();
    const now = Date.now();
    if (!s || s.expiresAt < now || (s.lastSeenAt ?? s.createdAt) + SESSION_IDLE_MS < now) return undefined;
    // sliding idle window; written at most once a minute
    if (now - (s.lastSeenAt ?? 0) > 60_000) this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.idHash, s.idHash)).run();
    return s;
  }

  deleteSession(sessionId: string) {
    this.db.delete(sessions).where(eq(sessions.idHash, sha256(sessionId))).run();
  }

  purgeSessions() {
    this.db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
  }

  createToken(teacherId: string, name: string, scopes: string[], expiresAt: number | null, token: string) {
    const id = newId();
    this.db
      .insert(apiTokens)
      .values({ id, teacherId, name, tokenHash: sha256(token), scopesJson: JSON.stringify(scopes), expiresAt, createdAt: Date.now() })
      .run();
    return id;
  }

  findToken(token: string) {
    return this.db.select().from(apiTokens).where(eq(apiTokens.tokenHash, sha256(token))).get();
  }

  listTokens(teacherId: string) {
    return this.db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        scopesJson: apiTokens.scopesJson,
        expiresAt: apiTokens.expiresAt,
        revokedAt: apiTokens.revokedAt,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.teacherId, teacherId))
      .orderBy(desc(apiTokens.createdAt))
      .all()
      .map(({ scopesJson, ...t }) => ({ ...t, scopes: JSON.parse(scopesJson) as string[] }));
  }

  revokeToken(teacherId: string, id: string): boolean {
    const r = this.db
      .update(apiTokens)
      .set({ revokedAt: Date.now() })
      .where(and(eq(apiTokens.id, id), eq(apiTokens.teacherId, teacherId)))
      .run();
    return r.changes > 0;
  }

  touchToken(id: string) {
    this.db.update(apiTokens).set({ lastUsedAt: Date.now() }).where(eq(apiTokens.id, id)).run();
  }

  audit(tokenId: string | null, endpoint: string, status: number) {
    this.db.insert(auditLog).values({ at: Date.now(), tokenId, endpoint, status }).run();
  }

  listAudit(limit = 100) {
    return this.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(limit).all();
  }
}
