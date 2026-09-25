import type Database from 'better-sqlite3';

/**
 * Hand written, forward-only migrations tracked via PRAGMA user_version.
 * SQL stays portable enough to be translated to Postgres later (see DECISIONS.md).
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE teachers (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    auth_provider TEXT NOT NULL DEFAULT 'local',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes_json TEXT NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE TABLE quizzes (
    id TEXT PRIMARY KEY,
    teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    language TEXT NOT NULL,
    grade_level TEXT NOT NULL DEFAULT '',
    source_files_json TEXT NOT NULL DEFAULT '[]',
    settings_json TEXT NOT NULL,
    idempotency_key TEXT,
    request_hash TEXT,
    idempotency_response TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX quizzes_idem ON quizzes(teacher_id, idempotency_key);
  CREATE INDEX quizzes_teacher ON quizzes(teacher_id);
  CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_json TEXT NOT NULL,
    accepted_answers_json TEXT NOT NULL,
    numeric_answer REAL,
    numeric_tolerance REAL,
    explanation TEXT NOT NULL DEFAULT '',
    bloom TEXT,
    difficulty TEXT,
    time_limit_sec INTEGER NOT NULL,
    points_mode TEXT NOT NULL,
    source_ref_json TEXT,
    qa_status TEXT NOT NULL,
    qa_notes TEXT NOT NULL DEFAULT '',
    approved_at INTEGER
  );
  CREATE INDEX questions_quiz ON questions(quiz_id, position);
  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    pin TEXT NOT NULL,
    host_key_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    question_ids_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    ends_at INTEGER,
    finished_at INTEGER
  );
  CREATE INDEX games_quiz ON games(quiz_id);
  CREATE INDEX games_created ON games(created_at);
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    joined_at INTEGER NOT NULL
  );
  CREATE INDEX players_game ON players(game_id);
  CREATE TABLE answers (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    correct INTEGER NOT NULL,
    points INTEGER NOT NULL,
    elapsed_ms INTEGER NOT NULL
  );
  CREATE INDEX answers_game ON answers(game_id);
  CREATE UNIQUE INDEX answers_unique ON answers(player_id, question_id);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    token_id TEXT,
    endpoint TEXT NOT NULL,
    status INTEGER NOT NULL
  );
  CREATE INDEX audit_at ON audit_log(at);
  `,
  // 2: test mode (docs/TESTOVACI-REZIM.md, D4)
  `
  CREATE TABLE attempts (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    started_at INTEGER,
    deadline_at INTEGER,
    submitted_at INTEGER,
    allow_return INTEGER NOT NULL DEFAULT 0,
    percent INTEGER,
    score REAL,
    max_score REAL,
    question_ids_json TEXT NOT NULL,
    option_perms_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX attempts_game ON attempts(game_id);
  CREATE INDEX attempts_deadline ON attempts(status, deadline_at);
  `,
  // 3: leave guard (Dodatek 2, G4.1)
  `
  ALTER TABLE attempts ADD COLUMN leave_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE attempts ADD COLUMN leave_total INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE attempts ADD COLUMN away_total_ms INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE attempts ADD COLUMN locked_at INTEGER;
  ALTER TABLE attempts ADD COLUMN guard_exempt INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE attempts ADD COLUMN last_heartbeat_at INTEGER;
  ALTER TABLE attempts ADD COLUMN fullscreen_supported INTEGER;
  CREATE TABLE attempt_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    reason TEXT,
    source TEXT NOT NULL,
    at INTEGER NOT NULL,
    client_ts INTEGER,
    duration_ms INTEGER,
    counted INTEGER NOT NULL DEFAULT 0,
    seq INTEGER
  );
  CREATE INDEX attempt_events_attempt ON attempt_events(attempt_id, at);
  CREATE UNIQUE INDEX attempt_events_seq ON attempt_events(attempt_id, seq);
  `,
];

export function migrate(sqlite: Database.Database): void {
  const current = sqlite.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    sqlite.transaction(() => {
      sqlite.exec(MIGRATIONS[v]!);
      sqlite.pragma(`user_version = ${v + 1}`);
    })();
  }
}
