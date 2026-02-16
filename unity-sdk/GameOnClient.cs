/**
 * Game On Dude! SDK for Unity
 * www.gameonguy.com
 *
 * Main client class for connecting to Game On Dude! Multiplayer Server.
 * Drop-in replacement for Photon with similar API patterns.
 */

using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using NativeWebSocket;
using Newtonsoft.Json;

namespace GameOn.Multiplayer
{
    public class GameOnClient : MonoBehaviour
    {
        public static GameOnClient Instance { get; private set; }

        [Header("Connection Settings")]
        [SerializeField] private string serverUrl = "ws://localhost:3000/ws";
        [SerializeField] private bool autoReconnect = true;
        [SerializeField] private float reconnectDelay = 2f;
        [SerializeField] private int maxReconnectAttempts = 5;

        // Connection state
        public bool IsConnected => webSocket?.State == WebSocketState.Open;
        public string ClientId { get; private set; }
        public string SessionId { get; private set; }
        public bool IsAuthenticated { get; private set; }
        public string CurrentRoomId { get; private set; }

        // User info
        public string UserId { get; private set; }
        public string Username { get; private set; }

        // Events
        public event Action OnConnected;
        public event Action<string> OnDisconnected;
        public event Action<string> OnError;
        public event Action<string, string> OnAuthenticated; // userId, username
        public event Action OnAuthenticationFailed;

        // Room events
        public event Action<RoomInfo> OnRoomCreated;
        public event Action<RoomInfo, object> OnRoomJoined; // room info, initial state
        public event Action OnRoomLeft;
        public event Action<List<RoomInfo>> OnRoomList;
        public event Action<string> OnRoomError;

        // Player events
        public event Action<PlayerInfo> OnPlayerJoined;
        public event Action<string> OnPlayerLeft;
        public event Action<string, bool> OnPlayerReady;

        // Game events
        public event Action<object> OnGameStarted;
        public event Action<object> OnGameEnded;
        public event Action<object> OnStateUpdate;
        public event Action<string, object> OnGameEvent;

        // Matchmaking events
        public event Action<string> OnMatchFound;
        public event Action OnMatchmakingTimeout;

        private WebSocket webSocket;
        private int reconnectAttempts = 0;
        private bool isReconnecting = false;
        private Queue<Message> messageQueue = new Queue<Message>();
        private Dictionary<string, Action<Message>> messageHandlers;

        private void Awake()
        {
            if (Instance == null)
            {
                Instance = this;
                DontDestroyOnLoad(gameObject);
                InitializeMessageHandlers();
            }
            else
            {
                Destroy(gameObject);
            }
        }

        private void InitializeMessageHandlers()
        {
            messageHandlers = new Dictionary<string, Action<Message>>
            {
                { "welcome", HandleWelcome },
                { "auth_success", HandleAuthSuccess },
                { "auth_failure", HandleAuthFailure },
                { "room_created", HandleRoomCreated },
                { "room_joined", HandleRoomJoined },
                { "room_left", HandleRoomLeft },
                { "room_list", HandleRoomList },
                { "room_error", HandleRoomError },
                { "room_closed", HandleRoomClosed },
                { "player_joined", HandlePlayerJoined },
                { "player_left", HandlePlayerLeft },
                { "player_ready", HandlePlayerReady },
                { "game_start", HandleGameStart },
                { "game_end", HandleGameEnd },
                { "state_full", HandleStateUpdate },
                { "state_patch", HandleStatePatch },
                { "matchmake_found", HandleMatchFound },
                { "matchmake_timeout", HandleMatchmakingTimeout },
                { "error", HandleError },
            };
        }

        private void Update()
        {
#if !UNITY_WEBGL || UNITY_EDITOR
            webSocket?.DispatchMessageQueue();
#endif
        }

        private async void OnDestroy()
        {
            if (webSocket != null)
            {
                await webSocket.Close();
            }
        }

        #region Connection

        public async void Connect(string url = null)
        {
            if (IsConnected) return;

            serverUrl = url ?? serverUrl;
            Debug.Log($"[GameOnClient] Connecting to {serverUrl}...");

            webSocket = new WebSocket(serverUrl);

            webSocket.OnOpen += () =>
            {
                Debug.Log("[GameOnClient] Connected!");
                reconnectAttempts = 0;
                isReconnecting = false;
                OnConnected?.Invoke();
            };

            webSocket.OnMessage += (bytes) =>
            {
                var messageStr = System.Text.Encoding.UTF8.GetString(bytes);
                HandleMessage(messageStr);
            };

            webSocket.OnError += (error) =>
            {
                Debug.LogError($"[GameOnClient] Error: {error}");
                OnError?.Invoke(error);
            };

            webSocket.OnClose += (code) =>
            {
                Debug.Log($"[GameOnClient] Disconnected: {code}");
                IsAuthenticated = false;
                CurrentRoomId = null;
                OnDisconnected?.Invoke(code.ToString());

                if (autoReconnect && !isReconnecting)
                {
                    TryReconnect();
                }
            };

            await webSocket.Connect();
        }

