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

Room IDs look like `"3f8a2c1e-9b4d-4e6a-8c7f-1d2e3f4a5b6c"`, not short codes. If your game shows a "room code" to players for friends to join, display/share the UUID (or use matchmaking instead). Room IDs arrive in `room_created` as `payload.id`.

### Create a room

```json
{
  "type": "room_create",
  "payload": {
    "gameType": "typing_race",
    "options": { "maxPlayers": 8, "isPrivate": false }
  }
}
```

The creator is **automatically joined** to the room — do not send `room_join` after creating.

**Response** (`payload` is the room info object):

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
    "isPrivate": false,
    "hasPassword": false,
    "createdAt": 1750000000000
  }
}
```

On failure (unknown game type, etc.): `{ "type": "room_error", "payload": { "message": "..." } }`

### Join a room

```json
{ "type": "room_join", "payload": { "roomId": "3f8a2c1e-...", "password": "optional" } }
```

**Response** — note the nesting: room info is under `payload.room`, game state under `payload.state`:

```json
{
  "type": "room_joined",
  "payload": {
    "room": { "id": "3f8a2c1e-...", "gameType": "typing_race", "playerCount": 2, "maxPlayers": 8, "state": "waiting" },
    "state": { }
  }
}
```

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

**Important:** the `id` in player events is the player's **connection id** (`clientId` from `welcome`), not their `userId`. Use `payload.clientId` from your own `welcome` message to recognize yourself in player lists and results.

### Leave / list

```json
{ "type": "room_leave" }
```
→ you receive `{ "type": "room_left" }`; others receive `{ "type": "player_left", "payload": { "playerId": "..." } }`

```json
{ "type": "room_list", "payload": { "gameType": "typing_race" } }
```
→ `{ "type": "room_list", "payload": { "rooms": [ { "id", "gameType", "playerCount", "maxPlayers", "state", ... } ] } }`

Private rooms are excluded from listings.

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

**B. Timeout with bot fallback** (~20 seconds, for games with bots — currently Historical Conquest): the server **auto-joins you** into a room — you receive `room_joined` directly (no `room_join` needed), you are auto-readied, a bot joins (`player_joined`), the bot readies, and the game starts. Handle `room_joined` arriving without having sent `room_join`.

**C. Timeout without bots:**

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

- **Reconnection**: there is no automatic session restore. If the socket drops, reconnect, re-authenticate (same `guestId` gives you the same identity), and rejoin your room by ID. Design your game to tolerate this.

```javascript
ws.onclose = (event) => {
  if (!event.wasClean) setTimeout(() => connectAndReauth(), 3000);
};
```

---

## Error Handling

Errors arrive as plain-language messages on three channels — there is **no numeric/string error-code table**; match on message text only for debugging, and treat any error as "show a friendly failure to the player":

| Message type | Payload | When |
|---|---|---|
| `error` | `{ "message": "...", "code": "..."? }` | General errors (not authenticated, game not in progress, internal errors). `code` is usually absent. |
| `room_error` | `{ "message": "..." }` | Room create/join failures (unknown game type, room full, wrong password, not found) |
| `auth_failure` | `{ "message": "..." }` | Authentication failures (invalid/expired token) |

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
| `room_create` | `{ gameType, options?: { maxPlayers?, isPrivate?, password?, gameMode? } }` | Auto-joins creator |
| `room_join` | `{ roomId, password? }` | |
| `room_leave` | — | |
| `room_list` | `{ gameType?, gameMode?, hasSpace? }` | |
| `player_ready` | `{ ready: boolean }` | Omitting `ready` defaults to `true` |
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
| `room_created` | Room info: `{ id, name, gameType, state, playerCount, maxPlayers, isPrivate, hasPassword, createdAt }` | Room ID is `payload.id` (a UUID) |
| `room_joined` | `{ room: <room info>, state: <game state> }` | Also sent unprompted after matchmaking bot fallback |
| `room_left` | — | |
| `room_list` | `{ rooms: [<room info>] }` | |
| `room_error` | `{ message }` | |
| `room_closed` | `{ reason }` | |
| `player_joined` | Full player state: `{ id, username, isReady, isConnected, joinedAt, data }` | `id` = that player's connection id |
| `player_left` | `{ playerId }` | |
| `player_ready` | `{ playerId, ready }` | |
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
| `panic_attack` | Real-time | 4–15 | Social deduction (base movement rules for now) |
| `historical_conquest` | Turn-based | 2–4 | Card battle game with full bot AI opponent support |
| `geotag` | Real-time | 2–8 | Geography chase game (hunt art thieves across the globe) |
| `typing_race` | Relay | 2–8 | Typing race relay (Turbo Type) — see below |

### `typing_race` — relay room (simplest integration)

A lightweight relay: the server does not simulate the race, it validates, relays, and ranks. **Actions are accepted as soon as players are in the room** (no waiting for `game_start`), and this game type leniently accepts the action name in `payload.type` OR `payload.action`, with data in `payload.data` or flat in the payload.

| Action | Data | Notes |
|---|---|---|
| `race_setup` | `{ text, startAt? }` | **Host (room creator) only.** Sets the sentence + start time; also used for rematch |
| `progress` | `{ position, wpm, accuracy }` | Send as the player types; values are clamped server-side |
| `finish` | `{ time, wpm, accuracy }` | Records finish; place assigned by arrival order |

Broadcasts: every action triggers `state_update { state: { status, text, startAt, players: [...] } }`. When all players finish (or 15 s after the first finisher), `game_end { results: { standings: [...] } }`. Unknown action names get a real `error` reply.

### `historical_conquest` — custom protocol + bots

Historical Conquest uses its own in-room message vocabulary (relayed via room messages) and has full bot AI: matchmake, and if no human appears in ~20 s a bot ("Rowan", "Parker", …) joins and plays a complete game. Integrators for this title should request the dedicated HC message-flow document ("Bot Lessons") — the generic `game_action` flow above does not cover it.

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
- [ ] You listen for `error`, `room_error`, and `auth_failure` and surface the `message`
- [ ] Your reconnect logic re-authenticates with the same `guestId`
- [ ] Browser DevTools → Network → WS shows the socket and its frames (your first debugging stop)

---

*Last verified against server source: July 21, 2026 (Phase 13)*
*Game On Dude! — www.gameonguy.com — production `wss://multiplayer.gameonguy.com/ws`*
