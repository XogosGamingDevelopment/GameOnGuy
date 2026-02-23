/**
 * Game On Dude! - Base Room
 * www.gameonguy.com
 *
 * Base class for all game rooms. Handles players, state sync, and lifecycle.
 */

import { v4 as uuidv4 } from 'uuid';
import { Client } from '../core/Client';
import { TypedEventEmitter } from '../core/EventEmitter';
import {
  RoomState,
  RoomOptions,
  RoomInfo,
  PlayerState,
  Message,
  MessageType,
  StatePatch,
  GameAction,
} from '../core/types';
import logger from '../core/Logger';

interface RoomEvents {
  [key: string]: (...args: any[]) => void;
  playerJoined: (player: PlayerState) => void;
  playerLeft: (playerId: string) => void;
  playerReady: (playerId: string, ready: boolean) => void;
  stateChanged: () => void;
  gameStarted: () => void;
  gameEnded: (results: unknown) => void;
  disposed: () => void;
}

export interface RoomConstructorOptions extends Partial<RoomOptions> {
  id?: string;
  name?: string;
  creatorId?: string;
  /** If true, room was created from matchmaking timeout - spawn bot immediately */
  fromMatchmakingTimeout?: boolean;
}

export abstract class Room<TState = any> extends TypedEventEmitter<RoomEvents> {
  public readonly id: string;
  public readonly name: string;
  public readonly gameType: string;
  public readonly gameMode?: string;
  public readonly createdAt: number;
  public readonly creatorId?: string;

  protected state: TState;
  protected players: Map<string, PlayerState> = new Map();
  protected clients: Map<string, Client> = new Map();
  protected roomState: RoomState = RoomState.WAITING;
  protected options: RoomOptions;

  private tickInterval?: NodeJS.Timeout;
  private stateSequence: number = 0;
  private autoDisposeTimeout?: NodeJS.Timeout;

  protected readonly log;

  constructor(gameType: string, options: RoomConstructorOptions = {}) {
    super();

    this.id = options.id ?? uuidv4();
    this.name = options.name ?? `${gameType}-${this.id.slice(0, 8)}`;
    this.gameType = gameType;
    this.gameMode = options.gameMode;
    this.createdAt = Date.now();
    this.creatorId = options.creatorId;

    this.options = {
      maxPlayers: options.maxPlayers ?? 10,
      minPlayers: options.minPlayers ?? 2,
      isPrivate: options.isPrivate ?? false,
      password: options.password,
      gameType,
      gameMode: options.gameMode,
      tickRate: options.tickRate ?? 20,
      metadata: options.metadata ?? {},
      autoStart: options.autoStart ?? false,
      autoDispose: options.autoDispose ?? true,
      autoDisposeDelay: options.autoDisposeDelay ?? 30000,
    };

    this.state = this.initializeState();

    this.log = logger.child({ roomId: this.id, gameType });
    this.log.info({ name: this.name }, 'Room created');
  }

  // ============================================================================
  // Abstract methods - must be implemented by game-specific rooms
  // ============================================================================

  /**
   * Initialize the game state. Called once when room is created.
   */
  protected abstract initializeState(): TState;

  /**
   * Called every tick. Update game state here.
   * @param deltaTime Time since last tick in milliseconds
   */
  protected abstract onTick(deltaTime: number): void;

  /**
   * Handle a game action from a player.
   */
  protected abstract onGameAction(player: PlayerState, action: GameAction): void;

  /**
   * Called when all minimum players are ready and game should start.
   */
  protected abstract onGameStart(): void;

  /**
   * Called when game ends. Return results.
   */
  protected abstract onGameEnd(): unknown;

  // ============================================================================
  // Optional hooks - can be overridden
  // ============================================================================

  /**
   * Called when a player joins. Can be used to initialize player-specific state.
   */
  protected onPlayerJoin(player: PlayerState): void {}

  /**
   * Called when a player leaves. Can be used to clean up player-specific state.
   */
  protected onPlayerLeave(player: PlayerState): void {}

  /**
   * Validate if a player can join this room.
   */
  protected canJoin(client: Client): boolean | string {
    return true;
  }

  /**
   * Custom message handler for game-specific messages.
   */
  protected onMessage(client: Client, message: Message): void {}

  // ============================================================================
  // Player Management
  // ============================================================================