        public async void Disconnect()
        {
            autoReconnect = false;
            if (webSocket != null)
            {
                await webSocket.Close();
            }
        }

        private void TryReconnect()
        {
            if (reconnectAttempts >= maxReconnectAttempts)
            {
                Debug.LogError("[GameOnClient] Max reconnect attempts reached");
                return;
            }

            isReconnecting = true;
            reconnectAttempts++;
            Debug.Log($"[GameOnClient] Reconnecting... Attempt {reconnectAttempts}/{maxReconnectAttempts}");

            StartCoroutine(ReconnectCoroutine());
        }

        private IEnumerator ReconnectCoroutine()
        {
            yield return new WaitForSeconds(reconnectDelay);
            Connect();
        }

        #endregion

        #region Authentication

        public void AuthenticateWithToken(string token)
        {
            Send(new Message
            {
                type = "auth",
                payload = new { token }
            });
        }

        public void AuthenticateAsGuest(string username = null)
        {
            Send(new Message
            {
                type = "auth",
                payload = new { username, guestId = SystemInfo.deviceUniqueIdentifier }
            });
        }

        #endregion

        #region Room Management

        public void CreateRoom(string gameType, RoomOptions options = null)
        {
            Send(new Message
            {
                type = "room_create",
                payload = new
                {
                    gameType,
                    options = options ?? new RoomOptions()
                }
            });
        }

        public void JoinRoom(string roomId, string password = null)
        {
            Send(new Message
            {
                type = "room_join",
                payload = new { roomId, password }
            });
        }

        public void LeaveRoom()
        {
            Send(new Message { type = "room_leave" });
        }

        public void GetRoomList(string gameType = null, string gameMode = null)
        {
            Send(new Message
            {
                type = "room_list",
                payload = new { gameType, gameMode, hasSpace = true }
            });
        }

        public void SetReady(bool ready = true)
        {
            Send(new Message
            {
                type = "player_ready",
                payload = new { ready }
            });
        }

        #endregion

        #region Game Actions

        public void SendGameAction(string actionType, object data)
        {
            Send(new Message
            {
                type = "game_action",
                payload = new { type = actionType, data }
            });
        }

        public void SendMovement(Vector2 direction, List<string> actions = null)
        {
            SendGameAction("move", new
            {
                sequence = Time.frameCount,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                direction = new { x = direction.x, y = direction.y },
                actions = actions ?? new List<string>()
            });
        }

        public void SubmitAnswer(string answerId)
        {
            SendGameAction("submit_answer", new { answerId });
        }

        public void SelectQuestion(string questionId)
        {
            SendGameAction("select_question", new { questionId });
        }

        public void SendTurnAction(object actionData)
        {
            SendGameAction("turn_action", actionData);
        }

        public void EndTurn()
        {
            SendGameAction("end_turn", null);
        }

        #endregion

        #region Matchmaking

        public void RequestMatch(string gameType, string gameMode = null, int? skill = null)
        {
            Send(new Message
            {
                type = "matchmake_request",
                payload = new { gameType, gameMode, skill }
            });
        }

        public void CancelMatchmaking()
        {
            Send(new Message { type = "matchmake_cancel" });
        }

        #endregion

        #region Message Handling

        private void Send(Message message)
        {
            if (!IsConnected)
            {
                Debug.LogWarning("[GameOnClient] Cannot send message: not connected");
                messageQueue.Enqueue(message);
                return;
            }

            message.timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var json = JsonConvert.SerializeObject(message);
            webSocket.SendText(json);
        }

        private void HandleMessage(string messageStr)
        {
            try
            {
                var message = JsonConvert.DeserializeObject<Message>(messageStr);

                if (messageHandlers.TryGetValue(message.type, out var handler))
                {
                    handler(message);
                }
                else
                {
                    // Forward unknown messages as game events
                    OnGameEvent?.Invoke(message.type, message.payload);
                }
            }
            catch (Exception e)
            {
                Debug.LogError($"[GameOnClient] Error parsing message: {e.Message}");
            }
        }

        private void HandleWelcome(Message message)
        {
            var payload = JsonConvert.DeserializeObject<WelcomePayload>(message.payload.ToString());
            ClientId = payload.clientId;
            SessionId = payload.sessionId;
            Debug.Log($"[GameOnClient] Welcome! ClientId: {ClientId}");

            // Send queued messages
            while (messageQueue.Count > 0)
            {
                Send(messageQueue.Dequeue());
            }
        }

        private void HandleAuthSuccess(Message message)
        {
            var payload = JsonConvert.DeserializeObject<AuthSuccessPayload>(message.payload.ToString());
            UserId = payload.userId;
            Username = payload.username;
            IsAuthenticated = true;
            Debug.Log($"[GameOnClient] Authenticated as {Username}");
            OnAuthenticated?.Invoke(UserId, Username);
        }

