/**
 * Game On Dude! - Middleware System
 * www.gameonguy.com
 *
 * A flexible middleware pipeline for intercepting and processing messages.
 * Supports both incoming and outgoing message transformation, validation,
 * logging, rate limiting, and more.
 *
 * Features:
 * - Async middleware chain execution
 * - Named middleware for easy management
 * - Priority-based ordering
 * - Context passing between middlewares
 * - Error handling and recovery
 * - Conditional middleware execution
 *
 * @example
 * ```typescript
 * const pipeline = new MiddlewarePipeline();
 *
 * // Add logging middleware
 * pipeline.use({
 *   name: 'logger',
 *   priority: 100,
 *   handler: async (ctx, next) => {
 *     console.log('Incoming:', ctx.message.type);
 *     await next();
 *     console.log('Processed:', ctx.message.type);
 *   }
 * });
 *
 * // Add validation middleware
 * pipeline.use({
 *   name: 'validator',
 *   priority: 90,
 *   handler: async (ctx, next) => {
 *     if (!ctx.message.type) {
 *       ctx.error = new Error('Missing message type');
 *       return; // Don't call next()
 *     }
 *     await next();
 *   }
 * });
 *
 * // Process message
 * await pipeline.execute(message, client);
 * ```
 */

import { Client } from '../core/Client';
import { Message, MessageType } from '../core/types';
import logger from '../core/Logger';

// ============================================================================
// Types
// ============================================================================

/** Direction of message flow */
export enum MessageDirection {
  INCOMING = 'incoming',
  OUTGOING = 'outgoing',
  BOTH = 'both',
}

/** Context passed through the middleware chain */
export interface MiddlewareContext {
  /** The message being processed */
  message: Message;
  /** The client associated with this message */
  client: Client;
  /** Message direction */
  direction: MessageDirection;
  /** Whether processing should continue */
  shouldContinue: boolean;
  /** Error if one occurred */
  error?: Error;
  /** Custom metadata that middlewares can use to communicate */
  metadata: Record<string, any>;
  /** Timestamp when processing started */
  startTime: number;
  /** Room ID if applicable */
  roomId?: string;
  /** Modified message (if middleware transformed it) */
  transformedMessage?: Message;
}

/** The next function to call the next middleware */
export type NextFunction = () => Promise<void>;

/** Middleware handler function */
export type MiddlewareHandler = (
  ctx: MiddlewareContext,
  next: NextFunction
) => Promise<void> | void;

/** Condition function to determine if middleware should run */
export type MiddlewareCondition = (ctx: MiddlewareContext) => boolean;

/** Middleware configuration */
export interface MiddlewareConfig {
  /** Unique name for this middleware */
  name: string;
  /** Handler function */
  handler: MiddlewareHandler;
  /** Priority (higher = runs first, default 50) */
  priority?: number;
  /** Which message directions this middleware applies to */
  direction?: MessageDirection;
  /** Specific message types this middleware handles (empty = all) */
  messageTypes?: (MessageType | string)[];
  /** Condition function for conditional execution */
  condition?: MiddlewareCondition;
  /** Whether this middleware is enabled */
  enabled?: boolean;
}

/** Internal middleware representation */
interface InternalMiddleware extends Required<Omit<MiddlewareConfig, 'condition'>> {
  condition?: MiddlewareCondition;
}

// ============================================================================
// Middleware Pipeline
// ============================================================================

/**
 * Executes a chain of middleware handlers for message processing.
 */
export class MiddlewarePipeline {
  private middlewares: InternalMiddleware[] = [];
  private readonly log = logger.child({ component: 'MiddlewarePipeline' });

  /**
   * Add a middleware to the pipeline.
   */
  use(config: MiddlewareConfig): this {
    const middleware: InternalMiddleware = {
      name: config.name,
      handler: config.handler,
      priority: config.priority ?? 50,
      direction: config.direction ?? MessageDirection.BOTH,
      messageTypes: config.messageTypes ?? [],
      enabled: config.enabled ?? true,
      condition: config.condition,
    };

    this.middlewares.push(middleware);
    this.sortMiddlewares();

    this.log.debug({ name: middleware.name, priority: middleware.priority }, 'Middleware added');

    return this;
  }

