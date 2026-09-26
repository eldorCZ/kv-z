import { playerTheme, type PlayerTheme, type QuizTheme } from '@kvizhub/core';

/** Same-origin URL of a custom background (V8); the phone size is enough for every screen with a scrim. */
export function themeImageUrl(theme: QuizTheme | null | undefined, size: 640 | 1280 | 1920 = 1280): string | null {
  return theme?.imageId ? `/media/theme/${theme.imageId}/${size}.webp` : null;
}

/** Theme object for players and the projector (V7.4). Tests are calm: strong scrim, static picture. */
export function gameTheme(theme: QuizTheme | null | undefined, calm: boolean): PlayerTheme {
  return playerTheme(theme, { calm, imageUrl: themeImageUrl(theme) });
}
