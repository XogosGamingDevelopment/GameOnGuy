/**
 * Unit tests for the Interpolation system
 */

import {
  InterpolationBuffer,
  EntityInterpolator,
  DeadReckoningPredictor,
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
  PositionalState,
  VelocityState,
} from '../../src/netcode/Interpolation';

// ============================================================================
// Tests
// ============================================================================

describe('Interpolation System', () => {
  // ==========================================================================
  // Basic Math Function Tests
  // ==========================================================================
  describe('lerp', () => {
    it('should linearly interpolate between two values', () => {
      expect(lerp(0, 10, 0)).toBe(0);
      expect(lerp(0, 10, 0.5)).toBe(5);
      expect(lerp(0, 10, 1)).toBe(10);
    });

    it('should handle negative values', () => {
      expect(lerp(-10, 10, 0.5)).toBe(0);
    });

    it('should extrapolate beyond 0-1', () => {
      expect(lerp(0, 10, 2)).toBe(20);
      expect(lerp(0, 10, -0.5)).toBe(-5);
    });
  });

  describe('clamp', () => {
    it('should clamp values within range', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
    });

    it('should handle edge cases', () => {
      expect(clamp(0, 0, 10)).toBe(0);
      expect(clamp(10, 0, 10)).toBe(10);
    });
  });

  describe('smoothStep', () => {
    it('should return smooth interpolation', () => {
      expect(smoothStep(0)).toBe(0);
      expect(smoothStep(1)).toBe(1);
      expect(smoothStep(0.5)).toBe(0.5);
    });

    it('should have zero derivative at endpoints', () => {
      // Smoothstep has 0 derivative at t=0 and t=1
      const epsilon = 0.001;
      const derivativeAt0 = (smoothStep(epsilon) - smoothStep(0)) / epsilon;
      const derivativeAt1 = (smoothStep(1) - smoothStep(1 - epsilon)) / epsilon;

      expect(Math.abs(derivativeAt0)).toBeLessThan(0.01);
      expect(Math.abs(derivativeAt1)).toBeLessThan(0.01);
    });
  });

  describe('smootherStep', () => {
    it('should return smoother interpolation', () => {
      expect(smootherStep(0)).toBe(0);
      expect(smootherStep(1)).toBe(1);
      expect(smootherStep(0.5)).toBe(0.5);
    });
  });

  describe('slerp', () => {
    it('should spherically interpolate quaternions', () => {
      const identity = { x: 0, y: 0, z: 0, w: 1 };
      const rotated = { x: 0, y: 0.7071, z: 0, w: 0.7071 }; // 90deg around Y

      const result = slerp(identity, rotated, 0.5);

      // Should be roughly 45 degrees around Y
      expect(result.y).toBeGreaterThan(0);
      expect(result.y).toBeLessThan(0.7071);
    });

    it('should return first quaternion at t=0', () => {
      const a = { x: 0, y: 0, z: 0, w: 1 };
      const b = { x: 0, y: 1, z: 0, w: 0 };

      const result = slerp(a, b, 0);

      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(0, 5);
      expect(result.z).toBeCloseTo(0, 5);
      expect(result.w).toBeCloseTo(1, 5);
    });

    it('should return second quaternion at t=1', () => {
      const a = { x: 0, y: 0, z: 0, w: 1 };
      const b = { x: 0, y: 0.7071, z: 0, w: 0.7071 };

      const result = slerp(a, b, 1);

      expect(result.x).toBeCloseTo(0, 3);
      expect(result.y).toBeCloseTo(0.7071, 3);
      expect(result.z).toBeCloseTo(0, 3);
      expect(result.w).toBeCloseTo(0.7071, 3);
    });

    it('should handle nearly identical quaternions', () => {
      const a = { x: 0, y: 0, z: 0, w: 1 };
      const b = { x: 0.0001, y: 0, z: 0, w: 0.9999999 };

      const result = slerp(a, b, 0.5);

      // Should not throw or return NaN
      expect(Number.isNaN(result.x)).toBe(false);
      expect(Number.isNaN(result.w)).toBe(false);
    });
  });

  // ==========================================================================
  // Position Interpolation Tests
  // ==========================================================================
  describe('lerpPosition', () => {
    it('should interpolate 2D positions', () => {
      const a: PositionalState = { x: 0, y: 0 };
      const b: PositionalState = { x: 10, y: 20 };

      const result = lerpPosition(a, b, 0.5);

      expect(result.x).toBe(5);
      expect(result.y).toBe(10);
      expect(result.z).toBeUndefined();
    });

    it('should interpolate 3D positions', () => {
      const a: PositionalState = { x: 0, y: 0, z: 0 };
      const b: PositionalState = { x: 10, y: 20, z: 30 };

      const result = lerpPosition(a, b, 0.5);

      expect(result.x).toBe(5);
      expect(result.y).toBe(10);
      expect(result.z).toBe(15);
    });

    it('should interpolate velocities when present', () => {
      const a: PositionalState = {
        x: 0,
        y: 0,
        velocity: { vx: 10, vy: 0 },
      };
      const b: PositionalState = {
        x: 10,
        y: 0,
        velocity: { vx: 20, vy: 10 },
      };

      const result = lerpPosition(a, b, 0.5);

      expect(result.velocity!.vx).toBe(15);
      expect(result.velocity!.vy).toBe(5);
    });
  });

  describe('extrapolatePosition', () => {
    it('should extrapolate position using velocity', () => {
      const state: PositionalState = {
        x: 0,
        y: 0,
        velocity: { vx: 10, vy: 5 },
      };

      const result = extrapolatePosition(state, 1.0); // 1 second

      expect(result.x).toBe(10);
      expect(result.y).toBe(5);
    });

    it('should apply decay factor', () => {
      const state: PositionalState = {
        x: 0,
        y: 0,
        velocity: { vx: 10, vy: 0 },
      };

      const result = extrapolatePosition(state, 1.0, 0.5); // 50% decay per second

      expect(result.x).toBe(5); // 10 * 1.0 * 0.5
    });

    it('should return same state if no velocity', () => {
      const state: PositionalState = { x: 5, y: 10 };

      const result = extrapolatePosition(state, 1.0);

      expect(result.x).toBe(5);
      expect(result.y).toBe(10);
    });

    it('should handle 3D extrapolation', () => {
      const state: PositionalState = {
        x: 0,
        y: 0,
        z: 0,
        velocity: { vx: 10, vy: 20, vz: 30 },
      };

      const result = extrapolatePosition(state, 0.5);

      expect(result.x).toBe(5);
      expect(result.y).toBe(10);
      expect(result.z).toBe(15);
    });
  });

  describe('calculateVelocity', () => {
    it('should calculate velocity from two positions', () => {
      const from: PositionalState = { x: 0, y: 0 };
      const to: PositionalState = { x: 10, y: 5 };

      const velocity = calculateVelocity(from, to, 1.0);

      expect(velocity.vx).toBe(10);
      expect(velocity.vy).toBe(5);
    });

    it('should handle small delta time', () => {
      const from: PositionalState = { x: 0, y: 0 };
      const to: PositionalState = { x: 1, y: 0 };

      const velocity = calculateVelocity(from, to, 0.016);

      expect(velocity.vx).toBeCloseTo(62.5, 1);
    });

    it('should return zero velocity for zero delta time', () => {
      const from: PositionalState = { x: 0, y: 0 };
      const to: PositionalState = { x: 10, y: 5 };

      const velocity = calculateVelocity(from, to, 0);

      expect(velocity.vx).toBe(0);
      expect(velocity.vy).toBe(0);
    });

    it('should calculate 3D velocity', () => {
      const from: PositionalState = { x: 0, y: 0, z: 0 };
      const to: PositionalState = { x: 10, y: 20, z: 30 };

      const velocity = calculateVelocity(from, to, 2.0);

      expect(velocity.vx).toBe(5);
      expect(velocity.vy).toBe(10);
      expect(velocity.vz).toBe(15);
    });
  });

  // ==========================================================================
  // Hermite Interpolation Tests
  // ==========================================================================
  describe('hermiteInterpolate', () => {
    it('should return endpoint values at t=0 and t=1', () => {
      expect(hermiteInterpolate(0, 10, 100, 10, 0)).toBe(0);
      expect(hermiteInterpolate(0, 10, 100, 10, 1)).toBe(100);
    });

    it('should create smooth curve through points', () => {
      const mid = hermiteInterpolate(0, 0, 100, 0, 0.5);

      // Should be roughly halfway
      expect(mid).toBeCloseTo(50, 0);
    });

    it('should respect tangent velocities', () => {
      // High exit velocity should overshoot
      const result = hermiteInterpolate(0, 100, 10, 0, 0.25);

      // With high velocity at start, should be higher than linear
      expect(result).toBeGreaterThan(2.5);
    });

    it('should handle tension parameter', () => {
      const noTension = hermiteInterpolate(0, 50, 100, 50, 0.5, 0);
      const fullTension = hermiteInterpolate(0, 50, 100, 50, 0.5, 1);

      // Full tension should reduce velocity contribution
      expect(Math.abs(fullTension - 50)).toBeLessThan(Math.abs(noTension - 50) + 1);
    });
  });

  describe('hermiteInterpolatePosition', () => {
    it('should interpolate position with velocities', () => {
      const from: PositionalState & { velocity: VelocityState } = {
        x: 0,
        y: 0,
        velocity: { vx: 10, vy: 0 },
      };
      const to: PositionalState & { velocity: VelocityState } = {
        x: 100,
        y: 0,
        velocity: { vx: 10, vy: 0 },
      };

      const result = hermiteInterpolatePosition(from, to, 0.5, 1.0);

      expect(result.x).toBeCloseTo(50, 0);
    });
  });

  // ==========================================================================
  // InterpolationBuffer Tests
  // ==========================================================================
  describe('InterpolationBuffer', () => {
    let buffer: InterpolationBuffer<PositionalState>;

    beforeEach(() => {
      buffer = new InterpolationBuffer<PositionalState>({
        interpolationDelay: 100,
        bufferSize: 20,
        maxExtrapolationMs: 250,
      });
    });

    describe('addSnapshot', () => {
      it('should add snapshots to buffer', () => {
        buffer.addSnapshot({ state: { x: 0, y: 0 }, timestamp: 1000 });

        expect(buffer.getBufferSize()).toBe(1);
      });

      it('should maintain chronological order', () => {
        buffer.addSnapshot({ state: { x: 2, y: 0 }, timestamp: 1100 });
        buffer.addSnapshot({ state: { x: 1, y: 0 }, timestamp: 1000 }); // Out of order
        buffer.addSnapshot({ state: { x: 3, y: 0 }, timestamp: 1200 });

        const snapshots = buffer.getSnapshots();

        expect(snapshots[0].timestamp).toBe(1000);
        expect(snapshots[1].timestamp).toBe(1100);
        expect(snapshots[2].timestamp).toBe(1200);
      });

      it('should trim buffer when exceeding max size', () => {
        for (let i = 0; i < 25; i++) {
          buffer.addSnapshot({ state: { x: i, y: 0 }, timestamp: i * 50 });
        }

        expect(buffer.getBufferSize()).toBe(20);
      });
    });

    describe('getInterpolatedState', () => {
      beforeEach(() => {
        buffer.addSnapshot({ state: { x: 0, y: 0 }, timestamp: 1000 });
        buffer.addSnapshot({ state: { x: 100, y: 0 }, timestamp: 1100 });
        buffer.addSnapshot({ state: { x: 200, y: 0 }, timestamp: 1200 });
      });

      const simpleInterpolate = (a: PositionalState, b: PositionalState, t: number) =>
        lerpPosition(a, b, t);

      it('should return undefined for empty buffer', () => {
        const emptyBuffer = new InterpolationBuffer<PositionalState>();

        const result = emptyBuffer.getInterpolatedState(1150, simpleInterpolate);

        expect(result).toBeUndefined();
      });

      it('should interpolate between snapshots', () => {
        // renderTime 1250 with 100ms delay = target 1150 (between 1100 and 1200)
        const result = buffer.getInterpolatedState(1250, simpleInterpolate);

        expect(result).toBeDefined();
        expect(result!.mode).toBe('interpolation');
        expect(result!.state.x).toBe(150);
        expect(result!.blendFactor).toBe(0.5);
        expect(result!.isStale).toBe(false);
      });

      it('should return oldest snapshot when target is before buffer', () => {
        // renderTime 900 with 100ms delay = target 800 (before buffer starts)
        const result = buffer.getInterpolatedState(900, simpleInterpolate);

        expect(result).toBeDefined();
        expect(result!.mode).toBe('snapshot');
        expect(result!.state.x).toBe(0);
        expect(result!.isStale).toBe(true);
      });

      it('should extrapolate when target is after buffer', () => {
        const simpleExtrapolate = (state: PositionalState, deltaMs: number) => ({
          x: state.x + (100 * deltaMs) / 100, // 100 units per 100ms
          y: state.y,
        });

        // renderTime 1400 with 100ms delay = target 1300 (100ms after last snapshot)
        const result = buffer.getInterpolatedState(1400, simpleInterpolate, simpleExtrapolate);

        expect(result).toBeDefined();
        expect(result!.mode).toBe('extrapolation');
        expect(result!.state.x).toBe(300);
        expect(result!.blendFactor).toBeGreaterThan(1);
      });

      it('should mark state as stale when extrapolating beyond limit', () => {
        // renderTime 1600 with 100ms delay = target 1500 (300ms after last, max is 250)
        const result = buffer.getInterpolatedState(1600, simpleInterpolate);

        expect(result).toBeDefined();
        expect(result!.mode).toBe('snapshot');
        expect(result!.isStale).toBe(true);
      });
    });

    describe('buffer management', () => {
      it('should get latest snapshot', () => {
        buffer.addSnapshot({ state: { x: 1, y: 0 }, timestamp: 1000 });
        buffer.addSnapshot({ state: { x: 2, y: 0 }, timestamp: 2000 });

        const latest = buffer.getLatestSnapshot();

        expect(latest!.state.x).toBe(2);
      });

      it('should clear buffer', () => {
        buffer.addSnapshot({ state: { x: 1, y: 0 }, timestamp: 1000 });

        buffer.clear();

        expect(buffer.getBufferSize()).toBe(0);
      });

      it('should update interpolation delay', () => {
        buffer.addSnapshot({ state: { x: 0, y: 0 }, timestamp: 1000 });
        buffer.addSnapshot({ state: { x: 100, y: 0 }, timestamp: 1100 });

        buffer.setInterpolationDelay(50); // Reduce delay

        // renderTime 1150 with 50ms delay = target 1100 (at second snapshot)
        const result = buffer.getInterpolatedState(1150, lerpPosition);

        expect(result!.state.x).toBe(100);
      });
    });
  });

  // ==========================================================================
  // EntityInterpolator Tests
  // ==========================================================================
  describe('EntityInterpolator', () => {
    let interpolator: EntityInterpolator<PositionalState>;

    beforeEach(() => {
      interpolator = new EntityInterpolator<PositionalState>({
        interpolationDelay: 100,
      });
    });

    describe('entity management', () => {
      it('should add snapshots for entities', () => {
        interpolator.addEntitySnapshot('entity1', { x: 0, y: 0 }, 1000);
        interpolator.addEntitySnapshot('entity1', { x: 10, y: 0 }, 1100);

        const ids = interpolator.getEntityIds();

        expect(ids).toContain('entity1');
      });

      it('should track multiple entities', () => {
        interpolator.addEntitySnapshot('entity1', { x: 0, y: 0 }, 1000);
        interpolator.addEntitySnapshot('entity2', { x: 5, y: 5 }, 1000);

        const ids = interpolator.getEntityIds();

        expect(ids.length).toBe(2);
        expect(ids).toContain('entity1');
        expect(ids).toContain('entity2');
      });

      it('should remove entity', () => {
        interpolator.addEntitySnapshot('entity1', { x: 0, y: 0 }, 1000);

        const removed = interpolator.removeEntity('entity1');

        expect(removed).toBe(true);
        expect(interpolator.getEntityIds()).not.toContain('entity1');
      });

      it('should clear all entities', () => {
        interpolator.addEntitySnapshot('entity1', { x: 0, y: 0 }, 1000);
        interpolator.addEntitySnapshot('entity2', { x: 5, y: 5 }, 1000);

        interpolator.clear();

        expect(interpolator.getEntityIds().length).toBe(0);
      });
    });

    describe('getEntityState', () => {
      it('should return interpolated entity state', () => {
        interpolator.addEntitySnapshot('entity1', { x: 0, y: 0 }, 1000);
        interpolator.addEntitySnapshot('entity1', { x: 100, y: 0 }, 1100);

        // renderTime 1150 with 100ms delay = target 1050
        const result = interpolator.getEntityState('entity1', 1150);

        expect(result).toBeDefined();
        expect(result!.state.x).toBe(50);
      });

      it('should return undefined for unknown entity', () => {
        const result = interpolator.getEntityState('unknown', 1000);

        expect(result).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // DeadReckoningPredictor Tests
  // ==========================================================================
  describe('DeadReckoningPredictor', () => {
    let predictor: DeadReckoningPredictor<PositionalState>;

    beforeEach(() => {
      predictor = new DeadReckoningPredictor<PositionalState>({
        maxPredictionMs: 500,
        positionThreshold: 0.1,
        blendSpeed: 10,
      });
    });

    describe('updateServerState', () => {
      it('should initialize on first update', () => {
        const state: PositionalState = { x: 10, y: 20 };

        predictor.updateServerState(state, 1000);

        const display = predictor.getDisplayPosition(1000, 0);

        expect(display).toBeDefined();
        expect(display!.x).toBe(10);
        expect(display!.y).toBe(20);
      });

      it('should flag correction when error exceeds threshold', () => {
        predictor.updateServerState({ x: 0, y: 0 }, 1000);

        // Small movement, get display position
        predictor.getDisplayPosition(1050, 0.016);

        // Large correction needed
        predictor.updateServerState({ x: 10, y: 10 }, 1050);

        expect(predictor.isCorrecting()).toBe(true);
      });

      it('should not flag correction for small errors', () => {
        predictor.updateServerState({ x: 0, y: 0 }, 1000);
        predictor.getDisplayPosition(1000, 0);

        // Very small movement
        predictor.updateServerState({ x: 0.05, y: 0 }, 1050);

        expect(predictor.isCorrecting()).toBe(false);
      });
    });

    describe('getDisplayPosition', () => {
      it('should return null when not initialized', () => {
        const display = predictor.getDisplayPosition(1000, 0.016);

        expect(display).toBeNull();
      });

      it('should extrapolate using velocity', () => {
        const state: PositionalState = {
          x: 0,
          y: 0,
          velocity: { vx: 100, vy: 0 },
        };

        predictor.updateServerState(state, 1000);
        const display = predictor.getDisplayPosition(1100, 0.016); // 100ms later

        expect(display).toBeDefined();
        expect(display!.x).toBeCloseTo(10, 0); // 100 * 0.1s
      });

      it('should blend towards target when correcting', () => {
        // Initialize at origin with no velocity
        predictor.updateServerState({ x: 0, y: 0 }, 1000);

        // Get display position and let it stabilize
        predictor.getDisplayPosition(1000, 0.016);

        // Jump to new position (triggers correction)
        predictor.updateServerState({ x: 100, y: 0 }, 1050);

        // Verify correction is flagged
        expect(predictor.isCorrecting()).toBe(true);

        // Get display position - should be blending towards target
        // With blendSpeed of 10 and dt of 0.1, blendFactor = min(1, 10 * 0.1) = 1
        // So we use a smaller dt to see partial blending
        const display = predictor.getDisplayPosition(1050, 0.05);

        // After one small update, should be partially blended
        // blendFactor = min(1, 10 * 0.05) = 0.5, so x = 0 + (100 - 0) * 0.5 = 50
        expect(display!.x).toBeGreaterThan(0);
        expect(display!.x).toBeLessThanOrEqual(100);
      });

      it('should complete correction when close enough', () => {
        predictor.updateServerState({ x: 0, y: 0 }, 1000);
        predictor.getDisplayPosition(1000, 0);

        predictor.updateServerState({ x: 1, y: 0 }, 1050); // Small jump

        // Many frames of blending
        for (let i = 0; i < 100; i++) {
          predictor.getDisplayPosition(1050 + i * 16, 0.016);
        }

        expect(predictor.isCorrecting()).toBe(false);
      });
    });
  });
});
