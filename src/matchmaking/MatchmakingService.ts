/**
 * Game On Dude! - Matchmaking Service
 * www.gameonguy.com
 *
 * Handles player matchmaking with skill-based matching and queue management.
 */

import { v4 as uuidv4 } from 'uuid';
import { MatchmakingRequest, MatchmakingTicket, MessageType } from '../core/types';
import { RoomManager } from '../rooms/RoomManager';
import logger from '../core/Logger';

interface MatchmakingQueue {
  gameType: string;
  gameMode?: string;
  tickets: Map<string, MatchmakingTicket>;
}

export class MatchmakingService {
  private queues: Map<string, MatchmakingQueue> = new Map();
  private playerTickets: Map<string, string> = new Map(); // playerId -> ticketId
  private roomManager: RoomManager;
  private matchInterval?: NodeJS.Timeout;

  private readonly matchmakingTimeout: number;
  private readonly skillMatchRange: number;
  private readonly minPlayersToMatch: number;

  private readonly log = logger.child({ component: 'Matchmaking' });

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager;
    this.matchmakingTimeout = parseInt(process.env.MATCHMAKING_TIMEOUT || '30000');
    this.skillMatchRange = parseInt(process.env.SKILL_MATCH_RANGE || '100');
    this.minPlayersToMatch = 2;

    // Start matchmaking loop
    this.startMatchmakingLoop();
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

    // Create ticket
    const ticket: MatchmakingTicket = {
      id: uuidv4(),
      request,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + this.matchmakingTimeout,
    };

    queue.tickets.set(ticket.id, ticket);
    this.playerTickets.set(request.playerId, ticket.id);

    this.log.info(
      {
        ticketId: ticket.id,
        playerId: request.playerId,
        gameType: request.gameType,
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

    this.queues.forEach((queue, queueKey) => {
      // Remove expired tickets
      queue.tickets.forEach((ticket, ticketId) => {
        if (ticket.expiresAt < now) {
          ticket.status = 'timeout';
          queue.tickets.delete(ticketId);
          this.playerTickets.delete(ticket.request.playerId);
          this.log.info({ ticketId }, 'Matchmaking ticket expired');

          // TODO: Notify player of timeout
        }
      });

      // Try to create matches
      this.tryCreateMatch(queue);
    });
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

        // TODO: Get client from server and notify
        // This would need access to the server's client map
        // For now, we'll emit an event that the server can handle
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
