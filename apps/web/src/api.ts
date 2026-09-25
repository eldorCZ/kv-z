import i18n from './i18n';

let csrf = '';
export const setCsrf = (t: string) => {
  csrf = t;
};

export interface ContractError {
  path: string;
  code: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: ContractError[] = [],
    readonly code = '',
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, i18n.t('errors.network'));
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 422 && Array.isArray(data.errors)) throw new ApiError(422, i18n.t('errors.validation'), data.errors, 'validation');
    throw new ApiError(res.status, data.error ?? i18n.t('errors.generic'), [], data.code);
  }
  return data as T;
}

/** Download a file (export, CSV) through fetch so that errors can be shown. */
export async function download(path: string): Promise<{ summary: unknown }> {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? i18n.t('errors.generic'));
  }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const name = /filename\*=UTF-8''([^;]+)/.exec(cd)?.[1] ?? /filename="([^"]+)"/.exec(cd)?.[1] ?? 'export';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = decodeURIComponent(name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  const s = res.headers.get('x-export-summary');
  return { summary: s ? JSON.parse(s) : null };
}
