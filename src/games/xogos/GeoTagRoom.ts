/**
 * Game On Dude! - GeoTag Room
 * www.gameonguy.com
 *
 * Geography-based chase game where players hunt art thieves across the globe.
 * Each player is assigned a target to chase while being hunted by someone else.
 */

import { Room, RoomConstructorOptions } from '../../rooms/Room';
import { PlayerState, GameAction } from '../../core/types';
import logger from '../../core/Logger';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// INTERFACES
// ============================================================================

interface Hint {
  id: string;
  type: 'region' | 'landmark' | 'culture' | 'coordinates' | 'climate';
  text: string;
  revealed: boolean;
  revealedAt: number | null;
}

interface Location {
  id: string;
  name: string;
  country: string;
  region: string;
  coordinates: { lat: number; lng: number };
  continent: string;
}

interface LeaderboardEntry {
  playerId: string;
  username: string;
  catches: number;
  score: number;
  rank: number;
}

interface GeoTagPlayerState {
  id: string;
  username: string;
  isBot: boolean;
  isReady: boolean;

  // Position
  currentLocation: string | null;
  previousLocation: string | null;

  // Travel state
  traveling: boolean;
  travelingTo: string | null;
  travelStartedAt: number | null;
  travelArrivesAt: number | null;

  // Target info
  targetId: string | null;
  hints: Hint[];
  hintsRevealed: number;
  stopsRemaining: number;

  // Score
  catches: number;
  score: number;
  coins: number;
  xp: number;

  // Status
  status: 'idle' | 'traveling' | 'minigame' | 'caught';
  caughtBy: string | null;
  caughtAt: number | null;
  respawnAt: number | null;

  // Powerups
  powerups: string[];
  activeEffects: { type: string; expiresAt: number }[];

  // Stats
  distanceTraveled: number;
  minigamesCompleted: number;
  caughtCount: number;
}

interface GeoTagGameState {
  gameId: string;
  region: 'usa' | 'north_america' | 'world';
  mode: 'classic' | 'blitz' | 'educational';
  status: 'waiting' | 'countdown' | 'playing' | 'ended';

  startedAt: number | null;
  endsAt: number | null;
  timeRemaining: number;

  players: { [playerId: string]: GeoTagPlayerState };
  assignments: { [hunterId: string]: string };

  locations: Location[];
  leaderboard: LeaderboardEntry[];

  settings: {
    gameDuration: number;
    maxHints: number;
    hintRevealCost: number;
    travelTime: number;
    catchRadius: number;
    pointsPerCatch: number;
    coinsPerCatch: number;
    respawnTime: number;
  };
}

interface GeoTagRoomOptions extends RoomConstructorOptions {
  region?: 'usa' | 'north_america' | 'world';
  mode?: 'classic' | 'blitz' | 'educational';
  gameDuration?: number;
  botCount?: number;
  botDifficulty?: 'easy' | 'medium' | 'hard';
}

// ============================================================================
// SAMPLE LOCATIONS
// ============================================================================

