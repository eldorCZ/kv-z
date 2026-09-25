import type { AccountRepo } from '../repo/accounts.js';
import { hashPassword, verifyPassword } from './password.js';

export interface AuthenticatedTeacher {
  id: string;
  email: string;
}

/**
 * Pluggable authentication provider. `local` = e-mail + password. An `oidc` provider
 * (e.g. Microsoft Entra ID) can be added later by implementing this interface
 * (redirect-based login fills `startLogin`/`handleCallback`).
 */
export interface AuthProvider {
  readonly name: 'local' | 'oidc';
  readonly supportsPassword: boolean;
  register?(email: string, password: string): Promise<AuthenticatedTeacher>;
  login?(email: string, password: string): Promise<AuthenticatedTeacher | null>;
  startLogin?(returnTo: string): Promise<{ redirectUrl: string }>;
  handleCallback?(query: Record<string, string>): Promise<AuthenticatedTeacher | null>;
}

export class RegistrationError extends Error {}

// A constant hash compared against when the user does not exist, so timing does not reveal accounts.
let dummyHash: Promise<string> | undefined;

export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local' as const;
  readonly supportsPassword = true;
  constructor(private readonly accounts: AccountRepo) {}

  async register(email: string, password: string): Promise<AuthenticatedTeacher> {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 200) throw new RegistrationError('Zadejte platný e-mail.');
    if (password.length < 10) throw new RegistrationError('Heslo musí mít alespoň 10 znaků.');
    if (password.length > 200) throw new RegistrationError('Heslo je příliš dlouhé.');
    if (this.accounts.findTeacherByEmail(normalized)) throw new RegistrationError('Účet s tímto e-mailem už existuje. Přihlaste se.');
    const t = this.accounts.createTeacher(normalized, await hashPassword(password));
    return { id: t.id, email: t.email };
  }

  async login(email: string, password: string): Promise<AuthenticatedTeacher | null> {
    const t = this.accounts.findTeacherByEmail(email.trim());
    if (!t || !t.passwordHash) {
      dummyHash ??= hashPassword('dummy-password-for-timing');
      await verifyPassword(await dummyHash, password);
      return null;
    }
    return (await verifyPassword(t.passwordHash, password)) ? { id: t.id, email: t.email } : null;
  }
}

/** Placeholder so that AUTH_PROVIDER=oidc fails loudly until implemented. */
export class OidcAuthProvider implements AuthProvider {
  readonly name = 'oidc' as const;
  readonly supportsPassword = false;
  startLogin(): Promise<{ redirectUrl: string }> {
    return Promise.reject(new Error('Přihlášení přes OIDC (Microsoft Entra ID) zatím není implementováno.'));
  }
}

export function createAuthProvider(name: 'local' | 'oidc', accounts: AccountRepo): AuthProvider {
  return name === 'oidc' ? new OidcAuthProvider() : new LocalAuthProvider(accounts);
}
