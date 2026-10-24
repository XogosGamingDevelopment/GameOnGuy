/**
 * Game On Dude! - Core Server
 *
 * Main WebSocket server handling connections, heartbeats, and routing.
 * Now with middleware support for message interception and processing.
 *
 * www.gameonguy.com
 */

import { WebSocket, WebSocketServer } from 'ws';
import { createServer, Server as HttpServer, IncomingMessage } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Client } from './Client';
import { TypedEventEmitter } from './EventEmitter';
import {
  ServerConfig,
  ServerEvents,
  Message,
  MessageType,
  AuthPayload,
  RoomInfo,
  RoomListFilter,
} from './types';
import logger from './Logger';
import { RoomManager } from '../rooms/RoomManager';
import { AuthService } from '../auth/AuthService';
import { MatchmakingService } from '../matchmaking/MatchmakingService';
import {
  MiddlewarePipeline,
  MiddlewareConfig,
  MessageDirection,
  createStandardMiddlewareStack,
} from '../middleware/Middleware';

const DEFAULT_CONFIG: ServerConfig = {
  port: 3000,
  adminPort: 3001,
  host: '0.0.0.0',
  wsPath: '/ws',
  heartbeatInterval: 30000,
  heartbeatTimeout: 60000,
  maxRoomsPerServer: 1000,
  maxPlayersPerRoom: 100,
  tickRateDefault: 20,
  tickRateFPS: 60,
  tickRateTurnBased: 2,
};

/** Extended server configuration with middleware options */
export interface GameOnServerConfig extends Partial<ServerConfig> {
  /** Enable standard middleware stack */
  enableMiddleware?: boolean;
  /** Custom middleware configurations */
  middleware?: MiddlewareConfig[];
  /** Rate limiting options */
  rateLimit?: {
    maxMessages?: number;
    windowMs?: number;
  };
}

/** Per-game-type access rules, checked on room_create, room_join and matchmake_request. */
export interface GameAccessPolicy {
  /** Only clients authenticated with a game token for this game may play (guests refused). */
  requireGameToken?: string;
  /** Browser Origin values allowed to play. A trailing ":*" matches any port. */
  allowedOrigins?: string[];
  /** Child-directed game: don't log client IPs for connections from its origins. */
  childDirected?: boolean;
}

/** Wrong join codes a connection may try per minute before being throttled. */
const MAX_BAD_JOIN_CODES_PER_MINUTE = 10;

/**
 * The build this server runs, shown on /health: the stamp create-zip.js puts in
 * dist/build-info.json (the deploy's version label), else GAMEON_VERSION, else
 * package.json's version.
 */
