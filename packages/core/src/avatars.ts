export const PLAYER_AVATARS = ['hello', 'think', 'celebrate', 'encourage', 'sleep'] as const;

export type PlayerAvatar = (typeof PLAYER_AVATARS)[number];

/** Stable, privacy-safe lobby avatar assignment. Uses only the technical player id, never names. */
export function playerAvatarForId(id: string): PlayerAvatar {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PLAYER_AVATARS[hash % PLAYER_AVATARS.length]!;
}
