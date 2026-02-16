# Xogos Multiplayer - AI Integration Guide

> **Purpose**: This document is designed to be uploaded to AI code generators (Claude Code, GitHub Copilot, Cursor, etc.) to enable them to help you integrate your game with Xogos Multiplayer or create new multiplayer games from scratch.

---

## System Overview

Xogos Multiplayer is a TypeScript-based real-time multiplayer game server platform. It provides:

- **WebSocket-based communication** for real-time gameplay
- **Room-based architecture** where players join isolated game sessions
- **Automatic state synchronization** between server and clients
- **Client-side prediction** for responsive gameplay
- **Lag compensation** for fair hit detection
- **Unity SDK** for game client integration

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Xogos Server                            │
├─────────────────────────────────────────────────────────────┤
│  Clients ──► WebSocket Server ──► Room Manager ──► Rooms    │
│                                                             │
│  Room Types:                                                │
│  - TriviaRoom (quiz games, lightning rounds)                │
│  - RealTimeMovementRoom (action games, movement sync)       │
│  - TurnBasedRoom (card games, strategy games)               │
│  - Custom rooms (extend base Room class)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Server-Side Integration

### 1. Project Setup

```bash
# Install Xogos Multiplayer
npm install xogos-multiplayer

# Required peer dependencies
npm install ws uuid
```

### 2. Basic Server Configuration

```typescript
// server.ts
import { XogosServer } from 'xogos-multiplayer';
import { MyGameRoom } from './rooms/MyGameRoom';

const server = new XogosServer({
  port: 3000,
  // Optional: Redis for horizontal scaling
  redis: {
    host: 'localhost',
    port: 6379
  },
  // Optional: PostgreSQL for persistence
  database: {
    connectionString: process.env.DATABASE_URL
  }
});

// Register your game room
server.roomManager.registerGame('my_game', MyGameRoom, {
  minPlayers: 2,
  maxPlayers: 8,
  tickRate: 20  // Updates per second
});

// Start server
server.start();
```

### 3. Creating a Custom Game Room

```typescript
// rooms/MyGameRoom.ts
import { Room, Client, RoomConstructorOptions } from 'xogos-multiplayer';

// Define your game state interface
interface MyGameState {
  players: Map<string, PlayerState>;
  gamePhase: 'waiting' | 'playing' | 'ended';
  currentRound: number;
  scores: Record<string, number>;
}

interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  score: number;
  ready: boolean;
}

export class MyGameRoom extends Room<MyGameState> {
  // Called when room is created
  onCreate(options: RoomConstructorOptions): void {
    // Initialize game state
    this.setState({
      players: new Map(),
      gamePhase: 'waiting',
      currentRound: 0,
      scores: {}
    });

    // Register message handlers
    this.onMessage('player_ready', this.handlePlayerReady.bind(this));
    this.onMessage('player_action', this.handlePlayerAction.bind(this));
    this.onMessage('player_move', this.handlePlayerMove.bind(this));
  }

  // Called when a client joins
  onJoin(client: Client, options: { username?: string }): void {
    const player: PlayerState = {
      id: client.sessionId,
      name: options.username || `Player${this.clients.size}`,
      x: 0,
      y: 0,
      score: 0,
      ready: false
    };

    this.state.players.set(client.sessionId, player);
    this.state.scores[client.sessionId] = 0;

    // Notify all clients
    this.broadcast('player_joined', {
      playerId: client.sessionId,
      playerName: player.name
    });

    // Check if we can start
    this.checkGameStart();
  }

  // Called when a client leaves
  onLeave(client: Client, consented: boolean): void {
    this.state.players.delete(client.sessionId);
    delete this.state.scores[client.sessionId];

    this.broadcast('player_left', {
      playerId: client.sessionId
    });

    // Handle game state if player leaves mid-game
    if (this.state.gamePhase === 'playing' && this.state.players.size < 2) {
      this.endGame('not_enough_players');
    }
  }

  // Called every tick (based on tickRate)
  onTick(deltaTime: number): void {
    if (this.state.gamePhase !== 'playing') return;

    // Update game logic here
    // This runs at the configured tickRate (e.g., 20 times per second)
  }

  // Custom message handlers
  private handlePlayerReady(client: Client, data: { ready: boolean }): void {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.ready = data.ready;
      this.checkGameStart();
    }
  }

  private handlePlayerAction(client: Client, data: { action: string; payload?: any }): void {
    // Handle game-specific actions
    switch (data.action) {
      case 'attack':
        this.handleAttack(client, data.payload);
        break;
      case 'use_item':
        this.handleUseItem(client, data.payload);
        break;
    }
  }

  private handlePlayerMove(client: Client, data: { x: number; y: number }): void {
    const player = this.state.players.get(client.sessionId);
    if (player && this.state.gamePhase === 'playing') {
      // Validate movement
      if (this.isValidMove(player, data.x, data.y)) {
        player.x = data.x;
        player.y = data.y;
        // State sync happens automatically
      }
    }
  }

  private checkGameStart(): void {
    if (this.state.gamePhase !== 'waiting') return;

    const players = Array.from(this.state.players.values());
    const allReady = players.length >= 2 && players.every(p => p.ready);

    if (allReady) {
      this.startGame();
    }
  }

  private startGame(): void {
    this.state.gamePhase = 'playing';
    this.state.currentRound = 1;

    this.broadcast('game_started', {
      round: this.state.currentRound
    });
  }

  private endGame(reason: string): void {
    this.state.gamePhase = 'ended';

    // Calculate winner
    const winner = this.calculateWinner();

    this.broadcast('game_ended', {
      reason,
      winner,
      finalScores: this.state.scores
    });
  }

  private calculateWinner(): string | null {
    let maxScore = -1;
    let winner: string | null = null;

    for (const [playerId, score] of Object.entries(this.state.scores)) {
      if (score > maxScore) {
        maxScore = score;
        winner = playerId;
      }
    }

    return winner;
  }

  private isValidMove(player: PlayerState, x: number, y: number): boolean {
    // Add your movement validation logic
    const maxDistance = 10;
    const dx = x - player.x;
    const dy = y - player.y;
    return Math.sqrt(dx * dx + dy * dy) <= maxDistance;
  }

  private handleAttack(client: Client, payload: any): void {
    // Implement attack logic
  }

  private handleUseItem(client: Client, payload: any): void {
    // Implement item usage logic
  }
}
```