const LOCATIONS: { [region: string]: Location[] } = {
  usa: [
    { id: 'nyc', name: 'New York City', country: 'USA', region: 'Northeast', coordinates: { lat: 40.7128, lng: -74.0060 }, continent: 'North America' },
    { id: 'la', name: 'Los Angeles', country: 'USA', region: 'West', coordinates: { lat: 34.0522, lng: -118.2437 }, continent: 'North America' },
    { id: 'chicago', name: 'Chicago', country: 'USA', region: 'Midwest', coordinates: { lat: 41.8781, lng: -87.6298 }, continent: 'North America' },
    { id: 'houston', name: 'Houston', country: 'USA', region: 'South', coordinates: { lat: 29.7604, lng: -95.3698 }, continent: 'North America' },
    { id: 'phoenix', name: 'Phoenix', country: 'USA', region: 'Southwest', coordinates: { lat: 33.4484, lng: -112.0740 }, continent: 'North America' },
    { id: 'seattle', name: 'Seattle', country: 'USA', region: 'Northwest', coordinates: { lat: 47.6062, lng: -122.3321 }, continent: 'North America' },
    { id: 'miami', name: 'Miami', country: 'USA', region: 'Southeast', coordinates: { lat: 25.7617, lng: -80.1918 }, continent: 'North America' },
    { id: 'denver', name: 'Denver', country: 'USA', region: 'Mountain', coordinates: { lat: 39.7392, lng: -104.9903 }, continent: 'North America' },
  ],
  north_america: [
    { id: 'nyc', name: 'New York City', country: 'USA', region: 'Northeast', coordinates: { lat: 40.7128, lng: -74.0060 }, continent: 'North America' },
    { id: 'la', name: 'Los Angeles', country: 'USA', region: 'West', coordinates: { lat: 34.0522, lng: -118.2437 }, continent: 'North America' },
    { id: 'toronto', name: 'Toronto', country: 'Canada', region: 'Ontario', coordinates: { lat: 43.6532, lng: -79.3832 }, continent: 'North America' },
    { id: 'vancouver', name: 'Vancouver', country: 'Canada', region: 'British Columbia', coordinates: { lat: 49.2827, lng: -123.1207 }, continent: 'North America' },
    { id: 'mexico_city', name: 'Mexico City', country: 'Mexico', region: 'Central', coordinates: { lat: 19.4326, lng: -99.1332 }, continent: 'North America' },
    { id: 'montreal', name: 'Montreal', country: 'Canada', region: 'Quebec', coordinates: { lat: 45.5017, lng: -73.5673 }, continent: 'North America' },
    { id: 'chicago', name: 'Chicago', country: 'USA', region: 'Midwest', coordinates: { lat: 41.8781, lng: -87.6298 }, continent: 'North America' },
    { id: 'cancun', name: 'Cancun', country: 'Mexico', region: 'Yucatan', coordinates: { lat: 21.1619, lng: -86.8515 }, continent: 'North America' },
  ],
  world: [
    { id: 'nyc', name: 'New York City', country: 'USA', region: 'Northeast', coordinates: { lat: 40.7128, lng: -74.0060 }, continent: 'North America' },
    { id: 'london', name: 'London', country: 'UK', region: 'England', coordinates: { lat: 51.5074, lng: -0.1278 }, continent: 'Europe' },
    { id: 'paris', name: 'Paris', country: 'France', region: 'Ile-de-France', coordinates: { lat: 48.8566, lng: 2.3522 }, continent: 'Europe' },
    { id: 'tokyo', name: 'Tokyo', country: 'Japan', region: 'Kanto', coordinates: { lat: 35.6762, lng: 139.6503 }, continent: 'Asia' },
    { id: 'sydney', name: 'Sydney', country: 'Australia', region: 'NSW', coordinates: { lat: -33.8688, lng: 151.2093 }, continent: 'Oceania' },
    { id: 'rio', name: 'Rio de Janeiro', country: 'Brazil', region: 'Southeast', coordinates: { lat: -22.9068, lng: -43.1729 }, continent: 'South America' },
    { id: 'cairo', name: 'Cairo', country: 'Egypt', region: 'Nile Delta', coordinates: { lat: 30.0444, lng: 31.2357 }, continent: 'Africa' },
    { id: 'dubai', name: 'Dubai', country: 'UAE', region: 'Persian Gulf', coordinates: { lat: 25.2048, lng: 55.2708 }, continent: 'Asia' },
    { id: 'beijing', name: 'Beijing', country: 'China', region: 'North', coordinates: { lat: 39.9042, lng: 116.4074 }, continent: 'Asia' },
    { id: 'rome', name: 'Rome', country: 'Italy', region: 'Lazio', coordinates: { lat: 41.9028, lng: 12.4964 }, continent: 'Europe' },
    { id: 'mumbai', name: 'Mumbai', country: 'India', region: 'Maharashtra', coordinates: { lat: 19.0760, lng: 72.8777 }, continent: 'Asia' },
    { id: 'cape_town', name: 'Cape Town', country: 'South Africa', region: 'Western Cape', coordinates: { lat: -33.9249, lng: 18.4241 }, continent: 'Africa' },
  ],
};

