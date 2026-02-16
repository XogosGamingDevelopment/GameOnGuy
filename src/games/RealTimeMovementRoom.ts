/**
 * Game On Dude! - Real-Time Movement Room
 * www.gameonguy.com
 *
 * Base room for games with real-time player movement like Number Munchers and Panic Attack.
 * Handles position sync, collision detection, and high-frequency updates.
 */

import { Room, RoomConstructorOptions } from '../rooms/Room';
import { PlayerState, GameAction, Message, MessageType } from '../core/types';
import { Client } from '../core/Client';

// ============================================================================
// Types
// ============================================================================

export interface Vector2 {
  x: number;
  y: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vector3;
  rotation: number; // Y-axis rotation in degrees
  velocity?: Vector3;
}

export interface PlayerMovementData {
  transform: Transform;
  speed: number;
  isMoving: boolean;
  animation?: string;
  lastInputSequence: number;
  lastProcessedTime: number;
}

export interface GridCell {
  x: number;
  y: number;
  content?: unknown;
  occupiedBy?: string;
}

export interface MovementState {
  phase: 'waiting' | 'countdown' | 'playing' | 'paused' | 'ended';
  gameTime: number;
  countdown: number;
  players: Record<string, PlayerMovementData>;
  worldBounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  grid?: GridCell[][];
  entities: Record<string, Entity>;
}

export interface Entity {
  id: string;
  type: string;
  transform: Transform;
  data: Record<string, unknown>;
  isActive: boolean;
}

export interface MovementInput {
  sequence: number;
  timestamp: number;
  direction: Vector2;
  actions: string[];
}

export interface MovementRoomOptions extends RoomConstructorOptions {
  worldBounds?: MovementState['worldBounds'];
  gridSize?: { width: number; height: number };
  playerSpeed?: number;
  useGrid?: boolean;
  countdownTime?: number;
  gameTimeLimit?: number;
}

// ============================================================================
// Real-Time Movement Room Implementation
// ============================================================================

export class RealTimeMovementRoom extends Room<MovementState> {
  protected playerSpeed: number;
  protected useGrid: boolean;
  protected countdownTime: number;
  protected gameTimeLimit: number;
  protected gameTimer?: NodeJS.Timeout;

  // Input buffer for lag compensation
  private inputBuffer: Map<string, MovementInput[]> = new Map();
  private readonly maxInputBufferSize = 60;

  constructor(gameType: string, options: MovementRoomOptions = {}) {
    super(gameType, {
      ...options,
      tickRate: options.tickRate ?? 20, // 20 Hz for movement games
    });

    this.playerSpeed = options.playerSpeed ?? 5;
    this.useGrid = options.useGrid ?? false;
    this.countdownTime = options.countdownTime ?? 3;
    this.gameTimeLimit = options.gameTimeLimit ?? 0; // 0 = no limit
  }

  protected initializeState(): MovementState {
    return {
      phase: 'waiting',
      gameTime: 0,
      countdown: this.countdownTime,
      players: {},
      worldBounds: { minX: -50, maxX: 50, minY: 0, maxY: 10, minZ: -50, maxZ: 50 },
      entities: {},
    };
  }

  protected onPlayerJoin(player: PlayerState): void {
    // Initialize player movement data with spawn position
    const spawnPosition = this.getSpawnPosition(player.id);

    this.state.players[player.id] = {
      transform: {
        position: spawnPosition,
        rotation: 0,
        velocity: { x: 0, y: 0, z: 0 },
      },
      speed: this.playerSpeed,
      isMoving: false,
      lastInputSequence: 0,
      lastProcessedTime: Date.now(),
    };

    this.inputBuffer.set(player.id, []);

    // Notify all players of new player position
    this.broadcast({
      type: 'player_spawned',
      payload: {
        playerId: player.id,
        username: player.username,
        transform: this.state.players[player.id].transform,
      },
    });
  }

  protected onPlayerLeave(player: PlayerState): void {
    delete this.state.players[player.id];
    this.inputBuffer.delete(player.id);

    this.broadcast({
      type: 'player_despawned',
      payload: { playerId: player.id },
    });
  }

  protected onGameStart(): void {
    this.log.info('Starting countdown');
    this.state.phase = 'countdown';
    this.state.countdown = this.countdownTime;

    this.broadcast({
      type: 'countdown_start',
      payload: { countdown: this.countdownTime },
    });
  }

  protected onGameEnd(): unknown {
    if (this.gameTimer) {
      clearTimeout(this.gameTimer);
    }

    return {
      gameTime: this.state.gameTime,
      players: this.state.players,
    };
  }

  protected onTick(deltaTime: number): void {
    const dt = deltaTime / 1000; // Convert to seconds

    switch (this.state.phase) {
      case 'countdown':
        this.updateCountdown(dt);
        break;

      case 'playing':
        this.updateGame(dt);
        break;
    }
  }