---

## Unity Client Integration

### 1. Install the Unity SDK

```
// Unity Package Manager → Add package from git URL:
https://github.com/xogos-gaming/unity-sdk.git
```

### 2. Basic Unity Client Setup

```csharp
// GameNetworkManager.cs
using UnityEngine;
using Xogos.Networking;
using System.Threading.Tasks;

public class GameNetworkManager : MonoBehaviour
{
    [Header("Network Settings")]
    [SerializeField] private string serverUrl = "ws://localhost:3000";
    [SerializeField] private string gameType = "my_game";

    private XogosNetworkManager networkManager;
    private Room currentRoom;

    async void Start()
    {
        networkManager = gameObject.AddComponent<XogosNetworkManager>();
        networkManager.ServerUrl = serverUrl;

        // Set up event handlers
        networkManager.OnConnected += OnConnected;
        networkManager.OnDisconnected += OnDisconnected;
        networkManager.OnError += OnError;

        // Connect to server
        await networkManager.Connect();
    }

    private void OnConnected()
    {
        Debug.Log("Connected to Xogos server!");
    }

    private void OnDisconnected(int code)
    {
        Debug.Log($"Disconnected from server. Code: {code}");
    }

    private void OnError(string error)
    {
        Debug.LogError($"Network error: {error}");
    }

    // Join or create a game room
    public async Task JoinGame(string username)
    {
        try
        {
            currentRoom = await networkManager.JoinOrCreate(gameType, new
            {
                username = username
            });

            SetupRoomHandlers();
            Debug.Log($"Joined room: {currentRoom.Id}");
        }
        catch (System.Exception e)
        {
            Debug.LogError($"Failed to join game: {e.Message}");
        }
    }

    // Join a specific room by ID (for private games)
    public async Task JoinRoomById(string roomId, string username)
    {
        try
        {
            currentRoom = await networkManager.JoinById(roomId, new
            {
                username = username
            });

            SetupRoomHandlers();
        }
        catch (System.Exception e)
        {
            Debug.LogError($"Failed to join room: {e.Message}");
        }
    }

    private void SetupRoomHandlers()
    {
        // State synchronization
        currentRoom.OnStateChange += OnStateChange;

        // Custom message handlers
        currentRoom.OnMessage<PlayerJoinedMessage>("player_joined", OnPlayerJoined);
        currentRoom.OnMessage<PlayerLeftMessage>("player_left", OnPlayerLeft);
        currentRoom.OnMessage<GameStartedMessage>("game_started", OnGameStarted);
        currentRoom.OnMessage<GameEndedMessage>("game_ended", OnGameEnded);
    }

    // Send messages to server
    public void SendReady(bool ready)
    {
        currentRoom?.Send("player_ready", new { ready = ready });
    }

    public void SendMove(Vector3 position)
    {
        currentRoom?.Send("player_move", new
        {
            x = position.x,
            y = position.z  // Unity Y is typically up, use Z for ground plane
        });
    }

    public void SendAction(string action, object payload = null)
    {
        currentRoom?.Send("player_action", new
        {
            action = action,
            payload = payload
        });
    }

    // Event handlers
    private void OnStateChange(GameState state)
    {
        // Update your game UI/objects based on state
        // This is called whenever the server state changes
        Debug.Log($"State updated. Phase: {state.gamePhase}, Players: {state.players.Count}");
    }

    private void OnPlayerJoined(PlayerJoinedMessage msg)
    {
        Debug.Log($"Player joined: {msg.playerName}");
        // Spawn player object, update UI, etc.
    }

    private void OnPlayerLeft(PlayerLeftMessage msg)
    {
        Debug.Log($"Player left: {msg.playerId}");
        // Remove player object, update UI, etc.
    }

    private void OnGameStarted(GameStartedMessage msg)
    {
        Debug.Log($"Game started! Round: {msg.round}");
        // Transition to gameplay, hide lobby UI, etc.
    }

    private void OnGameEnded(GameEndedMessage msg)
    {
        Debug.Log($"Game ended! Winner: {msg.winner}");
        // Show results screen, final scores, etc.
    }

    public void LeaveGame()
    {
        currentRoom?.Leave();
        currentRoom = null;
    }

    void OnDestroy()
    {
        LeaveGame();
        networkManager?.Disconnect();
    }
}

// Message classes for type-safe deserialization
[System.Serializable]
public class PlayerJoinedMessage
{
    public string playerId;
    public string playerName;
}

[System.Serializable]
public class PlayerLeftMessage
{
    public string playerId;
}

[System.Serializable]
public class GameStartedMessage
{
    public int round;
}

[System.Serializable]
public class GameEndedMessage
{
    public string reason;
    public string winner;
    public Dictionary<string, int> finalScores;
}

[System.Serializable]
public class GameState
{
    public string gamePhase;
    public int currentRound;
    public Dictionary<string, PlayerState> players;
    public Dictionary<string, int> scores;
}

[System.Serializable]
public class PlayerState
{
    public string id;
    public string name;
    public float x;
    public float y;
    public int score;
    public bool ready;
}
```

