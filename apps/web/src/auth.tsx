import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { api, setCsrf } from './api';

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

  useEffect(() => {
    api<{ teacher: Teacher; csrfToken: string }>('GET', '/api/auth/me')
      .then((r) => {
        setCsrf(r.csrfToken);
        setTeacher(r.teacher);
      })
      .catch(() => setTeacher(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ teacher: Teacher; csrfToken: string }>('POST', '/api/auth/login', { email, password });
    setCsrf(r.csrfToken);
    setTeacher(r.teacher);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const r = await api<{ teacher: Teacher; csrfToken: string }>('POST', '/api/auth/register', { email, password });
    setCsrf(r.csrfToken);
    setTeacher(r.teacher);
  }, []);

  const logout = useCallback(async () => {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    setCsrf('');
    setTeacher(null);
  }, []);

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
