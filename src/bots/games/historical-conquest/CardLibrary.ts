/**
 * Card Library for Historical Conquest Bot
 * Contains all card definitions for bot decision-making
 */

export interface CardData {
  index: number;
  name: string;
  type: 'Character' | 'Land' | 'Active';
  subType: string;
  attack: number;
  defense: number;
  abilityType: number;  // 0=ETB, 1=Interrupt, 2=Hold, 3=Constant, 4=Combo, 5=Duration, 6=ComboHeld, 7=TurnCounter
  moraleGain: number;   // Morale gained when played
  tags: string[];
  isInteractive: boolean;  // Requires targeting opponent's cards
  priority: number;  // Bot priority score (higher = play first)
}

export const CARD_LIBRARY: CardData[] = [
  // 0 - Aaron Burr
  { index: 0, name: 'Aaron Burr', type: 'Character', subType: 'Politician', attack: 100, defense: 120, abilityType: 0, moraleGain: 0, tags: [], isInteractive: true, priority: 55 },

  // 1 - Akashi Shiganosuke
  { index: 1, name: 'Akashi Shiganosuke', type: 'Character', subType: 'Athlete', attack: 40, defense: 30, abilityType: 0, moraleGain: 200, tags: [], isInteractive: false, priority: 70 },

  // 2 - Alexander the Great
  { index: 2, name: 'Alexander the Great', type: 'Character', subType: 'Conqueror', attack: 1000, defense: 900, abilityType: 5, moraleGain: 0, tags: [], isInteractive: false, priority: 85 },

  // 3 - Amelia Earhart
  { index: 3, name: 'Amelia Earhart', type: 'Character', subType: 'Explorer', attack: 100, defense: 200, abilityType: 3, moraleGain: 0, tags: ['Woman'], isInteractive: false, priority: 55 },

  // 4 - Argentina
  { index: 4, name: 'Argentina', type: 'Land', subType: 'South America', attack: 0, defense: 0, abilityType: 2, moraleGain: 300, tags: [], isInteractive: false, priority: 60 },

  // 5 - James Armistead Lafayette
  { index: 5, name: 'James Armistead Lafayette', type: 'Character', subType: 'Spy', attack: 80, defense: 80, abilityType: 1, moraleGain: 200, tags: [], isInteractive: false, priority: 70 },

  // 6 - Bill of Rights
  { index: 6, name: 'Bill of Rights', type: 'Active', subType: 'Documents', attack: 0, defense: 0, abilityType: 4, moraleGain: 200, tags: [], isInteractive: false, priority: 75 },

  // 7 - Andrew Carnegie
  { index: 7, name: 'Andrew Carnegie', type: 'Character', subType: 'Businessman', attack: 160, defense: 120, abilityType: 2, moraleGain: 0, tags: [], isInteractive: false, priority: 55 },

  // 8 - Central Intelligence Agency
  { index: 8, name: 'Central Intelligence Agency', type: 'Active', subType: 'Organization', attack: 0, defense: 0, abilityType: 1, moraleGain: 0, tags: [], isInteractive: true, priority: 65 },

  // 9 - Charles Robert Darwin
  { index: 9, name: 'Charles Robert Darwin', type: 'Character', subType: 'Explorer', attack: 20, defense: 60, abilityType: 0, moraleGain: 0, tags: [], isInteractive: false, priority: 75 },

  // 10 - Chinese Warriors
  { index: 10, name: 'Chinese Warriors', type: 'Character', subType: 'Army', attack: 3000, defense: 3000, abilityType: 1, moraleGain: 0, tags: [], isInteractive: false, priority: 95 },

  // 11 - Claude Monet
  { index: 11, name: 'Claude Monet', type: 'Character', subType: 'Artist', attack: 20, defense: 40, abilityType: 0, moraleGain: 200, tags: ['Artist'], isInteractive: false, priority: 70 },

  // 12 - David Ricardo
  { index: 12, name: 'David Ricardo', type: 'Character', subType: 'Economist', attack: 100, defense: 60, abilityType: 0, moraleGain: 200, tags: [], isInteractive: false, priority: 72 },

  // 13 - Egypt
  { index: 13, name: 'Egypt', type: 'Land', subType: 'Africa/Asia', attack: 0, defense: 0, abilityType: 3, moraleGain: 0, tags: [], isInteractive: false, priority: 55 },

  // 14 - English Language
  { index: 14, name: 'English Language', type: 'Active', subType: 'Knowledge', attack: 0, defense: 0, abilityType: 2, moraleGain: 200, tags: [], isInteractive: false, priority: 70 },

  // 15 - Florence Nightingale
  { index: 15, name: 'Florence Nightingale', type: 'Character', subType: 'Activist', attack: 40, defense: 60, abilityType: 0, moraleGain: 0, tags: [], isInteractive: false, priority: 60 },

  // 16 - George Bass
  { index: 16, name: 'George Bass', type: 'Character', subType: 'Explorer-Sea', attack: 300, defense: 200, abilityType: 2, moraleGain: 0, tags: [], isInteractive: false, priority: 58 },

  // 17 - Johannes Gutenberg
  { index: 17, name: 'Johannes Gutenberg', type: 'Character', subType: 'Inventor', attack: 40, defense: 60, abilityType: 0, moraleGain: 200, tags: [], isInteractive: false, priority: 72 },

  // 18 - Invention of the Automobile
  { index: 18, name: 'Invention of the Automobile', type: 'Active', subType: 'Technology', attack: 0, defense: 0, abilityType: 4, moraleGain: 0, tags: [], isInteractive: false, priority: 70 },

  // 19 - Invention of the Printing Press
  { index: 19, name: 'Invention of the Printing Press', type: 'Active', subType: 'Technology', attack: 0, defense: 0, abilityType: 0, moraleGain: 200, tags: [], isInteractive: false, priority: 72 },

  // 20 - Isabella Baumfree
  { index: 20, name: 'Isabella Baumfree', type: 'Character', subType: 'Activist', attack: 20, defense: 20, abilityType: 3, moraleGain: 0, tags: ['Woman'], isInteractive: false, priority: 65 },

  // 21 - James Madison
  { index: 21, name: 'James Madison', type: 'Character', subType: 'Leader', attack: 400, defense: 500, abilityType: 2, moraleGain: 300, tags: [], isInteractive: false, priority: 80 },

  // 22 - John Cabot
  { index: 22, name: 'John Cabot', type: 'Character', subType: 'Explorer-Sea', attack: 200, defense: 400, abilityType: 0, moraleGain: 0, tags: [], isInteractive: false, priority: 58 },

  // 23 - King Ferdinand and Queen Isabella
  { index: 23, name: 'King Ferdinand and Queen Isabella', type: 'Character', subType: 'Leader', attack: 400, defense: 500, abilityType: 2, moraleGain: 0, tags: [], isInteractive: false, priority: 75 },

  // 24 - King Louis XIV
  { index: 24, name: 'King Louis XIV', type: 'Character', subType: 'Conqueror', attack: 800, defense: 700, abilityType: 2, moraleGain: 0, tags: [], isInteractive: false, priority: 78 },

  // 25 - Ramses the Great
  { index: 25, name: 'Ramses the Great', type: 'Character', subType: 'Conqueror', attack: 1000, defense: 900, abilityType: 2, moraleGain: 0, tags: ['Pharaoh'], isInteractive: false, priority: 82 },

  // 26 - Lester Gillis
  { index: 26, name: 'Lester Gillis', type: 'Character', subType: 'Outlaw/Mobster', attack: 700, defense: 200, abilityType: 1, moraleGain: -400, tags: [], isInteractive: true, priority: 75 },

  // 27 - Lewis Latimer
  { index: 27, name: 'Lewis Latimer', type: 'Character', subType: 'Inventor', attack: 30, defense: 20, abilityType: 2, moraleGain: 0, tags: [], isInteractive: false, priority: 55 },

  // 28 - Lost Among the Pharaohs
  { index: 28, name: 'Lost Among the Pharaohs', type: 'Active', subType: 'Location', attack: 0, defense: 0, abilityType: 0, moraleGain: 0, tags: [], isInteractive: false, priority: 60 },

  // 29 - Margaret Hughes
  { index: 29, name: 'Margaret Hughes', type: 'Character', subType: 'Entertainer', attack: 20, defense: 20, abilityType: 0, moraleGain: 100, tags: ['Woman'], isInteractive: false, priority: 65 },

  // 30 - Martin Luther
  { index: 30, name: 'Martin Luther', type: 'Character', subType: 'Spiritual Leader', attack: 20, defense: 20, abilityType: 0, moraleGain: 400, tags: [], isInteractive: false, priority: 85 },

  // 31 - Peter Salem
  { index: 31, name: 'Peter Salem', type: 'Character', subType: 'Warrior', attack: 300, defense: 400, abilityType: 2, moraleGain: 0, tags: [], isInteractive: false, priority: 62 },

  // 32 - Philippines
  { index: 32, name: 'Philippines', type: 'Land', subType: 'South Pacific', attack: 0, defense: 0, abilityType: 2, moraleGain: 0, tags: [], isInteractive: false, priority: 50 },

  // 33 - Queen Ahhotep
  { index: 33, name: 'Queen Ahhotep', type: 'Character', subType: 'Leader', attack: 200, defense: 400, abilityType: 0, moraleGain: 200, tags: ['Pharaoh', 'Woman'], isInteractive: false, priority: 75 },

  // 34 - Renaissance
  { index: 34, name: 'Renaissance', type: 'Active', subType: 'Event', attack: 0, defense: 0, abilityType: 0, moraleGain: 400, tags: [], isInteractive: false, priority: 85 },

  // 35 - Salem Witch Trials
  { index: 35, name: 'Salem Witch Trials', type: 'Active', subType: 'Event', attack: 0, defense: 0, abilityType: 0, moraleGain: -400, tags: [], isInteractive: true, priority: 80 },

  // 36 - Samurai Warriors
  { index: 36, name: 'Samurai Warriors', type: 'Character', subType: 'Army', attack: 3000, defense: 2500, abilityType: 3, moraleGain: 0, tags: [], isInteractive: false, priority: 92 },

  // 37 - ScotLand
  { index: 37, name: 'ScotLand', type: 'Land', subType: 'Europe', attack: 0, defense: 0, abilityType: 3, moraleGain: 0, tags: [], isInteractive: false, priority: 55 },

  // 38 - Sinking of the Titanic
  { index: 38, name: 'Sinking of the Titanic', type: 'Active', subType: 'Event', attack: 0, defense: 0, abilityType: 1, moraleGain: 0, tags: [], isInteractive: true, priority: 70 },

  // 39 - Sir Walter Scott
  { index: 39, name: 'Sir Walter Scott', type: 'Character', subType: 'Author', attack: 40, defense: 40, abilityType: 0, moraleGain: 0, tags: [], isInteractive: false, priority: 60 },

  // 40 - Socrates
  { index: 40, name: 'Socrates', type: 'Character', subType: 'Philosophers', attack: 20, defense: 20, abilityType: 0, moraleGain: 300, tags: [], isInteractive: false, priority: 80 },

  // 41 - Kingdom of Thailand
  { index: 41, name: 'Kingdom of Thailand', type: 'Land', subType: 'Asia', attack: 0, defense: 0, abilityType: 3, moraleGain: 0, tags: [], isInteractive: false, priority: 50 },

  // 42 - The Persian Immortals
  { index: 42, name: 'The Persian Immortals', type: 'Character', subType: 'Army', attack: 4000, defense: 3000, abilityType: 3, moraleGain: 0, tags: [], isInteractive: false, priority: 95 },

  // 43 - Theodore Roosevelt
  { index: 43, name: 'Theodore Roosevelt', type: 'Character', subType: 'Leader', attack: 400, defense: 500, abilityType: 0, moraleGain: 0, tags: [], isInteractive: false, priority: 70 },

  // 44 - Tuskegee Airmen
  { index: 44, name: 'Tuskegee Airmen', type: 'Character', subType: 'Army', attack: 4000, defense: 2000, abilityType: 3, moraleGain: 0, tags: [], isInteractive: false, priority: 93 },

  // 45 - USA - West Coast
  { index: 45, name: 'USA - West Coast', type: 'Land', subType: 'North America', attack: 0, defense: 0, abilityType: 0, moraleGain: 300, tags: ['U.S. territory'], isInteractive: false, priority: 65 },

  // 46 - Vasco Nunez de Balboa
  { index: 46, name: 'Vasco Nunez de Balboa', type: 'Character', subType: 'Explorer-Sea', attack: 600, defense: 700, abilityType: 7, moraleGain: 0, tags: [], isInteractive: false, priority: 65 },

  // 47 - Vietnam War
  { index: 47, name: 'Vietnam War', type: 'Active', subType: 'Event', attack: 0, defense: 0, abilityType: 2, moraleGain: 200, tags: [], isInteractive: false, priority: 70 },
];

