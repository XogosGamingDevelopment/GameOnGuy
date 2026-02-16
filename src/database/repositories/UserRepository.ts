/**
 * Game On Dude! - User Repository
 * www.gameonguy.com
 *
 * Database operations for user management.
 */

import { DatabaseService } from '../DatabaseService';
import logger from '../../core/Logger';

export interface User {
  id: string;
  username: string;
  email: string | null;
  password_hash: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_guest: boolean;
  skill_rating: number;
  total_games_played: number;
  total_wins: number;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

export interface CreateUserDTO {
  username: string;
  email?: string;
  password?: string;
  display_name?: string;
  avatar_url?: string;
  is_guest?: boolean;
}

export interface UpdateUserDTO {
  display_name?: string;
  avatar_url?: string;
  email?: string;
}

export interface UserStats {
  skill_rating?: number;
  total_games_played?: number;
  total_wins?: number;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  skill_rating: number;
  total_games_played: number;
  total_wins: number;
  win_rate: number;
  global_rank: number;
}

export class UserRepository {
  private readonly log = logger.child({ component: 'UserRepository' });

  constructor(private db: DatabaseService) {}

  /**
   * Find user by ID.
   */
  async findById(id: string): Promise<User | null> {
    return this.db.queryOne<User>('SELECT * FROM users WHERE id = $1', [id]);
  }

  /**
   * Find user by username.
   */
  async findByUsername(username: string): Promise<User | null> {
    return this.db.queryOne<User>('SELECT * FROM users WHERE username = $1', [username]);
  }

  /**
   * Find user by email.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.db.queryOne<User>('SELECT * FROM users WHERE email = $1', [email]);
  }

  /**
   * Create a new user.
   */
  async create(data: CreateUserDTO): Promise<User> {
    const query = `
      INSERT INTO users (username, email, password_hash, display_name, avatar_url, is_guest)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const result = await this.db.query<User>(query, [
      data.username,
      data.email ?? null,
      data.password ?? null,
      data.display_name ?? data.username,
      data.avatar_url ?? null,
      data.is_guest ?? false,
    ]);

    this.log.info({ userId: result[0].id, username: data.username }, 'User created');
    return result[0];
  }

  /**
   * Update user profile.
   */
  async update(id: string, data: UpdateUserDTO): Promise<User | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.display_name !== undefined) {
      fields.push(`display_name = $${paramIndex++}`);
      values.push(data.display_name);
    }
    if (data.avatar_url !== undefined) {
      fields.push(`avatar_url = $${paramIndex++}`);
      values.push(data.avatar_url);
    }
    if (data.email !== undefined) {
      fields.push(`email = $${paramIndex++}`);
      values.push(data.email);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const query = `
      UPDATE users SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.db.query<User>(query, values);
    return result[0] ?? null;
  }

  /**
   * Update user stats after a game.
   */
  async updateStats(id: string, stats: UserStats): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (stats.skill_rating !== undefined) {
      fields.push(`skill_rating = $${paramIndex++}`);
      values.push(stats.skill_rating);
    }
    if (stats.total_games_played !== undefined) {
      fields.push(`total_games_played = total_games_played + $${paramIndex++}`);
      values.push(stats.total_games_played);
    }
    if (stats.total_wins !== undefined) {
      fields.push(`total_wins = total_wins + $${paramIndex++}`);
      values.push(stats.total_wins);
    }

    if (fields.length === 0) return;

    values.push(id);
    const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex}`;
    await this.db.execute(query, values);
  }

  /**
   * Record a game result for a user.
   */
  async recordGameResult(userId: string, isWin: boolean, skillDelta: number = 0): Promise<void> {
    const query = `
      UPDATE users SET
        total_games_played = total_games_played + 1,
        total_wins = total_wins + $1,
        skill_rating = GREATEST(0, skill_rating + $2)
      WHERE id = $3
    `;
    await this.db.execute(query, [isWin ? 1 : 0, skillDelta, userId]);
  }

  /**
   * Update last login timestamp.
   */
  async updateLastLogin(id: string): Promise<void> {
    await this.db.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1', [id]);
  }

  /**
   * Get global leaderboard.
   */
  async getLeaderboard(limit: number = 100, offset: number = 0): Promise<LeaderboardEntry[]> {
    const query = `
      SELECT
        id, username, display_name, avatar_url, skill_rating,
        total_games_played, total_wins,
        CASE WHEN total_games_played > 0
             THEN ROUND((total_wins::NUMERIC / total_games_played) * 100, 2)
             ELSE 0
        END as win_rate,
        RANK() OVER (ORDER BY skill_rating DESC) as global_rank
      FROM users
      WHERE is_guest = FALSE AND total_games_played > 0
      ORDER BY skill_rating DESC
      LIMIT $1 OFFSET $2
    `;
    return this.db.query<LeaderboardEntry>(query, [limit, offset]);
  }

  /**
   * Get leaderboard by game type.
   */
  async getLeaderboardByGameType(
    gameType: string,
    limit: number = 100,
    offset: number = 0
  ): Promise<LeaderboardEntry[]> {
    const query = `
      WITH player_stats AS (
        SELECT
          mp.user_id,
          COUNT(*) as games_played,
          SUM(CASE WHEN mp.is_winner THEN 1 ELSE 0 END) as wins,
          SUM(mp.score) as total_score
        FROM match_participants mp
        JOIN matches m ON mp.match_id = m.id
        WHERE m.game_type = $1
        GROUP BY mp.user_id
      )
      SELECT
        u.id, u.username, u.display_name, u.avatar_url, u.skill_rating,
        COALESCE(ps.games_played, 0)::INTEGER as total_games_played,
        COALESCE(ps.wins, 0)::INTEGER as total_wins,
        CASE WHEN ps.games_played > 0
             THEN ROUND((ps.wins::NUMERIC / ps.games_played) * 100, 2)
             ELSE 0
        END as win_rate,
        RANK() OVER (ORDER BY ps.total_score DESC NULLS LAST) as global_rank
      FROM users u
      LEFT JOIN player_stats ps ON u.id = ps.user_id
      WHERE u.is_guest = FALSE AND ps.games_played > 0
      ORDER BY ps.total_score DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `;
    return this.db.query<LeaderboardEntry>(query, [gameType, limit, offset]);
  }

  /**
   * Search users by username.
   */
  async search(query: string, limit: number = 20): Promise<User[]> {
    const sql = `
      SELECT * FROM users
      WHERE username ILIKE $1 OR display_name ILIKE $1
      LIMIT $2
    `;
    return this.db.query<User>(sql, [`%${query}%`, limit]);
  }

  /**
   * Delete a user (for GDPR compliance).
   */
  async delete(id: string): Promise<boolean> {
    const affected = await this.db.execute('DELETE FROM users WHERE id = $1', [id]);
    return affected > 0;
  }

  /**
   * Count total users.
   */
  async count(): Promise<number> {
    const result = await this.db.queryOne<{ count: string }>('SELECT COUNT(*) FROM users');
    return parseInt(result?.count ?? '0');
  }

  /**
   * Get user's rank.
   */
  async getUserRank(userId: string): Promise<number | null> {
    const query = `
      SELECT global_rank FROM (
        SELECT id, RANK() OVER (ORDER BY skill_rating DESC) as global_rank
        FROM users WHERE is_guest = FALSE
      ) ranked
      WHERE id = $1
    `;
    const result = await this.db.queryOne<{ global_rank: string }>(query, [userId]);
    return result ? parseInt(result.global_rank) : null;
  }
}
