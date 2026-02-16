/**
 * Unit tests for the Middleware system
 */

import {
  MiddlewarePipeline,
  MiddlewareContext,
  MessageDirection,
  createLoggingMiddleware,
  createRateLimitMiddleware,
  createValidationMiddleware,
  createErrorHandlerMiddleware,
  createStandardMiddlewareStack,
} from '../../src/middleware/Middleware';
import { Client } from '../../src/core/Client';
import { Message, MessageType } from '../../src/core/types';
import { WebSocket } from 'ws';

// ============================================================================
// Mocks
// ============================================================================

// Mock Client
function createMockClient(options: Partial<Client> = {}): Client {
  const mockSocket = {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    ping: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
  } as unknown as WebSocket;

  const client = new Client(mockSocket);

  // Apply any overrides
  if (options.isAuthenticated !== undefined) {
    client.authenticate('user-123', 'TestUser');
  }

  return client;
}

// ============================================================================
// Tests
// ============================================================================

describe('MiddlewarePipeline', () => {
  describe('Basic Pipeline', () => {
    it('should create empty pipeline', () => {
      const pipeline = new MiddlewarePipeline();

      expect(pipeline.list()).toEqual([]);
    });

    it('should add middleware', () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'test',
        handler: async (ctx, next) => next(),
      });

      expect(pipeline.list()).toContain('test');
    });

    it('should remove middleware by name', () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'test',
        handler: async (ctx, next) => next(),
      });

      const removed = pipeline.remove('test');

      expect(removed).toBe(true);
      expect(pipeline.list()).not.toContain('test');
    });

    it('should return false when removing non-existent middleware', () => {
      const pipeline = new MiddlewarePipeline();

      const removed = pipeline.remove('non-existent');

      expect(removed).toBe(false);
    });

    it('should get middleware by name', () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'test',
        priority: 75,
        handler: async (ctx, next) => next(),
      });

      const mw = pipeline.get('test');

      expect(mw).toBeDefined();
      expect(mw!.priority).toBe(75);
    });

    it('should clear all middleware', () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({ name: 'a', handler: async (ctx, next) => next() });
      pipeline.use({ name: 'b', handler: async (ctx, next) => next() });

      pipeline.clear();

      expect(pipeline.list()).toEqual([]);
    });
  });

  describe('Execution', () => {
    it('should execute middleware in order', async () => {
      const pipeline = new MiddlewarePipeline();
      const order: number[] = [];

      pipeline.use({
        name: 'first',
        priority: 100,
        handler: async (ctx, next) => {
          order.push(1);
          await next();
          order.push(4);
        },
      });

      pipeline.use({
        name: 'second',
        priority: 50,
        handler: async (ctx, next) => {
          order.push(2);
          await next();
          order.push(3);
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      await pipeline.execute(message, client);

      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('should stop execution when shouldContinue is false', async () => {
      const pipeline = new MiddlewarePipeline();
      let secondCalled = false;

      pipeline.use({
        name: 'first',
        priority: 100,
        handler: async (ctx, next) => {
          ctx.shouldContinue = false;
          // Don't call next
        },
      });

      pipeline.use({
        name: 'second',
        priority: 50,
        handler: async (ctx, next) => {
          secondCalled = true;
          await next();
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      const ctx = await pipeline.execute(message, client);

      expect(secondCalled).toBe(false);
      expect(ctx.shouldContinue).toBe(false);
    });

    it('should pass context through chain', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'first',
        handler: async (ctx, next) => {
          ctx.metadata.value = 1;
          await next();
        },
      });

      pipeline.use({
        name: 'second',
        handler: async (ctx, next) => {
          ctx.metadata.value += 1;
          await next();
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      const ctx = await pipeline.execute(message, client);

      expect(ctx.metadata.value).toBe(2);
    });

    it('should handle errors gracefully', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'error-thrower',
        handler: async () => {
          throw new Error('Test error');
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      const ctx = await pipeline.execute(message, client);

      expect(ctx.error).toBeDefined();
      expect(ctx.error!.message).toBe('Test error');
      expect(ctx.shouldContinue).toBe(false);
    });

    it('should transform messages', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use({
        name: 'transformer',
        handler: async (ctx, next) => {
          ctx.transformedMessage = {
            ...ctx.message,
            payload: { transformed: true },
          };
          ctx.message = ctx.transformedMessage;
          await next();
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING, payload: { original: true } };

      const ctx = await pipeline.execute(message, client);

      expect(ctx.message.payload).toEqual({ transformed: true });
    });
  });

  describe('Filtering', () => {
    it('should filter by direction', async () => {
      const pipeline = new MiddlewarePipeline();
      let called = false;

      pipeline.use({
        name: 'incoming-only',
        direction: MessageDirection.INCOMING,
        handler: async (ctx, next) => {
          called = true;
          await next();
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      await pipeline.execute(message, client, MessageDirection.OUTGOING);

      expect(called).toBe(false);
    });

    it('should filter by message type', async () => {
      const pipeline = new MiddlewarePipeline();
      let called = false;

      pipeline.use({
        name: 'auth-only',
        messageTypes: [MessageType.AUTH],
        handler: async (ctx, next) => {
          called = true;
          await next();
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      await pipeline.execute(message, client);

      expect(called).toBe(false);
    });

    it('should filter by condition', async () => {
      const pipeline = new MiddlewarePipeline();
      let called = false;

      pipeline.use({
        name: 'authenticated-only',
        condition: (ctx) => ctx.client.isAuthenticated,
        handler: async (ctx, next) => {
          called = true;
          await next();
        },
      });

      const client = createMockClient(); // Not authenticated
      const message: Message = { type: MessageType.PING };

      await pipeline.execute(message, client);

      expect(called).toBe(false);
    });

    it('should respect enabled flag', async () => {
      const pipeline = new MiddlewarePipeline();
      let called = false;

      pipeline.use({
        name: 'disabled',
        enabled: false,
        handler: async (ctx, next) => {
          called = true;
          await next();
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      await pipeline.execute(message, client);

      expect(called).toBe(false);
    });

    it('should toggle enabled state', async () => {
      const pipeline = new MiddlewarePipeline();
      let callCount = 0;

      pipeline.use({
        name: 'toggleable',
        handler: async (ctx, next) => {
          callCount++;
          await next();
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      await pipeline.execute(message, client);
      expect(callCount).toBe(1);

      pipeline.setEnabled('toggleable', false);

      await pipeline.execute(message, client);
      expect(callCount).toBe(1); // Not incremented

      pipeline.setEnabled('toggleable', true);

      await pipeline.execute(message, client);
      expect(callCount).toBe(2);
    });
  });

  describe('Priority', () => {
    it('should execute higher priority first', async () => {
      const pipeline = new MiddlewarePipeline();
      const order: string[] = [];

      pipeline.use({
        name: 'low',
        priority: 10,
        handler: async (ctx, next) => {
          order.push('low');
          await next();
        },
      });

      pipeline.use({
        name: 'high',
        priority: 100,
        handler: async (ctx, next) => {
          order.push('high');
          await next();
        },
      });

      pipeline.use({
        name: 'medium',
        priority: 50,
        handler: async (ctx, next) => {
          order.push('medium');
          await next();
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      await pipeline.execute(message, client);

      expect(order).toEqual(['high', 'medium', 'low']);
    });
  });
});

describe('Built-in Middlewares', () => {
  describe('createLoggingMiddleware', () => {
    it('should create a logging middleware', () => {
      const middleware = createLoggingMiddleware();

      expect(middleware.name).toBe('logging');
      expect(middleware.priority).toBe(100);
    });

    it('should execute and call next', async () => {
      const pipeline = new MiddlewarePipeline();
      let nextCalled = false;

      pipeline.use(createLoggingMiddleware());
      pipeline.use({
        name: 'next-checker',
        handler: async (ctx, next) => {
          nextCalled = true;
          await next();
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      await pipeline.execute(message, client);

      expect(nextCalled).toBe(true);
    });
  });

  describe('createRateLimitMiddleware', () => {
    it('should allow messages under limit', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use(createRateLimitMiddleware({
        maxMessages: 5,
        windowMs: 1000,
      }));

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      for (let i = 0; i < 5; i++) {
        const ctx = await pipeline.execute(message, client);
        expect(ctx.shouldContinue).toBe(true);
      }
    });

    it('should block messages over limit', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use(createRateLimitMiddleware({
        maxMessages: 2,
        windowMs: 10000,
      }));

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      await pipeline.execute(message, client);
      await pipeline.execute(message, client);
      const ctx = await pipeline.execute(message, client);

      expect(ctx.shouldContinue).toBe(false);
      expect(ctx.error).toBeDefined();
      expect(ctx.error!.message).toContain('Rate limit');
    });

    it('should track rate limit info in metadata', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use(createRateLimitMiddleware({
        maxMessages: 10,
        windowMs: 1000,
      }));

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      const ctx = await pipeline.execute(message, client);

      expect(ctx.metadata.rateLimit).toBeDefined();
      expect(ctx.metadata.rateLimit.remaining).toBe(9);
    });
  });

  describe('createValidationMiddleware', () => {
    it('should require authentication by default', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use(createValidationMiddleware());

      const client = createMockClient(); // Not authenticated
      const message: Message = { type: MessageType.ROOM_CREATE };

      const ctx = await pipeline.execute(message, client);

      expect(ctx.shouldContinue).toBe(false);
      expect(ctx.error!.message).toContain('Authentication');
    });

    it('should allow auth-exempt messages', async () => {
      const pipeline = new MiddlewarePipeline();

      pipeline.use(createValidationMiddleware({
        authExempt: [MessageType.AUTH, MessageType.PING],
      }));

      const client = createMockClient(); // Not authenticated
      const message: Message = { type: MessageType.AUTH };

      const ctx = await pipeline.execute(message, client);

      expect(ctx.shouldContinue).toBe(true);
    });

    it('should run custom validators', async () => {
      const pipeline = new MiddlewarePipeline();

      const validators = new Map();
      validators.set(MessageType.ROOM_CREATE, (payload: any) => {
        if (!payload?.gameType) return 'gameType is required';
        return true;
      });

      pipeline.use(createValidationMiddleware({
        requireAuth: false,
        validators,
      }));

      const client = createMockClient();
      const message: Message = {
        type: MessageType.ROOM_CREATE,
        payload: {}, // Missing gameType
      };

      const ctx = await pipeline.execute(message, client);

      expect(ctx.shouldContinue).toBe(false);
      expect(ctx.error!.message).toBe('gameType is required');
    });
  });

  describe('createErrorHandlerMiddleware', () => {
    it('should catch errors from other middleware', async () => {
      const pipeline = new MiddlewarePipeline();

      // Error handler has priority 1 (lowest), so it wraps everything
      pipeline.use(createErrorHandlerMiddleware({
        sendToClient: false,
      }));

      // This runs after error-handler's next() call
      pipeline.use({
        name: 'error-thrower',
        priority: 50, // Higher than error-handler, runs first in the chain
        handler: async () => {
          throw new Error('Test error');
        },
      });

      const client = createMockClient();
      const message: Message = { type: MessageType.PING };

      const ctx = await pipeline.execute(message, client);

      // Error should be captured in context
      expect(ctx.error).toBeDefined();
      expect(ctx.error!.message).toBe('Test error');
      expect(ctx.shouldContinue).toBe(false);
    });
  });

  describe('createStandardMiddlewareStack', () => {
    it('should create standard stack', () => {
      const stack = createStandardMiddlewareStack();

      expect(stack.length).toBeGreaterThan(0);
      expect(stack.some(m => m.name === 'error-handler')).toBe(true);
      expect(stack.some(m => m.name === 'metrics')).toBe(true);
    });

    it('should allow disabling specific middleware', () => {
      const stack = createStandardMiddlewareStack({
        enableLogging: false,
        enableRateLimit: false,
      });

      expect(stack.some(m => m.name === 'logging')).toBe(false);
      expect(stack.some(m => m.name === 'rate-limit')).toBe(false);
    });
  });
});