### 3. Player Controller with Network Sync

```csharp
// NetworkedPlayer.cs
using UnityEngine;
using Xogos.Networking;

public class NetworkedPlayer : MonoBehaviour
{
    [Header("Movement")]
    [SerializeField] private float moveSpeed = 5f;
    [SerializeField] private float sendRate = 0.05f; // 20 updates per second

    [Header("Interpolation")]
    [SerializeField] private float interpolationSpeed = 10f;

    private GameNetworkManager networkManager;
    private string playerId;
    private bool isLocalPlayer;
    private Vector3 targetPosition;
    private float lastSendTime;

    public void Initialize(string playerId, bool isLocal, GameNetworkManager netManager)
    {
        this.playerId = playerId;
        this.isLocalPlayer = isLocal;
        this.networkManager = netManager;
        this.targetPosition = transform.position;
    }

    void Update()
    {
        if (isLocalPlayer)
        {
            HandleLocalPlayerInput();
        }
        else
        {
            InterpolatePosition();
        }
    }

    private void HandleLocalPlayerInput()
    {
        // Get input
        float h = Input.GetAxis("Horizontal");
        float v = Input.GetAxis("Vertical");

        if (h != 0 || v != 0)
        {
            // Move locally (client-side prediction)
            Vector3 movement = new Vector3(h, 0, v) * moveSpeed * Time.deltaTime;
            transform.Translate(movement, Space.World);

            // Send to server at fixed rate
            if (Time.time - lastSendTime >= sendRate)
            {
                networkManager.SendMove(transform.position);
                lastSendTime = Time.time;
            }
        }
    }

    // Called when receiving state update from server
    public void UpdateFromServer(float x, float y)
    {
        targetPosition = new Vector3(x, transform.position.y, y);

        if (isLocalPlayer)
        {
            // Reconciliation: correct if too far from server position
            float distance = Vector3.Distance(transform.position, targetPosition);
            if (distance > 1f) // Threshold for correction
            {
                transform.position = Vector3.Lerp(transform.position, targetPosition, 0.5f);
            }
        }
    }

    private void InterpolatePosition()
    {
        // Smooth interpolation for remote players
        transform.position = Vector3.Lerp(
            transform.position,
            targetPosition,
            interpolationSpeed * Time.deltaTime
        );
    }
}
```