/**
 * Get card by index
 */
export function getCard(index: number): CardData | undefined {
  return CARD_LIBRARY.find(c => c.index === index);
}

/**
 * Get all cards of a specific type
 */
export function getCardsByType(type: 'Character' | 'Land' | 'Active'): CardData[] {
  return CARD_LIBRARY.filter(c => c.type === type);
}

/**
 * Get cards sorted by priority (highest first)
 */
export function getCardsByPriority(cards: number[]): CardData[] {
  return cards
    .map(idx => getCard(idx))
    .filter((c): c is CardData => c !== undefined)
    .sort((a, b) => b.priority - a.priority);
}

/**
 * Get morale-boosting cards from a hand
 */
export function getMoraleCards(cards: number[]): CardData[] {
  return cards
    .map(idx => getCard(idx))
    .filter((c): c is CardData => c !== undefined && c.moraleGain > 0)
    .sort((a, b) => b.moraleGain - a.moraleGain);
}

/**
 * Get strongest characters for combat
 */
export function getStrongestCharacters(cards: number[]): CardData[] {
  return cards
    .map(idx => getCard(idx))
    .filter((c): c is CardData => c !== undefined && c.type === 'Character')
    .sort((a, b) => (b.attack + b.defense) - (a.attack + a.defense));
}
