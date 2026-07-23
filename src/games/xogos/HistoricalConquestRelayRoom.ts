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
 * Room flow: create via room_create (private room codes work via room_list /
 * room_join — the roster comes from room_joined / player_joined /
 * player_left). Min 2 / max 4 players; no server-side bots; matchmaking not
 * required.
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

  /**
   * Override the base handler so actions are relayed as soon as players are
   * in the room, instead of being rejected with "Game not in progress".
   */
  public handleGameAction(client: Client, action: any): void {
    const player = this.players.get(client.id);
    if (!player) return;

    player.lastActivity = Date.now();

    // Accept the action name in `type` (canonical) or `action`; tolerate a
    // missing name entirely — this is a relay, not a dispatcher.
    const actionName = action?.type ?? action?.action ?? null;
    const data = action?.data ?? action;

    const relayPayload = {
      type: actionName,
      action: actionName,
      playerId: client.id,
      username: player.username,
      data,
      timestamp: Date.now(),
      sequence: action?.sequence,
    };

    this.state.actionsRelayed++;

    if (this.echoToSender) {
      this.broadcast({ type: MessageType.GAME_ACTION, payload: relayPayload });
    } else {
      this.broadcastExcept(client.id, {
        type: MessageType.GAME_ACTION,
        payload: relayPayload,
      });
    }

    this.log.debug(
      { playerId: client.id, action: actionName, players: this.players.size },
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
