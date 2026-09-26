import { DEFAULT_LIVE_MOTIVE, getMotive } from '@kvizhub/core/client';
import { useTitle } from '../ui/useTitle';
import { Palette } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { lookName, motiveThumb, ThemePicker, type Look } from '../components/ThemePicker';
import { usePrefs } from '../theme/prefs';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { useToast } from '../ui/Toast';

/** Teacher settings for the look (V7.3): the default motive of new quizzes. */
export default function LookSettings() {
  const { t } = useTranslation();
  useTitle(t('nav.look'));
  const { theme: scheme } = usePrefs();
  const toast = useToast();
  const [look, setLook] = useState<Look | undefined>(undefined);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    api<{ defaultTheme: Look }>('GET', '/api/auth/me')
      .then((r) => setLook(r.defaultTheme ?? null))
      .catch(() => setLook(null));
  }, []);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t('theme.settingsTitle')}</h1>
      <Card className="space-y-3 p-4">
        <h2 className="text-lg font-bold">{t('theme.defaultForNew')}</h2>
        <p className="text-sm text-muted">{t('theme.defaultForNewHint')}</p>
        {look !== undefined && (
          <div className="flex flex-wrap items-center gap-4">
            <img src={motiveThumb(getMotive(look?.motive)?.id ?? DEFAULT_LIVE_MOTIVE, scheme)} alt="" className="h-20 w-36 rounded-md border border-line object-cover" />
            <span className="flex-1 font-semibold" data-testid="default-look-name">
              {lookName(look, t)}
            </span>
            <Button icon={<Palette aria-hidden="true" className="h-4 w-4" />} onClick={() => setPicking(true)} data-testid="default-look">
              {t('theme.change')}
            </Button>
          </div>
        )}
      </Card>
      <p className="text-sm text-muted">{t('theme.appearanceHint')}</p>
      {picking && (
        <ThemePicker
          title={t('theme.defaultForNew')}
          value={look ?? null}
          onClose={() => setPicking(false)}
          actions={[{ id: 'save', label: t('theme.save'), primary: true, testId: 'theme-save-default' }]}
          onAction={async (_a, chosen) => {
            const r = await api<{ defaultTheme: Look }>('PUT', '/api/auth/default-theme', { theme: chosen });
            setLook(r.defaultTheme);
            toast(t('theme.saved'));
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
