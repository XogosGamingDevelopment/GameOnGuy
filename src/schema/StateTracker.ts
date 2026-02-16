/**
 * Game On Dude! - State Tracker
 * www.gameonguy.com
 *
 * Automatic change detection and delta synchronization system.
 * Tracks state changes and generates minimal patches for network sync.
 *
 * Features:
 * - Automatic diffing between state snapshots
 * - JSON Patch (RFC 6902) generation
 * - Binary-optimized delta encoding
 * - Configurable sync modes (full, delta, patch)
 * - State history for interpolation/rollback
 *
 * @example
 * ```typescript
 * const tracker = new StateTracker<GameState>(state);
 *
 * // After state changes
 * state.score = 100;
 * state.players.set("player1", new Player());
 *
 * // Get changes
 * const delta = tracker.getDelta(); // Only changed properties
 * const patches = tracker.getPatches(); // JSON Patch operations
 *
 * // Commit changes
 * tracker.commit();
 * ```
 */

import { Schema } from './Schema';
import { StatePatch } from '../core/types';

// ============================================================================
// Types
// ============================================================================

/** Sync mode determines how state updates are sent */
export enum SyncMode {
  /** Send full state every tick (simple but bandwidth heavy) */
  FULL = 'full',
  /** Send only changed properties (balanced) */
  DELTA = 'delta',
  /** Send JSON Patch operations (most efficient) */
  PATCH = 'patch',
  /** Send binary-encoded delta (most compact) */
  BINARY = 'binary',
}

/** A snapshot of state at a specific time */
export interface StateSnapshot<T> {
  state: T;
  sequence: number;
  timestamp: number;
  checksum?: string;
}

/** Options for state tracking */
export interface StateTrackerOptions {
  /** Maximum number of snapshots to keep in history */
  maxHistory?: number;
  /** Sync mode to use */
  syncMode?: SyncMode;
  /** Whether to compute checksums for validation */
  useChecksums?: boolean;
  /** Interval for full state sync (every N updates, send full) */
  fullSyncInterval?: number;
}

/** Delta update containing only changed data */
export interface StateDelta<T = any> {
  sequence: number;
  timestamp: number;
  changes: Partial<T>;
  isFullSync: boolean;
}

/** Binary-encoded delta for compact transmission */
export interface BinaryDelta {
  sequence: number;
  timestamp: number;
  data: Uint8Array;
}

// ============================================================================
// State Tracker
// ============================================================================

/**
 * Tracks state changes and generates minimal sync updates.
 */
export class StateTracker<T extends Schema | Record<string, any>> {
  private state: T;
  private previousState: any;
  private sequence: number = 0;
  private history: StateSnapshot<any>[] = [];
  private options: Required<StateTrackerOptions>;
  private updatesSinceFullSync: number = 0;

  constructor(state: T, options: StateTrackerOptions = {}) {
    this.state = state;
    this.options = {
      maxHistory: options.maxHistory ?? 60,
      syncMode: options.syncMode ?? SyncMode.DELTA,
      useChecksums: options.useChecksums ?? false,
      fullSyncInterval: options.fullSyncInterval ?? 0, // 0 = never force full sync
    };

    // Store initial snapshot
    this.previousState = this.cloneState();
    this.takeSnapshot();
  }

  // ============================================================================
  // Snapshot Management
  // ============================================================================

  /** Take a snapshot of the current state */
  private takeSnapshot(): void {
    const snapshot: StateSnapshot<any> = {
      state: this.cloneState(),
      sequence: this.sequence,
      timestamp: Date.now(),
    };

    if (this.options.useChecksums) {
      snapshot.checksum = this.computeChecksum(snapshot.state);
    }

    this.history.push(snapshot);

    // Trim history if needed
    while (this.history.length > this.options.maxHistory) {
      this.history.shift();
    }
  }

  /** Clone the current state for comparison */
  private cloneState(): any {
    if (this.state instanceof Schema) {
      return this.state.toJSON();
    }
    return JSON.parse(JSON.stringify(this.state));
  }

