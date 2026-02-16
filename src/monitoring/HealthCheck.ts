/**
 * Game On Dude! - Health Check Service
 * www.gameonguy.com
 *
 * Comprehensive health checking for all server dependencies.
 */

import { DatabaseService } from '../database';
import { RedisService } from '../cache';
import logger from '../core/Logger';

// ============================================================================
// Types
// ============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  lastCheck: number;
}

export interface HealthReport {
  status: HealthStatus;
  timestamp: number;
  uptime: number;
  version: string;
  checks: {
    server: ComponentHealth;
    database?: ComponentHealth;
    redis?: ComponentHealth;
    memory: ComponentHealth;
    cpu: ComponentHealth;
  };
  details: {
    connections: number;
    rooms: number;
    matchmakingQueue: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
  };
}

export interface HealthCheckConfig {
  memoryWarningThreshold?: number; // Percentage
  memoryCriticalThreshold?: number;
  cpuWarningThreshold?: number;
  cpuCriticalThreshold?: number;
  checkInterval?: number; // Milliseconds
}

// ============================================================================
// Health Check Service
// ============================================================================

export class HealthCheckService {
  private lastCpuUsage: NodeJS.CpuUsage;
  private lastCpuCheck: number;
  private readonly config: Required<HealthCheckConfig>;
  private readonly log = logger.child({ component: 'HealthCheck' });

  private database?: DatabaseService;
  private redis?: RedisService;

  // Callback to get current stats from server
  private getStats?: () => { connections: number; rooms: number; matchmakingQueue: number };

  constructor(config: HealthCheckConfig = {}) {
    this.config = {
      memoryWarningThreshold: config.memoryWarningThreshold ?? 70,
      memoryCriticalThreshold: config.memoryCriticalThreshold ?? 90,
      cpuWarningThreshold: config.cpuWarningThreshold ?? 70,
      cpuCriticalThreshold: config.cpuCriticalThreshold ?? 90,
      checkInterval: config.checkInterval ?? 30000,
    };

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuCheck = Date.now();
  }

  /**
   * Set dependencies for health checking.
   */
  setDependencies(options: {
    database?: DatabaseService;
    redis?: RedisService;
    getStats?: () => { connections: number; rooms: number; matchmakingQueue: number };
  }): void {
    this.database = options.database;
    this.redis = options.redis;
    this.getStats = options.getStats;
  }

  /**
   * Get full health report.
   */
  async getHealth(): Promise<HealthReport> {
    const checks = await this.runAllChecks();
    const overallStatus = this.determineOverallStatus(checks);

    const stats = this.getStats?.() ?? { connections: 0, rooms: 0, matchmakingQueue: 0 };

    return {
      status: overallStatus,
      timestamp: Date.now(),
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? '1.0.0',
      checks,
      details: {
        ...stats,
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
      },
    };
  }

  /**
   * Quick liveness check (is server responding?).
   */
  async getLiveness(): Promise<{ alive: boolean; timestamp: number }> {
    return {
      alive: true,
      timestamp: Date.now(),
    };
  }

  /**
   * Readiness check (is server ready to accept traffic?).
   */
  async getReadiness(): Promise<{ ready: boolean; checks: Record<string, boolean> }> {
    const checks: Record<string, boolean> = {
      server: true,
    };

    if (this.database) {
      const dbHealth = await this.checkDatabase();
      checks.database = dbHealth.status !== 'unhealthy';
    }

    if (this.redis) {
      const redisHealth = await this.checkRedis();
      checks.redis = redisHealth.status !== 'unhealthy';
    }

    const ready = Object.values(checks).every((v) => v);

    return { ready, checks };
  }

  // ============================================================================
  // Individual Checks
  // ============================================================================

  private async runAllChecks(): Promise<HealthReport['checks']> {
    const checks: HealthReport['checks'] = {
      server: this.checkServer(),
      memory: this.checkMemory(),
      cpu: this.checkCpu(),
    };

    if (this.database) {
      checks.database = await this.checkDatabase();
    }

    if (this.redis) {
      checks.redis = await this.checkRedis();
    }

    return checks;
  }