  /**
   * Remove a middleware by name.
   */
  remove(name: string): boolean {
    const index = this.middlewares.findIndex((m) => m.name === name);
    if (index !== -1) {
      this.middlewares.splice(index, 1);
      this.log.debug({ name }, 'Middleware removed');
      return true;
    }
    return false;
  }

  /**
   * Enable or disable a middleware by name.
   */
  setEnabled(name: string, enabled: boolean): boolean {
    const middleware = this.middlewares.find((m) => m.name === name);
    if (middleware) {
      middleware.enabled = enabled;
      return true;
    }
    return false;
  }

  /**
   * Get a middleware by name.
   */
  get(name: string): MiddlewareConfig | undefined {
    return this.middlewares.find((m) => m.name === name);
  }

  /**
   * List all middleware names.
   */
  list(): string[] {
    return this.middlewares.map((m) => m.name);
  }

  /**
   * Clear all middlewares.
   */
  clear(): void {
    this.middlewares = [];
  }

  /** Sort middlewares by priority (descending) */
  private sortMiddlewares(): void {
    this.middlewares.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Execute the middleware pipeline for a message.
   */
  async execute(
    message: Message,
    client: Client,
    direction: MessageDirection = MessageDirection.INCOMING,
    roomId?: string
  ): Promise<MiddlewareContext> {
    const ctx: MiddlewareContext = {
      message,
      client,
      direction,
      shouldContinue: true,
      metadata: {},
      startTime: Date.now(),
      roomId,
    };

    // Filter applicable middlewares
    const applicable = this.middlewares.filter((m) => {
      if (!m.enabled) return false;
      if (m.direction !== MessageDirection.BOTH && m.direction !== direction) return false;
      if (m.messageTypes.length > 0 && !m.messageTypes.includes(message.type)) return false;
      if (m.condition && !m.condition(ctx)) return false;
      return true;
    });

    // Build the middleware chain
    let index = 0;

    const next: NextFunction = async () => {
      if (!ctx.shouldContinue || index >= applicable.length) return;

      const middleware = applicable[index++];

      try {
        await middleware.handler(ctx, next);
      } catch (error) {
        ctx.error = error instanceof Error ? error : new Error(String(error));
        ctx.shouldContinue = false;
        this.log.error(
          { error: ctx.error, middleware: middleware.name },
          'Middleware error'
        );
      }
    };

    // Start the chain
    await next();

    return ctx;
  }

  /**
   * Execute pipeline for outgoing message.
   */
  async executeOutgoing(
    message: Message,
    client: Client,
    roomId?: string
  ): Promise<MiddlewareContext> {
    return this.execute(message, client, MessageDirection.OUTGOING, roomId);
  }
}

// ============================================================================
// Built-in Middlewares
// ============================================================================

/**
 * Create a logging middleware.
 */
export function createLoggingMiddleware(options: {
  name?: string;
  logLevel?: 'debug' | 'info' | 'warn';
  logPayload?: boolean;
  priority?: number;
} = {}): MiddlewareConfig {
  const log = logger.child({ component: 'MessageLogger' });
  const level = options.logLevel ?? 'debug';

  return {
    name: options.name ?? 'logging',
    priority: options.priority ?? 100,
    handler: async (ctx, next) => {
      const startTime = Date.now();

      log[level](
        {
          type: ctx.message.type,
          clientId: ctx.client.id,
          direction: ctx.direction,
          roomId: ctx.roomId,
          ...(options.logPayload && { payload: ctx.message.payload }),
        },
        `${ctx.direction === MessageDirection.INCOMING ? '→' : '←'} ${ctx.message.type}`
      );

      await next();

      log[level](
        {
          type: ctx.message.type,
          duration: Date.now() - startTime,
          error: ctx.error?.message,
        },
        `${ctx.message.type} processed in ${Date.now() - startTime}ms`
      );
    },
  };
}

/**
 * Create a rate limiting middleware.
 */
export function createRateLimitMiddleware(options: {
  name?: string;
  /** Max messages per window */
  maxMessages?: number;
  /** Window size in milliseconds */
  windowMs?: number;
  /** Message types to rate limit (empty = all) */
  messageTypes?: (MessageType | string)[];
  /** Custom key generator (default: client ID) */
  keyGenerator?: (ctx: MiddlewareContext) => string;
  /** Handler when rate limit exceeded */
  onLimitExceeded?: (ctx: MiddlewareContext) => void;
  priority?: number;
} = {}): MiddlewareConfig {
  const maxMessages = options.maxMessages ?? 100;
  const windowMs = options.windowMs ?? 1000;
  const keyGenerator = options.keyGenerator ?? ((ctx) => ctx.client.id);

  // Track message counts per key
  const counters = new Map<string, { count: number; resetAt: number }>();

  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of counters) {
      if (data.resetAt < now) {
        counters.delete(key);
      }
    }
  }, windowMs * 2);

  return {
    name: options.name ?? 'rate-limit',
    priority: options.priority ?? 95,
    direction: MessageDirection.INCOMING,
    messageTypes: options.messageTypes,
    handler: async (ctx, next) => {
      const key = keyGenerator(ctx);
      const now = Date.now();

      let counter = counters.get(key);

      if (!counter || counter.resetAt < now) {
        counter = { count: 0, resetAt: now + windowMs };
        counters.set(key, counter);
      }

      counter.count++;

      if (counter.count > maxMessages) {
        ctx.shouldContinue = false;
        ctx.error = new Error('Rate limit exceeded');

        if (options.onLimitExceeded) {
          options.onLimitExceeded(ctx);
        } else {
          ctx.client.sendError('Rate limit exceeded. Please slow down.');
        }

        return;
      }

      // Add rate limit info to metadata
      ctx.metadata.rateLimit = {
        remaining: maxMessages - counter.count,
        reset: counter.resetAt,
      };

      await next();
    },
  };
}