  /** Compute a simple checksum for state validation */
  private computeChecksum(state: any): string {
    const str = JSON.stringify(state);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  // ============================================================================
  // Change Detection
  // ============================================================================

  /** Check if state has changes */
  hasChanges(): boolean {
    if (this.state instanceof Schema) {
      return this.state.hasChanges();
    }

    // For plain objects, do deep comparison
    return JSON.stringify(this.state) !== JSON.stringify(this.previousState);
  }

  /** Get whether full sync should be forced */
  private shouldForceFullSync(): boolean {
    if (this.options.fullSyncInterval <= 0) return false;
    return this.updatesSinceFullSync >= this.options.fullSyncInterval;
  }

  // ============================================================================
  // Delta Generation
  // ============================================================================

  /**
   * Get the full current state.
   */
  getFullState(): StateSnapshot<any> {
    return {
      state: this.cloneState(),
      sequence: this.sequence,
      timestamp: Date.now(),
      checksum: this.options.useChecksums
        ? this.computeChecksum(this.cloneState())
        : undefined,
    };
  }

  /**
   * Get a delta update with only changed properties.
   * Returns undefined if no changes.
   */
  getDelta(): StateDelta | undefined {
    const forceFullSync = this.shouldForceFullSync();

    if (forceFullSync) {
      this.updatesSinceFullSync = 0;
      return {
        sequence: this.sequence,
        timestamp: Date.now(),
        changes: this.cloneState(),
        isFullSync: true,
      };
    }

    if (this.state instanceof Schema) {
      const changes = this.state.getChanges();
      if (!changes) return undefined;

      return {
        sequence: this.sequence,
        timestamp: Date.now(),
        changes,
        isFullSync: this.state.isNew(),
      };
    }

    // For plain objects, compute diff
    const changes = this.computeObjectDelta(this.previousState, this.cloneState());
    if (Object.keys(changes).length === 0) return undefined;

    return {
      sequence: this.sequence,
      timestamp: Date.now(),
      changes,
      isFullSync: false,
    };
  }

  /** Compute delta between two plain objects */
  private computeObjectDelta(prev: any, current: any): Record<string, any> {
    const changes: Record<string, any> = {};

    // Find changed and new properties
    for (const key of Object.keys(current)) {
      const prevValue = prev[key];
      const currValue = current[key];

      if (!this.deepEqual(prevValue, currValue)) {
        changes[key] = currValue;
      }
    }

    // Find deleted properties
    for (const key of Object.keys(prev)) {
      if (!(key in current)) {
        changes[key] = undefined;
      }
    }

    return changes;
  }

  /** Deep equality check */
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null || b === null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === 'object') {
      if (Array.isArray(a) !== Array.isArray(b)) return false;

      if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        return a.every((item, i) => this.deepEqual(item, b[i]));
      }

      const keysA = Object.keys(a);
      const keysB = Object.keys(b);
      if (keysA.length !== keysB.length) return false;

