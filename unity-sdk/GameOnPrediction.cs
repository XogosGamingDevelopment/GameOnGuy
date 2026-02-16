/**
 * Game On Dude! SDK for Unity
 * www.gameonguy.com
 *
 * Client-Side Prediction - Provides responsive movement with server reconciliation.
 *
 * Features:
 * - Input buffering with sequence numbers
 * - Local prediction for immediate feedback
 * - Server reconciliation when authoritative state arrives
 * - Input replay for correction
 */

using System;
using System.Collections.Generic;
using UnityEngine;
using Newtonsoft.Json;

namespace GameOn.Multiplayer
{
    /// <summary>
    /// Client-side prediction component for responsive player movement.
    /// Attach to player objects that need prediction.
    /// </summary>
    public class GameOnPrediction : MonoBehaviour
    {
        [Header("Prediction Settings")]
        [SerializeField] private float reconciliationThreshold = 0.1f;
        [SerializeField] private float smoothCorrectionSpeed = 10f;
        [SerializeField] private int maxPendingInputs = 64;
        [SerializeField] private bool enableSmoothing = true;

        [Header("Debug")]
        [SerializeField] private bool showDebugInfo = false;

        // State
        private int inputSequence = 0;
        private List<PredictedInput> pendingInputs = new List<PredictedInput>();
        private Vector3 serverPosition;
        private Vector3 predictedPosition;
        private Vector3 displayPosition;
        private float serverRotation;
        private bool isReconciling = false;
        private int lastConfirmedSequence = -1;

        // Components
        private XogosNetworkIdentity networkIdentity;

        // Events
        public event Action<int, Vector3> OnInputSent;
        public event Action<int, Vector3, float> OnReconciliation; // sequence, correction, error

        public bool IsReconciling => isReconciling;
        public int PendingInputCount => pendingInputs.Count;
        public float LastReconciliationError { get; private set; }

        private void Awake()
        {
            networkIdentity = GetComponent<XogosNetworkIdentity>();
            displayPosition = transform.position;
            predictedPosition = transform.position;
            serverPosition = transform.position;
        }

        private void Start()
        {
            if (networkIdentity != null && networkIdentity.IsLocalPlayer)
            {
                // Subscribe to server acknowledgments
                GameOnClient.Instance.OnGameEvent += HandleServerEvent;
            }
        }

        private void OnDestroy()
        {
            if (GameOnClient.Instance != null)
            {
                GameOnClient.Instance.OnGameEvent -= HandleServerEvent;
            }
        }

        private void Update()
        {
            if (networkIdentity == null || !networkIdentity.IsLocalPlayer) return;

            // Smooth display position towards predicted position
            if (enableSmoothing && isReconciling)
            {
                displayPosition = Vector3.Lerp(displayPosition, predictedPosition, Time.deltaTime * smoothCorrectionSpeed);
                transform.position = displayPosition;

                // Check if reconciliation is complete
                if (Vector3.Distance(displayPosition, predictedPosition) < 0.01f)
                {
                    isReconciling = false;
                }
            }
            else
            {
                displayPosition = predictedPosition;
                transform.position = displayPosition;
            }
        }

        /// <summary>
        /// Record and send a predicted input.
        /// Call this instead of directly sending movement to the server.
        /// </summary>
        public void RecordInput(Vector2 direction, float deltaTime, List<string> actions = null)
        {
            if (networkIdentity == null || !networkIdentity.IsLocalPlayer) return;

            inputSequence++;

            var input = new PredictedInput
            {
                sequence = inputSequence,
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                deltaTime = deltaTime,
                direction = direction,
                actions = actions,
                predictedPosition = predictedPosition
            };

            // Apply prediction locally
            ApplyInputLocally(input);

            // Store for reconciliation
            pendingInputs.Add(input);
            if (pendingInputs.Count > maxPendingInputs)
            {
                pendingInputs.RemoveAt(0);
            }

            // Send to server
            SendInputToServer(input);

            OnInputSent?.Invoke(inputSequence, predictedPosition);
        }

