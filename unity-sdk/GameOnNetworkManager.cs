/**
 * Game On Dude! SDK for Unity
 * www.gameonguy.com
 *
 * Network Manager - High-level API similar to Photon's PUN.
 * Handles automatic state sync and player instantiation.
 */

using System;
using System.Collections.Generic;
using UnityEngine;
using Newtonsoft.Json;

namespace GameOn.Multiplayer
{
    public class GameOnNetworkManager : MonoBehaviour
    {
        public static GameOnNetworkManager Instance { get; private set; }

        [Header("Settings")]
        [SerializeField] private string serverUrl = "ws://localhost:3000/ws";
        [SerializeField] private bool connectOnStart = true;
        [SerializeField] private bool autoSyncTransforms = true;
        [SerializeField] private float syncRate = 0.05f; // 20 Hz

        [Header("Prefabs")]
        [SerializeField] private GameObject localPlayerPrefab;
        [SerializeField] private GameObject remotePlayerPrefab;

        // State
        public bool IsConnected => GameOnClient.Instance?.IsConnected ?? false;
        public bool IsInRoom => !string.IsNullOrEmpty(GameOnClient.Instance?.CurrentRoomId);
        public string CurrentRoomId => GameOnClient.Instance?.CurrentRoomId;
        public PlayerInfo LocalPlayer { get; private set; }
        public Dictionary<string, PlayerInfo> Players { get; private set; } = new Dictionary<string, PlayerInfo>();
        public RoomInfo CurrentRoom { get; private set; }

        // Events
        public event Action OnConnectedToServer;
        public event Action OnDisconnectedFromServer;
        public event Action<RoomInfo> OnJoinedRoom;
        public event Action OnLeftRoom;
        public event Action<PlayerInfo> OnPlayerEnteredRoom;
        public event Action<string> OnPlayerLeftRoom;
        public event Action OnGameStarted;
        public event Action<object> OnGameEnded;

        // Network objects
        private Dictionary<string, GameObject> playerObjects = new Dictionary<string, GameObject>();
        private float lastSyncTime;
        private object currentGameState;

        private void Awake()
        {
            if (Instance == null)
            {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            }
            else
            {
                Destroy(gameObject);
                return;
            }
        }

        private void Start()
        {
            if (connectOnStart)
            {
                Connect();
            }
        }

        private void Update()
        {
            if (autoSyncTransforms && IsInRoom && Time.time - lastSyncTime >= syncRate)
            {
                SyncLocalPlayerTransform();
                lastSyncTime = Time.time;
            }
        }

        #region Connection

        public void Connect(string url = null)
        {
            var client = GameOnClient.Instance;
            if (client == null)
            {
                var go = new GameObject("GameOnClient");
                client = go.AddComponent<GameOnClient>();
            }

            // Subscribe to events
            client.OnConnected += HandleConnected;
            client.OnDisconnected += HandleDisconnected;
            client.OnAuthenticated += HandleAuthenticated;
            client.OnRoomJoined += HandleRoomJoined;
            client.OnRoomLeft += HandleRoomLeft;
            client.OnPlayerJoined += HandlePlayerJoined;
            client.OnPlayerLeft += HandlePlayerLeft;
            client.OnGameStarted += HandleGameStarted;
            client.OnGameEnded += HandleGameEnded;
            client.OnStateUpdate += HandleStateUpdate;

            client.Connect(url ?? serverUrl);
        }

        public void Disconnect()
        {
            GameOnClient.Instance?.Disconnect();
        }

        #endregion

        #region Authentication

        public void LoginAsGuest(string username = null)
        {
            GameOnClient.Instance?.AuthenticateAsGuest(username);
        }

        public void LoginWithToken(string token)
        {
            GameOnClient.Instance?.AuthenticateWithToken(token);
        }

        #endregion

        #region Room Management

        public void CreateRoom(string gameType, int maxPlayers = 10, bool isPrivate = false, string password = null)
        {
            GameOnClient.Instance?.CreateRoom(gameType, new RoomOptions
            {
                maxPlayers = maxPlayers,
                isPrivate = isPrivate,
                password = password,
                autoStart = true
            });
        }

        public void JoinRoom(string roomId, string password = null)
        {
            GameOnClient.Instance?.JoinRoom(roomId, password);
        }

        public void JoinRandomRoom(string gameType)
        {
            // First get room list, then join one
            GameOnClient.Instance.OnRoomList += OnRoomListReceived;
            GameOnClient.Instance.GetRoomList(gameType);
        }