  public async addPlayer(client: Client, password?: string): Promise<PlayerState> {
    // Check room state
    if (this.roomState !== RoomState.WAITING) {
      throw new Error('Cannot join room: game already in progress');
    }

    // Check capacity
    if (this.players.size >= this.options.maxPlayers) {
      throw new Error('Room is full');
    }

    // Check password if private
    if (this.options.password && this.options.password !== password) {
      throw new Error('Invalid room password');
    }

    // Check custom validation
    const canJoin = this.canJoin(client);
    if (canJoin !== true) {
      throw new Error(typeof canJoin === 'string' ? canJoin : 'Cannot join room');
    }

    // Create player state
    const player: PlayerState = {
      id: client.id,
      sessionId: client.sessionId,
      userId: client.userId,
      username: client.username ?? `Player${this.players.size + 1}`,
      isReady: false,
      isConnected: true,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
      data: {},
    };

    this.players.set(client.id, player);
    this.clients.set(client.id, client);
    client.setRoom(this.id);

    // Clear auto-dispose timeout
    if (this.autoDisposeTimeout) {
      clearTimeout(this.autoDisposeTimeout);
      this.autoDisposeTimeout = undefined;
    }

    this.log.info({ playerId: client.id, playerCount: this.players.size }, 'Player joined');

    // Notify existing players
    this.broadcastExcept(client.id, {
      type: MessageType.PLAYER_JOINED,
      payload: player,
    });

    // Call hook
    this.onPlayerJoin(player);
    this.emit('playerJoined', player);

    return player;
  }

  public async removePlayer(clientId: string): Promise<void> {
    const player = this.players.get(clientId);
    const client = this.clients.get(clientId);

    if (!player) return;

    this.players.delete(clientId);
    this.clients.delete(clientId);

    if (client) {
      client.setRoom(undefined);
    }

    this.log.info({ playerId: clientId, playerCount: this.players.size }, 'Player left');

    // Notify remaining players
    this.broadcast({
      type: MessageType.PLAYER_LEFT,
      payload: { playerId: clientId },
    });

    // Call hook
    this.onPlayerLeave(player);
    this.emit('playerLeft', clientId);

    // Check if room should be disposed
    if (this.players.size === 0 && this.options.autoDispose) {
      this.scheduleAutoDispose();
    }

    // Check if game should end due to insufficient players
    if (this.roomState === RoomState.IN_PROGRESS && this.players.size < this.options.minPlayers) {
      this.endGame();
    }
  }

  public setPlayerReady(clientId: string, ready: boolean): void {
    const player = this.players.get(clientId);
    if (!player) return;

    player.isReady = ready;
    player.lastActivity = Date.now();

    this.broadcast({
      type: MessageType.PLAYER_READY,
      payload: { playerId: clientId, ready },
    });

    this.emit('playerReady', clientId, ready);

    // Check if all players are ready
    if (this.options.autoStart) {
      this.checkAutoStart();
    }
  }

  private checkAutoStart(): void {
    if (this.roomState !== RoomState.WAITING) return;
    if (this.players.size < this.options.minPlayers) return;

    const allReady = Array.from(this.players.values()).every((p) => p.isReady);
    if (allReady) {
      this.startGame();
    }
  }

  // ============================================================================
  // Game Lifecycle
  // ============================================================================

  public startGame(): void {
    if (this.roomState !== RoomState.WAITING) {
      this.log.warn('Cannot start game: not in waiting state');
      return;
    }

    if (this.players.size < this.options.minPlayers) {
      this.log.warn('Cannot start game: not enough players');
      return;
    }

    this.roomState = RoomState.STARTING;
    this.log.info('Starting game');

    // Call game-specific start logic
    this.onGameStart();

    this.roomState = RoomState.IN_PROGRESS;

    // Start game loop
    this.startTickLoop();

    // Notify players
    this.broadcast({
      type: MessageType.GAME_START,
      payload: { state: this.state },
    });

    this.emit('gameStarted');
  }

  public endGame(): void {
    if (this.roomState !== RoomState.IN_PROGRESS) return;

    this.roomState = RoomState.FINISHED;
    this.stopTickLoop();

    const results = this.onGameEnd();

    this.broadcast({
      type: MessageType.GAME_END,
      payload: { results },
    });

    this.log.info({ results }, 'Game ended');
    this.emit('gameEnded', results);

    // Schedule room disposal
    if (this.options.autoDispose) {
      this.scheduleAutoDispose();
    }
  }

