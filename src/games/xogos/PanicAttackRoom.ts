/**
 * Game On Dude! - Panic Attack Room
 * www.gameonguy.com
 *
 * Host-authoritative relay room for Panic Attack (Xogos Gaming), a browser
 * co-op freeze-tag / social-deduction game for K-12 students. The HOST's
 * browser runs the whole match (computer players, chaser, scoring, secret
 * roles); the server only routes messages — with rules that keep secrets
 * secret and keep strangers from talking to children:
 *
 *   - A GUEST's game_action goes to the HOST ONLY (any payload.to is ignored),
 *     so a modified guest client cannot send fake game state to other players.
 *   - The HOST's game_action goes to every other player, or — with
 *     payload.to: <playerId> — to that one player only (secret roles,
 *     private evidence, missions).
 *   - Quick-chat (action "chat") is validated by the server: whitelisted
 *     phrase ID + whitelisted arguments only, private rooms only, one message
 *     per 1.2 s per player. Approved chat is sent by the server to everyone.
 *
 * Client -> Server:
 *   { type: "game_action", payload: { type: "<action>", data: {...}, to?: "<playerId>" } }
 *   (payload.action is accepted as an alias for payload.type)
 *
 * Server -> recipient(s):
 *   { type: "game_action", payload: { type, action, playerId, fromHost, data, timestamp, sequence } }
 *
 * Rooms:
 *   - Private room: room_create { gameType, options: { gameMode } } -> gets a
 *     5-letter joinCode; friends join with room_join { joinCode }.
 *   - Quick Match: created by the matchmaker (lobby-fill, 2-6 players).
 *   - Never listed in room_list. Host = first player in (creator / first
 *     queued). When the host leaves, the room closes for everyone
 *     (room_closed { reason: "host_left" }). When a guest leaves, the others
 *     get player_left and the host's game takes over that monster.
 *   - Host action "start" locks the room (no new joins); host action "end"
 *     unlocks it (private rooms can rematch).
 *   - Names: private rooms show the first name from the player's token;
 *     Quick Match shows no names (name: null).
 */

import { Room, RoomConstructorOptions } from '../../rooms/Room';
import { Client } from '../../core/Client';
import { PlayerState, GameAction, MessageType, RoomInfo } from '../../core/types';

/** Quick-chat whitelist (from Panic Attack's spec, Oct 2026). */
export const PANIC_CHAT_PHRASES = new Set([
  'follow', 'help', 'panic', 'onit', 'fuse', 'nice', 'thanks', 'sorry', 'gg', 'go', 'saw', 'with',
  // Hidden Worries Huddle (Oct 21 2026)
  'sus', 'notme', 'vote', 'skip', 'proof', 'wru',
]);
export const PANIC_CHAT_COLORS = new Set(['red', 'blue', 'purple', 'pink', 'yellow', 'green', 'white']);
export const PANIC_CHAT_MAX_WHERE = 60;
export const PANIC_CHAT_INTERVAL_MS = 1200;
export const PANIC_MAX_PLAYERS = 7; // one per monster (6) + one Panic (Oct 21 2026)

type Phase = 'lobby' | 'playing';

export class PanicAttackRoom extends Room<Record<string, never>> {
  private hostId?: string;
  private phase: Phase = 'lobby';
  private readonly lastChatAt = new Map<string, number>();

  constructor(gameType: string, options: RoomConstructorOptions = {}) {
    super(gameType, {
      ...options,
      // room_create = private room with a code; the matchmaker makes Quick Match rooms.
      isPrivate: !options.fromMatchmaking,
      minPlayers: 2,
      maxPlayers: Math.min(options.maxPlayers ?? PANIC_MAX_PLAYERS, PANIC_MAX_PLAYERS),
      tickRate: 1,
      autoStart: false,
      password: undefined,
    });
  }

  protected initializeState(): Record<string, never> {
    return {};
  }

  // --------------------------------------------------------------------------
  // Room configuration
  // --------------------------------------------------------------------------

  public wantsJoinCode(): boolean {
    return this.options.isPrivate;
  }

  public isListed(): boolean {
    return false;
  }

  protected canJoin(_client: Client): boolean | string {
    return this.phase === 'playing' ? 'This match has already started' : true;
  }

  protected displayNameFor(client: Client): string {
    // No names in stranger matches.
    return this.options.isPrivate ? (client.username ?? '') : '';
  }

  protected toPublicPlayer(player: PlayerState): unknown {
    return {
      id: player.id,
      name: player.username || null,
      isHost: player.id === this.hostId,
    };
  }

  public getInfo(): RoomInfo {
    return { ...super.getInfo(), hostId: this.hostId, metadata: undefined };
  }

