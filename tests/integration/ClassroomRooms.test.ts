/**
 * End-to-end over real WebSockets (Phase 18): room_created / room_joined
 * carry playerId, joinCode, roster and rejoinToken; private rooms stay out of
 * room_list; room_error carries codes; student games refuse other origins;
 * a dropped player rejoins on a new connection with the same playerId.
 */

import WebSocket from 'ws';
import { GameOnServer } from '../../src/core/Server';
import { TypingRaceRoom } from '../../src/games/xogos/TypingRaceRoom';
import { HistoricalConquestRelayRoom } from '../../src/games/xogos/HistoricalConquestRelayRoom';

const TURBO_ORIGIN = 'https://turbotype.myxogos.com';
const HC_ORIGIN = 'https://game.historicalconquest.org';
const PORT = 39000 + Math.floor(Math.random() * 1000);
const URL = `ws://127.0.0.1:${PORT}/ws`;

class TestClient {
  private messages: any[] = [];
  private waiters: Array<{ type: string; resolve: (m: any) => void }> = [];
  public clientId = '';

  constructor(public ws: WebSocket) {
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = this.waiters.findIndex((w) => w.type === msg.type);
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.messages.push(msg);
    });
  }

  static async connect(origin: string | undefined, guestId: string, username: string): Promise<TestClient> {
    const ws = new WebSocket(URL, origin ? { origin } : {});
    const c = new TestClient(ws);
    const welcome = await c.next('welcome');
    c.clientId = welcome.payload.clientId;
    c.send('auth', { username, guestId });
    await c.next('auth_success');
    return c;
  }

  send(type: string, payload: unknown = {}) {
    this.ws.send(JSON.stringify({ type, payload }));
  }

  next(type: string, timeoutMs = 3000): Promise<any> {
    const i = this.messages.findIndex((m) => m.type === type);
    if (i >= 0) return Promise.resolve(this.messages.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({ type, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    });
  }

  close() {
    this.ws.close();
  }
}

