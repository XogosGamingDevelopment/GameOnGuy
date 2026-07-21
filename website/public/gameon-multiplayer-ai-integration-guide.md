# Game On Dude! Multiplayer — AI Integration Guide

> **Purpose**: Upload this document to an AI coding assistant (Claude Code, GitHub Copilot, Cursor, etc.) to enable it to correctly integrate your game client with the Game On Dude! multiplayer server. Every message shape in this document is verified against the running server — an AI assistant following this guide will generate working code.
>
> **You integrate as a CLIENT.** Game On Dude! hosts and operates the server. Your game connects over WebSocket, and the Game On Dude! team registers a game type for you on the server side (see "Getting your game registered" at the end).

---

## Connection Facts (memorize these)

| | |
|---|---|
| **Production WebSocket** | `wss://multiplayer.gameonguy.com/ws` |
| **Health check** | `https://multiplayer.gameonguy.com/health` → `{"status":"ok","clients":N}` |
| **Protocol** | JSON text messages over WebSocket |
| **Message envelope** | `{ "type": "...", "payload": { ... } }` |

⚠️ **Critical**: connect to exactly `wss://multiplayer.gameonguy.com/ws`. Never use an `*.elasticbeanstalk.com` hostname — the TLS certificate will not match and the connection hangs/fails. This single mistake has cost integrating teams days.

Server→client messages also include `timestamp` (server epoch ms) and `sequence` (per-connection counter) at the top level.

---

## The Complete Client Protocol

### 1. Connect and authenticate

```
open wss://multiplayer.gameonguy.com/ws
← { "type": "welcome", "payload": { "clientId": "<uuid>", "sessionId": "<uuid>", "serverTime": 1750000000000 } }
→ { "type": "auth", "payload": { "username": "PlayerName", "guestId": "stable-device-id" } }
← { "type": "auth_success", "payload": { "userId": "guest_stable-device-id", "username": "PlayerName", "sessionId": "<uuid>" } }
```

- **Save `clientId` from `welcome`** — it's how you recognize yourself in player lists and results.
- Guest auth needs no account. The server prefixes your `guestId` with `guest_` and sanitizes it; the same `guestId` always yields the same `userId`.
- Registered users authenticate with `{ "type": "auth", "payload": { "token": "<jwt>" } }` instead.
- Failure: `{ "type": "auth_failure", "payload": { "message": "..." } }`.
- **You must authenticate before any room or matchmaking request.**

### 2. Create or join a room

```
→ { "type": "room_create", "payload": { "gameType": "your_game_type", "options": { "maxPlayers": 4, "isPrivate": false } } }
← { "type": "room_created", "payload": { "id": "<room-uuid>", "gameType": "...", "state": "waiting", "playerCount": 1, "maxPlayers": 4, "isPrivate": false, "hasPassword": false, "createdAt": 1750000000000 } }
```

- Room IDs are **UUIDs** in `payload.id` (not short codes, not `payload.roomId`).
- The creator is **auto-joined** — do not send `room_join` after `room_create`.

```
→ { "type": "room_join", "payload": { "roomId": "<room-uuid>" } }
← { "type": "room_joined", "payload": { "room": { <room info> }, "state": { <game state> } } }
```

- Note the nesting: room info under `payload.room`, game state under `payload.state`.
- Everyone already in the room receives `{ "type": "player_joined", "payload": { "id": "<their clientId>", "username": "...", "isReady": false, ... } }`.
- Other lobby messages: `room_leave` (→ `room_left`; others get `player_left { playerId }`), `room_list { gameType? }` (→ `room_list { rooms: [...] }`), `room_closed { reason }` when a room is disposed.
- Failures come back as `{ "type": "room_error", "payload": { "message": "..." } }`.

### 3. Ready up and start

```
→ { "type": "player_ready", "payload": { "ready": true } }
← { "type": "player_ready", "payload": { "playerId": "...", "ready": true } }   (broadcast to room)
← { "type": "game_start", "payload": { "state": { ... } } }                      (when enough players are ready)
```

### 4. Send game actions — THE SHAPE MATTERS

The action name goes in **`payload.type`**, parameters in **`payload.data`**:

```
→ { "type": "game_action", "payload": { "type": "play_card", "data": { "cardId": "abc" } } }
```

⚠️ **The most common integration bug**: putting the action name in `payload.action` instead of `payload.type`. For most game types the server only reads `payload.type` and silently ignores anything else. Always use `payload.type` + `payload.data`.

