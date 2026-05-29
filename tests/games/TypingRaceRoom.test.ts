/**
 * Unit tests for TypingRaceRoom (the "typing_race" relay room).
 *
 * These verify the contract requested by the Turbo Type team:
 *   - race actions are accepted without a "Game not in progress" error
 *   - progress/setup are relayed to all players via state_update
 *   - finish ranks players by finish order
 *   - game_end is broadcast with standings (all-finished or first-finish+grace)
 */

import { Message } from '../../src/core/types';
import { Client } from '../../src/core/Client';
import { TypingRaceRoom } from '../../src/games/xogos/TypingRaceRoom';

// ----------------------------------------------------------------------------
// Test double for Client (no real WebSocket)
// ----------------------------------------------------------------------------

class FakeClient {
  public readonly id: string;
  public readonly sessionId: string;
  public userId: string;
  public username: string;
  public currentRoomId?: string;
  public sent: Message[] = [];

  constructor(id: string, userId: string, username: string) {
    this.id = id;
    this.sessionId = `sess-${id}`;
    this.userId = userId;
    this.username = username;
  }

  send(message: Message): void {
    this.sent.push(message);
  }

  setRoom(roomId: string | undefined): void {
    this.currentRoomId = roomId;
  }

  /** Most recent message of a given type, or undefined. */
  last(type: string): any {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i].type === type) return this.sent[i];
    }
    return undefined;
  }

  countOf(type: string): number {
    return this.sent.filter((m) => m.type === type).length;
  }
}

function asClient(c: FakeClient): Client {
  return c as unknown as Client;
}

function gameAction(type: string, data: unknown) {
  return { type, data };
}

async function makeRoom(
  clients: FakeClient[],
  options: Record<string, unknown> = {}
): Promise<TypingRaceRoom> {
  const room = new TypingRaceRoom('typing_race', {
    creatorId: clients[0]?.userId,
    minPlayers: 1,
    ...options,
  });
  for (const c of clients) {
    await room.addPlayer(asClient(c));
  }
  return room;
}

