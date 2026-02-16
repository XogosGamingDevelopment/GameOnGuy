/**
 * Game On Dude! - Interpolation & Extrapolation System
 * www.gameonguy.com
 *
 * Provides client-side interpolation and extrapolation for smooth
 * rendering of remote entities between state updates.
 *
 * Key Concepts:
 * - Interpolation: Smooth movement between known states (past)
 * - Extrapolation: Predict movement beyond known states (future)
 * - Buffer Management: Store snapshots for interpolation window
 * - Render Delay: Stay behind server time for smooth playback
 *
 * @example Client-side usage (Unity):
 * ```csharp
 * // In Unity, use InterpolationBuffer<T> pattern
 * var buffer = new InterpolationBuffer<PlayerState>(100f); // 100ms delay
 *
 * // On state update from server
 * buffer.AddSnapshot(serverState, serverTimestamp);
 *
 * // In Update/FixedUpdate
 * float renderTime = NetworkTime - 100f; // render 100ms behind
 * PlayerState interpolated = buffer.GetInterpolatedState(renderTime);
 * transform.position = interpolated.position;
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A snapshot of entity state at a point in time.
 */
export interface InterpolationSnapshot<TState> {
  /** The state data */
  state: TState;
  /** Server timestamp of this state */
  timestamp: number;
  /** Sequence number */
  sequence?: number;
}

/**
 * Options for interpolation buffer.
 */
export interface InterpolationBufferOptions {
  /** Interpolation delay in milliseconds (render behind server time) */
  interpolationDelay?: number;
  /** Maximum buffer size */
  bufferSize?: number;
  /** Maximum extrapolation time in milliseconds */
  maxExtrapolationMs?: number;
  /** Extrapolation decay factor (0-1, how much to reduce extrapolation over time) */
  extrapolationDecay?: number;
}

/**
 * Result of interpolation/extrapolation.
 */
export interface InterpolationResult<TState> {
  /** The computed state */
  state: TState;
  /** Mode used to compute state */
  mode: 'interpolation' | 'extrapolation' | 'snapshot';
  /** Blend factor (0-1 for interpolation, >1 for extrapolation) */
  blendFactor: number;
  /** Whether data is stale (extrapolating beyond safe limit) */
  isStale: boolean;
}

/**
 * Velocity data for extrapolation.
 */
export interface VelocityState {
  vx: number;
  vy: number;
  vz?: number;
}

/**
 * Position with optional velocity for extrapolation.
 */
export interface PositionalState {
  x: number;
  y: number;
  z?: number;
  velocity?: VelocityState;
}

// ============================================================================
// Interpolation Functions
// ============================================================================

/**
 * Linear interpolation between two values.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Smooth step interpolation (ease in-out).
 */
export function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Smoother step interpolation (Ken Perlin's version).
 */
export function smootherStep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Spherical linear interpolation for rotations (quaternion-like).
 */
export function slerp(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
  t: number
): { x: number; y: number; z: number; w: number } {
  // Calculate cosine of angle between quaternions
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;

  // If negative dot, negate one quaternion to take shortest path
  const bAdjusted = dot < 0 ? { x: -b.x, y: -b.y, z: -b.z, w: -b.w } : b;
  dot = Math.abs(dot);

  // If quaternions are very close, use linear interpolation
  if (dot > 0.9995) {
    return {
      x: lerp(a.x, bAdjusted.x, t),
      y: lerp(a.y, bAdjusted.y, t),
      z: lerp(a.z, bAdjusted.z, t),
      w: lerp(a.w, bAdjusted.w, t),
    };
  }

  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;

  return {
    x: a.x * wa + bAdjusted.x * wb,
    y: a.y * wa + bAdjusted.y * wb,
    z: a.z * wa + bAdjusted.z * wb,
    w: a.w * wa + bAdjusted.w * wb,
  };
}

/**
 * Interpolate a position.
 */
export function lerpPosition(
  a: PositionalState,
  b: PositionalState,
  t: number
): PositionalState {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    z: a.z !== undefined || b.z !== undefined
      ? lerp(a.z ?? 0, b.z ?? 0, t)
      : undefined,
    velocity: a.velocity && b.velocity
      ? {
          vx: lerp(a.velocity.vx, b.velocity.vx, t),
          vy: lerp(a.velocity.vy, b.velocity.vy, t),
          vz: a.velocity.vz !== undefined || b.velocity.vz !== undefined
            ? lerp(a.velocity.vz ?? 0, b.velocity.vz ?? 0, t)
            : undefined,
        }
      : undefined,
  };
}

