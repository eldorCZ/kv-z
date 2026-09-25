import { expect, it } from 'vitest';
import { runLoadTest } from '../loadtest.js';

it('150 simulated players in one game, reveal latency < 300 ms', async () => {
  const r = await runLoadTest(150);
  expect(r.rankingSize).toBe(150);
  expect(r.revealLatencyMs.max).toBeLessThan(300);
}, 120_000);
