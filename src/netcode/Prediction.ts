/**
 * Game On Dude! - Client-Side Prediction System
 * www.gameonguy.com
 *
 * Provides client-side prediction with server reconciliation for responsive
 * multiplayer gameplay. This module includes both server-side components
 * (input processing, authoritative state) and types for client implementation.
 *
 * Key Concepts:
 * - Input Buffering: Store inputs with sequence numbers
 * - Prediction: Apply inputs locally before server confirms
 * - Reconciliation: Correct client state when server disagrees
 * - Input Replay: Re-apply unconfirmed inputs after correction
 *
 * @example Server-side usage:
 * ```typescript
 * const processor = new InputProcessor<PlayerState>({
 *   applyInput: (state, input) => {
 *     state.x += input.dx * input.dt;
 *     state.y += input.dy * input.dt;
 *     return state;
 *   }
 * });
 *
 * // Process client input
 * const result = processor.processInput(playerId, input, currentState);
 *
 * // Send acknowledgment to client
 * sendToClient(playerId, {
 *   type: 'input_ack',
 *   payload: result
 * });
 * ```
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Base interface for client inputs.
 * All inputs must have a sequence number and timestamp.
 */
export interface BaseInput {
  /** Unique sequence number for this input (increments per client) */
  sequence: number;
  /** Client timestamp when input was created */
  timestamp: number;
  /** Delta time for this input frame (seconds) */
  dt: number;
}

/**
 * Movement input with direction.
 */
export interface MovementInput extends BaseInput {
  /** Movement direction (-1 to 1 for each axis) */
  direction: { x: number; y: number };
  /** Optional actions triggered this frame */
  actions?: string[];
  /** Whether player is sprinting */
  sprint?: boolean;
}

/**
 * Result of processing an input on the server.
 */
export interface InputProcessingResult<TState> {
  /** The sequence number that was processed */
  sequence: number;
  /** Server timestamp of processing */
  serverTimestamp: number;
  /** Authoritative state after applying input */
  state: TState;
  /** Whether the input was accepted */
  accepted: boolean;
  /** Reason if input was rejected */
  rejectionReason?: string;
  /** Server's tick number for this state */
  serverTick: number;
}

/**
 * Snapshot for state comparison and rollback.
 */
export interface StateSnapshot<TState> {
  /** State at this snapshot */
  state: TState;
  /** Input sequence number */
  sequence: number;
  /** Timestamp of snapshot */
  timestamp: number;
  /** Server tick number */
  serverTick: number;
}

/**
 * Options for InputProcessor.
 */
export interface InputProcessorOptions<TState, TInput extends BaseInput> {
  /** Function to apply an input to state (must be deterministic) */
  applyInput: (state: TState, input: TInput, playerId: string) => TState;
  /** Maximum inputs to buffer per player */
  maxBufferSize?: number;
  /** Maximum input age in ms (older inputs are dropped) */
  maxInputAge?: number;
  /** Validate input before processing */
  validateInput?: (input: TInput, playerId: string) => boolean | string;
  /** Clone state for snapshots */
  cloneState?: (state: TState) => TState;
}

/**
 * Buffered input with metadata.
 */
interface BufferedInput<TInput extends BaseInput> {
  input: TInput;
  receivedAt: number;
  processed: boolean;
}

// ============================================================================
// Input Processor (Server-Side)
// ============================================================================

/**
 * Server-side input processor with buffering and validation.
 * Handles authoritative input processing and generates acknowledgments.
 */
export class InputProcessor<TState, TInput extends BaseInput = MovementInput> {
  private options: Required<InputProcessorOptions<TState, TInput>>;
  private inputBuffers: Map<string, BufferedInput<TInput>[]> = new Map();
  private lastProcessedSequence: Map<string, number> = new Map();
  private stateSnapshots: Map<string, StateSnapshot<TState>[]> = new Map();
  private serverTick: number = 0;

  private readonly maxSnapshotHistory = 60;

