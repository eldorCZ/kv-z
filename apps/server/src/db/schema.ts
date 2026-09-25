import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const teachers = sqliteTable('teachers', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  authProvider: text('auth_provider').notNull().default('local'),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  idHash: text('id_hash').primaryKey(),
  teacherId: text('teacher_id').notNull().references(() => teachers.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  teacherId: text('teacher_id').notNull().references(() => teachers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  scopesJson: text('scopes_json').notNull(),
  expiresAt: integer('expires_at'),
  revokedAt: integer('revoked_at'),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
});

export const quizzes = sqliteTable(
  'quizzes',
  {
    id: text('id').primaryKey(),
    teacherId: text('teacher_id').notNull().references(() => teachers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    language: text('language').notNull(),
    gradeLevel: text('grade_level').notNull().default(''),
    sourceFilesJson: text('source_files_json').notNull().default('[]'),
    settingsJson: text('settings_json').notNull(),
    idempotencyKey: text('idempotency_key'),
    requestHash: text('request_hash'),
    idempotencyResponse: text('idempotency_response'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('quizzes_idem').on(t.teacherId, t.idempotencyKey), index('quizzes_teacher').on(t.teacherId)],
);

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    quizId: text('quiz_id').notNull().references(() => quizzes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type').notNull(),
    prompt: text('prompt').notNull(),
    optionsJson: text('options_json').notNull(),
    correctJson: text('correct_json').notNull(),
    acceptedAnswersJson: text('accepted_answers_json').notNull(),
    numericAnswer: real('numeric_answer'),
    numericTolerance: real('numeric_tolerance'),
    explanation: text('explanation').notNull().default(''),
    bloom: text('bloom'),
    difficulty: text('difficulty'),
    timeLimitSec: integer('time_limit_sec').notNull(),
    pointsMode: text('points_mode').notNull(),
    sourceRefJson: text('source_ref_json'),
    qaStatus: text('qa_status').notNull(),
    qaNotes: text('qa_notes').notNull().default(''),
    approvedAt: integer('approved_at'),
  },
  (t) => [index('questions_quiz').on(t.quizId, t.position)],
);

export const games = sqliteTable(
  'games',
  {
    id: text('id').primaryKey(),
    quizId: text('quiz_id').notNull().references(() => quizzes.id, { onDelete: 'cascade' }),
    teacherId: text('teacher_id').notNull().references(() => teachers.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    pin: text('pin').notNull(),
    hostKeyHash: text('host_key_hash').notNull(),
    status: text('status').notNull(),
    settingsJson: text('settings_json').notNull(),
    questionIdsJson: text('question_ids_json').notNull(),
    createdAt: integer('created_at').notNull(),
    endsAt: integer('ends_at'),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('games_quiz').on(t.quizId), index('games_created').on(t.createdAt)],
);

export const players = sqliteTable(
  'players',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    tokenHash: text('token_hash').notNull(),
    joinedAt: integer('joined_at').notNull(),
  },
  (t) => [index('players_game').on(t.gameId)],
);

export const answers = sqliteTable(
  'answers',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    playerId: text('player_id').notNull().references(() => players.id, { onDelete: 'cascade' }),
    questionId: text('question_id').notNull(),
    payloadJson: text('payload_json').notNull(),
    correct: integer('correct').notNull(),
    points: integer('points').notNull(),
    elapsedMs: integer('elapsed_ms').notNull(),
  },
  (t) => [index('answers_game').on(t.gameId), uniqueIndex('answers_unique').on(t.playerId, t.questionId)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    tokenId: text('token_id'),
    endpoint: text('endpoint').notNull(),
    status: integer('status').notNull(),
  },
  (t) => [index('audit_at').on(t.at)],
);

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    playerId: text('player_id').notNull().unique().references(() => players.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    startedAt: integer('started_at'),
    deadlineAt: integer('deadline_at'),
    submittedAt: integer('submitted_at'),
    allowReturn: integer('allow_return').notNull().default(0),
    percent: integer('percent'),
    score: real('score'),
    maxScore: real('max_score'),
    questionIdsJson: text('question_ids_json').notNull(),
    optionPermsJson: text('option_perms_json').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('attempts_game').on(t.gameId), index('attempts_deadline').on(t.status, t.deadlineAt)],
);