// ============================================================================
// GEOTAG ROOM CLASS
// ============================================================================

export class GeoTagRoom extends Room<GeoTagGameState> {
  private botCount: number;
  private botDifficulty: 'easy' | 'medium' | 'hard';
  private botUpdateInterval: number = 0;

  constructor(gameType: string, options: GeoTagRoomOptions = {}) {
    super(gameType, {
      ...options,
      tickRate: options.tickRate ?? 2, // 2 Hz
      minPlayers: options.minPlayers ?? 2,
      maxPlayers: options.maxPlayers ?? 8,
    });

    this.botCount = options.botCount ?? 0;
    this.botDifficulty = options.botDifficulty ?? 'medium';
  }

  // --------------------------------------------------------------------------
  // STATE INITIALIZATION
  // --------------------------------------------------------------------------

  protected initializeState(): GeoTagGameState {
    const region = (this.options as GeoTagRoomOptions).region ?? 'usa';
    const mode = (this.options as GeoTagRoomOptions).mode ?? 'classic';

    const settings = this.getSettingsForMode(mode);

    return {
      gameId: uuidv4(),
      region,
      mode,
      status: 'waiting',
      startedAt: null,
      endsAt: null,
      timeRemaining: settings.gameDuration,
      players: {},
      assignments: {},
      locations: LOCATIONS[region] || LOCATIONS.usa,
      leaderboard: [],
      settings,
    };
  }

  private getSettingsForMode(mode: string) {
    const baseSettings = {
      gameDuration: 300,
      maxHints: 3,
      hintRevealCost: 25,
      travelTime: 5,
      catchRadius: 1,
      pointsPerCatch: 100,
      coinsPerCatch: 50,
      respawnTime: 5,
    };

    switch (mode) {
      case 'blitz':
        return { ...baseSettings, gameDuration: 120, travelTime: 3 };
      case 'educational':
        return { ...baseSettings, gameDuration: 600, travelTime: 8, hintRevealCost: 10 };
      default:
        return baseSettings;
    }
  }

  // --------------------------------------------------------------------------
  // PLAYER MANAGEMENT
  // --------------------------------------------------------------------------

  protected onPlayerJoin(player: PlayerState): void {
    const startLocation = this.getRandomLocation();

    this.state.players[player.id] = {
      id: player.id,
      username: player.username,
      isBot: false,
      isReady: false,
      currentLocation: startLocation.id,
      previousLocation: null,
      traveling: false,
      travelingTo: null,
      travelStartedAt: null,
      travelArrivesAt: null,
      targetId: null,
      hints: [],
      hintsRevealed: 0,
      stopsRemaining: 5,
      catches: 0,
      score: 0,
      coins: 100, // Starting coins
      xp: 0,
      status: 'idle',
      caughtBy: null,
      caughtAt: null,
      respawnAt: null,
      powerups: [],
      activeEffects: [],
      distanceTraveled: 0,
      minigamesCompleted: 0,
      caughtCount: 0,
    };

    this.log.info({ playerId: player.id, location: startLocation.name }, 'Player joined GeoTag');
  }

  protected onPlayerLeave(player: PlayerState): void {
    // Reassign anyone hunting this player
    for (const [hunterId, targetId] of Object.entries(this.state.assignments)) {
      if (targetId === player.id) {
        this.assignNewTarget(hunterId);
      }
    }

    delete this.state.players[player.id];
    delete this.state.assignments[player.id];
    this.updateLeaderboard();
  }

  // --------------------------------------------------------------------------
  // GAME LIFECYCLE
  // --------------------------------------------------------------------------

  protected onGameStart(): void {
    this.state.status = 'countdown';
    this.state.startedAt = Date.now();
    this.state.endsAt = Date.now() + this.state.settings.gameDuration * 1000;

    // Spawn bots if needed
    this.spawnBots();

    // Create circular chase assignments
    this.createChaseAssignments();

    // Start the game after countdown
    setTimeout(() => {
      this.state.status = 'playing';
      this.broadcast({ type: 'game_start', payload: { state: this.state } });
    }, 3000);

    this.log.info({ gameId: this.state.gameId, playerCount: Object.keys(this.state.players).length }, 'GeoTag game started');
  }

