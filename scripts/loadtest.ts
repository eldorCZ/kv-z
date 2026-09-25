/**
 * pnpm loadtest [players=150] – one game with N simulated players (Socket.IO clients).
 * Measures the reveal latency (host presses Enter -> every player has the reveal) and server memory.
 * Runs against KVIZHUB_URL + KVIZHUB_TOKEN (JOIN_RATE_LIMIT on the server must allow N joins from one IP),
 * otherwise against a temporary in-process server.
 */
import { ack, apiCall, connect, target, type Sock } from './lib.js';

const N = Number(process.argv[2] ?? 150);
const QUESTIONS = 5;
const quiz = {
  schemaVersion: 1,
  title: 'Zátěžový test',
  questions: Array.from({ length: QUESTIONS }, (_, i) => ({
    type: 'single',
    prompt: `Otázka ${i + 1}: kolik je ${i} + 1?`,
    options: [String(i + 1), String(i + 2), String(i + 3), String(i + 4)],
    correctIndices: [0],
    timeLimitSec: 30,
  })),
};

export async function runLoadTest(players = N) {
  const t = await target({ joinRateLimit: players + 10 });
  const created = await apiCall<{ quizId: string }>(t, 'POST', '/quizzes', quiz);
  const game = await apiCall<{ gameId: string; pin: string; hostUrl: string }>(t, 'POST', `/quizzes/${created.quizId}/games`, { settings: { showLeaderboard: false } });
  const host = await connect(t.url);
  await ack(host, 'host_attach', { gameId: game.gameId, hostKey: new URL(game.hostUrl).hash.replace('#key=', '') });

  const t0 = Date.now();
  const socks: Sock[] = await Promise.all(Array.from({ length: players }, () => connect(t.url)));
  const joins = await Promise.all(socks.map((s, i) => ack(s, 'join', { pin: game.pin, nickname: `Hráč ${i + 1}` })));
  const failed = joins.filter((j) => !j.ok);
  if (failed.length) throw new Error(`${failed.length} joins failed: ${failed[0]!.error}`);
  const joinMs = Date.now() - t0;

  const latencies: number[] = [];
  const answerAcks: number[] = [];
  for (let q = 0; q < QUESTIONS; q++) {
    const questionIn = socks.map((s) => new Promise<{ id: string; options: string[] }>((r) => s.once('question', (e) => r(e.question))));
    if (q === 0) await ack(host, 'start');
    else await ack(host, 'next');
    const qs = await Promise.all(questionIn);
    // everybody except one player answers (so that the host reveals manually)
    await Promise.all(
      socks.slice(1).map(async (s, i) => {
        const pos = qs[i + 1]!.options.indexOf(String(q + 1));
        const a0 = Date.now();
        const r = await ack(s, 'answer', { questionId: qs[i + 1]!.id, payload: { indices: [i % 3 === 0 ? (pos + 1) % 4 : pos] } });
        if (!r.ok) throw new Error(r.error);
        answerAcks.push(Date.now() - a0);
      }),
    );
    const revealIn = socks.map((s) => new Promise<void>((r) => s.once('reveal', () => r())));
    const r0 = Date.now();
    await ack(host, 'reveal');
    await Promise.all(revealIn);
    latencies.push(Date.now() - r0);
  }
  const over = socks.map((s) => new Promise<void>((r) => s.once('game_over', () => r())));
  await ack(host, 'next');
  await Promise.all(over);
  const results = await apiCall<{ ranking: unknown[]; perQuestion: { successRate: number }[] }>(t, 'GET', `/games/${game.gameId}/results`);
  const mem = process.memoryUsage();
  socks.forEach((s) => s.disconnect());
  host.disconnect();
  await t.close();
  const sorted = [...answerAcks].sort((a, b) => a - b);
  return {
    players,
    joinMs,
    revealLatencyMs: { max: Math.max(...latencies), avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) },
    answerAckMs: { p50: sorted[Math.floor(sorted.length / 2)]!, p95: sorted[Math.floor(sorted.length * 0.95)]! },
    rankingSize: results.ranking.length,
    successRate: results.perQuestion.map((p) => p.successRate),
    // meaningful only for the in-process server (server + clients share the process)
    rssMb: Math.round(mem.rss / 1024 / 1024),
  };
}

if (process.argv[1]?.endsWith('loadtest.ts')) {
  const r = await runLoadTest();
  console.log(JSON.stringify(r, null, 2));
  if (r.revealLatencyMs.max >= 300) {
    console.error(`Latence odhalení ${r.revealLatencyMs.max} ms překročila 300 ms.`);
    process.exit(1);
  }
  console.log(`OK: ${r.players} hráčů, max. latence odhalení ${r.revealLatencyMs.max} ms (< 300 ms).`);
}
