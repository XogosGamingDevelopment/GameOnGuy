/**
 * Game On Dude! - Typing Race Room
 * www.gameonguy.com
 *
 * A lightweight "relay" room type built for typing races (e.g. Turbo Type:
 * Racing Edition). Unlike the rule-driven game rooms (trivia, turn-based,
 * movement) this room does NOT simulate gameplay. It simply:
 *
 *   1. Accepts three client actions and relays an authoritative snapshot of
 *      everyone's progress to all players in the room.
 *   2. Ranks players by finish order.
 *   3. Broadcasts a final game_end with standings.
 *
 * Client -> Server (game_action):
 *   - race_setup : { text, startAt }            (host only)
 *   - progress   : { position, wpm, accuracy }   (~8x/sec)
 *   - finish     : { time, wpm, accuracy }
 *
 * Server -> Clients:
 *   - state_update : { state: { status, text, startAt, players: [...] } }
 *   - game_end     : { results: { standings: [ { id, username, place, wpm,
 *                       accuracy, time } ] } }
 *
 * Design note: the base Room rejects game_action while the room is not
 * IN_PROGRESS ("Game not in progress"). For a relay room that gate is
 * counter-productive, so handleGameAction() is overridden here to accept the
 * race actions as soon as players are in the room. We manage our own
 * `status` field instead of leaning on the room lifecycle/tick loop.
 */

import { Room, RoomConstructorOptions } from '../../rooms/Room';
import { Client } from '../../core/Client';
import { PlayerState, GameAction, MessageType } from '../../core/types';

// Server -> client message type for the authoritative relay snapshot.
const STATE_UPDATE = 'state_update';

// ============================================================================
// INTERFACES
// ============================================================================

interface TypingRacePlayerState {
  id: string;
  username: string;
  /** 0-100, percent of the text completed */
  position: number;
  wpm: number;
  accuracy: number;
  finished: boolean;
  /** Seconds taken to finish (as reported by the client), or null */
  time: number | null;
  /** 1-based finishing place, or null until ranked */
  place: number | null;
}

interface TypingRaceState {
  status: 'waiting' | 'racing' | 'finished';
  /** The sentence everyone types (set by the host via race_setup) */
  text: string;
  /** Epoch ms when the race should begin (set by the host) */
  startAt: number | null;
  players: { [playerId: string]: TypingRacePlayerState };
  standings: StandingsEntry[];
}

interface StandingsEntry {
  id: string;
  username: string;
  place: number;
  wpm: number;
  accuracy: number;
  time: number | null;
  finished: boolean;
}

interface RaceSetupData {
  text?: string;
  startAt?: number;
}

interface ProgressData {
  position?: number;
  wpm?: number;
  accuracy?: number;
}

interface FinishData {
  time?: number;
  wpm?: number;
  accuracy?: number;
}

export interface TypingRaceRoomOptions extends RoomConstructorOptions {
  /**
   * After the first player finishes, wait this many ms for the rest before
   * ending the race anyway. Default 15s.
   */
  finishGraceMs?: number;
  /** Default lead time (ms) added to startAt when the host omits it. */
  defaultCountdownMs?: number;
}

// ============================================================================
// TYPING RACE ROOM
// ============================================================================

export class TypingRaceRoom extends Room<TypingRaceState> {
  private readonly finishGraceMs: number;
  private readonly defaultCountdownMs: number;

  /** Monotonic counter assigning finishing places in arrival order. */
  private finishOrder = 0;
  private graceTimer?: NodeJS.Timeout;

  constructor(gameType: string, options: TypingRaceRoomOptions = {}) {
    super(gameType, {
      ...options,
      // No server-side simulation, so the tick rate is irrelevant; keep it low.
      tickRate: options.tickRate ?? 1,
      minPlayers: options.minPlayers ?? 2,
      maxPlayers: options.maxPlayers ?? 8,
    });

    this.finishGraceMs = options.finishGraceMs ?? 15000;
    this.defaultCountdownMs = options.defaultCountdownMs ?? 3000;
  }

  // --------------------------------------------------------------------------
  // STATE
  // --------------------------------------------------------------------------

  protected initializeState(): TypingRaceState {
    return {
      status: 'waiting',
      text: '',
      startAt: null,
      players: {},
      standings: [],
    };
  }

