import i18n from './i18n';

/** Product name from the server (APP_NAME, default "Jiskra", Dodatek 4 V2.1), used as {{app}} in texts. */
export let appName = 'Jiskra';
export let designPage = false;

export async function loadAppConfig() {
  try {
    const r = await fetch('/api/auth/config', { credentials: 'same-origin' });
    const cfg = (await r.json()) as { appName?: string; designPage?: boolean };
    designPage = !!cfg.designPage;
    if (cfg.appName && cfg.appName !== appName) {
      appName = cfg.appName;
      i18n.options.interpolation = { ...i18n.options.interpolation, defaultVariables: { app: appName } };
      document.title = appName;
      void i18n.changeLanguage(i18n.language);
    }
  } catch {
    /* offline: keep the default name */
  }
}
