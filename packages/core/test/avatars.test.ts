import { describe, expect, it } from 'vitest';
import { playerAvatarForId, PLAYER_AVATARS } from '../src/avatars.js';

describe('player avatars', () => {
  it('assigns a stable Lore mascot avatar from the finished mascot set', () => {
    expect(PLAYER_AVATARS).toEqual(['hello', 'think', 'celebrate', 'encourage', 'sleep']);
    expect(PLAYER_AVATARS).toContain(playerAvatarForId('player-1'));
    expect(playerAvatarForId('same-player')).toBe(playerAvatarForId('same-player'));
  });

  it('spreads adjacent players across different lobby avatars', () => {
    const firstFive = Array.from({ length: 5 }, (_, i) => playerAvatarForId(`player-${i + 1}`));
    expect(new Set(firstFive).size).toBeGreaterThan(1);
  });
});
