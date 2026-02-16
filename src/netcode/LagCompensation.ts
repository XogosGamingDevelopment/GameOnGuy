/**
 * Game On Dude! - Lag Compensation System
 * www.gameonguy.com
 *
 * Provides server-side lag compensation for accurate hit detection
 * in high-latency environments. This module allows the server to
 * "rewind" the game state to validate actions from the client's perspective.
 *
 * Key Concepts:
 * - State History: Server maintains snapshots of authoritative state
 * - Time Rewind: Rollback state to validate client actions
 * - Hit Validation: Check collisions at the time client saw them
 * - RTT-Based Compensation: Account for round-trip latency
 *
 * @example
 * ```typescript
 * const lagComp = new LagCompensator<PlayerState>({
 *   maxHistoryMs: 500,
 *   interpolationDelay: 100,
 * });
 *
 * // Store state each tick
 * lagComp.recordState(serverTime, getAllPlayerStates());
 *
 * // When validating a hit
 * const pastState = lagComp.getStateAtTime(clientTimestamp);
 * const hitValid = checkCollision(pastState, hitData);
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/**
 * A recorded state snapshot with timestamp.
 */
export interface HistorySnapshot<TState> {
  /** Server timestamp when this state was recorded */
  timestamp: number;
  /** The state at this timestamp */
  state: TState;
  /** Server tick number */
  tick: number;
}

/**
 * Result of a lag-compensated query.
 */
export interface LagCompensatedResult<TState> {
  /** The state at the requested time */
  state: TState;
  /** Whether interpolation was used */
  interpolated: boolean;
  /** The actual timestamp of the returned state */
  actualTimestamp: number;
  /** How far back in time we looked (ms) */
  rewindAmount: number;
}

/**
 * Options for the LagCompensator.
 */
export interface LagCompensatorOptions<TState> {
  /** Maximum history to keep in milliseconds (default: 1000) */
  maxHistoryMs?: number;
  /** Server tick rate in Hz (default: 20) */
  tickRate?: number;
  /** Function to interpolate between two states */
  interpolate?: (stateA: TState, stateB: TState, t: number) => TState;
  /** Function to clone state */
  cloneState?: (state: TState) => TState;
  /** Maximum rewind allowed in ms (prevents exploits) */
  maxRewindMs?: number;
}

/**
 * Entity position for hit detection.
 */
export interface EntityPosition {
  x: number;
  y: number;
  z?: number;
}

/**
 * Hitbox definition for collision detection.
 */
export interface Hitbox {
  /** Center position offset from entity position */
  offset: EntityPosition;
  /** Half-extents (for box) or radius (for sphere) */
  size: EntityPosition | number;
  /** Hitbox type */
  type: 'box' | 'sphere' | 'capsule';
}

/**
 * Hit validation request.
 */
export interface HitValidationRequest {
  /** Timestamp when client saw the target */
  clientTimestamp: number;
  /** Client's RTT at time of shot */
  clientRtt: number;
  /** Source position (attacker) */
  sourcePosition: EntityPosition;
  /** Target entity ID */
  targetId: string;
  /** Direction of attack (for raycast) */
  direction?: EntityPosition;
  /** Maximum range of attack */
  maxRange?: number;
}

/**
 * Hit validation result.
 */
export interface HitValidationResult {
  /** Whether the hit is valid */
  valid: boolean;
  /** Reason if invalid */
  reason?: string;
  /** Distance to target */
  distance?: number;
  /** Actual server time used for validation */
  validationTimestamp: number;
  /** How far back time was rewound */
  rewindMs: number;
}

// ============================================================================
// Lag Compensator
// ============================================================================

/**
 * Server-side lag compensation for accurate hit detection.
 * Maintains a history of game states and allows querying past states.
 */
export class LagCompensator<TState> {
  private history: HistorySnapshot<TState>[] = [];
  private options: Required<LagCompensatorOptions<TState>>;
  private currentTick: number = 0;

  constructor(options: LagCompensatorOptions<TState> = {}) {
    this.options = {
      maxHistoryMs: options.maxHistoryMs ?? 1000,
      tickRate: options.tickRate ?? 20,
      interpolate: options.interpolate ?? ((a, _b, _t) => a),
      cloneState: options.cloneState ?? ((s) => JSON.parse(JSON.stringify(s))),
      maxRewindMs: options.maxRewindMs ?? 500,
    };
  }

  /**
   * Record the current state at the given timestamp.
   * Call this once per server tick.
   */
  recordState(timestamp: number, state: TState): void {
    this.currentTick++;

    this.history.push({
      timestamp,
      state: this.options.cloneState(state),
      tick: this.currentTick,
    });

    // Prune old history
    const cutoff = timestamp - this.options.maxHistoryMs;
    while (this.history.length > 0 && this.history[0].timestamp < cutoff) {
      this.history.shift();
    }
  }

