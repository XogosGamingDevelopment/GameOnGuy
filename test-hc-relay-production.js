/**
 * Verify historical_conquest is a RELAY room on production.
 *
 * Contract requested by Xogos Gaming for Historical Conquest: The Digital
 * (lockstep client — full game logic on every device):
 *   1. Room flow works via private room codes: room_create -> room_list ->
 *      room_join (no matchmaking).
 *   2. Any game_action is relayed to the OTHER players immediately — no 30s
 *      setup phase, no server-side turn order, no "Not your turn".
 *   3. All three payload shapes relay: payload.type, payload.action, flat.
 *   4. The sender does not receive its own action back.
 *
 * Also regression-checks the 2026-07-21 outage: both players disconnect
 * right after joining, then the server must still answer /health-style
 * traffic (we reconnect a probe client) — the old code wedged the event
 * loop when this happened during a turn-based setup phase.
 *
 * Run with: node test-hc-relay-production.js
 *   (or GAMEON_URL=ws://localhost:3000/ws node test-hc-relay-production.js)
 */

const WebSocket = require('ws');

const SERVER_URL =
  process.env.GAMEON_URL || process.env.SERVER_URL || 'wss://multiplayer.gameonguy.com/ws';
const TIMEOUT_MS = 30000;

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    const log = [];
    const listeners = [];
    let clientId = null;
    let cursor = 0;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', payload: { username: name } }));
    });
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      log.push({ t: Date.now(), type: m.type, payload: m.payload });
      for (let i = listeners.length - 1; i >= 0; i--) {
        if (listeners[i](m)) listeners.splice(i, 1);
      }
      if (m.type === 'welcome') clientId = m.payload.clientId;
      if (m.type === 'auth_success') {
        resolve({
          ws,
          log,
          name,
          send: (msg) => ws.send(JSON.stringify(msg)),
          getClientId: () => clientId,
          countOf: (type) => log.filter((e) => e.type === type).length,
          waitFor(type, predicate, ms = TIMEOUT_MS) {
            return new Promise((res, rej) => {
              for (; cursor < log.length; cursor++) {
                const e = log[cursor];
                if (e.type === type && (!predicate || predicate(e))) {
                  cursor++;
                  return res(e);
                }
              }
              const timer = setTimeout(() => rej(new Error(`waitFor ${type} timed out (${name})`)), ms);
              listeners.push((m) => {
                if (m.type === type && (!predicate || predicate({ type: m.type, payload: m.payload }))) {
                  clearTimeout(timer);
                  cursor = log.length;
                  res({ type: m.type, payload: m.payload });
                  return true;
                }
                return false;
              });
            });
          },
        });
      }
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error(`connect timeout for ${name}`)), TIMEOUT_MS);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, label) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${label}`);
  console.log(`  ✔ ${label}`);
}

(async () => {
  console.log('='.repeat(60));
  console.log('HISTORICAL CONQUEST RELAY — PRODUCTION VERIFICATION');
  console.log('='.repeat(60));
  console.log('Server :', SERVER_URL);
  console.log('Time   :', new Date().toISOString());
  console.log('='.repeat(60));

  let alice, bob;
  try {
    // ------------------------------------------------------------------
    console.log('\n[1] Room flow: create -> room_list -> join (private code)');
    alice = await connect('HC_RelayTest_Alice');
    bob = await connect('HC_RelayTest_Bob');

    alice.send({ type: 'room_create', payload: { gameType: 'historical_conquest' } });
    const created = await alice.waitFor('room_created');
    const roomId = created.payload.id;
    assert(roomId, `room_created returned a room id (${roomId})`);
    // (the creator is auto-joined; only room_created is sent to them)

    bob.send({ type: 'room_list', payload: { gameType: 'historical_conquest' } });
    const list = await bob.waitFor('room_list');
    assert(
      (list.payload.rooms || []).some((r) => r.id === roomId),
      'room appears in room_list for gameType historical_conquest'
    );

    bob.send({ type: 'room_join', payload: { roomId } });
    await bob.waitFor('room_joined');
    await alice.waitFor('player_joined');
    console.log('  Both players in room', roomId);

    // ------------------------------------------------------------------
    console.log('\n[2] Immediate relay — no game start, no setup phase, no turn order');

    // Shape A: canonical payload.type
    alice.send({
      type: 'game_action',
      payload: { type: 'play_card', data: { cardId: 'washington', slot: 2 } },
    });
    const relayA = await bob.waitFor('game_action');
    assert(relayA.payload.type === 'play_card', 'shape A (payload.type) relayed to peer');
    assert(relayA.payload.playerId === alice.getClientId(), 'relay carries sender playerId');
    assert(
      relayA.payload.data && relayA.payload.data.cardId === 'washington',
      'relay carries data verbatim'
    );

    // Shape B: payload.action (the Turbo Type lesson)
    bob.send({ type: 'game_action', payload: { action: 'end_turn', data: { turn: 1 } } });
    const relayB = await alice.waitFor('game_action');
    assert(relayB.payload.action === 'end_turn', 'shape B (payload.action) relayed to peer');
    assert(relayB.payload.type === 'end_turn', 'relay exposes the name under BOTH type and action');

    // Shape C: flat payload
    alice.send({ type: 'game_action', payload: { action: 'attack', row: 0, power: 7 } });
    const relayC = await bob.waitFor('game_action');
    assert(
      relayC.payload.data && relayC.payload.data.row === 0 && relayC.payload.data.power === 7,
      'shape C (flat payload) relayed with full payload as data'
    );

    // Out-of-turn spam from one player — every one must relay, none rejected.
    for (let i = 0; i < 3; i++) {
      alice.send({ type: 'game_action', payload: { type: 'rapid', data: { i } } });
    }
    await bob.waitFor('game_action', (e) => e.payload.data && e.payload.data.i === 2);
    console.log('  ✔ 3 consecutive same-player actions all relayed (no turn gating)');

    await sleep(500);
    assert(alice.countOf('action_rejected') === 0, 'Alice: zero action_rejected ("Not your turn")');
    assert(bob.countOf('action_rejected') === 0, 'Bob: zero action_rejected');
    assert(alice.countOf('error') === 0, 'Alice: zero error messages');
    assert(bob.countOf('error') === 0, 'Bob: zero error messages');
    assert(alice.countOf('setup_phase') === 0, 'no setup_phase broadcast (30s phase is gone)');
    assert(alice.countOf('turn_start') === 0, 'no turn_start broadcast (server turn order is gone)');
    // Sender must not receive its own actions back (5 sent by Alice).
    assert(alice.countOf('game_action') === 1, 'Alice only received Bob\'s 1 action (no self-echo)');

    // ------------------------------------------------------------------
    console.log('\n[3] Outage regression: both players disconnect, server stays responsive');
    alice.ws.close();
    bob.ws.close();
    await sleep(2000);

    const probe = await connect('HC_RelayTest_Probe');
    probe.send({ type: 'room_list', payload: { gameType: 'historical_conquest' } });
    await probe.waitFor('room_list');
    probe.ws.close();
    console.log('  ✔ server still answers after both players disconnected');

    console.log('\n' + '='.repeat(60));
    console.log('✅ PASS — historical_conquest is a relay room and healthy');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (err) {
    console.error('\n' + '='.repeat(60));
    console.error('❌ FAIL:', err.message);
    console.error('='.repeat(60));
    if (alice) console.error('\nAlice log:', JSON.stringify(alice.log, null, 1).slice(0, 3000));
    if (bob) console.error('\nBob log:', JSON.stringify(bob.log, null, 1).slice(0, 3000));
    process.exit(1);
  }
})();
