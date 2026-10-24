/**
 * Game On Dude! - Base Room
 * www.gameonguy.com
 *
 * Base class for all game rooms. Handles players, state sync, and lifecycle.
 */

import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
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

/**
 * A room refusal with a stable machine-readable code, sent to the client as
 * room_error { message, code }. Clients should match on `code`, not `message`.
 */
export class RoomError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'RoomError';
  }
}

export interface RoomConstructorOptions extends Partial<RoomOptions> {
  id?: string;
  name?: string;
  creatorId?: string;
  /** If true, room was created from matchmaking timeout - spawn bot immediately */
  fromMatchmakingTimeout?: boolean;
  /** If true, room was created by the matchmaker (server-internal; stripped from client room_create) */
  fromMatchmaking?: boolean;
}

export abstract class Room<TState = any> extends TypedEventEmitter<RoomEvents> {
  public readonly id: string;
  public readonly name: string;
  public readonly gameType: string;
  public readonly gameMode?: string;
  public readonly createdAt: number;
  public readonly creatorId?: string;
  /** Short join code, assigned by RoomManager when wantsJoinCode() is true */
  public joinCode?: string;

  protected state: TState;
  protected players: Map<string, PlayerState> = new Map();
  protected clients: Map<string, Client> = new Map();
  protected roomState: RoomState = RoomState.WAITING;
  protected options: RoomOptions;

  private tickInterval?: NodeJS.Timeout;
  private stateSequence: number = 0;
  private autoDisposeTimeout?: NodeJS.Timeout;

  /** playerId -> secret a dropped player presents to take their seat back */
  private rejoinTokens: Map<string, string> = new Map();
  /** playerId -> timer that removes a disconnected player when the hold runs out */
  private holdTimers: Map<string, NodeJS.Timeout> = new Map();
  /** clientId -> playerId, for connections that rejoined an earlier player's seat */
  private clientPlayers: Map<string, string> = new Map();

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

  /**
   * Display name stored for a joining player. Override to control what other
   * players see (e.g. hide names in stranger matches).
   */
  protected displayNameFor(client: Client): string {
    return client.username ?? `Player${this.players.size + 1}`;
  }

  /**
   * The player object other players receive in player_joined. Override to
   * hide fields (userId, sessionId) from peers.
   */
  protected toPublicPlayer(player: PlayerState): unknown {
    return player;
  }

  /** Whether RoomManager should assign this room a short join code. */
  public wantsJoinCode(): boolean {
    return false;
  }

  /** Whether this room appears in room_list. */
  public isListed(): boolean {
    return true;
  }

  /** Length of the join code RoomManager assigns (see wantsJoinCode). */
  public joinCodeLength(): number {
    return 5;
  }

  /**
   * How long (ms) a dropped player's seat is held for a rejoin. 0 (default)
   * removes them immediately, as before. When > 0, players get a rejoinToken
   * in room_created/room_joined and peers see player_disconnected first.
   */
  protected rejoinHoldMs(): number {
    return 0;
  }

  /**
   * Whitelist the player info a client may attach (room_create / room_join
   * `playerData`, player_ready). Return null to drop it (default: rooms carry
   * no client-supplied player info).
   */
  protected sanitizePlayerData(_raw: unknown): Record<string, unknown> | null {
    return null;
  }

  /** Where player info lives in a player_ready payload. */
  protected playerDataFromReady(payload: any): unknown {
    return payload?.playerData;
  }

  /** The player_ready broadcast. */
  protected readyBroadcastPayload(player: PlayerState): Record<string, unknown> {
    const payload: Record<string, unknown> = { playerId: player.id, ready: player.isReady };
    if (Object.keys(player.data).length > 0) payload.data = player.data;
    return payload;
  }

  /** Called when a player's connection drops and their seat is being held. */
  protected onPlayerDisconnect(_player: PlayerState): void {}

  /** Called when a held player rejoins. */
  protected onPlayerReconnect(_player: PlayerState): void {}