  protected onGameEnd(): unknown {
    this.state.status = 'ended';
    this.updateLeaderboard();

    const winner = this.state.leaderboard[0];
    const playerStats: { [id: string]: any } = {};

    for (const [id, player] of Object.entries(this.state.players)) {
      playerStats[id] = {
        catches: player.catches,
        caughtCount: player.caughtCount,
        distanceTraveled: player.distanceTraveled,
        minigamesCompleted: player.minigamesCompleted,
        coinsEarned: player.coins - 100,
        xpEarned: player.xp,
      };
    }

    return {
      winner,
      leaderboard: this.state.leaderboard,
      playerStats,
      duration: this.state.settings.gameDuration,
    };
  }

  // --------------------------------------------------------------------------
  // GAME TICK
  // --------------------------------------------------------------------------

  protected onTick(deltaTime: number): void {
    if (this.state.status !== 'playing') return;

    const now = Date.now();

    // Update time remaining
    if (this.state.endsAt) {
      this.state.timeRemaining = Math.max(0, Math.floor((this.state.endsAt - now) / 1000));

      if (this.state.timeRemaining <= 0) {
        this.endGame();
        return;
      }
    }

    // Process each player
    for (const player of Object.values(this.state.players)) {
      // Check travel completion
      if (player.traveling && player.travelArrivesAt && now >= player.travelArrivesAt) {
        this.completeTravelInternal(player);
      }

      // Check respawn
      if (player.status === 'caught' && player.respawnAt && now >= player.respawnAt) {
        this.respawnPlayer(player);
      }

      // Clear expired effects
      player.activeEffects = player.activeEffects.filter(e => now < e.expiresAt);
    }

    // Update bots
    this.botUpdateInterval++;
    if (this.botUpdateInterval >= 4) { // Every 2 seconds at 2 Hz
      this.updateBots();
      this.botUpdateInterval = 0;
    }

    // Update leaderboard
    this.updateLeaderboard();
  }

  // --------------------------------------------------------------------------
  // GAME ACTIONS
  // --------------------------------------------------------------------------

  protected onGameAction(player: PlayerState, action: GameAction): void {
    const geoPlayer = this.state.players[player.id];
    if (!geoPlayer) return;

    switch (action.type) {
      case 'travel':
        this.handleTravel(geoPlayer, action.data as { destinationId: string; fromLocationId?: string });
        break;
      case 'reveal_hint':
        this.handleRevealHint(geoPlayer, action.data as { hintIndex: number });
        break;
      case 'catch_attempt':
        this.handleCatchAttempt(geoPlayer);
        break;
      case 'minigame_complete':
        this.handleMinigameComplete(geoPlayer, action.data as { minigameType: string; score: number; perfect: boolean; timeSpent: number });
        break;
      case 'use_powerup':
        this.handleUsePowerup(geoPlayer, action.data as { powerupType: string; targetId?: string });
        break;
      default:
        this.log.warn({ action: action.type }, 'Unknown GeoTag action');
    }
  }

  // --------------------------------------------------------------------------
  // ACTION HANDLERS
  // --------------------------------------------------------------------------

  private handleTravel(player: GeoTagPlayerState, data: { destinationId: string; fromLocationId?: string }): void {
    // Validation
    if (player.traveling) {
      this.sendEventToPlayer(player.id, 'error', { message: 'Already traveling' });
      return;
    }

    if (player.status === 'caught') {
      this.sendEventToPlayer(player.id, 'error', { message: 'Cannot travel while caught' });
      return;
    }

    const destination = this.state.locations.find(l => l.id === data.destinationId);
    if (!destination) {
      this.sendEventToPlayer(player.id, 'error', { message: 'Invalid destination' });
      return;
    }

    // Calculate travel time (with speed boost if active)
    let travelTime = this.state.settings.travelTime * 1000;
    if (player.activeEffects.some(e => e.type === 'speed_boost')) {
      travelTime *= 0.5;
    }

    // Start travel
    player.previousLocation = player.currentLocation;
    player.traveling = true;
    player.travelingTo = data.destinationId;
    player.travelStartedAt = Date.now();
    player.travelArrivesAt = Date.now() + travelTime;
    player.status = 'traveling';

    this.log.debug({ playerId: player.id, destination: destination.name }, 'Player started traveling');
  }