        private void HandleAuthFailure(Message message)
        {
            IsAuthenticated = false;
            Debug.LogWarning("[GameOnClient] Authentication failed");
            OnAuthenticationFailed?.Invoke();
        }

        private void HandleRoomCreated(Message message)
        {
            var roomInfo = JsonConvert.DeserializeObject<RoomInfo>(message.payload.ToString());
            CurrentRoomId = roomInfo.id;
            OnRoomCreated?.Invoke(roomInfo);
        }

        private void HandleRoomJoined(Message message)
        {
            var payload = JsonConvert.DeserializeObject<RoomJoinedPayload>(message.payload.ToString());
            CurrentRoomId = payload.room.id;
            OnRoomJoined?.Invoke(payload.room, payload.state);
        }

        private void HandleRoomLeft(Message message)
        {
            CurrentRoomId = null;
            OnRoomLeft?.Invoke();
        }

        private void HandleRoomList(Message message)
        {
            var payload = JsonConvert.DeserializeObject<RoomListPayload>(message.payload.ToString());
            OnRoomList?.Invoke(payload.rooms);
        }

        private void HandleRoomError(Message message)
        {
            var payload = JsonConvert.DeserializeObject<ErrorPayload>(message.payload.ToString());
            OnRoomError?.Invoke(payload.message);
        }

        private void HandleRoomClosed(Message message)
        {
            CurrentRoomId = null;
            OnRoomLeft?.Invoke();
        }

        private void HandlePlayerJoined(Message message)
        {
            var playerInfo = JsonConvert.DeserializeObject<PlayerInfo>(message.payload.ToString());
            OnPlayerJoined?.Invoke(playerInfo);
        }

        private void HandlePlayerLeft(Message message)
        {
            var payload = JsonConvert.DeserializeObject<PlayerLeftPayload>(message.payload.ToString());
            OnPlayerLeft?.Invoke(payload.playerId);
        }

        private void HandlePlayerReady(Message message)
        {
            var payload = JsonConvert.DeserializeObject<PlayerReadyPayload>(message.payload.ToString());
            OnPlayerReady?.Invoke(payload.playerId, payload.ready);
        }

        private void HandleGameStart(Message message)
        {
            OnGameStarted?.Invoke(message.payload);
        }

        private void HandleGameEnd(Message message)
        {
            OnGameEnded?.Invoke(message.payload);
        }

        private void HandleStateUpdate(Message message)
        {
            OnStateUpdate?.Invoke(message.payload);
        }

        private void HandleStatePatch(Message message)
        {
            // For now, treat patches as full state updates
            // In production, apply patches incrementally
            OnStateUpdate?.Invoke(message.payload);
        }

        private void HandleMatchFound(Message message)
        {
            var payload = JsonConvert.DeserializeObject<MatchFoundPayload>(message.payload.ToString());
            OnMatchFound?.Invoke(payload.roomId);
        }

        private void HandleMatchmakingTimeout(Message message)
        {
            OnMatchmakingTimeout?.Invoke();
        }

        private void HandleError(Message message)
        {
            var payload = JsonConvert.DeserializeObject<ErrorPayload>(message.payload.ToString());
            Debug.LogError($"[GameOnClient] Server error: {payload.message}");
            OnError?.Invoke(payload.message);
        }

        #endregion
    }

    #region Data Classes

    [Serializable]
    public class Message
    {
        public string type;
        public object payload;
        public long timestamp;
        public int sequence;
    }

    [Serializable]
    public class RoomOptions
    {
        public int maxPlayers = 10;
        public int minPlayers = 2;
        public bool isPrivate = false;
        public string password;
        public string gameMode;
        public bool autoStart = true;
    }

    [Serializable]
    public class RoomInfo
    {
        public string id;
        public string name;
        public string gameType;
        public string gameMode;
        public string state;
        public int playerCount;
        public int maxPlayers;
        public bool isPrivate;
        public bool hasPassword;
    }

    [Serializable]
    public class PlayerInfo
    {
        public string id;
        public string sessionId;
        public string userId;
        public string username;
        public bool isReady;
        public bool isConnected;
    }

    // Payload classes for deserialization
    [Serializable]
    public class WelcomePayload
    {
        public string clientId;
        public string sessionId;
        public long serverTime;
    }

    [Serializable]
    public class AuthSuccessPayload
    {
        public string userId;
        public string username;
        public string sessionId;
    }

    [Serializable]
    public class RoomJoinedPayload
    {
        public RoomInfo room;
        public object state;
    }

    [Serializable]
    public class RoomListPayload
    {
        public List<RoomInfo> rooms;
    }

    [Serializable]
    public class PlayerLeftPayload
    {
        public string playerId;
    }

    [Serializable]
    public class PlayerReadyPayload
    {
        public string playerId;
        public bool ready;
    }

    [Serializable]
    public class MatchFoundPayload
    {
        public string roomId;
    }

    [Serializable]
    public class ErrorPayload
    {
        public string message;
        public string code;
    }

    #endregion
}
