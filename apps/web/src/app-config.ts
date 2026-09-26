import i18n from './i18n';

/** Product name from the server (APP_NAME, default "Lore", Dodatek 4 V2.1), used as {{app}} in texts. */
export let appName = 'Lore';
export let designPage = false;
/** custom background images (V8) can be switched off with THEME_UPLOADS=0 */
export let themeUploads = false;

export async function loadAppConfig() {
  try {
    const r = await fetch('/api/auth/config', { credentials: 'same-origin' });
    const cfg = (await r.json()) as { appName?: string; designPage?: boolean; themeUploads?: boolean };
    designPage = !!cfg.designPage;
    themeUploads = !!cfg.themeUploads;
    if (cfg.appName && cfg.appName !== appName) {
      appName = cfg.appName;
      i18n.options.interpolation = { ...i18n.options.interpolation, defaultVariables: { app: appName } };
      void i18n.changeLanguage(i18n.language);
    }
  } catch {
    /* offline: keep the default name */
  }
}
