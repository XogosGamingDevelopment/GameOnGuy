/**
 * Game On Dude! - Redis Session Store
 * www.gameonguy.com
 *
 * Session management using Redis for horizontal scaling.
 */

import { RedisService } from './RedisService';
import { UserSession } from '../core/types';
import logger from '../core/Logger';

export interface SessionData extends UserSession {
  ip?: string;
  userAgent?: string;
  lastActivity: number;
}

export interface SessionStoreConfig {
  keyPrefix?: string;
  sessionTTL?: number; // seconds
  cleanupInterval?: number; // seconds
}

export class SessionStore {
  private readonly keyPrefix: string;
  private readonly sessionTTL: number;
  private cleanupTimer?: NodeJS.Timeout;
  private readonly log = logger.child({ component: 'SessionStore' });

  constructor(
    private redis: RedisService,
    config: SessionStoreConfig = {}
  ) {
    this.keyPrefix = config.keyPrefix ?? 'session:';
    this.sessionTTL = config.sessionTTL ?? 24 * 60 * 60; // 24 hours

    if (config.cleanupInterval) {
      this.startCleanupInterval(config.cleanupInterval);
    }
  }

  /**
   * Create a new session.
   */
  async create(session: UserSession, metadata?: { ip?: string; userAgent?: string }): Promise<void> {
    const sessionData: SessionData = {
      ...session,
      ip: metadata?.ip,
      userAgent: metadata?.userAgent,
      lastActivity: Date.now(),
    };

    // Store session
    await this.redis.set(
      this.getSessionKey(session.sessionId),
      sessionData,
      this.sessionTTL
    );

    // Add to user's session set
    if (session.userId) {
      await this.redis.sAdd(this.getUserSessionsKey(session.userId), session.sessionId);
    }

    this.log.debug({ sessionId: session.sessionId, userId: session.userId }, 'Session created');
  }

  /**
   * Get a session by ID.
   */
  async get(sessionId: string): Promise<SessionData | null> {
    const session = await this.redis.get<SessionData>(this.getSessionKey(sessionId));

    if (session && session.expiresAt < Date.now()) {
      await this.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Update session data.
   */
  async update(sessionId: string, data: Partial<SessionData>): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) return false;

    const updated: SessionData = {
      ...session,
      ...data,
      lastActivity: Date.now(),
    };

    await this.redis.set(this.getSessionKey(sessionId), updated, this.sessionTTL);
    return true;
  }

  /**
   * Touch session (update last activity).
   */
  async touch(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (!session) return false;

    session.lastActivity = Date.now();
    await this.redis.set(this.getSessionKey(sessionId), session, this.sessionTTL);
    await this.redis.expire(this.getSessionKey(sessionId), this.sessionTTL);

    return true;
  }

  /**
   * Delete a session.
   */
  async delete(sessionId: string): Promise<boolean> {
    const session = await this.get(sessionId);
    if (session && session.userId) {
      await this.redis.sRem(this.getUserSessionsKey(session.userId), sessionId);
    }

    const deleted = await this.redis.del(this.getSessionKey(sessionId));
    if (deleted) {
      this.log.debug({ sessionId }, 'Session deleted');
    }
    return deleted;
  }

  /**
   * Get all sessions for a user.
   */
  async getUserSessions(userId: string): Promise<SessionData[]> {
    const sessionIds = await this.redis.sMembers<string>(this.getUserSessionsKey(userId));
    const sessions: SessionData[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.get(sessionId);
      if (session) {
        sessions.push(session);
      } else {
        // Clean up stale reference
        await this.redis.sRem(this.getUserSessionsKey(userId), sessionId);
      }
    }

    return sessions;
  }

  /**
   * Delete all sessions for a user.
   */
  async deleteUserSessions(userId: string): Promise<number> {
    const sessionIds = await this.redis.sMembers<string>(this.getUserSessionsKey(userId));
    let deleted = 0;

    for (const sessionId of sessionIds) {
      if (await this.redis.del(this.getSessionKey(sessionId))) {
        deleted++;
      }
    }

    await this.redis.del(this.getUserSessionsKey(userId));
    this.log.info({ userId, deleted }, 'User sessions deleted');
    return deleted;
  }

  /**
   * Check if session exists.
   */
  async exists(sessionId: string): Promise<boolean> {
    return this.redis.exists(this.getSessionKey(sessionId));
  }

  /**
   * Get session count for a user.
   */
  async getUserSessionCount(userId: string): Promise<number> {
    return this.redis.sCard(this.getUserSessionsKey(userId));
  }

  /**
   * Get total session count.
   */
  async getTotalSessionCount(): Promise<number> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    // Exclude user session set keys
    return keys.filter((k) => !k.includes(':user:')).length;
  }

  /**
   * Clean up expired sessions.
   */
  async cleanup(): Promise<number> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`);
    let cleaned = 0;

    for (const key of keys) {
      if (key.includes(':user:')) continue;

      const session = await this.redis.get<SessionData>(key);
      if (session && session.sessionId && session.expiresAt < Date.now()) {
        await this.delete(session.sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.log.info({ cleaned }, 'Expired sessions cleaned up');
    }

    return cleaned;
  }

  /**
   * Start periodic cleanup.
   */
  private startCleanupInterval(intervalSeconds: number): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((error) => {
        this.log.error({ error }, 'Session cleanup failed');
      });
    }, intervalSeconds * 1000);

    this.log.info({ intervalSeconds }, 'Session cleanup interval started');
  }

  /**
   * Stop periodic cleanup.
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private getSessionKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  private getUserSessionsKey(userId: string): string {
    return `${this.keyPrefix}user:${userId}`;
  }
}
