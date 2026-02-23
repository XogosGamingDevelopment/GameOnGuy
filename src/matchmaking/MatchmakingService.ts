/**
 * Game On Dude! - Matchmaking Service
 * www.gameonguy.com
 *
 * Handles player matchmaking with skill-based matching, queue management,
 * and automatic bot filling when matches can't be found.
 */

import { v4 as uuidv4 } from 'uuid';
import { MatchmakingRequest, MatchmakingTicket, MessageType } from '../core/types';
import { RoomManager } from '../rooms/RoomManager';
import { BotRegistry } from '../bots/BotRegistry';
import { Client } from '../core/Client';
import logger from '../core/Logger';

/**
 * Function type for looking up a client by ID
 */
export type ClientLookupFn = (clientId: string) => Client | undefined;

interface MatchmakingQueue {
  gameType: string;
  gameMode?: string;
  tickets: Map<string, MatchmakingTicket>;
}

// Per-game-type matchmaking configuration
interface GameMatchmakingConfig {
  timeout: number;           // Matchmaking timeout in ms
  fillWithBots: boolean;     // Whether to fill with bots on timeout
  botDifficulty: number;     // Bot difficulty (0-100)
  minHumanPlayers: number;   // Minimum human players required
}

// Default game matchmaking configurations
const GAME_MATCHMAKING_CONFIGS: Record<string, GameMatchmakingConfig> = {
  'historical_conquest': {
    timeout: 20000,          // 20 seconds for Historical Conquest
    fillWithBots: true,
    botDifficulty: 50,
    minHumanPlayers: 1,
  },
  'default': {
    timeout: 30000,          // 30 seconds default
    fillWithBots: false,
    botDifficulty: 50,
    minHumanPlayers: 2,
  },
};

export class MatchmakingService {
  private queues: Map<string, MatchmakingQueue> = new Map();
  private playerTickets: Map<string, string> = new Map(); // playerId -> ticketId
  private roomManager: RoomManager;
  private getClient: ClientLookupFn;
  private matchInterval?: NodeJS.Timeout;

  private readonly skillMatchRange: number;
  private readonly minPlayersToMatch: number;

  private readonly log = logger.child({ component: 'Matchmaking' });

  constructor(roomManager: RoomManager, getClient?: ClientLookupFn) {
    this.roomManager = roomManager;
    this.getClient = getClient || (() => undefined);
    this.skillMatchRange = parseInt(process.env.SKILL_MATCH_RANGE || '100');
    this.minPlayersToMatch = 2;

    // Start matchmaking loop
    this.startMatchmakingLoop();
  }

  /**
   * Set the client lookup function (called after server initialization)
   */
  public setClientLookup(getClient: ClientLookupFn): void {
    this.getClient = getClient;
  }

  /**
   * Get matchmaking config for a game type
   */
  private getMatchmakingConfig(gameType: string): GameMatchmakingConfig {
    return GAME_MATCHMAKING_CONFIGS[gameType] || GAME_MATCHMAKING_CONFIGS['default'];
  }

  /**
   * Request to join matchmaking queue.
   */
  public async requestMatch(request: MatchmakingRequest): Promise<MatchmakingTicket> {
    // Check if player already has a ticket
    const existingTicketId = this.playerTickets.get(request.playerId);
    if (existingTicketId) {
      throw new Error('Already in matchmaking queue');
    }

    const queueKey = this.getQueueKey(request.gameType, request.gameMode);
    const config = this.getMatchmakingConfig(request.gameType);

    // Get or create queue
    let queue = this.queues.get(queueKey);
    if (!queue) {
      queue = {
        gameType: request.gameType,
        gameMode: request.gameMode,
        tickets: new Map(),
      };
      this.queues.set(queueKey, queue);
    }

    // Create ticket with game-specific timeout
    const ticket: MatchmakingTicket = {
      id: uuidv4(),
      request,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + config.timeout,
    };

    queue.tickets.set(ticket.id, ticket);
    this.playerTickets.set(request.playerId, ticket.id);

    this.log.info(
      {
        ticketId: ticket.id,
        playerId: request.playerId,
        gameType: request.gameType,
        timeout: config.timeout,
        fillWithBots: config.fillWithBots,
        expiresAt: ticket.expiresAt,
        queueSize: queue.tickets.size,
      },
      'Matchmaking ticket created'
    );

    return ticket;
  }

  /**
   * Cancel a matchmaking request.
   */
  public cancelMatch(playerId: string): void {
    const ticketId = this.playerTickets.get(playerId);
    if (!ticketId) return;

    // Find and remove ticket from queue
    this.queues.forEach((queue) => {
      const ticket = queue.tickets.get(ticketId);
      if (ticket) {
        ticket.status = 'cancelled';
        queue.tickets.delete(ticketId);
      }
    });

    this.playerTickets.delete(playerId);
    this.log.info({ playerId, ticketId }, 'Matchmaking cancelled');
  }

  /**
   * Get queue key for a game type and mode.
   */
  private getQueueKey(gameType: string, gameMode?: string): string {
    return gameMode ? `${gameType}:${gameMode}` : gameType;
  }