  /** The player id a connection plays as (differs from client.id after a rejoin). */
  public playerIdOf(client: Client): string {
    return this.clientPlayers.get(client.id) ?? client.id;
  }

  // ============================================================================
  // Player Management
  // ============================================================================

  public async addPlayer(client: Client, password?: string, playerData?: unknown): Promise<PlayerState> {
    // Check room state
    if (this.roomState !== RoomState.WAITING) {
      throw new RoomError('Cannot join room: game already in progress', 'GAME_IN_PROGRESS');
    }

    // Check capacity
    if (this.players.size >= this.options.maxPlayers) {
      throw new RoomError('Room is full', 'ROOM_FULL');
    }

    // Check password if private
    if (this.options.password && this.options.password !== password) {
      throw new RoomError('Invalid room password', 'BAD_PASSWORD');
    }

    // Check custom validation
    const canJoin = this.canJoin(client);
    if (canJoin !== true) {
      throw new RoomError(typeof canJoin === 'string' ? canJoin : 'Cannot join room', 'CANNOT_JOIN');
    }

    // Create player state
    const player: PlayerState = {
      id: client.id,
      sessionId: client.sessionId,
      userId: client.userId,
      username: this.displayNameFor(client),
      isReady: false,
      isConnected: true,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
      data: this.sanitizePlayerData(playerData) ?? {},
    };

    this.players.set(client.id, player);
    this.clients.set(client.id, client);
    client.setRoom(this.id);
    if (this.rejoinHoldMs() > 0) {
      this.rejoinTokens.set(client.id, randomBytes(24).toString('hex'));
    }

    // Clear auto-dispose timeout
    if (this.autoDisposeTimeout) {
      clearTimeout(this.autoDisposeTimeout);
      this.autoDisposeTimeout = undefined;
    }

    this.log.info({ playerId: client.id, playerCount: this.players.size }, 'Player joined');

    // Notify existing players
    this.broadcastExcept(client.id, {
      type: MessageType.PLAYER_JOINED,
      payload: this.toPublicPlayer(player),
    });

    // Call hook
    this.onPlayerJoin(player);
    this.emit('playerJoined', player);

    return player;
  }

