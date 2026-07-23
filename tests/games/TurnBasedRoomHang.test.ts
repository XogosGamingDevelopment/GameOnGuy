/**
 * Regression tests for the 2026-07-21 production outage.
 *
 * A historical_conquest (TurnBasedRoom) game started, and BOTH players
 * disconnected during the 30-second setup phase. The game ended via the
 * win-condition/min-players checks, but the pending setup-phase setTimeout
 * was never cancelled. When it fired it called beginGame() -> startTurn(),
 * and startTurn()'s "skip eliminated players" while-loop spun forever
 * because every player in the turn order was eliminated. The blocked event
 * loop took the whole server down (continuous 504s) until manual restart.
 *
 * These tests HANG (then time out) on the pre-fix code and pass on the fix.
 */

import { Message, RoomState } from '../../src/core/types';
import { Client } from '../../src/core/Client';
import { TurnBasedRoom } from '../../src/games/TurnBasedRoom';

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

  sendError(message: string, code?: string): void {
    this.sent.push({ type: 'error', payload: { message, code } });
  }

  setRoom(roomId: string | undefined): void {
    this.currentRoomId = roomId;
  }

  last(type: string): any {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i].type === type) return this.sent[i];
    }
    return undefined;
  }
}

function asClient(c: FakeClient): Client {
  return c as unknown as Client;
}

describe('TurnBasedRoom pending-timer hangs (2026-07-21 outage regression)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not hang when all players leave during the setup phase', async () => {
    const room = new TurnBasedRoom('historical_conquest', {
      minPlayers: 2,
      maxPlayers: 4,
      setupPhaseTime: 30000,
      autoDispose: false,
    });

    const p1 = new FakeClient('c-1', 'u-1', 'Alice');
    const p2 = new FakeClient('c-2', 'u-2', 'Bob');
    await room.addPlayer(asClient(p1));
    await room.addPlayer(asClient(p2));

    room.startGame();
    expect(room.currentState).toBe(RoomState.IN_PROGRESS);
    expect(p1.last('setup_phase')).toBeDefined();

    // Both players bail out mid-setup (exactly what happened in production).
    await room.removePlayer(p1.id);
    await room.removePlayer(p2.id);

    expect(room.currentState).toBe(RoomState.FINISHED);

    // Pre-fix: the setup timer fires here, startTurn() spins forever, and
    // this call never returns. Post-fix: the timer was cancelled (and the
    // guards would stop startTurn even if it hadn't been).
    jest.advanceTimersByTime(60000);

    expect(room.currentState).toBe(RoomState.FINISHED);
    room.dispose();
  });

  it('does not hang when all players leave during the between-turns pause', async () => {
    const room = new TurnBasedRoom('test_game', {
      minPlayers: 2,
      maxPlayers: 4,
      setupPhaseTime: 0,
      turnTimeLimit: 90000,
      autoDispose: false,
    });

    const p1 = new FakeClient('c-1', 'u-1', 'Alice');
    const p2 = new FakeClient('c-2', 'u-2', 'Bob');
    await room.addPlayer(asClient(p1));
    await room.addPlayer(asClient(p2));

    room.startGame();

    // Whoever's turn it is ends it, putting the room into the 1s
    // between-turns pause with a pending startTurn timeout.
    const currentId = p1.last('turn_start').payload.playerId;
    const current = currentId === p1.id ? p1 : p2;
    room.handleGameAction(asClient(current), { type: 'end_turn' } as any);

    // Both players leave before the pause elapses.
    await room.removePlayer(p1.id);
    await room.removePlayer(p2.id);

    // Pre-fix: the between-turns timer fires startTurn() with everyone
    // eliminated and spins forever.
    jest.advanceTimersByTime(10000);

    expect(room.currentState).toBe(RoomState.FINISHED);
    room.dispose();
  });

  it('turn timeouts still rotate turns for a healthy game', async () => {
    const room = new TurnBasedRoom('test_game', {
      minPlayers: 2,
      maxPlayers: 4,
      setupPhaseTime: 0,
      turnTimeLimit: 5000,
      autoDispose: false,
    });

    const p1 = new FakeClient('c-1', 'u-1', 'Alice');
    const p2 = new FakeClient('c-2', 'u-2', 'Bob');
    await room.addPlayer(asClient(p1));
    await room.addPlayer(asClient(p2));

    room.startGame();
    const firstTurn = p1.last('turn_start').payload.playerId;

    // Let the first turn time out and the between-turns pause elapse.
    jest.advanceTimersByTime(5000 + 1500);

    const secondTurn = p1.last('turn_start').payload.playerId;
    expect(secondTurn).not.toBe(firstTurn);
    expect(room.currentState).toBe(RoomState.IN_PROGRESS);
    room.dispose();
  });
});
