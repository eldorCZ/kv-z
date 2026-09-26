import { io as ioc, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@kvizhub/core';

export type Client = Socket<ServerToClientEvents, ClientToServerEvents> & { frames: string[]; events: { ev: string; data: unknown }[] };

export function connect(url: string, headers: Record<string, string> = {}): Promise<Client> {
  const s = ioc(url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: headers }) as Client;
  s.frames = [];
  s.events = [];
  s.io.engine?.on('packet', () => undefined);
  s.onAny((ev, data) => s.events.push({ ev, data }));
  return new Promise((resolve, reject) => {
    s.on('connect', () => {
      // raw engine.io frames – used to prove secrets never travel before reveal
      s.io.engine.on('packet', (p: { data?: unknown }) => {
        if (typeof p.data === 'string') s.frames.push(p.data);
      });
      resolve(s);
    });
    s.on('connect_error', reject);
  });
}

export function once<T = unknown>(s: Client, ev: keyof ServerToClientEvents, timeout = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${String(ev)}`)), timeout);
    s.once(ev as 'question', (data: unknown) => {
      clearTimeout(t);
      resolve(data as T);
    });
  });
}

export function emit<T = { ok: boolean; error?: string }>(s: Client, ev: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve) => (s.emit as (ev: string, ...a: unknown[]) => void)(ev, ...args, (res: T) => resolve(res)));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