/**
 * Extrapolate a position using velocity.
 */
export function extrapolatePosition(
  state: PositionalState,
  deltaTimeSeconds: number,
  decayFactor: number = 1.0
): PositionalState {
  if (!state.velocity) {
    return state;
  }

  const decay = Math.pow(decayFactor, deltaTimeSeconds);

  return {
    x: state.x + state.velocity.vx * deltaTimeSeconds * decay,
    y: state.y + state.velocity.vy * deltaTimeSeconds * decay,
    z: state.z !== undefined
      ? state.z + (state.velocity.vz ?? 0) * deltaTimeSeconds * decay
      : undefined,
    velocity: state.velocity,
  };
}

/**
 * Calculate velocity from two positions.
 */
export function calculateVelocity(
  from: PositionalState,
  to: PositionalState,
  deltaTimeSeconds: number
): VelocityState {
  if (deltaTimeSeconds <= 0) {
    return { vx: 0, vy: 0, vz: 0 };
  }

  return {
    vx: (to.x - from.x) / deltaTimeSeconds,
    vy: (to.y - from.y) / deltaTimeSeconds,
    vz: to.z !== undefined && from.z !== undefined
      ? (to.z - from.z) / deltaTimeSeconds
      : undefined,
  };
}

// ============================================================================
// Interpolation Buffer
// ============================================================================

/**
 * Buffer for storing state snapshots and computing interpolated values.
 * Designed for client-side entity interpolation.
 */
export class InterpolationBuffer<TState> {
  private snapshots: InterpolationSnapshot<TState>[] = [];
  private options: Required<InterpolationBufferOptions>;

  constructor(options: InterpolationBufferOptions = {}) {
    this.options = {
      interpolationDelay: options.interpolationDelay ?? 100,
      bufferSize: options.bufferSize ?? 20,
      maxExtrapolationMs: options.maxExtrapolationMs ?? 250,
      extrapolationDecay: options.extrapolationDecay ?? 0.9,
    };
  }

  /**
   * Add a new state snapshot.
   */
  addSnapshot(snapshot: InterpolationSnapshot<TState>): void {
    // Insert in order by timestamp
    let insertIndex = this.snapshots.length;
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].timestamp <= snapshot.timestamp) {
        insertIndex = i + 1;
        break;
      }
      if (i === 0) {
        insertIndex = 0;
      }
    }

    this.snapshots.splice(insertIndex, 0, snapshot);

    // Trim buffer
    while (this.snapshots.length > this.options.bufferSize) {
      this.snapshots.shift();
    }
  }

  /**
   * Get interpolated state at the given render time.
   * @param renderTime Current client time (will be delayed by interpolationDelay)
   */
  getInterpolatedState(
    renderTime: number,
    interpolate: (a: TState, b: TState, t: number) => TState,
    extrapolate?: (state: TState, deltaMs: number, decay: number) => TState
  ): InterpolationResult<TState> | undefined {
    if (this.snapshots.length === 0) {
      return undefined;
    }

    // Calculate target time (render behind server by delay amount)
    const targetTime = renderTime - this.options.interpolationDelay;

    // Find surrounding snapshots
    let before: InterpolationSnapshot<TState> | undefined;
    let after: InterpolationSnapshot<TState> | undefined;

    for (let i = 0; i < this.snapshots.length; i++) {
      const snapshot = this.snapshots[i];

      if (snapshot.timestamp <= targetTime) {
        before = snapshot;
      }

      if (snapshot.timestamp >= targetTime && !after) {
        after = snapshot;
        break;
      }
    }

    // Case 1: Target time is before all snapshots - use oldest
    if (!before && after) {
      return {
        state: after.state,
        mode: 'snapshot',
        blendFactor: 0,
        isStale: true,
      };
    }

    // Case 2: Target time is after all snapshots - extrapolate
    if (before && !after) {
      const latestSnapshot = this.snapshots[this.snapshots.length - 1];
      const extrapolationTime = targetTime - latestSnapshot.timestamp;

      // Check if extrapolation is within limits
      if (extrapolationTime > this.options.maxExtrapolationMs) {
        return {
          state: latestSnapshot.state,
          mode: 'snapshot',
          blendFactor: 1,
          isStale: true,
        };
      }

      // Extrapolate if function provided
      if (extrapolate && this.snapshots.length >= 2) {
        const extrapolatedState = extrapolate(
          latestSnapshot.state,
          extrapolationTime,
          this.options.extrapolationDecay
        );

        return {
          state: extrapolatedState,
          mode: 'extrapolation',
          blendFactor: 1 + extrapolationTime / this.options.maxExtrapolationMs,
          isStale: extrapolationTime > this.options.maxExtrapolationMs * 0.5,
        };
      }

      return {
        state: latestSnapshot.state,
        mode: 'snapshot',
        blendFactor: 1,
        isStale: extrapolationTime > this.options.maxExtrapolationMs * 0.5,
      };
    }

    // Case 3: Target time is between two snapshots - interpolate
    if (before && after) {
      if (before.timestamp === after.timestamp) {
        return {
          state: before.state,
          mode: 'snapshot',
          blendFactor: 0,
          isStale: false,
        };
      }

      const t = (targetTime - before.timestamp) / (after.timestamp - before.timestamp);
      const interpolatedState = interpolate(before.state, after.state, t);

      return {
        state: interpolatedState,
        mode: 'interpolation',
        blendFactor: t,
        isStale: false,
      };
    }

    return undefined;
  }

  /**
   * Get the latest snapshot.
   */
  getLatestSnapshot(): InterpolationSnapshot<TState> | undefined {
    return this.snapshots[this.snapshots.length - 1];
  }

  /**
   * Get all snapshots in the buffer.
   */
  getSnapshots(): InterpolationSnapshot<TState>[] {
    return [...this.snapshots];
  }

  /**
   * Get buffer size.
   */
  getBufferSize(): number {
    return this.snapshots.length;
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.snapshots = [];
  }

  /**
   * Update interpolation delay.
   */
  setInterpolationDelay(delayMs: number): void {
    this.options.interpolationDelay = delayMs;
  }
}