  constructor(options: InputProcessorOptions<TState, TInput>) {
    this.options = {
      applyInput: options.applyInput,
      maxBufferSize: options.maxBufferSize ?? 64,
      maxInputAge: options.maxInputAge ?? 1000, // 1 second
      validateInput: options.validateInput ?? (() => true),
      cloneState: options.cloneState ?? ((s) => JSON.parse(JSON.stringify(s))),
    };
  }

  /**
   * Process a single input for a player.
   */
  processInput(
    playerId: string,
    input: TInput,
    currentState: TState
  ): InputProcessingResult<TState> {
    this.serverTick++;

    // Validate input
    const validation = this.options.validateInput(input, playerId);
    if (validation !== true) {
      return {
        sequence: input.sequence,
        serverTimestamp: Date.now(),
        state: currentState,
        accepted: false,
        rejectionReason: typeof validation === 'string' ? validation : 'Invalid input',
        serverTick: this.serverTick,
      };
    }

    // Check for old/duplicate inputs
    const lastSequence = this.lastProcessedSequence.get(playerId) ?? 0;
    if (input.sequence <= lastSequence) {
      return {
        sequence: input.sequence,
        serverTimestamp: Date.now(),
        state: currentState,
        accepted: false,
        rejectionReason: 'Duplicate or old input',
        serverTick: this.serverTick,
      };
    }

    // Check input age
    const inputAge = Date.now() - input.timestamp;
    if (inputAge > this.options.maxInputAge) {
      return {
        sequence: input.sequence,
        serverTimestamp: Date.now(),
        state: currentState,
        accepted: false,
        rejectionReason: 'Input too old',
        serverTick: this.serverTick,
      };
    }

    // Apply input deterministically
    const newState = this.options.applyInput(
      this.options.cloneState(currentState),
      input,
      playerId
    );

    // Update tracking
    this.lastProcessedSequence.set(playerId, input.sequence);

    // Store snapshot
    this.storeSnapshot(playerId, {
      state: this.options.cloneState(newState),
      sequence: input.sequence,
      timestamp: Date.now(),
      serverTick: this.serverTick,
    });

    return {
      sequence: input.sequence,
      serverTimestamp: Date.now(),
      state: newState,
      accepted: true,
      serverTick: this.serverTick,
    };
  }

  /**
   * Buffer an input for later processing (for tick-based processing).
   */
  bufferInput(playerId: string, input: TInput): void {
    let buffer = this.inputBuffers.get(playerId);
    if (!buffer) {
      buffer = [];
      this.inputBuffers.set(playerId, buffer);
    }

    buffer.push({
      input,
      receivedAt: Date.now(),
      processed: false,
    });

    // Trim buffer
    while (buffer.length > this.options.maxBufferSize) {
      buffer.shift();
    }
  }

  /**
   * Process all buffered inputs for a player.
   */
  processBufferedInputs(playerId: string, currentState: TState): TState {
    const buffer = this.inputBuffers.get(playerId);
    if (!buffer || buffer.length === 0) {
      return currentState;
    }

    let state = currentState;
    const toProcess = buffer.filter((b) => !b.processed);

    // Sort by sequence
    toProcess.sort((a, b) => a.input.sequence - b.input.sequence);

    for (const buffered of toProcess) {
      const result = this.processInput(playerId, buffered.input, state);
      if (result.accepted) {
        state = result.state;
      }
      buffered.processed = true;
    }

    // Clean up processed inputs
    this.inputBuffers.set(
      playerId,
      buffer.filter((b) => !b.processed)
    );

    return state;
  }

  /**
   * Get pending (unprocessed) input count for a player.
   */
  getPendingInputCount(playerId: string): number {
    const buffer = this.inputBuffers.get(playerId);
    return buffer?.filter((b) => !b.processed).length ?? 0;
  }

  /**
   * Get the last processed sequence for a player.
   */
  getLastProcessedSequence(playerId: string): number {
    return this.lastProcessedSequence.get(playerId) ?? 0;
  }

