/**
 * Reproduces Turbo Type's exact game_action wire shape against production.
 *
 * Their client sends:
 *   { type:"game_action", payload:{ action:"race_setup", data:{...} } }
 * (i.e. action name in `payload.action`, not `payload.type`). The original
 * server only read `payload.type`, so every action was silently dropped.
 * This script must pass after the lenient-payload fix is deployed.
 *
 * Run: node test-typing-race-action-key.js
 */

const WebSocket = require('ws');

const SERVER_URL = process.env.SERVER_URL || 'wss://multiplayer.gameonguy.com/ws';
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
          ws, log,
          send: (msg) => ws.send(JSON.stringify(msg)),
          getClientId: () => clientId,
          waitFor(type, predicate, ms = TIMEOUT_MS) {
            return new Promise((res, rej) => {
              for (; cursor < log.length; cursor++) {
                const e = log[cursor];
                if (e.type === type && (!predicate || predicate(e))) {
                  cursor++;
                  return res(e);
                }
              }
              const timer = setTimeout(() => rej(new Error(`waitFor ${type} timed out`)), ms);
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

(async () => {
  console.log('='.repeat(70));
  console.log('TYPING_RACE — TURBO TYPE WIRE SHAPE (payload.action) VERIFICATION');
  console.log('='.repeat(70));
  console.log('Server :', SERVER_URL);
  console.log('Time   :', new Date().toISOString());
  console.log('='.repeat(70));

  let host, guest;
  try {
    host = await connect('TurboHost');
    guest = await connect('TurboGuest');
    console.log('\n[ok] both clients authenticated');

    host.send({ type: 'room_create', payload: { gameType: 'typing_race' } });
    const created = await host.waitFor('room_created');
    const roomId = created.payload.id;
    console.log('[ok] room_created:', roomId);

    guest.send({ type: 'room_join', payload: { roomId } });
    await guest.waitFor('room_joined');
    console.log('[ok] guest joined');

    // Optional: ready up first (Turbo Type's trace mentions doing this).
    host.send({ type: 'player_ready', payload: { ready: true } });
    guest.send({ type: 'player_ready', payload: { ready: true } });

    // ─── THE CRITICAL TEST ─────────────────────────────────────────────
    // Turbo Type's exact shape: action name in `payload.action`, nested data.
    const text = 'The quick brown fox jumps over the lazy dog.';
    const startAt = Date.now() + 1500;
    host.send({
      type: 'game_action',
      payload: {
        action: 'race_setup',                   // ← `action`, not `type`
        data: { text, startAt },
      },
    });

    const setupRelay = await guest.waitFor(
      'state_update',
      (m) => m.payload && m.payload.state && m.payload.state.status === 'racing'
    );
    console.log('[ok] guest received state_update after action:race_setup:',
      'status=' + setupRelay.payload.state.status,
      'text="' + setupRelay.payload.state.text.slice(0, 30) + '..."');
    if (setupRelay.payload.state.text !== text) throw new Error('text mismatch');

    // Progress + finish, also using `action`.
    guest.send({
      type: 'game_action',
      payload: { action: 'progress', data: { position: 50, wpm: 60, accuracy: 96 } },
    });
    // Sequence the finishes so server-side arrival order is deterministic.
    guest.send({
      type: 'game_action',
      payload: { action: 'finish', data: { time: 12.3, wpm: 65, accuracy: 96 } },
    });
    await new Promise((r) => setTimeout(r, 150));
    host.send({
      type: 'game_action',
      payload: { action: 'finish', data: { time: 15.0, wpm: 55, accuracy: 92 } },
    });

    const end = await host.waitFor('game_end');
    const standings = end.payload.results.standings;
    console.log('[ok] game_end received:');
    standings.forEach((s) => console.log('     ', JSON.stringify(s)));

    if (standings.length !== 2) throw new Error('expected 2 standings');
    // Guest finished first, host second.
    if (standings[0].id !== guest.getClientId() || standings[0].place !== 1) {
      throw new Error('guest should be place 1 (finished first)');
    }
    if (standings[1].id !== host.getClientId() || standings[1].place !== 2) {
      throw new Error('host should be place 2');
    }

    console.log('\n✅ Turbo Type wire shape (payload.action) works end-to-end on production.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ verification failed:', err.message);
    if (host) console.error('host recent:', host.log.slice(-5).map((m) => m.type));
    if (guest) console.error('guest recent:', guest.log.slice(-5).map((m) => m.type));
    process.exit(1);
  }
})();
