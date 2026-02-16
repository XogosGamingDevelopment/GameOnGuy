# Xogos Unity Integration Guide

This guide explains how to integrate the Xogos Multiplayer Server with your Unity project.

## Table of Contents

1. [Setup and Installation](#setup-and-installation)
2. [Basic Connection](#basic-connection)
3. [Authentication](#authentication)
4. [Room Management](#room-management)
5. [Game Type Integration](#game-type-integration)
   - [Trivia Games (Lightning Round)](#trivia-games)
   - [Turn-Based Games (Historical Conquest)](#turn-based-games)
   - [Real-Time Movement Games](#real-time-movement-games)
6. [State Synchronization](#state-synchronization)
7. [Client-Side Prediction](#client-side-prediction)
8. [Error Handling](#error-handling)
9. [Best Practices](#best-practices)

---

## Setup and Installation

### 1. Copy SDK Files

Copy the following files from `unity-sdk/` to your Unity project's `Assets/Scripts/Networking/` folder:

```
XogosClient.cs              - Low-level WebSocket client
XogosNetworkManager.cs      - High-level API
XogosNetworkIdentity.cs     - Network object identity
XogosPrediction.cs          - Client-side prediction
XogosTriviaManager.cs       - Trivia game manager
XogosTurnBasedManager.cs    - Turn-based game manager
XogosMovementManager.cs     - Real-time movement manager
```

### 2. Add Dependencies

The SDK requires a WebSocket library. Add one of these to your project:

**Option A: NativeWebSocket (Recommended)**
```
https://github.com/endel/NativeWebSocket
```

**Option B: WebSocketSharp**
```
https://github.com/sta/websocket-sharp
```

### 3. Create Network Manager GameObject

Create an empty GameObject in your scene and add:
- `XogosNetworkManager` component
- Game-specific manager (`XogosTriviaManager`, `XogosTurnBasedManager`, or `XogosMovementManager`)

---

## Basic Connection

### Setting Up XogosNetworkManager

```csharp
using Xogos.Networking;
using UnityEngine;

public class GameManager : MonoBehaviour
{
    [SerializeField] private XogosNetworkManager networkManager;

    private void Start()
    {
        // Subscribe to events
        networkManager.OnConnected += HandleConnected;
        networkManager.OnDisconnected += HandleDisconnected;
        networkManager.OnError += HandleError;

        // Connect to server
        networkManager.Connect("ws://localhost:3000/ws");
    }

    private void HandleConnected()
    {
        Debug.Log("Connected to Xogos server!");
    }

    private void HandleDisconnected(string reason)
    {
        Debug.Log($"Disconnected: {reason}");
    }

    private void HandleError(string error)
    {
        Debug.LogError($"Network error: {error}");
    }
}
```

---

## Authentication

### Guest Authentication

```csharp
// Authenticate as guest with auto-generated name
networkManager.AuthenticateAsGuest();

// Or with custom username
networkManager.AuthenticateAsGuest("Player123");
```

### Token Authentication (Registered Users)

```csharp
// Use JWT token from your auth system
string jwtToken = await YourAuthService.GetToken();
networkManager.AuthenticateWithToken(jwtToken);
```

### Handling Authentication

```csharp
networkManager.OnAuthenticated += (userId, username) =>
{
    Debug.Log($"Authenticated as {username} (ID: {userId})");
    // Now you can join/create rooms
};

networkManager.OnAuthFailed += (error) =>
{
    Debug.LogError($"Auth failed: {error}");
};
```

---

## Room Management

### Creating a Room

```csharp
// Create a Lightning Round room
networkManager.CreateRoom("lightning_round", new RoomOptions
{
    MaxPlayers = 8,
    IsPublic = true,
    Password = null // Optional password
});

networkManager.OnRoomCreated += (roomInfo) =>
{
    Debug.Log($"Room created: {roomInfo.RoomId}");
};
```

### Joining a Room

```csharp
// Join by room ID
networkManager.JoinRoom("room-id-here");

// Join with password
networkManager.JoinRoom("room-id-here", "password123");

networkManager.OnRoomJoined += (roomInfo, state) =>
{
    Debug.Log($"Joined room: {roomInfo.Name}");
};
```

### Listing Available Rooms

```csharp
networkManager.GetRoomList("lightning_round");

networkManager.OnRoomList += (rooms) =>
{
    foreach (var room in rooms)
    {
        Debug.Log($"{room.Name}: {room.PlayerCount}/{room.MaxPlayers}");
    }
};
```

### Matchmaking

```csharp
// Request automatic matchmaking
networkManager.RequestMatchmaking("lightning_round");

networkManager.OnMatchFound += (roomInfo) =>
{
    Debug.Log("Match found! Joining...");
};
```

---

## Game Type Integration

### Trivia Games

Use `XogosTriviaManager` for Lightning Round and TimeQuest.

```csharp
using Xogos.Networking;

public class TriviaGameController : MonoBehaviour
{
    [SerializeField] private XogosTriviaManager triviaManager;
    [SerializeField] private QuestionUI questionUI;
    [SerializeField] private LeaderboardUI leaderboardUI;

    private void OnEnable()
    {
        // Subscribe to events
        triviaManager.OnQuestionReceived += HandleQuestion;
        triviaManager.OnQuestionResult += HandleResult;
        triviaManager.OnLeaderboardUpdated += HandleLeaderboard;
        triviaManager.OnTimerUpdated += HandleTimer;
        triviaManager.OnCategoriesReceived += HandleCategories;
        triviaManager.OnRoundEnded += HandleRoundEnd;
        triviaManager.OnGameEnded += HandleGameEnd;
    }

    private void HandleQuestion(Question question)
    {
        // Display question and answers
        questionUI.ShowQuestion(question.Text);
        questionUI.ShowAnswers(question.Answers);
        questionUI.ShowPoints(question.Points);
    }

    private void HandleResult(QuestionResult result)
    {
        // Show correct answer and scores
        questionUI.HighlightCorrectAnswer(result.CorrectAnswerId);

        foreach (var playerResult in result.Results)
        {
            if (playerResult.Value.IsCorrect)
            {
                Debug.Log($"Player {playerResult.Key} earned {playerResult.Value.Points} points!");
            }
        }
    }

    private void HandleTimer(float timeRemaining)
    {
        questionUI.UpdateTimer(timeRemaining);
    }

    private void HandleCategories(List<Category> categories)
    {
        // Display category selection UI
        foreach (var cat in categories)
        {
            Debug.Log($"Category: {cat.Name} ({cat.QuestionCount} questions)");
        }
    }

    // Called by UI button
    public void OnAnswerSelected(string answerId)
    {
        triviaManager.SubmitAnswer(answerId);
    }

    // Called by UI button
    public void OnCategorySelected(string categoryId)
    {
        triviaManager.SelectCategory(categoryId);
    }
}
```

### Turn-Based Games

Use `XogosTurnBasedManager` for Historical Conquest.

```csharp
using Xogos.Networking;

public class CardGameController : MonoBehaviour
{
    [SerializeField] private XogosTurnBasedManager turnManager;
    [SerializeField] private CardHandUI handUI;
    [SerializeField] private BattlefieldUI battlefieldUI;

    private void OnEnable()
    {
        turnManager.OnTurnStarted += HandleTurnStart;
        turnManager.OnTurnEnded += HandleTurnEnd;
        turnManager.OnActionPerformed += HandleAction;
        turnManager.OnTurnTimerUpdated += HandleTimer;
        turnManager.OnTurnTimerWarning += HandleTimerWarning;
        turnManager.OnGameEnded += HandleGameEnd;
    }

    private void HandleTurnStart(TurnInfo turn)
    {
        if (turnManager.IsMyTurn)
        {
            // Enable interaction
            handUI.EnableCardSelection(true);
            battlefieldUI.EnableTargeting(true);
            Debug.Log("Your turn! Actions remaining: " + turnManager.ActionsRemaining);
        }
        else
        {
            // Disable interaction, show whose turn
            handUI.EnableCardSelection(false);
            battlefieldUI.EnableTargeting(false);
        }
    }

    private void HandleTimerWarning()
    {
        // Flash UI or play warning sound
        Debug.LogWarning("10 seconds remaining!");
    }

    // Called when player plays a card
    public void PlayCard(string cardId, int targetSlot)
    {
        if (!turnManager.CanAct) return;

        turnManager.PerformAction("play_card", new
        {
            cardId = cardId,
            targetSlot = targetSlot
        });
    }

    // Called when player attacks
    public void Attack(string attackerInstanceId, string defenderInstanceId)
    {
        if (!turnManager.CanAct) return;

        turnManager.PerformAction("attack", new
        {
            attackerInstanceId = attackerInstanceId,
            defenderInstanceId = defenderInstanceId
        });
    }

    // End turn early
    public void EndTurn()
    {
        turnManager.EndTurn();
    }
}
```

### Real-Time Movement Games

Use `XogosMovementManager` for Number Munchers and Panic Attach.

```csharp
using Xogos.Networking;

public class MovementGameController : MonoBehaviour
{
    [SerializeField] private XogosMovementManager movementManager;
    [SerializeField] private Transform localPlayerTransform;

    private Dictionary<string, Transform> otherPlayers = new Dictionary<string, Transform>();
    private Dictionary<string, Transform> entities = new Dictionary<string, Transform>();

    private void OnEnable()
    {
        movementManager.OnPlayerSpawned += HandlePlayerSpawned;
        movementManager.OnPlayerDespawned += HandlePlayerDespawned;
        movementManager.OnEntitySpawned += HandleEntitySpawned;
        movementManager.OnEntityRemoved += HandleEntityRemoved;
        movementManager.OnGameStarted += HandleGameStart;
    }

    private void Update()
    {
        if (movementManager.CurrentState != MovementGameState.Playing)
            return;

        // Get input and send to server
        Vector2 input = new Vector2(
            Input.GetAxis("Horizontal"),
            Input.GetAxis("Vertical")
        );

        movementManager.SetMoveInput(input);

        // Update local player visual position
        localPlayerTransform.position = movementManager.LocalPlayerPosition;

        // Update other players
        foreach (var kvp in movementManager.AllPlayers)
        {
            if (otherPlayers.TryGetValue(kvp.Key, out var playerTransform))
            {
                playerTransform.position = kvp.Value.Position;
                playerTransform.rotation = Quaternion.Euler(0, kvp.Value.Rotation, 0);
            }
        }

        // Handle actions
        if (Input.GetKeyDown(KeyCode.Space))
        {
            movementManager.PerformAction("jump");
        }

        if (Input.GetKeyDown(KeyCode.E))
        {
            // Find nearest entity and interact
            var nearestEntity = FindNearestEntity();
            if (nearestEntity != null)
            {
                movementManager.InteractWithEntity(nearestEntity.Id);
            }
        }
    }

    private void HandlePlayerSpawned(string playerId, PlayerMovementState state)
    {
        // Instantiate player prefab
        var playerObj = Instantiate(playerPrefab, state.Position, Quaternion.identity);
        otherPlayers[playerId] = playerObj.transform;
    }

    private void HandlePlayerDespawned(string playerId)
    {
        if (otherPlayers.TryGetValue(playerId, out var playerTransform))
        {
            Destroy(playerTransform.gameObject);
            otherPlayers.Remove(playerId);
        }
    }

    private void HandleEntitySpawned(EntityState entity)
    {
        // Instantiate entity based on type
        var prefab = GetEntityPrefab(entity.Type);
        var entityObj = Instantiate(prefab, entity.Position, Quaternion.identity);
        entities[entity.Id] = entityObj.transform;
    }
}
```

---

## State Synchronization

The server sends state updates at regular intervals. Handle them appropriately:

```csharp
networkManager.OnStateUpdate += (state) =>
{
    // Full state or delta update received
    UpdateGameState(state);
};
```

For high-frequency updates in movement games, use interpolation:

```csharp
// The XogosMovementManager handles interpolation automatically
// Configure in inspector:
// - Interpolation Delay: 100ms (typical)
// - Use Interpolation: true
```

---

## Client-Side Prediction

For responsive movement games, enable client-side prediction:

```csharp
// Add XogosPrediction component to your player
[SerializeField] private XogosPrediction prediction;

// Configure settings
prediction.SetPredictionEnabled(true);
prediction.SetReconciliationThreshold(0.5f); // Units of position error
```

The prediction system:
1. Applies input locally for immediate feedback
2. Sends input to server with sequence numbers
3. Receives server acknowledgment with authoritative position
4. Reconciles if prediction error exceeds threshold
5. Replays unacknowledged inputs after correction

---

## Error Handling

```csharp
// Network errors
networkManager.OnError += (error) =>
{
    ShowErrorPopup($"Connection error: {error}");
};

// Room errors
networkManager.OnRoomError += (error) =>
{
    ShowErrorPopup($"Room error: {error}");
};

// Reconnection
networkManager.OnDisconnected += (reason) =>
{
    StartCoroutine(TryReconnect());
};

private IEnumerator TryReconnect()
{
    int attempts = 0;
    while (attempts < 5)
    {
        yield return new WaitForSeconds(2f);
        networkManager.Connect(serverUrl);

        if (networkManager.IsConnected)
        {
            // Re-authenticate and rejoin room
            networkManager.AuthenticateAsGuest(lastUsername);
            yield break;
        }

        attempts++;
    }

    ShowErrorPopup("Failed to reconnect");
}
```

---

## Best Practices

### 1. Connection Management

```csharp
// Always clean up on destroy
private void OnDestroy()
{
    if (networkManager != null)
    {
        networkManager.Disconnect();
    }
}
```

### 2. Input Buffering

For movement games, buffer input to smooth out network jitter:

```csharp
// Already handled by XogosMovementManager
// Configure inputSendRate to balance responsiveness vs bandwidth
```

### 3. Handle Latency

```csharp
// Show "Connecting..." UI during initial connection
// Show player ping/latency indicator
// Use client-side prediction for movement
```

### 4. Optimize Bandwidth

```csharp
// Only send input when it changes
// Use delta compression for state updates (server handles this)
// Disable unnecessary network features when not needed
```

### 5. Testing

```csharp
// Test with artificial latency
networkManager.SimulateLatency(100); // Add 100ms latency

// Test with packet loss
networkManager.SimulatePacketLoss(0.05f); // 5% packet loss
```

---

## Server Configuration

### Environment Variables

Set these in your `.env` file:

```bash
# Server
PORT=3000
ADMIN_PORT=3001
HOST=0.0.0.0
WS_PATH=/ws

# WebSocket
WS_HEARTBEAT_INTERVAL=30000
WS_HEARTBEAT_TIMEOUT=60000

# Authentication
JWT_SECRET=your-production-secret
JWT_EXPIRY=7d

# Database (for persistent features)
DATABASE_URL=postgresql://user:pass@localhost:5432/xogos

# Redis (for scaling)
REDIS_URL=redis://localhost:6379
```

### Starting the Server

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

---

## Migrating from Photon

If you're migrating from Photon PUN, here's a mapping:

| Photon | Xogos |
|--------|-------|
| `PhotonNetwork.Connect()` | `networkManager.Connect(url)` |
| `PhotonNetwork.JoinRoom()` | `networkManager.JoinRoom(roomId)` |
| `PhotonNetwork.CreateRoom()` | `networkManager.CreateRoom(type, options)` |
| `[PunRPC]` | `networkManager.SendGameAction()` |
| `OnJoinedRoom()` | `networkManager.OnRoomJoined` |
| `PhotonNetwork.Instantiate()` | Server-authoritative spawning |
| `PhotonTransformView` | `XogosMovementManager` + prediction |

---

## Support

For issues and questions:
- GitHub: https://github.com/xogos-gaming/multiplayer-server
- Documentation: See `BUILD.md` in the server project

---

*Last Updated: December 2024*
*Compatible with Xogos Multiplayer Server v1.0*
