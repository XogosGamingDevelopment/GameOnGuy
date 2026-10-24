/**
 * End-to-end check of the panic_attack room type, speaking Panic Attack's
 * exact wire shapes from their Oct 2026 letter (game_action with the name in
 * payload.type and fields in payload.data; payload.to for host -> one player).
 *
 * Verifies:
 *   - guests cannot play panic_attack (game token required); wrong Origin refused
 *   - private room: 5-letter joinCode, hostId, never in room_list, join by code
 *   - guest -> host only (incl. forged payload.to); host -> all; host -> one (payload.to)
 *   - server-checked quick-chat: whitelist, stripped fields, 1.2 s limit
 *   - "start" locks the room; "end" unlocks it
 *   - real message rates (host 12.5 snap/s + 3 you/s, guests 15 in/s) are not throttled
 *   - host leaving closes the room for everyone ("host_left")
 *   - Quick Match: 20 s countdown after the 2nd player, auto-joined, no names, no chat
 *   - (Oct 21 2026) 7-player rooms, 8th refused; Hidden Worries Huddle phrases;
 *     two full private rooms at once stay separate; Quick Match fills to 7
 *
 * Run:
 *   node test-panic-attack-production.js                          (prod, panic_attack_test)
 *   GAMEON_URL=ws://localhost:3000/ws node test-panic-attack-production.js
 *   PANIC_ATTACK_TOKEN_SECRET=... GAME_TYPE=panic_attack node test-panic-attack-production.js
 *       (signs player tokens like Panic Attack's backend would)
 */

const WebSocket = require('ws');

const SERVER_URL = process.env.GAMEON_URL || 'wss://multiplayer.gameonguy.com/ws';
const GAME_TYPE = process.env.GAME_TYPE || 'panic_attack_test';
const SECRET = process.env.PANIC_ATTACK_TOKEN_SECRET;
const ORIGIN =
  process.env.ORIGIN || (GAME_TYPE === 'panic_attack' ? 'https://panicattack.myxogos.com' : 'http://localhost:5173');
const TIMEOUT_MS = 30000;

if (GAME_TYPE === 'panic_attack' && !SECRET) {
  console.error('GAME_TYPE=panic_attack needs PANIC_ATTACK_TOKEN_SECRET to sign player tokens');
  process.exit(2);
}