/**
 * Create a validation middleware.
 */
export function createValidationMiddleware(options: {
  name?: string;
  /** Validators for specific message types */
  validators?: Map<MessageType | string, (payload: any) => boolean | string>;
  /** Whether to require authentication for all messages */
  requireAuth?: boolean;
  /** Message types that don't require auth */
  authExempt?: (MessageType | string)[];
  priority?: number;
} = {}): MiddlewareConfig {
  const validators = options.validators ?? new Map();
  const requireAuth = options.requireAuth ?? true;
  const authExempt = options.authExempt ?? [MessageType.AUTH, MessageType.PING];

  return {
    name: options.name ?? 'validation',
    priority: options.priority ?? 90,
    direction: MessageDirection.INCOMING,
    handler: async (ctx, next) => {
      // Check authentication
      if (requireAuth && !ctx.client.isAuthenticated) {
        if (!authExempt.includes(ctx.message.type)) {
          ctx.shouldContinue = false;
          ctx.error = new Error('Authentication required');
          ctx.client.sendError('You must authenticate first');
          return;
        }
      }

      // Run type-specific validator
      const validator = validators.get(ctx.message.type);
      if (validator) {
        const result = validator(ctx.message.payload);
        if (result !== true) {
          ctx.shouldContinue = false;
          ctx.error = new Error(typeof result === 'string' ? result : 'Validation failed');
          ctx.client.sendError(ctx.error.message);
          return;
        }
      }

      await next();
    },
  };
}

/**
 * Create a message transformation middleware.
 */
export function createTransformMiddleware(options: {
  name?: string;
  /** Transform functions for specific message types */
  transformers?: Map<MessageType | string, (message: Message) => Message>;
  priority?: number;
  direction?: MessageDirection;
} = {}): MiddlewareConfig {
  const transformers = options.transformers ?? new Map();

  return {
    name: options.name ?? 'transform',
    priority: options.priority ?? 80,
    direction: options.direction ?? MessageDirection.BOTH,
    handler: async (ctx, next) => {
      const transformer = transformers.get(ctx.message.type);
      if (transformer) {
        const transformed = transformer(ctx.message);
        ctx.transformedMessage = transformed;
        ctx.message = transformed;
      }

      await next();
    },
  };
}

/**
 * Create a metrics collection middleware.
 */