Actions sent before `game_start` are rejected with `error: "Game not in progress"` — unless your game type is registered as a *relay room* (see below), which accepts actions as soon as players are present.

### 5. Receive state

```
← { "type": "state_full",  "payload": { "state": { ... }, "sequence": 12 } }
← { "type": "state_patch", "payload": { "patches": [ { "op": "replace", "path": "/score", "value": 5 } ], "sequence": 13 } }
```

Individual game types may broadcast their own event messages too (e.g. relay rooms broadcast `state_update` after every action). Your client should ignore unknown message types gracefully.

### 6. Game end

```
← { "type": "game_end", "payload": { "results": { ... } } }
```

`results` shape is defined per game type when your game is registered.

### 7. Matchmaking (instead of manual room codes)

```
→ { "type": "matchmake_request", "payload": { "gameType": "your_game_type" } }
← { "type": "matchmake_started", "payload": { "ticketId": "...", "gameType": "...", "estimatedWait": 20 } }
```

Then ONE of:

- **Match found** → `{ "type": "matchmake_found", "payload": { "roomId": "<uuid>", "gameType": "..." } }` — your client must then send `room_join` with that `roomId`.
- **Timeout** → `{ "type": "matchmake_timeout", "payload": { "gameType": "...", "message": "Could not find a match. Please try again." } }` — typical handling: offer single-player / local-bot mode in your client.
- **Bot fallback** (only for games that opt into server-side bots): the server auto-creates a room, **auto-joins you** (you receive `room_joined` without having sent `room_join`), auto-readies you, and a server bot joins and plays. Your client must tolerate an unprompted `room_joined` if your game uses this feature.

Cancel with `{ "type": "matchmake_cancel" }`.

### 8. Heartbeat, limits, errors

- Server pings every 30 s (WebSocket protocol ping — browsers/libraries answer automatically); silent connections are dropped at 60 s.
- Optional app-level RTT check: `{ "type": "ping" }` → `{ "type": "pong", "timestamp": ... }`.
- Max message size: **1 MiB**. Rate limiting applies — keep under ~10–20 messages/sec.
- All errors are plain-language: `error { message, code? }`, `room_error { message }`, `auth_failure { message }`. There is no numeric error-code table.
- **No automatic reconnect/session restore**: on unclean close, reconnect → re-auth (same `guestId`) → `room_join` your room again.

---

## Minimal JavaScript/TypeScript Client (copy-paste ready)

```typescript
class GameOnClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, (payload: any) => void>();
  public clientId: string | null = null;

  readonly serverUrl = 'wss://multiplayer.gameonguy.com/ws';

  on(type: string, handler: (payload: any) => void) { this.handlers.set(type, handler); return this; }

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
      this.ws.onclose = (event) => this.handlers.get('__close')?.({ wasClean: event.wasClean });
    });
  }

  private send(type: string, payload?: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload === undefined ? { type } : { type, payload }));
    }
  }

  authenticateAsGuest(username: string, guestId: string) { this.send('auth', { username, guestId }); }
  authenticateWithToken(token: string) { this.send('auth', { token }); }
  createRoom(gameType: string, options?: object) { this.send('room_create', { gameType, options }); }
  joinRoom(roomId: string, password?: string) { this.send('room_join', { roomId, password }); }
  leaveRoom() { this.send('room_leave'); }
  listRooms(gameType?: string) { this.send('room_list', { gameType }); }
  setReady(ready = true) { this.send('player_ready', { ready }); }
  /** Canonical action shape: name in payload.type, params in payload.data */
  sendGameAction(actionType: string, data: any) { this.send('game_action', { type: actionType, data }); }
  findMatch(gameType: string) { this.send('matchmake_request', { gameType }); }
  cancelMatchmaking() { this.send('matchmake_cancel'); }
  disconnect() { this.ws?.close(); }
}
```

Usage:

```typescript
const client = new GameOnClient();
client
  .on('auth_success', (p) => client.findMatch('your_game_type'))
  .on('matchmake_found', (p) => client.joinRoom(p.roomId))
  .on('room_joined', (p) => { console.log('room', p.room.id, 'state', p.state); client.setReady(true); })
  .on('matchmake_timeout', () => startLocalSinglePlayerMode())
  .on('game_start', (p) => beginGame(p.state))
  .on('state_full', (p) => render(p.state))
  .on('state_patch', (p) => applyPatches(p.patches))
  .on('game_end', (p) => showResults(p.results))
  .on('error', (p) => console.warn(p.message))
  .on('room_error', (p) => console.warn(p.message))
  .on('__close', ({ wasClean }) => { if (!wasClean) setTimeout(reconnectAndReauth, 3000); });

await client.connect();
client.authenticateAsGuest('PlayerName', 'stable-device-id');
```

