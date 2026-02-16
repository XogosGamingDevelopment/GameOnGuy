/**
 * Unit tests for the StateTracker system
 */

import 'reflect-metadata';
import { Schema, type, MapSchema } from '../../src/schema/Schema';
import {
  StateTracker,
  SyncMode,
  StateInterpolator,
} from '../../src/schema/StateTracker';

// ============================================================================
// Test Schemas
// ============================================================================

class TestState extends Schema {
  @type('string') phase: string = 'waiting';
  @type('number') score: number = 0;
  @type('number') time: number = 0;
}

// ============================================================================
// Tests
// ============================================================================

describe('StateTracker', () => {
  describe('Basic Tracking', () => {
    it('should track initial state', () => {
      const state = new TestState();
      const tracker = new StateTracker(state);

      const fullState = tracker.getFullState();

      expect(fullState.state).toEqual({
        phase: 'waiting',
        score: 0,
        time: 0,
      });
      expect(fullState.sequence).toBe(0);
    });

    it('should detect changes', () => {
      const state = new TestState();
      const tracker = new StateTracker(state);
      tracker.commit(); // Commit initial state

      // Use assign to properly track changes in Schema
      state.assign({ score: 100 });

      expect(tracker.hasChanges()).toBe(true);
    });

    it('should clear changes after commit', () => {
      const state = new TestState();
      const tracker = new StateTracker(state);

      state.assign({ score: 100 });
      tracker.commit();

      expect(state.hasChanges()).toBe(false);
    });

    it('should increment sequence on commit', () => {
      const state = new TestState();
      const tracker = new StateTracker(state);

      expect(tracker.getSequence()).toBe(0);

      tracker.commit();
      expect(tracker.getSequence()).toBe(1);

      tracker.commit();
      expect(tracker.getSequence()).toBe(2);
    });
  });

  describe('Delta Mode', () => {
    it('should return delta with only changed properties', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { syncMode: SyncMode.DELTA });
      tracker.commit();

      // Use assign to properly track changes
      state.assign({ score: 50, phase: 'playing' });

      const delta = tracker.getDelta();

      expect(delta).toBeDefined();
      expect(delta!.changes).toHaveProperty('score', 50);
      expect(delta!.changes).toHaveProperty('phase', 'playing');
      expect(delta!.isFullSync).toBe(false);
    });

    it('should return full state for new schemas', () => {
      const state = new TestState();
      state.assign({ score: 100 });

      const tracker = new StateTracker(state, { syncMode: SyncMode.DELTA });
      const delta = tracker.getDelta();

      expect(delta).toBeDefined();
      expect(delta!.isFullSync).toBe(true);
    });

    it('should return undefined when no changes', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { syncMode: SyncMode.DELTA });
      tracker.commit();

      const delta = tracker.getDelta();

      expect(delta).toBeUndefined();
    });
  });

  describe('Patch Mode', () => {
    it('should generate JSON Patch operations', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { syncMode: SyncMode.PATCH });
      tracker.commit();

      state.score = 75;

      const patches = tracker.getPatches();

      expect(patches).toBeDefined();
      expect(patches!.length).toBeGreaterThan(0);
      expect(patches![0]).toMatchObject({
        op: 'replace',
        path: '/score',
        value: 75,
      });
    });

    it('should handle multiple changes', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { syncMode: SyncMode.PATCH });
      tracker.commit();

      state.score = 100;
      state.phase = 'ended';
      state.time = 60;

      const patches = tracker.getPatches();

      expect(patches!.length).toBe(3);
    });
  });

  describe('Full Sync Interval', () => {
    it('should force full sync after interval', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, {
        syncMode: SyncMode.DELTA,
        fullSyncInterval: 2,
      });

      // Initial commit
      tracker.commit();

      // First change
      state.score = 10;
      tracker.commit();

      // Second change - should trigger full sync
      state.score = 20;
      const delta = tracker.getDelta();

      expect(delta!.isFullSync).toBe(true);
    });
  });

  describe('State History', () => {
    it('should keep history of snapshots', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { maxHistory: 5 });

      for (let i = 0; i < 3; i++) {
        state.score = i * 10;
        tracker.commit();
      }

      const history = tracker.getRecentHistory(3);

      expect(history.length).toBe(3);
    });

    it('should retrieve state at specific sequence', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { maxHistory: 10 });

      state.score = 10;
      tracker.commit(); // seq 1

      state.score = 20;
      tracker.commit(); // seq 2

      state.score = 30;
      tracker.commit(); // seq 3

      const historyState = tracker.getStateAtSequence(2);

      expect(historyState).toBeDefined();
      expect(historyState!.score).toBe(20);
    });

    it('should limit history size', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { maxHistory: 3 });

      for (let i = 0; i < 10; i++) {
        state.score = i;
        tracker.commit();
      }

      const history = tracker.getRecentHistory(10);

      expect(history.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getSyncData', () => {
    it('should return correct data for FULL mode', () => {
      const state = new TestState();
      state.score = 50;
      const tracker = new StateTracker(state, { syncMode: SyncMode.FULL });

      const syncData = tracker.getSyncData();

      expect(syncData!.type).toBe(SyncMode.FULL);
      expect(syncData!.data.state.score).toBe(50);
    });

    it('should return correct data for DELTA mode', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { syncMode: SyncMode.DELTA });
      tracker.commit();

      state.assign({ score: 100 });

      const syncData = tracker.getSyncData();

      expect(syncData!.type).toBe(SyncMode.DELTA);
      expect(syncData!.data.changes).toHaveProperty('score', 100);
    });

    it('should return correct data for PATCH mode', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { syncMode: SyncMode.PATCH });
      tracker.commit();

      state.assign({ score: 100 });

      const syncData = tracker.getSyncData();

      expect(syncData!.type).toBe(SyncMode.PATCH);
      expect(Array.isArray(syncData!.data)).toBe(true);
    });
  });

  describe('Checksum Validation', () => {
    it('should compute checksums when enabled', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { useChecksums: true });

      const fullState = tracker.getFullState();

      expect(fullState.checksum).toBeDefined();
      expect(typeof fullState.checksum).toBe('string');
    });

    it('should validate correct checksum', () => {
      const state = new TestState();
      state.score = 100;
      const tracker = new StateTracker(state, { useChecksums: true });

      const fullState = tracker.getFullState();
      const isValid = tracker.validateChecksum(fullState.state, fullState.checksum!);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect checksum', () => {
      const state = new TestState();
      const tracker = new StateTracker(state, { useChecksums: true });

      const isValid = tracker.validateChecksum({ score: 999 }, 'invalid-checksum');

      expect(isValid).toBe(false);
    });
  });

  describe('Static Methods', () => {
    describe('applyPatches', () => {
      it('should apply add patches', () => {
        const state: Record<string, any> = { a: 1 };
        const patches = [{ op: 'add' as const, path: '/b', value: 2 }];

        const result = StateTracker.applyPatches(state, patches);

        expect(result.b).toBe(2);
      });

      it('should apply replace patches', () => {
        const state = { a: 1 };
        const patches = [{ op: 'replace' as const, path: '/a', value: 10 }];

        const result = StateTracker.applyPatches(state, patches);

        expect(result.a).toBe(10);
      });

      it('should apply remove patches', () => {
        const state = { a: 1, b: 2 };
        const patches = [{ op: 'remove' as const, path: '/b' }];

        const result = StateTracker.applyPatches(state, patches);

        expect(result.b).toBeUndefined();
      });

      it('should apply nested patches', () => {
        const state = { nested: { value: 1 } };
        const patches = [{ op: 'replace' as const, path: '/nested/value', value: 10 }];

        const result = StateTracker.applyPatches(state, patches);

        expect(result.nested.value).toBe(10);
      });
    });

    describe('applyDelta', () => {
      it('should apply delta changes', () => {
        const state = { score: 0, name: 'test' };
        const delta = {
          sequence: 1,
          timestamp: Date.now(),
          changes: { score: 100 },
          isFullSync: false,
        };

        const result = StateTracker.applyDelta(state, delta);

        expect(result.score).toBe(100);
        expect(result.name).toBe('test');
      });

      it('should replace entire state for full sync', () => {
        const state = { score: 0, name: 'old' };
        const delta = {
          sequence: 1,
          timestamp: Date.now(),
          changes: { score: 100, name: 'new' },
          isFullSync: true,
        };

        const result = StateTracker.applyDelta(state, delta);

        expect(result).toEqual({ score: 100, name: 'new' });
      });
    });
  });
});