  /**
   * Start the matchmaking processing loop.
   */
  private startMatchmakingLoop(): void {
    this.matchInterval = setInterval(() => {
      this.processQueues();
    }, 1000); // Process every second
  }

  /**
   * Process all queues and create matches.
   */
  private processQueues(): void {
    const now = Date.now();
    const totalTickets = Array.from(this.queues.values()).reduce(
      (sum, q) => sum + q.tickets.size, 0
    );

    // Only log if there are tickets being processed
    if (totalTickets > 0) {
      this.log.debug({ totalTickets, queueCount: this.queues.size }, 'Processing matchmaking queues');
    }

    this.queues.forEach((queue, queueKey) => {
      const config = this.getMatchmakingConfig(queue.gameType);
      const expiredTickets: MatchmakingTicket[] = [];

      // Find expired tickets
      queue.tickets.forEach((ticket, ticketId) => {
        if (ticket.expiresAt < now && ticket.status === 'pending') {
          expiredTickets.push(ticket);
        }
      });

      // Handle expired tickets - try to create bot match if enabled
      if (expiredTickets.length > 0 && config.fillWithBots) {
        // Call async function and catch errors
        this.handleTimeoutWithBots(queue, expiredTickets, config).catch((error) => {
          this.log.error({ error, gameType: queue.gameType }, 'Error in handleTimeoutWithBots');
        });
      } else if (expiredTickets.length > 0) {
        // Just expire the tickets and notify clients
        expiredTickets.forEach((ticket) => {
          ticket.status = 'timeout';
          queue.tickets.delete(ticket.id);
          this.playerTickets.delete(ticket.request.playerId);

          // Notify the player of timeout
          const client = this.getClient(ticket.request.playerId);
          if (client) {
            client.send({
              type: MessageType.MATCHMAKE_TIMEOUT,
              payload: {
                gameType: queue.gameType,
                gameMode: queue.gameMode,
                message: 'Could not find a match. Please try again.',
              },
            });
          }

          this.log.info({ ticketId: ticket.id }, 'Matchmaking ticket expired');
        });
      }

      // Try to create matches from remaining tickets
      this.tryCreateMatch(queue);
    });
  }

  /**
   * Handle timeout by creating a match with bots
   */
  private async handleTimeoutWithBots(
    queue: MatchmakingQueue,
    expiredTickets: MatchmakingTicket[],
    config: GameMatchmakingConfig
  ): Promise<void> {
    this.log.info(
      {
        gameType: queue.gameType,
        expiredTicketCount: expiredTickets.length,
        fillWithBots: config.fillWithBots,
      },
      'handleTimeoutWithBots called'
    );

    // Check if bots are available for this game type
    const hasBot = BotRegistry.hasBotsForGame(queue.gameType);
    this.log.info(
      { gameType: queue.gameType, hasBot, registeredGames: BotRegistry.getSupportedGameTypes() },
      'Bot availability check'
    );

    if (!hasBot) {
      this.log.warn(
        { gameType: queue.gameType },
        'No bots available for game type, expiring tickets'
      );
      // Expire tickets normally
      expiredTickets.forEach((ticket) => {
        ticket.status = 'timeout';
        queue.tickets.delete(ticket.id);
        this.playerTickets.delete(ticket.request.playerId);
      });
      return;
    }

    this.log.info(
      { gameType: queue.gameType, ticketCount: expiredTickets.length },
      'Processing expired tickets - room will handle bot spawning'
    );

    // For each expired ticket, create a room and join the player
    // The room will handle bot spawning via its own BotManager
    for (const ticket of expiredTickets) {
      this.log.info(
        { ticketId: ticket.id, playerId: ticket.request.playerId },
        'Processing ticket for bot match'
      );

      try {
        // Get the client first - we need it to join the room
        const client = this.getClient(ticket.request.playerId);
        if (!client) {
          this.log.warn(
            { ticketId: ticket.id, playerId: ticket.request.playerId },
            'Client disconnected before match could be created'
          );
          ticket.status = 'timeout';
          queue.tickets.delete(ticket.id);
          this.playerTickets.delete(ticket.request.playerId);
          continue;
        }

        // Create room - the room's own BotManager will handle bot spawning
        this.log.info({ gameType: queue.gameType }, 'Creating room for bot match');
        const room = await this.roomManager.createRoom(queue.gameType, {
          gameMode: queue.gameMode,
          isPrivate: false,
          autoStart: false,
          // Pass flag to indicate this came from matchmaking timeout
          // Room can use this to spawn bot immediately instead of waiting
          fromMatchmakingTimeout: true,
        });

        this.log.info(
          {
            roomId: room.id,
            playerId: ticket.request.playerId,
            gameType: queue.gameType,
          },
          'Room created for bot match'
        );

        // Update ticket status
        ticket.status = 'matched';
        ticket.roomId = room.id;

        // Remove from queue BEFORE joining (prevents re-processing)
        queue.tickets.delete(ticket.id);
        this.playerTickets.delete(ticket.request.playerId);

        // Auto-join the player to the room
        this.log.info(
          { roomId: room.id, playerId: ticket.request.playerId },
          'Auto-joining player to room'
        );
        await this.roomManager.joinRoom(room.id, client);

        // Send room_joined message (client is now in the room)
        client.send({
          type: MessageType.ROOM_JOINED,
          payload: {
            room: room.getInfo(),
            state: room.getState(),
          },
        });

        this.log.info(
          {
            ticketId: ticket.id,
            roomId: room.id,
            playerId: ticket.request.playerId,
          },
          'Player auto-joined to room after matchmaking timeout'
        );

      } catch (error) {
        this.log.error(
          { error, ticketId: ticket.id },
          'Failed to create bot match'
        );
        // Expire the ticket on error
        ticket.status = 'timeout';
        queue.tickets.delete(ticket.id);
        this.playerTickets.delete(ticket.request.playerId);
      }
    }
  }

