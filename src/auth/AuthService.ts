/**
 * Game On Dude! - Authentication Service
 * www.gameonguy.com
 *
 * Handles JWT authentication and guest sessions.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { AuthPayload, JWTPayload, UserSession } from '../core/types';
import logger from '../core/Logger';

interface AuthResult {
  success: boolean;
  userId?: string;
  username?: string;
  error?: string;
}

/** Known placeholder secrets that must never be used in production. */
const PLACEHOLDER_SECRETS = new Set([
  'gameondude-dev-secret-change-in-production',
  'your-super-secret-jwt-key-change-in-production',
  'your-secret-here',
  'gameondude-dev-secret-change-me',
]);

const MAX_GUEST_ID_LENGTH = 64;
const MAX_USERNAME_LENGTH = 32;

export class AuthService {
  private readonly jwtSecret: string;
  private readonly jwtExpiry: string;
  private sessions: Map<string, UserSession> = new Map();

  private readonly log = logger.child({ component: 'AuthService' });

  constructor() {
    const secret = process.env.JWT_SECRET;

    // Security: in production, never run with a missing or placeholder secret —
    // anyone who reads this source could forge admin/user tokens.
    if (process.env.NODE_ENV === 'production') {
      if (!secret || PLACEHOLDER_SECRETS.has(secret)) {
        throw new Error(
          'JWT_SECRET must be set to a strong, unique value in production. ' +
            'Generate one with: openssl rand -base64 48'
        );
      }
      if (secret.length < 32) {
        this.log.warn(
          { length: secret.length },
          'JWT_SECRET is shorter than 32 characters — consider rotating to a longer random value'
        );
      }
    }

    this.jwtSecret = secret || 'gameondude-dev-secret-change-in-production';
    this.jwtExpiry = process.env.JWT_EXPIRY || '7d';
  }

  /**
   * Authenticate a client with token or as guest.
   */
  public async authenticate(payload: AuthPayload): Promise<AuthResult> {
    // JWT Token authentication
    if (payload.token) {
      return this.authenticateWithToken(payload.token);
    }

    // Guest authentication
    if (payload.guestId || payload.username) {
      return this.authenticateAsGuest(payload.username, payload.guestId);
    }

    return {
      success: false,
      error: 'No authentication method provided',
    };
  }

  /**
   * Authenticate with JWT token.
   */
  private authenticateWithToken(token: string): AuthResult {
    try {
      const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload;

      return {
        success: true,
        userId: decoded.userId,
        username: decoded.username,
      };
    } catch (error: any) {
      this.log.warn({ error: error.message }, 'Token authentication failed');

      if (error.name === 'TokenExpiredError') {
        return { success: false, error: 'Token expired' };
      }

      return { success: false, error: 'Invalid token' };
    }
  }

  /**
   * Authenticate as a guest user.
   *
   * Security: the client-supplied guestId is sanitized and always given a
   * `guest_` prefix so a guest can never claim the userId of a registered
   * (JWT-authenticated) user. Usernames are stripped of control characters
   * and length-capped.
   */
  private authenticateAsGuest(username?: string, guestId?: string): AuthResult {
    let finalGuestId: string;
    if (guestId) {
      // Keep only safe identifier characters, cap length, force guest_ prefix
      const cleaned = guestId.replace(/[^\w.-]/g, '').slice(0, MAX_GUEST_ID_LENGTH);
      finalGuestId =
        cleaned && cleaned !== 'guest_'
          ? cleaned.startsWith('guest_')
            ? cleaned
            : `guest_${cleaned}`
          : `guest_${uuidv4()}`;
    } else {
      finalGuestId = `guest_${uuidv4()}`;
    }

    const cleanedUsername = (username ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, MAX_USERNAME_LENGTH);
    const finalUsername = cleanedUsername || `Guest_${finalGuestId.slice(-6)}`;

    this.log.info({ guestId: finalGuestId, username: finalUsername }, 'Guest authenticated');

    return {
      success: true,
      userId: finalGuestId,
      username: finalUsername,
    };
  }

  /**
   * Generate a JWT token for a user.
   */
  public generateToken(userId: string, username: string, email?: string): string {
    const payload: Omit<JWTPayload, 'iat' | 'exp'> = {
      userId,
      username,
      email,
    };

    return jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiry as jwt.SignOptions['expiresIn'],
    });
  }

  /**
   * Verify a JWT token.
   */
  public verifyToken(token: string): JWTPayload | null {
    try {
      return jwt.verify(token, this.jwtSecret) as JWTPayload;
    } catch {
      return null;
    }
  }

  /**
   * Hash a password.
   */
  public async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  /**
   * Verify a password against a hash.
   */
  public async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Create a session for a user.
   */
  public createSession(userId: string, username: string, isGuest: boolean = false): UserSession {
    const session: UserSession = {
      sessionId: uuidv4(),
      userId,
      username,
      isGuest,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      metadata: {},
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  /**
   * Get a session by ID.
   */
  public getSession(sessionId: string): UserSession | undefined {
    const session = this.sessions.get(sessionId);

    if (session && session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    return session;
  }

  /**
   * Invalidate a session.
   */
  public invalidateSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Clean up expired sessions.
   */
  public cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    this.sessions.forEach((session, id) => {
      if (session.expiresAt < now) {
        this.sessions.delete(id);
        cleaned++;
      }
    });

    if (cleaned > 0) {
      this.log.info({ cleaned }, 'Cleaned up expired sessions');
    }

    return cleaned;
  }
}
