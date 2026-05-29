/**
 * Verify typing_race is registered on production.
 *
 * Connects to wss://multiplayer.gameonguy.com/ws, authenticates as a guest,
 * creates a typing_race room, runs a full race_setup / progress / finish flow
 * against a second guest client, and asserts game_end carries standings.
 *
 * Run with: node test-typing-race-production.js
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
    let cursor = 0; // log index used by waitFor to skip already-seen messages

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', payload: { username: name } }));
    });
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString());
      log.push({ t: Date.now(), type: m.type, payload: m.payload });
      // Fire predicate listeners (oldest-first); remove ones that match.
      for (let i = listeners.length - 1; i >= 0; i--) {
        if (listeners[i](m)) listeners.splice(i, 1);
      }
      if (m.type === 'welcome') clientId = m.payload.clientId;
      if (m.type === 'auth_success') {
        resolve({
          ws,
          log,
          send: (msg) => ws.send(JSON.stringify(msg)),
          getClientId: () => clientId,
          // Wait for the NEXT message (after cursor) matching type + optional predicate.
          waitFor(type, predicate, ms = TIMEOUT_MS) {
            return new Promise((res, rej) => {
              // Check messages already in the log that the cursor hasn't passed.
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
                  cursor = log.length; // advance past this message
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
  console.log('='.repeat(60));
  console.log('TYPING RACE PRODUCTION VERIFICATION');
  console.log('='.repeat(60));
  console.log('Server :', SERVER_URL);
  console.log('Time   :', new Date().toISOString());
  console.log('='.repeat(60));

  let host, guest;
  try {
    host = await connect('TestHost');
    guest = await connect('TestGuest');
    console.log('\n[ok] both clients authenticated');

    host.send({ type: 'room_create', payload: { gameType: 'typing_race' } });
    const created = await host.waitFor('room_created');
    const roomId = created.payload.id;
    console.log('[ok] room_created:', roomId);

    guest.send({ type: 'room_join', payload: { roomId } });
    await guest.waitFor('room_joined');
    console.log('[ok] guest joined');

    // Race setup from host.
    const text = 'The quick brown fox jumps over the lazy dog.';
    const startAt = Date.now() + 2000;
    host.send({
      type: 'game_action',
      payload: { type: 'race_setup', data: { text, startAt } },
    });
    const setupRelay = await guest.waitFor(
      'state_update',
      (m) => m.payload && m.payload.state && m.payload.state.status === 'racing'
    );
    console.log('[ok] guest received state_update after race_setup:',
      'status=' + setupRelay.payload.state.status,
      'text="' + setupRelay.payload.state.text.slice(0, 30) + '..."',
      'players=' + setupRelay.payload.state.players.length);

    if (setupRelay.payload.state.text !== text) throw new Error('text mismatch');

    // Progress from guest.
    guest.send({
      type: 'game_action',
      payload: { type: 'progress', data: { position: 50, wpm: 60, accuracy: 96 } },
    });

    // Both finish — guest first.
    guest.send({
      type: 'game_action',
      payload: { type: 'finish', data: { time: 12.3, wpm: 65, accuracy: 96 } },
    });
    host.send({
      type: 'game_action',
      payload: { type: 'finish', data: { time: 15.0, wpm: 55, accuracy: 92 } },
    });

    const end = await host.waitFor('game_end');
    const standings = end.payload.results.standings;
    console.log('[ok] game_end received with standings:');
    standings.forEach((s) => console.log('     ', JSON.stringify(s)));

    if (standings.length !== 2) throw new Error('expected 2 standings');
    if (standings[0].place !== 1 || !standings[0].finished) throw new Error('place-1 not the first finisher');
    if (standings[1].place !== 2) throw new Error('place-2 missing');

    console.log('\n✅ typing_race is LIVE and working end-to-end.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ verification failed:', err.message);
    if (host) console.error('host recent:', host.log.slice(-5).map((m) => m.type));
    if (guest) console.error('guest recent:', guest.log.slice(-5).map((m) => m.type));
    process.exit(1);
  }
})();
