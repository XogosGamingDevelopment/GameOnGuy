/**
 * TypingRaceRoom — Phase 18 classroom features (Turbo Type, Oct 2026):
 * their exact formats (carId, race_setup extras, finish { dnf }), hidden
 * rooms with 6-letter codes, room_update, late-join refusal, and the 90 s
 * rejoin hold with DNF on expiry.
 */

import { Message } from '../../src/core/types';
import { Client } from '../../src/core/Client';
import { TypingRaceRoom } from '../../src/games/xogos/TypingRaceRoom';

class FakeClient {
  public readonly id: string;
  public readonly sessionId: string;
  public userId: string;
  public username: string;
  public currentRoomId?: string;
  public sent: Message[] = [];
  public closed?: { code: number; reason: string };

  constructor(id: string, userId: string, username: string) {
    this.id = id;
    this.sessionId = `sess-${id}`;
    this.userId = userId;
    this.username = username;
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

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  last(type: string): any {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i].type === type) return this.sent[i];
    }
    return undefined;
  }
}

const asClient = (c: FakeClient) => c as unknown as Client;

async function makeRoom(clients: FakeClient[], options: Record<string, unknown> = {}) {
  const room = new TypingRaceRoom('typing_race', {
    creatorId: clients[0]?.userId,
    minPlayers: 1,
    maxPlayers: 6,
    ...options,
  });
  for (const c of clients) await room.addPlayer(asClient(c));
  return room;
}

function lastPlayers(c: FakeClient): any[] {
  return c.last('state_update').payload.state.players;
}

function setup(room: TypingRaceRoom, host: FakeClient, extra: Record<string, unknown> = {}) {
  room.handleGameAction(asClient(host), {
    action: 'race_setup',
    data: { text: 'the quick brown fox', startAt: Date.now(), ...extra },
  });
}