  protected onPlayerJoin(player: PlayerState): void {
    this.state.players[player.id] = {
      id: player.id,
      username: player.username,
      position: 0,
      wpm: 0,
      accuracy: 100,
      finished: false,
      time: null,
      place: null,
    };
    // Let everyone (including the joiner) see the refreshed roster.
    this.broadcastStateUpdate();
  }

  protected onPlayerLeave(player: PlayerState): void {
    delete this.state.players[player.id];

    // A departure might mean everyone still here has already finished.
    if (this.state.status === 'racing') {
      this.broadcastStateUpdate();
      this.maybeEndRace();
    }
  }

  // --------------------------------------------------------------------------
  // ACTION RELAY
  // --------------------------------------------------------------------------

  /**
   * Override the base handler so race actions are accepted as soon as players
   * are in the room, instead of being rejected with "Game not in progress".
   *
   * We also accept two payload shape variations that integrators write
   * intuitively when reading the spec:
   *   - Action name in `type` (canonical) OR `action` (Turbo Type sent this).
   *   - Data nested under `data` (canonical) OR flat at the payload root.
   * Either shape resolves to the same `GameAction` internally.
   */
  public handleGameAction(client: Client, action: any): void {
    const player = this.players.get(client.id);
    if (!player) return;

    player.lastActivity = Date.now();

    const actionName = action?.type ?? action?.action;
    // If `data` isn't explicitly nested, treat the whole payload as the data
    // bag (so `{ action:"progress", position:50, wpm:60, accuracy:90 }` works).
    const data = action?.data ?? action;

    const gameAction: GameAction = {
      type: actionName,
      playerId: client.id,
      data,
      timestamp: Date.now(),
      sequence: action?.sequence,
    };

    this.onGameAction(player, gameAction);
  }

  protected onGameAction(player: PlayerState, action: GameAction): void {
    switch (action.type) {
      case 'race_setup':
        this.handleRaceSetup(player, (action.data ?? {}) as RaceSetupData);
        break;
      case 'progress':
        this.handleProgress(player, (action.data ?? {}) as ProgressData);
        break;
      case 'finish':
        this.handleFinish(player, (action.data ?? {}) as FinishData);
        break;
      default: {
        // Send a real error back. Because we shadow the base "Game not in
        // progress" gate, silence would be confusing — make unrecognized
        // action names visible to the integrator.
        this.log.warn(
          { action: action.type, playerId: player.id },
          'Unknown typing_race action'
        );
        const c = this.clients.get(player.id);
        c?.sendError(
          `Unknown typing_race action: ${action.type ?? '(missing action name; send payload.type or payload.action)'}`
        );
        break;
      }
    }
  }

  private handleRaceSetup(player: PlayerState, data: RaceSetupData): void {
    // race_setup is host-only. Ignore (don't error) if a non-host sends it.
    if (!this.isHost(player.id)) {
      this.log.debug({ playerId: player.id }, 'Ignoring race_setup from non-host');
      return;
    }

    const text = typeof data.text === 'string' ? data.text : '';
    if (!text.trim()) {
      this.log.warn({ playerId: player.id }, 'race_setup missing text');
      return;
    }

    const startAt =
      typeof data.startAt === 'number' && Number.isFinite(data.startAt)
        ? data.startAt
        : Date.now() + this.defaultCountdownMs;

    // (Re)initialize the race. Supports rematches: a fresh race_setup after a
    // race has finished resets everyone's progress.
    this.clearGraceTimer();
    this.finishOrder = 0;
    this.state.status = 'racing';
    this.state.text = text;
    this.state.startAt = startAt;
    this.state.standings = [];

    for (const p of Object.values(this.state.players)) {
      p.position = 0;
      p.wpm = 0;
      p.accuracy = 100;
      p.finished = false;
      p.time = null;
      p.place = null;
    }

    this.log.info(
      { hostId: player.id, startAt, players: Object.keys(this.state.players).length },
      'Typing race set up'
    );

    this.broadcastStateUpdate();
  }

  private handleProgress(player: PlayerState, data: ProgressData): void {
    const racer = this.state.players[player.id];
    if (!racer || racer.finished || this.state.status !== 'racing') return;

    racer.position = clampPercent(data.position, racer.position);
    racer.wpm = toNonNegativeInt(data.wpm, racer.wpm);
    racer.accuracy = clampPercent(data.accuracy, racer.accuracy);

    this.broadcastStateUpdate();
  }

