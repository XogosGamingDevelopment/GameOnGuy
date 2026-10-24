/**
 * Unit tests for PanicAttackRoom (panic_attack) and the platform pieces it
 * relies on: join codes / unlisted rooms (RoomManager), game tokens
 * (AuthService) and lobby-fill matchmaking (MatchmakingService).
 *
 * Contract requested by Xogos Gaming — Panic Attack (Oct 2026):
 *   1. guests' actions go to the host only
 *   2. the host can send to one player (payload.to) or to everyone
 *   3. players are vouched for by Panic Attack's backend (game token)
 *   4. private rooms get 5-letter codes and never appear in room_list
 *   5. host = first player in; host leaving closes the room
 *   6. Quick Match: 20 s countdown after the 2nd player, start at once with 7
 *   7. server-checked quick-chat (whitelist, private only, 1.2 s)
 *   8. up to 7 players per room (Oct 21 2026), any number of rooms at once
 */

import jwt from 'jsonwebtoken';
import { Message } from '../../src/core/types';
import { Client } from '../../src/core/Client';
import { PanicAttackRoom } from '../../src/games/xogos/PanicAttackRoom';
import { RoomManager } from '../../src/rooms/RoomManager';
import { AuthService } from '../../src/auth/AuthService';
import { MatchmakingService } from '../../src/matchmaking/MatchmakingService';

class FakeClient {
  public readonly sessionId: string;
  public currentRoomId?: string;
  public sent: Message[] = [];
  public metadata: Record<string, unknown> = {};

  constructor(public readonly id: string, public userId: string, public username: string) {
    this.sessionId = `sess-${id}`;
  }

  send(message: Message): void {
    this.sent.push(message);
  }

  sendError(message: string, code?: string): void {
    this.sent.push({ type: 'error', payload: { message, code } });
  }

  setRoom(roomId: string | undefined): void {
    this.currentRoomId = roomId;
  }

  of(type: string): any[] {
    return this.sent.filter((m) => m.type === type);
  }

  last(type: string): any {
    const all = this.of(type);
    return all[all.length - 1];
  }
}

const asClient = (c: FakeClient) => c as unknown as Client;

async function makeRoom(clients: FakeClient[], options: Record<string, unknown> = {}) {
  const room = new PanicAttackRoom('panic_attack', options);
  for (const c of clients) await room.addPlayer(asClient(c));
  return room;
}

