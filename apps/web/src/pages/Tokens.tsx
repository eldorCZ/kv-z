import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTitle } from '../ui/useTitle';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { Badge, Button, ErrorBox, Field, formatDate, inputCls } from '../components/ui';

interface TokenDto {
  id: string;
  name: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

// classes:read lets the agent list classes and read aggregates (Dodatek 3); results:pii is off by default
const ALL_SCOPES = ['quizzes:write', 'quizzes:read', 'games:write', 'games:read', 'classes:read', 'results:pii'];
const DEFAULT_SCOPES = ALL_SCOPES.filter((s) => s !== 'results:pii');

export default function Tokens() {
  const { t } = useTranslation();
  useTitle(t('nav.tokens'));
  const [tokens, setTokens] = useState<TokenDto[]>([]);
  const [name, setName] = useState('Agent na Telegramu');
  const [scopes, setScopes] = useState<string[]>(DEFAULT_SCOPES);
  const [expires, setExpires] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setTokens((await api<{ tokens: TokenDto[] }>('GET', '/api/tokens')).tokens);
    } catch (e) {
      setError(e as ApiError);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ token: string }>('POST', '/api/tokens', { name, scopes, expiresInDays: expires ? Number(expires) : null });
      setCreated(r.token);
      setCopied(false);
      await load();
    } catch (err) {
      setError(err as ApiError);
    }
  };

  const revoke = async (tk: TokenDto) => {
    if (!confirm(t('tokens.confirmRevoke', { name: tk.name }))) return;
    try {
      await api('DELETE', `/api/tokens/${tk.id}`);
      await load();
    } catch (e) {
      setError(e as ApiError);
    }
  };

  const state = (tk: TokenDto) => {
    if (tk.revokedAt) return <Badge tone="neutral">{t('tokens.revoked')}</Badge>;
    if (tk.expiresAt && tk.expiresAt < Date.now()) return <Badge tone="neutral">{t('tokens.expired')}</Badge>;
    return <Badge tone="ok">{t('tokens.active')}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('tokens.title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{t('tokens.intro')}</p>
      </div>
      <form onSubmit={create} className="max-w-2xl space-y-3 rounded-lg border border-line bg-surface p-4">
        <h2 className="font-semibold">{t('tokens.create')}</h2>
        <Field label={t('tokens.name')}>
          <input className={inputCls} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-fg">{t('tokens.scopes')}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
                <code>{s}</code> – {t(`tokens.scope.${s}`)}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{t('tokens.noApprove')}</p>
        </fieldset>
        <Field label={t('tokens.expires')} hint={t('tokens.expiresHint')}>
          <input className={`${inputCls} max-w-40`} type="number" min={1} max={3650} value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" disabled={scopes.length === 0}>
          {t('tokens.createButton')}
        </Button>
      </form>
      {created && (
        <div role="status" className="max-w-2xl rounded-lg border-2 border-success bg-success-soft p-4">
          <p className="mb-2 font-semibold text-success">{t('tokens.createdOnce')}</p>
          <div className="flex gap-2">
            <input readOnly className={`${inputCls} font-mono`} value={created} data-testid="new-token" onFocus={(e) => e.target.select()} />
            <Button
              onClick={async () => {
                await navigator.clipboard?.writeText(created);
                setCopied(true);
              }}
            >
              {copied ? t('tokens.copied') : t('tokens.copy')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-success">{t('tokens.agentHint')}</p>
        </div>
      )}
      <ErrorBox error={error} onClose={() => setError(null)} />
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-muted">
            <tr>
              <th className="p-3">{t('tokens.name')}</th>
              <th className="p-3">{t('tokens.scopes')}</th>
              <th className="p-3">{t('tokens.createdAt')}</th>
              <th className="p-3">{t('tokens.lastUsed')}</th>
              <th className="p-3">{t('tokens.state')}</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {tokens.map((tk) => (
              <tr key={tk.id} className="border-t border-line">
                <td className="p-3 font-medium">{tk.name}</td>
                <td className="p-3 text-xs">{tk.scopes.join(', ')}</td>
                <td className="p-3">{formatDate(tk.createdAt)}</td>
                <td className="p-3">{formatDate(tk.lastUsedAt)}</td>
                <td className="p-3">{state(tk)}</td>
                <td className="p-3 text-right">
                  {!tk.revokedAt && (
                    <Button variant="ghost" className="text-danger" onClick={() => revoke(tk)}>
                      {t('tokens.revoke')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {tokens.length === 0 && (
              <tr>
                <td className="p-3 text-muted" colSpan={6}>
                  {t('tokens.none')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
