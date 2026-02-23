/**
 * Game On Dude! - Bot Client
 * www.gameonguy.com
 *
 * Virtual client that represents a bot in a room.
 * Provides a sandboxed interface between bot logic and the room.
 */

import { v4 as uuidv4 } from 'uuid';
import { Message, MessageType } from '../core/types';
import { IGameBot, BotConfig, BotGameState, BotAction } from './BotInterface';
import { BotRegistry } from './BotRegistry';
import logger from '../core/Logger';

const log = logger.child({ module: 'BotClient' });

/**
 * Callback for sending messages from bot to room
 */
export type BotMessageHandler = (message: Message) => void;

/**
 * Callback for when bot wants to leave
 */
export type BotLeaveHandler = () => void;

/**
 * Options for creating a bot client
 */
export interface BotClientOptions {
  /** Bot type to use */
  botType?: string;
  /** Bot display name */
  botName?: string;
  /** Difficulty level (0-100) */
  difficulty?: number;
  /** Game type */
  gameType: string;
  /** Game mode */
  gameMode?: string;
  /** Game-specific config to pass to bot */
  gameConfig?: Record<string, unknown>;
}

/**
 * Virtual client that wraps a game bot
 * Acts as a sandboxed bridge between bot logic and the room
 */
export class BotClient {
  public readonly id: string;
  public readonly sessionId: string;
  public readonly username: string;
  public readonly isBot: boolean = true;

  private bot: IGameBot | null = null;
  private roomId?: string;
  private gameState: BotGameState;
  private messageHandler?: BotMessageHandler;
  private leaveHandler?: BotLeaveHandler;
  private actionQueue: BotAction[] = [];
  private processingActions: boolean = false;
  private tickInterval?: NodeJS.Timeout;
  private lastTickTime: number = 0;
  private disposed: boolean = false;

  // Security: Allowed message types that bots can send
  private static readonly ALLOWED_MESSAGE_TYPES = new Set([
    // Game actions
    'game_action',
    'player_ready',
    'turn_action',
    // Historical Conquest specific (from bot files)
    'playerinfo',
    'rc',        // ready check
    'rfol',      // ready for opening land
    'lhp',       // land has played
    'ppch',      // play card
    'aph',       // accept play
    'pp',        // pass priority
    'piah',      // player initiating attack
    'ftah',      // finalize attack
    'ac',        // accept combat
    'pet',       // player end turn
    'ds',        // deck size
    'pcp',       // phase change
    'dwc',       // do winner check
    'fdac',      // force discard a card
    'pdcp',      // player discard
    'hlc',       // highlight card
    'pdch',      // player discard from hand
    'shw',       // show winner
  ]);

  constructor(options: BotClientOptions) {
    // Use regular-looking IDs so bots are indistinguishable from human players
    this.id = uuidv4();
    this.sessionId = uuidv4().slice(0, 8);
    this.username = options.botName ?? `Player_${this.id.slice(0, 4)}`;

    // Initialize empty game state
    this.gameState = {
      playerId: this.id,
      playerName: this.username,
      phase: 'waiting',
      isMyTurn: false,
      turnNumber: 0,
      gameData: {},
    };

    // Create bot instance
    const botConfig: BotConfig = {
      playerId: this.id,
      playerName: this.username,
      gameType: options.gameType,
      gameMode: options.gameMode,
      difficulty: options.difficulty ?? 50,
      gameConfig: options.gameConfig,
    };

    if (options.botType) {
      this.bot = BotRegistry.createBot(options.botType, botConfig);
    } else {
      this.bot = BotRegistry.createBotForGame(options.gameType, botConfig);
    }

    if (!this.bot) {
      log.warn({ gameType: options.gameType, botType: options.botType }, 'No bot available, using null bot');
    }

    log.info(
      {
        clientId: this.id,
        botType: options.botType ?? 'default',
        gameType: options.gameType,
        difficulty: options.difficulty,
      },
      'Bot client created'
    );
  }