describe('PanicAttackRoom', () => {
  let host: FakeClient;
  let g1: FakeClient;
  let g2: FakeClient;

  beforeEach(() => {
    host = new FakeClient('host', 'panic_attack:s1', 'Ana');
    g1 = new FakeClient('g1', 'panic_attack:s2', 'Ben');
    g2 = new FakeClient('g2', 'panic_attack:s3', 'Cy');
  });

  describe('routing', () => {
    it('relays a guest action to the host only', async () => {
      const room = await makeRoom([host, g1, g2]);
      room.handleGameAction(asClient(g1), { type: 'in', data: { x: 1, z: 2, r: 0, b: 0, mv: 1 } });

      const got = host.last('game_action');
      expect(got.payload).toMatchObject({
        type: 'in',
        action: 'in',
        playerId: 'g1',
        fromHost: false,
        data: { x: 1, z: 2, r: 0, b: 0, mv: 1 },
      });
      expect(g2.of('game_action')).toHaveLength(0);
      expect(g1.of('game_action')).toHaveLength(0);
    });

    it('ignores payload.to from a guest (still host only)', async () => {
      const room = await makeRoom([host, g1, g2]);
      room.handleGameAction(asClient(g1), { type: 'snap', to: 'g2', data: { fake: true } });

      expect(g2.of('game_action')).toHaveLength(0);
      expect(host.of('game_action')).toHaveLength(1);
    });

    it('broadcasts a host action to everyone else', async () => {
      const room = await makeRoom([host, g1, g2]);
      room.handleGameAction(asClient(host), { type: 'snap', data: { t: 1 } });

      expect(g1.last('game_action').payload).toMatchObject({ type: 'snap', fromHost: true, data: { t: 1 } });
      expect(g2.last('game_action').payload.type).toBe('snap');
      expect(host.of('game_action')).toHaveLength(0);
    });

    it('sends a host action with payload.to to that player only', async () => {
      const room = await makeRoom([host, g1, g2]);
      room.handleGameAction(asClient(host), { type: 'secret', to: 'g2', data: { role: 'worry' } });

      expect(g2.last('game_action').payload).toMatchObject({ type: 'secret', data: { role: 'worry' } });
      expect(g1.of('game_action')).toHaveLength(0);
    });

    it('rejects payload.to that is not in the room', async () => {
      const room = await makeRoom([host, g1]);
      room.handleGameAction(asClient(host), { type: 'secret', to: 'nobody', data: {} });

      expect(host.last('error').payload.code).toBe('BAD_TARGET');
      expect(g1.of('game_action')).toHaveLength(0);
    });

    it('accepts payload.action as an alias and a flat payload', async () => {
      const room = await makeRoom([host, g1]);
      room.handleGameAction(asClient(g1), { action: 'act', a: 'power', sequence: 7 });

      expect(host.last('game_action').payload).toMatchObject({
        type: 'act',
        data: { a: 'power' },
        sequence: 7,
      });
    });

    it('works before any "start" (lobby messages)', async () => {
      const room = await makeRoom([host, g1]);
      room.handleGameAction(asClient(g1), { type: 'feeling', data: { f: 'blue' } });
      expect(host.last('game_action').payload.data).toEqual({ f: 'blue' });
      expect(host.of('error')).toHaveLength(0);
    });
  });

  describe('host and lifecycle', () => {
    it('makes the first player the host and reports it', async () => {
      const room = await makeRoom([host, g1]);
      expect(room.getInfo().hostId).toBe('host');
      expect(room.getState()).toMatchObject({ hostId: 'host', phase: 'lobby' });
      expect(room.getState().players).toEqual([
        { id: 'host', name: 'Ana', isHost: true },
        { id: 'g1', name: 'Ben', isHost: false },
      ]);
    });

    it('does not expose userId or sessionId in player_joined', async () => {
      await makeRoom([host, g1]);
      const joined = host.last('player_joined').payload;
      expect(joined).toEqual({ id: 'g1', name: 'Ben', isHost: false });
    });

    it('closes the room for everyone when the host leaves', async () => {
      const room = await makeRoom([host, g1, g2]);
      await room.removePlayer('host');

      expect(g1.last('room_closed').payload).toMatchObject({ reason: 'host_left', message: 'The host left.' });
      expect(g2.last('room_closed')).toBeDefined();
      expect(g1.currentRoomId).toBeUndefined();
      expect(room.playerCount).toBe(0);
    });

    it('keeps the room open when a guest leaves', async () => {
      const room = await makeRoom([host, g1, g2]);
      room.handleGameAction(asClient(host), { type: 'start', data: { setup: {} } });
      await room.removePlayer('g1');

      expect(host.last('player_left').payload).toEqual({ playerId: 'g1' });
      expect(host.of('room_closed')).toHaveLength(0);
      expect(host.of('game_end')).toHaveLength(0);
      room.handleGameAction(asClient(g2), { type: 'in', data: {} });
      expect(host.last('game_action').payload.playerId).toBe('g2');
    });

    it('locks the room on host "start" and unlocks on "end"', async () => {
      const room = await makeRoom([host, g1]);
      room.handleGameAction(asClient(host), { type: 'start', data: {} });
      await expect(room.addPlayer(asClient(g2))).rejects.toThrow('already started');

      room.handleGameAction(asClient(host), { type: 'end', data: {} });
      await expect(room.addPlayer(asClient(g2))).resolves.toBeDefined();
    });

    it('a guest sending "start" does not lock the room', async () => {
      const room = await makeRoom([host, g1]);
      room.handleGameAction(asClient(g1), { type: 'start', data: {} });
      expect(room.getState().phase).toBe('lobby');
    });

    it('caps rooms at 7 players', async () => {
      const room = new PanicAttackRoom('panic_attack', { maxPlayers: 50 });
      for (let i = 0; i < 7; i++) await room.addPlayer(asClient(new FakeClient(`p${i}`, `u${i}`, `P${i}`)));
      await expect(room.addPlayer(asClient(new FakeClient('p8', 'u8', 'P8')))).rejects.toThrow('full');
    });

    it('ignores player_ready (no server game loop)', async () => {
      const room = await makeRoom([host, g1]);
      room.setPlayerReady('host', true);
      room.setPlayerReady('g1', true);
      room.startGame();
      expect(host.of('game_start')).toHaveLength(0);
      expect(host.of('state_full')).toHaveLength(0);
    });

    it('private (room_create) rooms want a code and show first names; Quick Match does neither', async () => {
      const priv = await makeRoom([host]);
      expect(priv.wantsJoinCode()).toBe(true);
      expect(priv.isListed()).toBe(false);

      const quick = await makeRoom([g1, g2], { fromMatchmaking: true });
      expect(quick.wantsJoinCode()).toBe(false);
      expect(quick.isListed()).toBe(false);
      expect(quick.getState().players).toEqual([
        { id: 'g1', name: null, isHost: true },
        { id: 'g2', name: null, isHost: false },
      ]);
    });
  });

  describe('quick-chat', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('broadcasts a valid phrase to everyone, including the sender', async () => {
      const room = await makeRoom([host, g1, g2]);
      room.handleGameAction(asClient(g1), { type: 'chat', data: { phrase: 'saw', who: 'red', where: 12 } });

      for (const c of [host, g1, g2]) {
        expect(c.last('game_action').payload).toMatchObject({
          type: 'chat',
          playerId: 'g1',
          data: { phrase: 'saw', who: 'red', where: 12 },
          serverChecked: true,
        });
      }
    });

    it.each([
      [{ phrase: 'sus', who: 'red' }],
      [{ phrase: 'wru', who: 'white' }],
      [{ phrase: 'vote', who: 'green' }],
      [{ phrase: 'notme' }],
      [{ phrase: 'proof' }],
      [{ phrase: 'skip' }],
    ])('accepts Hidden Worries Huddle phrase %j', async (data) => {
      const room = await makeRoom([host, g1]);
      room.handleGameAction(asClient(g1), { type: 'chat', data });
      expect(g1.of('error')).toHaveLength(0);
      expect(host.last('game_action').payload).toMatchObject({ type: 'chat', data, serverChecked: true });
    });

    it('strips unknown fields', async () => {
      const room = await makeRoom([host, g1]);
      room.handleGameAction(asClient(g1), { type: 'chat', data: { phrase: 'gg', text: 'free text!' } });
      expect(host.last('game_action').payload.data).toEqual({ phrase: 'gg' });
    });

    it.each([
      [{ phrase: 'hello' }],
      [{ phrase: 'saw', who: 'orange' }],
      [{ phrase: 'sus', who: 'Ana' }],
      [{ phrase: 'saw', where: 61 }],
      [{ phrase: 'saw', where: 2.5 }],
      [{ phrase: 'saw', where: '3' }],
      [null],
    ])('rejects %j', async (data) => {
      const room = await makeRoom([host, g1]);
      room.handleGameAction(asClient(g1), { type: 'chat', data });
      expect(g1.last('error').payload.code).toBe('CHAT_REJECTED');
      expect(host.of('game_action')).toHaveLength(0);
    });

    it('refuses chat in Quick Match rooms', async () => {
      const room = await makeRoom([host, g1], { fromMatchmaking: true });
      room.handleGameAction(asClient(g1), { type: 'chat', data: { phrase: 'gg' } });
      expect(g1.last('error').payload.message).toMatch(/private rooms/);
      expect(host.of('game_action')).toHaveLength(0);
    });

    it('allows one message per 1.2 s per player', async () => {
      const room = await makeRoom([host, g1]);
      room.handleGameAction(asClient(g1), { type: 'chat', data: { phrase: 'go' } });
      room.handleGameAction(asClient(g1), { type: 'chat', data: { phrase: 'go' } });
      expect(g1.last('error').payload.message).toBe('Chat too fast');

      jest.advanceTimersByTime(1200);
      room.handleGameAction(asClient(g1), { type: 'chat', data: { phrase: 'go' } });
      expect(host.of('game_action')).toHaveLength(2);
    });
  });
});

