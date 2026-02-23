/**
 * Game On Dude! - Bot Interface
 * www.gameonguy.com
 *
 * Standard interface that all game bots must implement.
 * Bots are sandboxed and can only interact through this interface.
 */

/**
 * Action that a bot wants to perform
 */
export interface BotAction {
  /** Message type to send */
  type: string;
  /** Message payload */
  data: unknown;
  /** Delay before sending (ms) - for human-like timing */
  delay: number;
}

/**
 * Limited game state provided to bots
 * Contains only what the bot is allowed to see
 */
export interface BotGameState {
  /** Bot's player ID */
  playerId: string;
  /** Bot's display name */
  playerName: string;
  /** Current game phase */
  phase: string;
  /** Is it the bot's turn? */
  isMyTurn: boolean;
  /** Current turn number */
  turnNumber: number;
  /** Time remaining in current turn (ms) */
  turnTimeRemaining?: number;
  /** Game-specific state (varies by game type) */
  gameData: Record<string, unknown>;
}

/**
 * Configuration passed to bot on initialization
 */
export interface BotConfig {
  /** Bot's assigned player ID */
  playerId: string;
  /** Bot's display name */
  playerName: string;
  /** Game type this bot is playing */
  gameType: string;
  /** Game mode (if applicable) */
  gameMode?: string;
  /** Difficulty level (0-100) */
  difficulty: number;
  /** Game-specific configuration */
  gameConfig?: Record<string, unknown>;
}

/**
 * Interface that all game bots must implement
 */
export interface IGameBot {
  /** Unique identifier for this bot type */
  readonly botType: string;

  /** Game types this bot supports */
  readonly supportedGames: string[];

  /**
   * Initialize the bot with configuration
   * Called once when bot is created
   */
  initialize(config: BotConfig): void;

  /**
   * Handle an incoming message from the game
   * Returns actions the bot wants to take
   *
   * @param messageType - Type of message received
   * @param data - Message payload
   * @param gameState - Current game state (what bot is allowed to see)
   * @returns Array of actions to perform
   */
  handleMessage(
    messageType: string,
    data: unknown,
    gameState: BotGameState
  ): BotAction[];

  /**
   * Called periodically to allow proactive bot actions
   * @param gameState - Current game state
   * @param deltaTime - Time since last tick (ms)
   * @returns Array of actions to perform
   */
  onTick?(gameState: BotGameState, deltaTime: number): BotAction[];

  /**
   * Called when the game ends
   * @param results - Game results
   */
  onGameEnd?(results: unknown): void;

  /**
   * Clean up any resources
   */
  dispose?(): void;
}

/**
 * Factory function type for creating bot instances
 */
export type BotFactory = (config: BotConfig) => IGameBot;

/**
 * Bot registration entry
 */
export interface BotRegistration {
  /** Bot type identifier */
  botType: string;
  /** Game types this bot supports */
  supportedGames: string[];
  /** Factory function to create bot instances */
  factory: BotFactory;
  /** Bot metadata */
  metadata?: {
    name?: string;
    description?: string;
    version?: string;
    author?: string;
    defaultDifficulty?: number;
  };
}
