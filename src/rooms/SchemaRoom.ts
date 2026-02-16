/**
 * Game On Dude! - Schema-based Room
 * www.gameonguy.com
 *
 * An enhanced Room base class that uses the Schema system for automatic
 * state synchronization with delta/patch updates.
 *
 * Features:
 * - Schema-based state with automatic change detection
 * - Configurable sync modes (full, delta, patch)
 * - State history for interpolation support
 * - Efficient bandwidth usage
 *
 * @example
 * ```typescript
 * // Define your state schema
 * class PlayerSchema extends Schema {
 *   @type("string") id: string = "";
 *   @type("number") x: number = 0;
 *   @type("number") y: number = 0;
 *   @type("number") score: number = 0;
 * }
 *
 * class MyGameState extends Schema {
 *   @type("string") phase: string = "waiting";
 *   @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
 * }
 *
 * // Create your room
 * class MyGameRoom extends SchemaRoom<MyGameState> {
 *   protected createState(): MyGameState {
 *     return new MyGameState();
 *   }
 *
 *   protected onTick(deltaTime: number): void {
 *     // Update state - changes are tracked automatically
 *     this.state.phase = "playing";
 *   }
 * }
 * ```
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
import { Schema, MapSchema, ArraySchema } from '../schema/Schema';
import { StateTracker, SyncMode, StateDelta } from '../schema/StateTracker';

// ============================================================================
// Types
// ============================================================================

interface SchemaRoomEvents {
  [key: string]: (...args: any[]) => void;
  playerJoined: (player: PlayerState) => void;
  playerLeft: (playerId: string) => void;
  playerReady: (playerId: string, ready: boolean) => void;
  stateChanged: (changes: any) => void;
  gameStarted: () => void;
  gameEnded: (results: unknown) => void;
  disposed: () => void;
}

export interface SchemaRoomOptions extends Partial<RoomOptions> {
  id?: string;
  name?: string;
  creatorId?: string;
  /** Sync mode for state updates */
  syncMode?: SyncMode;
  /** How often to force a full state sync (0 = never) */
  fullSyncInterval?: number;
  /** Whether to use checksums for state validation */
  useChecksums?: boolean;
  /** Maximum state history to keep */
  maxStateHistory?: number;
}

// ============================================================================
// Schema Room Base Class
// ============================================================================

/**
 * Base class for rooms using Schema-based state management.
 * Provides automatic change detection and efficient state synchronization.
 */
export abstract class SchemaRoom<TState extends Schema> extends TypedEventEmitter<SchemaRoomEvents> {
  public readonly id: string;
  public readonly name: string;
  public readonly gameType: string;
  public readonly gameMode?: string;
  public readonly createdAt: number;
  public readonly creatorId?: string;

  protected state: TState;
  protected stateTracker: StateTracker<TState>;
  protected players: Map<string, PlayerState> = new Map();
  protected clients: Map<string, Client> = new Map();
  protected roomState: RoomState = RoomState.WAITING;
  protected options: RoomOptions & SchemaRoomOptions;

  private tickInterval?: NodeJS.Timeout;
  private autoDisposeTimeout?: NodeJS.Timeout;
  private lastTickTime: number = 0;

  protected readonly log;

  constructor(gameType: string, options: SchemaRoomOptions = {}) {
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
      syncMode: options.syncMode ?? SyncMode.DELTA,
      fullSyncInterval: options.fullSyncInterval ?? 0,
      useChecksums: options.useChecksums ?? false,
      maxStateHistory: options.maxStateHistory ?? 60,
    };

    // Create state using abstract method
    this.state = this.createState();

    // Initialize state tracker
    this.stateTracker = new StateTracker(this.state, {
      syncMode: this.options.syncMode,
      fullSyncInterval: this.options.fullSyncInterval,
      useChecksums: this.options.useChecksums,
      maxHistory: this.options.maxStateHistory,
    });