        private void OnRoomListReceived(List<RoomInfo> rooms)
        {
            GameOnClient.Instance.OnRoomList -= OnRoomListReceived;

            if (rooms.Count > 0)
            {
                // Join random room
                var randomIndex = UnityEngine.Random.Range(0, rooms.Count);
                JoinRoom(rooms[randomIndex].id);
            }
            else
            {
                // Create new room if none available
                Debug.Log("[GameOnNetworkManager] No rooms available, creating new one");
                // You might want to handle this differently based on your needs
            }
        }

        public void LeaveRoom()
        {
            GameOnClient.Instance?.LeaveRoom();
        }

        public void SetReady(bool ready = true)
        {
            GameOnClient.Instance?.SetReady(ready);
        }

        #endregion

        #region Matchmaking

        public void StartMatchmaking(string gameType, string gameMode = null)
        {
            GameOnClient.Instance?.RequestMatch(gameType, gameMode);
        }

        public void CancelMatchmaking()
        {
            GameOnClient.Instance?.CancelMatchmaking();
        }

        #endregion

        #region Player Instantiation

        public GameObject InstantiatePlayer(Vector3 position, Quaternion rotation)
        {
            if (localPlayerPrefab == null)
            {
                Debug.LogError("[GameOnNetworkManager] Local player prefab not set!");
                return null;
            }

            var player = Instantiate(localPlayerPrefab, position, rotation);
            var networkIdentity = player.GetComponent<XogosNetworkIdentity>();
            if (networkIdentity == null)
            {
                networkIdentity = player.AddComponent<XogosNetworkIdentity>();
            }
            networkIdentity.IsLocalPlayer = true;
            networkIdentity.OwnerId = GameOnClient.Instance.ClientId;

            playerObjects[GameOnClient.Instance.ClientId] = player;

            return player;
        }

        private GameObject InstantiateRemotePlayer(string playerId, Vector3 position, Quaternion rotation)
        {
            if (remotePlayerPrefab == null)
            {
                Debug.LogWarning("[GameOnNetworkManager] Remote player prefab not set, using local prefab");
            }

            var prefab = remotePlayerPrefab ?? localPlayerPrefab;
            if (prefab == null) return null;

            var player = Instantiate(prefab, position, rotation);
            var networkIdentity = player.GetComponent<XogosNetworkIdentity>();
            if (networkIdentity == null)
            {
                networkIdentity = player.AddComponent<XogosNetworkIdentity>();
            }
            networkIdentity.IsLocalPlayer = false;
            networkIdentity.OwnerId = playerId;

            // Disable player control components on remote players
            var playerController = player.GetComponent<MonoBehaviour>();
            // You might want to disable specific components here

            playerObjects[playerId] = player;

            return player;
        }

        private void DestroyPlayer(string playerId)
        {
            if (playerObjects.TryGetValue(playerId, out var player))
            {
                Destroy(player);
                playerObjects.Remove(playerId);
            }
        }

        #endregion

        #region State Sync

        private void SyncLocalPlayerTransform()
        {
            if (!playerObjects.TryGetValue(GameOnClient.Instance.ClientId, out var player)) return;

            var transform = player.transform;
            var direction = Vector2.zero;

            // Get input direction (you can customize this based on your input system)
            if (Input.GetKey(KeyCode.W)) direction.y += 1;
            if (Input.GetKey(KeyCode.S)) direction.y -= 1;
            if (Input.GetKey(KeyCode.A)) direction.x -= 1;
            if (Input.GetKey(KeyCode.D)) direction.x += 1;

            if (direction != Vector2.zero)
            {
                GameOnClient.Instance.SendMovement(direction);
            }
        }

        public void SyncCustomData(string key, object value)
        {
            GameOnClient.Instance?.SendGameAction("sync_data", new { key, value });
        }

        #endregion

        #region Event Handlers

        private void HandleConnected()
        {
            Debug.Log("[GameOnNetworkManager] Connected to server");
            OnConnectedToServer?.Invoke();
        }

        private void HandleDisconnected(string reason)
        {
            Debug.Log($"[GameOnNetworkManager] Disconnected: {reason}");
            Players.Clear();
            CurrentRoom = null;
            LocalPlayer = null;

            // Clean up player objects
            foreach (var kvp in playerObjects)
            {
                if (kvp.Value != null)
                {
                    Destroy(kvp.Value);
                }
            }
            playerObjects.Clear();

            OnDisconnectedFromServer?.Invoke();
        }

