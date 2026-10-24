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
 *   2. Ranks players by finish order (DNFs after every finisher).
 *   3. Broadcasts a final game_end with standings.
 *
 * Client -> Server (game_action):
 *   - race_setup : { text, startAt, ...extras }  (host only; extras such as
 *                  typingMode/length/difficulty/cars are passed through)
 *   - progress   : { position, wpm, accuracy, carId? }   (~8x/sec)
 *   - finish     : { time, wpm, accuracy } or { dnf: true, position, ... }
 * Client -> Server (other):
 *   - player_ready { ready, carId }     carId kept as player data
 *   - room_update  { metadata }         host only, not during a race
 *
 * Server -> Clients:
 *   - state_update : { state: { ...extras, status, text, startAt, players: [...] } }
 *   - room_updated : { metadata }
 *   - game_end     : { results: { standings: [ { id, username, place, wpm,
 *                       accuracy, time, finished, dnf, data } ] } }
 *
 * Rooms are classroom rooms by default: every room gets a 6-letter join code
 * and is hidden from room_list unless the host creates it with
 * isPrivate: false. A dropped player's seat and progress are held for 90 s
 * (rejoinToken); after that they are marked DNF at their last position.
 * New players can't join once a race is running.
 *
 * Design note: the base Room rejects game_action while the room is not
 * IN_PROGRESS ("Game not in progress"). For a relay room that gate is
 * counter-productive, so handleGameAction() is overridden here to accept the
 * race actions as soon as players are in the room. We manage our own
 * `status` field instead of leaning on the room lifecycle/tick loop.
 */

import { Room, RoomConstructorOptions, RoomError } from '../../rooms/Room';
import { Client } from '../../core/Client';
import { PlayerState, GameAction, Message, MessageType } from '../../core/types';

// Server -> client message type for the authoritative relay snapshot.
const STATE_UPDATE = 'state_update';

/** Longest finish grace window a room may ask for. */
const MAX_FINISH_GRACE_MS = 5 * 60 * 1000;
/** Longest default countdown a room may ask for. */
const MAX_COUNTDOWN_MS = 60 * 1000;
/** How long a dropped racer's seat and progress are held. */
const REJOIN_HOLD_MS = 90 * 1000;
/** Size caps for client-supplied blobs that are relayed to everyone. */
const MAX_METADATA_BYTES = 2048;
const MAX_SETUP_EXTRAS_BYTES = 8192;
/** race_setup fields that are not relayed as extras. */
const SETUP_RESERVED_KEYS = new Set([
  'text', 'startAt', 'status', 'players', 'standings', 'action', 'type', 'data', 'sequence',
]);

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
  /** Done racing: crossed the line, or DNF */
  finished: boolean;
  /** Ended early (finish { dnf: true }, or dropped and didn't come back) */
  dnf: boolean;
  /** Left the room mid-race; kept so they still appear in the standings */
  left: boolean;
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
  /** Other race_setup fields (typingMode, length, difficulty, cars, ...) */
  setup: Record<string, unknown>;
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
  dnf: boolean;
  data: Record<string, unknown>;
}

interface RaceSetupData {
  text?: string;
  startAt?: number;
  [key: string]: unknown;
}

interface ProgressData {
  position?: number;
  wpm?: number;
  accuracy?: number;
  carId?: unknown;
}

interface FinishData {
  time?: number;
  wpm?: number;
  accuracy?: number;
  dnf?: boolean;
  position?: number;
}

export interface TypingRaceRoomOptions extends RoomConstructorOptions {
  /**
   * After the first player finishes, wait this many ms for the rest before
   * ending the race anyway. Default 15s, capped at 5 minutes.
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
  /** Listed in room_list only when the host asked for a public room. */
  private readonly listed: boolean;

  /** Monotonic counter assigning finishing places in arrival order. */
  private finishOrder = 0;
  private graceTimer?: NodeJS.Timeout;

  constructor(gameType: string, options: TypingRaceRoomOptions = {}) {
    const listed = options.isPrivate === false;
    super(gameType, {
      ...options,
      isPrivate: !listed,
      // No server-side simulation, so the tick rate is irrelevant; keep it low.
      tickRate: options.tickRate ?? 1,
      minPlayers: options.minPlayers ?? 2,
      maxPlayers: options.maxPlayers ?? 8,
    });

    this.listed = listed;
    this.finishGraceMs = clampMs(options.finishGraceMs, 15000, MAX_FINISH_GRACE_MS);
    this.defaultCountdownMs = clampMs(options.defaultCountdownMs, 3000, MAX_COUNTDOWN_MS);
  }