  private handleFinish(player: PlayerState, data: FinishData): void {
    const racer = this.state.players[player.id];
    if (!racer || racer.finished || this.state.status !== 'racing') return;

    racer.finished = true;
    racer.position = 100;
    racer.wpm = toNonNegativeInt(data.wpm, racer.wpm);
    racer.accuracy = clampPercent(data.accuracy, racer.accuracy);
    racer.time =
      typeof data.time === 'number' && Number.isFinite(data.time) && data.time >= 0
        ? data.time
        : null;
    racer.place = ++this.finishOrder;

    this.log.info(
      { playerId: player.id, place: racer.place, time: racer.time, wpm: racer.wpm },
      'Player finished typing race'
    );

    this.broadcastStateUpdate();

    // Start the grace window on the first finisher, then end when it elapses
    // (or immediately once everyone is done).
    if (this.finishOrder === 1 && !this.graceTimer) {
      this.graceTimer = setTimeout(() => {
        this.graceTimer = undefined;
        this.endRace();
      }, this.finishGraceMs);
    }

    this.maybeEndRace();
  }

  // --------------------------------------------------------------------------
  // RACE COMPLETION
  // --------------------------------------------------------------------------

  /** End the race immediately if every remaining player has finished. */
  private maybeEndRace(): void {
    const racers = Object.values(this.state.players);
    if (racers.length === 0) return;
    if (racers.every((p) => p.finished)) {
      this.endRace();
    }
  }

  private endRace(): void {
    if (this.state.status === 'finished') return;
    this.clearGraceTimer();
    this.state.status = 'finished';

    const standings = this.computeStandings();
    this.state.standings = standings;

    this.broadcast({
      type: MessageType.GAME_END,
      payload: { results: { standings } },
    });

    this.emit('gameEnded', { standings });
    this.log.info({ standings }, 'Typing race ended');
  }

  /**
   * Finishers first, in finishing order; any non-finishers after them ranked
   * by how far they got (then wpm). Places are renumbered 1..N.
   */
  private computeStandings(): StandingsEntry[] {
    const ranked = Object.values(this.state.players).sort((a, b) => {
      if (a.finished && b.finished) return (a.place ?? 0) - (b.place ?? 0);
      if (a.finished) return -1;
      if (b.finished) return 1;
      if (b.position !== a.position) return b.position - a.position;
      return b.wpm - a.wpm;
    });

    return ranked.map((p, index) => ({
      id: p.id,
      username: p.username,
      place: index + 1,
      wpm: p.wpm,
      accuracy: p.accuracy,
      time: p.time,
      finished: p.finished,
    }));
  }

  // --------------------------------------------------------------------------
  // ROOM LIFECYCLE HOOKS (unused — relay manages its own status)
  // --------------------------------------------------------------------------

  protected onTick(): void {
    /* no server-side simulation */
  }

  protected onGameStart(): void {
    /* the relay starts on race_setup, not the room lifecycle */
  }

  protected onGameEnd(): unknown {
    return { standings: this.state.standings };
  }

  public dispose(): void {
    this.clearGraceTimer();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private broadcastStateUpdate(): void {
    this.broadcast({
      type: STATE_UPDATE,
      payload: {
        state: {
          status: this.state.status,
          text: this.state.text,
          startAt: this.state.startAt,
          players: Object.values(this.state.players).map((p) => ({
            id: p.id,
            username: p.username,
            position: p.position,
            wpm: p.wpm,
            accuracy: p.accuracy,
            finished: p.finished,
          })),
        },
      },
    });
  }

  /**
   * The host is the room creator when we can match them, otherwise the
   * earliest player to join. Used to gate race_setup.
   */
  private isHost(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    if (this.creatorId && player.userId === this.creatorId) return true;

    // If the creator id matches someone present, only that player is the host.
    if (this.creatorId) {
      const creatorPresent = Array.from(this.players.values()).some(
        (p) => p.userId === this.creatorId
      );
      if (creatorPresent) return false;
    }

    // Otherwise fall back to the earliest player to join.
    let earliest: PlayerState | undefined;
    for (const p of this.players.values()) {
      if (!earliest || p.joinedAt < earliest.joinedAt) earliest = p;
    }
    return earliest?.id === playerId;
  }

  private clearGraceTimer(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = undefined;
    }
  }
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function clampPercent(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}
