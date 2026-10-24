/**
 * Game On Dude! - Room Manager
 * www.gameonguy.com
 *
 * Manages room creation, lookup, and lifecycle.
 */

import { randomInt } from 'crypto';
import { Room, RoomConstructorOptions, RoomError } from './Room';
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
  private joinCodes: Map<string, string> = new Map(); // code -> roomId
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

    if (room.wantsJoinCode()) {
      room.joinCode = this.generateJoinCode(room.joinCodeLength());
      this.joinCodes.set(room.joinCode, room.id);
    }

    // Set up room event handlers
    room.on('disposed', () => {
      this.rooms.delete(room.id);
      if (room.joinCode) this.joinCodes.delete(room.joinCode);
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
   * Resolve a short join code (case-insensitive) to a room id.
   */
  public findRoomIdByCode(code: string): string | undefined {
    if (typeof code !== 'string') return undefined;
    return this.joinCodes.get(code.trim().toUpperCase());
  }

  /**
   * Generate an unused join code (5 letters by default, 6 for rooms that ask).
   * Consonants only (no vowels, no look-alike I/O), so a code can never spell
   * a word — these rooms are used by K-12 students. 20^5 = 3.2M, 20^6 = 64M.
   */
  private generateJoinCode(length: number = 5): string {
    const alphabet = 'BCDFGHJKLMNPQRSTVWXZ';
    // Bounded (Phase 15 lesson: no unbounded loops on the event loop).
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < length; i++) {
        code += alphabet[randomInt(alphabet.length)];
      }
      if (!this.joinCodes.has(code)) return code;
    }
    throw new Error('Could not allocate a room code. Please try again.');
  }

  /**
   * Join a client to a room.
   */
  public async joinRoom(
    roomId: string,
    client: Client,
    password?: string,
    playerData?: unknown
  ): Promise<void> {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new RoomError('Room not found', 'ROOM_NOT_FOUND');
    }

    // Leave current room if in one
    if (client.currentRoomId && client.currentRoomId !== roomId) {
      await this.leaveRoom(client.currentRoomId, client);
    }

    await room.addPlayer(client, password, playerData);
  }

  /**
   * Take back a held seat after a dropped connection (rooms with a rejoin hold).
   */
  public async rejoinRoom(roomId: string, client: Client, rejoinToken: unknown): Promise<void> {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new RoomError('Room not found', 'ROOM_NOT_FOUND');
    }

    if (client.currentRoomId && client.currentRoomId !== roomId) {
      await this.leaveRoom(client.currentRoomId, client);
    }

    room.rejoin(client, rejoinToken);
  }

  /**
   * The client's connection dropped (vs. an explicit room_leave).
   */
  public async disconnectFromRoom(roomId: string, client: Client): Promise<void> {
    const room = this.rooms.get(roomId);

    if (room) {
      await room.handleDisconnect(client);
    }
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
      // Rooms can opt out of discovery entirely (e.g. panic_attack)
      if (!room.isListed()) return;

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
