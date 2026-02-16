/**
 * Game On Dude! - Database Service
 * www.gameonguy.com
 *
 * PostgreSQL connection management with pooling and transactions.
 */

import { Pool, PoolClient, PoolConfig, QueryResult } from 'pg';
import logger from '../core/Logger';

export interface DatabaseConfig extends PoolConfig {
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface TransactionCallback<T> {
  (client: PoolClient): Promise<T>;
}

export class DatabaseService {
  private pool: Pool;
  private readonly log = logger.child({ component: 'DatabaseService' });
  private isConnected = false;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(config?: DatabaseConfig) {
    const poolConfig: PoolConfig = {
      host: config?.host ?? process.env.DB_HOST ?? 'localhost',
      port: config?.port ?? parseInt(process.env.DB_PORT ?? '5432'),
      database: config?.database ?? process.env.DB_NAME ?? 'xogos',
      user: config?.user ?? process.env.DB_USER ?? 'xogos',
      password: config?.password ?? process.env.DB_PASSWORD ?? 'xogos',
      max: config?.max ?? 20,
      idleTimeoutMillis: config?.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: config?.connectionTimeoutMillis ?? 5000,
      ...config,
    };

    this.maxRetries = config?.maxRetries ?? 3;
    this.retryDelayMs = config?.retryDelayMs ?? 1000;

    this.pool = new Pool(poolConfig);

    // Handle pool errors
    this.pool.on('error', (err) => {
      this.log.error({ error: err }, 'Unexpected database pool error');
    });

    this.pool.on('connect', () => {
      this.log.debug('New database connection established');
    });

    this.log.info(
      { host: poolConfig.host, database: poolConfig.database, maxConnections: poolConfig.max },
      'Database service initialized'
    );
  }

  /**
   * Connect to the database and verify connection.
   */
  async connect(): Promise<void> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const client = await this.pool.connect();
        await client.query('SELECT 1');
        client.release();
        this.isConnected = true;
        this.log.info('Database connection verified');
        return;
      } catch (error) {
        this.log.warn({ attempt, error }, 'Database connection attempt failed');
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs * attempt);
        } else {
          throw new Error(`Failed to connect to database after ${this.maxRetries} attempts`);
        }
      }
    }
  }

  /**
   * Execute a query with parameters.
   */
  async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;

      this.log.debug({ query: text.substring(0, 100), duration, rows: result.rowCount }, 'Query executed');

      return result.rows as T[];
    } catch (error) {
      this.log.error({ query: text.substring(0, 100), error }, 'Query failed');
      throw error;
    }
  }

  /**
   * Execute a query and return a single row.
   */
  async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /**
   * Execute a query and return the count of affected rows.
   */
  async execute(text: string, params?: any[]): Promise<number> {
    const start = Date.now();
    try {
      const result = await this.pool.query(text, params);
      const duration = Date.now() - start;

      this.log.debug({ query: text.substring(0, 100), duration, affected: result.rowCount }, 'Statement executed');

      return result.rowCount ?? 0;
    } catch (error) {
      this.log.error({ query: text.substring(0, 100), error }, 'Statement failed');
      throw error;
    }
  }

  /**
   * Execute multiple queries within a transaction.
   */
  async transaction<T>(callback: TransactionCallback<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      this.log.error({ error }, 'Transaction rolled back');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get the connection pool for direct access.
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * Check if database is connected.
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get pool statistics.
   */
  getStats(): {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  } {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Close all database connections.
   */
  async close(): Promise<void> {
    await this.pool.end();
    this.isConnected = false;
    this.log.info('Database connections closed');
  }

  /**
   * Health check - verify database is responsive.
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.query('SELECT 1');
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

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let instance: DatabaseService | null = null;

export function getDatabaseService(config?: DatabaseConfig): DatabaseService {
  if (!instance) {
    instance = new DatabaseService(config);
  }
  return instance;
}

export function resetDatabaseService(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
