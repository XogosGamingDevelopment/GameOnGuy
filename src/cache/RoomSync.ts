/**
 * Game On Dude! - Room Sync Service
 * www.gameonguy.com
 *
 * Handles cross-server room synchronization for horizontal scaling.
 */

import { v4 as uuidv4 } from 'uuid';
import { RedisService } from './RedisService';
import logger from '../core/Logger';

export interface ServerInfo {
  serverId: string;
  host: string;
  port: number;
  wsPort: number;
  roomCount: number;
  clientCount: number;
  startedAt: number;
  lastHeartbeat: number;
  metadata?: Record<string, unknown>;
}

export interface RoomLocation {
  roomId: string;
  serverId: string;
  gameType: string;
  playerCount: number;
  maxPlayers: number;
  isPublic: boolean;
  createdAt: number;
}

export interface CrossServerMessage {
  type: 'room_message' | 'player_message' | 'broadcast' | 'room_update' | 'server_event';
  source: string;
  target?: string;
  roomId?: string;
  playerId?: string;
  payload: unknown;
  timestamp: number;
}

export interface RoomSyncConfig {
  keyPrefix?: string;
  serverTTL?: number;
  roomTTL?: number;
  heartbeatInterval?: number;
}

export class RoomSyncService {
  private readonly keyPrefix: string;
  private readonly serverTTL: number;
  private readonly roomTTL: number;
  private readonly serverId: string;
  private heartbeatTimer?: NodeJS.Timeout;
  private readonly log = logger.child({ component: 'RoomSync' });

  private messageHandlers: Map<string, (message: CrossServerMessage) => void> = new Map();

  constructor(
    private redis: RedisService,
    private serverInfo: Omit<ServerInfo, 'serverId' | 'startedAt' | 'lastHeartbeat'>,
    config: RoomSyncConfig = {}
  ) {
    this.keyPrefix = config.keyPrefix ?? 'xogos:';
    this.serverTTL = config.serverTTL ?? 30;
    this.roomTTL = config.roomTTL ?? 3600;
    this.serverId = uuidv4();
  }