      return keysA.every((key) => this.deepEqual(a[key], b[key]));
    }

    return false;
  }

  // ============================================================================
  // JSON Patch Generation (RFC 6902)
  // ============================================================================

  /**
   * Get JSON Patch operations representing state changes.
   * Returns undefined if no changes.
   */
  getPatches(): StatePatch[] | undefined {
    const current = this.cloneState();
    const patches = this.generatePatches(this.previousState, current, '');

    if (patches.length === 0) return undefined;
    return patches;
  }

  /** Generate JSON Patch operations recursively */
  private generatePatches(prev: any, current: any, path: string): StatePatch[] {
    const patches: StatePatch[] = [];

    // Handle null/undefined
    if (prev === null || prev === undefined) {
      if (current !== null && current !== undefined) {
        patches.push({ op: 'add', path: path || '/', value: current });
      }
      return patches;
    }

    if (current === null || current === undefined) {
      patches.push({ op: 'remove', path: path || '/' });
      return patches;
    }

    // Handle primitives
    if (typeof prev !== 'object' || typeof current !== 'object') {
      if (prev !== current) {
        patches.push({ op: 'replace', path: path || '/', value: current });
      }
      return patches;
    }

    // Handle arrays
    if (Array.isArray(prev) && Array.isArray(current)) {
      return this.generateArrayPatches(prev, current, path);
    }

    // Handle objects
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(current)]);

    for (const key of allKeys) {
      const childPath = path ? `${path}/${this.escapeJsonPointer(key)}` : `/${this.escapeJsonPointer(key)}`;

      if (!(key in prev)) {
        // New property
        patches.push({ op: 'add', path: childPath, value: current[key] });
      } else if (!(key in current)) {
        // Removed property
        patches.push({ op: 'remove', path: childPath });
      } else if (!this.deepEqual(prev[key], current[key])) {
        // Changed property
        if (typeof prev[key] === 'object' && typeof current[key] === 'object' &&
            prev[key] !== null && current[key] !== null &&
            !Array.isArray(prev[key]) && !Array.isArray(current[key])) {
          // Recurse into nested objects
          patches.push(...this.generatePatches(prev[key], current[key], childPath));
        } else {
          patches.push({ op: 'replace', path: childPath, value: current[key] });
        }
      }
    }

    return patches;
  }

  /** Generate patches for array changes */
  private generateArrayPatches(prev: any[], current: any[], path: string): StatePatch[] {
    const patches: StatePatch[] = [];

    // Simple approach: if arrays differ significantly, replace entire array
    // For more efficiency, could implement LCS-based diffing
    if (Math.abs(prev.length - current.length) > Math.max(prev.length, current.length) / 2) {
      return [{ op: 'replace', path: path || '/', value: current }];
    }

    // Check each element
    const maxLen = Math.max(prev.length, current.length);
    for (let i = 0; i < maxLen; i++) {
      const childPath = `${path}/${i}`;

      if (i >= prev.length) {
        // New element
        patches.push({ op: 'add', path: childPath, value: current[i] });
      } else if (i >= current.length) {
        // Removed element (push to end to apply in reverse order)
        patches.push({ op: 'remove', path: childPath });
      } else if (!this.deepEqual(prev[i], current[i])) {
        // Changed element
        patches.push({ op: 'replace', path: childPath, value: current[i] });
      }
    }

    // Reverse removal operations so they're applied from end to start
    const removals = patches.filter(p => p.op === 'remove');
    const others = patches.filter(p => p.op !== 'remove');
    return [...others, ...removals.reverse()];
  }

  /** Escape special characters in JSON Pointer */
  private escapeJsonPointer(str: string): string {
    return str.replace(/~/g, '~0').replace(/\//g, '~1');
  }

  // ============================================================================
  // State Application
  // ============================================================================

  /**
   * Apply patches to a target state object.
   */
  static applyPatches<T>(state: T, patches: StatePatch[]): T {
    const result = JSON.parse(JSON.stringify(state));

    for (const patch of patches) {
      StateTracker.applyPatch(result, patch);
    }

    return result;
  }

  /** Apply a single patch operation */
  private static applyPatch(obj: any, patch: StatePatch): void {
    const pathParts = patch.path.split('/').filter(p => p !== '');

    if (pathParts.length === 0) {
      // Root replacement
      if (patch.op === 'replace' || patch.op === 'add') {
        Object.assign(obj, patch.value);
      }
      return;
    }

    let target = obj;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const key = StateTracker.unescapeJsonPointer(pathParts[i]);
      target = target[key];
      if (target === undefined) return;
    }

    const lastKey = StateTracker.unescapeJsonPointer(pathParts[pathParts.length - 1]);

    switch (patch.op) {
      case 'add':
        if (Array.isArray(target)) {
          const index = parseInt(lastKey, 10);
          if (lastKey === '-') {
            target.push(patch.value);
          } else {
            target.splice(index, 0, patch.value);
          }
        } else {
          target[lastKey] = patch.value;
        }
        break;

      case 'remove':
        if (Array.isArray(target)) {
          const index = parseInt(lastKey, 10);
          target.splice(index, 1);
        } else {
          delete target[lastKey];
        }
        break;

      case 'replace':
        target[lastKey] = patch.value;
        break;
    }
  }

  /** Unescape JSON Pointer special characters */
  private static unescapeJsonPointer(str: string): string {
    return str.replace(/~1/g, '/').replace(/~0/g, '~');
  }

  /**
   * Apply a delta update to a target state.
   */
  static applyDelta<T extends Record<string, any>>(state: T, delta: StateDelta): T {
    if (delta.isFullSync) {
      return delta.changes as T;
    }

    const result = { ...state } as Record<string, any>;

    for (const [key, value] of Object.entries(delta.changes)) {
      if (value === undefined) {
        delete result[key];
      } else if (value && typeof value === 'object' && '$changes' in value) {
        // Collection with changes - apply full value for simplicity
        result[key] = (value as any).$value;
      } else if (typeof value === 'object' && value !== null && typeof result[key] === 'object') {
        // Nested object - merge
        result[key] = { ...result[key], ...value };
      } else {
        result[key] = value;
      }
    }

    return result as T;
  }

  // ============================================================================
  // Commit & History
  // ============================================================================

  /**
   * Commit current state changes and prepare for next update.
   */
  commit(): void {
    this.sequence++;
    this.updatesSinceFullSync++;

    if (this.state instanceof Schema) {
      this.state.clearChanges();
    }

    this.previousState = this.cloneState();
    this.takeSnapshot();
  }

  /**
   * Get the current sequence number.
   */
  getSequence(): number {
    return this.sequence;
  }

  /**
   * Get state at a specific sequence number (for interpolation/rollback).
   */
  getStateAtSequence(sequence: number): any | undefined {
    const snapshot = this.history.find(s => s.sequence === sequence);
    return snapshot?.state;
  }

  /**
   * Get recent history for interpolation.
   */
  getRecentHistory(count: number = 3): StateSnapshot<any>[] {
    return this.history.slice(-count);
  }

  /**
   * Validate state against a checksum.
   */
  validateChecksum(state: any, checksum: string): boolean {
    return this.computeChecksum(state) === checksum;
  }

  /**
   * Get sync data based on configured mode.
   */
  getSyncData(): { type: SyncMode; data: any; sequence: number } | undefined {
    switch (this.options.syncMode) {
      case SyncMode.FULL:
        return {
          type: SyncMode.FULL,
          data: this.getFullState(),
          sequence: this.sequence,
        };

      case SyncMode.DELTA:
        const delta = this.getDelta();
        if (!delta) return undefined;
        return {
          type: SyncMode.DELTA,
          data: delta,
          sequence: this.sequence,
        };

      case SyncMode.PATCH:
        const patches = this.getPatches();
        if (!patches) return undefined;
        return {
          type: SyncMode.PATCH,
          data: patches,
          sequence: this.sequence,
        };

      default:
        return {
          type: SyncMode.FULL,
          data: this.getFullState(),
          sequence: this.sequence,
        };
    }
  }
}