describe('RoomManager join codes', () => {
  it('gives private panic rooms a 5-consonant code, resolves it, and hides them from room_list', async () => {
    const rm = new RoomManager({});
    rm.registerGame('panic_attack', PanicAttackRoom as any, {
      name: 'Panic Attack', minPlayers: 2, maxPlayers: 7, defaultTickRate: 1,
    });
    const room = await rm.createRoom('panic_attack', {});

    expect(room.joinCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{5}$/);
    expect(room.getInfo().joinCode).toBe(room.joinCode);
    expect(rm.findRoomIdByCode(room.joinCode!.toLowerCase())).toBe(room.id);
    expect(rm.listRooms()).toHaveLength(0);
    expect(rm.listRooms({ gameType: 'panic_attack', isPrivate: true })).toHaveLength(0);

    room.dispose();
    expect(rm.findRoomIdByCode(room.joinCode!)).toBeUndefined();
  });

  it('runs many full private rooms at once, each with its own code and players', async () => {
    const rm = new RoomManager({});
    rm.registerGame('panic_attack', PanicAttackRoom as any, {
      name: 'Panic Attack', minPlayers: 2, maxPlayers: 7, defaultTickRate: 1,
    });
    const rooms = [];
    for (let r = 0; r < 5; r++) {
      const room = await rm.createRoom('panic_attack', { maxPlayers: 7 });
      const players = [];
      for (let i = 0; i < 7; i++) {
        const c = new FakeClient(`r${r}p${i}`, `u-r${r}p${i}`, `P${i}`);
        await rm.joinRoom(rm.findRoomIdByCode(room.joinCode!)!, asClient(c));
        players.push(c);
      }
      rooms.push({ room, players });
    }
    expect(new Set(rooms.map((x) => x.room.joinCode)).size).toBe(5);

    const [a, b] = rooms;
    a.room.handleGameAction(asClient(a.players[0]), { type: 'snap', data: { n: 1 } });
    a.room.handleGameAction(asClient(a.players[3]), { type: 'chat', data: { phrase: 'sus', who: 'red' } });
    for (const c of a.players.slice(1)) expect(c.of('game_action').length).toBeGreaterThan(0);
    for (const c of b.players) expect(c.of('game_action')).toHaveLength(0);

    const intruder = new FakeClient('x', 'u-x', 'X');
    await expect(rm.joinRoom(b.room.id, asClient(intruder))).rejects.toThrow('full');

    for (const { room } of rooms) room.dispose();
  });

  it('gives Quick Match rooms no code', async () => {
    const rm = new RoomManager({});
    rm.registerGame('panic_attack', PanicAttackRoom as any, {
      name: 'Panic Attack', minPlayers: 2, maxPlayers: 7, defaultTickRate: 1,
    });
    const room = await rm.createRoom('panic_attack', { fromMatchmaking: true });
    expect(room.joinCode).toBeUndefined();
  });
});