// ============================================================================
// Entity Interpolator
// ============================================================================

/**
 * Manages interpolation for multiple entities.
 */
export class EntityInterpolator<TEntity extends PositionalState> {
  private buffers: Map<string, InterpolationBuffer<TEntity>> = new Map();
  private options: InterpolationBufferOptions;

  constructor(options: InterpolationBufferOptions = {}) {
    this.options = options;
  }

  /**
   * Add a snapshot for an entity.
   */
  addEntitySnapshot(entityId: string, state: TEntity, timestamp: number): void {
    let buffer = this.buffers.get(entityId);
    if (!buffer) {
      buffer = new InterpolationBuffer<TEntity>(this.options);
      this.buffers.set(entityId, buffer);
    }

    buffer.addSnapshot({ state, timestamp });
  }

  /**
   * Get interpolated state for an entity.
   */
  getEntityState(
    entityId: string,
    renderTime: number
  ): InterpolationResult<TEntity> | undefined {
    const buffer = this.buffers.get(entityId);
    if (!buffer) {
      return undefined;
    }

    return buffer.getInterpolatedState(
      renderTime,
      (a, b, t) => lerpPosition(a, b, t) as TEntity,
      (state, deltaMs, decay) => extrapolatePosition(state, deltaMs / 1000, decay) as TEntity
    );
  }

  /**
   * Get all entity IDs being tracked.
   */
  getEntityIds(): string[] {
    return [...this.buffers.keys()];
  }

  /**
   * Remove an entity from tracking.
   */
  removeEntity(entityId: string): boolean {
    return this.buffers.delete(entityId);
  }

  /**
   * Clear all entity buffers.
   */
  clear(): void {
    this.buffers.clear();
  }
}

// ============================================================================
// Hermite Interpolation (for smooth curves)
// ============================================================================

/**
 * Hermite spline interpolation for smoother curves.
 * Takes into account position and velocity at both endpoints.
 */
export function hermiteInterpolate(
  p0: number,
  v0: number,
  p1: number,
  v1: number,
  t: number,
  tension: number = 0
): number {
  const t2 = t * t;
  const t3 = t2 * t;

  // Adjust velocities by tension
  v0 = v0 * (1 - tension);
  v1 = v1 * (1 - tension);

  // Hermite basis functions
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return h00 * p0 + h10 * v0 + h01 * p1 + h11 * v1;
}

/**
 * Hermite interpolation for positions with velocities.
 */