  /** What room_joined carries: roster + host + phase. */
  public getState(): any {
    return {
      phase: this.phase,
      hostId: this.hostId ?? null,
      joinCode: this.joinCode ?? null,
      isPrivate: this.options.isPrivate,
      players: Array.from(this.players.values()).map((p) => this.toPublicPlayer(p)),
    };
  }

  /** player_ready never starts anything here — the host's game starts the match. */
  public startGame(): void {
    /* host-driven: see "start" action */
  }

  // --------------------------------------------------------------------------
  // Players
  // --------------------------------------------------------------------------

  protected onPlayerJoin(player: PlayerState): void {
    if (!this.hostId) this.hostId = player.id;
  }

  protected onPlayerLeave(player: PlayerState): void {
    this.lastChatAt.delete(player.id);
    if (player.id === this.hostId) {
      this.dispose('host_left', { message: 'The host left.' });
    }
  }

  // --------------------------------------------------------------------------
  // Routing
  // --------------------------------------------------------------------------

  public handleGameAction(client: Client, action: any): void {
    const player = this.players.get(client.id);
    if (!player) return;
    player.lastActivity = Date.now();

    const actionName = action?.type ?? action?.action ?? null;
    // Fields belong in payload.data; a flat payload (fields at the root) is
    // tolerated and relayed without the routing keys.
    let data = action?.data;
    if (data === undefined && action && typeof action === 'object') {
      const { type: _t, action: _a, to: _to, sequence: _s, ...rest } = action;
      data = Object.keys(rest).length > 0 ? rest : null;
    }
    const isHost = client.id === this.hostId;

    if (actionName === 'chat') {
      this.handleChat(client, data);
      return;
    }

    const message = {
      type: MessageType.GAME_ACTION,
      payload: {
        type: actionName,
        action: actionName,
        playerId: client.id,
        fromHost: isHost,
        data,
        timestamp: Date.now(),
        sequence: action?.sequence,
      },
    };

    if (!isHost) {
      // Guests talk to the host only.
      this.sendToPlayer(this.hostId!, message);
      return;
    }

    const to = action?.to;
    if (to !== undefined && to !== null) {
      if (typeof to !== 'string' || !this.players.has(to)) {
        client.sendError('payload.to is not a player in this room', 'BAD_TARGET');
        return;
      }
      this.sendToPlayer(to, message);
    } else {
      this.broadcastExcept(client.id, message);
    }

    if (actionName === 'start') this.phase = 'playing';
    else if (actionName === 'end') this.phase = 'lobby';
  }

  private handleChat(client: Client, data: any): void {
    if (!this.options.isPrivate) {
      client.sendError('Chat is only available in private rooms', 'CHAT_REJECTED');
      return;
    }

    const now = Date.now();
    const last = this.lastChatAt.get(client.id);
    if (last !== undefined && now - last < PANIC_CHAT_INTERVAL_MS) {
      client.sendError('Chat too fast', 'CHAT_REJECTED');
      return;
    }

    const phrase = data?.phrase ?? data?.p ?? data?.id;
    if (typeof phrase !== 'string' || !PANIC_CHAT_PHRASES.has(phrase)) {
      client.sendError('Unknown chat phrase', 'CHAT_REJECTED');
      return;
    }

    // Rebuild the message from whitelisted fields only — anything else is dropped.
    const clean: { phrase: string; who?: string; where?: number } = { phrase };
    if (data.who !== undefined) {
      if (typeof data.who !== 'string' || !PANIC_CHAT_COLORS.has(data.who)) {
        client.sendError('Invalid chat argument: who', 'CHAT_REJECTED');
        return;
      }
      clean.who = data.who;
    }
    if (data.where !== undefined) {
      if (!Number.isInteger(data.where) || data.where < 0 || data.where > PANIC_CHAT_MAX_WHERE) {
        client.sendError('Invalid chat argument: where', 'CHAT_REJECTED');
        return;
      }
      clean.where = data.where;
    }

    this.lastChatAt.set(client.id, now);
    this.broadcast({
      type: MessageType.GAME_ACTION,
      payload: {
        type: 'chat',
        action: 'chat',
        playerId: client.id,
        fromHost: client.id === this.hostId,
        data: clean,
        timestamp: now,
        serverChecked: true,
      },
    });
  }

  // --------------------------------------------------------------------------
  // Unused lifecycle hooks (no server-side simulation)
  // --------------------------------------------------------------------------

  protected onGameAction(_player: PlayerState, _action: GameAction): void {
    /* unreachable — handleGameAction routes directly */
  }

  protected onTick(): void {
    /* no server-side simulation */
  }

  protected onGameStart(): void {
    /* host-driven */
  }

  protected onGameEnd(): unknown {
    return {};
  }
}