export function createMetricsMiddleware(options: {
  name?: string;
  /** Callback to report metrics */
  onMetric?: (metric: MessageMetric) => void;
  priority?: number;
} = {}): MiddlewareConfig {
  const metrics: MessageMetric[] = [];

  return {
    name: options.name ?? 'metrics',
    priority: options.priority ?? 99,
    handler: async (ctx, next) => {
      const startTime = Date.now();

      await next();

      const metric: MessageMetric = {
        type: ctx.message.type,
        direction: ctx.direction,
        clientId: ctx.client.id,
        roomId: ctx.roomId,
        duration: Date.now() - startTime,
        timestamp: startTime,
        success: !ctx.error,
        errorMessage: ctx.error?.message,
      };

      if (options.onMetric) {
        options.onMetric(metric);
      } else {
        metrics.push(metric);
      }
    },
  };
}

/** Metric data for a processed message */
export interface MessageMetric {
  type: MessageType | string;
  direction: MessageDirection;
  clientId: string;
  roomId?: string;
  duration: number;
  timestamp: number;
  success: boolean;
  errorMessage?: string;
}

/**
 * Create an error handling middleware.
 */
export function createErrorHandlerMiddleware(options: {
  name?: string;
  /** Custom error handler */
  onError?: (error: Error, ctx: MiddlewareContext) => void;
  /** Whether to send error to client */
  sendToClient?: boolean;
  priority?: number;
} = {}): MiddlewareConfig {
  const sendToClient = options.sendToClient ?? true;
  const log = logger.child({ component: 'ErrorHandler' });

  return {
    name: options.name ?? 'error-handler',
    // Lowest priority so it wraps everything
    priority: options.priority ?? 1,
    handler: async (ctx, next) => {
      try {
        await next();

        // Handle errors that were set but not thrown
        if (ctx.error && sendToClient) {
          ctx.client.sendError(ctx.error.message);
        }
      } catch (error) {
        ctx.error = error instanceof Error ? error : new Error(String(error));
        ctx.shouldContinue = false;

        log.error({ error: ctx.error, messageType: ctx.message.type }, 'Unhandled middleware error');

        if (options.onError) {
          options.onError(ctx.error, ctx);
        }

        if (sendToClient) {
          ctx.client.sendError('An error occurred processing your request');
        }
      }
    },
  };
}

/**
 * Create a compression middleware for outgoing messages.
 */
export function createCompressionMiddleware(options: {
  name?: string;
  /** Minimum payload size to compress (bytes) */
  threshold?: number;
  priority?: number;
} = {}): MiddlewareConfig {
  const threshold = options.threshold ?? 1024;

  return {
    name: options.name ?? 'compression',
    priority: options.priority ?? 10,
    direction: MessageDirection.OUTGOING,
    handler: async (ctx, next) => {
      await next();

      // Check if payload should be compressed
      const payload = ctx.message.payload;
      const payloadSize = payload ? JSON.stringify(payload).length : 0;

      if (payloadSize > threshold) {
        ctx.metadata.shouldCompress = true;
        ctx.metadata.originalSize = payloadSize;
      }
    },
  };
}

// ============================================================================
// Middleware Presets
// ============================================================================

/**
 * Create a standard middleware stack for production use.
 */
export function createStandardMiddlewareStack(options: {
  enableLogging?: boolean;
  enableRateLimit?: boolean;
  enableValidation?: boolean;
  enableMetrics?: boolean;
  enableErrorHandler?: boolean;
  rateLimitConfig?: Parameters<typeof createRateLimitMiddleware>[0];
  validationConfig?: Parameters<typeof createValidationMiddleware>[0];
  onMetric?: (metric: MessageMetric) => void;
} = {}): MiddlewareConfig[] {
  const stack: MiddlewareConfig[] = [];

  if (options.enableErrorHandler !== false) {
    stack.push(createErrorHandlerMiddleware());
  }

  if (options.enableMetrics !== false) {
    stack.push(createMetricsMiddleware({ onMetric: options.onMetric }));
  }

  if (options.enableLogging !== false) {
    stack.push(createLoggingMiddleware());
  }

  if (options.enableRateLimit !== false) {
    stack.push(createRateLimitMiddleware(options.rateLimitConfig));
  }

  if (options.enableValidation !== false) {
    stack.push(createValidationMiddleware(options.validationConfig));
  }

  return stack;
}

/**
 * Create a development middleware stack with verbose logging.
 */
export function createDevMiddlewareStack(): MiddlewareConfig[] {
  return [
    createErrorHandlerMiddleware(),
    createLoggingMiddleware({ logLevel: 'info', logPayload: true }),
  ];
}
