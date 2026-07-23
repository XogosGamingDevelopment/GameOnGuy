/**
 * Unit tests for HistoricalConquestRelayRoom (the "historical_conquest"
 * relay room for Historical Conquest: The Digital).
 *
 * Contract requested by Xogos Gaming (July 2026):
 *   - actions are relayed to everyone else in the room as soon as players
 *     are present (no game-start requirement, no setup phase)
 *   - NO turn gating — no "Not your turn" rejections, ever
 *   - the payload is relayed verbatim regardless of its shape
 *   - min 2 / max 4 players, no server-side bots
 */

import { Message } from '../../src/core/types';
import { Client } from '../../src/core/Client';
import { HistoricalConquestRelayRoom } from '../../src/games/xogos/HistoricalConquestRelayRoom';

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

  countOf(type: string): number {
    return this.sent.filter((m) => m.type === type).length;
  }
}

function asClient(c: FakeClient): Client {
  return c as unknown as Client;
}

async function makeRoom(
  clients: FakeClient[],
  options: Record<string, unknown> = {}
): Promise<HistoricalConquestRelayRoom> {
  const room = new HistoricalConquestRelayRoom('historical_conquest', {
    creatorId: clients[0]?.userId,
    ...options,
  });
  for (const c of clients) {
    await room.addPlayer(asClient(c));
  }
  return room;
}

describe('HistoricalConquestRelayRoom', () => {
  let p1: FakeClient;
  let p2: FakeClient;
  let p3: FakeClient;

  beforeEach(() => {
    p1 = new FakeClient('c-1', 'user-1', 'Alice');
    p2 = new FakeClient('c-2', 'user-2', 'Bob');
    p3 = new FakeClient('c-3', 'user-3', 'Carol');
  });

  it('relays an action to the other players as soon as players are present', async () => {
    const room = await makeRoom([p1, p2]);

    room.handleGameAction(asClient(p1), { type: 'play_card', data: { cardId: 42, row: 1 } });

    const relayed = p2.last('game_action');
    expect(relayed).toBeDefined();
    expect(relayed.payload.type).toBe('play_card');
    expect(relayed.payload.action).toBe('play_card');
    expect(relayed.payload.playerId).toBe(p1.id);
    expect(relayed.payload.username).toBe('Alice');
    expect(relayed.payload.data).toEqual({ cardId: 42, row: 1 });

    // No errors, no turn gating, no "Game not in progress".
    expect(p1.countOf('error')).toBe(0);
    expect(p1.countOf('action_rejected')).toBe(0);
  });

  it('does NOT echo the action back to the sender by default', async () => {
    const room = await makeRoom([p1, p2]);

    room.handleGameAction(asClient(p1), { type: 'play_card', data: {} });

    expect(p1.countOf('game_action')).toBe(0);
    expect(p2.countOf('game_action')).toBe(1);
  });

  it('echoes to the sender when echoToSender is enabled', async () => {
    const room = await makeRoom([p1, p2], { echoToSender: true });

    room.handleGameAction(asClient(p1), { type: 'play_card', data: {} });

    expect(p1.countOf('game_action')).toBe(1);
    expect(p2.countOf('game_action')).toBe(1);
  });

  it('accepts the action name under payload.action too', async () => {
    const room = await makeRoom([p1, p2]);

    room.handleGameAction(asClient(p1), { action: 'end_turn', data: { turn: 3 } });

    const relayed = p2.last('game_action');
    expect(relayed.payload.type).toBe('end_turn');
    expect(relayed.payload.action).toBe('end_turn');
    expect(relayed.payload.data).toEqual({ turn: 3 });
  });

  it('relays a flat payload (no nested data) verbatim as data', async () => {
    const room = await makeRoom([p1, p2]);

    room.handleGameAction(asClient(p1), { action: 'lhp', cardId: 'washington', slot: 2 });

    const relayed = p2.last('game_action');
    expect(relayed.payload.type).toBe('lhp');
    expect(relayed.payload.data).toEqual({ action: 'lhp', cardId: 'washington', slot: 2 });
  });

  it('relays even when no action name is present at all (pure relay)', async () => {
    const room = await makeRoom([p1, p2]);

    room.handleGameAction(asClient(p1), { anything: 'goes', nested: { deep: true } });

    const relayed = p2.last('game_action');
    expect(relayed).toBeDefined();
    expect(relayed.payload.type).toBeNull();
    expect(relayed.payload.data).toEqual({ anything: 'goes', nested: { deep: true } });
    expect(p1.countOf('error')).toBe(0);
  });

  it('relays to ALL other players in a 3-player room', async () => {
    const room = await makeRoom([p1, p2, p3]);

    room.handleGameAction(asClient(p2), { type: 'attack', data: { row: 0 } });

    expect(p1.countOf('game_action')).toBe(1);
    expect(p3.countOf('game_action')).toBe(1);
    expect(p2.countOf('game_action')).toBe(0);
    expect(p1.last('game_action').payload.playerId).toBe(p2.id);
  });

  it('never sends "Not your turn" — consecutive actions from the same player all relay', async () => {
    const room = await makeRoom([p1, p2]);

    room.handleGameAction(asClient(p1), { type: 'a1', data: {} });
    room.handleGameAction(asClient(p1), { type: 'a2', data: {} });
    room.handleGameAction(asClient(p2), { type: 'b1', data: {} });
    room.handleGameAction(asClient(p1), { type: 'a3', data: {} });

    expect(p2.countOf('game_action')).toBe(3);
    expect(p1.countOf('game_action')).toBe(1);
    expect(p1.countOf('action_rejected')).toBe(0);
    expect(p2.countOf('action_rejected')).toBe(0);
  });

  it('ignores actions from clients that are not in the room', async () => {
    const room = await makeRoom([p1, p2]);
    const outsider = new FakeClient('c-x', 'user-x', 'Mallory');

    room.handleGameAction(asClient(outsider), { type: 'play_card', data: {} });

    expect(p1.countOf('game_action')).toBe(0);
    expect(p2.countOf('game_action')).toBe(0);
  });

  it('defaults to min 2 / max 4 players', async () => {
    const room = await makeRoom([p1]);
    expect(room.getInfo().maxPlayers).toBe(4);
    // minPlayers isn't part of RoomInfo; verify via the start gate: a solo
    // room must not be startable.
    room.startGame();
    expect(p1.last('game_start')).toBeUndefined();
  });
});
