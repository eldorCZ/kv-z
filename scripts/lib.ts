/** Shared helpers for `pnpm demo` and `pnpm loadtest`: run against KVIZHUB_URL or an in-process server. */
import type { ClientToServerEvents, ServerToClientEvents } from '@kvizhub/core';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import { buildApp } from '../apps/server/src/app.js';
import { loadConfig } from '../apps/server/src/config.js';

export type Sock = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface Target {
  url: string;
  token: string;
  close: () => Promise<void>;
}

/** Starts a throw-away server with a temporary database and creates a teacher + API token. */
export async function localServer(opts: { joinRateLimit?: number } = {}): Promise<Target> {
  const dir = mkdtempSync(join(tmpdir(), 'kvizhub-script-'));
  const cfg = loadConfig({} as NodeJS.ProcessEnv, {
    dbPath: join(dir, 'kvizhub.db'),
    logLevel: 'warn',
    apiRateLimit: 10_000,
    joinRateLimit: opts.joinRateLimit ?? 10_000,
    webDist: join(dir, 'none'),
  });
  const { app, services } = await buildApp(cfg);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  services.cfg.publicUrl = url;
  const reg = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'demo@kvizhub.local', password: 'demo-heslo-12345' }),
  });
  const { csrfToken } = (await reg.json()) as { csrfToken: string };
  const cookie = reg.headers.get('set-cookie')!.split(';')[0]!;
  const tk = await fetch(`${url}/api/tokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken },
    body: JSON.stringify({ name: 'demo' }),
  });
  const { token } = (await tk.json()) as { token: string };
  return { url, token, close: () => app.close() };
}

export async function target(opts: { joinRateLimit?: number } = {}): Promise<Target> {
  if (process.env.KVIZHUB_URL && process.env.KVIZHUB_TOKEN) {
    return { url: process.env.KVIZHUB_URL.replace(/\/+$/, ''), token: process.env.KVIZHUB_TOKEN, close: async () => undefined };
  }
  return localServer(opts);
}

export async function apiCall<T>(t: Target, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${t.url}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${t.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

export function connect(url: string): Promise<Sock> {
  const s: Sock = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

export function ack<T = { ok: boolean; error?: string }>(s: Sock, ev: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => (s.emit as (e: string, ...a: unknown[]) => void)(ev, ...args, resolve));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
