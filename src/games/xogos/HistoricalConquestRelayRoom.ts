/**
 * Game On Dude! - Historical Conquest Relay Room
 * www.gameonguy.com
 *
 * Pure relay room for "Historical Conquest: The Digital" (Xogos Gaming).
 * Their client runs the full game logic on every player's device (lockstep),
 * so the server does NO simulation, NO turn order, and NO action validation.
 * Every game_action a player sends is forwarded verbatim to the other players
 * in the room, as soon as players are present — there is no setup phase and
 * no "Not your turn" gating.
 *
 * Client -> Server:
 *   { type: "game_action", payload: <anything> }
 *   The action name may live in payload.type OR payload.action (both are
 *   accepted, mirroring the typing_race lenient parsing). The payload is
 *   relayed regardless of whether an action name is present at all.
 *
 * Server -> Other clients in the room:
 *   {
 *     type: "game_action",
 *     payload: {
 *       type:      <action name or null>,
 *       action:    <same value — alias so either key reads>,
 *       playerId:  <sender connection id>,
 *       username:  <sender display name>,
 *       data:      <payload.data if nested, otherwise the whole payload sent>,
 *       timestamp: <server epoch ms>,
 *       sequence:  <sender-provided sequence, if any>
 *     }
 *   }
 *
 * By default the sender does NOT receive its own action back (lockstep
 * clients apply their action locally before sending; an echo would risk
 * double-application). Set echoToSender: true in room options to include it.
 *
 * Targeted send: a game_action with `to: <playerId>` goes to that one player
 * only (e.g. the host resending mp_state to a player who rejoined).
 *
 * Room flow: create via room_create. Public rooms (the Waiting Room) are
 * listed in room_list. Private rooms (options.isPrivate: true) get a 6-letter
 * join code, are never listed, and are joined by code or full room id. The
 * roster comes from room_created / room_joined (room.players) plus
 * player_joined / player_left. A dropped player's seat is held for 60 s
 * (rejoinToken); after that the others get player_left (a forfeit).
 * playerData carries only uid, rating, wins, losses. Min 2 / max 4 players;
 * no server-side bots; matchmaking not required.
 */

import { Room, RoomConstructorOptions } from '../../rooms/Room';
import { Client } from '../../core/Client';
import { PlayerState, GameAction, MessageType } from '../../core/types';

export interface HistoricalConquestRelayRoomOptions extends RoomConstructorOptions {
  /** Relay each action back to its sender too. Default false. */
  echoToSender?: boolean;
}

interface HCRelayState {
  /** Count of actions relayed, for observability only. */
  actionsRelayed: number;
}

export class HistoricalConquestRelayRoom extends Room<HCRelayState> {
  private readonly echoToSender: boolean;

  constructor(gameType: string, options: HistoricalConquestRelayRoomOptions = {}) {
    super(gameType, {
      ...options,
      // The default name embeds the room id; never hand that out for a private game.
      name: options.isPrivate ? 'Private game' : options.name,
      // No server-side simulation; the tick loop is irrelevant.
      tickRate: options.tickRate ?? 1,
      minPlayers: options.minPlayers ?? 2,
      maxPlayers: options.maxPlayers ?? 4,
    });

    this.echoToSender = options.echoToSender ?? false;

    this.log.info(
      { roomId: this.id, echoToSender: this.echoToSender },
      'HistoricalConquestRelayRoom created (pure relay, no turn gating)'
    );
  }

  protected initializeState(): HCRelayState {
    return { actionsRelayed: 0 };
  }

  // --------------------------------------------------------------------------
  // ROOM CONFIGURATION
  // --------------------------------------------------------------------------

  public wantsJoinCode(): boolean {
    return this.options.isPrivate;
  }

  public joinCodeLength(): number {
    return 6;
  }

  public isListed(): boolean {
    return !this.options.isPrivate;
  }

  protected rejoinHoldMs(): number {
    return 60 * 1000;
  }

  /** Exactly what HC asked to carry — nothing else about the player. */
  protected sanitizePlayerData(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') return null;
    const { uid, rating, wins, losses } = raw as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof uid === 'string' && /^[\w.:-]{1,64}$/.test(uid)) data.uid = uid;
    if (typeof rating === 'number' && Number.isFinite(rating)) data.rating = Math.round(rating);
    if (typeof wins === 'number' && Number.isFinite(wins)) data.wins = Math.max(0, Math.round(wins));
    if (typeof losses === 'number' && Number.isFinite(losses)) data.losses = Math.max(0, Math.round(losses));
    return Object.keys(data).length > 0 ? data : null;
  }

  protected toPublicPlayer(player: PlayerState): unknown {
    return {
      id: player.id,
      username: player.username,
      isReady: player.isReady,
      joinedAt: player.joinedAt,
      connected: player.isConnected,
      data: player.data,
    };
  }

  /**
   * Override the base handler so actions are relayed as soon as players are
   * in the room, instead of being rejected with "Game not in progress".
   */
  public handleGameAction(client: Client, action: any): void {
    const senderId = this.playerIdOf(client);
    const player = this.players.get(senderId);
    if (!player) return;

    player.lastActivity = Date.now();

    // Accept the action name in `type` (canonical) or `action`; tolerate a
    // missing name entirely — this is a relay, not a dispatcher.
    const actionName = action?.type ?? action?.action ?? null;
    const data = action?.data ?? action;

    const relayPayload = {
      type: actionName,
      action: actionName,
      playerId: senderId,
      username: player.username,
      data,
      timestamp: Date.now(),
      sequence: action?.sequence,
    };

    this.state.actionsRelayed++;

    const to = action?.to;
    if (typeof to === 'string') {
      // Targeted: only that player (silently dropped if they aren't connected).
      this.sendToPlayer(to, { type: MessageType.GAME_ACTION, payload: relayPayload });
    } else if (this.echoToSender) {
      this.broadcast({ type: MessageType.GAME_ACTION, payload: relayPayload });
    } else {
      this.broadcastExcept(senderId, {
        type: MessageType.GAME_ACTION,
        payload: relayPayload,
      });
    }

    this.log.debug(
      { playerId: senderId, action: actionName, players: this.players.size },
      'Relayed game action'
    );
  }

  // --------------------------------------------------------------------------
  // ROOM LIFECYCLE HOOKS (inert — the relay has no server-side game state)
  // --------------------------------------------------------------------------

  protected onGameAction(_player: PlayerState, _action: GameAction): void {
    /* unreachable — handleGameAction relays directly */
  }

  protected onTick(): void {
    /* no server-side simulation */
  }

  protected onGameStart(): void {
    /* no setup phase, no turn order — the client coordinates its own start */
  }

  protected onGameEnd(): unknown {
    return { actionsRelayed: this.state.actionsRelayed };
  }
}