  protected onGameAction(player: PlayerState, action: GameAction): void {
    switch (action.type) {
      case 'move':
        this.handleMovementInput(player, action.data as MovementInput);
        break;

      case 'action':
        this.handlePlayerAction(player, action.data as { action: string; target?: string });
        break;

      case 'interact':
        this.handleInteraction(player, action.data as { entityId: string });
        break;

      default:
        this.log.warn({ actionType: action.type }, 'Unknown game action');
    }
  }

  // ============================================================================
  // Game Loop Updates
  // ============================================================================

  private updateCountdown(dt: number): void {
    this.state.countdown -= dt;

    if (this.state.countdown <= 0) {
      this.state.phase = 'playing';
      this.state.gameTime = 0;

      this.broadcast({
        type: 'game_begin',
        payload: { state: this.state },
      });

      // Set game time limit if configured
      if (this.gameTimeLimit > 0) {
        this.gameTimer = setTimeout(() => {
          this.endGame();
        }, this.gameTimeLimit * 1000);
      }
    }
  }

  private updateGame(dt: number): void {
    this.state.gameTime += dt;

    // Process input buffers and update positions
    this.processInputBuffers(dt);

    // Update entities
    this.updateEntities(dt);

    // Check collisions
    this.checkCollisions();

    // Call game-specific update
    this.onGameUpdate(dt);
  }

  /**
   * Override this in subclasses for game-specific update logic.
   */
  protected onGameUpdate(dt: number): void {}

  // ============================================================================
  // Movement Processing
  // ============================================================================

  private handleMovementInput(player: PlayerState, input: MovementInput): void {
    if (this.state.phase !== 'playing') return;

    const playerData = this.state.players[player.id];
    if (!playerData) return;

    // Add to input buffer
    const buffer = this.inputBuffer.get(player.id) ?? [];
    buffer.push(input);

    // Trim buffer if too large
    if (buffer.length > this.maxInputBufferSize) {
      buffer.shift();
    }

    this.inputBuffer.set(player.id, buffer);

    // Immediate processing for responsiveness
    this.processPlayerInput(player.id, input);

    // Send acknowledgment for client-side prediction reconciliation
    this.sendToPlayer(player.id, {
      type: 'input_ack',
      payload: {
        sequence: input.sequence,
        serverPosition: playerData.transform.position,
        serverTime: Date.now(),
      },
    });
  }

  private processInputBuffers(dt: number): void {
    // Process any remaining inputs in buffers
    this.inputBuffer.forEach((buffer, playerId) => {
      while (buffer.length > 0) {
        const input = buffer.shift()!;
        this.processPlayerInput(playerId, input);
      }
    });
  }

  private processPlayerInput(playerId: string, input: MovementInput): void {
    const playerData = this.state.players[playerId];
    if (!playerData) return;

    // Skip old inputs
    if (input.sequence <= playerData.lastInputSequence) return;
    playerData.lastInputSequence = input.sequence;

    const dt = (Date.now() - playerData.lastProcessedTime) / 1000;
    playerData.lastProcessedTime = Date.now();

    // Calculate new position
    if (this.useGrid) {
      this.processGridMovement(playerId, input);
    } else {
      this.processFreeMovement(playerId, input, dt);
    }

    // Process actions
    input.actions.forEach((action) => {
      this.handlePlayerAction(this.players.get(playerId)!, { action });
    });
  }

  private processFreeMovement(playerId: string, input: MovementInput, dt: number): void {
    const playerData = this.state.players[playerId];
    const { direction } = input;

    // Normalize direction
    const magnitude = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    if (magnitude > 0) {
      const normalizedX = direction.x / magnitude;
      const normalizedY = direction.y / magnitude;

      // Update velocity
      playerData.transform.velocity = {
        x: normalizedX * playerData.speed,
        y: 0,
        z: normalizedY * playerData.speed,
      };

      // Update position
      playerData.transform.position.x += playerData.transform.velocity.x * dt;
      playerData.transform.position.z += playerData.transform.velocity.z * dt;

      // Update rotation to face movement direction
      playerData.transform.rotation = Math.atan2(normalizedX, normalizedY) * (180 / Math.PI);

      playerData.isMoving = true;
    } else {
      playerData.transform.velocity = { x: 0, y: 0, z: 0 };
      playerData.isMoving = false;
    }

    // Clamp to world bounds
    this.clampToWorldBounds(playerData.transform.position);
  }

  private processGridMovement(playerId: string, input: MovementInput): void {
    const playerData = this.state.players[playerId];
    const { direction } = input;

    // Grid movement - move one cell at a time
    let dx = 0;
    let dz = 0;

    if (Math.abs(direction.x) > Math.abs(direction.y)) {
      dx = direction.x > 0 ? 1 : direction.x < 0 ? -1 : 0;
    } else {
      dz = direction.y > 0 ? 1 : direction.y < 0 ? -1 : 0;
    }

    const newX = playerData.transform.position.x + dx;
    const newZ = playerData.transform.position.z + dz;

    // Check if cell is valid
    if (this.isValidGridPosition(newX, newZ)) {
      playerData.transform.position.x = newX;
      playerData.transform.position.z = newZ;
      playerData.isMoving = true;

      if (dx !== 0 || dz !== 0) {
        playerData.transform.rotation = Math.atan2(dx, dz) * (180 / Math.PI);
      }

      // Handle cell content
      this.onPlayerEnteredCell(playerId, newX, newZ);
    }
  }

