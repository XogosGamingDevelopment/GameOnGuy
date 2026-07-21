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

export class GameOnServer extends TypedEventEmitter<ServerEvents> {
  private readonly config: ServerConfig;
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;
  private readonly clients: Map<string, Client> = new Map();
  private heartbeatInterval?: NodeJS.Timeout;

  public readonly roomManager: RoomManager;
  public readonly authService: AuthService;
  public readonly matchmaking: MatchmakingService;
  public readonly middleware: MiddlewarePipeline;

  private readonly log = logger.child({ component: 'Server' });

  constructor(config: GameOnServerConfig = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Create HTTP server for WebSocket upgrade
    this.httpServer = createServer((req, res) => {
      // Simple health check endpoint
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', clients: this.clients.size }));
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

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const client = new Client(socket);
    this.clients.set(client.id, client);

    this.log.info(
      {
        clientId: client.id,
        ip: request.socket.remoteAddress,
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
        client.authenticate(result.userId!, result.username!);
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

    try {
      const room = await this.roomManager.createRoom(payload.gameType, {
        ...payload.options,
        creatorId: client.userId,
      });

      // Auto-join creator to the room
      await this.roomManager.joinRoom(room.id, client);

      client.send({
        type: MessageType.ROOM_CREATED,
        payload: room.getInfo(),
      });

      this.emit('roomCreated', room.getInfo());
    } catch (error: any) {
      client.send({
        type: MessageType.ROOM_ERROR,
        payload: { message: error.message },
      });
    }
  }

  private async handleRoomJoin(client: Client, payload: any): Promise<void> {
    if (!client.isAuthenticated) {
      client.sendError('Must be authenticated to join a room');
      return;
    }

    try {
      await this.roomManager.joinRoom(payload.roomId, client, payload.password);

      const room = this.roomManager.getRoom(payload.roomId);
      if (room) {
        client.send({
          type: MessageType.ROOM_JOINED,
          payload: {
            room: room.getInfo(),
            state: room.getState(),
          },
        });
      }
    } catch (error: any) {
      client.send({
        type: MessageType.ROOM_ERROR,
        payload: { message: error.message },
      });
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
        room.setPlayerReady(client.id, payload?.ready ?? true);
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

    // Leave room if in one
    if (client.currentRoomId) {
      this.roomManager.leaveRoom(client.currentRoomId, client).catch((error) => {
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