        private void HandleAuthenticated(string userId, string username)
        {
            Debug.Log($"[GameOnNetworkManager] Authenticated as {username}");
            LocalPlayer = new PlayerInfo
            {
                id = GameOnClient.Instance.ClientId,
                userId = userId,
                username = username,
                isConnected = true
            };
        }

        private void HandleRoomJoined(RoomInfo room, object state)
        {
            Debug.Log($"[GameOnNetworkManager] Joined room: {room.name}");
            CurrentRoom = room;
            currentGameState = state;

            Players.Clear();
            Players[LocalPlayer.id] = LocalPlayer;

            OnJoinedRoom?.Invoke(room);
        }

        private void HandleRoomLeft()
        {
            Debug.Log("[GameOnNetworkManager] Left room");
            CurrentRoom = null;
            Players.Clear();

            // Clean up player objects
            foreach (var kvp in playerObjects)
            {
                if (kvp.Value != null)
                {
                    Destroy(kvp.Value);
                }
            }
            playerObjects.Clear();

            OnLeftRoom?.Invoke();
        }

        private void HandlePlayerJoined(PlayerInfo player)
        {
            Debug.Log($"[GameOnNetworkManager] Player joined: {player.username}");
            Players[player.id] = player;
            OnPlayerEnteredRoom?.Invoke(player);
        }

        private void HandlePlayerLeft(string playerId)
        {
            Debug.Log($"[GameOnNetworkManager] Player left: {playerId}");
            Players.Remove(playerId);
            DestroyPlayer(playerId);
            OnPlayerLeftRoom?.Invoke(playerId);
        }

        private void HandleGameStarted(object state)
        {
            Debug.Log("[GameOnNetworkManager] Game started!");
            currentGameState = state;
            OnGameStarted?.Invoke();
        }

        private void HandleGameEnded(object results)
        {
            Debug.Log("[GameOnNetworkManager] Game ended!");
            OnGameEnded?.Invoke(results);
        }

        private void HandleStateUpdate(object state)
        {
            currentGameState = state;

            // Update remote player positions if state contains player data
            try
            {
                var stateDict = JsonConvert.DeserializeObject<Dictionary<string, object>>(state.ToString());
                if (stateDict.TryGetValue("players", out var playersObj))
                {
                    var playersData = JsonConvert.DeserializeObject<Dictionary<string, PlayerMovementState>>(playersObj.ToString());
                    UpdateRemotePlayerPositions(playersData);
                }
            }
            catch
            {
                // State might not have player data, that's fine
            }
        }

        private void UpdateRemotePlayerPositions(Dictionary<string, PlayerMovementState> playersData)
        {
            foreach (var kvp in playersData)
            {
                var playerId = kvp.Key;
                var data = kvp.Value;

                // Skip local player
                if (playerId == GameOnClient.Instance.ClientId) continue;

                if (!playerObjects.TryGetValue(playerId, out var playerObject))
                {
                    // Create remote player if doesn't exist
                    var pos = new Vector3(data.transform.position.x, data.transform.position.y, data.transform.position.z);
                    var rot = Quaternion.Euler(0, data.transform.rotation, 0);
                    playerObject = InstantiateRemotePlayer(playerId, pos, rot);
                }

                if (playerObject != null)
                {
                    // Update position (with interpolation)
                    var targetPos = new Vector3(data.transform.position.x, data.transform.position.y, data.transform.position.z);
                    var targetRot = Quaternion.Euler(0, data.transform.rotation, 0);

                    playerObject.transform.position = Vector3.Lerp(playerObject.transform.position, targetPos, Time.deltaTime * 10);
                    playerObject.transform.rotation = Quaternion.Slerp(playerObject.transform.rotation, targetRot, Time.deltaTime * 10);
                }
            }
        }

        #endregion

        #region Utility

        public T GetGameState<T>()
        {
            if (currentGameState == null) return default;
            return JsonConvert.DeserializeObject<T>(currentGameState.ToString());
        }

        public GameObject GetPlayerObject(string playerId)
        {
            playerObjects.TryGetValue(playerId, out var player);
            return player;
        }

        public List<GameObject> GetAllPlayerObjects()
        {
            return new List<GameObject>(playerObjects.Values);
        }

        #endregion
    }

    #region Helper Classes

    [Serializable]
    public class PlayerMovementState
    {
        public TransformState transform;
        public float speed;
        public bool isMoving;
    }

    [Serializable]
    public class TransformState
    {
        public Vector3State position;
        public float rotation;
    }

    [Serializable]
    public class Vector3State
    {
        public float x;
        public float y;
        public float z;
    }

    #endregion
}