  private completeTravelInternal(player: GeoTagPlayerState): void {
    const destination = this.state.locations.find(l => l.id === player.travelingTo);

    player.currentLocation = player.travelingTo;
    player.traveling = false;
    player.travelingTo = null;
    player.travelStartedAt = null;
    player.travelArrivesAt = null;
    player.status = 'idle';
    player.distanceTraveled++;

    // Send travel complete event
    this.sendEventToPlayer(player.id, 'travel_complete', {
      playerId: player.id,
      location: player.currentLocation,
      minigameRequired: this.state.mode !== 'blitz',
      minigameType: this.getRandomMinigameType(),
      minigameData: {
        country: destination?.country || 'Unknown',
        difficulty: this.state.mode === 'educational' ? 'easy' : 'medium',
      },
    });

    // Check if hunter is nearby for target
    this.checkAndNotifyHunterNearby(player.id);

    // Update target hints for anyone hunting this player
    this.updateHintsForHunters(player);
  }

  private handleRevealHint(player: GeoTagPlayerState, data: { hintIndex: number }): void {
    if (!player.targetId) {
      this.sendEventToPlayer(player.id, 'error', { message: 'No target assigned' });
      return;
    }

    const hint = player.hints[data.hintIndex];
    if (!hint) {
      this.sendEventToPlayer(player.id, 'error', { message: 'Invalid hint index' });
      return;
    }

    if (hint.revealed) {
      this.sendEventToPlayer(player.id, 'error', { message: 'Hint already revealed' });
      return;
    }

    if (player.coins < this.state.settings.hintRevealCost) {
      this.sendEventToPlayer(player.id, 'error', { message: 'Not enough coins' });
      return;
    }

    // Reveal hint
    player.coins -= this.state.settings.hintRevealCost;
    hint.revealed = true;
    hint.revealedAt = Date.now();
    player.hintsRevealed++;

    // Generate hint text based on target location
    const target = this.state.players[player.targetId];
    if (target && target.currentLocation) {
      hint.text = this.generateHintText(hint.type, target.currentLocation);
    }
  }

  private handleCatchAttempt(player: GeoTagPlayerState): void {
    if (!player.targetId) {
      this.sendEventToPlayer(player.id, 'catch_failed', { reason: 'no_target', message: 'No target assigned' });
      return;
    }

    if (player.traveling) {
      this.sendEventToPlayer(player.id, 'catch_failed', { reason: 'traveling', message: 'Cannot catch while traveling' });
      return;
    }

    const target = this.state.players[player.targetId];
    if (!target) {
      this.sendEventToPlayer(player.id, 'catch_failed', { reason: 'target_not_found', message: 'Target not found' });
      return;
    }

    if (target.status === 'caught') {
      this.sendEventToPlayer(player.id, 'catch_failed', { reason: 'target_already_caught', message: 'Target already caught by someone else' });
      return;
    }

    if (player.currentLocation !== target.currentLocation) {
      this.sendEventToPlayer(player.id, 'catch_failed', { reason: 'target_not_here', message: 'Target is not at this location!' });
      return;
    }

    // Successful catch!
    this.processCatch(player, target);
  }

