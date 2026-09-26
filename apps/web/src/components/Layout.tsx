import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth';

export default function Layout() {
  const { t } = useTranslation();
  const { teacher, logout } = useAuth();
  const nav = useNavigate();
  const [classes, setClasses] = useState(false);
  useEffect(() => {
    api<{ classesEnabled: boolean }>('GET', '/api/auth/config')
      .then((c) => setClasses(c.classesEnabled))
      .catch(() => undefined);
  }, []);
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-hra-100 text-hra-800' : 'text-slate-700 hover:bg-slate-100'}`;
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <NavLink to="/quizzes" className="mr-4 text-xl font-bold text-hra-700">
            KvizHub
          </NavLink>
          <nav className="flex flex-wrap gap-1" aria-label={t('nav.main')}>
            <NavLink to="/quizzes" className={link}>
              {t('nav.quizzes')}
            </NavLink>
            {classes && (
              <NavLink to="/classes" className={link}>
                {t('nav.classes')}
              </NavLink>
            )}
            <NavLink to="/games" className={link}>
              {t('nav.games')}
            </NavLink>
            <NavLink to="/settings/tokens" className={link}>
              {t('nav.tokens')}
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-600">
            <span className="hidden sm:inline">{teacher?.email}</span>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
              onClick={async () => {
                await logout();
                nav('/login');
              }}
            >
              {t('nav.logout')}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
