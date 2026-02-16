/**
 * Game On Dude! - Redis Service
 * www.gameonguy.com
 *
 * Redis connection management for caching, sessions, and pub/sub.
 */

import { createClient, RedisClientType } from 'redis';
import logger from '../core/Logger';

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  database?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export type RedisSubscribeCallback = (message: string, channel: string) => void;

export class RedisService {
  private client: RedisClientType;
  private subscriber: RedisClientType;
  private publisher: RedisClientType;
  private isConnected = false;
  private subscriptions: Map<string, RedisSubscribeCallback[]> = new Map();
  private readonly log = logger.child({ component: 'RedisService' });
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(config?: RedisConfig) {
    const url =
      config?.url ??
      process.env.REDIS_URL ??
      `redis://${config?.host ?? 'localhost'}:${config?.port ?? 6379}`;

    this.maxRetries = config?.maxRetries ?? 3;
    this.retryDelayMs = config?.retryDelayMs ?? 1000;

    const clientConfig = {
      url,
      password: config?.password ?? process.env.REDIS_PASSWORD,
      database: config?.database ?? 0,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            this.log.error('Max Redis reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    };

    this.client = createClient(clientConfig);
    this.subscriber = this.client.duplicate();
    this.publisher = this.client.duplicate();

    this.setupEventHandlers();

    this.log.info({ url: url.replace(/:[^:@]*@/, ':***@') }, 'Redis service initialized');
  }

  private setupEventHandlers(): void {
    this.client.on('error', (err) => {
      this.log.error({ error: err }, 'Redis client error');
    });

    this.client.on('connect', () => {
      this.log.debug('Redis client connected');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.log.info('Redis client ready');
    });

    this.client.on('end', () => {
      this.isConnected = false;
      this.log.info('Redis client disconnected');
    });
  }

  /**
   * Connect to Redis.
   */
  async connect(): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await Promise.all([
          this.client.connect(),
          this.subscriber.connect(),
          this.publisher.connect(),
        ]);
        this.isConnected = true;
        this.log.info('Redis connections established');
        return;
      } catch (error) {
        this.log.warn({ attempt, error }, 'Redis connection attempt failed');
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs * attempt);
        } else {
          throw new Error(`Failed to connect to Redis after ${this.maxRetries} attempts`);
        }
      }
    }
  }

  /**
   * Disconnect from Redis.
   */
  async disconnect(): Promise<void> {
    await Promise.all([
      this.client.quit(),
      this.subscriber.quit(),
      this.publisher.quit(),
    ]);
    this.isConnected = false;
    this.log.info('Redis connections closed');
  }

  /**
   * Check if Redis is connected.
   */
  get connected(): boolean {
    return this.isConnected;
  }

  // ============================================================================
  // Key-Value Operations
  // ============================================================================

  /**
   * Get a value by key.
   */
  async get<T = string>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  /**
   * Set a value with optional TTL.
   */
  async set<T = any>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

    if (ttlSeconds) {
      await this.client.setEx(key, ttlSeconds, stringValue);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  /**
   * Set a value only if it doesn't exist.
   */
  async setNX<T = any>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    const result = await this.client.setNX(key, stringValue);

    if (result && ttlSeconds) {
      await this.client.expire(key, ttlSeconds);
    }

    return result;
  }

  /**
   * Delete a key.
   */
  async del(key: string): Promise<boolean> {
    const result = await this.client.del(key);
    return result > 0;
  }

  /**
   * Delete multiple keys.
   */
  async delMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(keys);
  }

  /**
   * Check if key exists.
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result > 0;
  }

  /**
   * Set TTL on a key.
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    return this.client.expire(key, seconds);
  }

  /**
   * Get TTL for a key.
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Get keys matching a pattern.
   */
  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  /**
   * Increment a numeric value.
   */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * Increment by a specific amount.
   */
  async incrBy(key: string, amount: number): Promise<number> {
    return this.client.incrBy(key, amount);
  }

  /**
   * Decrement a numeric value.
   */
  async decr(key: string): Promise<number> {
    return this.client.decr(key);
  }

  // ============================================================================
  // Hash Operations
  // ============================================================================

  /**
   * Set a hash field.
   */
  async hSet(key: string, field: string, value: any): Promise<void> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    await this.client.hSet(key, field, stringValue);
  }

  /**
   * Set multiple hash fields.
   */
  async hSetMultiple(key: string, data: Record<string, any>): Promise<void> {
    const stringData: Record<string, string> = {};
    for (const [field, value] of Object.entries(data)) {
      stringData[field] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    await this.client.hSet(key, stringData);
  }

  /**
   * Get a hash field.
   */
  async hGet<T = string>(key: string, field: string): Promise<T | null> {
    const value = await this.client.hGet(key, field);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  /**
   * Get all hash fields.
   */
  async hGetAll<T = Record<string, string>>(key: string): Promise<T> {
    const data = await this.client.hGetAll(key);
    const result: Record<string, any> = {};

    for (const [field, value] of Object.entries(data)) {
      try {
        result[field] = JSON.parse(value);
      } catch {
        result[field] = value;
      }
    }

    return result as T;
  }

  /**
   * Delete hash fields.
   */
  async hDel(key: string, ...fields: string[]): Promise<number> {
    return this.client.hDel(key, fields);
  }

  /**
   * Check if hash field exists.
   */
  async hExists(key: string, field: string): Promise<boolean> {
    return this.client.hExists(key, field);
  }

  /**
   * Increment a hash field value.
   */
  async hIncrBy(key: string, field: string, amount: number): Promise<number> {
    return this.client.hIncrBy(key, field, amount);
  }

  // ============================================================================
  // List Operations
  // ============================================================================

  /**
   * Push to the end of a list.
   */
  async rPush(key: string, ...values: any[]): Promise<number> {
    const stringValues = values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
    return this.client.rPush(key, stringValues);
  }

  /**
   * Push to the beginning of a list.
   */
  async lPush(key: string, ...values: any[]): Promise<number> {
    const stringValues = values.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
    return this.client.lPush(key, stringValues);
  }

  /**
   * Pop from the end of a list.
   */
  async rPop<T = string>(key: string): Promise<T | null> {
    const value = await this.client.rPop(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  /**
   * Pop from the beginning of a list.
   */
  async lPop<T = string>(key: string): Promise<T | null> {
    const value = await this.client.lPop(key);
    if (!value) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  /**
   * Get list range.
   */
  async lRange<T = string>(key: string, start: number, stop: number): Promise<T[]> {
    const values = await this.client.lRange(key, start, stop);
    return values.map((v) => {
      try {
        return JSON.parse(v) as T;
      } catch {
        return v as unknown as T;
      }
    });
  }

  /**
   * Get list length.
   */
  async lLen(key: string): Promise<number> {
    return this.client.lLen(key);
  }

  // ============================================================================
  // Set Operations
  // ============================================================================

  /**
   * Add to a set.
   */
  async sAdd(key: string, ...members: any[]): Promise<number> {
    const stringMembers = members.map((m) => (typeof m === 'string' ? m : JSON.stringify(m)));
    return this.client.sAdd(key, stringMembers);
  }

  /**
   * Remove from a set.
   */
  async sRem(key: string, ...members: any[]): Promise<number> {
    const stringMembers = members.map((m) => (typeof m === 'string' ? m : JSON.stringify(m)));
    return this.client.sRem(key, stringMembers);
  }

  /**
   * Check if member exists in set.
   */
  async sIsMember(key: string, member: any): Promise<boolean> {
    const stringMember = typeof member === 'string' ? member : JSON.stringify(member);
    return this.client.sIsMember(key, stringMember);
  }

  /**
   * Get all set members.
   */
  async sMembers<T = string>(key: string): Promise<T[]> {
    const members = await this.client.sMembers(key);
    return members.map((m) => {
      try {
        return JSON.parse(m) as T;
      } catch {
        return m as unknown as T;
      }
    });
  }

  /**
   * Get set size.
   */
  async sCard(key: string): Promise<number> {
    return this.client.sCard(key);
  }

  // ============================================================================
  // Sorted Set Operations
  // ============================================================================

  /**
   * Add to a sorted set.
   */
  async zAdd(key: string, score: number, member: any): Promise<number> {
    const stringMember = typeof member === 'string' ? member : JSON.stringify(member);
    return this.client.zAdd(key, { score, value: stringMember });
  }

  /**
   * Add multiple to a sorted set.
   */
  async zAddMultiple(key: string, items: { score: number; member: any }[]): Promise<number> {
    const members = items.map((item) => ({
      score: item.score,
      value: typeof item.member === 'string' ? item.member : JSON.stringify(item.member),
    }));
    return this.client.zAdd(key, members);
  }

  /**
   * Get sorted set range by score.
   */
  async zRangeByScore<T = string>(
    key: string,
    min: number | string,
    max: number | string,
    limit?: { offset: number; count: number }
  ): Promise<T[]> {
    const options = limit ? { LIMIT: limit } : undefined;
    const members = await this.client.zRangeByScore(key, min, max, options);
    return members.map((m) => {
      try {
        return JSON.parse(m) as T;
      } catch {
        return m as unknown as T;
      }
    });
  }

  /**
   * Remove from sorted set.
   */
  async zRem(key: string, ...members: any[]): Promise<number> {
    const stringMembers = members.map((m) => (typeof m === 'string' ? m : JSON.stringify(m)));
    return this.client.zRem(key, stringMembers);
  }

  /**
   * Get sorted set size.
   */
  async zCard(key: string): Promise<number> {
    return this.client.zCard(key);
  }

  // ============================================================================
  // Pub/Sub Operations
  // ============================================================================

  /**
   * Publish a message to a channel.
   */
  async publish(channel: string, message: any): Promise<number> {
    const stringMessage = typeof message === 'string' ? message : JSON.stringify(message);
    return this.publisher.publish(channel, stringMessage);
  }

  /**
   * Subscribe to a channel.
   */
  async subscribe(channel: string, callback: RedisSubscribeCallback): Promise<void> {
    const callbacks = this.subscriptions.get(channel) ?? [];
    callbacks.push(callback);
    this.subscriptions.set(channel, callbacks);

    if (callbacks.length === 1) {
      await this.subscriber.subscribe(channel, (message, ch) => {
        const cbs = this.subscriptions.get(ch) ?? [];
        cbs.forEach((cb) => cb(message, ch));
      });
      this.log.debug({ channel }, 'Subscribed to channel');
    }
  }

  /**
   * Unsubscribe from a channel.
   */
  async unsubscribe(channel: string, callback?: RedisSubscribeCallback): Promise<void> {
    if (callback) {
      const callbacks = this.subscriptions.get(channel) ?? [];
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
      if (callbacks.length === 0) {
        await this.subscriber.unsubscribe(channel);
        this.subscriptions.delete(channel);
      } else {
        this.subscriptions.set(channel, callbacks);
      }
    } else {
      await this.subscriber.unsubscribe(channel);
      this.subscriptions.delete(channel);
    }
    this.log.debug({ channel }, 'Unsubscribed from channel');
  }

  /**
   * Pattern subscribe.
   */
  async pSubscribe(pattern: string, callback: RedisSubscribeCallback): Promise<void> {
    await this.subscriber.pSubscribe(pattern, (message, channel) => {
      callback(message, channel);
    });
    this.log.debug({ pattern }, 'Pattern subscribed');
  }

  // ============================================================================
  // Utility Operations
  // ============================================================================

  /**
   * Health check.
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.client.ping();
      return {
        healthy: true,
        latencyMs: Date.now() - start,
      };
    } catch (error: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: error.message,
      };
    }
  }

  /**
   * Get Redis info.
   */
  async getInfo(): Promise<string> {
    return this.client.info();
  }

  /**
   * Flush all keys (use with caution!).
   */
  async flushAll(): Promise<void> {
    await this.client.flushAll();
    this.log.warn('Redis database flushed');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let instance: RedisService | null = null;

export function getRedisService(config?: RedisConfig): RedisService {
  if (!instance) {
    instance = new RedisService(config);
  }
  return instance;
}

export function resetRedisService(): void {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}