    this.log = logger.child({ roomId: this.id, gameType });
    this.log.info({ name: this.name, syncMode: this.options.syncMode }, 'SchemaRoom created');
  }

  // ============================================================================
  // Abstract Methods
  // ============================================================================

  /**
   * Create the initial state schema instance.
   * Override this to return your custom Schema class.
   */
  protected abstract createState(): TState;

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
  // Optional Hooks
  // ============================================================================

  /** Called when a player joins */
  protected onPlayerJoin(player: PlayerState): void {}

  /** Called when a player leaves */
  protected onPlayerLeave(player: PlayerState): void {}

  /** Validate if a player can join */
  protected canJoin(client: Client): boolean | string {
    return true;
  }

  /** Custom message handler */
  protected onMessage(client: Client, message: Message): void {}

  // ============================================================================
  // Player Management
  // ============================================================================

  public async addPlayer(client: Client, password?: string): Promise<PlayerState> {
    if (this.roomState !== RoomState.WAITING) {
      throw new Error('Cannot join room: game already in progress');
    }

    if (this.players.size >= this.options.maxPlayers) {
      throw new Error('Room is full');
    }

    if (this.options.password && this.options.password !== password) {
      throw new Error('Invalid room password');
    }

    const canJoin = this.canJoin(client);
    if (canJoin !== true) {
      throw new Error(typeof canJoin === 'string' ? canJoin : 'Cannot join room');
    }

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

    // Send full state to new player
    this.sendFullState(client);

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

    this.broadcast({
      type: MessageType.PLAYER_LEFT,
      payload: { playerId: clientId },
    });

    this.onPlayerLeave(player);
    this.emit('playerLeft', clientId);

    if (this.players.size === 0 && this.options.autoDispose) {
      this.scheduleAutoDispose();
    }

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

    this.onGameStart();
    this.roomState = RoomState.IN_PROGRESS;

    // Clear any pending changes before starting tick loop
    this.stateTracker.commit();

    this.startTickLoop();

    // Send full state on game start
    this.broadcast({
      type: MessageType.GAME_START,
      payload: { state: this.state.toJSON() },
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

    if (this.options.autoDispose) {
      this.scheduleAutoDispose();
    }
  }

  // ============================================================================
  // Game Loop with Delta Sync
  // ============================================================================

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

    // Sync state based on configured mode
    this.syncState();
  }

  // ============================================================================
  // State Synchronization
  // ============================================================================

  /**
   * Sync state to all clients based on configured mode.
   */
  protected syncState(): void {
    const syncData = this.stateTracker.getSyncData();

    if (!syncData) {
      // No changes to sync
      return;
    }

    switch (syncData.type) {
      case SyncMode.FULL:
        this.broadcastFullState();
        break;

      case SyncMode.DELTA:
        this.broadcastDelta(syncData.data as StateDelta);
        break;

      case SyncMode.PATCH:
        this.broadcastPatches(syncData.data as StatePatch[]);
        break;
    }

    // Commit changes after sync
    this.stateTracker.commit();

    this.emit('stateChanged', syncData.data);
  }

  /**
   * Broadcast full state to all clients.
   */
  protected broadcastFullState(): void {
    const fullState = this.stateTracker.getFullState();

    this.broadcast({
      type: MessageType.STATE_FULL,
      payload: {
        state: fullState.state,
        sequence: fullState.sequence,
        timestamp: fullState.timestamp,
        checksum: fullState.checksum,
      },
    });
  }

  /**
   * Broadcast delta update to all clients.
   */
  protected broadcastDelta(delta: StateDelta): void {
    this.broadcast({
      type: delta.isFullSync ? MessageType.STATE_FULL : MessageType.STATE_PATCH,
      payload: {
        changes: delta.changes,
        sequence: delta.sequence,
        timestamp: delta.timestamp,
        isFullSync: delta.isFullSync,
      },
    });
  }

  /**
   * Broadcast JSON Patch operations to all clients.
   */
  protected broadcastPatches(patches: StatePatch[]): void {
    this.broadcast({
      type: MessageType.STATE_PATCH,
      payload: {
        patches,
        sequence: this.stateTracker.getSequence(),
        timestamp: Date.now(),
      },
    });
  }

  /**
   * Send full state to a specific client.
   */
  protected sendFullState(client: Client): void {
    const fullState = this.stateTracker.getFullState();

    client.send({
      type: MessageType.STATE_FULL,
      payload: {
        state: fullState.state,
        sequence: fullState.sequence,
        timestamp: fullState.timestamp,
        checksum: fullState.checksum,
      },
    });
  }

  /**
   * Force a full state sync to all clients.
   */
  public forceFullSync(): void {
    this.broadcastFullState();
    this.stateTracker.commit();
  }

  // ============================================================================
  // Message Handling
  // ============================================================================

  public handleMessage(client: Client, message: Message): void {
    const player = this.players.get(client.id);
    if (!player) return;

    player.lastActivity = Date.now();
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
  // State Access
  // ============================================================================

  public getState(): TState {
    return this.state;
  }

  public getStateSnapshot(): any {
    return this.stateTracker.getFullState();
  }

  public getStateHistory(count?: number): any[] {
    return this.stateTracker.getRecentHistory(count);
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

  public get syncMode(): SyncMode {
    return this.options.syncMode ?? SyncMode.DELTA;
  }
}