let failures = 0;
function check(cond, label) {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}`);
  if (!cond) failures++;
}

function tokenFor(name) {
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { sub: `smoke-${name}-${Date.now()}`, name: `${name} Testperson`, game: 'panic_attack' },
    SECRET,
    { audience: 'gameondude', expiresIn: '5m' }
  );
}

function connect(name, { origin = ORIGIN, guest = !SECRET } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL, { headers: { Origin: origin } });
    const log = [];
    const waiters = [];
    let id = null;

    const api = {
      name,
      ws,
      log,
      get id() {
        return id;
      },
      send: (type, payload) => ws.send(JSON.stringify({ type, payload })),
      act: (payload) => ws.send(JSON.stringify({ type: 'game_action', payload })),
      all: (type, pred = () => true) => log.filter((m) => m.type === type && pred(m.payload)),
      waitFor(type, pred = () => true, ms = TIMEOUT_MS) {
        const hit = log.find((m) => !m.seen && m.type === type && pred(m.payload));
        if (hit) {
          hit.seen = true;
          return Promise.resolve(hit.payload);
        }
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`${name}: timed out waiting for ${type}`)), ms);
          waiters.push((m) => {
            if (m.type !== type || !pred(m.payload)) return false;
            clearTimeout(timer);
            m.seen = true;
            res(m.payload);
            return true;
          });
        });
      },
      close: () => ws.close(),
    };

    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      log.push(m);
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i](m)) {
          waiters.splice(i, 1);
          break;
        }
      }
      if (m.type === 'welcome') {
        id = m.payload.clientId;
        ws.send(
          JSON.stringify({
            type: 'auth',
            payload: guest ? { username: name, guestId: `smoke-${name}` } : { token: tokenFor(name) },
          })
        );
      }
      if (m.type === 'auth_success') resolve(api);
      if (m.type === 'auth_failure') reject(new Error(`${name}: auth_failure ${m.payload.message}`));
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error(`${name}: connect timeout`)), TIMEOUT_MS);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Server: ${SERVER_URL}  gameType: ${GAME_TYPE}  Origin: ${ORIGIN}\n`);

  // ---- Access rules -------------------------------------------------------
  console.log('Access rules');
  const outsider = await connect('Outsider', { origin: 'https://evil.example.com', guest: true });
  outsider.send('room_create', { gameType: GAME_TYPE });
  check(/own website/.test((await outsider.waitFor('room_error')).message), 'wrong Origin is refused');
  outsider.close();

  const guest = await connect('Guesty', { origin: 'https://panicattack.myxogos.com', guest: true });
  guest.send('room_create', { gameType: 'panic_attack' });
  check(/sign in through the game/.test((await guest.waitFor('room_error')).message), 'guest sign-in refused for panic_attack');
  guest.send('matchmake_request', { gameType: 'panic_attack', gameMode: 'classic' });
  check(/sign in through the game/.test((await guest.waitFor('error')).message), 'guest refused for panic_attack Quick Match');
  guest.close();

  // ---- Private room -------------------------------------------------------
  console.log('\nPrivate room');
  const host = await connect('Ana');
  const b = await connect('Ben');
  const c = await connect('Cy');

  host.send('room_create', { gameType: GAME_TYPE, options: { gameMode: 'hidden' } });
  const created = await host.waitFor('room_created');
  check(/^[BCDFGHJKLMNPQRSTVWXZ]{5}$/.test(created.joinCode), `room_created has 5-letter joinCode (${created.joinCode})`);
  check(created.hostId === host.id, 'room_created.hostId is the creator');
  check(created.gameMode === 'hidden', 'gameMode carried');

  b.send('room_list', { gameType: GAME_TYPE });
  const list = await b.waitFor('room_list');
  check(!list.rooms.some((r) => r.id === created.id), 'private room is NOT in room_list');

  b.send('room_join', { joinCode: 'ZZZZZ' });
  check((await b.waitFor('room_error')).message === 'Room not found', 'wrong code -> Room not found');

  b.send('room_join', { joinCode: created.joinCode.toLowerCase() });
  const bJoined = await b.waitFor('room_joined');
  check(bJoined.state.hostId === host.id, 'room_joined.state.hostId is the host');
  check(bJoined.state.players.length === 2 && bJoined.state.players[0].name === 'Ana', 'roster has first names in private rooms');
  check(!('userId' in bJoined.state.players[0]), 'roster does not expose userId');
  const joinedEvt = await host.waitFor('player_joined');
  check(joinedEvt.id === b.id && !('userId' in joinedEvt) && !('sessionId' in joinedEvt), 'player_joined hides userId/sessionId');

  c.send('room_join', { joinCode: created.joinCode });
  await c.waitFor('room_joined');
  await host.waitFor('player_joined', (p) => p.id === c.id);

  // ---- Routing ------------------------------------------------------------
  console.log('\nRouting');
  b.act({ type: 'feeling', data: { f: 'blue' } });
  const feel = await host.waitFor('game_action', (p) => p.type === 'feeling');
  check(feel.playerId === b.id && feel.data.f === 'blue' && feel.fromHost === false, 'guest lobby pick reaches host');

  host.act({
    type: 'start',
    data: { setup: { seed: 42, map: 0, mode: 'hidden', rulesLevel: 1, twist: null, outageAt: null,
      assign: { [host.id]: 0, [b.id]: 1, [c.id]: 2 }, names: null, kind: 'private', hostId: host.id } },
  });
  const startB = await b.waitFor('game_action', (p) => p.type === 'start');
  await c.waitFor('game_action', (p) => p.type === 'start');
  check(startB.fromHost === true && startB.data.setup.seed === 42, 'host start reaches every guest');

  host.act({ type: 'secret', to: c.id, data: { role: 'worry', mission: 3 } });
  const secret = await c.waitFor('game_action', (p) => p.type === 'secret');
  check(secret.data.role === 'worry', 'host -> one player (payload.to) delivered');

  b.act({ type: 'in', data: { x: 1.5, z: -2, r: 0.3, b: 0, mv: 1 } });
  const input = await host.waitFor('game_action', (p) => p.type === 'in');
  check(input.playerId === b.id && input.data.x === 1.5, 'guest input reaches host');

  b.act({ type: 'snap', to: c.id, data: { forged: true } });
  await host.waitFor('game_action', (p) => p.type === 'snap' && p.data.forged);

  for (const [type, data] of [
    ['act', { a: 'huddle' }],
    ['station', { idx: 4 }],
    ['huddle_say', { card: 'c7' }],
    ['huddle_vote', { v: 'skip' }],
  ]) {
    b.act({ type, data });
    const got = await host.waitFor('game_action', (p) => p.type === type);
    check(JSON.stringify(got.data) === JSON.stringify(data), `guest ${type} reaches host`);
  }
  host.act({ type: 'huddle_update', data: { board: [], t: 30 } });
  await b.waitFor('game_action', (p) => p.type === 'huddle_update');
  await c.waitFor('game_action', (p) => p.type === 'huddle_update');
  host.act({ type: 'you', to: b.id, data: { evidence: ['e1'] } });
  await b.waitFor('game_action', (p) => p.type === 'you');

  await sleep(500);
  check(c.all('game_action', (p) => p.type === 'secret').length === 1 && b.all('game_action', (p) => p.type === 'secret').length === 0,
    'secret NOT seen by the other guest');
  check(c.all('game_action', (p) => p.type === 'snap' && p.data && p.data.forged).length === 0, 'forged guest snap with payload.to did NOT reach the other guest');
  check(c.all('game_action', (p) => ['in', 'act', 'station', 'huddle_say', 'huddle_vote', 'feeling'].includes(p.type)).length === 0,
    'guest actions never reach other guests');
  check(c.all('game_action', (p) => p.type === 'you').length === 0, '"you" to Ben not seen by Cy');

  // ---- Lock -----------------------------------------------------------------
  const late = await connect('Dee');
  late.send('room_join', { joinCode: created.joinCode });
  check(/already started/.test((await late.waitFor('room_error')).message), 'join after "start" is refused');

  // ---- Chat -----------------------------------------------------------------
  console.log('\nQuick-chat');
  b.act({ type: 'chat', data: { phrase: 'saw', who: 'red', where: 12, text: 'sneaky free text' } });
  for (const p of [host, b, c]) {
    const chat = await p.waitFor('game_action', (x) => x.type === 'chat');
    if (p === c) {
      check(chat.serverChecked === true && JSON.stringify(chat.data) === '{"phrase":"saw","who":"red","where":12}',
        'valid chat delivered to all, extra fields stripped');
    }
  }
  b.act({ type: 'chat', data: { phrase: 'gg' } });
  check((await b.waitFor('error', (e) => e.code === 'CHAT_REJECTED')).message === 'Chat too fast', '1.2 s chat limit');
  await sleep(1300);
  b.act({ type: 'chat', data: { phrase: 'hello there' } });
  check((await b.waitFor('error', (e) => e.code === 'CHAT_REJECTED')).message === 'Unknown chat phrase', 'non-whitelisted phrase rejected');
  c.act({ type: 'chat', data: { phrase: 'saw', where: 99 } });
  check(/where/.test((await c.waitFor('error', (e) => e.code === 'CHAT_REJECTED')).message), 'out-of-range argument rejected');

  // ---- Message rate ---------------------------------------------------------
  console.log('\nMessage rate (3 s at real rates)');
  const before = { b: b.all('game_action', (p) => p.type === 'snap').length, host: host.all('game_action', (p) => p.type === 'in').length };
  const sent = { snap: 0, in: 0 };
  const timers = [
    setInterval(() => { sent.snap++; host.act({ type: 'snap', data: { pad: 'x'.repeat(1800) } }); }, 80), // 12.5/s, ~2 KB
    setInterval(() => host.act({ type: 'you', to: b.id, data: { e: [] } }), 333),
    setInterval(() => { sent.in++; b.act({ type: 'in', data: { x: 0, z: 0, r: 0, b: 0, mv: 0 } }); }, 66), // ~15/s
    setInterval(() => { sent.in++; c.act({ type: 'in', data: { x: 0, z: 0, r: 0, b: 0, mv: 0 } }); }, 66),
  ];
  await sleep(3000);
  timers.forEach(clearInterval);
  await sleep(700);
  const snaps = b.all('game_action', (p) => p.type === 'snap').length - before.b;
  const ins = host.all('game_action', (p) => p.type === 'in').length - before.host;
  const rateErrors = [host, b, c].flatMap((p) => p.all('error', (e) => /Rate limit/.test(e.message)));
  check(rateErrors.length === 0, 'no rate-limit errors');
  check(snaps === sent.snap && snaps >= 30, `guest received all ${snaps}/${sent.snap} snaps (~2 KB each) in 3 s`);
  check(ins === sent.in && ins >= 70, `host received all ${ins}/${sent.in} guest inputs in 3 s`);

  // ---- End + host leaves ----------------------------------------------------
  console.log('\nEnd and host leaving');
  host.act({ type: 'end', data: { allDone: true, reason: 'done', used: 0, missions: [], worry: null } });
  await b.waitFor('game_action', (p) => p.type === 'end');
  late.send('room_join', { joinCode: created.joinCode });
  await late.waitFor('room_joined');
  check(true, 'room re-opens after "end" (rematch)');

  host.close();
  for (const p of [b, c, late]) {
    const closed = await p.waitFor('room_closed');
    if (p === b) check(closed.reason === 'host_left' && closed.message === 'The host left.', 'host leaving closes the room (host_left)');
  }
  [b, c, late].forEach((p) => p.close());

  // ---- 7 players, two rooms at once (Oct 21 2026) ---------------------------
  console.log('\nTwo full 7-player private rooms at once');
  const MONSTERS = ['Ari', 'Bo', 'Cal', 'Dot', 'Eli', 'Fay', 'Gus'];
  const rooms = [];
  for (const tag of ['A', 'B']) {
    const players = [];
    for (const n of MONSTERS) players.push(await connect(`${n}${tag}`));
    players[0].send('room_create', { gameType: GAME_TYPE, options: { maxPlayers: 7 } });
    const info = await players[0].waitFor('room_created');
    check(info.maxPlayers === 7, `room ${tag}: room_created.maxPlayers is 7 (got ${info.maxPlayers})`);
    for (const p of players.slice(1)) {
      p.send('room_join', { joinCode: info.joinCode });
      await Promise.race([
        p.waitFor('room_joined'),
        p.waitFor('room_error').then((e) => { throw new Error(`${p.name} could not join room ${tag}: ${e.message}`); }),
      ]);
    }
    rooms.push({ tag, info, players });
  }
  check(rooms[0].info.joinCode !== rooms[1].info.joinCode, 'each room has its own code');
  const eighth = await connect('Hal');
  eighth.send('room_join', { joinCode: rooms[0].info.joinCode });
  check((await eighth.waitFor('room_error')).message === 'Room is full', '8th player gets room_error "Room is full"');
  eighth.close();

  const [ra, rb] = rooms;
  const huddle = [
    { phrase: 'sus', who: 'red' }, { phrase: 'wru', who: 'blue' }, { phrase: 'vote', who: 'green' },
    { phrase: 'notme' }, { phrase: 'proof' }, { phrase: 'skip' },
  ];
  for (let i = 0; i < huddle.length; i++) {
    ra.players[i + 1].act({ type: 'chat', data: huddle[i] });
    const got = await ra.players[0].waitFor('game_action', (p) => p.type === 'chat' && p.data.phrase === huddle[i].phrase);
    check(got.serverChecked === true && JSON.stringify(got.data) === JSON.stringify(huddle[i]),
      `huddle chat ${JSON.stringify(huddle[i])} echoes with serverChecked`);
  }
  rb.players[0].act({ type: 'snap', data: { room: 'B' } });
  for (const p of rb.players.slice(1)) await p.waitFor('game_action', (x) => x.type === 'snap');
  check(true, 'room B host snap reached all 6 room B guests');
  await sleep(500);
  check(rb.players.every((p) => p.all('game_action', (x) => x.type === 'chat').length === 0), 'room A chat never reached room B');
  check(ra.players.every((p) => p.all('game_action', (x) => x.type === 'snap').length === 0), 'room B snaps never reached room A');
  rooms.forEach((r) => r.players.forEach((p) => p.close()));

  // ---- Quick Match ----------------------------------------------------------
  console.log('\nQuick Match (takes ~21 s)');
  const q1 = await connect('Qa');
  const q2 = await connect('Qb');
  q1.send('matchmake_request', { gameType: GAME_TYPE, gameMode: 'classic' });
  await sleep(300);
  q2.send('matchmake_request', { gameType: GAME_TYPE, gameMode: 'classic' });
  const upd = await q2.waitFor('matchmake_update', (p) => p.playersFound === 2);
  check(upd.startsInMs > 15000 && upd.startsInMs <= 20000, `countdown announced (${upd.startsInMs} ms)`);
  const t0 = Date.now();
  const q1Joined = await q1.waitFor('room_joined', () => true, 30000);
  const q2Joined = await q2.waitFor('room_joined', () => true, 30000);
  check(Date.now() - t0 > 15000, `match started after the countdown (${Date.now() - t0} ms)`);
  check(q2Joined.state.hostId === q1.id, 'first player queued is host');
  check(q2Joined.state.players.every((p) => p.name === null), 'no names in Quick Match');
  check(!q1Joined.room.joinCode, 'Quick Match room has no join code');
  q2.act({ type: 'chat', data: { phrase: 'gg' } });
  check(/private rooms/.test((await q2.waitFor('error', (e) => e.code === 'CHAT_REJECTED')).message), 'chat refused in Quick Match');
  q2.act({ type: 'in', data: { x: 1 } });
  check((await q1.waitFor('game_action', (p) => p.type === 'in')).playerId === q2.id, 'Quick Match routing works');
  q1.close();
  await q2.waitFor('room_closed');
  q2.close();

  console.log('\nQuick Match fills to 7');
  const seven = [];
  for (const n of MONSTERS) seven.push(await connect(`Q${n}`));
  const tq = Date.now();
  for (const p of seven) p.send('matchmake_request', { gameType: GAME_TYPE, gameMode: 'classic' });
  const sevenJoined = await Promise.all(seven.map((p) => p.waitFor('room_joined', () => true, 10000)));
  check(Date.now() - tq < 10000, `7th player starts the match at once (${Date.now() - tq} ms, no countdown)`);
  // Each room_joined shows the roster at that player's join, and join order follows
  // network arrival, so the last joiner (whoever it is) is the one that sees all 7.
  check(sevenJoined.every((j) => j.room.id === sevenJoined[0].room.id) &&
    Math.max(...sevenJoined.map((j) => j.state.players.length)) === 7, 'all 7 in one Quick Match room');
  seven.forEach((p) => p.close());

  // ---- Server still healthy -------------------------------------------------
  const probe = await connect('Probe');
  probe.close();
  check(true, 'server still responsive');

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
