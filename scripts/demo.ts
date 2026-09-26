/**
 * pnpm demo – inserts the sample quiz through the API, runs a game with simulated players and prints the results.
 * Runs against KVIZHUB_URL + KVIZHUB_TOKEN when set, otherwise starts a temporary local server.
 */
import type { QuestionEvent, RevealEvent } from '@kvizhub/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ack, apiCall, connect, sleep, target, type Sock } from './lib.js';

const quiz = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/quizzes/valid/optika.json'), 'utf8'));
const NICKS = ['Adéla', 'Bořek', 'Cilka', 'Dominik', 'Ema'];

const t = await target();
console.log(`Lore: ${t.url}`);
const created = await apiCall<{ quizId: string; reviewUrl: string; stats: { total: number; ok: number; flagged: number } }>(t, 'POST', '/quizzes', quiz);
console.log(`Kvíz vložen: ${created.reviewUrl} (otázek ${created.stats.total}, v pořádku ${created.stats.ok}, ke kontrole ${created.stats.flagged})`);
const game = await apiCall<{ gameId: string; pin: string; hostUrl: string; joinUrl: string; questionCount: number }>(t, 'POST', `/quizzes/${created.quizId}/games`, {
  mode: 'live',
  settings: { showLeaderboard: false, streakBonus: true },
});
console.log(`Hra: PIN ${game.pin}, ${game.questionCount} otázek (otázky ke kontrole se přeskočí)`);

const host = await connect(t.url);
const hostKey = new URL(game.hostUrl).hash.replace('#key=', '');
const attached = await ack(host, 'host_attach', { gameId: game.gameId, hostKey });
if (!attached.ok) throw new Error(attached.error);

// Every simulated player has a "skill" – the chance to answer correctly.
const players: { nick: string; sock: Sock; skill: number }[] = [];
for (const [i, nick] of NICKS.entries()) {
  const sock = await connect(t.url);
  const r = await ack(sock, 'join', { pin: game.pin, nickname: nick });
  if (!r.ok) throw new Error(r.error);
  players.push({ nick, sock, skill: 0.9 - i * 0.15 });
}

const key = new Map<string, unknown>(); // simulated players "know" the key only from the quiz file
for (const q of quiz.questions) key.set(q.prompt, q);

function answerFor(q: QuestionEvent['question'], skill: number): unknown {
  const src = key.get(q.prompt) as { options: string[]; correctIndices: number[]; acceptedAnswers: string[]; numericAnswer: number };
  const right = Math.random() < skill;
  switch (q.type) {
    case 'single':
    case 'truefalse': {
      const correct = q.options.indexOf(src.options[src.correctIndices[0]!]!);
      return { indices: [right ? correct : (correct + 1) % q.options.length] };
    }
    case 'multi':
      return { indices: right ? src.correctIndices.map((c) => q.options.indexOf(src.options[c]!)) : [0] };
    case 'order':
      return { order: right ? src.options.map((o) => q.options.indexOf(o)) : q.options.map((_, i) => i) };
    case 'short':
      return { text: right ? src.acceptedAnswers[0] : 'nevím' };
    case 'numeric':
      return { value: right ? String(src.numericAnswer).replace('.', ',') : '0' };
  }
}

for (const p of players) {
  p.sock.on('question', (e) => {
    const delay = 200 + Math.random() * 1500;
    setTimeout(() => void ack(p.sock, 'answer', { questionId: e.question.id, payload: answerFor(e.question, p.skill) }), delay);
  });
}

let done = 0;
host.on('reveal', (r: RevealEvent) => {
  done++;
  console.log(`  otázka ${done}: správně ${r.stats.correct}/${r.stats.playerCount}`);
  setTimeout(() => void ack(host, 'next'), 300);
});
const over = new Promise<void>((resolve) => host.on('game_over', () => resolve()));
await ack(host, 'start');
await over;
await sleep(200);

const results = await apiCall<{ ranking: { nickname: string; score: number; rank: number }[]; perQuestion: { number: number; prompt: string; successRate: number }[] }>(
  t,
  'GET',
  `/games/${game.gameId}/results`,
);
console.log('\nPořadí:');
for (const r of results.ranking) console.log(`  ${r.rank}. ${r.nickname.padEnd(10)} ${r.score}`);
console.log('\nÚspěšnost po otázkách:');
for (const q of results.perQuestion) console.log(`  ${q.number}. ${String(Math.round(q.successRate * 100)).padStart(3)} %  ${q.prompt}`);

host.disconnect();
players.forEach((p) => p.sock.disconnect());
await t.close();