---

## Common Game Patterns

### Trivia Game Pattern

```typescript
// Server: TriviaGameRoom.ts
interface TriviaState {
  players: Map<string, TriviaPlayer>;
  currentQuestion: Question | null;
  questionStartTime: number;
  roundNumber: number;
  phase: 'lobby' | 'question' | 'results' | 'ended';
}

export class TriviaGameRoom extends Room<TriviaState> {
  private questions: Question[] = [];
  private questionTimer: NodeJS.Timeout | null = null;

  onCreate(options: RoomConstructorOptions): void {
    this.setState({
      players: new Map(),
      currentQuestion: null,
      questionStartTime: 0,
      roundNumber: 0,
      phase: 'lobby'
    });

    this.onMessage('submit_answer', this.handleAnswer.bind(this));
    this.loadQuestions(options.category);
  }

  private async loadQuestions(category: string): Promise<void> {
    // Load questions from database or config
    this.questions = await fetchQuestions(category, 10);
  }

  private startRound(): void {
    if (this.state.roundNumber >= this.questions.length) {
      this.endGame();
      return;
    }

    this.state.phase = 'question';
    this.state.currentQuestion = this.questions[this.state.roundNumber];
    this.state.questionStartTime = Date.now();

    // Clear previous answers
    this.state.players.forEach(p => {
      p.currentAnswer = null;
      p.answeredAt = null;
    });

    this.broadcast('question', {
      question: this.state.currentQuestion.text,
      answers: this.state.currentQuestion.answers,
      timeLimit: 15000
    });

    // Auto-advance after time limit
    this.questionTimer = setTimeout(() => {
      this.showResults();
    }, 15000);
  }

  private handleAnswer(client: Client, data: { answerIndex: number }): void {
    if (this.state.phase !== 'question') return;

    const player = this.state.players.get(client.sessionId);
    if (!player || player.currentAnswer !== null) return; // Already answered

    player.currentAnswer = data.answerIndex;
    player.answeredAt = Date.now();

    // Check if all players answered
    const allAnswered = Array.from(this.state.players.values())
      .every(p => p.currentAnswer !== null);

    if (allAnswered && this.questionTimer) {
      clearTimeout(this.questionTimer);
      this.showResults();
    }
  }

  private showResults(): void {
    this.state.phase = 'results';
    const correctIndex = this.state.currentQuestion!.correctIndex;

    this.state.players.forEach(player => {
      if (player.currentAnswer === correctIndex) {
        // Score based on speed
        const responseTime = player.answeredAt! - this.state.questionStartTime;
        const speedBonus = Math.max(0, 1000 - responseTime);
        player.score += 100 + Math.floor(speedBonus / 10);
      }
    });

    this.broadcast('results', {
      correctIndex,
      scores: this.getScoresObject()
    });

    // Next question after delay
    setTimeout(() => {
      this.state.roundNumber++;
      this.startRound();
    }, 5000);
  }
}
```

### Real-Time Action Game Pattern