  /**
   * Get the state at a specific timestamp.
   * Uses interpolation if the exact timestamp isn't available.
   */
  getStateAtTime(timestamp: number): LagCompensatedResult<TState> | undefined {
    if (this.history.length === 0) {
      return undefined;
    }

    const now = Date.now();
    const rewindAmount = now - timestamp;

    // Enforce maximum rewind
    if (rewindAmount > this.options.maxRewindMs) {
      // Use oldest allowed state
      const limitedTimestamp = now - this.options.maxRewindMs;
      return this.getStateAtTimeInternal(limitedTimestamp, this.options.maxRewindMs);
    }

    return this.getStateAtTimeInternal(timestamp, rewindAmount);
  }

  private getStateAtTimeInternal(
    timestamp: number,
    rewindAmount: number
  ): LagCompensatedResult<TState> | undefined {
    // Find snapshots around the timestamp
    let before: HistorySnapshot<TState> | undefined;
    let after: HistorySnapshot<TState> | undefined;

    for (let i = 0; i < this.history.length; i++) {
      const snapshot = this.history[i];

      if (snapshot.timestamp <= timestamp) {
        before = snapshot;
      }

      if (snapshot.timestamp >= timestamp && !after) {
        after = snapshot;
        break;
      }
    }

    // If we have an exact match or only one snapshot
    if (before && before.timestamp === timestamp) {
      return {
        state: this.options.cloneState(before.state),
        interpolated: false,
        actualTimestamp: before.timestamp,
        rewindAmount,
      };
    }

    // If timestamp is before our history
    if (!before && after) {
      return {
        state: this.options.cloneState(after.state),
        interpolated: false,
        actualTimestamp: after.timestamp,
        rewindAmount,
      };
    }

    // If timestamp is after our history
    if (before && !after) {
      return {
        state: this.options.cloneState(before.state),
        interpolated: false,
        actualTimestamp: before.timestamp,
        rewindAmount,
      };
    }

    // Interpolate between snapshots
    if (before && after) {
      const t = (timestamp - before.timestamp) / (after.timestamp - before.timestamp);
      const interpolatedState = this.options.interpolate(before.state, after.state, t);

      return {
        state: interpolatedState,
        interpolated: true,
        actualTimestamp: timestamp,
        rewindAmount,
      };
    }

    return undefined;
  }

  /**
   * Get state at a specific server tick.
   */
  getStateAtTick(tick: number): HistorySnapshot<TState> | undefined {
    return this.history.find((s) => s.tick === tick);
  }

  /**
   * Get the most recent state.
   */
  getCurrentState(): HistorySnapshot<TState> | undefined {
    return this.history[this.history.length - 1];
  }

  /**
   * Get recent history snapshots.
   */
  getRecentHistory(count: number): HistorySnapshot<TState>[] {
    return this.history.slice(-count);
  }

  /**
   * Get current tick number.
   */
  getCurrentTick(): number {
    return this.currentTick;
  }

  /**
   * Get history buffer size.
   */
  getHistorySize(): number {
    return this.history.length;
  }

  /**
   * Clear all history.
   */
  clear(): void {
    this.history = [];
  }
}

// ============================================================================
// Hit Validator
// ============================================================================

/**
 * Validates hits using lag compensation.
 * Works with the LagCompensator to check if a hit was valid
 * at the time the client performed the action.
 */
export class HitValidator<TEntityState extends { position: EntityPosition; hitbox?: Hitbox }> {
  private lagCompensator: LagCompensator<Map<string, TEntityState>>;
  private options: {
    maxRewindMs: number;
    hitboxExpansion: number;
    defaultHitboxRadius: number;
  };

  constructor(
    lagCompensator: LagCompensator<Map<string, TEntityState>>,
    options: {
      maxRewindMs?: number;
      hitboxExpansion?: number;
      defaultHitboxRadius?: number;
    } = {}
  ) {
    this.lagCompensator = lagCompensator;
    this.options = {
      maxRewindMs: options.maxRewindMs ?? 500,
      hitboxExpansion: options.hitboxExpansion ?? 0,
      defaultHitboxRadius: options.defaultHitboxRadius ?? 0.5,
    };
  }

