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
import { HistoricalConquestRelayRoom } from './games/xogos/HistoricalConquestRelayRoom';
import { GeoTagRoom } from './games/xogos/GeoTagRoom';
import { TypingRaceRoom } from './games/xogos/TypingRaceRoom';
import { PanicAttackRoom } from './games/xogos/PanicAttackRoom';
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

  registerPanicAttack(server);

  // Historical Conquest: The Digital — RELAY room (July 2026, per Xogos
  // Gaming's request). The client is lockstep (full game logic on every
  // device); the server relays actions with no turn order, no setup phase,
  // and no server-side bots. The old simulated-turn implementation
  // (HistoricalConquestRoom) is retained in src/games/xogos/ for reference.
  server.roomManager.registerGame(
    GameOnGames.HISTORICAL_CONQUEST.type,
    HistoricalConquestRelayRoom,
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

  registerStudentGamePolicies(server);

  log.info('All game types registered');
}

/**
 * Turbo Type and Historical Conquest (Xogos Gaming, Oct 2026) are played by
 * K-12 students: only their own sites may connect, and no IPs or names are
 * logged. On the test server (GAMEON_TEST_SERVER=true) their local dev
 * addresses are allowed too.
 *
 * Turbo Type players may sign in with a token from Turbo Type's backend
 * (TYPING_RACE_TOKEN_SECRET — the same value as GAMEON_TURBO_SECRET on
 * Turbo-type-env). TYPING_RACE_REQUIRE_TOKEN=true refuses guests; leave it
 * off until Turbo Type's production endpoint is live. Historical Conquest works
 * the same way with HISTORICAL_CONQUEST_TOKEN_SECRET /
 * HISTORICAL_CONQUEST_REQUIRE_TOKEN (not set yet — HC isn't ready).
 */
const TURBO_TYPE_ORIGINS = [
  'https://turbotype.myxogos.com',
  'https://main.d3hnzwbzrpohxp.amplifyapp.com',
];
const TURBO_TYPE_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const HISTORICAL_CONQUEST_ORIGINS = [
  'https://historicalconquest.org',
  'https://www.historicalconquest.org',
  'https://game.historicalconquest.org',
  'https://academy.historicalconquest.org',
  'https://master.d17xq1hcij90qc.amplifyapp.com',
];
const HISTORICAL_CONQUEST_DEV_ORIGINS = ['http://localhost:8000', 'http://127.0.0.1:8000'];

function registerStudentGamePolicies(server: GameOnServer) {
  const testServer = process.env.GAMEON_TEST_SERVER === 'true';

  const turboSecret = process.env.TYPING_RACE_TOKEN_SECRET;
  if (turboSecret) {
    server.authService.registerGameTokenSecret(GameOnGames.TYPING_RACE.type, turboSecret);
  }
  const requireTurboToken = process.env.TYPING_RACE_REQUIRE_TOKEN === 'true';
  if (requireTurboToken && !turboSecret) {
    log.warn('TYPING_RACE_REQUIRE_TOKEN is set but TYPING_RACE_TOKEN_SECRET is not — typing_race will refuse all players');
  }

  server.setGameAccessPolicy(GameOnGames.TYPING_RACE.type, {
    ...(requireTurboToken ? { requireGameToken: GameOnGames.TYPING_RACE.type } : {}),
    allowedOrigins: testServer ? [...TURBO_TYPE_ORIGINS, ...TURBO_TYPE_DEV_ORIGINS] : TURBO_TYPE_ORIGINS,
    childDirected: true,
  });

  // HC tokens carry only the player id (sub); the first name comes from the
  // `username` HC's client sends alongside the token.
  const hcSecret = process.env.HISTORICAL_CONQUEST_TOKEN_SECRET;
  if (hcSecret) {
    server.authService.registerGameTokenSecret(GameOnGames.HISTORICAL_CONQUEST.type, hcSecret);
  }
  const requireHcToken = process.env.HISTORICAL_CONQUEST_REQUIRE_TOKEN === 'true';
  if (requireHcToken && !hcSecret) {
    log.warn('HISTORICAL_CONQUEST_REQUIRE_TOKEN is set but HISTORICAL_CONQUEST_TOKEN_SECRET is not — historical_conquest will refuse all players');
  }

  server.setGameAccessPolicy(GameOnGames.HISTORICAL_CONQUEST.type, {
    ...(requireHcToken ? { requireGameToken: GameOnGames.HISTORICAL_CONQUEST.type } : {}),
    allowedOrigins: testServer
      ? [...HISTORICAL_CONQUEST_ORIGINS, ...HISTORICAL_CONQUEST_DEV_ORIGINS]
      : HISTORICAL_CONQUEST_ORIGINS,
    childDirected: true,
  });
}

/**
 * Panic Attack (Xogos Gaming, Oct 2026): host-authoritative relay for a
 * K-12 browser game. Players never sign in to Game On Dude! — Panic Attack's
 * backend signs a short-lived token (PANIC_ATTACK_TOKEN_SECRET) that the game
 * passes in `auth`. panic_attack_test is the pre-launch test type: same room,
 * also accepts guest auth and localhost origins.
 */
const PANIC_ATTACK_ORIGINS = [
  'https://panicattack.myxogos.com',
  'https://main.dwi7f9whnjmat.amplifyapp.com',
];

function registerPanicAttack(server: GameOnServer) {
  const panicSecret = process.env.PANIC_ATTACK_TOKEN_SECRET;
  if (panicSecret) {
    server.authService.registerGameTokenSecret(GameOnGames.PANIC_ATTACK.type, panicSecret);
  } else {
    log.warn('PANIC_ATTACK_TOKEN_SECRET not set — panic_attack will refuse all players (panic_attack_test still works)');
  }

  const quickMatch = {
    timeout: 120000, // a lone player gets matchmake_timeout after 2 min
    fillCountdownMs: 20000, // 20 s after the 2nd player joins...
    minMatchPlayers: 2,
    maxMatchPlayers: 7, // ...or right away with 7 (6 monsters + Panic)
    autoJoinMatched: true,
  };

  server.roomManager.registerGame(GameOnGames.PANIC_ATTACK.type, PanicAttackRoom, GameOnGames.PANIC_ATTACK);
  server.setGameAccessPolicy(GameOnGames.PANIC_ATTACK.type, {
    requireGameToken: GameOnGames.PANIC_ATTACK.type,
    allowedOrigins: PANIC_ATTACK_ORIGINS,
    childDirected: true,
  });
  server.matchmaking.configureGameMatchmaking(GameOnGames.PANIC_ATTACK.type, quickMatch);

  server.roomManager.registerGame(GameOnGames.PANIC_ATTACK_TEST.type, PanicAttackRoom, GameOnGames.PANIC_ATTACK_TEST);
  server.setGameAccessPolicy(GameOnGames.PANIC_ATTACK_TEST.type, {
    allowedOrigins: [...PANIC_ATTACK_ORIGINS, 'http://localhost:*', 'http://127.0.0.1:*'],
    childDirected: true,
  });
  server.matchmaking.configureGameMatchmaking(GameOnGames.PANIC_ATTACK_TEST.type, quickMatch);
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
  HistoricalConquestRelayRoom,
  HistoricalConquestRelayRoomOptions,
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