  /**
   * Get state snapshot at a specific sequence.
   */
  getSnapshotAtSequence(playerId: string, sequence: number): StateSnapshot<TState> | undefined {
    const snapshots = this.stateSnapshots.get(playerId);
    return snapshots?.find((s) => s.sequence === sequence);
  }

  /**
   * Get state snapshot at a specific server tick.
   */
  getSnapshotAtTick(playerId: string, tick: number): StateSnapshot<TState> | undefined {
    const snapshots = this.stateSnapshots.get(playerId);
    return snapshots?.find((s) => s.serverTick === tick);
  }

  /**
   * Get recent snapshots for a player.
   */
  getRecentSnapshots(playerId: string, count: number = 10): StateSnapshot<TState>[] {
    const snapshots = this.stateSnapshots.get(playerId);
    return snapshots?.slice(-count) ?? [];
  }

  /**
   * Store a state snapshot.
   */
  private storeSnapshot(playerId: string, snapshot: StateSnapshot<TState>): void {
    let snapshots = this.stateSnapshots.get(playerId);
    if (!snapshots) {
      snapshots = [];
      this.stateSnapshots.set(playerId, snapshots);
    }

    snapshots.push(snapshot);

    // Trim history
    while (snapshots.length > this.maxSnapshotHistory) {
      snapshots.shift();
    }
  }

  /**
   * Clean up data for a player (call when player leaves).
   */
  removePlayer(playerId: string): void {
    this.inputBuffers.delete(playerId);
    this.lastProcessedSequence.delete(playerId);
    this.stateSnapshots.delete(playerId);
  }

  /**
   * Get current server tick.
   */
  getServerTick(): number {
    return this.serverTick;
  }

  /**
   * Increment server tick (call once per game tick).
   */
  tick(): void {
    this.serverTick++;
  }
}

// ============================================================================
// Client-Side Prediction Types (for Unity SDK)
// ============================================================================

/**
 * Client-side prediction state (for reference in Unity implementation).
 */
export interface ClientPredictionState<TState> {
  /** Confirmed server state */
  serverState: TState;
  /** Last confirmed sequence number */
  confirmedSequence: number;
  /** Predicted state (after applying unconfirmed inputs) */
  predictedState: TState;
  /** Unconfirmed inputs pending server acknowledgment */
  pendingInputs: BaseInput[];
  /** Whether reconciliation is needed */
  needsReconciliation: boolean;
}

/**
 * Server acknowledgment message.
 */
export interface ServerAck<TState> {
  /** Sequence number being acknowledged */
  sequence: number;
  /** Server timestamp */
  serverTimestamp: number;
  /** Authoritative state */
  state: TState;
  /** Server tick number */
  serverTick: number;
}

/**
 * Reconciliation result.
 */
export interface ReconciliationResult<TState> {
  /** Whether reconciliation was needed */
  corrected: boolean;
  /** Error between predicted and server state */
  error: number;
  /** New predicted state after reconciliation */
  state: TState;
  /** Number of inputs replayed */
  inputsReplayed: number;
}

// ============================================================================
// Prediction Utilities
// ============================================================================

/**
 * Calculate position error between two states.
 */
export function calculatePositionError(
  predicted: { x: number; y: number; z?: number },
  server: { x: number; y: number; z?: number }
): number {
  const dx = predicted.x - server.x;
  const dy = predicted.y - server.y;
  const dz = (predicted.z ?? 0) - (server.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Threshold-based reconciliation check.
 */
export function needsReconciliation(
  error: number,
  threshold: number = 0.1
): boolean {
  return error > threshold;
}

/**
 * Smooth correction over time (for visual smoothing).
 */
export function smoothCorrection(
  current: number,
  target: number,
  smoothing: number = 0.1
): number {
  return current + (target - current) * smoothing;
}

/**
 * Create a movement input.
 */
export function createMovementInput(
  sequence: number,
  direction: { x: number; y: number },
  dt: number,
  actions?: string[]
): MovementInput {
  return {
    sequence,
    timestamp: Date.now(),
    dt,
    direction,
    actions,
  };
}