  /**
   * Try to create a match from queue.
   */
  private async tryCreateMatch(queue: MatchmakingQueue): Promise<void> {
    if (queue.tickets.size < this.minPlayersToMatch) return;

    // Get game config for min/max players
    const gameConfig = this.roomManager.getGameConfig(queue.gameType);
    const minPlayers = gameConfig?.minPlayers || 2;
    const maxPlayers = gameConfig?.maxPlayers || 10;

    // Sort tickets by skill if available, otherwise by time
    const sortedTickets = Array.from(queue.tickets.values()).sort((a, b) => {
      if (a.request.skill !== undefined && b.request.skill !== undefined) {
        return a.request.skill - b.request.skill;
      }
      return a.createdAt - b.createdAt;
    });

    // Find groups of players that can be matched
    const matchedTickets: MatchmakingTicket[] = [];

    for (const ticket of sortedTickets) {
      if (ticket.status !== 'pending') continue;

      // Check skill range if skill-based matching
      if (matchedTickets.length > 0 && ticket.request.skill !== undefined) {
        const firstSkill = matchedTickets[0].request.skill || 0;
        const skillDiff = Math.abs(ticket.request.skill - firstSkill);

        // Expand skill range over time for faster matching
        const waitTime = Date.now() - ticket.createdAt;
        const expandedRange = this.skillMatchRange + Math.floor(waitTime / 5000) * 50;

        if (skillDiff > expandedRange) continue;
      }

      matchedTickets.push(ticket);

      if (matchedTickets.length >= maxPlayers) break;
    }

    // Create match if we have enough players
    if (matchedTickets.length >= minPlayers) {
      await this.createMatchFromTickets(queue, matchedTickets);
    }
  }

  /**
   * Create a room and match players from tickets.
   */
  private async createMatchFromTickets(
    queue: MatchmakingQueue,
    tickets: MatchmakingTicket[]
  ): Promise<void> {
    try {
      // Create room
      const room = await this.roomManager.createRoom(queue.gameType, {
        gameMode: queue.gameMode,
        isPrivate: false,
        autoStart: true,
      });

      this.log.info(
        {
          roomId: room.id,
          playerCount: tickets.length,
          gameType: queue.gameType,
        },
        'Match created'
      );

      // Update tickets and notify players
      for (const ticket of tickets) {
        ticket.status = 'matched';
        ticket.roomId = room.id;

        // Remove from queue
        queue.tickets.delete(ticket.id);
        this.playerTickets.delete(ticket.request.playerId);

        // Notify the player - send matchmake_found message
        const client = this.getClient(ticket.request.playerId);
        if (client) {
          client.send({
            type: MessageType.MATCHMAKE_FOUND,
            payload: {
              roomId: room.id,
              gameType: queue.gameType,
              gameMode: queue.gameMode,
            },
          });
          this.log.info(
            {
              ticketId: ticket.id,
              roomId: room.id,
              playerId: ticket.request.playerId,
            },
            'Player notified of match'
          );
        } else {
          this.log.warn(
            {
              ticketId: ticket.id,
              playerId: ticket.request.playerId,
            },
            'Could not find client to notify of match'
          );
        }
      }
    } catch (error) {
      this.log.error({ error }, 'Failed to create match');
    }
  }

  /**
   * Get current queue size for a game type.
   */
  public getQueueSize(gameType?: string, gameMode?: string): number {
    if (gameType) {
      const queueKey = this.getQueueKey(gameType, gameMode);
      return this.queues.get(queueKey)?.tickets.size || 0;
    }

    // Total across all queues
    let total = 0;
    this.queues.forEach((queue) => {
      total += queue.tickets.size;
    });
    return total;
  }

  /**
   * Get ticket for a player.
   */
  public getPlayerTicket(playerId: string): MatchmakingTicket | undefined {
    const ticketId = this.playerTickets.get(playerId);
    if (!ticketId) return undefined;

    let foundTicket: MatchmakingTicket | undefined;
    this.queues.forEach((queue) => {
      const ticket = queue.tickets.get(ticketId);
      if (ticket) {
        foundTicket = ticket;
      }
    });

    return foundTicket;
  }

  /**
   * Stop the matchmaking service.
   */
  public stop(): void {
    if (this.matchInterval) {
      clearInterval(this.matchInterval);
      this.matchInterval = undefined;
    }
  }
}
