/**
 * Game On Dude! - Example Schema-based Room
 * www.gameonguy.com
 *
 * This file demonstrates how to create a game room using the new
 * Schema-based state management system with automatic delta sync.
 *
 * This example implements a simple arena game where players move around
 * and collect points.
 */

import {
  Schema,
  type,
  MapSchema,
  ArraySchema,
} from '../../schema/Schema';
import { SchemaRoom, SchemaRoomOptions } from '../../rooms/SchemaRoom';
import { SyncMode } from '../../schema/StateTracker';
import { PlayerState, GameAction } from '../../core/types';

// ============================================================================
// State Schemas
// ============================================================================

/**
 * Schema for a player's position and state in the game.
 */
export class PlayerSchema extends Schema {
  @type('string') id: string = '';
  @type('string') username: string = '';
  @type('float32') x: number = 0;
  @type('float32') y: number = 0;
  @type('float32') rotation: number = 0;
  @type('int32') score: number = 0;
  @type('boolean') isAlive: boolean = true;
  @type('string') color: string = '#ffffff';
}

/**
 * Schema for a collectible item in the game world.
 */
export class CollectibleSchema extends Schema {
  @type('string') id: string = '';
  @type('float32') x: number = 0;
  @type('float32') y: number = 0;
  @type('string') type: string = 'coin';
  @type('int32') value: number = 10;
}

/**
 * Main game state schema.
 */
export class ArenaGameState extends Schema {
  @type('string') phase: 'waiting' | 'countdown' | 'playing' | 'ended' = 'waiting';
  @type('float32') gameTime: number = 0;
  @type('float32') maxGameTime: number = 120; // 2 minutes
  @type('int32') countdown: number = 3;

  @type({ map: PlayerSchema })
  players: MapSchema<PlayerSchema> = new MapSchema<PlayerSchema>();

  @type({ array: CollectibleSchema })
  collectibles: ArraySchema<CollectibleSchema> = new ArraySchema<CollectibleSchema>();

  @type('string') winnerId: string = '';
}

// ============================================================================
// Room Options
// ============================================================================

export interface ArenaGameOptions extends SchemaRoomOptions {
  gameDuration?: number;
  collectibleCount?: number;
  mapWidth?: number;
  mapHeight?: number;
}

// ============================================================================
// Arena Game Room
// ============================================================================

/**
 * Example arena game room using Schema-based state.
 *
 * Features demonstrated:
 * - Schema-based state definition with decorators
 * - Automatic delta synchronization
 * - MapSchema for player tracking
 * - ArraySchema for collectibles
 * - Game action handling
 */
export class ArenaGameRoom extends SchemaRoom<ArenaGameState> {
  private mapWidth: number;
  private mapHeight: number;
  private collectibleCount: number;
  private gameDuration: number;
  private countdownTimer?: NodeJS.Timeout;

  constructor(gameType: string, options: ArenaGameOptions = {}) {
    super(gameType, {
      ...options,
      tickRate: options.tickRate ?? 20,
      syncMode: options.syncMode ?? SyncMode.DELTA,
    });

    this.mapWidth = options.mapWidth ?? 800;
    this.mapHeight = options.mapHeight ?? 600;
    this.collectibleCount = options.collectibleCount ?? 10;
    this.gameDuration = options.gameDuration ?? 120;
  }

  /**
   * Create the initial game state.
   */
  protected createState(): ArenaGameState {
    const state = new ArenaGameState();
    state.maxGameTime = this.gameDuration;
    return state;
  }

  /**
   * Called when a player joins.
   */
  protected onPlayerJoin(player: PlayerState): void {
    // Create player schema
    const playerSchema = new PlayerSchema();
    playerSchema.id = player.id;
    playerSchema.username = player.username;
    playerSchema.x = Math.random() * this.mapWidth;
    playerSchema.y = Math.random() * this.mapHeight;
    playerSchema.color = this.getRandomColor();
    playerSchema.score = 0;
    playerSchema.isAlive = true;

    // Add to state (automatically tracked for sync)
    this.state.players.set(player.id, playerSchema);

    this.log.info({ playerId: player.id, username: player.username }, 'Player added to arena');
  }

  /**
   * Called when a player leaves.
   */
  protected onPlayerLeave(player: PlayerState): void {
    this.state.players.delete(player.id);
    this.log.info({ playerId: player.id }, 'Player removed from arena');
  }

  /**
   * Called when the game starts.
   */
  protected onGameStart(): void {
    this.state.phase = 'countdown';
    this.state.countdown = 3;
    this.state.gameTime = 0;

    // Spawn collectibles
    this.spawnCollectibles();

    // Start countdown
    this.startCountdown();
  }

  /**
   * Start the countdown before gameplay.
   */
  private startCountdown(): void {
    this.countdownTimer = setInterval(() => {
      this.state.countdown--;

      if (this.state.countdown <= 0) {
        if (this.countdownTimer) {
          clearInterval(this.countdownTimer);
          this.countdownTimer = undefined;
        }
        this.state.phase = 'playing';
      }
    }, 1000);
  }