describe('classroom rooms over real sockets', () => {
  let server: GameOnServer;
  const open: TestClient[] = [];

  const connect = async (origin: string | undefined, guestId: string, username: string) => {
    const c = await TestClient.connect(origin, guestId, username);
    open.push(c);
    return c;
  };

  beforeAll(async () => {
    server = new GameOnServer({ port: PORT, host: '127.0.0.1', enableMiddleware: false });
    server.roomManager.registerGame('typing_race', TypingRaceRoom, {
      name: 'Typing Race', minPlayers: 2, maxPlayers: 8, defaultTickRate: 1,
    });
    server.roomManager.registerGame('historical_conquest', HistoricalConquestRelayRoom, {
      name: 'Historical Conquest', minPlayers: 2, maxPlayers: 4, defaultTickRate: 1,
    });
    server.setGameAccessPolicy('typing_race', { allowedOrigins: [TURBO_ORIGIN], childDirected: true });
    server.setGameAccessPolicy('historical_conquest', { allowedOrigins: [HC_ORIGIN], childDirected: true });
    await server.start();
  });

  afterEach(() => {
    while (open.length) open.pop()!.close();
  });

  afterAll(async () => {
    server.roomManager.disposeAll();
    await server.stop();
  });

  it('typing_race: room_created has playerId, a 6-letter code, roster and rejoinToken; room is unlisted', async () => {
    const host = await connect(TURBO_ORIGIN, 'xogos-1', 'Alice');
    host.send('room_create', { gameType: 'typing_race', options: { maxPlayers: 2 }, playerData: { carId: 'rally-x' } });
    const created = (await host.next('room_created')).payload;

    expect(created.playerId).toBe(host.clientId);
    expect(created.joinCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{6}$/);
    expect(created.rejoinToken).toMatch(/^[0-9a-f]{48}$/);
    expect(created.players).toEqual([
      expect.objectContaining({ id: host.clientId, username: 'Alice', data: { carId: 'rally-x' } }),
    ]);

    const other = await connect(TURBO_ORIGIN, 'xogos-2', 'Bob');
    other.send('room_list', { gameType: 'typing_race' });
    expect((await other.next('room_list')).payload.rooms).toEqual([]);

    other.send('room_join', { joinCode: created.joinCode.toLowerCase() });
    const joined = (await other.next('room_joined')).payload;
    expect(joined.playerId).toBe(other.clientId);
    expect(joined.room.players.map((p: any) => p.id)).toEqual([host.clientId, other.clientId]);
    expect(joined.room.players[0]).not.toHaveProperty('userId');

    const third = await connect(TURBO_ORIGIN, 'xogos-3', 'Cy');
    third.send('room_join', { roomId: created.id });
    expect((await third.next('room_error')).payload).toEqual({ message: 'Room is full', code: 'ROOM_FULL' });
  });

  it('/health reports clients, rooms, version and uptime (counts only)', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/health`);
    const body = await res.json();
    expect(body).toEqual({
      status: 'ok',
      clients: expect.any(Number),
      rooms: expect.any(Number),
      version: expect.any(String),
      uptimeSeconds: expect.any(Number),
    });
  });

  it('typing_race: listed only when created with isPrivate: false', async () => {
    const host = await connect(TURBO_ORIGIN, 'xogos-4', 'Dee');
    host.send('room_create', { gameType: 'typing_race', options: { isPrivate: false } });
    const created = (await host.next('room_created')).payload;
    host.send('room_list', { gameType: 'typing_race' });
    const rooms = (await host.next('room_list')).payload.rooms;
    expect(rooms.map((r: any) => r.id)).toContain(created.id);
    expect(rooms[0]).not.toHaveProperty('players');
  });

  it('refuses student games from other origins (ACCESS_DENIED) and unknown codes (ROOM_NOT_FOUND)', async () => {
    const outsider = await connect(undefined, 'scripted', 'Mallory');
    outsider.send('room_create', { gameType: 'typing_race' });
    expect((await outsider.next('room_error')).payload.code).toBe('ACCESS_DENIED');

    const wrongSite = await connect('https://evil.example', 'x', 'Eve');
    wrongSite.send('room_create', { gameType: 'historical_conquest' });
    expect((await wrongSite.next('room_error')).payload.code).toBe('ACCESS_DENIED');

    const student = await connect(TURBO_ORIGIN, 'xogos-5', 'Eli');
    student.send('room_join', { joinCode: 'ZZZZZZ' });
    expect((await student.next('room_error')).payload).toEqual({ message: 'Room not found', code: 'ROOM_NOT_FOUND' });
  });

  it('historical_conquest: private games are unlisted and joinable by code or full id', async () => {
    const host = await connect(HC_ORIGIN, 'xogos-10', 'Ada');
    host.send('room_create', { gameType: 'historical_conquest', options: { isPrivate: true, maxPlayers: 3 } });
    const created = (await host.next('room_created')).payload;
    expect(created.joinCode).toMatch(/^[A-Z]{6}$/);
    expect(created.name).toBe('Private game');

    const waiting = await connect(HC_ORIGIN, 'xogos-11', 'Ben');
    waiting.send('room_create', { gameType: 'historical_conquest', options: { isPrivate: false, metadata: { hcWaitingRoom: true } } });
    const waitingRoom = (await waiting.next('room_created')).payload;

    const lister = await connect(HC_ORIGIN, 'xogos-12', 'Cy');
    lister.send('room_list', { gameType: 'historical_conquest' });
    const rooms = (await lister.next('room_list')).payload.rooms;
    expect(rooms.map((r: any) => r.id)).toEqual([waitingRoom.id]);
    expect(rooms[0].metadata).toEqual({ hcWaitingRoom: true });

    lister.send('room_join', { roomId: created.id, playerData: { uid: 'xogos-12', rating: 1000, email: 'no' } });
    const joined = (await lister.next('room_joined')).payload;
    expect(joined.room.players[1].data).toEqual({ uid: 'xogos-12', rating: 1000 });
    const seen = (await host.next('player_joined')).payload;
    expect(seen).toMatchObject({ id: lister.clientId, data: { uid: 'xogos-12', rating: 1000 } });
  });

  it('a dropped player rejoins on a new connection with the same playerId', async () => {
    const host = await connect(TURBO_ORIGIN, 'xogos-20', 'Ann');
    host.send('room_create', { gameType: 'typing_race' });
    const created = (await host.next('room_created')).payload;

    const bob = await connect(TURBO_ORIGIN, 'xogos-21', 'Bob');
    bob.send('room_join', { joinCode: created.joinCode });
    const joined = (await bob.next('room_joined')).payload;
    const bobId = joined.playerId;

    host.send('game_action', { action: 'race_setup', data: { text: 'hello world', startAt: Date.now() } });
    bob.send('game_action', { action: 'progress', data: { position: 40, wpm: 30, accuracy: 99 } });
    // Wait until the host has seen Bob's progress before dropping him.
    for (;;) {
      const s = (await host.next('state_update')).payload.state;
      if (s.players.find((p: any) => p.id === bobId)?.position === 40) break;
    }

    bob.ws.terminate();
    expect((await host.next('player_disconnected')).payload).toEqual({ playerId: bobId, holdMs: 90000 });

    // A late joiner can't take the seat while the race runs.
    const late = await connect(TURBO_ORIGIN, 'xogos-22', 'Cat');
    late.send('room_join', { joinCode: created.joinCode });
    expect((await late.next('room_error')).payload.code).toBe('RACE_IN_PROGRESS');

    // Someone else holding the token can't use it.
    late.send('room_join', { roomId: created.id, rejoinToken: joined.rejoinToken });
    expect((await late.next('room_error')).payload.code).toBe('BAD_REJOIN_TOKEN');

    const bobAgain = await connect(TURBO_ORIGIN, 'xogos-21', 'Bob');
    expect(bobAgain.clientId).not.toBe(bobId);
    bobAgain.send('room_join', { roomId: created.id, rejoinToken: joined.rejoinToken });
    const rejoined = (await bobAgain.next('room_joined')).payload;
    expect(rejoined).toMatchObject({ playerId: bobId, rejoined: true, rejoinToken: joined.rejoinToken });
    expect(rejoined.state.players[bobId]).toMatchObject({ position: 40 });
    expect((await host.next('player_reconnected')).payload).toEqual({ playerId: bobId });

    bobAgain.send('game_action', { action: 'finish', data: { time: 12, wpm: 31, accuracy: 99 } });
    host.send('game_action', { action: 'finish', data: { dnf: true, position: 10 } });
    const standings = (await host.next('game_end')).payload.results.standings;
    expect(standings.map((s: any) => [s.id, s.dnf])).toEqual([
      [bobId, false],
      [host.clientId, true],
    ]);
  });
});