  /**
   * Validate a hit request.
   */
  validateHit(request: HitValidationRequest): HitValidationResult {
    // Calculate the server time to check
    // Client timestamp + half RTT gives us the server time when client saw the action
    const validationTimestamp = request.clientTimestamp;
    const rewindMs = Date.now() - validationTimestamp;

    // Check if rewind is too far
    if (rewindMs > this.options.maxRewindMs) {
      return {
        valid: false,
        reason: `Rewind too far: ${rewindMs}ms > ${this.options.maxRewindMs}ms`,
        validationTimestamp,
        rewindMs,
      };
    }

    // Get state at the validation time
    const result = this.lagCompensator.getStateAtTime(validationTimestamp);
    if (!result) {
      return {
        valid: false,
        reason: 'No state available for validation time',
        validationTimestamp,
        rewindMs,
      };
    }

    // Get target entity from past state
    const targetState = result.state.get(request.targetId);
    if (!targetState) {
      return {
        valid: false,
        reason: 'Target entity not found in past state',
        validationTimestamp,
        rewindMs,
      };
    }

    // Calculate distance
    const distance = this.calculateDistance(request.sourcePosition, targetState.position);

    // Check range
    if (request.maxRange !== undefined && distance > request.maxRange) {
      return {
        valid: false,
        reason: `Target out of range: ${distance.toFixed(2)} > ${request.maxRange}`,
        distance,
        validationTimestamp,
        rewindMs,
      };
    }

    // Check hitbox collision
    const hitboxRadius = this.getHitboxRadius(targetState);
    const expandedRadius = hitboxRadius + this.options.hitboxExpansion;

    // Simple distance-based collision check
    if (request.direction) {
      // Raycast check
      const hitValid = this.raycastHitCheck(
        request.sourcePosition,
        request.direction,
        targetState.position,
        expandedRadius,
        request.maxRange ?? Infinity
      );

      return {
        valid: hitValid,
        reason: hitValid ? undefined : 'Raycast did not hit target',
        distance,
        validationTimestamp,
        rewindMs,
      };
    } else {
      // Point-based check (melee, etc.)
      const hitValid = distance <= expandedRadius;

      return {
        valid: hitValid,
        reason: hitValid ? undefined : 'Target not within range',
        distance,
        validationTimestamp,
        rewindMs,
      };
    }
  }

  private calculateDistance(a: EntityPosition, b: EntityPosition): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.z ?? 0) - (b.z ?? 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private getHitboxRadius(entity: TEntityState): number {
    if (!entity.hitbox) {
      return this.options.defaultHitboxRadius;
    }

    if (entity.hitbox.type === 'sphere') {
      return typeof entity.hitbox.size === 'number'
        ? entity.hitbox.size
        : entity.hitbox.size.x;
    }

    // For box, use approximate radius
    if (typeof entity.hitbox.size === 'number') {
      return entity.hitbox.size;
    }

    const size = entity.hitbox.size;
    return Math.max(size.x, size.y, size.z ?? size.x);
  }

  private raycastHitCheck(
    origin: EntityPosition,
    direction: EntityPosition,
    target: EntityPosition,
    radius: number,
    maxRange: number
  ): boolean {
    // Normalize direction
    const dirLen = Math.sqrt(
      direction.x * direction.x +
        direction.y * direction.y +
        (direction.z ?? 0) * (direction.z ?? 0)
    );

    if (dirLen === 0) return false;

    const dirNorm = {
      x: direction.x / dirLen,
      y: direction.y / dirLen,
      z: (direction.z ?? 0) / dirLen,
    };

    // Vector from origin to target
    const toTarget = {
      x: target.x - origin.x,
      y: target.y - origin.y,
      z: (target.z ?? 0) - (origin.z ?? 0),
    };

    // Project target onto ray
    const projection =
      toTarget.x * dirNorm.x + toTarget.y * dirNorm.y + toTarget.z * dirNorm.z;

    // Check if target is behind or too far
    if (projection < 0 || projection > maxRange) {
      return false;
    }

    // Find closest point on ray to target
    const closestPoint = {
      x: origin.x + dirNorm.x * projection,
      y: origin.y + dirNorm.y * projection,
      z: (origin.z ?? 0) + dirNorm.z * projection,
    };

    // Check distance from closest point to target
    const distance = this.calculateDistance(closestPoint, target);

    return distance <= radius;
  }
}

// ============================================================================
// Position Interpolator (for lag-compensated states)
// ============================================================================

/**
 * Linear interpolation helper for positions.
 */
export function interpolatePosition(
  a: EntityPosition,
  b: EntityPosition,
  t: number
): EntityPosition {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z !== undefined || b.z !== undefined
      ? (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t
      : undefined,
  };
}

/**
 * Create an interpolator function for entity maps.
 */
export function createEntityMapInterpolator<
  TEntity extends { position: EntityPosition }
>(
  interpolateEntity?: (a: TEntity, b: TEntity, t: number) => TEntity
): (a: Map<string, TEntity>, b: Map<string, TEntity>, t: number) => Map<string, TEntity> {
  return (a: Map<string, TEntity>, b: Map<string, TEntity>, t: number) => {
    const result = new Map<string, TEntity>();

    // Interpolate entities that exist in both states
    for (const [id, entityA] of a) {
      const entityB = b.get(id);
      if (entityB) {
        if (interpolateEntity) {
          result.set(id, interpolateEntity(entityA, entityB, t));
        } else {
          // Default: interpolate position only
          result.set(id, {
            ...entityA,
            position: interpolatePosition(entityA.position, entityB.position, t),
          });
        }
      } else if (t < 0.5) {
        // Entity exists in A but not B, include if closer to A
        result.set(id, entityA);
      }
    }

    // Include entities that only exist in B if closer to B
    if (t >= 0.5) {
      for (const [id, entityB] of b) {
        if (!a.has(id)) {
          result.set(id, entityB);
        }
      }
    }

    return result;
  };
}