  private processCatch(hunter: GeoTagPlayerState, target: GeoTagPlayerState): void {
    // Award points to hunter
    hunter.catches++;
    hunter.score += this.state.settings.pointsPerCatch;
    hunter.coins += this.state.settings.coinsPerCatch;

    // Mark target as caught
    target.status = 'caught';
    target.caughtBy = hunter.id;
    target.caughtAt = Date.now();
    target.respawnAt = Date.now() + this.state.settings.respawnTime * 1000;
    target.caughtCount++;

    // Notify hunter
    this.sendEventToPlayer(hunter.id, 'catch_success', {
      catcherId: hunter.id,
      targetId: target.id,
      location: hunter.currentLocation,
      pointsAwarded: this.state.settings.pointsPerCatch,
      coinsAwarded: this.state.settings.coinsPerCatch,
    });

    // Notify target
    const respawnLocation = this.getRandomLocation();
    this.sendEventToPlayer(target.id, 'player_caught', {
      caughtBy: hunter.id,
      catcherUsername: hunter.username,
      location: hunter.currentLocation,
      respawnIn: this.state.settings.respawnTime,
      respawnLocation: respawnLocation.id,
    });

    // Store respawn location
    (target as any).pendingRespawnLocation = respawnLocation.id;

    // Assign new target to hunter
    this.assignNewTarget(hunter.id);

    this.log.info({ hunter: hunter.username, target: target.username }, 'Catch successful');
  }

  private handleMinigameComplete(player: GeoTagPlayerState, data: { minigameType: string; score: number; perfect: boolean; timeSpent: number }): void {
    // Validate
    if (data.score < 0 || data.score > 100) {
      this.sendEventToPlayer(player.id, 'error', { message: 'Invalid minigame score' });
      return;
    }

    // Award XP and coins based on performance
    const xpAwarded = Math.floor(data.score / 10) + (data.perfect ? 10 : 0);
    const coinsAwarded = Math.floor(data.score / 20) + (data.perfect ? 5 : 0);

    player.xp += xpAwarded;
    player.coins += coinsAwarded;
    player.minigamesCompleted++;
    player.status = 'idle';

    this.log.debug({ playerId: player.id, score: data.score, xp: xpAwarded }, 'Minigame completed');
  }

  private handleUsePowerup(player: GeoTagPlayerState, data: { powerupType: string; targetId?: string }): void {
    const powerupIndex = player.powerups.indexOf(data.powerupType);
    if (powerupIndex === -1) {
      this.sendEventToPlayer(player.id, 'error', { message: 'Powerup not available' });
      return;
    }

    // Remove powerup from inventory
    player.powerups.splice(powerupIndex, 1);

    const now = Date.now();
    const duration = 30000; // 30 seconds

    switch (data.powerupType) {
      case 'speed_boost':
        player.activeEffects.push({ type: 'speed_boost', expiresAt: now + duration });
        break;
      case 'hint_reveal':
        // Auto-reveal next hint for free
        const unrevealedHint = player.hints.find(h => !h.revealed);
        if (unrevealedHint) {
          unrevealedHint.revealed = true;
          unrevealedHint.revealedAt = now;
          player.hintsRevealed++;
          const target = this.state.players[player.targetId || ''];
          if (target && target.currentLocation) {
            unrevealedHint.text = this.generateHintText(unrevealedHint.type, target.currentLocation);
          }
        }
        break;
      case 'decoy':
        player.activeEffects.push({ type: 'decoy', expiresAt: now + duration });
        break;
      case 'radar':
        // Send direction to target
        if (player.targetId) {
          const direction = this.getDirectionToTarget(player);
          this.sendEventToPlayer(player.id, 'radar_result', { direction });
        }
        break;
    }
  }

  // --------------------------------------------------------------------------
  // HELPER METHODS
  // --------------------------------------------------------------------------

  private getRandomLocation(): Location {
    const locations = this.state.locations;
    return locations[Math.floor(Math.random() * locations.length)];
  }

  private getRandomMinigameType(): string {
    const types = ['flag_quiz', 'capital_quiz', 'landmark_quiz', 'map_click'];
    return types[Math.floor(Math.random() * types.length)];
  }

  private createChaseAssignments(): void {
    const playerIds = Object.keys(this.state.players);
    if (playerIds.length < 2) return;

    // Shuffle players
    const shuffled = [...playerIds].sort(() => Math.random() - 0.5);

    // Create circular assignments
    for (let i = 0; i < shuffled.length; i++) {
      const hunterId = shuffled[i];
      const targetId = shuffled[(i + 1) % shuffled.length];

      this.state.assignments[hunterId] = targetId;
      this.assignTargetToPlayer(hunterId, targetId);
    }
  }

