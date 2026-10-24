/**
 * Phase 18 smoke test — classroom features for Turbo Type (typing_race) and
 * Historical Conquest (historical_conquest), speaking their exact wire shapes.
 *
 *   node test-classroom-production.js
 *   GAMEON_URL=wss://test.multiplayer.gameonguy.com/ws node test-classroom-production.js
 *   GAMEON_URL=ws://localhost:3000/ws node test-classroom-production.js
 *
 * Checks: origin allow-list, hidden rooms + 6-letter codes, room_created /
 * room_joined playerId + roster + rejoinToken, carId everywhere, race_setup
 * extras, room_update, finish { dnf }, ROOM_FULL / RACE_IN_PROGRESS codes,
 * a real drop + rejoin with the same playerId, HC private games unlisted,
 * HC playerData whitelist, HC targeted `to`.
 */

const WebSocket = require('ws');

const SERVER_URL = process.env.GAMEON_URL || 'wss://multiplayer.gameonguy.com/ws';
const TURBO_ORIGIN = 'https://turbotype.myxogos.com';
const HC_ORIGIN = 'https://game.historicalconquest.org';
const RUN = Math.random().toString(36).slice(2, 8);

let failures = 0;
function check(ok, label) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

class Player {
  constructor(ws) {
    this.ws = ws;
    this.inbox = [];
    this.waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = this.waiters.findIndex((w) => w.type === msg.type);
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.inbox.push(msg);
    });
  }

  static async connect(origin, guestId, username) {
    const ws = new WebSocket(SERVER_URL, origin ? { origin } : {});
    const p = new Player(ws);
    p.clientId = (await p.next('welcome')).payload.clientId;
    p.send('auth', { username, guestId: `${guestId}-${RUN}` });
    await p.next('auth_success');
    return p;
  }

  send(type, payload = {}) {
    this.ws.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
  }

  next(type, ms = 8000) {
    const i = this.inbox.findIndex((m) => m.type === type);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), ms);
      this.waiters.push({ type, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }

  async until(type, predicate, ms = 8000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const m = await this.next(type, Math.max(1, deadline - Date.now()));
      if (predicate(m)) return m;
    }
  }

  close() {
    this.ws.close();
  }
}