        /// <summary>
        /// Apply input locally for prediction.
        /// Override this to customize movement logic.
        /// </summary>
        protected virtual void ApplyInputLocally(PredictedInput input)
        {
            // Default: simple movement
            float speed = 5f; // You should customize this
            Vector3 movement = new Vector3(input.direction.x, 0, input.direction.y) * speed * input.deltaTime;
            predictedPosition += movement;
        }

        /// <summary>
        /// Reconcile with server state.
        /// Called when server acknowledgment is received.
        /// </summary>
        public void Reconcile(ServerAck ack)
        {
            // Update last confirmed sequence
            lastConfirmedSequence = ack.sequence;

            // Update server position
            serverPosition = ack.position;
            serverRotation = ack.rotation;

            // Remove confirmed inputs
            pendingInputs.RemoveAll(i => i.sequence <= ack.sequence);

            // Calculate error
            float error = Vector3.Distance(predictedPosition, serverPosition);
            LastReconciliationError = error;

            if (showDebugInfo)
            {
                Debug.Log($"[Prediction] Reconcile seq={ack.sequence}, error={error:F3}, pending={pendingInputs.Count}");
            }

            // Check if reconciliation is needed
            if (error > reconciliationThreshold)
            {
                isReconciling = true;

                // Reset to server state
                predictedPosition = serverPosition;

                // Replay all unconfirmed inputs
                foreach (var input in pendingInputs)
                {
                    ApplyInputLocally(input);
                }

                OnReconciliation?.Invoke(ack.sequence, serverPosition, error);
            }
        }

        private void SendInputToServer(PredictedInput input)
        {
            GameOnClient.Instance?.SendGameAction("move", new
            {
                sequence = input.sequence,
                timestamp = input.timestamp,
                dt = input.deltaTime,
                direction = new { x = input.direction.x, y = input.direction.y },
                actions = input.actions
            });
        }

        private void HandleServerEvent(string type, object payload)
        {
            if (type == "input_ack")
            {
                try
                {
                    var ack = JsonConvert.DeserializeObject<ServerAck>(payload.ToString());
                    Reconcile(ack);
                }
                catch (Exception e)
                {
                    Debug.LogError($"[Prediction] Error parsing server ack: {e.Message}");
                }
            }
        }

        /// <summary>
        /// Clear all pending inputs. Call when teleporting or resetting position.
        /// </summary>
        public void ClearPendingInputs()
        {
            pendingInputs.Clear();
            isReconciling = false;
        }

        /// <summary>
        /// Force sync with server position.
        /// </summary>
        public void ForceSync(Vector3 position, float rotation = 0f)
        {
            serverPosition = position;
            predictedPosition = position;
            displayPosition = position;
            serverRotation = rotation;
            transform.position = position;
            ClearPendingInputs();
        }

        private void OnGUI()
        {
            if (!showDebugInfo || networkIdentity == null || !networkIdentity.IsLocalPlayer) return;

            GUILayout.BeginArea(new Rect(10, 10, 300, 150));
            GUILayout.Label($"Input Sequence: {inputSequence}");
            GUILayout.Label($"Pending Inputs: {pendingInputs.Count}");
            GUILayout.Label($"Last Confirmed: {lastConfirmedSequence}");
            GUILayout.Label($"Reconciling: {isReconciling}");
            GUILayout.Label($"Last Error: {LastReconciliationError:F3}");
            GUILayout.Label($"Server Pos: {serverPosition}");
            GUILayout.Label($"Predicted Pos: {predictedPosition}");
            GUILayout.EndArea();
        }
    }

    #region Data Classes

    [Serializable]
    public class PredictedInput
    {
        public int sequence;
        public long timestamp;
        public float deltaTime;
        public Vector2 direction;
        public List<string> actions;
        public Vector3 predictedPosition;
    }

    [Serializable]
    public class ServerAck
    {
        public int sequence;
        public long serverTimestamp;
        public Vector3 position;
        public float rotation;
        public bool accepted;
        public string rejectionReason;
        public int serverTick;
    }

    #endregion
}