export function hermiteInterpolatePosition(
  from: PositionalState & { velocity: VelocityState },
  to: PositionalState & { velocity: VelocityState },
  t: number,
  deltaTimeSeconds: number,
  tension: number = 0
): PositionalState {
  return {
    x: hermiteInterpolate(
      from.x,
      from.velocity.vx * deltaTimeSeconds,
      to.x,
      to.velocity.vx * deltaTimeSeconds,
      t,
      tension
    ),
    y: hermiteInterpolate(
      from.y,
      from.velocity.vy * deltaTimeSeconds,
      to.y,
      to.velocity.vy * deltaTimeSeconds,
      t,
      tension
    ),
    z: from.z !== undefined && to.z !== undefined
      ? hermiteInterpolate(
          from.z,
          (from.velocity.vz ?? 0) * deltaTimeSeconds,
          to.z,
          (to.velocity.vz ?? 0) * deltaTimeSeconds,
          t,
          tension
        )
      : undefined,
  };
}

// ============================================================================
// Dead Reckoning
// ============================================================================

/**
 * Dead reckoning options.
 */
export interface DeadReckoningOptions {
  /** Maximum prediction time before forcing an update */
  maxPredictionMs?: number;
  /** Threshold for position correction (units) */
  positionThreshold?: number;
  /** Blending speed for corrections (0-1 per second) */
  blendSpeed?: number;
}

/**
 * Dead reckoning state for an entity.
 */
export interface DeadReckoningState<TState extends PositionalState> {
  /** Last confirmed server state */
  serverState: TState;
  /** Server timestamp of last update */
  serverTimestamp: number;
  /** Current visual (displayed) position */
  displayPosition: PositionalState;
  /** Target position from prediction */
  targetPosition: PositionalState;
  /** Whether correction is in progress */
  correcting: boolean;
}

/**
 * Dead reckoning predictor for a single entity.
 * Predicts movement between updates and smoothly corrects errors.
 */
export class DeadReckoningPredictor<TState extends PositionalState> {
  private state: DeadReckoningState<TState> | null = null;
  private options: Required<DeadReckoningOptions>;

  constructor(options: DeadReckoningOptions = {}) {
    this.options = {
      maxPredictionMs: options.maxPredictionMs ?? 500,
      positionThreshold: options.positionThreshold ?? 0.1,
      blendSpeed: options.blendSpeed ?? 10,
    };
  }

  /**
   * Update with new server state.
   */
  updateServerState(state: TState, serverTimestamp: number): void {
    if (!this.state) {
      this.state = {
        serverState: state,
        serverTimestamp,
        displayPosition: { x: state.x, y: state.y, z: state.z },
        targetPosition: { x: state.x, y: state.y, z: state.z },
        correcting: false,
      };
      return;
    }

    this.state.serverState = state;
    this.state.serverTimestamp = serverTimestamp;

    // Calculate target position
    this.state.targetPosition = { x: state.x, y: state.y, z: state.z };

    // Check if correction is needed
    const error = this.calculateError(this.state.displayPosition, this.state.targetPosition);
    this.state.correcting = error > this.options.positionThreshold;
  }

  /**
   * Get the current display position.
   * Call this each frame with the delta time.
   */
  getDisplayPosition(currentTime: number, deltaTimeSeconds: number): PositionalState | null {
    if (!this.state) {
      return null;
    }

    const timeSinceUpdate = currentTime - this.state.serverTimestamp;

    // Predict target position based on velocity
    if (this.state.serverState.velocity && timeSinceUpdate < this.options.maxPredictionMs) {
      this.state.targetPosition = extrapolatePosition(
        this.state.serverState,
        timeSinceUpdate / 1000
      );
    }

    // Blend display position towards target
    if (this.state.correcting) {
      const blendFactor = Math.min(1, this.options.blendSpeed * deltaTimeSeconds);
      this.state.displayPosition = lerpPosition(
        this.state.displayPosition,
        this.state.targetPosition,
        blendFactor
      );

      // Check if correction is complete
      const error = this.calculateError(this.state.displayPosition, this.state.targetPosition);
      if (error < this.options.positionThreshold * 0.1) {
        this.state.correcting = false;
      }
    } else {
      // No correction needed, follow predicted position
      this.state.displayPosition = this.state.targetPosition;
    }

    return this.state.displayPosition;
  }

  /**
   * Check if currently correcting.
   */
  isCorrecting(): boolean {
    return this.state?.correcting ?? false;
  }

  private calculateError(a: PositionalState, b: PositionalState): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z ?? 0) - (b.z ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
