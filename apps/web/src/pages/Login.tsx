import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';
import { api, type ApiError } from '../api';
import { useAuth } from '../auth';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';
import { Logo } from '../ui/Logo';
import { SchemeSwitcher } from '../ui/SchemeSwitcher';

export default function Login() {
  const { t } = useTranslation();
  const { teacher, login, register, loading } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(true);

  useEffect(() => {
    api<{ allowRegistration: boolean }>('GET', '/api/auth/config')
      .then((c) => setAllowRegistration(c.allowRegistration))
      .catch(() => undefined);
  }, []);

  const next = params.get('next');
  if (!loading && teacher) return <Navigate to={next && next.startsWith('/') && !next.startsWith('//') ? next : '/quizzes'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      <SchemeSwitcher className="absolute right-4 top-4" />
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-surface p-6 shadow">
        <h1>
          <Logo />
        </h1>
        <p className="text-sm text-muted">{t(mode === 'login' ? 'login.introLogin' : 'login.introRegister')}</p>
        <Field label={t('login.email')}>
          <input className={inputCls} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('login.password')} hint={mode === 'register' ? t('login.passwordHint') : undefined}>
          <input
            className={inputCls}
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === "register" ? 12 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {t(mode === 'login' ? 'login.submitLogin' : 'login.submitRegister')}
        </Button>
        {allowRegistration && (
          <button type="button" className="w-full text-sm text-primary hover:underline" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {t(mode === 'login' ? 'login.switchToRegister' : 'login.switchToLogin')}
          </button>
        )}
      </form>
    </div>
  );
}
