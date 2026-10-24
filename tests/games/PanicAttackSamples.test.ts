/**
 * Replays Panic Attack's own captured wire frames (58 real frames from their
 * 3-browser test, Oct 15 2026 — tests/fixtures/panic-attack-message-samples.json)
 * through PanicAttackRoom and checks that what the server delivers matches what
 * their client actually received. Phase 12 lesson: verify the integrator's
 * exact shapes, not our idea of them.
 *
 * Uses the captured connection ids so payload.to and setup.assign work verbatim.
 */

import { Message } from '../../src/core/types';
import { Client } from '../../src/core/Client';
import { PanicAttackRoom } from '../../src/games/xogos/PanicAttackRoom';
import { RoomManager } from '../../src/rooms/RoomManager';
import fixture from '../fixtures/panic-attack-message-samples.json';

const samples = fixture.samples as Record<string, any>;

class FakeClient {
  public readonly sessionId: string;
  public currentRoomId?: string;
  public sent: Message[] = [];
  public metadata: Record<string, unknown> = {};
  constructor(public readonly id: string, public userId: string, public username: string) {
    this.sessionId = `sess-${id}`;
  }
  send(m: Message) {
    this.sent.push(m);
  }
  sendError(message: string, code?: string) {
    this.sent.push({ type: 'error', payload: { message, code } });
  }
  setRoom(id: string | undefined) {
    this.currentRoomId = id;
  }
  actions(name: string) {
    return this.sent.filter((m) => m.type === 'game_action' && (m.payload as any).type === name);
  }
}
const asClient = (c: FakeClient) => c as unknown as Client;
const keys = (o: object) => Object.keys(o).sort();
const withoutTime = ({ timestamp, ...rest }: any) => rest;

const HOST_ID = samples['host received room_created'].payload.hostId;
const players = samples['guest received room_joined'].payload.state.players as Array<{ id: string; name: string }>;
const thirdId = samples['guest received player_joined'].payload.id;

describe("Panic Attack's captured samples", () => {
  let room: PanicAttackRoom;
  let clients: Map<string, FakeClient>;
  const all = () => Array.from(clients.values());

  beforeEach(async () => {
    room = new PanicAttackRoom('panic_attack_test', samples['host sent room_create'].payload.options);
    clients = new Map();
    for (const [id, name] of [
      [HOST_ID, players[0].name],
      [players[1].id, players[1].name],
      [thirdId, samples['guest received player_joined'].payload.name],
    ]) {
      const c = new FakeClient(id, `guest_${id}`, name);
      clients.set(id, c);
      await room.addPlayer(asClient(c));
    }
  });

  it('room_created / room_joined / player_joined carry exactly the captured fields', async () => {
    const rm = new RoomManager({});
    rm.registerGame('panic_attack_test', PanicAttackRoom as any, {
      name: 'Panic Attack (test)', minPlayers: 2, maxPlayers: 6, defaultTickRate: 1,
    });
    const r = await rm.createRoom('panic_attack_test', samples['host sent room_create'].payload.options);
    const h = new FakeClient('h', 'u', 'Kid501');
    await r.addPlayer(asClient(h));
    const info = JSON.parse(JSON.stringify(r.getInfo())); // drop undefined like the wire does

    expect(keys(info)).toEqual(keys(samples['host received room_created'].payload));
    expect(info.maxPlayers).toBe(6);
    expect(keys(room.getState())).toEqual(keys(samples['guest received room_joined'].payload.state));
    expect(room.getState().players).toEqual(players.concat([{ id: thirdId, name: 'Kid503', isHost: false } as any]));
    expect(keys(samples['host received player_joined'].payload)).toEqual(['id', 'isHost', 'name']);
  });

  // Every game_action the host or a guest sent, replayed verbatim.
  const sent = Object.keys(samples).filter((k) => / sent game_action:/.test(k));

  it.each(sent)('%s', (key) => {
    const frame = samples[key];
    const name = frame.payload.type as string;
    const fromHost = key.startsWith('host');
    const receivedKey = fromHost ? `guest received game_action:${name}` : `host received game_action:${name}`;
    const captured = samples[receivedKey]?.payload;
    const senderId = fromHost ? HOST_ID : captured.playerId;
    const sender = clients.get(senderId)!;

    if (name === 'end') room.handleGameAction(asClient(clients.get(HOST_ID)!), { type: 'start', data: {} });
    all().forEach((c) => (c.sent = []));
    room.handleGameAction(asClient(sender), frame.payload);

    const to = frame.payload.to as string | undefined;
    const expectedRecipients =
      name === 'chat' ? all().map((c) => c.id)
      : !fromHost ? [HOST_ID]
      : to ? [to]
      : all().map((c) => c.id).filter((id) => id !== HOST_ID);

    for (const c of all()) {
      const got = c.actions(name);
      if (!expectedRecipients.includes(c.id)) {
        expect(got).toHaveLength(0);
        continue;
      }
      expect(got).toHaveLength(1);
      // Compare the JSON wire form (undefined fields are dropped, as on the socket)
      const payload = JSON.parse(JSON.stringify(got[0].payload));
      // Delivered = exactly what they sent, wrapped the way their client received it.
      expect(payload.data).toEqual(frame.payload.data);
      expect(payload).toMatchObject({ type: name, action: name, playerId: senderId, fromHost });
      if (captured) {
        expect(keys(payload)).toEqual(keys(captured));
        // Same data for frames that weren't per-player (to-one frames differ by recipient)
        if (!to) expect(withoutTime(payload)).toEqual(withoutTime(captured));
      }
    }
    expect(sender.sent.filter((m) => m.type === 'error')).toHaveLength(0);
  });

  it('host room_leave -> guests get player_left then room_closed host_left', async () => {
    const guest = clients.get(players[1].id)!;
    await room.removePlayer(HOST_ID);
    const types = guest.sent.map((m) => m.type);
    expect(types.slice(-2)).toEqual(['player_left', 'room_closed']);
    expect(guest.sent[guest.sent.length - 2].payload).toEqual(samples['guest received player_left'].payload);
    expect(guest.sent[guest.sent.length - 1].payload).toEqual(samples['guest received room_closed'].payload);
  });
});
