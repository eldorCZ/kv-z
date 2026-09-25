import { useEffect, useState } from 'react';
import type { ClientToServerEvents, ServerToClientEvents } from '@kvizhub/core';
import { io, type Socket } from 'socket.io-client';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(): GameSocket {
  return io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 3000 });
}

export type AckResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Emit with an acknowledgement, as a promise. */
export function call<T = object>(s: GameSocket, ev: string, ...args: unknown[]): Promise<AckResult<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'Server neodpovídá. Zkontrolujte připojení.' }), 8000);
    (s.emit as (e: string, ...a: unknown[]) => void)(ev, ...args, (r: AckResult<T>) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/** Seconds left until a deadline, refreshed 4x per second. */
export function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [deadline]);
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}
