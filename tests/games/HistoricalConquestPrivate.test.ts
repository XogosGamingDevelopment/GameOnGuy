/**
 * HistoricalConquestRelayRoom — Phase 18 (Oct 2026): private games with
 * 6-letter codes, playerData whitelist (uid/rating/wins/losses), roster,
 * targeted `to`, server-stamped sender id, and the 60 s rejoin hold.
 */

import { Message } from '../../src/core/types';
import { Client } from '../../src/core/Client';
import { HistoricalConquestRelayRoom } from '../../src/games/xogos/HistoricalConquestRelayRoom';

class FakeClient {
  public sent: Message[] = [];
  public currentRoomId?: string;
  public readonly sessionId: string;

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

  close(): void {}

  all(type: string): any[] {
    return this.sent.filter((m) => m.type === type);
  }

  last(type: string): any {
    const list = this.all(type);
    return list[list.length - 1];
  }
}

const asClient = (c: FakeClient) => c as unknown as Client;

describe('HistoricalConquestRelayRoom private games', () => {
  let a: FakeClient;
  let b: FakeClient;
  let c: FakeClient;

  beforeEach(() => {
    a = new FakeClient('c-a', 'guest_xogos-1', 'Ada');
    b = new FakeClient('c-b', 'guest_xogos-2', 'Ben');
    c = new FakeClient('c-c', 'guest_xogos-3', 'Cy');
  });

  afterEach(() => jest.useRealTimers());

  it('private rooms get a 6-letter code, are unlisted, and hide the room id in the name', () => {
    const room = new HistoricalConquestRelayRoom('historical_conquest', { isPrivate: true });
    expect(room.wantsJoinCode()).toBe(true);
    expect(room.joinCodeLength()).toBe(6);
    expect(room.isListed()).toBe(false);
    expect(room.name).toBe('Private game');
    expect(room.name).not.toContain(room.id.slice(0, 6));
  });

  it('public rooms (the Waiting Room) stay listed with their metadata and no code', () => {
    const room = new HistoricalConquestRelayRoom('historical_conquest', {
      isPrivate: false,
      metadata: { hcWaitingRoom: true },
    });
    expect(room.isListed()).toBe(true);
    expect(room.wantsJoinCode()).toBe(false);
    expect(room.getInfo().metadata).toEqual({ hcWaitingRoom: true });
  });

  it('carries exactly uid/rating/wins/losses as player data', async () => {
    const room = new HistoricalConquestRelayRoom('historical_conquest', { isPrivate: true });
    await room.addPlayer(asClient(a), undefined, {
      uid: 'xogos-123',
      rating: 1240.4,
      wins: 8,
      losses: 5,
      email: 'kid@example.com',
      school: 'Lincoln',
    });
    await room.addPlayer(asClient(b));

    const roster = room.getMemberInfo().players as any[];
    expect(roster[0]).toEqual({
      id: a.id,
      username: 'Ada',
      isReady: false,
      joinedAt: expect.any(Number),
      connected: true,
      data: { uid: 'xogos-123', rating: 1240, wins: 8, losses: 5 },
    });
    expect(roster[1].data).toEqual({});
    expect(a.last('player_joined').payload).not.toHaveProperty('userId');
    expect(a.last('player_joined').payload).not.toHaveProperty('sessionId');
  });

  it('accepts playerData on player_ready and broadcasts it', async () => {
    const room = new HistoricalConquestRelayRoom('historical_conquest', { isPrivate: true });
    await room.addPlayer(asClient(a));
    await room.addPlayer(asClient(b));
    room.setPlayerReady(b.id, true, { ready: true, playerData: { uid: 'xogos-9', rating: 900 } });
    expect(a.last('player_ready').payload).toEqual({
      playerId: b.id,
      ready: true,
      data: { uid: 'xogos-9', rating: 900 },
    });
  });

  it('stamps the sender id and supports a targeted `to`', async () => {
    const room = new HistoricalConquestRelayRoom('historical_conquest', { isPrivate: true });
    for (const x of [a, b, c]) await room.addPlayer(asClient(x));

    room.handleGameAction(asClient(a), { type: 'mp_input', data: { by: 'forged-id', action: { seq: 1 } } });
    expect(b.last('game_action').payload.playerId).toBe(a.id);
    expect(c.last('game_action').payload.playerId).toBe(a.id);

    room.handleGameAction(asClient(a), { type: 'mp_state', to: c.id, data: { g: { turn: 3 } } });
    expect(c.last('game_action').payload.type).toBe('mp_state');
    expect(b.last('game_action').payload.type).toBe('mp_input');
    expect(a.all('game_action')).toHaveLength(0);
  });

  it('holds a dropped seat for 60 s, then forfeits it with player_left', async () => {
    jest.useFakeTimers();
    const room = new HistoricalConquestRelayRoom('historical_conquest', { isPrivate: true });
    await room.addPlayer(asClient(a));
    await room.addPlayer(asClient(b));

    await room.handleDisconnect(asClient(b));
    expect(a.last('player_disconnected').payload).toEqual({ playerId: b.id, holdMs: 60000 });
    jest.advanceTimersByTime(59999);
    expect(a.last('player_left')).toBeUndefined();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(a.last('player_left').payload).toEqual({ playerId: b.id });
  });

  it('a rejoined player keeps their id; relays to and from them use it', async () => {
    const room = new HistoricalConquestRelayRoom('historical_conquest', { isPrivate: true });
    await room.addPlayer(asClient(a));
    await room.addPlayer(asClient(b));
    const token = room.getRejoinToken(b.id);
    await room.handleDisconnect(asClient(b));

    const b2 = new FakeClient('c-b-2', b.userId, 'Ben');
    room.rejoin(asClient(b2), token);
    expect(a.last('player_reconnected').payload).toEqual({ playerId: b.id });

    room.handleGameAction(asClient(a), { type: 'mp_state', to: b.id, data: { g: {} } });
    expect(b2.last('game_action').payload.type).toBe('mp_state');

    room.handleGameAction(asClient(b2), { type: 'mp_input', data: {} });
    expect(a.last('game_action').payload.playerId).toBe(b.id);
    expect(b2.all('game_action')).toHaveLength(1); // no self-echo
  });
});
