/**
 * Game On Dude! SDK for Unity
 * www.gameonguy.com
 */

using System;
using System.Collections.Generic;
using UnityEngine;

namespace GameOn.Networking
{
    /// <summary>
    /// High-level manager for real-time movement games (Number Munchers, Panic Attack).
    /// Handles movement input, prediction, and entity synchronization.
    /// </summary>
    public class GameOnMovementManager : MonoBehaviour
    {
        [Header("References")]
        [SerializeField] private GameOnNetworkManager networkManager;
        [SerializeField] private GameOnPrediction prediction;

        [Header("Movement Settings")]
        [SerializeField] private float inputSendRate = 0.05f; // 20 Hz
        [SerializeField] private bool useClientPrediction = true;
        [SerializeField] private bool useInterpolation = true;
        [SerializeField] private float interpolationDelay = 0.1f;

        [Header("Reconciliation")]
        [SerializeField] private float reconciliationThreshold = 0.5f;
        [SerializeField] private float smoothCorrectionSpeed = 10f;

        // State
        private MovementGameState currentState;
        private Dictionary<string, PlayerMovementState> playerStates = new Dictionary<string, PlayerMovementState>();
        private Dictionary<string, EntityState> entityStates = new Dictionary<string, EntityState>();
        private string localPlayerId;

        // Input tracking
        private int inputSequence = 0;
        private float lastInputSendTime;
        private Vector2 currentInput;
        private List<string> pendingActions = new List<string>();
        private Queue<InputRecord> inputHistory = new Queue<InputRecord>();
        private const int MaxInputHistory = 120;

        // Events
        public event Action<MovementGameState> OnGameStateChanged;
        public event Action OnCountdownStarted;
        public event Action OnGameStarted;
        public event Action OnGameEnded;
        public event Action<string, PlayerMovementState> OnPlayerSpawned;
        public event Action<string> OnPlayerDespawned;
        public event Action<EntityState> OnEntitySpawned;
        public event Action<string> OnEntityRemoved;
        public event Action<string, string> OnPlayerCollision;
        public event Action<string, string> OnEntityCollision;

        // Properties
        public MovementGameState CurrentState => currentState;
        public Vector3 LocalPlayerPosition => GetPlayerPosition(localPlayerId);
        public Dictionary<string, PlayerMovementState> AllPlayers => playerStates;
        public Dictionary<string, EntityState> AllEntities => entityStates;

        private void Awake()
        {
            if (networkManager == null)
            {
                networkManager = GetComponent<XogosNetworkManager>();
            }

            if (prediction == null)
            {
                prediction = GetComponent<XogosPrediction>();
            }
        }

        private void OnEnable()
        {
            if (networkManager != null)
            {
                networkManager.OnMessage += HandleServerMessage;
                networkManager.OnAuthenticated += HandleAuthenticated;
            }
        }

        private void OnDisable()
        {
            if (networkManager != null)
            {
                networkManager.OnMessage -= HandleServerMessage;
                networkManager.OnAuthenticated -= HandleAuthenticated;
            }
        }

        private void Update()
        {
            if (currentState != MovementGameState.Playing) return;

            // Collect and send input
            if (Time.time - lastInputSendTime >= inputSendRate)
            {
                SendInput();
                lastInputSendTime = Time.time;
            }

            // Interpolate remote players
            if (useInterpolation)
            {
                InterpolateRemotePlayers();
            }
        }

        private void HandleAuthenticated(string userId, string username)
        {
            localPlayerId = userId;
        }

        #region Public API

        /// <summary>
        /// Set movement input direction.
        /// </summary>
        public void SetMoveInput(Vector2 direction)
        {
            currentInput = direction;

            // Apply local prediction immediately
            if (useClientPrediction && prediction != null)
            {
                prediction.ApplyInput(direction, Time.deltaTime);
            }
        }

        /// <summary>
        /// Perform an action (jump, attack, interact, etc).
        /// </summary>
        public void PerformAction(string actionType)
        {
            pendingActions.Add(actionType);

            // Could also send immediately for latency-sensitive actions
            networkManager.SendGameAction("action", new { action = actionType });
        }

        /// <summary>
        /// Interact with an entity.
        /// </summary>
        public void InteractWithEntity(string entityId)
        {
            networkManager.SendGameAction("interact", new { entityId });
        }

        /// <summary>
        /// Get a player's current position.
        /// </summary>
        public Vector3 GetPlayerPosition(string playerId)
        {
            if (playerStates.TryGetValue(playerId, out var state))
            {
                return state.Position;
            }
            return Vector3.zero;
        }

        /// <summary>
        /// Get an entity's current position.
        /// </summary>
        public Vector3 GetEntityPosition(string entityId)
        {
            if (entityStates.TryGetValue(entityId, out var state))
            {
                return state.Position;
            }
            return Vector3.zero;
        }

