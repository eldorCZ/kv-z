import * as RDialog from '@radix-ui/react-dialog';
import { BookOpen, ChevronsLeft, ChevronsRight, KeyRound, LogOut, Menu as MenuIcon, Palette, Trophy, Users, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { Logo } from '../ui/Logo';
import { SchemeSwitcher } from '../ui/SchemeSwitcher';
import { OfflineBanner } from '../pages/ErrorPages';

const COLLAPSE_KEY = 'lore.nav';

function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

/** Teacher shell (V9.2): collapsible side navigation, calm mood; top bar with a sheet on phones. */
export default function Layout() {
  const { t } = useTranslation();
  const { teacher, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [classes, setClasses] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    api<{ classesEnabled: boolean }>('GET', '/api/auth/config')
      .then((c) => setClasses(c.classesEnabled))
      .catch(() => undefined);
  }, []);
  useEffect(() => setMobileOpen(false), [loc.pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? 'open' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const items = [
    { to: '/quizzes', label: t('nav.quizzes'), Icon: BookOpen },
    ...(classes ? [{ to: '/classes', label: t('nav.classes'), Icon: Users }] : []),
    { to: '/games', label: t('nav.games'), Icon: Trophy },
    { to: '/settings/look', label: t('nav.look'), Icon: Palette },
    { to: '/settings/tokens', label: t('nav.tokens'), Icon: KeyRound },
  ];

  const doLogout = async () => {
    await logout();
    nav('/login');
  };

  const links = (compact: boolean) => (
    <nav className="flex flex-col gap-1" aria-label={t('nav.main')}>
      {items.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          aria-label={compact ? label : undefined}
          title={compact ? label : undefined}
          className={({ isActive }) =>
            `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors ${isActive ? 'bg-primary-soft text-on-primary-soft' : 'text-fg hover:bg-surface-2'} ${compact ? 'justify-center px-0' : ''}`
          }
        >
          <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
          {!compact && <span>{label}</span>}
        </NavLink>
      ))}
    </nav>
  );

  const account = (compact: boolean) => (
    <div className={`flex flex-col gap-2 border-t border-line pt-3 ${compact ? 'items-center' : ''}`}>
      <div className={`flex items-center gap-2 ${compact ? 'flex-col' : ''}`}>
        <SchemeSwitcher />
        {!compact && <span className="min-w-0 flex-1 truncate text-xs text-muted">{teacher?.email}</span>}
      </div>
      <button
        type="button"
        onClick={doLogout}
        aria-label={compact ? t('nav.logout') : undefined}
        title={compact ? t('nav.logout') : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold text-fg hover:bg-surface-2 ${compact ? 'justify-center px-0' : ''}`}
      >
        <LogOut className="h-5 w-5" aria-hidden="true" />
        {!compact && t('nav.logout')}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas text-fg md:flex" data-mood="focus">
      {/* desktop side navigation */}
      <aside
        className={`no-print sticky top-0 hidden h-screen shrink-0 flex-col gap-4 border-r border-line bg-surface p-3 md:flex ${collapsed ? 'w-[4.5rem]' : 'w-60'}`}
        data-testid="side-nav"
      >
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <NavLink to="/quizzes" aria-label={t('nav.home')} className="rounded-md p-1">
            {collapsed ? <Logo variant="mark" height={32} decorative /> : <Logo height={28} decorative />}
          </NavLink>
        </div>
        <div className="flex-1">{links(collapsed)}</div>
        {account(collapsed)}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
          title={collapsed ? t('nav.expand') : t('nav.collapse')}
          className="flex min-h-11 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
        >
          {collapsed ? <ChevronsRight className="h-5 w-5" aria-hidden="true" /> : <ChevronsLeft className="h-5 w-5" aria-hidden="true" />}
        </button>
      </aside>

      {/* phone top bar */}
      <header className="no-print sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
        <RDialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <RDialog.Trigger className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-surface-2" aria-label={t('nav.menu')}>
            <MenuIcon className="h-6 w-6" aria-hidden="true" />
          </RDialog.Trigger>
          <RDialog.Portal>
            <RDialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-black/50" />
            <RDialog.Content className="dialog-sheet fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-4 bg-surface p-4 text-fg shadow-soft focus:outline-none">
              <div className="flex items-center justify-between">
                <RDialog.Title asChild>
                  <span>
                    <Logo height={26} />
                  </span>
                </RDialog.Title>
                <RDialog.Close className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-surface-2" aria-label={t('common.close')}>
                  <X className="h-5 w-5" aria-hidden="true" />
                </RDialog.Close>
              </div>
              <RDialog.Description className="sr-only">{t('nav.main')}</RDialog.Description>
              <div className="flex-1">{links(false)}</div>
              {account(false)}
            </RDialog.Content>
          </RDialog.Portal>
        </RDialog.Root>
        <NavLink to="/quizzes" aria-label={t('nav.home')}>
          {/* below 480 px only the mark (L3.6) */}
          <Logo variant="mark" height={28} decorative className="min-[480px]:hidden" />
          <Logo height={26} decorative className="hidden min-[480px]:block" />
        </NavLink>
      </header>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
          <OfflineBanner />
          <Outlet />
        </div>
      </main>
    </div>
  );
}
