import { playerTheme, type ContractError, type PlayerTheme, type QuizTheme } from '@kvizhub/core';

/** Same-origin URL of a custom background (V8); the phone size is enough for every screen with a scrim. */
export function themeImageUrl(theme: QuizTheme | null | undefined, size: 640 | 1280 | 1920 = 1280): string | null {
  return theme?.imageId ? `/media/theme/${theme.imageId}/${size}.webp` : null;
}

/** Theme object for players and the projector (V7.4). Tests are calm: strong scrim, static picture. */
export function gameTheme(theme: QuizTheme | null | undefined, calm: boolean): PlayerTheme {
  return playerTheme(theme, { calm, imageUrl: themeImageUrl(theme) });
}

/** A custom image may only be one of the teacher's own uploads; anything else is dropped with a warning. */
export function ownImageOnly(
  look: { theme: QuizTheme | null; warnings: ContractError[] },
  owns: (id: string) => boolean,
  path = 'theme',
): { theme: QuizTheme | null; warnings: ContractError[] } {
  if (!look.theme?.imageId || owns(look.theme.imageId)) return look;
  const { imageId: _drop, ...rest } = look.theme;
  return {
    theme: Object.keys(rest).length ? rest : null,
    warnings: [...look.warnings, { path: `${path}.imageId`, code: 'unknown_image', message: 'Obrázek pozadí nebyl nalezen mezi vašimi obrázky; byl ignorován.' }],
  };
}