describe('StateInterpolator', () => {
  it('should store snapshots', () => {
    const interpolator = new StateInterpolator<{ x: number }>();

    interpolator.addSnapshot({
      state: { x: 0 },
      sequence: 0,
      timestamp: 1000,
    });

    interpolator.addSnapshot({
      state: { x: 100 },
      sequence: 1,
      timestamp: 1100,
    });

    // Should return latest if render time is in the future
    const state = interpolator.getInterpolatedState(2000);
    expect(state!.x).toBe(100);
  });

  it('should interpolate between snapshots', () => {
    const interpolator = new StateInterpolator<{ x: number }>({
      interpolationDelay: 50,
    });

    interpolator.addSnapshot({
      state: { x: 0 },
      sequence: 0,
      timestamp: 1000,
    });

    interpolator.addSnapshot({
      state: { x: 100 },
      sequence: 1,
      timestamp: 1100,
    });

    // Render time 1100 - 50 delay = 1050 target time
    // That's halfway between 1000 and 1100
    const state = interpolator.getInterpolatedState(1100);

    expect(state!.x).toBe(50); // Interpolated value
  });

  it('should limit buffer size', () => {
    const interpolator = new StateInterpolator<{ x: number }>({
      bufferSize: 2,
    });

    for (let i = 0; i < 5; i++) {
      interpolator.addSnapshot({
        state: { x: i * 10 },
        sequence: i,
        timestamp: 1000 + i * 100,
      });
    }

    // Buffer should only have 2 most recent
    const state = interpolator.getInterpolatedState(10000);
    expect(state!.x).toBe(40); // Latest value
  });
});

describe('Plain Object Tracking', () => {
  it('should track plain objects', () => {
    const state = { score: 0, name: 'test' };
    const tracker = new StateTracker(state);

    tracker.commit();

    (state as any).score = 100;

    expect(tracker.hasChanges()).toBe(true);
  });

  it('should generate delta for plain objects', () => {
    const state = { score: 0, name: 'test' };
    const tracker = new StateTracker(state, { syncMode: SyncMode.DELTA });

    tracker.commit();

    (state as any).score = 100;

    const delta = tracker.getDelta();

    expect(delta!.changes).toHaveProperty('score', 100);
  });

  it('should generate patches for plain objects', () => {
    const state = { score: 0, name: 'test' };
    const tracker = new StateTracker(state, { syncMode: SyncMode.PATCH });

    tracker.commit();

    (state as any).score = 100;

    const patches = tracker.getPatches();

    expect(patches!.some(p => p.path === '/score' && p.value === 100)).toBe(true);
  });
});
