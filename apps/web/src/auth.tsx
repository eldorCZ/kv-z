import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, setCsrf } from './api';
import { usePrefs } from './theme/prefs';

interface Teacher {
  id: string;
  email: string;
}

interface AuthState {
  teacher: Teacher | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loading, setLoading] = useState(true);
  const { adopt, setOnSave } = usePrefs();

  // the teacher's saved appearance wins after login; later changes are saved back (V5.3)
  const signedIn = useCallback(
    (r: { teacher: Teacher; csrfToken: string; uiPrefs?: unknown }) => {
      setCsrf(r.csrfToken);
      setTeacher(r.teacher);
      if (r.uiPrefs) adopt(r.uiPrefs);
      setOnSave((p) => void api('PUT', '/api/auth/prefs', p).catch(() => undefined));
    },
    [adopt, setOnSave],
  );

  useEffect(() => {
    api<{ teacher: Teacher; csrfToken: string; uiPrefs?: unknown }>('GET', '/api/auth/me')
      .then(signedIn)
      .catch(() => setTeacher(null))
      .finally(() => setLoading(false));
  }, [signedIn]);

  const login = useCallback(async (email: string, password: string) => {
    signedIn(await api<{ teacher: Teacher; csrfToken: string; uiPrefs?: unknown }>('POST', '/api/auth/login', { email, password }));
  }, [signedIn]);

  const register = useCallback(async (email: string, password: string) => {
    signedIn(await api<{ teacher: Teacher; csrfToken: string; uiPrefs?: unknown }>('POST', '/api/auth/register', { email, password }));
  }, [signedIn]);

  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    setCsrf('');
    setTeacher(null);
    setOnSave(null);
  }, [setOnSave]);

  return <Ctx.Provider value={{ teacher, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { teacher, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!teacher) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}