  // ============================================================================
  // Game Loop
  // ============================================================================

  private lastTickTime: number = 0;

  private startTickLoop(): void {
    const tickInterval = 1000 / this.options.tickRate;
    this.lastTickTime = Date.now();

    this.tickInterval = setInterval(() => {
      const now = Date.now();
      const deltaTime = now - this.lastTickTime;
      this.lastTickTime = now;

      this.tick(deltaTime);
    }, tickInterval);
  }

  private stopTickLoop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
  }

  private tick(deltaTime: number): void {
    if (this.roomState !== RoomState.IN_PROGRESS) return;

    // Call game-specific tick
    this.onTick(deltaTime);

    // Broadcast state update
    this.broadcastState();
  }

  // ============================================================================
  // State Synchronization
  // ============================================================================

  protected broadcastState(): void {
    this.stateSequence++;

    this.broadcast({
      type: MessageType.STATE_FULL,
      payload: {
        state: this.state,
        sequence: this.stateSequence,
      },
    });
  }

  protected broadcastPatch(patches: StatePatch[]): void {
    this.stateSequence++;

    this.broadcast({
      type: MessageType.STATE_PATCH,
      payload: {
        patches,
        sequence: this.stateSequence,
      },
    });
  }

  public getState(): TState {
    return this.state;
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  public handleMessage(client: Client, message: Message): void {
    const player = this.players.get(client.id);
    if (!player) return;

    player.lastActivity = Date.now();

    // Handle in subclass
    this.onMessage(client, message);
  }

  public handleGameAction(client: Client, action: any): void {
    const player = this.players.get(client.id);
    if (!player) return;

    if (this.roomState !== RoomState.IN_PROGRESS) {
      client.sendError('Game not in progress');
      return;
    }

    player.lastActivity = Date.now();

    const gameAction: GameAction = {
      type: action.type,
      playerId: client.id,
      data: action.data,
      timestamp: Date.now(),
      sequence: action.sequence,
    };

    this.onGameAction(player, gameAction);
  }

  // ============================================================================
  // Broadcasting
  // ============================================================================

  public broadcast(message: Message): void {
    this.clients.forEach((client) => {
      client.send(message);
    });
  }

  public broadcastExcept(excludeClientId: string, message: Message): void {
    this.clients.forEach((client, id) => {
      if (id !== excludeClientId) {
        client.send(message);
      }
    });
  }

  public sendToPlayer(playerId: string, message: Message): void {
    const client = this.clients.get(playerId);
    if (client) {
      client.send(message);
    }
  }

  // ============================================================================
  // Room Info & Disposal
  // ============================================================================

  public getInfo(): RoomInfo {
    return {
      id: this.id,
      name: this.name,
      gameType: this.gameType,
      gameMode: this.gameMode,
      state: this.roomState,
      playerCount: this.players.size,
      maxPlayers: this.options.maxPlayers,
      isPrivate: this.options.isPrivate,
      hasPassword: !!this.options.password,
      createdAt: this.createdAt,
      metadata: this.options.metadata,
    };
  }

  public getPlayers(): PlayerState[] {
    return Array.from(this.players.values());
  }

  public getPlayer(playerId: string): PlayerState | undefined {
    return this.players.get(playerId);
  }

  private scheduleAutoDispose(): void {
    if (this.autoDisposeTimeout) {
      clearTimeout(this.autoDisposeTimeout);
    }

    this.autoDisposeTimeout = setTimeout(() => {
      this.dispose();
    }, this.options.autoDisposeDelay);
  }

  public dispose(): void {
    this.log.info('Disposing room');

    this.stopTickLoop();

    if (this.autoDisposeTimeout) {
      clearTimeout(this.autoDisposeTimeout);
    }

    // Notify and disconnect all players
    this.broadcast({
      type: MessageType.ROOM_CLOSED,
      payload: { reason: 'Room disposed' },
    });

    this.clients.forEach((client) => {
      client.setRoom(undefined);
    });

    this.players.clear();
    this.clients.clear();
    this.roomState = RoomState.CLOSED;

    this.emit('disposed');
  }

  public get currentState(): RoomState {
    return this.roomState;
  }

  public get playerCount(): number {
    return this.players.size;
  }
}