async function turboType() {
  console.log('\n[Turbo Type / typing_race]');
  const outsider = await Player.connect(undefined, 'script', 'Mallory');
  outsider.send('room_create', { gameType: 'typing_race' });
  check((await outsider.next('room_error')).payload.code === 'ACCESS_DENIED', 'no Origin -> ACCESS_DENIED');
  outsider.close();

  const host = await Player.connect(TURBO_ORIGIN, 'xogos-t1', 'Alice');
  host.send('room_create', {
    gameType: 'typing_race',
    options: { maxPlayers: 3, finishGraceMs: 180000, metadata: { typingMode: 'classic' } },
  });
  const created = (await host.next('room_created')).payload;
  check(created.playerId === host.clientId, 'room_created.playerId = welcome.clientId');
  check(/^[BCDFGHJKLMNPQRSTVWXZ]{6}$/.test(created.joinCode || ''), `6-letter joinCode (${created.joinCode})`);
  check(typeof created.rejoinToken === 'string', 'room_created.rejoinToken present');
  check(Array.isArray(created.players) && created.players[0].id === host.clientId, 'room_created.players roster');

  const bob = await Player.connect(TURBO_ORIGIN, 'xogos-t2', 'Bob');
  bob.send('room_list', { gameType: 'typing_race' });
  const listed = (await bob.next('room_list')).payload.rooms.some((r) => r.id === created.id);
  check(!listed, 'classroom room hidden from room_list');

  bob.send('room_join', { joinCode: created.joinCode });
  const joined = (await bob.next('room_joined')).payload;
  check(joined.playerId === bob.clientId, 'room_joined.playerId');
  check(joined.room.players.length === 2 && joined.room.players[0].id === host.clientId, 'room_joined.room.players, host first');

  bob.send('player_ready', { ready: true, carId: 'apex-coupe-gs' });
  const ready = (await host.until('player_ready', (m) => m.payload.playerId === bob.clientId)).payload;
  check(ready.carId === 'apex-coupe-gs' && ready.data?.carId === 'apex-coupe-gs', 'player_ready carries carId');

  host.send('room_update', { metadata: { length: 'short', difficulty: 'easy' } });
  const updated = (await bob.next('room_updated')).payload.metadata;
  check(updated.typingMode === 'classic' && updated.length === 'short', 'room_update -> room_updated (merged)');
  bob.send('room_update', { metadata: { length: 'long' } });
  check((await bob.next('error')).payload.code === 'NOT_HOST', 'room_update from non-host -> NOT_HOST');

  host.send('game_action', {
    action: 'race_setup',
    data: { text: 'classroom race', startAt: Date.now() + 500, typingMode: 'classic', cars: { [bob.clientId]: 'apex-coupe-gs' } },
  });
  const setupState = (await bob.until('state_update', (m) => m.payload.state.status === 'racing')).payload.state;
  check(setupState.typingMode === 'classic' && setupState.cars?.[bob.clientId] === 'apex-coupe-gs', 'race_setup extras relayed');
  check(setupState.players.find((p) => p.id === bob.clientId)?.data?.carId === 'apex-coupe-gs', 'state_update players carry carId');

  const late = await Player.connect(TURBO_ORIGIN, 'xogos-t3', 'Cy');
  late.send('room_join', { joinCode: created.joinCode });
  check((await late.next('room_error')).payload.code === 'RACE_IN_PROGRESS', 'late joiner -> RACE_IN_PROGRESS');
  late.close();

  bob.send('game_action', { action: 'progress', data: { position: 40, wpm: 35, accuracy: 98, carId: 'apex-coupe-gs' } });
  await host.until('state_update', (m) => m.payload.state.players.find((p) => p.id === bob.clientId)?.position === 40);

  bob.ws.terminate();
  const dropped = (await host.next('player_disconnected', 15000)).payload;
  check(dropped.playerId === bob.clientId && dropped.holdMs === 90000, 'drop -> player_disconnected (90 s hold)');

  const bobAgain = await Player.connect(TURBO_ORIGIN, 'xogos-t2', 'Bob');
  bobAgain.send('room_join', { roomId: created.id, rejoinToken: joined.rejoinToken });
  const back = (await bobAgain.next('room_joined')).payload;
  check(back.rejoined === true && back.playerId === bob.clientId, 'rejoin keeps the same playerId');
  check(back.state.players[bob.clientId]?.position === 40, 'rejoin keeps progress');
  check((await host.next('player_reconnected')).payload.playerId === bob.clientId, 'host sees player_reconnected');

  bobAgain.send('game_action', { action: 'finish', data: { time: 15.5, wpm: 36, accuracy: 98 } });
  host.send('game_action', { action: 'finish', data: { time: -1, dnf: true, position: 22, wpm: 20, accuracy: 90 } });
  const standings = (await host.next('game_end')).payload.results.standings;
  check(standings[0].id === bob.clientId && !standings[0].dnf, 'finisher ranked first');
  check(standings[1].id === host.clientId && standings[1].dnf === true, 'DNF ranked after finishers');

  const full = await Player.connect(TURBO_ORIGIN, 'xogos-t4', 'Dee');
  full.send('room_create', { gameType: 'typing_race', options: { maxPlayers: 2 } });
  const small = (await full.next('room_created')).payload;
  const f2 = await Player.connect(TURBO_ORIGIN, 'xogos-t5', 'Eli');
  const f3 = await Player.connect(TURBO_ORIGIN, 'xogos-t6', 'Fay');
  f2.send('room_join', { joinCode: small.joinCode });
  await f2.next('room_joined');
  f3.send('room_join', { joinCode: small.joinCode });
  const fullErr = (await f3.next('room_error')).payload;
  check(fullErr.code === 'ROOM_FULL' && fullErr.message === 'Room is full', 'ROOM_FULL code');

  for (const p of [host, bobAgain, full, f2, f3]) p.close();
}

async function historicalConquest() {
  console.log('\n[Historical Conquest / historical_conquest]');
  const ada = await Player.connect(HC_ORIGIN, 'xogos-h1', 'Ada');
  ada.send('room_create', { gameType: 'historical_conquest', options: { isPrivate: true, maxPlayers: 2 }, playerData: { uid: 'xogos-h1', rating: 1200, wins: 3, losses: 1, email: 'x' } });
  const created = (await ada.next('room_created')).payload;
  check(/^[A-Z]{6}$/.test(created.joinCode || ''), `private game gets a 6-letter code (${created.joinCode})`);
  check(created.name === 'Private game', 'private game name hides the room id');

  const ben = await Player.connect(HC_ORIGIN, 'xogos-h2', 'Ben');
  ben.send('room_list', { gameType: 'historical_conquest' });
  check(!(await ben.next('room_list')).payload.rooms.some((r) => r.id === created.id), 'private game not in room_list');

  ben.send('room_join', { roomId: created.id, playerData: { uid: 'xogos-h2', rating: 950 } });
  const joined = (await ben.next('room_joined')).payload;
  const adaSeen = joined.room.players.find((p) => p.id === ada.clientId);
  check(JSON.stringify(adaSeen?.data) === JSON.stringify({ uid: 'xogos-h1', rating: 1200, wins: 3, losses: 1 }), 'playerData whitelist (email dropped)');
  check(!('userId' in (adaSeen || {})), 'roster has no userId');

  ada.send('game_action', { type: 'mp_input', data: { by: 'forged', action: { seq: 1, fn: 'endTurn', args: [] } } });
  check((await ben.next('game_action')).payload.playerId === ada.clientId, 'relay stamps the real sender id');

  ada.send('game_action', { type: 'mp_state', to: ben.clientId, data: { g: { turn: 1 } } });
  check((await ben.next('game_action')).payload.type === 'mp_state', 'targeted `to` reaches that player');

  ada.close();
  ben.close();
}

(async () => {
  console.log(`Classroom smoke test against ${SERVER_URL}`);
  try {
    await turboType();
    await historicalConquest();
  } catch (error) {
    console.log(`  FAIL  ${error.message}`);
    failures++;
  }
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
