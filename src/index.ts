/**
 * Game On Dude! - Multiplayer Server
 *
 * Main entry point for the multiplayer game server platform.
 * Supports multiple game types: trivia, real-time movement, and turn-based.
 *
 * www.gameonguy.com
 *
 * Features:
 * - Schema-based state management with automatic delta sync
 * - Middleware pipeline for message interception
 * - Database integration (PostgreSQL)
 * - Redis for caching and scaling
 * - Comprehensive monitoring and health checks
 * - Game-specific room implementations
 */

// Must be imported first for decorator support
import 'reflect-metadata';

import dotenv from 'dotenv';
dotenv.config();

import { GameOnServer } from './core/Server';
import { TriviaRoom } from './games/TriviaRoom';
import { RealTimeMovementRoom } from './games/RealTimeMovementRoom';
import { TurnBasedRoom } from './games/TurnBasedRoom';
import { LightningRoundRoom } from './games/xogos/LightningRoundRoom';
import { HistoricalConquestRoom } from './games/xogos/HistoricalConquestRoom';
import { GeoTagRoom } from './games/xogos/GeoTagRoom';
import { TypingRaceRoom } from './games/xogos/TypingRaceRoom';
import { GameOnGames } from './games';
import logger from './core/Logger';
import { startAdminServer } from './admin/AdminServer';

// Server-side bots are OPT-IN (Phase 14). No bots are registered by default —
// Historical Conquest: The Digital runs its own bots client-side.
// To enable server-side bots for a future game:
//   1. Implement a bot (reference: src/bots/games/historical-conquest/)
//   2. Import its registration module here, e.g.:
//        import './bots/games/historical-conquest';
//   3. Opt the game into bot fill after server creation:
//        server.matchmaking.configureGameMatchmaking('game_type', { fillWithBots: true, minHumanPlayers: 1 });
//   4. Pass enableBots: true in the game's room options if it uses room-level spawning

// Database and Cache
import { DatabaseService, getDatabaseService } from './database';
import { RedisService, getRedisService, SessionStore, RoomSyncService } from './cache';

// Monitoring
import { getMetricsService, getHealthCheckService } from './monitoring';

const log = logger.child({ component: 'Main' });

// Global service instances
let database: DatabaseService | undefined;
let redis: RedisService | undefined;
let sessionStore: SessionStore | undefined;
let roomSync: RoomSyncService | undefined;

async function main() {
  log.info('Starting Game On Dude! Server...');

  // Initialize optional services based on environment
  await initializeServices();

  // Create server instance
  const server = new GameOnServer({
    port: parseInt(process.env.PORT || '3000'),
    adminPort: parseInt(process.env.ADMIN_PORT || '3001'),
    host: process.env.HOST || '0.0.0.0',
    wsPath: process.env.WS_PATH || '/ws',
    heartbeatInterval: parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000'),
    heartbeatTimeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT || '60000'),
  });

  // Register game types
  registerGames(server);

  // Setup health check service
  const healthCheck = getHealthCheckService();
  healthCheck.setDependencies({
    database,
    redis,
    getStats: () => ({
      connections: server.getClientCount(),
      rooms: server.roomManager.getRoomCount(),
      matchmakingQueue: server.matchmaking.getQueueSize(),
    }),
  });

  // Setup metrics collection
  const metrics = getMetricsService();
  setupMetricsCollection(server, metrics);

  // Start the server
  await server.start();

  // Start admin server with extended endpoints
  const adminPort = parseInt(process.env.ADMIN_PORT || '3001');
  startAdminServer(server, adminPort);

  // Start room sync if Redis is available
  if (redis && roomSync) {
    await roomSync.start();
  }

  // Import BotRegistry to check registration status
  const { BotRegistry } = await import('./bots/BotRegistry');

  log.info(
    {
      port: process.env.PORT || 3000,
      adminPort,
      registeredGames: server.roomManager.getRegisteredGameTypes(),
      registeredBots: BotRegistry.getAllBots().map(b => b.botType),
      botSupportedGames: BotRegistry.getSupportedGameTypes(),
      historicalConquestBotAvailable: BotRegistry.hasBotsForGame('historical_conquest'),
      database: database?.connected ? 'connected' : 'disabled',
      redis: redis?.connected ? 'connected' : 'disabled',
    },
    'Server started successfully'
  );

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutdown signal received');

    try {
      // Stop room sync
      if (roomSync) {
        await roomSync.stop();
      }

      // Stop server
      await server.stop();

      // Close database connection
      if (database) {
        await database.close();
      }

      // Close Redis connection
      if (redis) {
        await redis.disconnect();
      }

      log.info('Server stopped gracefully');
      process.exit(0);
    } catch (error) {
      log.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Initialize optional services (database, Redis) based on environment.
 */
async function initializeServices(): Promise<void> {
  // Initialize Database if configured
  if (process.env.DATABASE_URL || process.env.DB_HOST) {
    try {
      database = getDatabaseService();
      await database.connect();
      log.info('Database connected');
    } catch (error) {
      log.warn({ error }, 'Database connection failed - running without persistence');
      database = undefined;
    }
  } else {
    log.info('Database not configured - running without persistence');
  }

  // Initialize Redis if configured
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    try {
      redis = getRedisService();
      await redis.connect();
      log.info('Redis connected');

      // Initialize session store
      sessionStore = new SessionStore(redis, {
        sessionTTL: 24 * 60 * 60, // 24 hours
        cleanupInterval: 60 * 60, // 1 hour
      });

      // Initialize room sync for horizontal scaling
      roomSync = new RoomSyncService(
        redis,
        {
          host: process.env.HOST || 'localhost',
          port: parseInt(process.env.PORT || '3000'),
          wsPort: parseInt(process.env.PORT || '3000'),
          roomCount: 0,
          clientCount: 0,
        },
        {
          serverTTL: 30,
          roomTTL: 3600,
        }
      );
    } catch (error) {
      log.warn({ error }, 'Redis connection failed - running without caching/scaling');
      redis = undefined;
    }
  } else {
    log.info('Redis not configured - running without caching/scaling');
  }
}