```typescript
// Server: ActionGameRoom.ts
interface ActionState {
  players: Map<string, ActionPlayer>;
  projectiles: Projectile[];
  gameTime: number;
  phase: 'countdown' | 'playing' | 'ended';
}

export class ActionGameRoom extends Room<ActionState> {
  onCreate(options: RoomConstructorOptions): void {
    this.setState({
      players: new Map(),
      projectiles: [],
      gameTime: 0,
      phase: 'countdown'
    });

    this.onMessage('move', this.handleMove.bind(this));
    this.onMessage('shoot', this.handleShoot.bind(this));
  }

  onTick(deltaTime: number): void {
    if (this.state.phase !== 'playing') return;

    this.state.gameTime += deltaTime;

    // Update projectiles
    this.updateProjectiles(deltaTime);

    // Check collisions
    this.checkCollisions();

    // Check win condition
    this.checkWinCondition();
  }

  private handleMove(client: Client, data: { x: number; y: number; timestamp: number }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Validate move (anti-cheat)
    if (this.isValidMove(player, data.x, data.y)) {
      player.x = data.x;
      player.y = data.y;
      player.lastMoveTime = data.timestamp;
    }
  }

  private handleShoot(client: Client, data: { direction: { x: number; y: number }; timestamp: number }): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.canShoot) return;

    // Lag compensation: rewind to client's timestamp
    const lagMs = Date.now() - data.timestamp;

    const projectile: Projectile = {
      id: generateId(),
      ownerId: client.sessionId,
      x: player.x,
      y: player.y,
      dx: data.direction.x,
      dy: data.direction.y,
      speed: 20,
      createdAt: Date.now()
    };

    this.state.projectiles.push(projectile);
    player.canShoot = false;

    // Cooldown
    setTimeout(() => {
      player.canShoot = true;
    }, 500);
  }

  private updateProjectiles(deltaTime: number): void {
    this.state.projectiles = this.state.projectiles.filter(p => {
      p.x += p.dx * p.speed * deltaTime;
      p.y += p.dy * p.speed * deltaTime;

      // Remove if out of bounds
      return p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;
    });
  }

  private checkCollisions(): void {
    for (const projectile of this.state.projectiles) {
      for (const [playerId, player] of this.state.players) {
        if (playerId === projectile.ownerId) continue;

        const distance = Math.hypot(player.x - projectile.x, player.y - projectile.y);
        if (distance < 1) { // Hit radius
          player.health -= 25;

          // Remove projectile
          const index = this.state.projectiles.indexOf(projectile);
          if (index > -1) this.state.projectiles.splice(index, 1);

          this.broadcast('player_hit', {
            playerId,
            health: player.health,
            attackerId: projectile.ownerId
          });

          if (player.health <= 0) {
            this.handlePlayerDeath(playerId, projectile.ownerId);
          }
          break;
        }
      }
    }
  }
}
```

### Turn-Based Game Pattern

```typescript
// Server: TurnBasedRoom.ts
interface TurnBasedState {
  players: Map<string, TurnPlayer>;
  currentTurnIndex: number;
  turnOrder: string[];
  turnTimeRemaining: number;
  phase: 'setup' | 'playing' | 'ended';
  board: BoardState;
}

export class TurnBasedRoom extends Room<TurnBasedState> {
  private turnTimer: NodeJS.Timeout | null = null;

  onCreate(options: RoomConstructorOptions): void {
    this.setState({
      players: new Map(),
      currentTurnIndex: 0,
      turnOrder: [],
      turnTimeRemaining: 30,
      phase: 'setup',
      board: this.initializeBoard()
    });

    this.onMessage('play_card', this.handlePlayCard.bind(this));
    this.onMessage('end_turn', this.handleEndTurn.bind(this));
  }

  private getCurrentPlayer(): TurnPlayer | undefined {
    const playerId = this.state.turnOrder[this.state.currentTurnIndex];
    return this.state.players.get(playerId);
  }

  private handlePlayCard(client: Client, data: { cardId: string; target?: string }): void {
    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== client.sessionId) {
      this.send(client, 'error', { message: 'Not your turn' });
      return;
    }

    // Validate and execute card play
    const card = currentPlayer.hand.find(c => c.id === data.cardId);
    if (!card) return;

    // Remove from hand
    currentPlayer.hand = currentPlayer.hand.filter(c => c.id !== data.cardId);

    // Apply card effect
    this.applyCardEffect(card, currentPlayer, data.target);

    this.broadcast('card_played', {
      playerId: client.sessionId,
      cardId: data.cardId,
      target: data.target
    });
  }

  private handleEndTurn(client: Client): void {
    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== client.sessionId) return;

    this.advanceTurn();
  }

  private advanceTurn(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);

    this.state.currentTurnIndex =
      (this.state.currentTurnIndex + 1) % this.state.turnOrder.length;
    this.state.turnTimeRemaining = 30;

    const nextPlayer = this.getCurrentPlayer()!;

    // Draw card for next player
    nextPlayer.hand.push(this.drawCard());

    this.broadcast('turn_changed', {
      currentPlayerId: nextPlayer.id,
      timeLimit: 30
    });

    // Auto end turn after time limit
    this.turnTimer = setTimeout(() => {
      this.advanceTurn();
    }, 30000);
  }
}
```