  public async removePlayer(id: string): Promise<void> {
    // Accept a connection id or a player id (they differ after a rejoin).
    const clientId = this.clientPlayers.get(id) ?? id;
    const player = this.players.get(clientId);
    const client = this.clients.get(clientId);

    if (!player) return;

    this.players.delete(clientId);
    this.clients.delete(clientId);
    this.rejoinTokens.delete(clientId);
    this.clearHoldTimer(clientId);

    if (client) {
      this.clientPlayers.delete(client.id);
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

  /**
   * The connection dropped (as opposed to an explicit room_leave). Rooms with
   * a rejoin hold keep the seat for rejoinHoldMs(); others remove the player.
   */
  public async handleDisconnect(client: Client): Promise<void> {
    const playerId = this.playerIdOf(client);
    // A connection that was already replaced by a rejoin no longer owns the seat.
    if (this.clients.get(playerId) !== client) return;

    const holdMs = this.rejoinHoldMs();
    const player = this.players.get(playerId);
    if (!player || holdMs <= 0 || this.roomState === RoomState.CLOSED) {
      await this.removePlayer(playerId);
      return;
    }

    player.isConnected = false;
    this.clients.delete(playerId);
    this.clientPlayers.delete(client.id);
    client.setRoom(undefined);

    this.log.info({ playerId, holdMs }, 'Player disconnected; holding seat');

    this.broadcast({
      type: MessageType.PLAYER_DISCONNECTED,
      payload: { playerId, holdMs },
    });
    this.onPlayerDisconnect(player);

    this.clearHoldTimer(playerId);
    this.holdTimers.set(
      playerId,
      setTimeout(() => {
        this.holdTimers.delete(playerId);
        this.removePlayer(playerId).catch((error) => {
          this.log.error({ error, playerId }, 'Failed to remove player after rejoin hold');
        });
      }, holdMs)
    );
  }

  /**
   * Put a connection back in the seat of the player the token belongs to.
   * Only the same signed-in user may rejoin (the token alone is not enough).
   */
  public rejoin(client: Client, rejoinToken: unknown): PlayerState {
    let playerId: string | undefined;
    if (typeof rejoinToken === 'string') {
      for (const [id, token] of this.rejoinTokens) {
        if (token === rejoinToken) playerId = id;
      }
    }
    const player = playerId ? this.players.get(playerId) : undefined;
    if (!playerId || !player || player.userId !== client.userId) {
      throw new RoomError('This rejoin link has expired. Please join the room again.', 'BAD_REJOIN_TOKEN');
    }

    // The old connection may not have noticed it dropped yet (busy Wi-Fi).
    const old = this.clients.get(playerId);
    if (old && old !== client) {
      old.setRoom(undefined);
      this.clientPlayers.delete(old.id);
      old.close(4001, 'Rejoined from another connection');
    }

    this.clearHoldTimer(playerId);
    this.clients.set(playerId, client);
    if (client.id !== playerId) this.clientPlayers.set(client.id, playerId);
    client.setRoom(this.id);
    player.isConnected = true;
    player.lastActivity = Date.now();

    this.log.info({ playerId }, 'Player rejoined');

    this.broadcastExcept(playerId, {
      type: MessageType.PLAYER_RECONNECTED,
      payload: { playerId },
    });
    this.onPlayerReconnect(player);

    return player;
  }

  public getRejoinToken(playerId: string): string | undefined {
    return this.rejoinTokens.get(playerId);
  }

  private clearHoldTimer(playerId: string): void {
    const timer = this.holdTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.holdTimers.delete(playerId);
    }
  }

  public setPlayerReady(id: string, ready: boolean, payload?: unknown): void {
    const clientId = this.clientPlayers.get(id) ?? id;
    const player = this.players.get(clientId);
    if (!player) return;

    player.isReady = ready;
    player.lastActivity = Date.now();

    const data = this.sanitizePlayerData(this.playerDataFromReady(payload));
    if (data) Object.assign(player.data, data);

    this.broadcast({
      type: MessageType.PLAYER_READY,
      payload: this.readyBroadcastPayload(player),
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
    const player = this.players.get(this.playerIdOf(client));
    if (!player) return;

    player.lastActivity = Date.now();

    // Handle in subclass
    this.onMessage(client, message);
  }

  public handleGameAction(client: Client, action: any): void {
    const player = this.players.get(this.playerIdOf(client));
    if (!player) return;

    if (this.roomState !== RoomState.IN_PROGRESS) {
      client.sendError('Game not in progress');
      return;
    }

    player.lastActivity = Date.now();

    const gameAction: GameAction = {
      type: action.type,
      playerId: player.id,
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
      joinCode: this.joinCode,
    };
  }

  /** getInfo() plus the roster — sent only to the room's own players (room_created / room_joined). */
  public getMemberInfo(): RoomInfo & { players: unknown[] } {
    return {
      ...this.getInfo(),
      players: Array.from(this.players.values()).map((p) => this.toPublicPlayer(p)),
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

  public dispose(reason: string = 'Room disposed', extra: Record<string, unknown> = {}): void {
    // Idempotent: a room can be closed directly (e.g. its host left) and then
    // again by a pending auto-dispose timer.
    if (this.roomState === RoomState.CLOSED) return;

    this.log.info({ reason }, 'Disposing room');

    this.stopTickLoop();

    if (this.autoDisposeTimeout) {
      clearTimeout(this.autoDisposeTimeout);
    }
    this.holdTimers.forEach((timer) => clearTimeout(timer));
    this.holdTimers.clear();
    this.rejoinTokens.clear();
    this.clientPlayers.clear();

    // Notify and disconnect all players
    this.broadcast({
      type: MessageType.ROOM_CLOSED,
      payload: { reason, ...extra },
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
