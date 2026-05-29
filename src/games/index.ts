/**
 * Game On Dude! - Game Modules Index
 *
 * Export all game room types for easy registration.
 *
 * www.gameonguy.com
 */

export * from './TriviaRoom';
export * from './RealTimeMovementRoom';
export * from './TurnBasedRoom';

// Game-specific implementations
export * from './xogos';

// Game category constants
export const GameCategories = {
  TRIVIA: 'trivia',
  REAL_TIME: 'real_time',
  TURN_BASED: 'turn_based',
} as const;

// Pre-configured game types
export const GameOnGames = {
  LIGHTNING_ROUND: {
    type: 'lightning_round',
    name: 'Lightning Round',
    category: GameCategories.TRIVIA,
    minPlayers: 2,
    maxPlayers: 8,
    defaultTickRate: 2,
  },
  TIME_QUEST: {
    type: 'time_quest',
    name: 'TimeQuest',
    category: GameCategories.TRIVIA,
    minPlayers: 2,
    maxPlayers: 4,
    defaultTickRate: 2,
  },
  NUMBER_MUNCHERS: {
    type: 'number_munchers',
    name: 'Number Munchers',
    category: GameCategories.REAL_TIME,
    minPlayers: 1,
    maxPlayers: 4,
    defaultTickRate: 20,
  },
  HISTORICAL_CONQUEST: {
    type: 'historical_conquest',
    name: 'Historical Conquest',
    category: GameCategories.TURN_BASED,
    minPlayers: 2,
    maxPlayers: 4,
    defaultTickRate: 1,
  },
  PANIC_ATTACK: {
    type: 'panic_attack',
    name: 'Panic Attack',
    category: GameCategories.REAL_TIME,
    minPlayers: 4,
    maxPlayers: 15,
    defaultTickRate: 20,
  },
  GEOTAG: {
    type: 'geotag',
    name: 'GeoTag',
    category: GameCategories.REAL_TIME,
    minPlayers: 2,
    maxPlayers: 8,
    defaultTickRate: 2,
  },
  TYPING_RACE: {
    type: 'typing_race',
    name: 'Typing Race',
    category: GameCategories.REAL_TIME,
    minPlayers: 2,
    maxPlayers: 8,
    defaultTickRate: 1,
  },
} as const;

// Backwards compatibility alias
export const XogosGames = GameOnGames;