---

## Unity (C#) Integration

### Required packages

1. **NativeWebSocket** — Package Manager → "+" → Add package from git URL → `https://github.com/endel/NativeWebSocket.git`
2. **Newtonsoft.Json** — Package Manager → Add by name → `com.unity.nuget.newtonsoft-json`
3. The **Game On Dude! Unity SDK** (`GameOnClient.cs`, `GameOnNetworkManager.cs`, etc.) — provided by the Game On Dude! team; copy into `Assets/Scripts/GameOn/`

> **WebGL builds**: WebSocket is the only viable transport (no raw sockets, no Steam networking). This SDK works in WebGL, standalone, and mobile builds.

### Basic Unity client

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

        network.OnConnected += () =>
            network.AuthenticateAsGuest("Player" + Random.Range(1000, 9999));
        network.OnRoomJoined += (room) => Debug.Log($"Joined {room.RoomId}");
        network.OnPlayerJoined += (p) => Debug.Log($"{p.Username} joined");
        network.OnGameStart += (state) => Debug.Log("Game on!");
        network.OnGameStateUpdate += (state) => { /* update UI */ };
        network.OnGameEnd += (results) => Debug.Log("Game over");

        await network.Connect();
    }

    public async void FindMatch() => await network.FindMatch("your_game_type");
    public void Ready() => network.SetReady(true);

    // Sends { type: "<action>", data: <data> } — the canonical shape
    public void PlayCard(string cardId)
        => network.SendGameAction("play_card", new { cardId });
}
```

---

## Integration Checklist (give this to your AI assistant)

- [ ] Connect to exactly `wss://multiplayer.gameonguy.com/ws`
- [ ] Wait for `auth_success` before any room/matchmaking request
- [ ] Read room ID from `room_created` → `payload.id` (UUID)
- [ ] Read `room_joined` → `payload.room` and `payload.state` (nested)
- [ ] Put game action names in `payload.type`, params in `payload.data`
- [ ] Handle `matchmake_found` by sending `room_join`
- [ ] Handle `matchmake_timeout` (e.g. fall back to local single-player/bot mode)
- [ ] Tolerate unprompted `room_joined` (bot-fallback games only)
- [ ] Identify yourself in player lists via `clientId` from `welcome`
- [ ] Listen on `error`, `room_error`, `auth_failure` and surface `message`
- [ ] Reconnect logic: re-auth with the same `guestId`, rejoin room by ID
- [ ] Ignore unknown message types gracefully

---

## Getting Your Game Registered

Your game needs a **game type** registered on the server before `room_create`/`matchmake_request` will accept it. Two integration styles:

1. **Relay room** (fastest — days, not weeks): your clients run all game logic; the server provides rooms, matchmaking, player presence, and relays your actions to everyone in the room, then ranks/records results. Actions are accepted as soon as players are in the room. This fits card games, typing games, quiz games — anything where clients can be trusted or verify each other.
2. **Simulated room**: the server runs authoritative game logic (server-side validation, anti-cheat, scoring). Needs a short design conversation with the Game On Dude! team.

**Optional platform features you can request:**
- **Server-side bot opponents** — if no human match is found in ~20 s, the server spawns an AI opponent into the room and plays your game. Requires the Game On Dude! team to implement a bot for your game's rules (a reference implementation exists). Alternatively, handle `matchmake_timeout` in your client and run bots locally — many games prefer this.
- **Persistence** — match history, leaderboards, player stats.
- **Custom matchmaking** — skill-based matching, custom timeouts, minimum player counts.

**To register**, contact the Game On Dude! team via [www.gameonguy.com/contact](https://www.gameonguy.com/contact) with:
1. Game name and desired game type string (e.g. `my_card_game`)
2. Your exact action list — **copy real JSON messages your client will send**, don't paraphrase (e.g. `{ "type": "game_action", "payload": { "type": "play_card", "data": { "cardId": "abc" } } }`)
3. Min/max players
4. Relay or simulated, and any optional features (bots, persistence, matchmaking rules)

---

*Document Version: 2.0 — every message shape verified against server source*
*Last Updated: July 21, 2026*
*Game On Dude! — www.gameonguy.com — production `wss://multiplayer.gameonguy.com/ws`*
