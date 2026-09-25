import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate } from '../src/db/migrations.js';

describe('migration 4 on a copy of existing data', () => {
  it('keeps existing rows and adds class columns with neutral defaults', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    for (let v = 0; v < 3; v++) db.exec(MIGRATIONS[v]!);
    db.pragma('user_version = 3');
    db.exec(`
      INSERT INTO teachers VALUES ('t1', 'a@b.cz', 'x', 'local', 1);
      INSERT INTO quizzes (id, teacher_id, title, language, settings_json, created_at, updated_at) VALUES ('q1', 't1', 'Kvíz', 'cs', '{}', 1, 1);
      INSERT INTO questions (id, quiz_id, position, type, prompt, options_json, correct_json, accepted_answers_json, time_limit_sec, points_mode, qa_status) VALUES ('x', 'q1', 0, 'truefalse', 'P', '[]', '[0]', '[]', 20, 'standard', 'ok');
      INSERT INTO games (id, quiz_id, teacher_id, mode, pin, host_key_hash, status, settings_json, question_ids_json, created_at) VALUES ('g1', 'q1', 't1', 'live', '123456', 'h', 'finished', '{}', '["x"]', 1);
      INSERT INTO players (id, game_id, nickname, token_hash, joined_at) VALUES ('p1', 'g1', 'Anna', 'th', 1);
      INSERT INTO sessions VALUES ('s', 't1', 1, 99999999999999);
    `);
    migrate(db);
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT nickname, student_id, is_guest FROM players').get()).toEqual({ nickname: 'Anna', student_id: null, is_guest: 0 });
    expect(db.prepare('SELECT class_id, allow_guests FROM games').get()).toEqual({ class_id: null, allow_guests: 0 });
    expect(db.prepare('SELECT topic FROM questions').get()).toEqual({ topic: null });
    expect(db.prepare('SELECT count(*) n FROM classes').get()).toEqual({ n: 0 });
  });
});
