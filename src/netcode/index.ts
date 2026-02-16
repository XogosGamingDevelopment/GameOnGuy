/**
 * Game On Dude! - Netcode Module
 * www.gameonguy.com
 *
 * This module provides advanced networking features for real-time multiplayer games:
 *
 * - **Prediction**: Client-side prediction with server reconciliation
 * - **Lag Compensation**: Server-side lag compensation for hit detection
 * - **Interpolation**: Smooth entity interpolation between updates
 *
 * @example Server-side prediction processing
 * ```typescript
 * import { InputProcessor, LagCompensator } from 'xogos-multiplayer/netcode';
 *
 * const inputProcessor = new InputProcessor({
 *   applyInput: (state, input) => {
 *     state.x += input.dx;
 *     return state;
 *   }
 * });
 *
 * const lagComp = new LagCompensator({ maxHistoryMs: 500 });
 * ```
 *
 * @example Client-side interpolation (Unity reference)
 * ```csharp
 * // Use InterpolationBuffer pattern in Unity
 * var buffer = new InterpolationBuffer<PlayerState>(100f);
 * buffer.AddSnapshot(serverState, serverTime);
 * var interpolated = buffer.GetState(renderTime);
 * ```
 */

// ============================================================================
// Prediction System
// ============================================================================

export {
  // Types
  BaseInput,
  MovementInput,
  InputProcessingResult,
  StateSnapshot as PredictionStateSnapshot,
  InputProcessorOptions,
  ClientPredictionState,
  ServerAck,
  ReconciliationResult,
  // Classes
  InputProcessor,
  // Utilities
  calculatePositionError,
  needsReconciliation,
  smoothCorrection,
  createMovementInput,
} from './Prediction';

// ============================================================================
// Lag Compensation System
// ============================================================================

export {
  // Types
  HistorySnapshot,
  LagCompensatedResult,
  LagCompensatorOptions,
  EntityPosition,
  Hitbox,
  HitValidationRequest,
  HitValidationResult,
  // Classes
  LagCompensator,
  HitValidator,
  // Utilities
  interpolatePosition,
  createEntityMapInterpolator,
} from './LagCompensation';

// ============================================================================
// Interpolation System
// ============================================================================

export {
  // Types
  InterpolationSnapshot,
  InterpolationBufferOptions,
  InterpolationResult,
  VelocityState,
  PositionalState,
  DeadReckoningOptions,
  DeadReckoningState,
  // Classes
  InterpolationBuffer,
  EntityInterpolator,
  DeadReckoningPredictor,
  // Functions
  lerp,
  clamp,
  smoothStep,
  smootherStep,
  slerp,
  lerpPosition,
  extrapolatePosition,
  calculateVelocity,
  hermiteInterpolate,
  hermiteInterpolatePosition,
} from './Interpolation';