  private assignTargetToPlayer(hunterId: string, targetId: string): void {
    const hunter = this.state.players[hunterId];
    const target = this.state.players[targetId];

    if (!hunter || !target) return;

    hunter.targetId = targetId;
    hunter.hintsRevealed = 0;
    hunter.stopsRemaining = 5;

    // Generate hints
    hunter.hints = this.generateHintsForTarget(target);

    // Send target assigned event
    this.sendEventToPlayer(hunterId, 'target_assigned', {
      targetId,
      targetUsername: target.username,
      targetIsBot: target.isBot,
      hints: hunter.hints,
      stopsRemaining: hunter.stopsRemaining,
    });
  }

  private assignNewTarget(hunterId: string): void {
    const availableTargets = Object.keys(this.state.players).filter(id =>
      id !== hunterId &&
      this.state.players[id].status !== 'caught'
    );

    if (availableTargets.length === 0) return;

    const newTargetId = availableTargets[Math.floor(Math.random() * availableTargets.length)];
    this.state.assignments[hunterId] = newTargetId;
    this.assignTargetToPlayer(hunterId, newTargetId);
  }

  private generateHintsForTarget(target: GeoTagPlayerState): Hint[] {
    const hintTypes: Hint['type'][] = ['region', 'landmark', 'culture'];
    return hintTypes.map((type, index) => ({
      id: `hint-${index}`,
      type,
      text: index === 0 ? this.generateHintText(type, target.currentLocation || '') : '???',
      revealed: index === 0, // First hint revealed by default
      revealedAt: index === 0 ? Date.now() : null,
    }));
  }

  private generateHintText(type: Hint['type'], locationId: string): string {
    const location = this.state.locations.find(l => l.id === locationId);
    if (!location) return 'Unknown location';

    switch (type) {
      case 'region':
        return `Your target is in ${location.continent}`;
      case 'landmark':
        return `Your target is near famous landmarks in ${location.country}`;
      case 'culture':
        return `Your target is in a ${location.country} city`;
      case 'coordinates':
        return `Your target is near ${location.coordinates.lat.toFixed(0)}°, ${location.coordinates.lng.toFixed(0)}°`;
      case 'climate':
        return `Your target is in ${location.region}`;
      default:
        return 'No hint available';
    }
  }

  private updateHintsForHunters(movedPlayer: GeoTagPlayerState): void {
    // Find anyone hunting this player and update their hints
    for (const [hunterId, targetId] of Object.entries(this.state.assignments)) {
      if (targetId === movedPlayer.id) {
        const hunter = this.state.players[hunterId];
        if (hunter) {
          hunter.stopsRemaining = Math.max(0, hunter.stopsRemaining - 1);

          // Update revealed hint texts
          for (const hint of hunter.hints) {
            if (hint.revealed && movedPlayer.currentLocation) {
              hint.text = this.generateHintText(hint.type, movedPlayer.currentLocation);
            }
          }

          this.sendEventToPlayer(hunterId, 'target_moved', {
            stopsRemaining: hunter.stopsRemaining,
            newHints: hunter.hints,
          });
        }
      }
    }
  }

  private checkAndNotifyHunterNearby(targetId: string): void {
    const target = this.state.players[targetId];
    if (!target || target.activeEffects.some(e => e.type === 'decoy')) return;

    // Find who is hunting this target
    for (const [hunterId, assignedTarget] of Object.entries(this.state.assignments)) {
      if (assignedTarget === targetId) {
        const hunter = this.state.players[hunterId];
        if (hunter && hunter.currentLocation === target.currentLocation) {
          this.sendEventToPlayer(targetId, 'hunter_nearby', {
            distance: 'imminent',
            direction: 'here',
          });
        }
      }
    }
  }

