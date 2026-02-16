/**
 * Unit tests for the Lag Compensation system
 */

import {
  LagCompensator,
  HitValidator,
  EntityPosition,
  Hitbox,
  HitValidationRequest,
  interpolatePosition,
  createEntityMapInterpolator,
} from '../../src/netcode/LagCompensation';

// ============================================================================
// Test Types
// ============================================================================

interface TestGameState {
  tick: number;
  entities: Map<string, TestEntity>;
}

interface TestEntity {
  position: EntityPosition;
  hitbox?: Hitbox;
  health: number;
}

// ============================================================================
// Tests
// ============================================================================

describe('Lag Compensation System', () => {
  // ==========================================================================
  // LagCompensator Tests
  // ==========================================================================
  describe('LagCompensator', () => {
    let compensator: LagCompensator<TestGameState>;

    beforeEach(() => {
      compensator = new LagCompensator<TestGameState>({
        maxHistoryMs: 1000,
        tickRate: 20,
        maxRewindMs: 500,
      });
    });

    describe('recordState', () => {
      it('should record state snapshots', () => {
        const state: TestGameState = {
          tick: 1,
          entities: new Map(),
        };

        compensator.recordState(1000, state);

        expect(compensator.getHistorySize()).toBe(1);
        expect(compensator.getCurrentTick()).toBe(1);
      });

      it('should increment tick on each record', () => {
        const state: TestGameState = { tick: 1, entities: new Map() };

        compensator.recordState(1000, state);
        compensator.recordState(1050, state);
        compensator.recordState(1100, state);

        expect(compensator.getCurrentTick()).toBe(3);
      });

      it('should prune old history based on maxHistoryMs', () => {
        const state: TestGameState = { tick: 1, entities: new Map() };

        // Record many states over 2 seconds
        for (let i = 0; i < 40; i++) {
          compensator.recordState(i * 50, state);
        }

        // With maxHistoryMs: 1000, old states should be pruned
        // The last record was at 1950ms, so anything before 950ms should be gone
        expect(compensator.getHistorySize()).toBeLessThan(40);
      });

      it('should clone state to avoid mutations', () => {
        const entities = new Map<string, TestEntity>();
        entities.set('player1', { position: { x: 0, y: 0 }, health: 100 });
        const state: TestGameState = { tick: 1, entities };

        compensator.recordState(1000, state);

        // Mutate original
        state.tick = 999;
        entities.get('player1')!.health = 0;

        // Stored snapshot should be unchanged
        const snapshot = compensator.getCurrentState();
        expect(snapshot?.state.tick).toBe(1);
      });
    });

    describe('getStateAtTime', () => {
      beforeEach(() => {
        // Record states at regular intervals
        for (let i = 0; i < 10; i++) {
          const state: TestGameState = {
            tick: i + 1,
            entities: new Map([
              ['player1', { position: { x: i * 10, y: 0 }, health: 100 }],
            ]),
          };
          compensator.recordState(Date.now() - (500 - i * 50), state);
        }
      });

      it('should return undefined when no history exists', () => {
        const emptyComp = new LagCompensator<TestGameState>();

        const result = emptyComp.getStateAtTime(Date.now());

        expect(result).toBeUndefined();
      });

      it('should return state at exact timestamp', () => {
        const now = Date.now();
        const state: TestGameState = { tick: 1, entities: new Map() };

        const freshComp = new LagCompensator<TestGameState>({ maxRewindMs: 1000 });
        freshComp.recordState(now - 100, state);

        const result = freshComp.getStateAtTime(now - 100);

        expect(result).toBeDefined();
        expect(result!.interpolated).toBe(false);
      });

      it('should enforce maximum rewind time', () => {
        const now = Date.now();
        const state: TestGameState = { tick: 1, entities: new Map() };

        const comp = new LagCompensator<TestGameState>({ maxRewindMs: 200 });
        comp.recordState(now - 100, state);

        // Try to rewind 300ms (more than maxRewindMs)
        const result = comp.getStateAtTime(now - 300);

        // Should be clamped to maxRewindMs (200ms)
        expect(result).toBeDefined();
        expect(result!.rewindAmount).toBeLessThanOrEqual(200);
      });
    });

    describe('interpolation', () => {
      it('should interpolate between two states', () => {
        const now = Date.now();
        const comp = new LagCompensator<{ x: number }>({
          maxRewindMs: 1000,
          interpolate: (a, b, t) => ({ x: a.x + (b.x - a.x) * t }),
        });

        comp.recordState(now - 200, { x: 0 });
        comp.recordState(now - 100, { x: 100 });

        // Request state at midpoint
        const result = comp.getStateAtTime(now - 150);

        expect(result).toBeDefined();
        expect(result!.interpolated).toBe(true);
        expect(result!.state.x).toBeCloseTo(50, 0);
      });
    });

    describe('getStateAtTick', () => {
      it('should retrieve state by tick number', () => {
        const state: TestGameState = { tick: 1, entities: new Map() };

        compensator.recordState(1000, state);
        compensator.recordState(1050, { ...state, tick: 2 });
        compensator.recordState(1100, { ...state, tick: 3 });

        const snapshot = compensator.getStateAtTick(2);

        expect(snapshot).toBeDefined();
        expect(snapshot!.tick).toBe(2);
      });

      it('should return undefined for non-existent tick', () => {
        const state: TestGameState = { tick: 1, entities: new Map() };
        compensator.recordState(1000, state);

        const snapshot = compensator.getStateAtTick(999);

        expect(snapshot).toBeUndefined();
      });
    });

    describe('getRecentHistory', () => {
      it('should return specified number of recent snapshots', () => {
        for (let i = 0; i < 10; i++) {
          compensator.recordState(i * 50, { tick: i, entities: new Map() });
        }

        const recent = compensator.getRecentHistory(3);

        expect(recent.length).toBe(3);
        expect(recent[0].tick).toBe(8);
        expect(recent[2].tick).toBe(10);
      });
    });

    describe('clear', () => {
      it('should clear all history', () => {
        compensator.recordState(1000, { tick: 1, entities: new Map() });
        compensator.recordState(1050, { tick: 2, entities: new Map() });

        expect(compensator.getHistorySize()).toBe(2);

        compensator.clear();

        expect(compensator.getHistorySize()).toBe(0);
      });
    });
  });

  // ==========================================================================
  // HitValidator Tests
  // ==========================================================================
  describe('HitValidator', () => {
    let compensator: LagCompensator<Map<string, TestEntity>>;
    let validator: HitValidator<TestEntity>;

    // Custom clone function that properly handles Map
    const cloneMapState = (state: Map<string, TestEntity>): Map<string, TestEntity> => {
      const clone = new Map<string, TestEntity>();
      for (const [key, value] of state) {
        clone.set(key, JSON.parse(JSON.stringify(value)));
      }
      return clone;
    };

    beforeEach(() => {
      compensator = new LagCompensator<Map<string, TestEntity>>({
        maxHistoryMs: 1000,
        maxRewindMs: 500,
        cloneState: cloneMapState,
      });

      validator = new HitValidator(compensator, {
        maxRewindMs: 500,
        defaultHitboxRadius: 0.5,
      });

      // Set up test data
      const now = Date.now();
      const entities = new Map<string, TestEntity>();
      entities.set('target1', {
        position: { x: 10, y: 0, z: 0 },
        health: 100,
      });
      entities.set('target2', {
        position: { x: 20, y: 0, z: 0 },
        hitbox: { offset: { x: 0, y: 0 }, size: 1.0, type: 'sphere' },
        health: 100,
      });

      compensator.recordState(now - 100, entities);
    });

    describe('validateHit', () => {
      it('should validate a valid hit within range', () => {
        const now = Date.now();
        const request: HitValidationRequest = {
          clientTimestamp: now - 100,
          clientRtt: 50,
          sourcePosition: { x: 9.5, y: 0, z: 0 },
          targetId: 'target1',
        };

        const result = validator.validateHit(request);

        expect(result.valid).toBe(true);
        expect(result.distance).toBeDefined();
        expect(result.rewindMs).toBeGreaterThan(0);
      });

      it('should reject hit when target is out of range', () => {
        const now = Date.now();
        const request: HitValidationRequest = {
          clientTimestamp: now - 100,
          clientRtt: 50,
          sourcePosition: { x: 0, y: 0, z: 0 },
          targetId: 'target1',
          maxRange: 5, // Target is at x:10, too far
        };

        const result = validator.validateHit(request);

        expect(result.valid).toBe(false);
        expect(result.reason).toContain('range');
      });

      it('should reject hit when rewind is too far', () => {
        const now = Date.now();
        const request: HitValidationRequest = {
          clientTimestamp: now - 1000, // 1 second ago, max is 500ms
          clientRtt: 50,
          sourcePosition: { x: 9.5, y: 0, z: 0 },
          targetId: 'target1',
        };

        const result = validator.validateHit(request);

        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Rewind too far');
      });

      it('should reject hit when target not found', () => {
        const now = Date.now();
        const request: HitValidationRequest = {
          clientTimestamp: now - 100,
          clientRtt: 50,
          sourcePosition: { x: 0, y: 0, z: 0 },
          targetId: 'nonexistent',
        };

        const result = validator.validateHit(request);

        expect(result.valid).toBe(false);
        expect(result.reason).toContain('not found');
      });

      it('should use entity hitbox radius when available', () => {
        const now = Date.now();
        // target2 has hitbox radius of 1.0
        const request: HitValidationRequest = {
          clientTimestamp: now - 100,
          clientRtt: 50,
          sourcePosition: { x: 19.5, y: 0, z: 0 }, // Just within 1.0 radius
          targetId: 'target2',
        };

        const result = validator.validateHit(request);

        expect(result.valid).toBe(true);
      });
    });

    describe('raycast hit validation', () => {
      it('should validate raycast hit', () => {
        const now = Date.now();
        const request: HitValidationRequest = {
          clientTimestamp: now - 100,
          clientRtt: 50,
          sourcePosition: { x: 0, y: 0, z: 0 },
          targetId: 'target1',
          direction: { x: 1, y: 0, z: 0 }, // Shooting towards +X
          maxRange: 100,
        };

        const result = validator.validateHit(request);

        expect(result.valid).toBe(true);
      });

      it('should reject raycast that misses', () => {
        const now = Date.now();
        const request: HitValidationRequest = {
          clientTimestamp: now - 100,
          clientRtt: 50,
          sourcePosition: { x: 0, y: 0, z: 0 },
          targetId: 'target1',
          direction: { x: 0, y: 1, z: 0 }, // Shooting towards +Y (target is on X axis)
          maxRange: 100,
        };

        const result = validator.validateHit(request);

        expect(result.valid).toBe(false);
        expect(result.reason).toContain('Raycast');
      });

      it('should reject raycast when target is beyond max range', () => {
        const now = Date.now();
        const request: HitValidationRequest = {
          clientTimestamp: now - 100,
          clientRtt: 50,
          sourcePosition: { x: 0, y: 0, z: 0 },
          targetId: 'target1', // At x: 10
          direction: { x: 1, y: 0, z: 0 },
          maxRange: 5, // Only 5 units range
        };

        const result = validator.validateHit(request);

        expect(result.valid).toBe(false);
      });

      it('should reject raycast when target is behind shooter', () => {
        const now = Date.now();
        const request: HitValidationRequest = {
          clientTimestamp: now - 100,
          clientRtt: 50,
          sourcePosition: { x: 15, y: 0, z: 0 }, // In front of target
          targetId: 'target1', // At x: 10
          direction: { x: 1, y: 0, z: 0 }, // Shooting away from target
          maxRange: 100,
        };

        const result = validator.validateHit(request);

        expect(result.valid).toBe(false);
      });
    });
  });

  // ==========================================================================
  // Utility Function Tests
  // ==========================================================================
  describe('Utility Functions', () => {
    describe('interpolatePosition', () => {
      it('should interpolate 2D positions', () => {
        const a: EntityPosition = { x: 0, y: 0 };
        const b: EntityPosition = { x: 10, y: 20 };

        const result = interpolatePosition(a, b, 0.5);

        expect(result.x).toBe(5);
        expect(result.y).toBe(10);
        expect(result.z).toBeUndefined();
      });

      it('should interpolate 3D positions', () => {
        const a: EntityPosition = { x: 0, y: 0, z: 0 };
        const b: EntityPosition = { x: 10, y: 20, z: 30 };

        const result = interpolatePosition(a, b, 0.5);

        expect(result.x).toBe(5);
        expect(result.y).toBe(10);
        expect(result.z).toBe(15);
      });

      it('should handle t=0 (return first position)', () => {
        const a: EntityPosition = { x: 0, y: 0 };
        const b: EntityPosition = { x: 10, y: 20 };

        const result = interpolatePosition(a, b, 0);

        expect(result.x).toBe(0);
        expect(result.y).toBe(0);
      });

      it('should handle t=1 (return second position)', () => {
        const a: EntityPosition = { x: 0, y: 0 };
        const b: EntityPosition = { x: 10, y: 20 };

        const result = interpolatePosition(a, b, 1);

        expect(result.x).toBe(10);
        expect(result.y).toBe(20);
      });

      it('should handle mixed 2D/3D positions', () => {
        const a: EntityPosition = { x: 0, y: 0 }; // No z
        const b: EntityPosition = { x: 10, y: 20, z: 30 }; // Has z

        const result = interpolatePosition(a, b, 0.5);

        expect(result.z).toBe(15); // Treats undefined as 0
      });
    });

    describe('createEntityMapInterpolator', () => {
      interface SimpleEntity {
        position: EntityPosition;
        name: string;
      }

      it('should create an interpolator for entity maps', () => {
        const interpolator = createEntityMapInterpolator<SimpleEntity>();

        const mapA = new Map<string, SimpleEntity>();
        mapA.set('e1', { position: { x: 0, y: 0 }, name: 'entity1' });

        const mapB = new Map<string, SimpleEntity>();
        mapB.set('e1', { position: { x: 10, y: 20 }, name: 'entity1' });

        const result = interpolator(mapA, mapB, 0.5);

        expect(result.get('e1')!.position.x).toBe(5);
        expect(result.get('e1')!.position.y).toBe(10);
      });

      it('should handle entities only in first map (t < 0.5)', () => {
        const interpolator = createEntityMapInterpolator<SimpleEntity>();

        const mapA = new Map<string, SimpleEntity>();
        mapA.set('e1', { position: { x: 0, y: 0 }, name: 'entity1' });
        mapA.set('e2', { position: { x: 5, y: 5 }, name: 'leaving' });

        const mapB = new Map<string, SimpleEntity>();
        mapB.set('e1', { position: { x: 10, y: 20 }, name: 'entity1' });
        // e2 doesn't exist in mapB

        const result = interpolator(mapA, mapB, 0.3);

        expect(result.has('e1')).toBe(true);
        expect(result.has('e2')).toBe(true); // Still present when t < 0.5
      });

      it('should handle entities only in second map (t >= 0.5)', () => {
        const interpolator = createEntityMapInterpolator<SimpleEntity>();

        const mapA = new Map<string, SimpleEntity>();
        mapA.set('e1', { position: { x: 0, y: 0 }, name: 'entity1' });

        const mapB = new Map<string, SimpleEntity>();
        mapB.set('e1', { position: { x: 10, y: 20 }, name: 'entity1' });
        mapB.set('e2', { position: { x: 5, y: 5 }, name: 'new-entity' });

        const result = interpolator(mapA, mapB, 0.7);

        expect(result.has('e1')).toBe(true);
        expect(result.has('e2')).toBe(true); // Added when t >= 0.5
      });

      it('should use custom entity interpolator when provided', () => {
        const customInterpolator = createEntityMapInterpolator<SimpleEntity>(
          (a, b, t) => ({
            position: interpolatePosition(a.position, b.position, t),
            name: t < 0.5 ? a.name : b.name, // Custom name interpolation
          })
        );

        const mapA = new Map<string, SimpleEntity>();
        mapA.set('e1', { position: { x: 0, y: 0 }, name: 'old' });

        const mapB = new Map<string, SimpleEntity>();
        mapB.set('e1', { position: { x: 10, y: 0 }, name: 'new' });

        const result1 = customInterpolator(mapA, mapB, 0.3);
        const result2 = customInterpolator(mapA, mapB, 0.7);

        expect(result1.get('e1')!.name).toBe('old');
        expect(result2.get('e1')!.name).toBe('new');
      });
    });
  });
});