  /**
   * Spawn collectibles on the map.
   */
  private spawnCollectibles(): void {
    this.state.collectibles.clear();

    for (let i = 0; i < this.collectibleCount; i++) {
      const collectible = new CollectibleSchema();
      collectible.id = `collectible-${i}`;
      collectible.x = Math.random() * this.mapWidth;
      collectible.y = Math.random() * this.mapHeight;
      collectible.type = Math.random() > 0.8 ? 'gem' : 'coin';
      collectible.value = collectible.type === 'gem' ? 50 : 10;

      this.state.collectibles.push(collectible);
    }
  }

  /**
   * Game tick - called every frame.
   */
  protected onTick(deltaTime: number): void {
    if (this.state.phase !== 'playing') return;

    // Update game time
    this.state.gameTime += deltaTime / 1000;

    // Check for game end
    if (this.state.gameTime >= this.state.maxGameTime) {
      this.determineWinner();
      this.endGame();
      return;
    }

    // Check collectible collisions
    this.checkCollectibleCollisions();

    // Respawn collectibles if needed
    if (this.state.collectibles.length < this.collectibleCount / 2) {
      this.spawnSingleCollectible();
    }
  }

  /**
   * Check for player-collectible collisions.
   */
  private checkCollectibleCollisions(): void {
    const collisionRadius = 30;

    this.state.players.forEach((player) => {
      if (!player.isAlive) return;

      for (let i = this.state.collectibles.length - 1; i >= 0; i--) {
        const collectible = this.state.collectibles[i];
        const dx = player.x - collectible.x;
        const dy = player.y - collectible.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < collisionRadius) {
          // Collect!
          player.score += collectible.value;
          this.state.collectibles.splice(i, 1);

          this.log.debug(
            { playerId: player.id, score: player.score, collectibleType: collectible.type },
            'Player collected item'
          );
        }
      }
    });
  }

  /**
   * Spawn a single collectible.
   */
  private spawnSingleCollectible(): void {
    const collectible = new CollectibleSchema();
    collectible.id = `collectible-${Date.now()}`;
    collectible.x = Math.random() * this.mapWidth;
    collectible.y = Math.random() * this.mapHeight;
    collectible.type = Math.random() > 0.8 ? 'gem' : 'coin';
    collectible.value = collectible.type === 'gem' ? 50 : 10;

    this.state.collectibles.push(collectible);
  }

  /**
   * Handle player actions.
   */
  protected onGameAction(player: PlayerState, action: GameAction): void {
    const playerSchema = this.state.players.get(player.id);
    if (!playerSchema || !playerSchema.isAlive) return;

    switch (action.type) {
      case 'move':
        this.handleMove(playerSchema, action.data as MoveData);
        break;

      case 'rotate':
        this.handleRotate(playerSchema, action.data as RotateData);
        break;

      default:
        this.log.warn({ actionType: action.type }, 'Unknown action type');
    }
  }

  /**
   * Handle player movement.
   */
  private handleMove(player: PlayerSchema, data: MoveData): void {
    // Apply movement
    player.x = Math.max(0, Math.min(this.mapWidth, player.x + data.dx));
    player.y = Math.max(0, Math.min(this.mapHeight, player.y + data.dy));
  }

  /**
   * Handle player rotation.
   */
  private handleRotate(player: PlayerSchema, data: RotateData): void {
    player.rotation = data.rotation;
  }

  /**
   * Determine the winner.
   */
  private determineWinner(): void {
    let highestScore = -1;
    let winnerId = '';

    this.state.players.forEach((player) => {
      if (player.score > highestScore) {
        highestScore = player.score;
        winnerId = player.id;
      }
    });

    this.state.winnerId = winnerId;
  }

  /**
   * Called when the game ends.
   */
  protected onGameEnd(): ArenaGameResults {
    this.state.phase = 'ended';

    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }

    // Build results
    const playerResults: PlayerResult[] = [];
    this.state.players.forEach((player) => {
      playerResults.push({
        id: player.id,
        username: player.username,
        score: player.score,
        isWinner: player.id === this.state.winnerId,
      });
    });

    // Sort by score descending
    playerResults.sort((a, b) => b.score - a.score);

    return {
      winnerId: this.state.winnerId,
      winnerUsername: this.state.players.get(this.state.winnerId)?.username ?? '',
      players: playerResults,
      gameDuration: this.state.gameTime,
    };
  }

  /**
   * Generate a random color for a player.
   */
  private getRandomColor(): string {
    const colors = [
      '#e74c3c', '#3498db', '#2ecc71', '#f39c12',
      '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}

// ============================================================================
// Types
// ============================================================================

interface MoveData {
  dx: number;
  dy: number;
}

interface RotateData {
  rotation: number;
}

interface PlayerResult {
  id: string;
  username: string;
  score: number;
  isWinner: boolean;
}

interface ArenaGameResults {
  winnerId: string;
  winnerUsername: string;
  players: PlayerResult[];
  gameDuration: number;
}
