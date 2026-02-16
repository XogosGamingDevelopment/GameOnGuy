/**
 * Game On Dude! - Match Repository
 * www.gameonguy.com
 *
 * Database operations for match history and statistics.
 */

import { PoolClient } from 'pg';
import { DatabaseService } from '../DatabaseService';
import logger from '../../core/Logger';

export interface Match {
  id: string;
  room_code: string;
  game_type: string;
  game_mode: string | null;
  started_at: Date;
  ended_at: Date | null;
  duration_seconds: number | null;
  player_count: number | null;
  winner_id: string | null;
  metadata: Record<string, unknown> | null;
}

export interface MatchParticipant {
  id: string;
  match_id: string;
  user_id: string | null;
  username: string;
  score: number;
  placement: number | null;
  is_winner: boolean;
  stats: Record<string, unknown> | null;
  joined_at: Date;
  left_at: Date | null;
}

export interface CreateMatchDTO {
  room_code: string;
  game_type: string;
  game_mode?: string;
  player_count?: number;
  metadata?: Record<string, unknown>;
}

export interface MatchResultsDTO {
  winner_id?: string;
  duration_seconds: number;
  participants: ParticipantResultDTO[];
  metadata?: Record<string, unknown>;
}

export interface ParticipantResultDTO {
  user_id?: string;
  username: string;
  score: number;
  placement: number;
  is_winner: boolean;
  stats?: Record<string, unknown>;
}

export interface MatchWithParticipants extends Match {
  participants: MatchParticipant[];
}

export class MatchRepository {
  private readonly log = logger.child({ component: 'MatchRepository' });

  constructor(private db: DatabaseService) {}

  /**
   * Create a new match record.
   */
  async create(data: CreateMatchDTO): Promise<Match> {
    const query = `
      INSERT INTO matches (room_code, game_type, game_mode, player_count, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const result = await this.db.query<Match>(query, [
      data.room_code,
      data.game_type,
      data.game_mode ?? null,
      data.player_count ?? null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    ]);

    this.log.info({ matchId: result[0].id, gameType: data.game_type }, 'Match created');
    return result[0];
  }

  /**
   * Complete a match with results.
   */
  async complete(matchId: string, results: MatchResultsDTO): Promise<Match> {
    return this.db.transaction(async (client) => {
      // Update match
      const matchQuery = `
        UPDATE matches SET
          ended_at = CURRENT_TIMESTAMP,
          duration_seconds = $1,
          winner_id = $2,
          metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
        WHERE id = $4
        RETURNING *
      `;

      const matchResult = await client.query<Match>(matchQuery, [
        results.duration_seconds,
        results.winner_id ?? null,
        results.metadata ? JSON.stringify(results.metadata) : '{}',
        matchId,
      ]);

      // Insert participants
      for (const participant of results.participants) {
        await this.addParticipantInternal(client, matchId, participant);
      }

      this.log.info({ matchId, participants: results.participants.length }, 'Match completed');
      return matchResult.rows[0];
    });
  }

  /**
   * Add a participant to a match.
   */
  async addParticipant(matchId: string, participant: ParticipantResultDTO): Promise<MatchParticipant> {
    const query = `
      INSERT INTO match_participants (match_id, user_id, username, score, placement, is_winner, stats)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await this.db.query<MatchParticipant>(query, [
      matchId,
      participant.user_id ?? null,
      participant.username,
      participant.score,
      participant.placement,
      participant.is_winner,
      participant.stats ? JSON.stringify(participant.stats) : null,
    ]);

    return result[0];
  }

