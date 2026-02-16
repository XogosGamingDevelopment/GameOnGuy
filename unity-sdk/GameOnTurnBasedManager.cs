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
    /// High-level manager for turn-based games (Historical Conquest).
    /// Handles turns, actions, and game state.
    /// </summary>
    public class GameOnTurnBasedManager : MonoBehaviour
    {
        [Header("References")]
        [SerializeField] private GameOnNetworkManager networkManager;

        [Header("Settings")]
        [SerializeField] private bool showTurnTimerWarning = true;
        [SerializeField] private float warningTimeThreshold = 10f;

        // Current game state
        private TurnBasedGameState currentState;
        private TurnInfo currentTurn;
        private string localPlayerId;
        private int actionsRemaining;

        // Events
        public event Action<TurnBasedGameState> OnGameStateChanged;
        public event Action<TurnInfo> OnTurnStarted;
        public event Action<TurnEndInfo> OnTurnEnded;
        public event Action<ActionPerformedInfo> OnActionPerformed;
        public event Action OnActionUndone;
        public event Action<string> OnPlayerForfeited;
        public event Action<float> OnTurnTimerUpdated;
        public event Action OnTurnTimerWarning;
        public event Action<GameEndInfo> OnGameEnded;
        public event Action<string> OnActionRejected;

        // Properties
        public TurnBasedGameState CurrentState => currentState;
        public TurnInfo CurrentTurn => currentTurn;
        public bool IsMyTurn => currentTurn?.CurrentPlayerId == localPlayerId;
        public float TurnTimeRemaining => currentTurn?.TimeRemaining ?? 0;
        public int ActionsRemaining => actionsRemaining;
        public bool CanAct => IsMyTurn && actionsRemaining > 0 && currentState == TurnBasedGameState.Playing;

        private void Awake()
        {
            if (networkManager == null)
            {
                networkManager = GetComponent<XogosNetworkManager>();
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
            if (currentState == TurnBasedGameState.Playing && currentTurn != null)
            {
                if (currentTurn.TimeRemaining > 0)
                {
                    currentTurn.TimeRemaining -= Time.deltaTime;
                    OnTurnTimerUpdated?.Invoke(currentTurn.TimeRemaining);

                    // Warning when time is running low
                    if (showTurnTimerWarning &&
                        IsMyTurn &&
                        currentTurn.TimeRemaining <= warningTimeThreshold &&
                        currentTurn.TimeRemaining + Time.deltaTime > warningTimeThreshold)
                    {
                        OnTurnTimerWarning?.Invoke();
                    }
                }
            }
        }

        private void HandleAuthenticated(string userId, string username)
        {
            localPlayerId = userId;
        }

        #region Public API

        /// <summary>
        /// Perform a turn action.
        /// </summary>
        public void PerformAction(object actionData)
        {
            if (!CanAct)
            {
                Debug.LogWarning("Cannot perform action - not your turn or no actions remaining");
                return;
            }

            networkManager.SendGameAction("turn_action", new
            {
                actionType = "turn_action",
                data = actionData
            });
        }

        /// <summary>
        /// Perform a typed action with specific action type.
        /// </summary>
        public void PerformAction(string actionType, object actionData)
        {
            if (!CanAct)
            {
                Debug.LogWarning("Cannot perform action - not your turn or no actions remaining");
                return;
            }

            networkManager.SendGameAction("turn_action", new
            {
                actionType = actionType,
                data = actionData
            });
        }

        /// <summary>
        /// End the current turn early.
        /// </summary>
        public void EndTurn()
        {
            if (!IsMyTurn)
            {
                Debug.LogWarning("Cannot end turn - not your turn");
                return;
            }

            networkManager.SendGameAction("end_turn", null);
        }

        /// <summary>
        /// Undo the last action (if allowed).
        /// </summary>
        public void Undo()
        {
            if (!IsMyTurn)
            {
                Debug.LogWarning("Cannot undo - not your turn");
                return;
            }

            networkManager.SendGameAction("undo", null);
        }

        /// <summary>
        /// Forfeit the game.
        /// </summary>
        public void Forfeit()
        {
            networkManager.SendGameAction("forfeit", null);
        }

        /// <summary>
        /// Signal ready to start.
        /// </summary>
        public void SetReady(bool ready = true)
        {
            networkManager.SetReady(ready);
        }

        #endregion

        #region Message Handling

        private void HandleServerMessage(string type, object payload)
        {
            switch (type)
            {
                case "setup_phase":
                    HandleSetupPhase(payload);
                    break;

                case "game_begin":
                    HandleGameBegin(payload);
                    break;

                case "turn_start":
                    HandleTurnStart(payload);
                    break;

                case "turn_end":
                    HandleTurnEnd(payload);
                    break;

                case "action_performed":
                    HandleActionPerformed(payload);
                    break;

                case "action_rejected":
                    HandleActionRejected(payload);
                    break;

                case "action_undone":
                    HandleActionUndone(payload);
                    break;

                case "player_forfeited":
                    HandlePlayerForfeited(payload);
                    break;

                case "round_end":
                    HandleRoundEnd(payload);
                    break;

                case "game_end":
                    HandleGameEnd(payload);
                    break;

                case "turn_phase":
                    HandleTurnPhase(payload);
                    break;
            }
        }

        private void HandleSetupPhase(object payload)
        {
            currentState = TurnBasedGameState.Setup;
            OnGameStateChanged?.Invoke(currentState);
        }

        private void HandleGameBegin(object payload)
        {
            currentState = TurnBasedGameState.Playing;
            OnGameStateChanged?.Invoke(currentState);

            var data = payload as Dictionary<string, object>;
            if (data != null && data.TryGetValue("turnOrder", out var order))
            {
                // Store turn order if needed
            }
        }

        private void HandleTurnStart(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data != null)
            {
                currentTurn = new TurnInfo
                {
                    CurrentPlayerId = data.ContainsKey("playerId") ? data["playerId"].ToString() : "",
                    TurnNumber = data.ContainsKey("turnNumber") ? Convert.ToInt32(data["turnNumber"]) : 0,
                    RoundNumber = data.ContainsKey("roundNumber") ? Convert.ToInt32(data["roundNumber"]) : 0,
                    TimeRemaining = data.ContainsKey("timeLimit") ? Convert.ToSingle(data["timeLimit"]) / 1000f : 60f
                };

                // Reset actions for new turn
                actionsRemaining = 10; // Will be updated by server

                OnTurnStarted?.Invoke(currentTurn);

                if (IsMyTurn)
                {
                    Debug.Log("It's your turn!");
                }
            }
        }

        private void HandleTurnEnd(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data != null)
            {
                var info = new TurnEndInfo
                {
                    PlayerId = data.ContainsKey("playerId") ? data["playerId"].ToString() : "",
                    Forced = data.ContainsKey("forced") && Convert.ToBoolean(data["forced"])
                };

                OnTurnEnded?.Invoke(info);
            }
        }

        private void HandleActionPerformed(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data != null)
            {
                var info = new ActionPerformedInfo
                {
                    PlayerId = data.ContainsKey("playerId") ? data["playerId"].ToString() : "",
                    ActionsRemaining = data.ContainsKey("actionsRemaining") ? Convert.ToInt32(data["actionsRemaining"]) : 0
                };

                if (info.PlayerId == localPlayerId)
                {
                    actionsRemaining = info.ActionsRemaining;
                }

                OnActionPerformed?.Invoke(info);
            }
        }

        private void HandleActionRejected(object payload)
        {
            var data = payload as Dictionary<string, object>;
            var reason = data?.ContainsKey("reason") == true ? data["reason"].ToString() : "Unknown";
            OnActionRejected?.Invoke(reason);
        }

        private void HandleActionUndone(object payload)
        {
            actionsRemaining++;
            OnActionUndone?.Invoke();
        }

        private void HandlePlayerForfeited(object payload)
        {
            var data = payload as Dictionary<string, object>;
            var playerId = data?.ContainsKey("playerId") == true ? data["playerId"].ToString() : "";
            OnPlayerForfeited?.Invoke(playerId);
        }

        private void HandleRoundEnd(object payload)
        {
            // Round ended, waiting for next round
        }

        private void HandleTurnPhase(object payload)
        {
            var data = payload as Dictionary<string, object>;
            if (data != null && data.TryGetValue("phase", out var phase))
            {
                // Handle phase changes (draw, main, combat, end)
                Debug.Log($"Turn phase: {phase}");
            }
        }

        private void HandleGameEnd(object payload)
        {
            currentState = TurnBasedGameState.Ended;
            OnGameStateChanged?.Invoke(currentState);

            var data = payload as Dictionary<string, object>;
            if (data != null)
            {
                var info = new GameEndInfo
                {
                    WinnerId = data.ContainsKey("winner") ? data["winner"]?.ToString() : null,
                    RoundsPlayed = data.ContainsKey("roundsPlayed") ? Convert.ToInt32(data["roundsPlayed"]) : 0
                };

                OnGameEnded?.Invoke(info);
            }
        }

        #endregion
    }

    #region Data Types

    public enum TurnBasedGameState
    {
        Waiting,
        Setup,
        Playing,
        BetweenTurns,
        Ended
    }

    [Serializable]
    public class TurnInfo
    {
        public string CurrentPlayerId;
        public int TurnNumber;
        public int RoundNumber;
        public float TimeRemaining;
    }

    [Serializable]
    public class TurnEndInfo
    {
        public string PlayerId;
        public bool Forced;
    }

    [Serializable]
    public class ActionPerformedInfo
    {
        public string PlayerId;
        public object Action;
        public int ActionsRemaining;
    }

    [Serializable]
    public class GameEndInfo
    {
        public string WinnerId;
        public int RoundsPlayed;
        public Dictionary<string, object> PlayerData;
    }

    #endregion
}
