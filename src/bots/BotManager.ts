/**
 * Game On Dude! - Bot Manager
 * www.gameonguy.com
 *
 * Manages bot lifecycle within rooms.
 * Handles spawning, communication, and cleanup of bots.
 */

import { Room } from '../rooms/Room';
import { Message, PlayerState } from '../core/types';
import { BotClient, BotClientOptions } from './BotClient';
import { BotRegistry } from './BotRegistry';
import logger from '../core/Logger';

const log = logger.child({ module: 'BotManager' });

// Bot names - realistic player names so bots are indistinguishable from humans
const BOT_NAMES = [
  'Ryan', 'Alex', 'Jordan', 'Taylor', 'Morgan',
  'Casey', 'Jamie', 'Drew', 'Riley', 'Quinn',
  'Avery', 'Parker', 'Hayden', 'Reese', 'Skyler',
  'Cameron', 'Dakota', 'Finley', 'Rowan', 'Sage',
];

/**
 * Options for spawning a bot
 */
export interface SpawnBotOptions {
  /** Specific bot type to use (optional) */
  botType?: string;
  /** Custom bot name (optional) */
  botName?: string;
  /** Difficulty level 0-100 (optional, default 50) */
  difficulty?: number;
  /** Game-specific config (optional) */
  gameConfig?: Record<string, unknown>;
}

/**
 * Manages bots within a room
 */
export class BotManager {
  private room: Room;
  private bots: Map<string, BotClient> = new Map();
  private usedNames: Set<string> = new Set();

  constructor(room: Room) {
    this.room = room;
  }

  /**
   * Check if bots are available for this room's game type
   */
  public hasBotsAvailable(): boolean {
    return BotRegistry.hasBotsForGame(this.room.gameType);
  }

  /**
   * Get available bot types for this room's game type
   */
  public getAvailableBotTypes(): string[] {
    return BotRegistry.getBotsForGame(this.room.gameType).map((r) => r.botType);
  }

  /**
   * Spawn a bot in the room
   */
  public async spawnBot(options: SpawnBotOptions = {}): Promise<BotClient | null> {
    // Check if bots are available
    if (!this.hasBotsAvailable()) {
      log.warn(
        { roomId: this.room.id, gameType: this.room.gameType },
        'No bots available for game type'
      );
      return null;
    }

    // Generate a unique name
    const botName = options.botName ?? this.generateBotName();

    // Create bot client options
    const botOptions: BotClientOptions = {
      botType: options.botType,
      botName,
      difficulty: options.difficulty ?? 50,
      gameType: this.room.gameType,
      gameMode: this.room.gameMode,
      gameConfig: options.gameConfig,
    };

    try {
      // Create the bot client
      const botClient = new BotClient(botOptions);

      // Set up message handler (bot -> room)
      botClient.setMessageHandler((message: Message) => {
        this.handleBotMessage(botClient, message);
      });

      // Set up leave handler
      botClient.setLeaveHandler(() => {
        this.removeBot(botClient.id);
      });

      // Add bot to room as a player
      // We need to create a pseudo-client interface that the room can use
      await this.addBotToRoom(botClient);

      // Track the bot
      this.bots.set(botClient.id, botClient);
      this.usedNames.add(botName);

      log.info(
        {
          roomId: this.room.id,
          botId: botClient.id,
          botName,
          difficulty: options.difficulty,
        },
        'Bot spawned in room'
      );

      return botClient;
    } catch (error) {
      log.error({ roomId: this.room.id, error }, 'Failed to spawn bot');
      return null;
    }
  }

  /**
   * Spawn multiple bots
   */
  public async spawnBots(count: number, options: SpawnBotOptions = {}): Promise<BotClient[]> {
    const bots: BotClient[] = [];

    for (let i = 0; i < count; i++) {
      const bot = await this.spawnBot(options);
      if (bot) {
        bots.push(bot);
      }
    }

    return bots;
  }