describe('AuthService game tokens', () => {
  const SECRET = 'x'.repeat(48);
  const sign = (claims: Record<string, unknown>, secret = SECRET, opts: jwt.SignOptions = {}) =>
    jwt.sign({ game: 'panic_attack', ...claims }, secret, {
      audience: 'gameondude',
      expiresIn: '5m',
      ...opts,
    });

  let auth: AuthService;
  beforeEach(() => {
    auth = new AuthService();
    auth.registerGameTokenSecret('panic_attack', SECRET);
  });

  it('accepts a token signed by the game backend and keeps only the first name', async () => {
    const result = await auth.authenticate({ token: sign({ sub: 'stu-42', name: 'Maria Lopez' }) });
    expect(result).toMatchObject({
      success: true,
      userId: 'panic_attack:stu-42',
      username: 'Maria',
      game: 'panic_attack',
    });
  });

  it('rejects a token signed with the wrong secret', async () => {
    const result = await auth.authenticate({ token: sign({ sub: 's' }, 'y'.repeat(48)) });
    expect(result).toMatchObject({ success: false, error: 'Invalid token' });
  });

  it('rejects the wrong audience, a missing sub, and expired tokens', async () => {
    expect((await auth.authenticate({ token: sign({ sub: 's' }, SECRET, { audience: 'other' }) })).success).toBe(false);
    expect((await auth.authenticate({ token: sign({}) })).success).toBe(false);
    const expired = jwt.sign(
      { game: 'panic_attack', sub: 's', aud: 'gameondude', iat: 1000, exp: 1060 },
      SECRET
    );
    expect((await auth.authenticate({ token: expired })).success).toBe(false);
  });

  it('rejects tokens without an expiry', async () => {
    const forever = jwt.sign({ game: 'panic_attack', sub: 's', aud: 'gameondude' }, SECRET);
    expect((await auth.authenticate({ token: forever })).success).toBe(false);
  });

  it('a token claiming game=panic_attack but signed with the platform secret is rejected', async () => {
    const forged = jwt.sign(
      { game: 'panic_attack', sub: 's', userId: 'u1', username: 'x' },
      'gameondude-dev-secret-change-in-production', // AuthService's dev platform secret
      { audience: 'gameondude', expiresIn: '5m' }
    );
    expect((await auth.authenticate({ token: forged })).success).toBe(false);
  });

  it('ordinary platform JWTs still work and carry no game access', async () => {
    const result = await auth.authenticate({ token: auth.generateToken('u1', 'someone') });
    expect(result.success).toBe(true);
    expect(result.game).toBeUndefined();
  });

  it('refuses short secrets', () => {
    expect(() => auth.registerGameTokenSecret('x', 'short')).toThrow();
  });
});