  // --------------------------------------------------------------------------
  // ROOM CONFIGURATION
  // --------------------------------------------------------------------------

  public wantsJoinCode(): boolean {
    return true;
  }

  public joinCodeLength(): number {
    return 6;
  }

  public isListed(): boolean {
    return this.listed;
  }

  protected rejoinHoldMs(): number {
    return REJOIN_HOLD_MS;
  }

  protected canJoin(_client: Client): boolean | string {
    if (this.state.status === 'racing') {
      throw new RoomError('This race has already started', 'RACE_IN_PROGRESS');
    }
    return true;
  }

  /** Player info Turbo Type sends: the racer's car. Nothing else is kept. */
  protected sanitizePlayerData(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') return null;
    const carId = (raw as { carId?: unknown }).carId;
    if (typeof carId !== 'string' || !/^[\w.-]{1,64}$/.test(carId)) return null;
    return { carId };
  }

  /** player_ready carries carId flat ({ ready, carId }) or under playerData. */
  protected playerDataFromReady(payload: any): unknown {
    return payload?.playerData ?? payload;
  }

  protected readyBroadcastPayload(player: PlayerState): Record<string, unknown> {
    const payload = super.readyBroadcastPayload(player);
    if (player.data.carId !== undefined) payload.carId = player.data.carId;
    return payload;
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

  // --------------------------------------------------------------------------
  // STATE
  // --------------------------------------------------------------------------

  protected initializeState(): TypingRaceState {
    return {
      status: 'waiting',
      text: '',
      startAt: null,
      setup: {},
      players: {},
      standings: [],
    };
  }

  protected onPlayerJoin(player: PlayerState): void {
    this.state.players[player.id] = newRacer(player);
    // Let everyone (including the joiner) see the refreshed roster.
    this.broadcastStateUpdate();
  }

  protected onPlayerLeave(player: PlayerState): void {
    const racer = this.state.players[player.id];

    if (this.state.status === 'racing' && racer) {
      // Keep them in the standings: a racer who leaves (or whose rejoin hold
      // ran out) mid-race is a DNF at their last position.
      if (!racer.finished) {
        racer.finished = true;
        racer.dnf = true;
      }
      racer.left = true;
      this.broadcastStateUpdate();
      this.maybeEndRace();
      return;
    }

    delete this.state.players[player.id];
  }

  protected onPlayerDisconnect(_player: PlayerState): void {
    this.broadcastStateUpdate();
  }

  protected onPlayerReconnect(_player: PlayerState): void {
    this.broadcastStateUpdate();
  }

  public setPlayerReady(id: string, ready: boolean, payload?: unknown): void {
    super.setPlayerReady(id, ready, payload);
    // carId may have changed; state_update carries it on every player.
    this.broadcastStateUpdate();
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
    const player = this.players.get(this.playerIdOf(client));
    if (!player) return;

    player.lastActivity = Date.now();

    const actionName = action?.type ?? action?.action;
    // If `data` isn't explicitly nested, treat the whole payload as the data
    // bag (so `{ action:"progress", position:50, wpm:60, accuracy:90 }` works).
    const data = action?.data ?? action;

    const gameAction: GameAction = {
      type: actionName,
      playerId: player.id,
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

  protected onMessage(client: Client, message: Message): void {
    if (message.type === MessageType.ROOM_UPDATE) {
      this.handleRoomUpdate(client, message.payload);
    }
  }

  /** Host changes the room's settings (metadata) in the lobby or between races. */
  private handleRoomUpdate(client: Client, payload: any): void {
    const playerId = this.playerIdOf(client);
    if (!this.isHost(playerId)) {
      client.sendError('Only the host can change room settings', 'NOT_HOST');
      return;
    }
    if (this.state.status === 'racing') {
      client.sendError("Room settings can't be changed during a race", 'RACE_IN_PROGRESS');
      return;
    }

    const metadata = payload?.metadata;
    if (!isPlainObject(metadata)) {
      client.sendError('room_update needs a metadata object', 'BAD_METADATA');
      return;
    }
    const merged = { ...(this.options.metadata ?? {}), ...metadata };
    if (jsonSize(merged) > MAX_METADATA_BYTES) {
      client.sendError(`Room settings must be under ${MAX_METADATA_BYTES} bytes`, 'BAD_METADATA');
      return;
    }

    this.options.metadata = merged;
    this.broadcast({ type: MessageType.ROOM_UPDATED, payload: { metadata: merged } });
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

    const setup: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!SETUP_RESERVED_KEYS.has(key)) setup[key] = value;
    }
    if (jsonSize(setup) > MAX_SETUP_EXTRAS_BYTES) {
      this.log.warn({ playerId: player.id }, 'race_setup extras too large; dropped');
      for (const key of Object.keys(setup)) delete setup[key];
    }

    // (Re)initialize the race. Supports rematches: a fresh race_setup after a
    // race has finished resets everyone's progress.
    this.clearGraceTimer();
    this.finishOrder = 0;
    this.state.status = 'racing';
    this.state.text = text;
    this.state.startAt = startAt;
    this.state.setup = setup;
    this.state.standings = [];

    for (const id of Object.keys(this.state.players)) {
      const present = this.players.get(id);
      if (present) {
        this.state.players[id] = newRacer(present);
      } else {
        delete this.state.players[id];
      }
    }

    this.log.info(
      { hostId: player.id, startAt, players: Object.keys(this.state.players).length },
      'Typing race set up'
    );

    this.broadcastStateUpdate();
  }

  private handleProgress(player: PlayerState, data: ProgressData): void {
    const carData = this.sanitizePlayerData(data);
    if (carData) Object.assign(player.data, carData);

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
    racer.wpm = toNonNegativeInt(data.wpm, racer.wpm);
    racer.accuracy = clampPercent(data.accuracy, racer.accuracy);

    if (data.dnf === true) {
      // Ended early: keep their real position; ranked after every finisher.
      racer.dnf = true;
      racer.position = clampPercent(data.position, racer.position);
      racer.time = null;
    } else {
      racer.position = 100;
      racer.time =
        typeof data.time === 'number' && Number.isFinite(data.time) && data.time >= 0
          ? data.time
          : null;
      racer.place = ++this.finishOrder;
    }

    this.log.info(
      { playerId: player.id, place: racer.place, dnf: racer.dnf, time: racer.time, wpm: racer.wpm },
      'Player finished typing race'
    );

    this.broadcastStateUpdate();

    // Start the grace window on the first real finisher, then end when it
    // elapses (or immediately once everyone is done).
    if (this.finishOrder === 1 && !racer.dnf && !this.graceTimer) {
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

  /** End the race immediately if every racer is done (finished or DNF). */
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

    // Players who left mid-race were only kept for these standings.
    for (const [id, racer] of Object.entries(this.state.players)) {
      if (racer.left) delete this.state.players[id];
    }

    this.emit('gameEnded', { standings });
    // Student privacy: no names in logs.
    this.log.info(
      { standings: standings.map(({ id, place, wpm, dnf }) => ({ id, place, wpm, dnf })) },
      'Typing race ended'
    );
  }

  /**
   * Finishers first, in finishing order; then DNFs and anyone still typing,
   * ranked by how far they got (then wpm). Places are renumbered 1..N.
   */
  private computeStandings(): StandingsEntry[] {
    const crossed = (p: TypingRacePlayerState) => p.finished && !p.dnf;
    const ranked = Object.values(this.state.players).sort((a, b) => {
      if (crossed(a) && crossed(b)) return (a.place ?? 0) - (b.place ?? 0);
      if (crossed(a)) return -1;
      if (crossed(b)) return 1;
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
      dnf: p.dnf,
      data: this.players.get(p.id)?.data ?? {},
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

  public dispose(reason?: string, extra?: Record<string, unknown>): void {
    this.clearGraceTimer();
    super.dispose(reason, extra);
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private broadcastStateUpdate(): void {
    this.broadcast({
      type: STATE_UPDATE,
      payload: {
        state: {
          ...this.state.setup,
          status: this.state.status,
          text: this.state.text,
          startAt: this.state.startAt,
          players: Object.values(this.state.players).map((p) => {
            const member = this.players.get(p.id);
            return {
              id: p.id,
              username: p.username,
              position: p.position,
              wpm: p.wpm,
              accuracy: p.accuracy,
              finished: p.finished,
              dnf: p.dnf,
              connected: member?.isConnected ?? false,
              data: member?.data ?? {},
            };
          }),
        },
      },
    });
  }

  /**
   * The host is the room creator when we can match them, otherwise the
   * earliest player to join. Used to gate race_setup and room_update.
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

function newRacer(player: PlayerState): TypingRacePlayerState {
  return {
    id: player.id,
    username: player.username,
    position: 0,
    wpm: 0,
    accuracy: 100,
    finished: false,
    dnf: false,
    left: false,
    time: null,
    place: null,
  };
}

function clampPercent(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

function clampMs(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.round(value)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function jsonSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return Infinity;
  }
}
