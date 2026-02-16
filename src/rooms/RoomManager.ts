/**
 * Game On Dude! - Room Manager
 * www.gameonguy.com
 *
 * Manages room creation, lookup, and lifecycle.
 */

import { Room, RoomConstructorOptions } from './Room';
import { Client } from '../core/Client';
import { RoomInfo, RoomListFilter, RoomState } from '../core/types';
import logger from '../core/Logger';

type RoomConstructor = new (
  gameType: string,
  options?: any
) => Room<any>;

interface RegisteredGame {
  constructor: RoomConstructor;
  config: {
    name: string;
    minPlayers: number;
    maxPlayers: number;
    defaultTickRate: number;
  };
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private registeredGames: Map<string, RegisteredGame> = new Map();
  private server: any; // Reference to main server

  private readonly log = logger.child({ component: 'RoomManager' });

  constructor(server: any) {
    this.server = server;
  }

  /**
   * Register a game type with its room class.
   */
  public registerGame(
    gameType: string,
    roomClass: RoomConstructor,
    config: RegisteredGame['config']
  ): void {
    this.registeredGames.set(gameType, {
      constructor: roomClass,
      config,
    });
    this.log.info({ gameType, config }, 'Game type registered');
  }

  /**
   * Create a new room for the specified game type.
   */
  public async createRoom(gameType: string, options: RoomConstructorOptions = {}): Promise<Room> {
    const registeredGame = this.registeredGames.get(gameType);

    if (!registeredGame) {
      throw new Error(`Unknown game type: ${gameType}`);
    }

    // Apply defaults from game config
    const roomOptions: RoomConstructorOptions = {
      minPlayers: registeredGame.config.minPlayers,
      maxPlayers: registeredGame.config.maxPlayers,
      tickRate: registeredGame.config.defaultTickRate,
      ...options,
    };

    const room = new registeredGame.constructor(gameType, roomOptions);

    // Set up room event handlers
    room.on('disposed', () => {
      this.rooms.delete(room.id);
      this.log.info({ roomId: room.id }, 'Room removed from manager');
    });

    this.rooms.set(room.id, room);
    this.log.info({ roomId: room.id, gameType }, 'Room created');

    return room;
  }

  /**
   * Get a room by ID.
   */
  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Join a client to a room.
   */
  public async joinRoom(roomId: string, client: Client, password?: string): Promise<void> {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    // Leave current room if in one
    if (client.currentRoomId && client.currentRoomId !== roomId) {
      await this.leaveRoom(client.currentRoomId, client);
    }

    await room.addPlayer(client, password);
  }

  /**
   * Remove a client from a room.
   */
  public async leaveRoom(roomId: string, client: Client): Promise<void> {
    const room = this.rooms.get(roomId);

    if (room) {
      await room.removePlayer(client.id);
    }
  }

  /**
   * List available rooms with optional filtering.
   */
  public listRooms(filter?: RoomListFilter): RoomInfo[] {
    const rooms: RoomInfo[] = [];

    this.rooms.forEach((room) => {
      const info = room.getInfo();

      // Apply filters
      if (filter) {
        if (filter.gameType && info.gameType !== filter.gameType) return;
        if (filter.gameMode && info.gameMode !== filter.gameMode) return;
        if (filter.state && info.state !== filter.state) return;
        if (filter.isPrivate !== undefined && info.isPrivate !== filter.isPrivate) return;
        if (filter.hasSpace && info.playerCount >= info.maxPlayers) return;
      }

      // Don't list closed rooms
      if (info.state === RoomState.CLOSED) return;

      rooms.push(info);
    });

    return rooms;
  }

  /**
   * Find or create a room for quick join.
   */
  public async findOrCreateRoom(
    gameType: string,
    gameMode?: string,
    options?: RoomConstructorOptions
  ): Promise<Room> {
    // Try to find an existing room with space
    const availableRooms = this.listRooms({
      gameType,
      gameMode,
      state: RoomState.WAITING,
      hasSpace: true,
      isPrivate: false,
    });

    if (availableRooms.length > 0) {
      // Join the room with the most players (to fill rooms faster)
      availableRooms.sort((a, b) => b.playerCount - a.playerCount);
      const room = this.rooms.get(availableRooms[0].id);
      if (room) {
        return room;
      }
    }

    // Create a new room
    return this.createRoom(gameType, { ...options, gameMode });
  }

  /**
   * Get total room count.
   */
  public getRoomCount(): number {
    return this.rooms.size;
  }

  /**
   * Get rooms by game type.
   */
  public getRoomsByGameType(gameType: string): Room[] {
    const rooms: Room[] = [];
    this.rooms.forEach((room) => {
      if (room.gameType === gameType) {
        rooms.push(room);
      }
    });
    return rooms;
  }

  /**
   * Get all registered game types.
   */
  public getRegisteredGameTypes(): string[] {
    return Array.from(this.registeredGames.keys());
  }

  /**
   * Get game config for a game type.
   */
  public getGameConfig(gameType: string): RegisteredGame['config'] | undefined {
    return this.registeredGames.get(gameType)?.config;
  }

  /**
   * Dispose all rooms (for shutdown).
   */
  public disposeAll(): void {
    this.rooms.forEach((room) => {
      room.dispose();
    });
    this.rooms.clear();
  }
}