// ============================================================================
// Interpolation Helper
// ============================================================================

/**
 * Helper class for client-side state interpolation.
 */
export class StateInterpolator<T extends Record<string, any>> {
  private buffer: StateSnapshot<T>[] = [];
  private readonly bufferSize: number;
  private readonly interpolationDelay: number;

  constructor(options: { bufferSize?: number; interpolationDelay?: number } = {}) {
    this.bufferSize = options.bufferSize ?? 3;
    this.interpolationDelay = options.interpolationDelay ?? 100; // ms
  }

  /** Add a new state snapshot to the buffer */
  addSnapshot(snapshot: StateSnapshot<T>): void {
    this.buffer.push(snapshot);

    // Keep buffer sorted by sequence
    this.buffer.sort((a, b) => a.sequence - b.sequence);

    // Trim old snapshots
    while (this.buffer.length > this.bufferSize) {
      this.buffer.shift();
    }
  }

  /** Get interpolated state at current render time */
  getInterpolatedState(renderTime: number): T | undefined {
    if (this.buffer.length < 2) {
      return this.buffer[0]?.state;
    }

    const targetTime = renderTime - this.interpolationDelay;

    // Find surrounding snapshots
    let before: StateSnapshot<T> | undefined;
    let after: StateSnapshot<T> | undefined;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].timestamp <= targetTime && this.buffer[i + 1].timestamp >= targetTime) {
        before = this.buffer[i];
        after = this.buffer[i + 1];
        break;
      }
    }

    if (!before || !after) {
      // Use latest state if can't interpolate
      return this.buffer[this.buffer.length - 1]?.state;
    }

    // Calculate interpolation factor
    const range = after.timestamp - before.timestamp;
    const t = range > 0 ? (targetTime - before.timestamp) / range : 0;

    return this.interpolate(before.state, after.state, Math.max(0, Math.min(1, t)));
  }

  /** Interpolate between two states */
  private interpolate(from: T, to: T, t: number): T {
    const result: any = {};

    for (const key of Object.keys(to)) {
      const fromVal = (from as any)[key];
      const toVal = (to as any)[key];

      if (typeof toVal === 'number' && typeof fromVal === 'number') {
        // Lerp numbers
        result[key] = fromVal + (toVal - fromVal) * t;
      } else if (typeof toVal === 'object' && toVal !== null && !Array.isArray(toVal)) {
        // Recursively interpolate objects
        result[key] = this.interpolate(fromVal || {}, toVal, t);
      } else {
        // Use target value for non-interpolatable types
        result[key] = toVal;
      }
    }

    return result as T;
  }
}
