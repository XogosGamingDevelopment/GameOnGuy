/**
 * AuthService tests — guest ID normalization, username sanitization,
 * JWT round-trip, and production secret enforcement (Phase 13 hardening).
 */

import { AuthService } from '../../src/auth/AuthService';

// Control characters built programmatically (NUL, TAB, US, DEL)
const CTRL = String.fromCharCode(0, 9, 31, 127);

const hasControlChars = (s: string): boolean =>
  [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

describe('AuthService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('guest authentication', () => {
    it('prefixes client-supplied guest ids with guest_', async () => {
      const auth = new AuthService();
      const result = await auth.authenticate({ username: 'Player1', guestId: 'web-123' });

      expect(result.success).toBe(true);
      expect(result.userId).toBe('guest_web-123');
      expect(result.username).toBe('Player1');
    });

    it('does not double-prefix ids that already start with guest_', async () => {
      const auth = new AuthService();
      const result = await auth.authenticate({ guestId: 'guest_abc123' });

      expect(result.success).toBe(true);
      expect(result.userId).toBe('guest_abc123');
    });

    it('generates a guest id when none is supplied', async () => {
      const auth = new AuthService();
      const result = await auth.authenticate({ username: 'NoIdPlayer' });

      expect(result.success).toBe(true);
      expect(result.userId).toMatch(/^guest_/);
    });

    it('strips unsafe characters from guest ids and caps length', async () => {
      const auth = new AuthService();
      const result = await auth.authenticate({
        guestId: '../../etc/passwd<script>' + 'x'.repeat(200),
      });

      expect(result.success).toBe(true);
      expect(result.userId).toMatch(/^guest_[\w.-]+$/);
      expect(result.userId!.length).toBeLessThanOrEqual('guest_'.length + 64);
    });

    it('falls back to a generated id when the guest id sanitizes to nothing', async () => {
      const auth = new AuthService();
      const result = await auth.authenticate({ guestId: '!!!###' });

      expect(result.success).toBe(true);
      expect(result.userId).toMatch(/^guest_/);
      expect(result.userId!.length).toBeGreaterThan('guest_'.length);
    });

    it('strips control characters from usernames and caps length', async () => {
      const auth = new AuthService();
      const result = await auth.authenticate({
        username: 'Bad' + CTRL + 'Name' + 'y'.repeat(100),
        guestId: 'g1',
      });

      expect(result.success).toBe(true);
      expect(hasControlChars(result.username!)).toBe(false);
      expect(result.username).toMatch(/^BadName/);
      expect(result.username!.length).toBeLessThanOrEqual(32);
    });

    it('keeps spaces and dashes in usernames', async () => {
      const auth = new AuthService();
      const result = await auth.authenticate({ username: 'Cool Player-1', guestId: 'g2' });

      expect(result.username).toBe('Cool Player-1');
    });

    it('rejects auth with no method provided', async () => {
      const auth = new AuthService();
      const result = await auth.authenticate({});

      expect(result.success).toBe(false);
    });
  });

  describe('JWT authentication', () => {
    it('round-trips a generated token', async () => {
      const auth = new AuthService();
      const token = auth.generateToken('user-42', 'RegisteredUser');
      const result = await auth.authenticate({ token });

      expect(result.success).toBe(true);
      expect(result.userId).toBe('user-42');
      expect(result.username).toBe('RegisteredUser');
    });

    it('rejects an invalid token', async () => {
      const auth = new AuthService();
      const result = await auth.authenticate({ token: 'not-a-real-token' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid token');
    });
  });

  describe('production secret enforcement', () => {
    it('throws in production when JWT_SECRET is missing', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;

      expect(() => new AuthService()).toThrow(/JWT_SECRET/);
    });

    it('throws in production when JWT_SECRET is a known placeholder', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'gameondude-dev-secret-change-in-production';

      expect(() => new AuthService()).toThrow(/JWT_SECRET/);
    });

    it('accepts a real secret in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a-genuinely-long-random-secret-value-1234567890';

      expect(() => new AuthService()).not.toThrow();
    });

    it('allows the dev fallback outside production', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_SECRET;

      expect(() => new AuthService()).not.toThrow();
    });
  });
});
