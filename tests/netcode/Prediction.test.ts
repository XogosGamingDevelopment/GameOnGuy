/**
 * Unit tests for the Prediction system
 */

import {
  InputProcessor,
  BaseInput,
  MovementInput,
  InputProcessingResult,
  StateSnapshot,
  calculatePositionError,
  needsReconciliation,
  smoothCorrection,
  createMovementInput,
} from '../../src/netcode/Prediction';

// ============================================================================
// Test Types
// ============================================================================

interface TestPlayerState {
  x: number;
  y: number;
  z: number;
  health: number;
}

interface TestInput extends BaseInput {
  dx: number;
  dy: number;
}

// ============================================================================
// Tests
// ============================================================================

describe('Prediction System', () => {
  // ==========================================================================
  // InputProcessor Tests
  // ==========================================================================
  describe('InputProcessor', () => {
    let processor: InputProcessor<TestPlayerState, TestInput>;
    let initialState: TestPlayerState;

    beforeEach(() => {
      processor = new InputProcessor<TestPlayerState, TestInput>({
        applyInput: (state, input, _playerId) => {
          return {
            ...state,
            x: state.x + input.dx * input.dt,
            y: state.y + input.dy * input.dt,
          };
        },
      });

      initialState = { x: 0, y: 0, z: 0, health: 100 };
    });

    describe('processInput', () => {
      it('should apply input and return new state', () => {
        const input: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100,
          dy: 50,
        };

        const result = processor.processInput('player1', input, initialState);

        expect(result.accepted).toBe(true);
        expect(result.state.x).toBeCloseTo(1.6, 1);
        expect(result.state.y).toBeCloseTo(0.8, 1);
        expect(result.sequence).toBe(1);
        expect(result.serverTick).toBe(1);
      });

      it('should reject duplicate inputs', () => {
        const input1: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100,
          dy: 0,
        };

        processor.processInput('player1', input1, initialState);

        // Try to process same sequence again
        const result = processor.processInput('player1', input1, initialState);

        expect(result.accepted).toBe(false);
        expect(result.rejectionReason).toContain('Duplicate');
      });

      it('should reject inputs with old sequence numbers', () => {
        const input1: TestInput = {
          sequence: 5,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100,
          dy: 0,
        };

        processor.processInput('player1', input1, initialState);

        // Try to process older sequence
        const oldInput: TestInput = {
          sequence: 3,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 50,
          dy: 0,
        };

        const result = processor.processInput('player1', oldInput, initialState);

        expect(result.accepted).toBe(false);
        expect(result.rejectionReason).toContain('old');
      });

      it('should reject inputs that are too old (timestamp)', () => {
        const oldTimestamp = Date.now() - 2000; // 2 seconds ago (max is 1 second)
        const input: TestInput = {
          sequence: 1,
          timestamp: oldTimestamp,
          dt: 0.016,
          dx: 100,
          dy: 0,
        };

        const result = processor.processInput('player1', input, initialState);

        expect(result.accepted).toBe(false);
        expect(result.rejectionReason).toContain('too old');
      });

      it('should increment server tick with each processed input', () => {
        const input1: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 10,
          dy: 0,
        };

        const input2: TestInput = {
          sequence: 2,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 10,
          dy: 0,
        };

        const result1 = processor.processInput('player1', input1, initialState);
        const result2 = processor.processInput('player1', input2, result1.state);

        expect(result1.serverTick).toBe(1);
        expect(result2.serverTick).toBe(2);
      });
    });

    describe('custom validation', () => {
      it('should use custom validation function', () => {
        const validatingProcessor = new InputProcessor<TestPlayerState, TestInput>({
          applyInput: (state) => state,
          validateInput: (input, _playerId) => {
            if (Math.abs(input.dx) > 50) {
              return 'Speed hack detected';
            }
            return true;
          },
        });

        const badInput: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100, // Too fast!
          dy: 0,
        };

        const result = validatingProcessor.processInput('player1', badInput, initialState);

        expect(result.accepted).toBe(false);
        expect(result.rejectionReason).toBe('Speed hack detected');
      });
    });

    describe('bufferInput and processBufferedInputs', () => {
      it('should buffer inputs for later processing', () => {
        const input: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100,
          dy: 50,
        };

        processor.bufferInput('player1', input);

        expect(processor.getPendingInputCount('player1')).toBe(1);
      });

      it('should process all buffered inputs in order', () => {
        const input1: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100,
          dy: 0,
        };

        const input2: TestInput = {
          sequence: 2,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100,
          dy: 0,
        };

        processor.bufferInput('player1', input1);
        processor.bufferInput('player1', input2);

        const finalState = processor.processBufferedInputs('player1', initialState);

        // Both inputs should be applied
        expect(finalState.x).toBeCloseTo(3.2, 1); // 100 * 0.016 * 2
      });

      it('should process buffered inputs in sequence order even if added out of order', () => {
        const input1: TestInput = {
          sequence: 2,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 200,
          dy: 0,
        };

        const input2: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100,
          dy: 0,
        };

        // Add in wrong order
        processor.bufferInput('player1', input1);
        processor.bufferInput('player1', input2);

        const finalState = processor.processBufferedInputs('player1', initialState);

        // Should process sequence 1 first, then sequence 2
        expect(finalState.x).toBeCloseTo(4.8, 1); // (100 + 200) * 0.016
      });
    });

    describe('snapshots', () => {
      it('should store state snapshots after processing', () => {
        const input: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100,
          dy: 50,
        };

        processor.processInput('player1', input, initialState);

        const snapshot = processor.getSnapshotAtSequence('player1', 1);

        expect(snapshot).toBeDefined();
        expect(snapshot!.sequence).toBe(1);
        expect(snapshot!.state.x).toBeCloseTo(1.6, 1);
      });

      it('should retrieve snapshot by server tick', () => {
        const input: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 100,
          dy: 50,
        };

        const result = processor.processInput('player1', input, initialState);

        const snapshot = processor.getSnapshotAtTick('player1', result.serverTick);

        expect(snapshot).toBeDefined();
        expect(snapshot!.serverTick).toBe(result.serverTick);
      });

      it('should return recent snapshots', () => {
        for (let i = 1; i <= 5; i++) {
          const input: TestInput = {
            sequence: i,
            timestamp: Date.now(),
            dt: 0.016,
            dx: 10,
            dy: 0,
          };
          processor.processInput('player1', input, { ...initialState, x: i * 0.16 });
        }

        const recent = processor.getRecentSnapshots('player1', 3);

        expect(recent.length).toBe(3);
        expect(recent[0].sequence).toBe(3);
        expect(recent[2].sequence).toBe(5);
      });
    });

    describe('player management', () => {
      it('should track last processed sequence per player', () => {
        const input1: TestInput = {
          sequence: 5,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 10,
          dy: 0,
        };

        const input2: TestInput = {
          sequence: 3,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 10,
          dy: 0,
        };

        processor.processInput('player1', input1, initialState);
        processor.processInput('player2', input2, initialState);

        expect(processor.getLastProcessedSequence('player1')).toBe(5);
        expect(processor.getLastProcessedSequence('player2')).toBe(3);
      });

      it('should clean up player data on removePlayer', () => {
        const input: TestInput = {
          sequence: 1,
          timestamp: Date.now(),
          dt: 0.016,
          dx: 10,
          dy: 0,
        };

        processor.processInput('player1', input, initialState);

        expect(processor.getLastProcessedSequence('player1')).toBe(1);

        processor.removePlayer('player1');

        expect(processor.getLastProcessedSequence('player1')).toBe(0);
        expect(processor.getSnapshotAtSequence('player1', 1)).toBeUndefined();
      });
    });

    describe('tick management', () => {
      it('should increment tick on manual tick() call', () => {
        expect(processor.getServerTick()).toBe(0);

        processor.tick();
        processor.tick();

        expect(processor.getServerTick()).toBe(2);
      });
    });
  });

  // ==========================================================================
  // Utility Function Tests
  // ==========================================================================
  describe('Utility Functions', () => {
    describe('calculatePositionError', () => {
      it('should calculate 2D distance', () => {
        const predicted = { x: 3, y: 4 };
        const server = { x: 0, y: 0 };

        const error = calculatePositionError(predicted, server);

        expect(error).toBe(5); // 3-4-5 triangle
      });

      it('should calculate 3D distance', () => {
        const predicted = { x: 1, y: 2, z: 2 };
        const server = { x: 0, y: 0, z: 0 };

        const error = calculatePositionError(predicted, server);

        expect(error).toBe(3); // sqrt(1 + 4 + 4)
      });

      it('should return 0 for identical positions', () => {
        const pos = { x: 5, y: 10, z: 15 };

        const error = calculatePositionError(pos, pos);

        expect(error).toBe(0);
      });
    });

    describe('needsReconciliation', () => {
      it('should return true when error exceeds threshold', () => {
        expect(needsReconciliation(0.2, 0.1)).toBe(true);
      });

      it('should return false when error is below threshold', () => {
        expect(needsReconciliation(0.05, 0.1)).toBe(false);
      });

      it('should use default threshold of 0.1', () => {
        expect(needsReconciliation(0.05)).toBe(false);
        expect(needsReconciliation(0.15)).toBe(true);
      });
    });

    describe('smoothCorrection', () => {
      it('should interpolate towards target', () => {
        const result = smoothCorrection(0, 10, 0.5);

        expect(result).toBe(5);
      });

      it('should use default smoothing of 0.1', () => {
        const result = smoothCorrection(0, 10);

        expect(result).toBe(1);
      });

      it('should approach target with repeated calls', () => {
        let value = 0;
        const target = 100;

        for (let i = 0; i < 50; i++) {
          value = smoothCorrection(value, target, 0.1);
        }

        // After 50 iterations at 0.1 smoothing, should be close to target
        expect(value).toBeGreaterThan(99);
      });
    });

    describe('createMovementInput', () => {
      it('should create a movement input with all fields', () => {
        const beforeTime = Date.now();
        const input = createMovementInput(5, { x: 1, y: -1 }, 0.016, ['jump']);
        const afterTime = Date.now();

        expect(input.sequence).toBe(5);
        expect(input.direction.x).toBe(1);
        expect(input.direction.y).toBe(-1);
        expect(input.dt).toBe(0.016);
        expect(input.actions).toEqual(['jump']);
        expect(input.timestamp).toBeGreaterThanOrEqual(beforeTime);
        expect(input.timestamp).toBeLessThanOrEqual(afterTime);
      });

      it('should create input without optional actions', () => {
        const input = createMovementInput(1, { x: 0, y: 1 }, 0.033);

        expect(input.actions).toBeUndefined();
      });
    });
  });

  // ==========================================================================
  // MovementInput Tests
  // ==========================================================================
  describe('MovementInput handling', () => {
    it('should process standard MovementInput', () => {
      const processor = new InputProcessor<TestPlayerState, MovementInput>({
        applyInput: (state, input, _playerId) => {
          const speed = input.sprint ? 200 : 100;
          return {
            ...state,
            x: state.x + input.direction.x * speed * input.dt,
            y: state.y + input.direction.y * speed * input.dt,
          };
        },
      });

      const input = createMovementInput(1, { x: 1, y: 0 }, 0.016);
      const state: TestPlayerState = { x: 0, y: 0, z: 0, health: 100 };

      const result = processor.processInput('player1', input, state);

      expect(result.accepted).toBe(true);
      expect(result.state.x).toBeCloseTo(1.6, 1);
    });

    it('should handle sprint modifier', () => {
      const processor = new InputProcessor<TestPlayerState, MovementInput>({
        applyInput: (state, input, _playerId) => {
          const speed = input.sprint ? 200 : 100;
          return {
            ...state,
            x: state.x + input.direction.x * speed * input.dt,
            y: state.y + input.direction.y * speed * input.dt,
          };
        },
      });

      const input: MovementInput = {
        sequence: 1,
        timestamp: Date.now(),
        dt: 0.016,
        direction: { x: 1, y: 0 },
        sprint: true,
      };

      const state: TestPlayerState = { x: 0, y: 0, z: 0, health: 100 };
      const result = processor.processInput('player1', input, state);

      expect(result.state.x).toBeCloseTo(3.2, 1); // Double speed
    });
  });
});