/**
 * Register all game types with the server.
 */
function registerGames(server: GameOnServer) {
  // Register Trivia Games
  server.roomManager.registerGame(
    GameOnGames.LIGHTNING_ROUND.type,
    LightningRoundRoom,
    GameOnGames.LIGHTNING_ROUND
  );

  server.roomManager.registerGame(
    GameOnGames.TIME_QUEST.type,
    TriviaRoom,
    GameOnGames.TIME_QUEST
  );

  // Register Real-Time Movement Games
  server.roomManager.registerGame(
    GameOnGames.NUMBER_MUNCHERS.type,
    RealTimeMovementRoom,
    GameOnGames.NUMBER_MUNCHERS
  );

  server.roomManager.registerGame(
    GameOnGames.PANIC_ATTACK.type,
    RealTimeMovementRoom,
    GameOnGames.PANIC_ATTACK
  );

  // Register Turn-Based Games
  server.roomManager.registerGame(
    GameOnGames.HISTORICAL_CONQUEST.type,
    HistoricalConquestRoom,
    GameOnGames.HISTORICAL_CONQUEST
  );

  // Register GeoTag (Real-Time Chase)
  server.roomManager.registerGame(
    GameOnGames.GEOTAG.type,
    GeoTagRoom,
    GameOnGames.GEOTAG
  );

  // Register Typing Race (relay room — Turbo Type: Racing Edition)
  server.roomManager.registerGame(
    GameOnGames.TYPING_RACE.type,
    TypingRaceRoom,
    GameOnGames.TYPING_RACE
  );

  log.info('All game types registered');
}

/**
 * Setup metrics collection for monitoring.
 */
function setupMetricsCollection(server: GameOnServer, metrics: ReturnType<typeof getMetricsService>) {
  // Update system metrics periodically
  setInterval(() => {
    metrics.updateSystemMetrics();
    metrics.gauge('connections_active', server.getClientCount());
    metrics.gauge('rooms_active', server.roomManager.getRoomCount());
    metrics.gauge('matchmaking_queue_size', server.matchmaking.getQueueSize());
  }, 15000); // Every 15 seconds

  // Track connection events
  server.on('clientConnected', () => {
    metrics.increment('connections_total');
    metrics.gaugeIncrement('connections_active');
  });

  server.on('clientDisconnected', () => {
    metrics.increment('disconnections_total');
    metrics.gaugeIncrement('connections_active', {}, -1);
  });

  server.on('roomCreated', () => {
    metrics.increment('rooms_created_total');
    metrics.gaugeIncrement('rooms_active');
  });

  log.info('Metrics collection initialized');
}