  private clampToWorldBounds(position: Vector3): void {
    const bounds = this.state.worldBounds;
    position.x = Math.max(bounds.minX, Math.min(bounds.maxX, position.x));
    position.y = Math.max(bounds.minY, Math.min(bounds.maxY, position.y));
    position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, position.z));
  }

  // ============================================================================
  // Grid Functions (for Number Munchers style games)
  // ============================================================================

  protected isValidGridPosition(x: number, z: number): boolean {
    const bounds = this.state.worldBounds;
    return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
  }

  /**
   * Override in subclasses to handle player entering a grid cell.
   */
  protected onPlayerEnteredCell(playerId: string, x: number, z: number): void {}

  protected initializeGrid(width: number, height: number): void {
    this.state.grid = [];
    for (let y = 0; y < height; y++) {
      this.state.grid[y] = [];
      for (let x = 0; x < width; x++) {
        this.state.grid[y][x] = { x, y };
      }
    }
  }

  protected getGridCell(x: number, y: number): GridCell | undefined {
    return this.state.grid?.[y]?.[x];
  }

  protected setGridCellContent(x: number, y: number, content: unknown): void {
    const cell = this.getGridCell(x, y);
    if (cell) {
      cell.content = content;
    }
  }

  // ============================================================================
  // Entity Management
  // ============================================================================

  protected spawnEntity(type: string, position: Vector3, data: Record<string, unknown> = {}): Entity {
    const entity: Entity = {
      id: `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      transform: { position, rotation: 0 },
      data,
      isActive: true,
    };

    this.state.entities[entity.id] = entity;

    this.broadcast({
      type: 'entity_spawned',
      payload: entity,
    });

    return entity;
  }

  protected removeEntity(entityId: string): void {
    delete this.state.entities[entityId];

    this.broadcast({
      type: 'entity_removed',
      payload: { entityId },
    });
  }

  protected updateEntities(dt: number): void {
    // Override in subclasses for entity behavior
  }

  // ============================================================================
  // Collision Detection
  // ============================================================================

  protected checkCollisions(): void {
    const players = Object.entries(this.state.players);

    // Player-to-player collisions
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const [id1, p1] = players[i];
        const [id2, p2] = players[j];

        if (this.checkPlayerCollision(p1, p2)) {
          this.onPlayerCollision(id1, id2);
        }
      }
    }

    // Player-to-entity collisions
    players.forEach(([playerId, playerData]) => {
      Object.entries(this.state.entities).forEach(([entityId, entity]) => {
        if (entity.isActive && this.checkEntityCollision(playerData, entity)) {
          this.onEntityCollision(playerId, entityId);
        }
      });
    });
  }

  private checkPlayerCollision(p1: PlayerMovementData, p2: PlayerMovementData): boolean {
    const dx = p1.transform.position.x - p2.transform.position.x;
    const dz = p1.transform.position.z - p2.transform.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    return distance < 1; // Collision radius of 1
  }

  private checkEntityCollision(player: PlayerMovementData, entity: Entity): boolean {
    const dx = player.transform.position.x - entity.transform.position.x;
    const dz = player.transform.position.z - entity.transform.position.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    return distance < 1;
  }

  /**
   * Override in subclasses to handle player-player collision.
   */
  protected onPlayerCollision(playerId1: string, playerId2: string): void {}

  /**
   * Override in subclasses to handle player-entity collision.
   */
  protected onEntityCollision(playerId: string, entityId: string): void {}

  // ============================================================================
  // Interaction & Actions
  // ============================================================================

  private handlePlayerAction(player: PlayerState, data: { action: string; target?: string }): void {
    this.onPlayerAction(player, data.action, data.target);
  }

  private handleInteraction(player: PlayerState, data: { entityId: string }): void {
    const entity = this.state.entities[data.entityId];
    if (!entity || !entity.isActive) return;

    this.onPlayerInteract(player, entity);
  }

  /**
   * Override in subclasses to handle player actions (jump, attack, etc).
   */
  protected onPlayerAction(player: PlayerState, action: string, target?: string): void {}

  /**
   * Override in subclasses to handle player interactions with entities.
   */
  protected onPlayerInteract(player: PlayerState, entity: Entity): void {}

  // ============================================================================
  // Spawn Management
  // ============================================================================

  protected getSpawnPosition(playerId: string): Vector3 {
    const playerIndex = this.players.size;
    const angle = (playerIndex / 8) * Math.PI * 2;
    const radius = 5;

    return {
      x: Math.cos(angle) * radius,
      y: 0,
      z: Math.sin(angle) * radius,
    };
  }
}