  /**
   * Fill the room with bots up to a target player count
   */
  public async fillWithBots(targetPlayerCount: number, options: SpawnBotOptions = {}): Promise<BotClient[]> {
    const currentCount = this.room.playerCount;
    const botsNeeded = Math.max(0, targetPlayerCount - currentCount);

    return this.spawnBots(botsNeeded, options);
  }

  /**
   * Remove a bot from the room
   */
  public async removeBot(botId: string): Promise<boolean> {
    const bot = this.bots.get(botId);
    if (!bot) {
      return false;
    }

    try {
      // Remove from room
      await this.room.removePlayer(botId);

      // Clean up bot
      bot.dispose();
      this.bots.delete(botId);
      this.usedNames.delete(bot.username);

      log.info({ roomId: this.room.id, botId }, 'Bot removed from room');
      return true;
    } catch (error) {
      log.error({ roomId: this.room.id, botId, error }, 'Error removing bot');
      return false;
    }
  }

  /**
   * Remove all bots from the room
   */
  public async removeAllBots(): Promise<void> {
    const botIds = Array.from(this.bots.keys());

    for (const botId of botIds) {
      await this.removeBot(botId);
    }
  }

  /**
   * Get all bots in the room
   */
  public getBots(): BotClient[] {
    return Array.from(this.bots.values());
  }

  /**
   * Get a specific bot
   */
  public getBot(botId: string): BotClient | undefined {
    return this.bots.get(botId);
  }

  /**
   * Check if a player is a bot
   */
  public isBot(playerId: string): boolean {
    return this.bots.has(playerId);
  }

  /**
   * Get bot count
   */
  public get botCount(): number {
    return this.bots.size;
  }

  /**
   * Send a message to a specific bot
   */
  public sendToBot(botId: string, message: Message): void {
    const bot = this.bots.get(botId);
    if (bot) {
      bot.send(message);
    }
  }

  /**
   * Broadcast a message to all bots
   */
  public broadcastToBots(message: Message): void {
    for (const bot of this.bots.values()) {
      bot.send(message);
    }
  }

  /**
   * Handle a message from a bot
   */
  private handleBotMessage(bot: BotClient, message: Message): void {
    // Route the message through the room's normal message handling
    // The room will process it as if it came from a real player
    this.room.handleMessage(bot as any, message);
  }

  /**
   * Add a bot to the room as a player
   * Note: Bot appears as a regular player to other clients - no bot indicators exposed
   */
  private async addBotToRoom(bot: BotClient): Promise<PlayerState> {
    // Create a minimal client interface for the room
    // Use regular-looking IDs so bots are indistinguishable from human players
    const clientInterface = {
      id: bot.id,
      sessionId: bot.sessionId,
      username: bot.username,
      userId: bot.id, // Use same ID format as regular players
      isBot: true, // Internal flag only - not sent to Unity clients
      send: (msg: Message) => bot.send(msg),
      sendError: (err: string) => bot.sendError(err),
      setRoom: (roomId: string | undefined) => bot.setRoom(roomId),
    };

    // Add to room
    const player = await this.room.addPlayer(clientInterface as any);

    return player;
  }

  /**
   * Generate a unique bot name (randomly selected)
   */
  private generateBotName(): string {
    // Get available names (not already used in this room)
    const availableNames = BOT_NAMES.filter(name => !this.usedNames.has(name));

    if (availableNames.length > 0) {
      // Randomly select from available names
      const randomIndex = Math.floor(Math.random() * availableNames.length);
      return availableNames[randomIndex];
    }

    // If all names are used, generate a random player-like name
    const randomNum = Math.floor(Math.random() * 9999);
    return `Player${randomNum}`;
  }

  /**
   * Dispose all bots and clean up
   */
  public dispose(): void {
    for (const bot of this.bots.values()) {
      bot.dispose();
    }
    this.bots.clear();
    this.usedNames.clear();
  }
}

export default BotManager;