---

## Message Reference

### Client → Server Messages

| Message Type | Payload | Description |
|-------------|---------|-------------|
| `player_ready` | `{ ready: boolean }` | Player ready state |
| `player_move` | `{ x: number, y: number }` | Position update |
| `player_action` | `{ action: string, payload?: any }` | Game action |
| `submit_answer` | `{ answerIndex: number }` | Trivia answer |
| `play_card` | `{ cardId: string, target?: string }` | Play a card |
| `end_turn` | `{}` | End current turn |
| `chat` | `{ text: string }` | Chat message |

### Server → Client Messages

| Message Type | Payload | Description |
|-------------|---------|-------------|
| `player_joined` | `{ playerId, playerName }` | New player joined |
| `player_left` | `{ playerId }` | Player disconnected |
| `game_started` | `{ round }` | Game has begun |
| `game_ended` | `{ reason, winner, finalScores }` | Game finished |
| `state_sync` | Full game state | Complete state update |
| `state_patch` | Delta changes | Partial state update |
| `question` | `{ question, answers, timeLimit }` | New trivia question |
| `results` | `{ correctIndex, scores }` | Round results |
| `turn_changed` | `{ currentPlayerId, timeLimit }` | Turn advanced |
| `error` | `{ message }` | Error notification |

---

## Best Practices

### Server-Side

1. **Validate all client input** - Never trust client data
2. **Use tick-based updates** for real-time games
3. **Implement rate limiting** to prevent spam
4. **Store minimal state** - Only what's needed for game logic
5. **Use typed interfaces** for state and messages

### Client-Side (Unity)

1. **Use client-side prediction** for responsive input
2. **Interpolate remote player positions** for smooth movement
3. **Handle disconnections gracefully** with reconnection logic
4. **Cache and reuse message objects** to reduce GC pressure
5. **Use object pooling** for frequently spawned objects

### Performance

1. **Minimize state size** - Only sync what's necessary
2. **Use delta compression** - Built into Xogos
3. **Batch messages** when possible
4. **Set appropriate tick rates** - 20Hz for most games, 60Hz for fast action

---

## Troubleshooting

### Connection Issues
- Verify server is running and accessible
- Check WebSocket URL (ws:// for local, wss:// for production)
- Ensure firewall allows the port

### State Sync Issues
- Verify state types match between server and client
- Check for circular references in state
- Ensure state mutations happen on server, not client

### Performance Issues
- Reduce tick rate if CPU usage is high
- Minimize state object size
- Use unreliable messages for frequent, non-critical updates

---

## API Quick Reference

### Server (TypeScript)

```typescript
// Room lifecycle
onCreate(options): void
onJoin(client, options): void
onLeave(client, consented): void
onTick(deltaTime): void
onDispose(): void

// Messaging
this.onMessage(type, handler)
this.broadcast(type, data)
this.send(client, type, data)

// State
this.setState(state)
this.state  // Current state object
```

### Client (Unity C#)

```csharp
// Connection
await networkManager.Connect()
await networkManager.JoinOrCreate(roomType, options)
await networkManager.JoinById(roomId, options)

// Messaging
room.Send(type, data)
room.OnMessage<T>(type, handler)
room.OnStateChange += handler

// Lifecycle
room.Leave()
networkManager.Disconnect()
```

---

*Document Version: 1.0*
*Compatible with Xogos Multiplayer v1.x*
*Last Updated: December 2024*