describe('TypingRaceRoom classroom features', () => {
  let host: FakeClient;
  let p2: FakeClient;
  let p3: FakeClient;

  beforeEach(() => {
    host = new FakeClient('c-host', 'guest_xogos-1', 'Alice');
    p2 = new FakeClient('c-2', 'guest_xogos-2', 'Bob');
    p3 = new FakeClient('c-3', 'guest_xogos-3', 'Carol');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('carId (Turbo Type formats)', () => {
    it('keeps carId from player_ready { ready, carId } and shows it everywhere', async () => {
      const room = await makeRoom([host, p2]);

      room.setPlayerReady(p2.id, true, { ready: true, carId: 'apex-coupe-gs', colour: '#f00' });

      const ready = host.last('player_ready').payload;
      expect(ready).toEqual({
        playerId: p2.id,
        ready: true,
        carId: 'apex-coupe-gs',
        data: { carId: 'apex-coupe-gs' },
      });
      const p2State = lastPlayers(host).find((p) => p.id === p2.id);
      expect(p2State.data).toEqual({ carId: 'apex-coupe-gs' }); // colour dropped
      expect(room.getMemberInfo().players).toContainEqual(
        expect.objectContaining({ id: p2.id, data: { carId: 'apex-coupe-gs' } })
      );
    });

    it('accepts playerData on join and carId in progress data', async () => {
      const room = new TypingRaceRoom('typing_race', { creatorId: host.userId, minPlayers: 1 });
      await room.addPlayer(asClient(host), undefined, { carId: 'rally-x' });
      await room.addPlayer(asClient(p2));
      setup(room, host);

      room.handleGameAction(asClient(p2), { action: 'progress', data: { position: 10, wpm: 30, accuracy: 95, carId: 'turbo-7' } });

      const players = lastPlayers(host);
      expect(players.find((p) => p.id === host.id).data).toEqual({ carId: 'rally-x' });
      expect(players.find((p) => p.id === p2.id).data).toEqual({ carId: 'turbo-7' });
    });

    it('drops a carId that is not a short id string', async () => {
      const room = await makeRoom([host, p2]);
      room.setPlayerReady(p2.id, true, { ready: true, carId: '<script>alert(1)</script>' });
      expect(host.last('player_ready').payload).toEqual({ playerId: p2.id, ready: true });
    });
  });

  describe('race_setup extras', () => {
    it('passes typingMode/length/difficulty/cars through to everyone', async () => {
      const room = await makeRoom([host, p2]);
      setup(room, host, {
        typingMode: 'sprint',
        length: 'short',
        difficulty: 'easy',
        cars: { [host.id]: 'rally-x', [p2.id]: 'turbo-7' },
      });

      const state = p2.last('state_update').payload.state;
      expect(state).toMatchObject({
        status: 'racing',
        text: 'the quick brown fox',
        typingMode: 'sprint',
        length: 'short',
        difficulty: 'easy',
        cars: { [host.id]: 'rally-x', [p2.id]: 'turbo-7' },
      });
    });

    it("extras can't overwrite status or players", async () => {
      const room = await makeRoom([host, p2]);
      setup(room, host, { status: 'finished', players: 'nope' });
      const state = p2.last('state_update').payload.state;
      expect(state.status).toBe('racing');
      expect(Array.isArray(state.players)).toBe(true);
    });
  });

  describe('finish { dnf: true }', () => {
    it('keeps the real position and ranks DNFs after every finisher', async () => {
      const room = await makeRoom([host, p2, p3]);
      setup(room, host);

      room.handleGameAction(asClient(p2), { action: 'progress', data: { position: 80, wpm: 50 } });
      room.handleGameAction(asClient(host), { action: 'finish', data: { time: -1, dnf: true, position: 63, wpm: 40, accuracy: 90 } });
      room.handleGameAction(asClient(p3), { action: 'finish', data: { time: 41.2, wpm: 55, accuracy: 97 } });
      room.handleGameAction(asClient(p2), { action: 'finish', data: { time: 48, wpm: 50, accuracy: 96 } });

      const standings = host.last('game_end').payload.results.standings;
      expect(standings.map((s: any) => [s.id, s.place, s.dnf])).toEqual([
        [p3.id, 1, false],
        [p2.id, 2, false],
        [host.id, 3, true],
      ]);
      expect(standings[2].time).toBeNull();
    });

    it('a DNF does not start the grace window', async () => {
      jest.useFakeTimers();
      const room = await makeRoom([host, p2], { finishGraceMs: 1000 });
      setup(room, host);

      room.handleGameAction(asClient(host), { action: 'finish', data: { dnf: true, position: 20 } });
      jest.advanceTimersByTime(5000);
      expect(host.last('game_end')).toBeUndefined();

      room.handleGameAction(asClient(p2), { action: 'finish', data: { time: 30 } });
      expect(host.last('game_end')).toBeDefined();
    });

    it('caps finishGraceMs at 5 minutes', async () => {
      jest.useFakeTimers();
      const room = await makeRoom([host, p2], { finishGraceMs: 60 * 60 * 1000 });
      setup(room, host);
      room.handleGameAction(asClient(host), { action: 'finish', data: { time: 30 } });

      jest.advanceTimersByTime(5 * 60 * 1000 - 1);
      expect(host.last('game_end')).toBeUndefined();
      jest.advanceTimersByTime(1);
      expect(host.last('game_end')).toBeDefined();
    });
  });

  describe('classroom rooms', () => {
    it('are hidden from room_list by default and get a 6-letter code', async () => {
      const room = await makeRoom([host]);
      expect(room.isListed()).toBe(false);
      expect(room.wantsJoinCode()).toBe(true);
      expect(room.joinCodeLength()).toBe(6);
      expect(room.getInfo().isPrivate).toBe(true);
    });

    it('are listed when the host creates them with isPrivate: false', async () => {
      const room = await makeRoom([host], { isPrivate: false });
      expect(room.isListed()).toBe(true);
      expect(room.getInfo().isPrivate).toBe(false);
    });

    it('refuse new players once the race has started (RACE_IN_PROGRESS)', async () => {
      const room = await makeRoom([host, p2]);
      setup(room, host);
      await expect(room.addPlayer(asClient(p3))).rejects.toMatchObject({ code: 'RACE_IN_PROGRESS' });
    });

    it('report ROOM_FULL with a code', async () => {
      const room = await makeRoom([host, p2], { maxPlayers: 2 });
      await expect(room.addPlayer(asClient(p3))).rejects.toMatchObject({ message: 'Room is full', code: 'ROOM_FULL' });
    });
  });

  describe('room_update', () => {
    const update = (metadata: unknown) => ({ type: 'room_update', payload: { metadata } });

    it('lets the host change settings in the lobby', async () => {
      const room = await makeRoom([host, p2], { metadata: { typingMode: 'classic' } });
      room.handleMessage(asClient(host), update({ length: 'long', difficulty: 'hard' }));

      const expected = { typingMode: 'classic', length: 'long', difficulty: 'hard' };
      expect(p2.last('room_updated').payload).toEqual({ metadata: expected });
      expect(room.getInfo().metadata).toEqual(expected);
    });

    it('refuses non-hosts (NOT_HOST) and mid-race changes (RACE_IN_PROGRESS)', async () => {
      const room = await makeRoom([host, p2]);
      room.handleMessage(asClient(p2), update({ length: 'long' }));
      expect(p2.last('error').payload.code).toBe('NOT_HOST');

      setup(room, host);
      room.handleMessage(asClient(host), update({ length: 'long' }));
      expect(host.last('error').payload.code).toBe('RACE_IN_PROGRESS');
      expect(p2.last('room_updated')).toBeUndefined();
    });

    it('refuses a missing or oversized metadata object (BAD_METADATA)', async () => {
      const room = await makeRoom([host, p2]);
      room.handleMessage(asClient(host), update(['not', 'an', 'object']));
      expect(host.last('error').payload.code).toBe('BAD_METADATA');
      room.handleMessage(asClient(host), update({ blob: 'x'.repeat(5000) }));
      expect(host.last('error').payload.code).toBe('BAD_METADATA');
    });
  });

  describe('rejoin hold (90 s)', () => {
    it('holds a dropped racer, then restores them with the same id and progress', async () => {
      const room = await makeRoom([host, p2]);
      setup(room, host);
      room.handleGameAction(asClient(p2), { action: 'progress', data: { position: 45, wpm: 40 } });
      const token = room.getRejoinToken(p2.id)!;
      expect(token).toMatch(/^[0-9a-f]{48}$/);

      await room.handleDisconnect(asClient(p2));
      expect(host.last('player_disconnected').payload).toEqual({ playerId: p2.id, holdMs: 90000 });
      expect(lastPlayers(host).find((p) => p.id === p2.id).connected).toBe(false);
      expect(host.last('player_left')).toBeUndefined();

      const p2Again = new FakeClient('c-2-new', p2.userId, 'Bob');
      room.rejoin(asClient(p2Again), token);

      expect(room.playerIdOf(asClient(p2Again))).toBe(p2.id);
      expect(host.last('player_reconnected').payload).toEqual({ playerId: p2.id });
      const restored = lastPlayers(host).find((p) => p.id === p2.id);
      expect(restored).toMatchObject({ position: 45, connected: true });

      // The new connection plays as the old player id.
      room.handleGameAction(asClient(p2Again), { action: 'progress', data: { position: 60 } });
      expect(lastPlayers(host).find((p) => p.id === p2.id).position).toBe(60);
    });

    it('refuses a rejoin token presented by a different user (BAD_REJOIN_TOKEN)', async () => {
      const room = await makeRoom([host, p2]);
      const token = room.getRejoinToken(p2.id)!;
      await room.handleDisconnect(asClient(p2));

      const intruder = new FakeClient('c-x', 'guest_someone-else', 'Eve');
      expect(() => room.rejoin(asClient(intruder), token)).toThrow(
        expect.objectContaining({ code: 'BAD_REJOIN_TOKEN' })
      );
      expect(() => room.rejoin(asClient(intruder), 'made-up')).toThrow(
        expect.objectContaining({ code: 'BAD_REJOIN_TOKEN' })
      );
    });

    it('replaces a connection that has not noticed it dropped yet', async () => {
      const room = await makeRoom([host, p2]);
      const p2Again = new FakeClient('c-2-new', p2.userId, 'Bob');
      room.rejoin(asClient(p2Again), room.getRejoinToken(p2.id));

      expect(p2.closed?.code).toBe(4001);
      expect(p2.currentRoomId).toBeUndefined();
      // The stale connection closing later must not remove the player.
      await room.handleDisconnect(asClient(p2));
      expect(room.getPlayer(p2.id)?.isConnected).toBe(true);
    });

    it('marks a racer who never comes back as DNF at their last position', async () => {
      jest.useFakeTimers();
      // Turbo Type's real setting: wait up to 3 minutes for everyone.
      const room = await makeRoom([host, p2], { finishGraceMs: 180000 });
      setup(room, host);
      room.handleGameAction(asClient(p2), { action: 'progress', data: { position: 30, wpm: 25 } });
      room.handleGameAction(asClient(host), { action: 'finish', data: { time: 20 } });

      await room.handleDisconnect(asClient(p2));
      jest.advanceTimersByTime(90000);
      await Promise.resolve();

      expect(host.last('player_left').payload).toEqual({ playerId: p2.id });
      const standings = host.last('game_end').payload.results.standings;
      expect(standings[1]).toMatchObject({ id: p2.id, place: 2, dnf: true });
    });

    it('an explicit leave (removePlayer) does not hold the seat', async () => {
      const room = await makeRoom([host, p2]);
      await room.removePlayer(p2.id);
      expect(host.last('player_left').payload).toEqual({ playerId: p2.id });
      expect(room.getRejoinToken(p2.id)).toBeUndefined();
    });
  });

  it('room_created/room_joined roster (getMemberInfo) exposes no userId or sessionId', async () => {
    const room = await makeRoom([host, p2]);
    const players = room.getMemberInfo().players as any[];
    expect(players).toHaveLength(2);
    for (const p of players) {
      expect(Object.keys(p).sort()).toEqual(['connected', 'data', 'id', 'isReady', 'joinedAt', 'username']);
    }
    expect(players[0].id).toBe(host.id);
  });
});