  private getDirectionToTarget(hunter: GeoTagPlayerState): string {
    if (!hunter.targetId) return 'unknown';

    const target = this.state.players[hunter.targetId];
    if (!target || !target.currentLocation || !hunter.currentLocation) return 'unknown';

    const hunterLoc = this.state.locations.find(l => l.id === hunter.currentLocation);
    const targetLoc = this.state.locations.find(l => l.id === target.currentLocation);

    if (!hunterLoc || !targetLoc) return 'unknown';

    const dLng = targetLoc.coordinates.lng - hunterLoc.coordinates.lng;
    const dLat = targetLoc.coordinates.lat - hunterLoc.coordinates.lat;

    if (Math.abs(dLng) > Math.abs(dLat)) {
      return dLng > 0 ? 'east' : 'west';
    } else {
      return dLat > 0 ? 'north' : 'south';
    }
  }

  private respawnPlayer(player: GeoTagPlayerState): void {
    const respawnLocationId = (player as any).pendingRespawnLocation || this.getRandomLocation().id;

    player.currentLocation = respawnLocationId;
    player.status = 'idle';
    player.caughtBy = null;
    player.caughtAt = null;
    player.respawnAt = null;
    delete (player as any).pendingRespawnLocation;

    this.log.debug({ playerId: player.id, location: respawnLocationId }, 'Player respawned');
  }

  private updateLeaderboard(): void {
    const entries: LeaderboardEntry[] = Object.values(this.state.players)
      .map(p => ({
        playerId: p.id,
        username: p.username,
        catches: p.catches,
        score: p.score,
        rank: 0,
      }))
      .sort((a, b) => b.score - a.score);

    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    this.state.leaderboard = entries;
  }

  // --------------------------------------------------------------------------
  // BOT MANAGEMENT
  // --------------------------------------------------------------------------

  private spawnBots(): void {
    for (let i = 0; i < this.botCount; i++) {
      const botId = `bot-${uuidv4().substring(0, 8)}`;
      const startLocation = this.getRandomLocation();

      this.state.players[botId] = {
        id: botId,
        username: `Bot_${i + 1}`,
        isBot: true,
        isReady: true,
        currentLocation: startLocation.id,
        previousLocation: null,
        traveling: false,
        travelingTo: null,
        travelStartedAt: null,
        travelArrivesAt: null,
        targetId: null,
        hints: [],
        hintsRevealed: 0,
        stopsRemaining: 5,
        catches: 0,
        score: 0,
        coins: 100,
        xp: 0,
        status: 'idle',
        caughtBy: null,
        caughtAt: null,
        respawnAt: null,
        powerups: [],
        activeEffects: [],
        distanceTraveled: 0,
        minigamesCompleted: 0,
        caughtCount: 0,
      };
    }
  }

  private updateBots(): void {
    for (const player of Object.values(this.state.players)) {
      if (!player.isBot || player.status === 'caught') continue;

      // Bot behavior based on difficulty
      const moveChance = this.botDifficulty === 'easy' ? 0.1 : this.botDifficulty === 'medium' ? 0.2 : 0.3;

      if (!player.traveling && Math.random() < moveChance) {
        // Pick a random destination
        const destinations = this.state.locations.filter(l => l.id !== player.currentLocation);
        if (destinations.length > 0) {
          const dest = destinations[Math.floor(Math.random() * destinations.length)];
          this.handleTravel(player, { destinationId: dest.id });
        }
      }

      // Bot catch attempt
      if (!player.traveling && player.targetId) {
        const target = this.state.players[player.targetId];
        if (target && target.currentLocation === player.currentLocation && target.status !== 'caught') {
          this.handleCatchAttempt({ id: player.id } as any);
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // UTILITY
  // --------------------------------------------------------------------------

  private sendEventToPlayer(playerId: string, type: string, payload: any): void {
    const client = this.getClientByPlayerId(playerId);
    if (client) {
      client.send({ type, payload });
    }
  }

  private getClientByPlayerId(playerId: string): any {
    for (const [clientId, player] of this.players) {
      if (player.id === playerId) {
        return this.clients.get(clientId);
      }
    }
    return null;
  }
}
