# Response: Backend restored + historical_conquest is now a relay room

**To:** Historical Conquest development team (Xogos Gaming)
**From:** Game On Dude! team
**Date:** July 23, 2026
**Re:** Your letter of July 23 — (1) backend down since July 21, (2) relay-room registration for `historical_conquest`

Hi Zack and team,

Both items are resolved and live in production. Details below, including an honest account of what took the server down — it was our bug, and your report is what got it found and fixed.

---

## 1. The outage — root cause, fix, and current status

**Status: RESTORED.** `https://multiplayer.gameonguy.com/health` and `wss://multiplayer.gameonguy.com/ws` are healthy (verified July 23, ~17:30 UTC, and continuously since). Total outage window: July 21 ~21:07 UTC → July 23 ~16:45 UTC.

**What happened:** On July 21 at 21:05 UTC, two clients started a `historical_conquest` game (at the time still the old simulated turn-based room, with its 30-second setup phase). At 21:06 both players disconnected during that setup phase. The game ended correctly — but a pending setup-phase timer was never cancelled. When it fired ten seconds later, it tried to start the first turn, and the "skip eliminated players" loop had no un-eliminated player left to land on. It spun forever, pinning a CPU core and blocking Node's event loop — which is why *everything* (health checks, WebSocket handshakes) returned 504 from the load balancer while the instance itself looked alive. Your read of the symptoms was exactly right: ALB up, application wedged.

**The fix (deployed):**
- All pending turn/setup/pause timers are now cancelled the moment a game ends or a room is disposed.
- The turn-start logic now ends the game cleanly if no active players remain, instead of looping.
- We added automated regression tests that reproduce the exact outage scenario — they hang on the old code and pass on the fix — plus a live production check that both players disconnecting leaves the server responsive.

This failure mode is also structurally irrelevant to you now, because of item 2:

---

## 2. `historical_conquest` is now a RELAY room — live in production

The old simulated turn room (30 s setup phase, server-side turn order, "Not your turn" rejections) is retired for your game type. `historical_conquest` is now a **pure relay**, matching your lockstep architecture:

- **Every `game_action` a player sends is forwarded to the other players in the room immediately** — as soon as players are present. No game-start requirement, no setup phase, no turn gating, no action validation. Nothing is ever rejected with "Not your turn."
- **Min 2 / max 4 players.** No server-side bots. Matchmaking is not required (it still works if you ever want it: pairs 2 humans, `matchmake_timeout` after ~20 s).
- **Private room codes work exactly as you described:** host sends `room_create { "gameType": "historical_conquest" }`, shares the returned `payload.id`, friends discover it via `room_list { "gameType": "historical_conquest" }` (or join the shared id directly) with `room_join { "roomId": "..." }`. Roster events: `room_joined`, `player_joined`, `player_left`.

### What the other players receive when someone sends an action

```json
{
  "type": "game_action",
  "payload": {
    "type":      "<your action name, or null if you didn't send one>",
    "action":    "<same value — alias, read whichever key you prefer>",
    "playerId":  "<sender's connection id (matches player_joined ids)>",
    "username":  "<sender's display name>",
    "data":      "<your payload.data if you nest it, otherwise your whole payload verbatim>",
    "timestamp": 1784800000000
  }
}
```

The relay is deliberately **shape-agnostic**: your action name can be in `payload.type` or `payload.action`, your data can be nested under `data` or flat in the payload, or you can send any JSON payload with no action name at all — it relays regardless, byte-for-byte in `data`. All three shapes are verified live on production.

One default worth knowing: **the sender does not receive its own action back** (lockstep clients apply locally before sending, and an echo risks double-application). If your protocol expects the echo, pass `echoToSender: true` in `room_create`'s options and every action goes to all players including the sender.

### About your attached spec

Your letter references an attached spec with your exact message shapes, but no attachment reached us. The relay's shape-agnosticism means it should already carry whatever your client sends — but per our own postmortem practice (we once shipped a "working" feature verified only against *our* assumed payload shape, not the integrator's), **please resend the spec** and we'll add a verification script that speaks your exact wire shapes end-to-end against production before you go live with students.

### Verified live on production (July 23)

Our automated check against `wss://multiplayer.gameonguy.com/ws` confirms: room create → `room_list` discovery → join; relay of all three payload shapes to peers with sender `playerId`; three consecutive actions from the same player all relayed (zero `action_rejected`, zero errors); no `setup_phase`, no `turn_start`; no self-echo; and the server stays responsive after both players disconnect.

---

## Connection reminder

- **Endpoint:** `wss://multiplayer.gameonguy.com/ws` (use this hostname exactly — `wss://` against the raw `*.elasticbeanstalk.com` hostname fails TLS validation).
- **Auth:** send `{ "type": "auth", "payload": { "username": "...", "guestId": "..." } }` after connecting; wait for `auth_success` before room operations.
- Full protocol reference: the integration guide we shared previously (its `historical_conquest` section has been updated to describe the relay contract above).

Apologies again for the downtime, and thanks for the precise outage report — it pointed us straight at the right layer. Send over that spec and we'll confirm your exact shapes within a day.

— Game On Dude! team
