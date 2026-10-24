# Game On Dude! — Multiplayer Integration Guide

**This is the canonical document to give to any developer integrating a game with the Game On Dude! multiplayer server.** Every message shape in this guide is verified against the running server source code.

| | |
|---|---|
| **WebSocket (production)** | `wss://multiplayer.gameonguy.com/ws` |
| **Health check** | `https://multiplayer.gameonguy.com/health` → `{"status":"ok","clients":N}` |
| **Protocol** | JSON messages over WebSocket |
| **Website** | [www.gameonguy.com](https://www.gameonguy.com) |

> ⚠️ **Use exactly `wss://multiplayer.gameonguy.com/ws`.** Do NOT connect to any `*.elasticbeanstalk.com` hostname — the TLS certificate is bound to `multiplayer.gameonguy.com`, so `wss://` against the raw AWS hostname fails the TLS handshake (`WRONG_PRINCIPAL`) and appears to hang. This has cost integrators days of debugging.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Message Envelope](#message-envelope)
3. [Connection & Authentication](#connection--authentication)
4. [Room Management](#room-management)
5. [Game Flow](#game-flow)
6. [Matchmaking (with Bot Fallback)](#matchmaking-with-bot-fallback)
7. [Heartbeat & Reconnection](#heartbeat--reconnection)
8. [Error Handling](#error-handling)
9. [Full Message Reference](#full-message-reference)
10. [Game Types](#game-types)
11. [Unity Integration (C#)](#unity-integration-c)
12. [Web Integration (JavaScript/TypeScript)](#web-integration-javascripttypescript)
13. [Security Notes](#security-notes)
14. [Integration Checklist](#integration-checklist)

---

## Quick Start

Paste this into a browser console to verify you can reach the server:

```javascript
const ws = new WebSocket('wss://multiplayer.gameonguy.com/ws');
ws.onmessage = (e) => console.log('Received:', JSON.parse(e.data));
ws.onopen = () => {
  console.log('Connected!');
  ws.send(JSON.stringify({ type: 'auth', payload: { username: 'TestUser', guestId: 'test-123' }}));
};
```

Expected: a `welcome` message, then an `auth_success` message. If you see nothing, check you used `wss://multiplayer.gameonguy.com/ws` exactly.

---

## Message Envelope

Every message in both directions is a JSON object:

```json
{ "type": "message_type", "payload": { } }
```

Messages **from the server** additionally carry two fields you can use for ordering and latency measurement:

```json
{ "type": "welcome", "payload": { }, "timestamp": 1750000000000, "sequence": 7 }
```

- `timestamp` — server epoch milliseconds when the message was sent.
- `sequence` — per-connection incrementing counter.

Your client only needs to send `type` and `payload`.

---

## Connection & Authentication

### Connection flow

```
1. Client opens WebSocket to wss://multiplayer.gameonguy.com/ws
2. Server sends:  { "type": "welcome", "payload": { "clientId", "sessionId", "serverTime" } }
3. Client sends:  auth (guest or JWT)
4. Server sends:  auth_success (or auth_failure)
5. Client can now create/join rooms or matchmake
```

You **must** authenticate before creating/joining rooms or matchmaking — those requests return an `error` message otherwise.

### Guest authentication (easiest — no account needed)

```json
{
  "type": "auth",
  "payload": {
    "username": "PlayerName",
    "guestId": "unique-device-id"
  }
}
```

Both fields are optional (the server generates values for anything omitted), but sending a stable `guestId` per device gives the player a consistent identity.

**Note:** the server normalizes guest identities for security:
- Your `guestId` is sanitized (only letters, digits, `_`, `.`, `-` kept; max 64 chars) and prefixed with `guest_`. So `guestId: "web-123"` results in `userId: "guest_web-123"` in `auth_success`. Send the same `guestId` again and you get the same `userId` back — it's stable.
- `username` is stripped of control characters and capped at 32 characters.

### JWT authentication (registered users)

```json
{ "type": "auth", "payload": { "token": "your-jwt-token" } }
```

Tokens are issued by Game On Dude! (contact us for backend integration). Expired tokens return `auth_failure` with message `"Token expired"`.

### Responses

```json
{ "type": "auth_success", "payload": { "userId": "guest_web-123", "username": "PlayerName", "sessionId": "uuid" } }
```

```json
{ "type": "auth_failure", "payload": { "message": "Invalid token" } }
```

---

## Room Management

### Room IDs are UUIDs

Room IDs look like `"3f8a2c1e-9b4d-4e6a-8c7f-1d2e3f4a5b6c"`. Room IDs arrive in `room_created` as `payload.id`. Some game types (`typing_race`, private `historical_conquest` games, private `panic_attack` rooms) also get a short **join code** — consonants only, so it can't spell a word — in `room_created.joinCode`. Players join with `room_join { joinCode }` (case-insensitive) or with the full room id.

### Create a room

```json
{
  "type": "room_create",
  "payload": {
    "gameType": "typing_race",
    "options": { "maxPlayers": 8, "isPrivate": false, "metadata": { "typingMode": "classic" } },
    "playerData": { "carId": "apex-coupe-gs" }
  }
}
```

The creator is **automatically joined** to the room — do not send `room_join` after creating. `playerData` is optional and only kept by games that accept player info (see [Game Types](#game-types)); each game keeps only the fields it allows.

**Response** (`payload` is the room info object plus your own ids and the roster):

```json
{
  "type": "room_created",
  "payload": {
    "id": "3f8a2c1e-9b4d-4e6a-8c7f-1d2e3f4a5b6c",
    "name": "Room name",
    "gameType": "typing_race",
    "state": "waiting",
    "playerCount": 1,
    "maxPlayers": 8,
    "isPrivate": true,
    "hasPassword": false,
    "createdAt": 1750000000000,
    "metadata": { "typingMode": "classic" },
    "joinCode": "BKTMZR",
    "playerId": "<your room player id — same as welcome.clientId>",
    "rejoinToken": "<only in games that hold seats; keep it in memory>",
    "players": [ { "id": "<your playerId>", "username": "Alice", "isReady": false, "joinedAt": 1750000000000, "connected": true, "data": { "carId": "apex-coupe-gs" } } ]
  }
}
```

On failure: `{ "type": "room_error", "payload": { "message": "...", "code": "..." } }` (see [Error Handling](#error-handling)).

### Join a room

```json
{ "type": "room_join", "payload": { "roomId": "3f8a2c1e-...", "password": "optional", "playerData": { } } }
{ "type": "room_join", "payload": { "joinCode": "BKTMZR" } }
{ "type": "room_join", "payload": { "roomId": "3f8a2c1e-...", "rejoinToken": "..." } }   // take back a held seat
```

**Response** — note the nesting: room info (with the roster) is under `payload.room`, game state under `payload.state`:

```json
{
  "type": "room_joined",
  "payload": {
    "room": { "id": "3f8a2c1e-...", "gameType": "typing_race", "playerCount": 2, "maxPlayers": 8, "state": "waiting", "players": [ ... ] },
    "state": { },
    "playerId": "<your room player id>",
    "rejoinToken": "<only in games that hold seats>"
  }
}
```

`room.players` is in join order, room creator first. A rejoin's `room_joined` also has `"rejoined": true`.

Everyone already in the room receives:

```json
{
  "type": "player_joined",
  "payload": {
    "id": "player-client-uuid",
    "username": "PlayerName",
    "isReady": false,
    "isConnected": true,
    "joinedAt": 1750000000000,
    "data": {}
  }
}
```

**Important:** the `id` in player events is the player's **room player id**, not their `userId`. It equals the `clientId` from that player's `welcome` — and your own is also given as `playerId` in `room_created` / `room_joined`. After a rejoin your connection has a new `clientId` but you keep your old `playerId`, so prefer `playerId` from `room_joined`. Some games send a reduced player object here (e.g. no `userId`/`sessionId`) — see [Game Types](#game-types).

### Leave / list

```json
{ "type": "room_leave" }
```
→ you receive `{ "type": "room_left" }`; others receive `{ "type": "player_left", "payload": { "playerId": "..." } }`

```json
{ "type": "room_list", "payload": { "gameType": "typing_race" } }
```
→ `{ "type": "room_list", "payload": { "rooms": [ { "id", "gameType", "playerCount", "maxPlayers", "state", ... } ] } }`

Which rooms are listed depends on the game: `typing_race` rooms are hidden unless created with `isPrivate: false`; `historical_conquest` rooms created with `isPrivate: true` are never listed; `panic_attack` rooms are never listed. For other game types `isPrivate` is informational and rooms are listed. `room_list` never includes players or names.

### Room closed

If a room is disposed (empty, or shut down by an admin), remaining members receive:

```json
{ "type": "room_closed", "payload": { "reason": "Room disposed" } }
```

---

## Game Flow

### 1. Ready up

```json
{ "type": "player_ready", "payload": { "ready": true } }
```

Everyone in the room receives `{ "type": "player_ready", "payload": { "playerId": "...", "ready": true } }`. When enough players (the game's `minPlayers`) are ready, auto-start rooms begin the game.

### 2. Game start

```json
{ "type": "game_start", "payload": { "state": { } } }
```

### 3. Send game actions — READ THIS SHAPE CAREFULLY

The canonical shape puts the action name in **`payload.type`** and its parameters in **`payload.data`**:

```json
{
  "type": "game_action",
  "payload": {
    "type": "answer",
    "data": { "answerId": "answer-uuid" }
  }
}
```

> ⚠️ **The most common integration bug** is sending the action name under a different key (e.g. `payload.action`). For most game types the server reads only `payload.type` — a mismatched key means your action is silently ignored. Exception: `typing_race` leniently accepts `payload.action` and flat payloads as well. When in doubt, use `payload.type` + `payload.data` — that works for every game.

Actions sent before the game starts are rejected with `{ "type": "error", "payload": { "message": "Game not in progress" } }` (again, `typing_race` is the exception — it accepts actions as soon as players are in the room).

### 4. Receive state updates

The base server broadcasts state in two forms:

```json
{ "type": "state_full",  "payload": { "state": { }, "sequence": 12 } }
{ "type": "state_patch", "payload": { "patches": [ { "op": "replace", "path": "/score", "value": 5 } ], "sequence": 13 } }
```

Individual games may also broadcast their own event messages (e.g. `typing_race` sends `state_update`, trivia sends question events). See [Game Types](#game-types).

### 5. Game end

```json
{ "type": "game_end", "payload": { "results": { } } }
```

The shape of `results` is game-specific (see each game's section).

---

## Matchmaking (with Bot Fallback)

Instead of manual room codes, let the server find opponents:

```json
{ "type": "matchmake_request", "payload": { "gameType": "historical_conquest" } }
```

**Immediate acknowledgment:**

```json
{ "type": "matchmake_started", "payload": { "ticketId": "...", "gameType": "historical_conquest", "estimatedWait": 20 } }
```

Then one of three outcomes:

**A. Human match found** — you receive `matchmake_found` and must then join the room yourself:

```json
{ "type": "matchmake_found", "payload": { "roomId": "3f8a2c1e-...", "gameType": "historical_conquest" } }
```
→ your client sends `{ "type": "room_join", "payload": { "roomId": "..." } }`

**B. Timeout with bot fallback** (opt-in per game — no game currently has server-side bots enabled; ask us to enable it for yours): the server **auto-joins you** into a room — you receive `room_joined` directly (no `room_join` needed), you are auto-readied, a server bot joins (`player_joined`), the bot readies, and the game starts. Clients of opted-in games must handle `room_joined` arriving without having sent `room_join`.

**C. Timeout without bots (the default):**

```json
{ "type": "matchmake_timeout", "payload": { "gameType": "...", "message": "Could not find a match. Please try again." } }
```

Cancel anytime with `{ "type": "matchmake_cancel" }`.

---

## Heartbeat & Reconnection

- The server pings each connection (WebSocket protocol ping) every 30 s and disconnects clients silent for 60 s. Browsers and standard WebSocket libraries answer protocol pings automatically — you usually need to do nothing.
- You may also send an application-level ping and receive a pong (useful for RTT measurement):

```json
{ "type": "ping" }        → { "type": "pong", "timestamp": 1750000000000 }
```

- **Reconnection (games that hold seats — `typing_race` 90 s, `historical_conquest` 60 s):** when a connection drops, the others get `player_disconnected { playerId, holdMs }` and the seat is kept. Reconnect, sign in **as the same user** (same `guestId`, or a fresh token for the same player), then send `room_join { roomId, rejoinToken }` with the `rejoinToken` from your earlier `room_created`/`room_joined`. You get `room_joined { ..., playerId: <your old id>, rejoined: true }` and the others get `player_reconnected { playerId }`. If the hold runs out, the others get the usual `player_left`. A wrong or expired token gets `room_error { code: "BAD_REJOIN_TOKEN" }`.
- **Reconnection (other games):** there is no session restore. If the socket drops, reconnect, re-authenticate (same `guestId` gives you the same identity), and join your room again by ID. Design your game to tolerate this.

```javascript
ws.onclose = (event) => {
  if (!event.wasClean) setTimeout(() => connectAndReauth(), 3000);
};
```

---

## Error Handling

Errors arrive as plain-language messages on three channels. Room failures, and some game errors, also carry a stable `code` — **match on `code`, never on `message` text**, and treat anything else as "show a friendly failure to the player":

| Message type | Payload | When |
|---|---|---|
| `error` | `{ "message": "...", "code": "..."? }` | General errors (not authenticated, game not in progress, internal errors, some game errors) |
| `room_error` | `{ "message": "...", "code": "..."? }` | Room create/join failures |
| `auth_failure` | `{ "message": "..." }` | Authentication failures (invalid/expired token) |

| `code` | Meaning |
|---|---|
| `ROOM_FULL` | Room is full |
| `ROOM_NOT_FOUND` | No room with that id or join code |
| `RACE_IN_PROGRESS` | `typing_race`: the race has started, so only rejoins are allowed (also on `room_update` mid-race) |
| `GAME_IN_PROGRESS` | The game has started and the room no longer takes new players |
| `CANNOT_JOIN` | The game refused the join (message says why) |
| `BAD_PASSWORD` | Wrong room password |
| `BAD_REJOIN_TOKEN` | Rejoin token wrong, expired, or presented by a different user |
| `TOO_MANY_ATTEMPTS` | 10 wrong join codes in a minute on this connection; wait a minute |
| `ACCESS_DENIED` | This game can only be played from its own website / after signing in through the game |
| `NOT_HOST` | Only the host can do that (`room_update`) |
| `BAD_METADATA` | `room_update` needs a small JSON object |

Common messages you will see while integrating:

- `"Must be authenticated to create a room"` — you sent `room_create` before `auth_success`
- `"Game not in progress"` — you sent a `game_action` before `game_start`
- `"Unknown game type: xyz"` — check the [game type string](#game-types)
- `"Game not in progress"` never appears for `typing_race` (relay rooms accept actions immediately)

Rate limiting: clients sending messages excessively fast are throttled by server middleware; excess messages are dropped. Keep game actions at a sane rate (e.g. ≤ 10–20 msgs/sec).

Oversized messages: the server caps incoming WebSocket messages at **1 MiB**; larger frames close the connection.

---

## Full Message Reference

### Client → Server

| Type | Payload | Notes |
|------|---------|-------|
| `auth` | `{ token? }` or `{ username?, guestId? }` | Required before anything else |
| `room_create` | `{ gameType, options?: { maxPlayers?, isPrivate?, password?, gameMode?, metadata? }, playerData? }` | Auto-joins creator |
| `room_join` | `{ roomId \| joinCode, password?, playerData?, rejoinToken? }` | `rejoinToken` takes back a held seat |
| `room_leave` | — | Leaves at once (no seat hold) |
| `room_list` | `{ gameType?, gameMode?, hasSpace? }` | |
| `room_update` | `{ metadata }` | `typing_race` only: host changes room settings outside a race |
| `player_ready` | `{ ready: boolean, playerData? }` | Omitting `ready` defaults to `true` |
| `game_action` | `{ type: "<action>", data: { ... } }` | **Action name in `payload.type`** |
| `matchmake_request` | `{ gameType, gameMode?, skill? }` | |
| `matchmake_cancel` | — | |
| `ping` | — | Optional; server replies `pong` |

### Server → Client

| Type | Payload | Notes |
|------|---------|-------|
| `welcome` | `{ clientId, sessionId, serverTime }` | Save `clientId` — it identifies you in player events |
| `auth_success` | `{ userId, username, sessionId }` | |
| `auth_failure` | `{ message }` | |
| `room_created` | Room info `{ id, name, gameType, state, playerCount, maxPlayers, isPrivate, hasPassword, createdAt, metadata, joinCode? }` + `playerId`, `players`, `rejoinToken?` | Room ID is `payload.id` (a UUID) |
| `room_joined` | `{ room: <room info + players>, state: <game state>, playerId, rejoinToken?, rejoined? }` | Also sent unprompted after server-side matchmaking joins |
| `room_left` | — | |
| `room_list` | `{ rooms: [<room info>] }` | No players or names |
| `room_updated` | `{ metadata }` | `typing_race`: the host changed room settings |
| `room_error` | `{ message, code? }` | See [error codes](#error-handling) |
| `room_closed` | `{ reason }` | |
| `player_joined` | Player object, e.g. `{ id, username, isReady, joinedAt, data, ... }` | `id` = that player's room player id; exact fields vary by game |
| `player_left` | `{ playerId }` | |
| `player_disconnected` | `{ playerId, holdMs }` | Seat held for a rejoin (games that hold seats) |
| `player_reconnected` | `{ playerId }` | That player rejoined |
| `player_ready` | `{ playerId, ready, data? }` | `data` = that player's info, in games that carry it |
| `game_start` | `{ state }` | |
| `game_end` | `{ results }` | Game-specific results shape |
| `state_full` | `{ state, sequence }` | Full state snapshot |
| `state_patch` | `{ patches: [{op, path, value?}], sequence }` | JSON-patch-style deltas |
| `matchmake_started` | `{ ticketId, gameType, estimatedWait }` | |
| `matchmake_found` | `{ roomId, gameType, gameMode? }` | You must then send `room_join` |
| `matchmake_timeout` | `{ gameType, gameMode?, message }` | |
| `error` | `{ message, code? }` | |
| `pong` | — (top-level `timestamp`) | |
| `admin_message` | any | Server-operator broadcast; safe to display or ignore |

Games may define additional message types (see below). Unknown message types should be ignored gracefully by your client.

---

## Game Types

| Game Type string | Category | Players | Description |
|-----------|----------|---------|-------------|
| `lightning_round` | Trivia | 2–8 | Fast-paced trivia with categories, streaks, multipliers |
| `time_quest` | Trivia | 2–4 | Chronological ordering (base trivia rules for now) |
| `number_munchers` | Real-time | 1–4 | Math grid movement (base movement rules for now) |
| `panic_attack` | Host relay | 2–7 | Panic Attack (Xogos) — host-authoritative relay, signed players only — see below |
| `panic_attack_test` | Host relay | 2–7 | Pre-launch test copy of `panic_attack` (also allows guest auth + localhost) |
| `historical_conquest` | Relay | 2–4 | Card battle game (Historical Conquest: The Digital, lockstep client) — see below |
| `geotag` | Real-time | 2–8 | Geography chase game (hunt art thieves across the globe) |
| `typing_race` | Relay | 2–8 | Typing race relay (Turbo Type) — see below |

### `typing_race` — relay room (simplest integration)

A lightweight relay: the server does not simulate the race, it validates, relays, and ranks. **Actions are accepted as soon as players are in the room** (no waiting for `game_start`), and this game type leniently accepts the action name in `payload.type` OR `payload.action`, with data in `payload.data` or flat in the payload.

| Action | Data | Notes |
|---|---|---|
| `race_setup` | `{ text, startAt?, ...extras }` | **Host (room creator) only.** Sets the sentence + start time; also used for rematch. Other fields (e.g. `typingMode`, `length`, `difficulty`, `cars`) are passed through to everyone in `state_update` (up to 8 KB) |
| `progress` | `{ position, wpm, accuracy, carId? }` | Send as the player types; values are clamped server-side |
| `finish` | `{ time, wpm, accuracy }` | Crossed the line; place assigned by arrival order |
| `finish` | `{ dnf: true, position, wpm, accuracy }` | Ended early: keeps the real `position`, counts as done, ranked after every finisher |

Broadcasts: every action (and every join, ready, drop and rejoin) triggers `state_update { state: { ...raceSetupExtras, status, text, startAt, players: [ { id, username, position, wpm, accuracy, finished, dnf, connected, data } ] } }`. The race ends when every player is done (finished or DNF), or `finishGraceMs` after the first real finisher — default 15 s, set per room with `room_create { options: { finishGraceMs } }`, max 300000 (5 min). Then `game_end { results: { standings: [ { id, username, place, wpm, accuracy, time, finished, dnf, data } ] } }`. Unknown action names get a real `error` reply.

**Classroom rooms.** Every `typing_race` room gets a 6-letter `joinCode` and is **hidden from `room_list`** unless the host sends `isPrivate: false` in `room_create` options. Once `race_setup` starts a race, new players get `room_error { code: "RACE_IN_PROGRESS" }` until it ends; only rejoins are let in.

**Player info (`carId`).** Send `carId` in `player_ready { ready, carId }` (or as `playerData: { carId }` in `room_create`/`room_join`, or in `progress` data). It appears as `data.carId` on that player everywhere players are listed, and as `carId` in the `player_ready` broadcast. Only `carId` is kept (a short id: letters, digits, `.`, `-`, `_`).

**Room settings.** The host can change `metadata` in the lobby or between races: `{ "type": "room_update", "payload": { "metadata": { "length": "short" } } }` → everyone gets `room_updated { metadata }` (merged with the existing settings; up to 2 KB). From a non-host → `error { code: "NOT_HOST" }`; during a race → `error { code: "RACE_IN_PROGRESS" }`.

**Rejoin.** A dropped racer's seat and progress are held for **90 s** (see [Reconnection](#heartbeat--reconnection)). If they don't come back, they are a DNF at their last position.

**Access (student privacy).** Only `https://turbotype.myxogos.com` and `https://main.d3hnzwbzrpohxp.amplifyapp.com` may connect (plus `http://localhost:5173` on the test server); no IP addresses are logged. Players may sign in as a guest or with a token from Turbo Type's backend — HS256 `{ sub, name, game: "typing_race", aud: "gameondude", iat, exp }`, at most 15 minutes old, sent as `auth { token }`. When we switch on "token required", guests are refused with `ACCESS_DENIED`.

### `historical_conquest` — Historical Conquest: The Digital (pure relay)

Since July 2026, `historical_conquest` is a **pure relay room**. The HC client is lockstep — every device runs the full game logic — so the server does **no** simulation, **no** turn order, **no** setup phase, and **no** action validation. Min 2 / max 4 players; no server-side bots.

**Every `game_action` a player sends is forwarded to the other players in the room immediately**, as soon as players are present (no `game_start` required, nothing is ever rejected with "Not your turn"). The action name may be in `payload.type` or `payload.action`, or absent entirely — the payload relays regardless.

What the *other* players receive:

```json
{
  "type": "game_action",
  "payload": {
    "type": "<action name or null>",
    "action": "<same value — alias>",
    "playerId": "<sender connection id>",
    "username": "<sender display name>",
    "data": "<payload.data if nested, otherwise the whole payload as sent>",
    "timestamp": 1784800000000
  }
}
```

By default the sender does **not** receive its own action back (lockstep clients apply locally before sending; set `echoToSender: true` in `room_create` options if you want the echo). `playerId` is filled in by the server, so it can be trusted for seat checks. To send to **one** player only (e.g. the host resending `mp_state` to a player who rejoined), add `to: "<playerId>"` to the `game_action` payload.

**Private games:** `room_create { gameType: "historical_conquest", options: { isPrivate: true, maxPlayers: 2 } }` → `room_created` carries a 6-letter `joinCode`. Private games **never** appear in `room_list`, their `name` is `"Private game"` (it never contains the room id), and players join with `room_join { joinCode }` or `room_join { roomId }` (invite links). **Public rooms** (`isPrivate: false`, e.g. the Waiting Room with `metadata: { hcWaitingRoom: true }`) are listed with their `metadata` exactly as sent and have no code.

**Roster and player info.** `room_created.players` / `room_joined.room.players` = `[{ id, username, isReady, joinedAt, connected, data }]`, join order, creator first; `player_joined` has the same shape (no `userId`/`sessionId`). Send `playerData: { uid, rating, wins, losses }` in `room_create`, `room_join` or `player_ready`; only those four fields are kept (`uid` up to 64 characters of letters, digits, `.`, `:`, `-`, `_`; numbers rounded) and they appear as `data` on that player.

**Rejoin.** A dropped player's seat is held for **60 s** (see [Reconnection](#heartbeat--reconnection)); after that the others get `player_left` (treat as a forfeit).

**Access (student privacy).** Only `https://historicalconquest.org`, `https://www.historicalconquest.org`, `https://game.historicalconquest.org`, `https://academy.historicalconquest.org` and `https://master.d17xq1hcij90qc.amplifyapp.com` may connect (plus `http://localhost:8000` on the test server); no IP addresses are logged.

Matchmaking still works if you want it (pairs 2 humans, `matchmake_timeout` after ~20 s), but it is not required. Server-side bots for HC were retired in July 2026 — the bot framework remains available as an opt-in for other games (see below).

### `panic_attack` — Panic Attack (host-authoritative relay, K-12)

Live since October 2026. The **host's** browser runs the match; the server routes messages with rules that keep secret roles secret and keep strangers from messaging children. Verified end-to-end by `test-panic-attack-production.js`.

**Who can play.** Players never sign in to Game On Dude!. Panic Attack's backend signs a short-lived HS256 JWT with the shared `PANIC_ATTACK_TOKEN_SECRET` and the game sends it as `auth { token }`:

```json
{ "sub": "<Xogos student id>", "name": "<first name, optional>", "game": "panic_attack", "aud": "gameondude", "iat": 1792000000, "exp": 1792000300 }
```

`exp` is required and the token must be under 15 minutes old when used (it is only checked at `auth`; the connection stays valid afterwards). Only the first word of `name` is kept. Guest auth, other tokens, and browsers whose `Origin` is not `https://panicattack.myxogos.com` or `https://main.dwi7f9whnjmat.amplifyapp.com` are refused for `panic_attack` (`room_error` / `error`: "Please sign in through the game to play online" / "This game can only be played from its own website"). `panic_attack_test` is identical but also accepts guest auth and `http://localhost:*` / `http://127.0.0.1:*`.

**Private room (friends).** `room_create { gameType: "panic_attack", options: { gameMode: "classic" | "hidden" } }` → `room_created` carries `joinCode` (5 consonants, e.g. `"BKTMZ"`) and `hostId`. Friends send `room_join { joinCode }` (case-insensitive). Wrong codes → `room_error "Room not found"`; 10 wrong codes in a minute → throttled. Panic Attack rooms **never** appear in `room_list`.

**Quick Match (strangers).** `matchmake_request { gameType: "panic_attack", gameMode }`. Queues are per `gameMode`. When the 2nd player queues, a 20 s countdown starts (`matchmake_update { playersFound, minPlayers, maxPlayers, startsAt, startsInMs }` is sent whenever it changes); the match starts when it ends, or at once with 7. Players are joined **by the server** — each receives `matchmake_found` then `room_joined`; do not send `room_join`. A player alone for 2 minutes gets `matchmake_timeout`. Quick Match rooms have no code, no names (`name: null`) and no chat.

**Host.** The first player in (the creator, or the first player queued). `room_created.hostId`, `room_joined.room.hostId` and `room_joined.state.hostId` all name it. `room_joined.state` = `{ phase: "lobby"|"playing", hostId, joinCode, isPrivate, players: [{ id, name, isHost }] }`; `player_joined` payload = `{ id, name, isHost }` (no userId/sessionId). If the host leaves, everyone gets `room_closed { reason: "host_left", message: "The host left." }`. If a guest leaves, the others get `player_left { playerId }`.

**Routing** — send `game_action { type, data, to? }`:

| Sender | `to` | Delivered to |
|---|---|---|
| Host | absent | every other player |
| Host | `"<playerId>"` | that player only (unknown id → `error` code `BAD_TARGET`) |
| Guest | ignored | **the host only** |

Received: `game_action { type, action, playerId, fromHost, data, timestamp, sequence }`. Nobody gets their own action back. Host action `start` locks the room (later joins → "This match has already started"); host action `end` unlocks it (rematch). Routing works from the moment players are in the room (lobby messages too). Rate limit is 100 messages/s per connection; max message 1 MiB.

**Quick-chat (private rooms only, server-checked).** `game_action { type: "chat", data: { phrase, who?, where? } }` with `phrase` ∈ `follow help panic onit fuse nice thanks sorry gg go saw with`, `who` ∈ `red blue purple pink yellow green white`, `where` an integer 0–60. Anything else is stripped or rejected (`error` code `CHAT_REJECTED`); one message per 1.2 s per player. Approved chat goes to **everyone including the sender** with `serverChecked: true`.

### Server-side bot opponents (opt-in for any game)

The platform can spawn an AI opponent into a room when no human match is found — the bot joins as a normal player (`player_joined`), readies up, and plays your game. This requires the Game On Dude! team to implement a bot for your game's rules (a full reference implementation exists). If you'd rather keep control, handle `matchmake_timeout` in your client and run bots locally. Request bot support via the contact flow below.

### `lightning_round` — trivia actions

```json
{ "type": "game_action", "payload": { "type": "select_category", "data": { "categoryId": "..." } } }
{ "type": "game_action", "payload": { "type": "answer", "data": { "answerId": "..." } } }
```

### Adding YOUR game

Don't see your game here? Integration usually takes one of two forms:

1. **Relay room** (like `typing_race`) — your clients run the game logic; the server relays actions, tracks players, and declares results. Cheapest to add: tell us your action names and payloads and we register a game type for you.
2. **Simulated room** — the server runs authoritative game logic (anti-cheat, bots, server-side scoring). Needs a design conversation.

Contact us via [www.gameonguy.com/contact](https://www.gameonguy.com/contact) with: your game name, action list (exact JSON payloads your client will send — copy real captured messages, don't paraphrase), player counts, and whether you need bots.

---

## Unity Integration (C#)

### Setup

1. Get the Game On Dude! Unity SDK (`unity-sdk/*.cs` files) and copy into `Assets/Scripts/GameOn/`
2. Install **NativeWebSocket**: Package Manager → "+" → Add package from git URL → `https://github.com/endel/NativeWebSocket.git`
3. Install **Newtonsoft.Json**: Package Manager → Add by name → `com.unity.nuget.newtonsoft-json`
4. Add `GameOnNetworkManager` to a GameObject in your scene

> **WebGL note:** WebGL builds cannot use raw sockets or Steam networking — WebSocket (this SDK) is the correct transport. Standalone builds can also use it.

### Basic example

```csharp
using UnityEngine;
using GameOn.Multiplayer;

public class MultiplayerManager : MonoBehaviour
{
    private GameOnNetworkManager network;

    async void Start()
    {
        network = GameOnNetworkManager.Instance;
        network.ServerUrl = "wss://multiplayer.gameonguy.com/ws";

        network.OnConnected += OnConnected;
        network.OnRoomJoined += OnRoomJoined;
        network.OnGameStateUpdate += OnGameStateUpdate;
        network.OnPlayerJoined += OnPlayerJoined;
        network.OnGameStart += OnGameStart;
        network.OnGameEnd += OnGameEnd;

        await network.Connect();
    }

    void OnConnected()
    {
        // Use a stable per-device id so the player keeps their identity
        network.AuthenticateAsGuest("Player" + Random.Range(1000, 9999));
    }

    public async void CreateRoom()
    {
        await network.CreateRoom("lightning_round", new RoomOptions {
            MaxPlayers = 8,
            IsPrivate = false
        });
    }

    public async void JoinRoom(string roomId) => await network.JoinRoom(roomId);

    public void SetReady(bool ready) => network.SetReady(ready);

    // SendGameAction sends { type: <action>, data: <data> } — the canonical shape
    public void SendAnswer(string answerId)
        => network.SendGameAction("answer", new { answerId });

    void OnRoomJoined(RoomInfo room)   => Debug.Log($"Joined room: {room.RoomId}");
    void OnPlayerJoined(PlayerInfo p)  => Debug.Log($"{p.Username} joined!");
    void OnGameStart(GameState state)  => Debug.Log("Game starting!");
    void OnGameStateUpdate(GameState s) { /* update UI */ }
    void OnGameEnd(GameResults r)      => Debug.Log("Game over!");
}
```

For trivia/turn-based/movement helpers see `GameOnTriviaManager`, `GameOnTurnBasedManager`, `GameOnMovementManager`, and `docs/UNITY_INTEGRATION.md` (Photon migration guide).

---

## Web Integration (JavaScript/TypeScript)

### Minimal, correct client

```typescript
type Handler = (payload: any) => void;

class GameOnClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Handler>();
  public clientId: string | null = null;

  readonly serverUrl = 'wss://multiplayer.gameonguy.com/ws';

  on(type: string, handler: Handler) { this.handlers.set(type, handler); return this; }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.serverUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'welcome') this.clientId = msg.payload.clientId;
        this.handlers.get(msg.type)?.(msg.payload);
      };
      this.ws.onclose = (event) => {
        this.handlers.get('__close')?.({ wasClean: event.wasClean });
      };
    });
  }

  private send(type: string, payload?: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload === undefined ? { type } : { type, payload }));
    }
  }

  // --- Auth ---
  authenticateAsGuest(username: string, guestId: string) {
    this.send('auth', { username, guestId });
  }
  authenticateWithToken(token: string) { this.send('auth', { token }); }

  // --- Rooms ---
  createRoom(gameType: string, options?: { maxPlayers?: number; isPrivate?: boolean; password?: string }) {
    this.send('room_create', { gameType, options });
  }
  joinRoom(roomId: string, password?: string) { this.send('room_join', { roomId, password }); }
  leaveRoom() { this.send('room_leave'); }
  listRooms(gameType?: string) { this.send('room_list', { gameType }); }

  // --- Game ---
  setReady(ready = true) { this.send('player_ready', { ready }); }

  /** Canonical action shape: action name in payload.type, params in payload.data */
  sendGameAction(actionType: string, data: any) {
    this.send('game_action', { type: actionType, data });
  }

  // --- Matchmaking ---
  findMatch(gameType: string, gameMode?: string) { this.send('matchmake_request', { gameType, gameMode }); }
  cancelMatchmaking() { this.send('matchmake_cancel'); }

  disconnect() { this.ws?.close(); }
}

export default GameOnClient;
```

### Usage example (covers all the shape gotchas)

```typescript
const client = new GameOnClient();

client
  .on('auth_success', (p) => {
    console.log('Authed as', p.userId);          // e.g. "guest_device-42"
    client.createRoom('typing_race', { maxPlayers: 4 });
  })
  .on('room_created', (room) => {
    console.log('Room id:', room.id);            // UUID — payload.id, not payload.roomId
  })
  .on('room_joined', (p) => {
    console.log('Joined', p.room.id);            // room info is under payload.room
    console.log('Current state', p.state);       // game state is under payload.state
    client.setReady(true);
  })
  .on('player_joined', (player) => {
    console.log(player.username, 'joined');      // player.id === their connection id
  })
  .on('matchmake_found', (p) => {
    client.joinRoom(p.roomId);                   // human match: YOU must join
    // bot-fallback match: room_joined arrives directly instead — handle both
  })
  .on('game_start', (p) => console.log('Go!', p.state))
  .on('state_full',  (p) => render(p.state))
  .on('state_patch', (p) => applyPatches(p.patches))
  .on('state_update',(p) => render(p.state))     // game-specific (typing_race)
  .on('game_end', (p) => showResults(p.results))
  .on('error',      (p) => console.warn('Server error:', p.message))
  .on('room_error', (p) => console.warn('Room error:', p.message))
  .on('__close', ({ wasClean }) => { if (!wasClean) setTimeout(reconnect, 3000); });

await client.connect();
client.authenticateAsGuest('WebPlayer', 'device-42');
```

---

## Security Notes

For integrators:

- **Always `wss://`** in production. Plain `ws://` is unencrypted and browsers block it from HTTPS pages anyway.
- **Never trust other clients' data.** State relayed via relay rooms (e.g. `typing_race` progress) is client-reported; display it, but treat server-declared `game_end` standings as authoritative.
- **Don't embed JWTs in shipped clients.** Guest auth is the right choice for anonymous play; JWT is for players logged into your backend.
- Message limits: 1 MiB max per message; rate limiting applies. A well-behaved game client is nowhere near either limit.

Server-side (for the record): TLS 1.3/1.2 at the load balancer, guest IDs namespaced (`guest_` prefix) so they can't collide with registered user IDs, input sanitization on identities, rate-limiting middleware, and payload caps.

---

## Integration Checklist

Before you say "it doesn't work", verify each of these — they cover every integration failure we've seen so far:

- [ ] Connecting to exactly `wss://multiplayer.gameonguy.com/ws` (not `ws://`, not `*.elasticbeanstalk.com`)
- [ ] `https://multiplayer.gameonguy.com/health` returns `{"status":"ok",...}` from your network
- [ ] You wait for `auth_success` before sending `room_create` / `room_join` / `matchmake_request`
- [ ] Game actions use `payload.type` for the action name (unless integrating `typing_race`)
- [ ] You read the room ID from `room_created` → `payload.id`
- [ ] You read `room_joined` → `payload.room` and `payload.state` (nested, not flat)
- [ ] You handle `room_joined` arriving WITHOUT a prior `room_join` (matchmaking bot fallback)
- [ ] You match yourself in player lists using `clientId` from `welcome`
- [ ] You listen for `error`, `room_error`, and `auth_failure`, branch on `code` where present, and surface a friendly message
- [ ] Your reconnect logic re-authenticates with the same `guestId`
- [ ] Browser DevTools → Network → WS shows the socket and its frames (your first debugging stop)

---

*Last verified against server source: October 15, 2026 (Phase 16 — panic_attack section added)*
*Game On Dude! — www.gameonguy.com — production `wss://multiplayer.gameonguy.com/ws`*