describe('TypingRaceRoom', () => {
  let host: FakeClient;
  let p2: FakeClient;
  let p3: FakeClient;

  beforeEach(() => {
    host = new FakeClient('c-host', 'host-user', 'Alice');
    p2 = new FakeClient('c-2', 'user-2', 'Bob');
    p3 = new FakeClient('c-3', 'user-3', 'Carol');
  });

  describe('relay / acceptance', () => {
    it('accepts progress without a "Game not in progress" error', async () => {
      const room = await makeRoom([host, p2]);

      room.handleGameAction(asClient(host), gameAction('race_setup', { text: 'hello world', startAt: 1000 }));
      room.handleGameAction(asClient(p2), gameAction('progress', { position: 40, wpm: 55, accuracy: 98 }));

      // No error messages should have been sent to anyone.
      expect(host.countOf('error')).toBe(0);
      expect(p2.countOf('error')).toBe(0);
    });

    it('relays race_setup (text + startAt) to all players via state_update', async () => {
      const room = await makeRoom([host, p2]);

      room.handleGameAction(asClient(host), gameAction('race_setup', { text: 'the quick brown fox', startAt: 123456 }));

      for (const c of [host, p2]) {
        const update = c.last('state_update');
        expect(update).toBeDefined();
        expect(update.payload.state.status).toBe('racing');
        expect(update.payload.state.text).toBe('the quick brown fox');
        expect(update.payload.state.startAt).toBe(123456);
        expect(update.payload.state.players).toHaveLength(2);
      }
    });

    it('relays progress updates to peers with the sender reflected in state', async () => {
      const room = await makeRoom([host, p2]);
      room.handleGameAction(asClient(host), gameAction('race_setup', { text: 'race text', startAt: 1 }));

      room.handleGameAction(asClient(p2), gameAction('progress', { position: 72, wpm: 61, accuracy: 95 }));

      const update = host.last('state_update');
      const bob = update.payload.state.players.find((pl: any) => pl.id === p2.id);
      expect(bob.position).toBe(72);
      expect(bob.wpm).toBe(61);
      expect(bob.accuracy).toBe(95);
    });

    it('clamps position/accuracy to 0-100 and rejects non-numbers', async () => {
      const room = await makeRoom([host, p2]);
      room.handleGameAction(asClient(host), gameAction('race_setup', { text: 'race text', startAt: 1 }));

      room.handleGameAction(asClient(p2), gameAction('progress', { position: 250, wpm: -5, accuracy: 'bad' as any }));

      const bob = host.last('state_update').payload.state.players.find((pl: any) => pl.id === p2.id);
      expect(bob.position).toBe(100); // clamped
      expect(bob.wpm).toBe(0); // negative -> 0
      expect(bob.accuracy).toBe(100); // invalid -> kept default (100)
    });

    it('ignores race_setup from a non-host', async () => {
      const room = await makeRoom([host, p2]);

      room.handleGameAction(asClient(p2), gameAction('race_setup', { text: 'sneaky', startAt: 1 }));

      // Status should remain waiting; no racing setup applied.
      const update = host.last('state_update');
      expect(update.payload.state.status).toBe('waiting');
    });
  });

  describe('finish ordering + game_end', () => {
    it('ranks players by finish order and ends when all finish', async () => {
      const room = await makeRoom([host, p2]);
      room.handleGameAction(asClient(host), gameAction('race_setup', { text: 'race text', startAt: 1 }));

      // Bob finishes first, Alice second.
      room.handleGameAction(asClient(p2), gameAction('finish', { time: 12.5, wpm: 70, accuracy: 99 }));
      room.handleGameAction(asClient(host), gameAction('finish', { time: 15.0, wpm: 60, accuracy: 97 }));

      const end = host.last('game_end');
      expect(end).toBeDefined();
      const standings = end.payload.results.standings;
      expect(standings).toHaveLength(2);
      expect(standings[0]).toMatchObject({ id: p2.id, place: 1, wpm: 70, accuracy: 99, time: 12.5 });
      expect(standings[1]).toMatchObject({ id: host.id, place: 2, time: 15.0 });
    });

    it('ends after a grace period when not everyone finishes', async () => {
      jest.useFakeTimers();
      try {
        const room = await makeRoom([host, p2, p3], { finishGraceMs: 5000 });
        room.handleGameAction(asClient(host), gameAction('race_setup', { text: 'race text', startAt: 1 }));

        // Only Alice (host) finishes; the others are partway.
        room.handleGameAction(asClient(p2), gameAction('progress', { position: 80, wpm: 50, accuracy: 90 }));
        room.handleGameAction(asClient(p3), gameAction('progress', { position: 30, wpm: 40, accuracy: 88 }));
        room.handleGameAction(asClient(host), gameAction('finish', { time: 10, wpm: 65, accuracy: 96 }));

        // No game_end yet — grace window is open.
        expect(host.last('game_end')).toBeUndefined();

        jest.advanceTimersByTime(5000);

        const standings = host.last('game_end').payload.results.standings;
        expect(standings[0].id).toBe(host.id); // finisher first
        expect(standings[0].place).toBe(1);
        // Non-finishers ranked by position desc: Bob (80) before Carol (30).
        expect(standings[1].id).toBe(p2.id);
        expect(standings[1].finished).toBe(false);
        expect(standings[2].id).toBe(p3.id);
      } finally {
        jest.useRealTimers();
      }
    });

    it('ignores duplicate finish from the same player', async () => {
      const room = await makeRoom([host, p2], { finishGraceMs: 60000 });
      room.handleGameAction(asClient(host), gameAction('race_setup', { text: 'race text', startAt: 1 }));

      room.handleGameAction(asClient(p2), gameAction('finish', { time: 9, wpm: 80, accuracy: 100 }));
      // Duplicate finish should not bump anyone's place.
      room.handleGameAction(asClient(p2), gameAction('finish', { time: 1, wpm: 999, accuracy: 100 }));
      room.handleGameAction(asClient(host), gameAction('finish', { time: 11, wpm: 70, accuracy: 98 }));

      const standings = host.last('game_end').payload.results.standings;
      expect(standings[0]).toMatchObject({ id: p2.id, place: 1, wpm: 80 });
      expect(standings[1]).toMatchObject({ id: host.id, place: 2 });
    });

    it('supports a rematch: a fresh race_setup resets progress', async () => {
      const room = await makeRoom([host, p2]);
      room.handleGameAction(asClient(host), gameAction('race_setup', { text: 'first', startAt: 1 }));
      room.handleGameAction(asClient(p2), gameAction('finish', { time: 5, wpm: 90, accuracy: 100 }));
      room.handleGameAction(asClient(host), gameAction('finish', { time: 6, wpm: 80, accuracy: 100 }));
      expect(host.last('game_end')).toBeDefined();

      // Rematch.
      room.handleGameAction(asClient(host), gameAction('race_setup', { text: 'second', startAt: 999 }));
      const update = host.last('state_update');
      expect(update.payload.state.status).toBe('racing');
      expect(update.payload.state.text).toBe('second');
      expect(update.payload.state.players.every((pl: any) => pl.position === 0 && !pl.finished)).toBe(true);
    });
  });
});