// Run the server
main().catch((error) => {
  log.error({ error }, 'Failed to start server');
  process.exit(1);
});

// Export for testing and library usage
export { GameOnServer, GameOnServerConfig } from './core/Server';
export * from './core/types';
export * from './rooms';

// Re-export schema module with explicit names to avoid conflicts
export {
  Schema,
  type,
  schema,
  ArraySchema,
  MapSchema,
  SetSchema,
  PropertyMetadata,
  SchemaType,
  PrimitiveType,
  ArrayType,
  MapType,
  SetType,
  CollectionChange,
  CollectionChangeType,
  getSchemaClass,
  registerSchema,
  createSchema,
} from './schema';

export {
  StateTracker,
  SyncMode,
  StateTrackerOptions,
  StateDelta,
  BinaryDelta,
  StateInterpolator,
  StateSnapshot as SchemaStateSnapshot,
} from './schema';

export * from './middleware';

// Re-export netcode with explicit names to avoid conflicts
export {
  // Prediction types
  BaseInput,
  MovementInput as NetcodeMovementInput,
  InputProcessingResult,
  PredictionStateSnapshot,
  InputProcessorOptions,
  ClientPredictionState,
  ServerAck,
  ReconciliationResult,
  InputProcessor,
  calculatePositionError,
  needsReconciliation,
  smoothCorrection,
  createMovementInput,
  // Lag Compensation types
  HistorySnapshot,
  LagCompensatedResult,
  LagCompensatorOptions,
  EntityPosition,
  Hitbox,
  HitValidationRequest,
  HitValidationResult,
  LagCompensator,
  HitValidator,
  interpolatePosition,
  createEntityMapInterpolator,
  // Interpolation types
  InterpolationSnapshot,
  InterpolationBufferOptions,
  InterpolationResult,
  VelocityState,
  PositionalState,
  DeadReckoningOptions,
  DeadReckoningState,
  InterpolationBuffer,
  EntityInterpolator,
  DeadReckoningPredictor,
  lerp,
  clamp,
  smoothStep,
  smootherStep,
  slerp,
  lerpPosition,
  extrapolatePosition,
  calculateVelocity,
  hermiteInterpolate,
  hermiteInterpolatePosition,
} from './netcode';

// Re-export database with explicit names to avoid conflicts
export {
  DatabaseService,
  DatabaseConfig,
  getDatabaseService,
  resetDatabaseService,
  UserRepository,
  User,
  CreateUserDTO,
  UpdateUserDTO,
  UserStats,
  LeaderboardEntry as DbLeaderboardEntry,
  MatchRepository,
  Match,
  MatchParticipant,
  CreateMatchDTO,
  MatchResultsDTO,
  ParticipantResultDTO,
  MatchWithParticipants,
  QuestionRepository,
  Question as DbQuestion,
  Answer as DbAnswer,
  QuestionWithAnswers,
  CreateQuestionDTO,
  CreateAnswerDTO,
  QuestionFilters,
} from './database';

export * from './cache';
export * from './monitoring';

// Re-export games with explicit names
export {
  TriviaRoom,
  TriviaRoomOptions,
  TriviaState,
  Question as TriviaQuestion,
  Answer as TriviaAnswer,
  PlayerTriviaData,
  PlayerAnswer,
  LeaderboardEntry as TriviaLeaderboardEntry,
  RealTimeMovementRoom,
  MovementRoomOptions,
  MovementState,
  MovementInput as GameMovementInput,
  PlayerMovementData,
  Vector2,
  Vector3,
  Transform,
  GridCell,
  Entity,
  TurnBasedRoom,
  TurnBasedRoomOptions,
  TurnBasedState,
  TurnInfo,
  TurnAction,
  PlayerTurnData,
  GameCategories,
  GameOnGames,
  LightningRoundRoom,
  LightningRoundState,
  LightningRoundOptions,
  Category,
  HistoricalConquestRoom,
  HistoricalConquestState,
  HistoricalConquestOptions,
  Card,
  CardStats,
  Ability,
  AbilityEffect,
  ResourceCost,
  ResourcePool,
  DeployedCard,
  Buff,
  Territory,
  CombatLogEntry,
  GeoTagRoom,
  TypingRaceRoom,
  TypingRaceRoomOptions,
} from './games';
