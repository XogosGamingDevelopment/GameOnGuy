/**
 * Game On Dude! - Bot Registry
 * www.gameonguy.com
 *
 * Manages registration and lookup of game bots.
 * Ensures bots are properly sandboxed and secure.
 */

import { BotRegistration, BotFactory, IGameBot, BotConfig } from './BotInterface';
import logger from '../core/Logger';

const log = logger.child({ module: 'BotRegistry' });

/**
 * Registry for game bots
 * Singleton pattern for global access
 */
class BotRegistryClass {
  private registrations: Map<string, BotRegistration> = new Map();
  private gameTypeIndex: Map<string, string[]> = new Map();

  /**
   * Register a bot type
   */
  public register(registration: BotRegistration): void {
    if (this.registrations.has(registration.botType)) {
      log.warn({ botType: registration.botType }, 'Bot type already registered, overwriting');
    }

    // Validate registration
    if (!registration.botType || registration.botType.trim() === '') {
      throw new Error('Bot type cannot be empty');
    }

    if (!registration.supportedGames || registration.supportedGames.length === 0) {
      throw new Error('Bot must support at least one game type');
    }

    if (typeof registration.factory !== 'function') {
      throw new Error('Bot factory must be a function');
    }

    // Store registration
    this.registrations.set(registration.botType, registration);

    // Index by game type for quick lookup
    for (const gameType of registration.supportedGames) {
      const existing = this.gameTypeIndex.get(gameType) ?? [];
      if (!existing.includes(registration.botType)) {
        existing.push(registration.botType);
        this.gameTypeIndex.set(gameType, existing);
      }
    }

    log.info(
      {
        botType: registration.botType,
        supportedGames: registration.supportedGames,
        metadata: registration.metadata,
      },
      'Bot registered'
    );
  }

  /**
   * Unregister a bot type
   */
  public unregister(botType: string): boolean {
    const registration = this.registrations.get(botType);
    if (!registration) {
      return false;
    }

    // Remove from game type index
    for (const gameType of registration.supportedGames) {
      const existing = this.gameTypeIndex.get(gameType);
      if (existing) {
        const filtered = existing.filter((t) => t !== botType);
        if (filtered.length > 0) {
          this.gameTypeIndex.set(gameType, filtered);
        } else {
          this.gameTypeIndex.delete(gameType);
        }
      }
    }

    this.registrations.delete(botType);
    log.info({ botType }, 'Bot unregistered');
    return true;
  }

  /**
   * Get all bot types that support a given game
   */
  public getBotsForGame(gameType: string): BotRegistration[] {
    const botTypes = this.gameTypeIndex.get(gameType) ?? [];
    return botTypes
      .map((type) => this.registrations.get(type))
      .filter((r): r is BotRegistration => r !== undefined);
  }

  /**
   * Get a specific bot registration
   */
  public getBot(botType: string): BotRegistration | undefined {
    return this.registrations.get(botType);
  }

  /**
   * Create a bot instance
   */
  public createBot(botType: string, config: BotConfig): IGameBot | null {
    const registration = this.registrations.get(botType);
    if (!registration) {
      log.error({ botType }, 'Bot type not found');
      return null;
    }

    if (!registration.supportedGames.includes(config.gameType)) {
      log.error(
        { botType, gameType: config.gameType, supportedGames: registration.supportedGames },
        'Bot does not support game type'
      );
      return null;
    }

    try {
      const bot = registration.factory(config);

      // Validate bot implements required interface
      if (typeof bot.handleMessage !== 'function') {
        throw new Error('Bot must implement handleMessage method');
      }

      // Initialize the bot
      bot.initialize(config);

      log.info(
        {
          botType,
          playerId: config.playerId,
          gameType: config.gameType,
          difficulty: config.difficulty,
        },
        'Bot instance created'
      );

      return bot;
    } catch (error) {
      log.error({ botType, error }, 'Failed to create bot instance');
      return null;
    }
  }

  /**
   * Create a bot for a game type using the default bot (first registered)
   */
  public createBotForGame(gameType: string, config: Omit<BotConfig, 'gameType'>): IGameBot | null {
    const bots = this.getBotsForGame(gameType);
    if (bots.length === 0) {
      log.error({ gameType }, 'No bots available for game type');
      return null;
    }

    // Use first available bot (could add selection logic later)
    const registration = bots[0];
    const difficulty = config.difficulty ?? registration.metadata?.defaultDifficulty ?? 50;

    return this.createBot(registration.botType, {
      ...config,
      gameType,
      difficulty,
    });
  }

  /**
   * Check if a game type has bots available
   */
  public hasBotsForGame(gameType: string): boolean {
    return (this.gameTypeIndex.get(gameType)?.length ?? 0) > 0;
  }

  /**
   * Get all registered bot types
   */
  public getAllBots(): BotRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * Get all supported game types
   */
  public getSupportedGameTypes(): string[] {
    return Array.from(this.gameTypeIndex.keys());
  }

  /**
   * Clear all registrations (for testing)
   */
  public clear(): void {
    this.registrations.clear();
    this.gameTypeIndex.clear();
  }
}

// Export singleton instance
export const BotRegistry = new BotRegistryClass();

// Export for type usage
export default BotRegistry;