  private async addParticipantInternal(
    client: PoolClient,
    matchId: string,
    participant: ParticipantResultDTO
  ): Promise<void> {
    const query = `
      INSERT INTO match_participants (match_id, user_id, username, score, placement, is_winner, stats)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;

    await client.query(query, [
      matchId,
      participant.user_id ?? null,
      participant.username,
      participant.score,
      participant.placement,
      participant.is_winner,
      participant.stats ? JSON.stringify(participant.stats) : null,
    ]);
  }

  /**
   * Find match by ID.
   */
  async findById(id: string): Promise<Match | null> {
    return this.db.queryOne<Match>('SELECT * FROM matches WHERE id = $1', [id]);
  }

  /**
   * Find match with participants.
   */
  async findByIdWithParticipants(id: string): Promise<MatchWithParticipants | null> {
    const match = await this.findById(id);
    if (!match) return null;

    const participants = await this.db.query<MatchParticipant>(
      'SELECT * FROM match_participants WHERE match_id = $1 ORDER BY placement ASC NULLS LAST',
      [id]
    );

    return { ...match, participants };
  }

  /**
   * Get matches for a user.
   */
  async getByUser(userId: string, limit: number = 50, offset: number = 0): Promise<MatchWithParticipants[]> {
    const query = `
      SELECT DISTINCT m.*
      FROM matches m
      JOIN match_participants mp ON m.id = mp.match_id
      WHERE mp.user_id = $1
      ORDER BY m.started_at DESC
      LIMIT $2 OFFSET $3
    `;

    const matches = await this.db.query<Match>(query, [userId, limit, offset]);

    // Fetch participants for each match
    const results: MatchWithParticipants[] = [];
    for (const match of matches) {
      const participants = await this.db.query<MatchParticipant>(
        'SELECT * FROM match_participants WHERE match_id = $1 ORDER BY placement ASC NULLS LAST',
        [match.id]
      );
      results.push({ ...match, participants });
    }

    return results;
  }

  /**
   * Get recent matches.
   */
  async getRecent(gameType?: string, limit: number = 20): Promise<Match[]> {
    if (gameType) {
      return this.db.query<Match>(
        'SELECT * FROM matches WHERE game_type = $1 ORDER BY started_at DESC LIMIT $2',
        [gameType, limit]
      );
    }
    return this.db.query<Match>('SELECT * FROM matches ORDER BY started_at DESC LIMIT $1', [limit]);
  }

  /**
   * Get match statistics for a user.
   */
  async getUserStats(userId: string, gameType?: string): Promise<{
    total_matches: number;
    wins: number;
    losses: number;
    win_rate: number;
    avg_score: number;
    avg_placement: number;
  }> {
    let query = `
      SELECT
        COUNT(*)::INTEGER as total_matches,
        SUM(CASE WHEN mp.is_winner THEN 1 ELSE 0 END)::INTEGER as wins,
        SUM(CASE WHEN NOT mp.is_winner THEN 1 ELSE 0 END)::INTEGER as losses,
        CASE WHEN COUNT(*) > 0
             THEN ROUND((SUM(CASE WHEN mp.is_winner THEN 1 ELSE 0 END)::NUMERIC / COUNT(*)) * 100, 2)
             ELSE 0
        END as win_rate,
        ROUND(AVG(mp.score)::NUMERIC, 2) as avg_score,
        ROUND(AVG(mp.placement)::NUMERIC, 2) as avg_placement
      FROM match_participants mp
      JOIN matches m ON mp.match_id = m.id
      WHERE mp.user_id = $1
    `;
    const params: any[] = [userId];

    if (gameType) {
      query += ' AND m.game_type = $2';
      params.push(gameType);
    }

    const result = await this.db.queryOne<{
      total_matches: number;
      wins: number;
      losses: number;
      win_rate: number;
      avg_score: number;
      avg_placement: number;
    }>(query, params);

    return result ?? {
      total_matches: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      avg_score: 0,
      avg_placement: 0,
    };
  }

  /**
   * Get daily match statistics.
   */
  async getDailyStats(days: number = 30): Promise<{
    date: string;
    total_matches: number;
    unique_players: number;
  }[]> {
    const query = `
      SELECT
        DATE(m.started_at) as date,
        COUNT(DISTINCT m.id)::INTEGER as total_matches,
        COUNT(DISTINCT mp.user_id)::INTEGER as unique_players
      FROM matches m
      JOIN match_participants mp ON m.id = mp.match_id
      WHERE m.started_at >= CURRENT_DATE - INTERVAL '${days} days'
      GROUP BY DATE(m.started_at)
      ORDER BY date DESC
    `;
    return this.db.query(query, []);
  }

  /**
   * Count total matches.
   */
  async count(gameType?: string): Promise<number> {
    if (gameType) {
      const result = await this.db.queryOne<{ count: string }>(
        'SELECT COUNT(*) FROM matches WHERE game_type = $1',
        [gameType]
      );
      return parseInt(result?.count ?? '0');
    }
    const result = await this.db.queryOne<{ count: string }>('SELECT COUNT(*) FROM matches');
    return parseInt(result?.count ?? '0');
  }

  /**
   * Delete old matches (for cleanup).
   */
  async deleteOlderThan(days: number): Promise<number> {
    const result = await this.db.execute(
      `DELETE FROM matches WHERE started_at < CURRENT_TIMESTAMP - INTERVAL '${days} days'`,
      []
    );
    this.log.info({ deleted: result }, 'Old matches deleted');
    return result;
  }
}