        /// <summary>
        /// Signal ready to start.
        /// </summary>
        public void SetReady(bool ready = true)
        {
            networkManager.SetReady(ready);
        }

        #endregion

        #region Input Sending

        private void SendInput()
        {
            inputSequence++;

            var input = new MovementInput
            {
                Sequence = inputSequence,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Direction = currentInput,
                Actions = new List<string>(pendingActions)
            };

            // Record for reconciliation
            inputHistory.Enqueue(new InputRecord
            {
                Sequence = inputSequence,
                Input = input,
                PredictedPosition = LocalPlayerPosition,
                Timestamp = Time.time
            });

            // Trim history
            while (inputHistory.Count > MaxInputHistory)
            {
                inputHistory.Dequeue();
            }

            // Send to server
            networkManager.SendGameAction("move", input);

            pendingActions.Clear();
        }

        #endregion

        #region Message Handling

        private void HandleServerMessage(string type, object payload)
        {
            switch (type)
            {
                case "countdown_start":
                    HandleCountdownStart(payload);
                    break;

                case "game_begin":
                    HandleGameBegin(payload);
                    break;

                case "game_end":
                    HandleGameEnd(payload);
                    break;

                case "player_spawned":
                    HandlePlayerSpawned(payload);
                    break;

                case "player_despawned":
                    HandlePlayerDespawned(payload);
                    break;

                case "entity_spawned":
                    HandleEntitySpawned(payload);
                    break;

                case "entity_removed":
                    HandleEntityRemoved(payload);
                    break;

                case "input_ack":
                    HandleInputAck(payload);
                    break;

                case "state_full":
                case "state_patch":
                    HandleStateUpdate(payload);
                    break;
            }
        }

        private void HandleCountdownStart(object payload)
        {
            currentState = MovementGameState.Countdown;
            OnGameStateChanged?.Invoke(currentState);
            OnCountdownStarted?.Invoke();
        }

        private void HandleGameBegin(object payload)
        {
            currentState = MovementGameState.Playing;
            OnGameStateChanged?.Invoke(currentState);
            OnGameStarted?.Invoke();
        }

        private void HandleGameEnd(object payload)
        {
            currentState = MovementGameState.Ended;
            OnGameStateChanged?.Invoke(currentState);
            OnGameEnded?.Invoke();
        }

        private void HandlePlayerSpawned(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data == null) return;

            var playerId = data.ContainsKey("playerId") ? data["playerId"].ToString() : "";
            var state = ParsePlayerState(data);

            playerStates[playerId] = state;
            OnPlayerSpawned?.Invoke(playerId, state);
        }

        private void HandlePlayerDespawned(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data == null) return;

