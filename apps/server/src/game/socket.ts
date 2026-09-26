import { checkNickname, type ClientToServerEvents, type ServerToClientEvents } from '@kvizhub/core';
import type { ClassGames } from '../classes/class-games.js';
import { HttpError } from './service.js';
import type { FastifyBaseLogger } from 'fastify';
import type { Server, Socket } from 'socket.io';
import type { AccountRepo } from '../repo/accounts.js';
import { RateLimiter, safeEqual, sha256 } from '../util.js';
import { GameError, rooms, type GameManager, type LiveGame } from './engine.js';

interface SocketData {
  role?: 'host' | 'player';
  gameId?: string;
  playerId?: string;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type S = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const SESSION_COOKIE = 'kh_session';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export interface SocketDeps {
  io: IO;
  games: GameManager;
  accounts: AccountRepo;
  log: FastifyBaseLogger;
  trustProxy: boolean;
  publicUrl: string;
  /** join attempts per IP per minute */
  joinLimit?: number;
  classGames?: ClassGames;
}

function clientIp(socket: S, trustProxy: boolean): string {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (trustProxy && typeof xff === 'string' && xff) return xff.split(',')[0]!.trim();
  return socket.handshake.address;
}

export function setupSockets(deps: SocketDeps) {
  const { io, games, accounts, log } = deps;
  const joinLimiter = new RateLimiter(deps.joinLimit ?? 10, 60_000);
  const answerLimiter = new RateLimiter(30, 10_000);
  const hostLimiter = new RateLimiter(20, 60_000);

  const fail = (ack: unknown, error: string) => {
    if (typeof ack === 'function') ack({ ok: false, error });
  };
  const ok = (ack: unknown, data: object = {}) => {
    if (typeof ack === 'function') ack({ ok: true, ...data });
  };

  io.on('connection', (socket: S) => {
    const ip = clientIp(socket, deps.trustProxy);

    const hostGame = (): LiveGame | undefined => (socket.data.role === 'host' && socket.data.gameId ? games.get(socket.data.gameId) : undefined);

    const hostCmd = (name: string, fn: (g: LiveGame) => void) => (ack?: unknown) => {
      const g = hostGame();
      if (!g) return fail(ack, 'Nejste připojeni jako hostitel hry.');
      try {
        fn(g);
        ok(ack);
      } catch (e) {
        if (e instanceof GameError) return fail(ack, e.message);
        log.error({ err: e, cmd: name }, 'host command failed');
        fail(ack, 'Interní chyba serveru.');
      }
    };

    socket.on('host_attach', (e, ack) => {
      if (hostLimiter.hit(ip)) return fail(ack, 'Příliš mnoho pokusů. Zkuste to za minutu.');
      const g = typeof e?.gameId === 'string' ? games.get(e.gameId) : undefined;
      if (!g) return fail(ack, 'Hra neexistuje nebo už skončila.');
      let allowed = typeof e.hostKey === 'string' && e.hostKey.length > 0 && safeEqual(sha256(e.hostKey), g.row.hostKeyHash);
      if (!allowed) {
        const sid = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
        const session = sid ? accounts.getSession(sid) : undefined;
        allowed = !!session && session.teacherId === g.row.teacherId;
      }
      if (!allowed) return fail(ack, 'Neplatný odkaz pro ovládání hry.');
      if (socket.data.role) return fail(ack, 'Toto spojení už je použito.');
      socket.data = { role: 'host', gameId: g.id };
      void socket.join([rooms.all(g.id), rooms.hosts(g.id)]);
      g.hostAttached();
      ok(ack, { state: g.hostState(), lobby: g.lobby(), joinUrl: `${deps.publicUrl}/play`, title: g.title });
      g.syncHost(socket.id);
    });

    socket.on('start', hostCmd('start', (g) => g.start()));
    socket.on('next', hostCmd('next', (g) => g.next()));
    socket.on('reveal', hostCmd('reveal', (g) => g.reveal()));
    socket.on('skip', hostCmd('skip', (g) => g.skip()));
    socket.on('end', hostCmd('end', (g) => g.end()));
    socket.on('kick_player', (e, ack) => hostCmd('kick', (g) => g.kick(String(e?.playerId ?? '')))(ack));
    socket.on('lock_lobby', (e, ack) => hostCmd('lock', (g) => g.lockLobby(!!e?.locked))(ack));
    socket.on('allow_return', (e, ack) => hostCmd('allow_return', (g) => g.allowReturn(String(e?.playerId ?? '')))(ack));

    const attachPlayer = (g: LiveGame, playerId: string) => {
      socket.data = { role: 'player', gameId: g.id, playerId };
      void socket.join([rooms.all(g.id), rooms.player(playerId)]);
      g.playerAttached(playerId);
    };

    socket.on('join', (e, ack) => {
      if (joinLimiter.hit(ip)) return fail(ack, 'Příliš mnoho pokusů o připojení. Zkuste to za minutu.');
      if (socket.data.role) return fail(ack, 'Už jste připojeni ke hře.');
      const pin = String(e?.pin ?? '').replace(/\D/g, '');
      const g = games.getByPin(pin);
      if (!g) return fail(ack, 'Hra s tímto PINem neexistuje. Zkontrolujte PIN.');
      try {
        // class games (Dodatek 3): a student joins with a one-time ticket, a guest with a nickname when allowed
        let joined;
        if (g.row.classId && deps.classGames) {
          if (e?.ticket) {
            const { student } = deps.classGames.consumeTicket(e.ticket, g.id);
            joined = g.joinStudent({ id: student.id, displayName: deps.classGames.displayName(g.row, student) });
          } else {
            const nick = checkNickname(e?.nickname);
            if (!nick.ok) return fail(ack, nick.error);
            deps.classGames.assertGuestAllowed(g.row, nick.nickname);
            joined = g.join(e?.nickname, { isGuest: true });
          }
        } else joined = g.join(e?.nickname);
        const { player, token } = joined;
        attachPlayer(g, player.id);
        ok(ack, { token, playerId: player.id, nickname: player.nickname, score: 0 });
        g.syncPlayer(player.id);
      } catch (err) {
        if (err instanceof GameError || err instanceof HttpError) return fail(ack, err.message);
        log.error({ err }, 'join failed');
        fail(ack, 'Interní chyba serveru.');
      }
    });

    socket.on('reconnect_player', (e, ack) => {
      if (joinLimiter.hit(`r:${ip}`)) return fail(ack, 'Příliš mnoho pokusů. Zkuste to za minutu.');
      if (socket.data.role) return fail(ack, 'Už jste připojeni ke hře.');
      const found = typeof e?.token === 'string' ? games.findByPlayerToken(e.token) : undefined;
      if (!found) return fail(ack, 'Hra už neexistuje nebo jste byli odebráni.');
      const p = found.game.players.get(found.playerId)!;
      attachPlayer(found.game, found.playerId);
      ok(ack, { token: e.token, playerId: p.id, nickname: p.nickname, score: p.score });
      found.game.syncPlayer(p.id);
    });

    socket.on('answer', (e, ack) => {
      if (socket.data.role !== 'player' || !socket.data.gameId || !socket.data.playerId) return fail(ack, 'Nejste připojeni ke hře.');
      if (answerLimiter.hit(socket.id)) return fail(ack, 'Příliš mnoho odpovědí.');
      const g = games.get(socket.data.gameId);
      if (!g) return fail(ack, 'Hra už neexistuje.');
      const res = g.answer(socket.data.playerId, String(e?.questionId ?? ''), e?.payload);
      if (res.accepted) ok(ack, { accepted: true });
      else fail(ack, res.reason ?? 'Odpověď nebyla přijata.');
    });

    socket.on('disconnect', () => {
      const g = socket.data.gameId ? games.get(socket.data.gameId) : undefined;
      if (!g) return;
      if (socket.data.role === 'host') g.hostDetached();
      else if (socket.data.role === 'player' && socket.data.playerId) g.playerDetached(socket.data.playerId);
    });
  });
}