function detectServerVersion(): string {
  try {
    const info = JSON.parse(readFileSync(join(__dirname, '..', 'build-info.json'), 'utf8'));
    if (typeof info.version === 'string') return info.version;
  } catch {
    /* not a packaged build */
  }
  if (process.env.GAMEON_VERSION) return process.env.GAMEON_VERSION;
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

/** Room options a client must never set directly in room_create. */
const SERVER_ONLY_ROOM_OPTIONS = ['fromMatchmaking', 'fromMatchmakingTimeout', 'creatorId', 'id'];

/** room_error payload: always a message, plus a stable code when we have one. */
function roomErrorPayload(error: any): { message: string; code?: string } {
  return error?.code ? { message: error.message, code: error.code } : { message: error?.message };
}

function originMatches(origin: string, pattern: string): boolean {
  if (pattern.endsWith(':*')) {
    const base = pattern.slice(0, -2);
    return origin === base || new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\d+$`).test(origin);
  }
  return origin === pattern;
}

export class GameOnServer extends TypedEventEmitter<ServerEvents> {
  private readonly config: ServerConfig;
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;
  private readonly clients: Map<string, Client> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;
  private readonly accessPolicies: Map<string, GameAccessPolicy> = new Map();

  public readonly roomManager: RoomManager;
  public readonly authService: AuthService;
  public readonly matchmaking: MatchmakingService;
  public readonly middleware: MiddlewarePipeline;

  private readonly log = logger.child({ component: 'Server' });

  constructor(config: GameOnServerConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    const version = detectServerVersion();

    // Create HTTP server for WebSocket upgrade
    this.httpServer = createServer((req, res) => {
      // Health check endpoint (load balancer + partners' status checks). Counts only — no room or player details.
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            clients: this.clients.size,
            rooms: this.roomManager.getRoomCount(),
            version,
            uptimeSeconds: Math.round(process.uptime()),
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    // Create WebSocket server
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: this.config.wsPath,
      // Security: cap message size (ws default is 100 MiB — a DoS vector).
      // 1 MiB is far above any legitimate game message.
      maxPayload: 1024 * 1024,
    });

    // Initialize services
    this.authService = new AuthService();
    this.roomManager = new RoomManager(this);
    this.matchmaking = new MatchmakingService(
      this.roomManager,
      (clientId: string) => this.clients.get(clientId)
    );

    // Initialize middleware pipeline
    this.middleware = new MiddlewarePipeline();
    this.setupMiddleware(config);

    this.setupWebSocketServer();
  }

  /**
   * Set up the middleware pipeline with standard or custom middleware.
   */
  private setupMiddleware(config: GameOnServerConfig): void {
    // Add standard middleware stack if enabled (default: true in production)
    if (config.enableMiddleware !== false) {
      const standardStack = createStandardMiddlewareStack({
        enableLogging: process.env.NODE_ENV !== 'production',
        rateLimitConfig: config.rateLimit ? {
          maxMessages: config.rateLimit.maxMessages,
          windowMs: config.rateLimit.windowMs,
        } : undefined,
      });

      standardStack.forEach(mw => this.middleware.use(mw));
    }

    // Add custom middleware
    if (config.middleware) {
      config.middleware.forEach(mw => this.middleware.use(mw));
    }

    this.log.info(
      { middlewareCount: this.middleware.list().length },
      'Middleware pipeline initialized'
    );
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
      this.handleConnection(socket, request);
    });

    this.wss.on('error', (error: Error) => {
      this.log.error({ error }, 'WebSocket server error');
      this.emit('error', error);
    });
  }

  /**
   * Restrict who may play a game type (see GameAccessPolicy).
   */
  public setGameAccessPolicy(gameType: string, policy: GameAccessPolicy): void {
    this.accessPolicies.set(gameType, policy);
    this.log.info({ gameType, policy }, 'Game access policy set');
  }

  /**
   * Returns a refusal message if the client may not play this game type.
   */
  public checkGameAccess(client: Client, gameType: string): string | null {
    const policy = this.accessPolicies.get(gameType);
    if (!policy) return null;

    if (policy.allowedOrigins) {
      const origin = client.metadata.origin;
      if (typeof origin !== 'string' || !policy.allowedOrigins.some((p) => originMatches(origin, p))) {
        return 'This game can only be played from its own website';
      }
    }

    if (policy.requireGameToken && client.metadata.authGame !== policy.requireGameToken) {
      return 'Please sign in through the game to play online';
    }

    return null;
  }

  private isChildDirectedOrigin(origin?: string): boolean {
    if (!origin) return false;
    for (const policy of this.accessPolicies.values()) {
      if (policy.childDirected && policy.allowedOrigins?.some((p) => originMatches(origin, p))) {
        return true;
      }
    }
    return false;
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const client = new Client(socket);
    this.clients.set(client.id, client);

    const origin = request.headers.origin;
    client.metadata.origin = origin;
    const childDirected = this.isChildDirectedOrigin(origin);
    client.metadata.childDirected = childDirected;

    this.log.info(
      {
        clientId: client.id,
        // Student privacy: no IPs for child-directed games.
        ip: childDirected ? undefined : request.socket.remoteAddress,
        totalClients: this.clients.size,
      },
      'Client connected'
    );

    this.emit('clientConnected', client);

    // Handle client messages
    client.on('message', (message: Message) => {
      this.handleClientMessage(client, message);
    });

    // Handle client disconnect
    client.on('close', (code: number, reason: string) => {
      this.handleClientDisconnect(client, reason);
    });

    // Handle client errors
    client.on('error', (error: Error) => {
      this.log.error({ clientId: client.id, error }, 'Client error');
    });

    // Send welcome message
    client.send({
      type: 'welcome',
      payload: {
        clientId: client.id,
        sessionId: client.sessionId,
        serverTime: Date.now(),
      },
    });
  }

  private async handleClientMessage(client: Client, message: Message): Promise<void> {
    this.log.debug({ clientId: client.id, type: message.type }, 'Received message');

    // Execute middleware pipeline
    const ctx = await this.middleware.execute(
      message,
      client,
      MessageDirection.INCOMING,
      client.currentRoomId
    );

    // Check if middleware stopped processing
    if (!ctx.shouldContinue) {
      if (ctx.error) {
        this.log.warn(
          { clientId: client.id, error: ctx.error.message, type: message.type },
          'Message blocked by middleware'
        );
      }
      return;
    }

    // Use potentially transformed message
    const processedMessage = ctx.transformedMessage ?? message;

    try {
      switch (processedMessage.type) {
        case MessageType.AUTH:
          await this.handleAuth(client, processedMessage.payload as AuthPayload);
          break;

        case MessageType.ROOM_CREATE:
          await this.handleRoomCreate(client, processedMessage.payload);
          break;

        case MessageType.ROOM_JOIN:
          await this.handleRoomJoin(client, processedMessage.payload);
          break;

        case MessageType.ROOM_LEAVE:
          await this.handleRoomLeave(client);
          break;

        case MessageType.ROOM_LIST:
          await this.handleRoomList(client, processedMessage.payload as RoomListFilter);
          break;

        case MessageType.PLAYER_READY:
          await this.handlePlayerReady(client, processedMessage.payload);
          break;

        case MessageType.GAME_ACTION:
          await this.handleGameAction(client, processedMessage.payload);
          break;

        case MessageType.MATCHMAKE_REQUEST:
          await this.handleMatchmakeRequest(client, processedMessage.payload);
          break;

        case MessageType.MATCHMAKE_CANCEL:
          await this.handleMatchmakeCancel(client);
          break;

        default:
          // Forward to room if client is in one
          if (client.currentRoomId) {
            const room = this.roomManager.getRoom(client.currentRoomId);
            if (room) {
              room.handleMessage(client, processedMessage);
            }
          }
      }
    } catch (error) {
      this.log.error({ clientId: client.id, error, messageType: processedMessage.type }, 'Error handling message');
      client.sendError('Internal server error');
    }
  }

  private async handleAuth(client: Client, payload: AuthPayload): Promise<void> {
    try {
      const result = await this.authService.authenticate(payload);

      if (result.success) {
        client.metadata.authGame = result.game;
        client.authenticate(
          result.userId!,
          result.username!,
          !result.game && !client.metadata.childDirected
        );
        client.send({
          type: MessageType.AUTH_SUCCESS,
          payload: {
            userId: result.userId,
            username: result.username,
            sessionId: client.sessionId,
          },
        });
        this.emit('clientAuthenticated', client);
      } else {
        client.send({
          type: MessageType.AUTH_FAILURE,
          payload: { message: result.error },
        });
      }
    } catch (error) {
      this.log.error({ error }, 'Authentication error');
      client.send({
        type: MessageType.AUTH_FAILURE,
        payload: { message: 'Authentication failed' },
      });
    }
  }

  private async handleRoomCreate(client: Client, payload: any): Promise<void> {
    if (!client.isAuthenticated) {
      client.sendError('Must be authenticated to create a room');
      return;
    }

    const refusal = this.checkGameAccess(client, payload?.gameType);
    if (refusal) {
      this.refuseRoom(client, payload?.gameType, { message: refusal, code: 'ACCESS_DENIED' });
      return;
    }

    const options = { ...(payload?.options ?? {}) };
    for (const key of SERVER_ONLY_ROOM_OPTIONS) delete options[key];

    try {
      const room = await this.roomManager.createRoom(payload.gameType, {
        ...options,
        creatorId: client.userId,
      });

      // Auto-join creator to the room
      await this.roomManager.joinRoom(room.id, client, undefined, payload?.playerData);

      client.send({
        type: MessageType.ROOM_CREATED,
        payload: { ...room.getMemberInfo(), ...this.selfInfo(room, client) },
      });

      this.emit('roomCreated', room.getInfo());
    } catch (error: any) {
      this.refuseRoom(client, payload?.gameType, roomErrorPayload(error));
    }
  }

  /**
   * Send room_error and log the refusal with the game and code only — no ids,
   * names or IPs (these games are played by students). CloudWatch alarms count
   * these "Room refused" lines per game and code.
   */
  private refuseRoom(client: Client, gameType: unknown, payload: { message: string; code?: string }): void {
    this.log.warn(
      {
        gameType: typeof gameType === 'string' ? gameType.slice(0, 40) : undefined,
        code: payload.code ?? 'UNSPECIFIED',
      },
      'Room refused'
    );
    client.send({ type: MessageType.ROOM_ERROR, payload });
  }

  /** The joiner's own ids: room player id, plus a rejoin token in rooms that hold seats. */
  private selfInfo(room: { playerIdOf(c: Client): string; getRejoinToken(id: string): string | undefined }, client: Client) {
    const playerId = room.playerIdOf(client);
    const rejoinToken = room.getRejoinToken(playerId);
    return rejoinToken ? { playerId, rejoinToken } : { playerId };
  }

  private async handleRoomJoin(client: Client, payload: any): Promise<void> {
    if (!client.isAuthenticated) {
      client.sendError('Must be authenticated to join a room');
      return;
    }

    // Join by short code ({ joinCode: "BKTMZ" }) or by room id.
    let roomId: string | undefined = payload?.roomId;
    const joinCode = payload?.joinCode ?? payload?.code;
    if (joinCode !== undefined) {
      const now = Date.now();
      const bad = client.metadata.badJoinCodes as { count: number; resetAt: number } | undefined;
      if (bad && bad.resetAt > now && bad.count >= MAX_BAD_JOIN_CODES_PER_MINUTE) {
        this.refuseRoom(client, undefined, {
          message: 'Too many wrong codes. Please wait a minute and try again.',
          code: 'TOO_MANY_ATTEMPTS',
        });
        return;
      }
      roomId = this.roomManager.findRoomIdByCode(joinCode);
      if (!roomId) {
        if (!bad || bad.resetAt <= now) {
          client.metadata.badJoinCodes = { count: 1, resetAt: now + 60000 };
        } else {
          bad.count++;
        }
        this.refuseRoom(client, undefined, { message: 'Room not found', code: 'ROOM_NOT_FOUND' });
        return;
      }
    }

    const target = roomId ? this.roomManager.getRoom(roomId) : undefined;
    if (target) {
      const refusal = this.checkGameAccess(client, target.gameType);
      if (refusal) {
        this.refuseRoom(client, target.gameType, { message: refusal, code: 'ACCESS_DENIED' });
        return;
      }
    }

    // { roomId | joinCode, rejoinToken }: take back a seat held after a dropped connection.
    const rejoining = payload?.rejoinToken !== undefined;

    try {
      if (rejoining) {
        await this.roomManager.rejoinRoom(roomId as string, client, payload.rejoinToken);
      } else {
        await this.roomManager.joinRoom(roomId as string, client, payload.password, payload?.playerData);
      }

      const room = this.roomManager.getRoom(roomId as string);
      if (room) {
        client.send({
          type: MessageType.ROOM_JOINED,
          payload: {
            room: room.getMemberInfo(),
            state: room.getState(),
            ...this.selfInfo(room, client),
            ...(rejoining ? { rejoined: true } : {}),
          },
        });
      }
    } catch (error: any) {
      this.refuseRoom(client, target?.gameType, roomErrorPayload(error));
    }
  }

  private async handleRoomLeave(client: Client): Promise<void> {
    if (client.currentRoomId) {
      await this.roomManager.leaveRoom(client.currentRoomId, client);
      client.send({ type: MessageType.ROOM_LEFT });
    }
  }

  private async handleRoomList(client: Client, filter?: RoomListFilter): Promise<void> {
    const rooms = this.roomManager.listRooms(filter);
    client.send({
      type: MessageType.ROOM_LIST,
      payload: { rooms },
    });
  }

  private async handlePlayerReady(client: Client, payload: any): Promise<void> {
    if (client.currentRoomId) {
      const room = this.roomManager.getRoom(client.currentRoomId);
      if (room) {
        room.setPlayerReady(client.id, payload?.ready ?? true, payload);
      }
    }
  }

  private async handleGameAction(client: Client, payload: any): Promise<void> {
    if (client.currentRoomId) {
      const room = this.roomManager.getRoom(client.currentRoomId);
      if (room) {
        room.handleGameAction(client, payload);
      }
    }
  }

  private async handleMatchmakeRequest(client: Client, payload: any): Promise<void> {
    this.log.info(
      { clientId: client.id, gameType: payload.gameType, authenticated: client.isAuthenticated },
      'Matchmaking request received'
    );

    if (!client.isAuthenticated) {
      client.sendError('Must be authenticated to matchmake');
      return;
    }

    const refusal = this.checkGameAccess(client, payload?.gameType);
    if (refusal) {
      client.sendError(refusal);
      return;
    }

    try {
      const ticket = await this.matchmaking.requestMatch({
        playerId: client.id,
        sessionId: client.sessionId,
        gameType: payload.gameType,
        gameMode: payload.gameMode,
        skill: payload.skill,
        preferences: payload.preferences,
        timestamp: Date.now(),
      });

      // Send immediate acknowledgment that matchmaking has started
      client.send({
        type: 'matchmake_started',
        payload: {
          ticketId: ticket.id,
          gameType: payload.gameType,
          estimatedWait: 20, // seconds
        },
      });

      this.log.info(
        { clientId: client.id, ticketId: ticket.id, gameType: payload.gameType },
        'Matchmaking ticket created and acknowledged'
      );
    } catch (error: any) {
      this.log.error({ clientId: client.id, error: error.message }, 'Matchmaking request failed');
      client.sendError(error.message);
    }
  }

  private async handleMatchmakeCancel(client: Client): Promise<void> {
    this.matchmaking.cancelMatch(client.id);
  }

  private handleClientDisconnect(client: Client, reason: string): void {
    this.log.info(
      {
        clientId: client.id,
        reason,
        roomId: client.currentRoomId,
      },
      'Client disconnected'
    );

    // Leave room if in one (rooms with a rejoin hold keep the seat for a while)
    if (client.currentRoomId) {
      this.roomManager.disconnectFromRoom(client.currentRoomId, client).catch((error) => {
        this.log.error({ error }, 'Error leaving room on disconnect');
      });
    }

    // Cancel any matchmaking
    this.matchmaking.cancelMatch(client.id);

    // Remove from clients map
    this.clients.delete(client.id);

    this.emit('clientDisconnected', client, reason);
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatTimeout;

      this.clients.forEach((client, id) => {
        if (!client.isAlive(timeout)) {
          this.log.warn({ clientId: id }, 'Client heartbeat timeout');
          client.close(4000, 'Heartbeat timeout');
          return;
        }
        client.ping();
      });
    }, this.config.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  public getClient(clientId: string): Client | undefined {
    return this.clients.get(clientId);
  }

  public getClientCount(): number {
    return this.clients.size;
  }

  public broadcast(message: Message, filter?: (client: Client) => boolean): void {
    this.clients.forEach((client) => {
      if (!filter || filter(client)) {
        client.send(message);
      }
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.startHeartbeat();
        this.log.info(
          {
            port: this.config.port,
            host: this.config.host,
            wsPath: this.config.wsPath,
          },
          'Game On Dude! Server started'
        );
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    this.stopHeartbeat();
    this.matchmaking.stop();

    // Close all client connections
    this.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
    this.clients.clear();

    // Close WebSocket server
    this.wss.close();

    // Close HTTP server
    return new Promise((resolve) => {
      this.httpServer.close(() => {
        this.log.info('Server stopped');
        resolve();
      });
    });
  }

  public getStats() {
    return {
      clients: this.clients.size,
      rooms: this.roomManager.getRoomCount(),
      matchmakingQueue: this.matchmaking.getQueueSize(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
  }
}