            var playerId = data.ContainsKey("playerId") ? data["playerId"].ToString() : "";
            playerStates.Remove(playerId);
            OnPlayerDespawned?.Invoke(playerId);
        }

        private void HandleEntitySpawned(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data == null) return;

            var state = ParseEntityState(data);
            entityStates[state.Id] = state;
            OnEntitySpawned?.Invoke(state);
        }

        private void HandleEntityRemoved(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data == null) return;

            var entityId = data.ContainsKey("entityId") ? data["entityId"].ToString() : "";
            entityStates.Remove(entityId);
            OnEntityRemoved?.Invoke(entityId);
        }

        private void HandleInputAck(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data == null) return;

            var sequence = data.ContainsKey("sequence") ? Convert.ToInt32(data["sequence"]) : 0;
            var serverPosition = ParseVector3(data, "serverPosition");

            // Reconciliation
            if (useClientPrediction && prediction != null)
            {
                // Remove acknowledged inputs from history
                while (inputHistory.Count > 0 && inputHistory.Peek().Sequence <= sequence)
                {
                    inputHistory.Dequeue();
                }

                // Check if correction needed
                var currentPos = LocalPlayerPosition;
                var error = Vector3.Distance(currentPos, serverPosition);

                if (error > reconciliationThreshold)
                {
                    // Snap or smooth correct to server position
                    prediction.ReconcilePosition(serverPosition);

                    // Re-apply unacknowledged inputs
                    foreach (var record in inputHistory)
                    {
                        prediction.ApplyInput(record.Input.Direction, inputSendRate);
                    }
                }
            }
        }

        private void HandleStateUpdate(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data == null) return;

            // Update player states
            if (data.TryGetValue("players", out var players) && players is Dictionary<string, object> playerDict)
            {
                foreach (var kvp in playerDict)
                {
                    if (kvp.Value is Dictionary<string, object> pData)
                    {
                        var state = ParsePlayerMovementData(pData);

                        if (kvp.Key == localPlayerId && useClientPrediction)
                        {
                            // Handle local player through prediction/reconciliation
                            continue;
                        }

                        playerStates[kvp.Key] = new PlayerMovementState
                        {
                            Position = state.Position,
                            Rotation = state.Rotation,
                            Velocity = state.Velocity,
                            IsMoving = state.IsMoving,
                            Animation = state.Animation
                        };
                    }
                }
            }

            // Update entity states
            if (data.TryGetValue("entities", out var entities) && entities is Dictionary<string, object> entityDict)
            {
                foreach (var kvp in entityDict)
                {
                    if (kvp.Value is Dictionary<string, object> eData)
                    {
                        entityStates[kvp.Key] = ParseEntityState(eData);
                    }
                }
            }
        }

        #endregion

        #region Interpolation

        private void InterpolateRemotePlayers()
        {
            // Simple interpolation - in production would use interpolation buffer
            foreach (var kvp in playerStates)
            {
                if (kvp.Key == localPlayerId) continue;

                var state = kvp.Value;
                if (state.Velocity.sqrMagnitude > 0.01f)
                {
                    // Extrapolate based on velocity
                    state.Position += state.Velocity * Time.deltaTime;
                }
            }
        }

        #endregion

        #region Parsing Helpers

        private PlayerMovementState ParsePlayerState(Dictionary<string, object> data)
        {
            var state = new PlayerMovementState();

            if (data.TryGetValue("transform", out var transform) && transform is Dictionary<string, object> t)
            {
                state.Position = ParseVector3(t, "position");
                state.Rotation = t.ContainsKey("rotation") ? Convert.ToSingle(t["rotation"]) : 0;

                if (t.TryGetValue("velocity", out var vel))
                {
                    state.Velocity = ParseVector3(vel as Dictionary<string, object>, null);
                }
            }

            state.IsMoving = data.ContainsKey("isMoving") && Convert.ToBoolean(data["isMoving"]);
            state.Animation = data.ContainsKey("animation") ? data["animation"].ToString() : "";

            return state;
        }

        private PlayerMovementData ParsePlayerMovementData(Dictionary<string, object> data)
        {
            var result = new PlayerMovementData();

            if (data.TryGetValue("transform", out var transform) && transform is Dictionary<string, object> t)
            {
                result.Position = ParseVector3(t, "position");
                result.Rotation = t.ContainsKey("rotation") ? Convert.ToSingle(t["rotation"]) : 0;

                if (t.TryGetValue("velocity", out var vel) && vel is Dictionary<string, object> velDict)
                {
                    result.Velocity = ParseVector3(velDict, null);
                }
            }

            result.IsMoving = data.ContainsKey("isMoving") && Convert.ToBoolean(data["isMoving"]);
            result.Animation = data.ContainsKey("animation") ? data["animation"].ToString() : "";

            return result;
        }

        private EntityState ParseEntityState(Dictionary<string, object> data)
        {
            var state = new EntityState
            {
                Id = data.ContainsKey("id") ? data["id"].ToString() : "",
                Type = data.ContainsKey("type") ? data["type"].ToString() : "",
                IsActive = !data.ContainsKey("isActive") || Convert.ToBoolean(data["isActive"])
            };

            if (data.TryGetValue("transform", out var transform) && transform is Dictionary<string, object> t)
            {
                state.Position = ParseVector3(t, "position");
                state.Rotation = t.ContainsKey("rotation") ? Convert.ToSingle(t["rotation"]) : 0;
            }

            return state;
        }

        private Vector3 ParseVector3(Dictionary<string, object> data, string key)
        {
            if (data == null) return Vector3.zero;

            var source = key != null && data.TryGetValue(key, out var nested)
                ? nested as Dictionary<string, object>
                : data;

            if (source == null) return Vector3.zero;

            return new Vector3(
                source.ContainsKey("x") ? Convert.ToSingle(source["x"]) : 0,
                source.ContainsKey("y") ? Convert.ToSingle(source["y"]) : 0,
                source.ContainsKey("z") ? Convert.ToSingle(source["z"]) : 0
            );
        }

        #endregion
    }

    #region Data Types

    public enum MovementGameState
    {
        Waiting,
        Countdown,
        Playing,
        Paused,
        Ended
    }

    [Serializable]
    public class PlayerMovementState
    {
        public Vector3 Position;
        public float Rotation;
        public Vector3 Velocity;
        public bool IsMoving;
        public string Animation;
    }

    [Serializable]
    public class PlayerMovementData
    {
        public Vector3 Position;
        public float Rotation;
        public Vector3 Velocity;
        public bool IsMoving;
        public string Animation;
    }

    [Serializable]
    public class EntityState
    {
        public string Id;
        public string Type;
        public Vector3 Position;
        public float Rotation;
        public bool IsActive;
        public Dictionary<string, object> Data;
    }

    [Serializable]
    public class MovementInput
    {
        public int Sequence;
        public long Timestamp;
        public Vector2 Direction;
        public List<string> Actions;
    }

    public class InputRecord
    {
        public int Sequence;
        public MovementInput Input;
        public Vector3 PredictedPosition;
        public float Timestamp;
    }

    #endregion
}
