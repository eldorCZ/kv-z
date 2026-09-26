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
  // 4: classes, roster and year-long records (Dodatek 3, C3). Records do NOT cascade from games.
  `
  CREATE TABLE classes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    school_year TEXT NOT NULL,
    subject TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    settings_json TEXT NOT NULL,
    school_year_end TEXT NOT NULL,
    archived_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE class_teachers (
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    PRIMARY KEY (class_id, teacher_id)
  );
  CREATE TABLE students (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    family_name TEXT NOT NULL,
    given_name TEXT NOT NULL DEFAULT '',
    public_name TEXT NOT NULL,
    roster_no INTEGER,
    code_lookup TEXT,
    code_rotated_at INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    since TEXT NOT NULL,
    left_at TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX students_code ON students(code_lookup);
  CREATE INDEX students_class ON students(class_id);
  CREATE TABLE class_activities (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    quiz_id TEXT REFERENCES quizzes(id) ON DELETE SET NULL,
    quiz_title TEXT NOT NULL,
    played_at INTEGER NOT NULL,
    count_in_stats INTEGER NOT NULL DEFAULT 1,
    root_activity_id TEXT REFERENCES class_activities(id) ON DELETE CASCADE,
    roster_size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX class_activities_class ON class_activities(class_id, played_at);
  CREATE TABLE activity_results (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL REFERENCES class_activities(id) ON DELETE CASCADE,
    student_id TEXT REFERENCES students(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    percent INTEGER NOT NULL,
    points_centi INTEGER NOT NULL,
    max_points_centi INTEGER NOT NULL,
    answered_count INTEGER NOT NULL,
    question_count INTEGER NOT NULL,
    excluded INTEGER NOT NULL DEFAULT 0,
    excluded_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX activity_results_unique ON activity_results(activity_id, student_id);
  CREATE TABLE result_items (
    activity_result_id TEXT NOT NULL REFERENCES activity_results(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    question_id TEXT,
    prompt_snapshot TEXT NOT NULL,
    topic TEXT,
    bloom TEXT,
    difficulty TEXT,
    weight INTEGER NOT NULL,
    score_milli INTEGER NOT NULL,
    answered INTEGER NOT NULL,
    PRIMARY KEY (activity_result_id, position)
  );
  CREATE TABLE access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    teacher_id TEXT NOT NULL,
    action TEXT NOT NULL,
    class_id TEXT NOT NULL,
    student_id TEXT,
    item_count INTEGER
  );
  CREATE INDEX access_log_class ON access_log(class_id, at);
  ALTER TABLE games ADD COLUMN class_id TEXT REFERENCES classes(id) ON DELETE SET NULL;
  ALTER TABLE games ADD COLUMN activity_id TEXT;
  ALTER TABLE games ADD COLUMN allow_guests INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE games ADD COLUMN audience_json TEXT;
  ALTER TABLE games ADD COLUMN snapshot_json TEXT;
  ALTER TABLE games ADD COLUMN played_json TEXT;
  ALTER TABLE players ADD COLUMN student_id TEXT REFERENCES students(id) ON DELETE SET NULL;
  ALTER TABLE players ADD COLUMN is_guest INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX players_student ON players(game_id, student_id) WHERE student_id IS NOT NULL;
  ALTER TABLE quizzes ADD COLUMN tags_json TEXT;
  ALTER TABLE questions ADD COLUMN topic TEXT;
  ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
  `,
  // 5: Dodatek 3, second version – a student is known only by the school login (account_name).
  // Names from version 4 are dropped; existing rows get a neutral placeholder the teacher can rename.
  `
  ALTER TABLE students ADD COLUMN account_name TEXT NOT NULL DEFAULT '';
  UPDATE students SET account_name = 'zak' || rowid;
  UPDATE players SET nickname = (SELECT account_name FROM students s WHERE s.id = players.student_id) WHERE student_id IS NOT NULL AND student_id IN (SELECT id FROM students);
  ALTER TABLE students DROP COLUMN family_name;
  ALTER TABLE students DROP COLUMN given_name;
  ALTER TABLE students DROP COLUMN public_name;
  CREATE UNIQUE INDEX students_account ON students(class_id, account_name);
  `,
  // 6: Dodatek 4 – appearance preferences of teachers and quiz/game themes (V5.3, V7.1)
  `
  ALTER TABLE teachers ADD COLUMN ui_prefs_json TEXT;
  ALTER TABLE teachers ADD COLUMN default_theme_json TEXT;
  ALTER TABLE quizzes ADD COLUMN theme_json TEXT;
  ALTER TABLE games ADD COLUMN theme_json TEXT;
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
