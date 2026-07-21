/**
 * Phase 14 smoke test: verify server-side bots are DISABLED for
 * historical_conquest.
 *
 * Historical Conquest: The Digital runs its own bots client-side, so a solo
 * matchmaking player must receive `matchmake_timeout` after ~20s — NOT get
 * auto-joined into a room with a server bot.
 *
 * PASS: matchmake_started → matchmake_timeout (~20s), no room_joined.
 * FAIL: room_joined / player_joined arrives (bot fill is still active), or
 *       nothing arrives within 35s.
 *
 * Run with: node test-hc-no-bot-production.js
 */

const WebSocket = require('ws');

// Override with GAMEON_URL=ws://localhost:3000/ws to test locally
const SERVER_URL = process.env.GAMEON_URL || 'wss://multiplayer.gameonguy.com/ws';

console.log('='.repeat(60));
console.log('HC NO-BOT TEST (bots must NOT spawn for historical_conquest)');
console.log('='.repeat(60));
console.log(`Connecting to: ${SERVER_URL}`);
console.log(`Time: ${new Date().toISOString()}`);
console.log('='.repeat(60));

const ws = new WebSocket(SERVER_URL);
let startTime;
let sawStarted = false;

function finish(ok, reason) {
  console.log('\n' + '='.repeat(60));
  console.log(ok ? `✅ PASS: ${reason}` : `❌ FAIL: ${reason}`);
  console.log('='.repeat(60));
  try { ws.close(); } catch (e) { /* ignore */ }
  process.exit(ok ? 0 : 1);
}

// Hard deadline: timeout should arrive ~20s after matchmake_request
const deadline = setTimeout(() => {
  finish(false, 'No matchmake_timeout within 35s — matchmaking behavior unexpected');
}, 35000);
deadline.unref?.();

ws.on('open', () => {
  console.log('\n[CONNECTED]');
  startTime = Date.now();
});

ws.on('message', (data) => {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const message = JSON.parse(data.toString());
  console.log(`[${elapsed}s] RECEIVED: ${message.type}`);

  switch (message.type) {
    case 'welcome':
      ws.send(JSON.stringify({
        type: 'auth',
        payload: { username: 'NoBotTest_' + Math.floor(Math.random() * 10000) },
      }));
      break;

    case 'auth_success':
      console.log('[ACTION] Requesting match for historical_conquest (expecting timeout, no bot)...');
      ws.send(JSON.stringify({
        type: 'matchmake_request',
        payload: { gameType: 'historical_conquest' },
      }));
      break;

    case 'matchmake_started':
      sawStarted = true;
      console.log(`[ok] matchmake_started (estimatedWait: ${message.payload?.estimatedWait}s). Waiting...`);
      break;

    case 'matchmake_timeout':
      if (!sawStarted) {
        finish(false, 'matchmake_timeout arrived without matchmake_started');
      }
      finish(true, `matchmake_timeout at ${elapsed}s and no server bot joined — bots are OFF for historical_conquest`);
      break;

    // Any of these means the old bot-fill flow is still running
    case 'room_joined':
    case 'player_joined':
    case 'matchmake_found':
      finish(false, `Received ${message.type} — server-side bot fill appears to still be ACTIVE (another player queuing at the same time can also cause matchmake_found; re-run to confirm)`);
      break;
  }
});

ws.on('error', (err) => finish(false, `WebSocket error: ${err.message}`));