  /**
   * Set the message handler for outgoing messages
   */
  public setMessageHandler(handler: BotMessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Set the leave handler
   */
  public setLeaveHandler(handler: BotLeaveHandler): void {
    this.leaveHandler = handler;
  }

  /**
   * Set the room ID this bot is in
   */
  public setRoom(roomId: string | undefined): void {
    this.roomId = roomId;

    if (roomId) {
      // Start tick loop for proactive bot actions
      this.startTickLoop();
    } else {
      this.stopTickLoop();
    }
  }

  /**
   * Get the room ID
   */
  public getRoom(): string | undefined {
    return this.roomId;
  }

  /**
   * Send a message to the bot (from the room)
   * This is the main input for bot decision making
   */
  public send(message: Message): void {
    if (this.disposed || !this.bot) return;

    try {
      // Update game state based on message
      this.updateGameState(message);

      // Let bot process the message
      const actions = this.bot.handleMessage(
        message.type,
        message.payload,
        this.getSecureGameState()
      );

      // Queue actions for processing
      if (actions && actions.length > 0) {
        this.queueActions(actions);
      }
    } catch (error) {
      log.error({ clientId: this.id, error }, 'Bot error processing message');
    }
  }

  /**
   * Send an error to the bot (ignored for bots)
   */
  public sendError(error: string): void {
    log.debug({ clientId: this.id, error }, 'Bot received error');
  }

  /**
   * Get a secure copy of game state for the bot
   * This ensures bots can't access sensitive data
   */
  private getSecureGameState(): BotGameState {
    return {
      playerId: this.gameState.playerId,
      playerName: this.gameState.playerName,
      phase: this.gameState.phase,
      isMyTurn: this.gameState.isMyTurn,
      turnNumber: this.gameState.turnNumber,
      turnTimeRemaining: this.gameState.turnTimeRemaining,
      // Deep clone game data to prevent mutations
      gameData: JSON.parse(JSON.stringify(this.gameState.gameData)),
    };
  }

  /**
   * Update game state based on incoming message
   */
  private updateGameState(message: Message): void {
    // Cast payload to a generic record for property access
    const payload = message.payload as Record<string, unknown> | undefined;

    switch (message.type) {
      case MessageType.GAME_START:
        this.gameState.phase = 'playing';
        if (payload?.state) {
          this.gameState.gameData = payload.state as Record<string, unknown>;
        }
        break;

      case 'turn_start':
        if (payload?.playerId === this.id) {
          this.gameState.isMyTurn = true;
        }
        if (payload?.turnNumber !== undefined) {
          this.gameState.turnNumber = payload.turnNumber as number;
        }
        break;

      case 'turn_end':
        if (payload?.playerId === this.id) {
          this.gameState.isMyTurn = false;
        }
        break;

      case 'turn_phase':
        if (payload?.phase) {
          this.gameState.phase = payload.phase as string;
        }
        break;

      case MessageType.STATE_FULL:
        if (payload?.state) {
          this.gameState.gameData = payload.state as Record<string, unknown>;
        }
        break;

      case MessageType.GAME_END:
        this.gameState.phase = 'ended';
        if (this.bot?.onGameEnd) {
          this.bot.onGameEnd(payload?.results);
        }
        break;
    }

    // Store any additional data in gameData
    if (payload && typeof payload === 'object') {
      this.gameState.gameData[message.type] = payload;
    }
  }

  /**
   * Queue actions for processing with delays
   */
  private queueActions(actions: BotAction[]): void {
    for (const action of actions) {
      this.actionQueue.push(action);
    }

    if (!this.processingActions) {
      this.processNextAction();
    }
  }

  /**
   * Process the next action in the queue
   */
  private processNextAction(): void {
    if (this.disposed || this.actionQueue.length === 0) {
      this.processingActions = false;
      return;
    }

    this.processingActions = true;
    const action = this.actionQueue.shift()!;

    // Apply delay for human-like timing
    const delay = Math.max(0, Math.min(action.delay, 5000)); // Cap at 5 seconds

    setTimeout(() => {
      this.executeAction(action);
      this.processNextAction();
    }, delay);
  }

  /**
   * Execute a single action (send message to room)
   */
  private executeAction(action: BotAction): void {
    if (this.disposed || !this.messageHandler) return;

    // Security: Validate message type
    if (!BotClient.ALLOWED_MESSAGE_TYPES.has(action.type)) {
      log.warn(
        { clientId: this.id, messageType: action.type },
        'Bot attempted to send unauthorized message type'
      );
      return;
    }

    // Sanitize the data (remove any potential injection attempts)
    const sanitizedData = this.sanitizeData(action.data);

    const message: Message = {
      type: action.type,
      payload: sanitizedData,
    };

    try {
      this.messageHandler(message);
    } catch (error) {
      log.error({ clientId: this.id, error }, 'Error sending bot message');
    }
  }

  /**
   * Sanitize data to prevent injection attacks
   */
  private sanitizeData(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data;
    }

    // For primitives, return as-is
    if (typeof data !== 'object') {
      return data;
    }

    // For arrays, sanitize each element
    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeData(item));
    }

    // For objects, sanitize each property
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      // Skip dangerous keys
      if (key.startsWith('__') || key === 'constructor' || key === 'prototype') {
        continue;
      }

      // Skip functions
      if (typeof value === 'function') {
        continue;
      }

      sanitized[key] = this.sanitizeData(value);
    }

    return sanitized;
  }

  /**
   * Start the tick loop for proactive bot actions
   */
  private startTickLoop(): void {
    if (this.tickInterval) return;

    const TICK_RATE = 1000; // 1 second
    this.lastTickTime = Date.now();

    this.tickInterval = setInterval(() => {
      if (this.disposed || !this.bot?.onTick) return;

      const now = Date.now();
      const deltaTime = now - this.lastTickTime;
      this.lastTickTime = now;

      try {
        const actions = this.bot.onTick(this.getSecureGameState(), deltaTime);
        if (actions && actions.length > 0) {
          this.queueActions(actions);
        }
      } catch (error) {
        log.error({ clientId: this.id, error }, 'Bot tick error');
      }
    }, TICK_RATE);
  }

  /**
   * Stop the tick loop
   */
  private stopTickLoop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
  }

  /**
   * Request to leave the room
   */
  public leave(): void {
    if (this.leaveHandler) {
      this.leaveHandler();
    }
    this.dispose();
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.stopTickLoop();
    this.actionQueue = [];

    if (this.bot?.dispose) {
      try {
        this.bot.dispose();
      } catch (error) {
        log.error({ clientId: this.id, error }, 'Error disposing bot');
      }
    }

    this.bot = null;
    this.messageHandler = undefined;
    this.leaveHandler = undefined;

    log.info({ clientId: this.id }, 'Bot client disposed');
  }

  /**
   * Check if this is a bot client
   */
  public static isBotClient(client: unknown): client is BotClient {
    return client instanceof BotClient && client.isBot === true;
  }
}

export default BotClient;