  private checkServer(): ComponentHealth {
    return {
      status: 'healthy',
      message: 'Server is running',
      lastCheck: Date.now(),
    };
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    if (!this.database) {
      return {
        status: 'unhealthy',
        message: 'Database not configured',
        lastCheck: Date.now(),
      };
    }

    try {
      const result = await this.database.healthCheck();
      return {
        status: result.healthy ? 'healthy' : 'unhealthy',
        latencyMs: result.latencyMs,
        message: result.error ?? 'Database connection OK',
        lastCheck: Date.now(),
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: error.message,
        lastCheck: Date.now(),
      };
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    if (!this.redis) {
      return {
        status: 'unhealthy',
        message: 'Redis not configured',
        lastCheck: Date.now(),
      };
    }

    try {
      const result = await this.redis.healthCheck();
      return {
        status: result.healthy ? 'healthy' : 'unhealthy',
        latencyMs: result.latencyMs,
        message: result.error ?? 'Redis connection OK',
        lastCheck: Date.now(),
      };
    } catch (error: any) {
      return {
        status: 'unhealthy',
        message: error.message,
        lastCheck: Date.now(),
      };
    }
  }

  private checkMemory(): ComponentHealth {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    let status: HealthStatus = 'healthy';
    let message = `Heap usage: ${heapUsedPercent.toFixed(1)}%`;

    if (heapUsedPercent >= this.config.memoryCriticalThreshold) {
      status = 'unhealthy';
      message = `Critical memory usage: ${heapUsedPercent.toFixed(1)}%`;
    } else if (heapUsedPercent >= this.config.memoryWarningThreshold) {
      status = 'degraded';
      message = `High memory usage: ${heapUsedPercent.toFixed(1)}%`;
    }

    return {
      status,
      message,
      lastCheck: Date.now(),
    };
  }

  private checkCpu(): ComponentHealth {
    const currentUsage = process.cpuUsage();
    const now = Date.now();
    const elapsedMs = now - this.lastCpuCheck;

    // Calculate CPU percentage
    const userDelta = currentUsage.user - this.lastCpuUsage.user;
    const systemDelta = currentUsage.system - this.lastCpuUsage.system;
    const totalDelta = userDelta + systemDelta;

    // Convert to percentage (microseconds to milliseconds, then to percent)
    const cpuPercent = (totalDelta / 1000 / elapsedMs) * 100;

    // Update for next check
    this.lastCpuUsage = currentUsage;
    this.lastCpuCheck = now;

    let status: HealthStatus = 'healthy';
    let message = `CPU usage: ${cpuPercent.toFixed(1)}%`;

    if (cpuPercent >= this.config.cpuCriticalThreshold) {
      status = 'unhealthy';
      message = `Critical CPU usage: ${cpuPercent.toFixed(1)}%`;
    } else if (cpuPercent >= this.config.cpuWarningThreshold) {
      status = 'degraded';
      message = `High CPU usage: ${cpuPercent.toFixed(1)}%`;
    }

    return {
      status,
      message,
      lastCheck: Date.now(),
    };
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private determineOverallStatus(checks: HealthReport['checks']): HealthStatus {
    const statuses = Object.values(checks).map((c) => c.status);

    if (statuses.some((s) => s === 'unhealthy')) {
      return 'unhealthy';
    }

    if (statuses.some((s) => s === 'degraded')) {
      return 'degraded';
    }

    return 'healthy';
  }
}

// Singleton instance
let instance: HealthCheckService | null = null;

export function getHealthCheckService(config?: HealthCheckConfig): HealthCheckService {
  if (!instance) {
    instance = new HealthCheckService(config);
  }
  return instance;
}

export function resetHealthCheckService(): void {
  instance = null;
}