  /**
   * Start the room sync service.
   */
  async start(heartbeatInterval: number = 10000): Promise<void> {
    // Register this server
    await this.registerServer();

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat().catch((error) => {
        this.log.error({ error }, 'Heartbeat failed');
      });
    }, heartbeatInterval);

    // Subscribe to cross-server messages
    await this.subscribeToMessages();

    this.log.info({ serverId: this.serverId }, 'Room sync service started');
  }

  /**
   * Stop the room sync service.
   */
  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    // Unregister rooms
    const rooms = await this.getServerRooms(this.serverId);
    for (const room of rooms) {
      await this.unregisterRoom(room.roomId);
    }

    // Unregister server
    await this.redis.del(this.getServerKey(this.serverId));
    await this.redis.sRem(this.getServersSetKey(), this.serverId);

    this.log.info({ serverId: this.serverId }, 'Room sync service stopped');
  }

  /**
   * Get this server's ID.
   */
  getServerId(): string {
    return this.serverId;
  }

  // ============================================================================
  // Server Management
  // ============================================================================

  /**
   * Register this server.
   */
  async registerServer(): Promise<void> {
    const info: ServerInfo = {
      ...this.serverInfo,
      serverId: this.serverId,
      startedAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    await this.redis.set(this.getServerKey(this.serverId), info, this.serverTTL);
    await this.redis.sAdd(this.getServersSetKey(), this.serverId);

    this.log.info({ serverId: this.serverId }, 'Server registered');
  }

  /**
   * Send heartbeat to keep server registration alive.
   */
  async heartbeat(): Promise<void> {
    const key = this.getServerKey(this.serverId);
    const info = await this.redis.get<ServerInfo>(key);

    if (info) {
      info.lastHeartbeat = Date.now();
      info.roomCount = this.serverInfo.roomCount;
      info.clientCount = this.serverInfo.clientCount;
      await this.redis.set(key, info, this.serverTTL);
    } else {
      // Re-register if expired
      await this.registerServer();
    }
  }

  /**
   * Update server stats.
   */
  updateStats(roomCount: number, clientCount: number): void {
    this.serverInfo.roomCount = roomCount;
    this.serverInfo.clientCount = clientCount;
  }

  /**
   * Get all active servers.
   */
  async getActiveServers(): Promise<ServerInfo[]> {
    const serverIds = await this.redis.sMembers<string>(this.getServersSetKey());
    const servers: ServerInfo[] = [];

    for (const id of serverIds) {
      const info = await this.redis.get<ServerInfo>(this.getServerKey(id));
      if (info) {
        servers.push(info);
      } else {
        // Clean up stale reference
        await this.redis.sRem(this.getServersSetKey(), id);
      }
    }

    return servers;
  }

  /**
   * Get server by ID.
   */
  async getServer(serverId: string): Promise<ServerInfo | null> {
    return this.redis.get<ServerInfo>(this.getServerKey(serverId));
  }

  // ============================================================================
  // Room Management
  // ============================================================================

  /**
   * Register a room on this server.
   */
  async registerRoom(roomId: string, gameType: string, maxPlayers: number, isPublic: boolean): Promise<void> {
    const location: RoomLocation = {
      roomId,
      serverId: this.serverId,
      gameType,
      playerCount: 0,
      maxPlayers,
      isPublic,
      createdAt: Date.now(),
    };

    await this.redis.set(this.getRoomKey(roomId), location, this.roomTTL);

    if (isPublic) {
      await this.redis.sAdd(this.getPublicRoomsKey(gameType), roomId);
    }

    await this.redis.sAdd(this.getServerRoomsKey(this.serverId), roomId);

    this.log.debug({ roomId, gameType }, 'Room registered');
  }

  /**
   * Unregister a room.
   */
  async unregisterRoom(roomId: string): Promise<void> {
    const location = await this.redis.get<RoomLocation>(this.getRoomKey(roomId));

    if (location) {
      await this.redis.sRem(this.getPublicRoomsKey(location.gameType), roomId);
      await this.redis.sRem(this.getServerRoomsKey(location.serverId), roomId);
    }

    await this.redis.del(this.getRoomKey(roomId));

    this.log.debug({ roomId }, 'Room unregistered');
  }

  /**
   * Update room player count.
   */
  async updateRoomPlayerCount(roomId: string, playerCount: number): Promise<void> {
    const location = await this.redis.get<RoomLocation>(this.getRoomKey(roomId));
    if (location) {
      location.playerCount = playerCount;
      await this.redis.set(this.getRoomKey(roomId), location, this.roomTTL);
    }
  }

  /**
   * Find which server hosts a room.
   */
  async findRoomServer(roomId: string): Promise<string | null> {
    const location = await this.redis.get<RoomLocation>(this.getRoomKey(roomId));
    return location?.serverId ?? null;
  }

  /**
   * Get room location info.
   */
  async getRoomLocation(roomId: string): Promise<RoomLocation | null> {
    return this.redis.get<RoomLocation>(this.getRoomKey(roomId));
  }

  /**
   * Get all public rooms for a game type.
   */
  async getPublicRooms(gameType: string): Promise<RoomLocation[]> {
    const roomIds = await this.redis.sMembers<string>(this.getPublicRoomsKey(gameType));
    const rooms: RoomLocation[] = [];

    for (const roomId of roomIds) {
      const location = await this.getRoomLocation(roomId);
      if (location && location.playerCount < location.maxPlayers) {
        rooms.push(location);
      } else if (!location) {
        // Clean up stale reference
        await this.redis.sRem(this.getPublicRoomsKey(gameType), roomId);
      }
    }

    return rooms;
  }

  /**
   * Get rooms on a specific server.
   */
  async getServerRooms(serverId: string): Promise<RoomLocation[]> {
    const roomIds = await this.redis.sMembers<string>(this.getServerRoomsKey(serverId));
    const rooms: RoomLocation[] = [];

    for (const roomId of roomIds) {
      const location = await this.getRoomLocation(roomId);
      if (location) {
        rooms.push(location);
      }
    }

    return rooms;
  }

  /**
   * Get total room count across all servers.
   */
  async getTotalRoomCount(): Promise<number> {
    const servers = await this.getActiveServers();
    return servers.reduce((sum, s) => sum + s.roomCount, 0);
  }

  // ============================================================================
  // Cross-Server Messaging
  // ============================================================================

  /**
   * Subscribe to cross-server messages.
   */
  private async subscribeToMessages(): Promise<void> {
    // Subscribe to server-specific channel
    await this.redis.subscribe(`xogos:server:${this.serverId}`, (message) => {
      this.handleMessage(message);
    });

    // Subscribe to broadcast channel
    await this.redis.subscribe('xogos:broadcast', (message) => {
      this.handleMessage(message);
    });
  }

  private handleMessage(messageStr: string): void {
    try {
      const message: CrossServerMessage = JSON.parse(messageStr);

      // Don't process our own messages
      if (message.source === this.serverId) return;

      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message);
      }
    } catch (error) {
      this.log.error({ error }, 'Failed to handle cross-server message');
    }
  }

  /**
   * Register a message handler.
   */
  onMessage(type: CrossServerMessage['type'], handler: (message: CrossServerMessage) => void): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Send a message to a specific room (wherever it's hosted).
   */
  async sendToRoom(roomId: string, payload: unknown): Promise<boolean> {
    const location = await this.getRoomLocation(roomId);
    if (!location) return false;

    const message: CrossServerMessage = {
      type: 'room_message',
      source: this.serverId,
      roomId,
      payload,
      timestamp: Date.now(),
    };

    await this.redis.publish(`xogos:server:${location.serverId}`, JSON.stringify(message));
    return true;
  }

  /**
   * Send a message to a specific player (wherever they are).
   */
  async sendToPlayer(playerId: string, serverId: string, payload: unknown): Promise<void> {
    const message: CrossServerMessage = {
      type: 'player_message',
      source: this.serverId,
      target: serverId,
      playerId,
      payload,
      timestamp: Date.now(),
    };

    await this.redis.publish(`xogos:server:${serverId}`, JSON.stringify(message));
  }

  /**
   * Broadcast a message to all servers.
   */
  async broadcast(payload: unknown): Promise<void> {
    const message: CrossServerMessage = {
      type: 'broadcast',
      source: this.serverId,
      payload,
      timestamp: Date.now(),
    };

    await this.redis.publish('xogos:broadcast', JSON.stringify(message));
  }

  // ============================================================================
  // Key Helpers
  // ============================================================================

  private getServerKey(serverId: string): string {
    return `${this.keyPrefix}server:${serverId}`;
  }

  private getServersSetKey(): string {
    return `${this.keyPrefix}servers`;
  }

  private getRoomKey(roomId: string): string {
    return `${this.keyPrefix}room:${roomId}`;
  }

  private getPublicRoomsKey(gameType: string): string {
    return `${this.keyPrefix}rooms:public:${gameType}`;
  }

  private getServerRoomsKey(serverId: string): string {
    return `${this.keyPrefix}server:${serverId}:rooms`;
  }
}
