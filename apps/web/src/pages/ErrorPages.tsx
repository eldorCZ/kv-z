import { Component, useEffect, useState, type ReactNode } from 'react';
import { useTitle } from '../ui/useTitle';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import i18n from '../i18n';
import { Logo } from '../ui/Logo';
import { Mascot, type MascotPose } from '../ui/Mascot';

/** Full page message with Lorík (V9.6). */
function ErrorScreen({ pose, title, text, children, testId }: { pose: MascotPose; title: string; text: string; children?: ReactNode; testId: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-fg" data-mood="focus">
      <header className="px-6 py-4">
        <Logo height={28} />
      </header>
      <main className="m-auto flex max-w-md flex-col items-center gap-4 p-6 text-center" data-testid={testId}>
        <Mascot pose={pose} size={180} />
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted">{text}</p>
        <div className="flex flex-wrap justify-center gap-2">{children}</div>
      </main>
    </div>
  );
}

const btn = 'inline-flex min-h-11 items-center rounded-md px-4 font-semibold';

export function NotFound() {
  const { t } = useTranslation();
  useTitle(t('titles.notFound'));
  return (
    <ErrorScreen pose="error" title={t('errorPage.notFoundTitle')} text={t('errorPage.notFoundText')} testId="not-found">
      <Link to="/quizzes" className={`${btn} bg-primary text-on-primary hover:bg-primary-hover`}>
        {t('errorPage.toQuizzes')}
      </Link>
      <Link to="/play" className={`${btn} border border-line-strong bg-surface hover:bg-surface-2`}>
        {t('errorPage.toPlay')}
      </Link>
    </ErrorScreen>
  );
}

function Crash({ offline }: { offline: boolean }) {
  // no hooks here beyond i18n: this renders after an error anywhere below
  const t = i18n.t.bind(i18n);
  return (
    <ErrorScreen
      pose="error"
      title={offline ? t('errorPage.offlineTitle') : t('errorPage.serverTitle')}
      text={offline ? t('errorPage.offlineText') : t('errorPage.serverText')}
      testId={offline ? 'offline-page' : 'error-page'}
    >
      <button type="button" className={`${btn} bg-primary text-on-primary hover:bg-primary-hover`} onClick={() => location.reload()}>
        {t('errorPage.reload')}
      </button>
    </ErrorScreen>
  );
}

/** Catches render errors and failed lazy chunks (typically offline) instead of a white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <Crash offline={typeof navigator !== 'undefined' && !navigator.onLine} /> : this.props.children;
  }
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Thin bar for teacher pages while the device is offline. */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="bg-warning-soft px-4 py-2 text-center text-sm font-semibold text-warning" data-testid="offline-banner">
      {t('errorPage.offlineBanner')}
    </div>
  );
}