describe('MatchmakingService lobby-fill', () => {
  let rm: RoomManager;
  let mm: MatchmakingService;
  let clients: Map<string, FakeClient>;

  beforeEach(() => {
    jest.useFakeTimers();
    rm = new RoomManager({});
    rm.registerGame('panic_attack', PanicAttackRoom as any, {
      name: 'Panic Attack', minPlayers: 2, maxPlayers: 7, defaultTickRate: 1,
    });
    clients = new Map();
    mm = new MatchmakingService(rm, (id) => clients.get(id) as unknown as Client);
    mm.configureGameMatchmaking('panic_attack', {
      timeout: 120000,
      fillCountdownMs: 20000,
      minMatchPlayers: 2,
      maxMatchPlayers: 7,
      autoJoinMatched: true,
    });
  });

  afterEach(() => {
    mm.stop();
    jest.useRealTimers();
  });

  async function queue(id: string, gameMode = 'classic') {
    const c = new FakeClient(id, `u-${id}`, id);
    clients.set(id, c);
    await mm.requestMatch({ playerId: id, sessionId: id, gameType: 'panic_attack', gameMode, timestamp: Date.now() });
    return c;
  }

  async function tick(ms: number) {
    await jest.advanceTimersByTimeAsync(ms);
  }

  it('starts 20 s after the 2nd player, joins everyone, first queued is host', async () => {
    const a = await queue('a');
    await tick(5000);
    const b = await queue('b');
    await tick(1000);

    expect(b.last('matchmake_update').payload).toMatchObject({ playersFound: 2 });
    expect(b.last('matchmake_update').payload.startsAt).not.toBeNull();
    expect(a.of('room_joined')).toHaveLength(0);

    const c = await queue('c');
    await tick(1000);
    expect(c.last('matchmake_update').payload.playersFound).toBe(3);

    await tick(19000);
    for (const p of [a, b, c]) {
      expect(p.of('matchmake_found')).toHaveLength(1);
      expect(p.of('room_joined')).toHaveLength(1);
    }
    const state = c.last('room_joined').payload.state;
    expect(state.hostId).toBe('a');
    expect(state.players).toHaveLength(3);
    expect(c.last('room_joined').payload.room.joinCode).toBeUndefined();
    expect(mm.getQueueSize()).toBe(0);
  });

  it('starts at once with 7 players (6 still waits for the countdown)', async () => {
    const ps = [];
    for (let i = 0; i < 6; i++) ps.push(await queue(`p${i}`));
    await tick(1000);
    expect(ps[5].of('room_joined')).toHaveLength(0);

    ps.push(await queue('p6'));
    await tick(1000);
    for (const p of ps) expect(p.of('room_joined')).toHaveLength(1);
    expect(ps[0].last('room_joined').payload.state.hostId).toBe('p0');
    expect(ps[6].last('room_joined').payload.state.players).toHaveLength(7);
  });

  it('keeps classic and hidden queues apart', async () => {
    const a = await queue('a', 'classic');
    const b = await queue('b', 'hidden');
    await tick(25000);
    expect(a.of('room_joined')).toHaveLength(0);
    expect(b.of('room_joined')).toHaveLength(0);
  });

  it('cancels the countdown if a player leaves the queue', async () => {
    const a = await queue('a');
    await queue('b');
    await tick(1000);
    mm.cancelMatch('b');
    await tick(1000);
    expect(a.last('matchmake_update').payload).toMatchObject({ playersFound: 1, startsAt: null });
    await tick(30000);
    expect(a.of('room_joined')).toHaveLength(0);
  });

  it('a lone player times out after the configured timeout', async () => {
    const a = await queue('a');
    await tick(121000);
    expect(a.of('matchmake_timeout')).toHaveLength(1);
  });
});
