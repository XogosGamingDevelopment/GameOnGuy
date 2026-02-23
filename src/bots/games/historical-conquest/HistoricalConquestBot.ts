/**
 * Game On Dude! - Historical Conquest Bot
 * www.gameonguy.com
 *
 * Bot adapter for Historical Conquest card game.
 * Implements the IGameBot interface for the secure bot framework.
 *
 * This bot is designed to play Historical Conquest using a medium-difficulty
 * strategy that prioritizes morale, plays cards efficiently, and attacks
 * when advantageous.
 */

import { IGameBot, BotConfig, BotGameState, BotAction } from '../../BotInterface';
import { BotRegistry } from '../../BotRegistry';
import { CARD_LIBRARY, getCard, CardData } from './CardLibrary';
import * as Actions from './BotActions';

// Game phases for Historical Conquest
type GamePhase = 'waiting' | 'setup' | 'openingLand' | 'playing' | 'attack' | 'combat' | 'ended';

// Card in play tracking
interface CardInPlay {
  cardIndex: number;
  uniqueId: number;
  row: number;
  slot: number;
  owner: number;
}

/**
 * Historical Conquest Bot Implementation
 */
export class HistoricalConquestBot implements IGameBot {
  public readonly botType = 'historical-conquest-bot';
  public readonly supportedGames = ['historical_conquest'];

  // Bot identity
  private playerId: string = '';
  private playerName: string = '';
  private clientId: number = 1; // For HC message compatibility
  private difficulty: number = 50;

  // Game state
  private phase: GamePhase = 'waiting';
  private isMyTurn: boolean = false;
  private gameTurn: number = 0;
  private botTurnCount: number = 0;
  private civBuildingTurns: number = 3;

  // Resources
  private morale: number = 0;
  private opMorale: number = 0;
  private moves: number = 0;

  // Cards
  private hand: number[] = [];
  private deck: number[] = [];
  private lands: number[] = [];
  private cardsInPlay: CardInPlay[] = [];
  private opCardsInPlay: CardInPlay[] = [];
  private discard: number[] = [];

  // Unique ID counter
  private uniqueIdCounter: number = 1000;

  // Turn management
  private cardsPlayedThisTurn: number = 0;
  private waitingForAcceptance: boolean = false;
  private attacksThisTurn: number = 0;
  private attackedRow: number = -1;

  // Configuration (adjusted by difficulty)
  private readonly MORALE_THRESHOLD = 800;
  private readonly MAX_LANDS = 12;
  private readonly MAX_ATTACKS_PER_TURN = 2;
  private readonly MAX_CARDS_PER_LAND = 4;
  private readonly ACTIVE_AREA_ROW = 14;

  constructor() {
    // Constructor is called by factory, initialization happens in initialize()
  }

  /**
   * Initialize the bot with configuration
   */
  public initialize(config: BotConfig): void {
    this.playerId = config.playerId;
    this.playerName = config.playerName;
    this.difficulty = config.difficulty;
    this.clientId = 1; // Bot is always client ID 1 (player 2)

    // Initialize deck
    this.initializeDeck();

    console.log(`[HCBot] Initialized: ${this.playerName}, difficulty: ${this.difficulty}`);
  }

  /**
   * Initialize deck with shuffled cards
   */
  private initializeDeck(): void {
    // Get all playable cards (not lands)
    const playableCards = CARD_LIBRARY
      .filter(c => c.type === 'Character' || c.type === 'Active')
      .map(c => c.index);

    this.deck = this.shuffle([...playableCards]);

    // Get land cards
    this.lands = CARD_LIBRARY
      .filter(c => c.type === 'Land')
      .map(c => c.index);
    this.lands = this.shuffle(this.lands);
  }

  /**
   * Draw cards to hand
   */
  private drawCards(count: number): BotAction[] {
    const actions: BotAction[] = [];

    for (let i = 0; i < count && this.deck.length > 0; i++) {
      this.hand.push(this.deck.shift()!);
      actions.push(this.createDeckStateAction());
    }

    return actions;
  }

  /**
   * Handle incoming message and return actions
   */
  public handleMessage(messageType: string, data: unknown, gameState: BotGameState): BotAction[] {
    const actions: BotAction[] = [];
    const payload = data as Record<string, unknown>;

    switch (messageType) {
      case 'servercount2':
        this.phase = 'setup';
        actions.push(Actions.createPlayerInfoMessage(this.playerName, this.clientId, false));
        break;

      case 'playerinfo':
        if (payload?.type === 3) {
          actions.push(Actions.createReadyCheckMessage(this.clientId, true));
        }
        break;

      case 'st':
        if (data === true) {
          this.phase = 'openingLand';
        }
        break;

      case 'startgame':
        this.phase = 'openingLand';
        this.gameTurn = 1;
        actions.push(...this.drawCards(5));
        actions.push(Actions.createReadyForOpeningLandMessage(this.clientId));
        break;

      case 'plfd':
        if (data === this.clientId) {
          actions.push(...this.playLandFromDeck());
        }
        break;

      case 'splb':
        this.gameTurn++;
        if (data === 2 || Number(data) === 2) {
          // Bot's turn
          this.botTurnCount++;
          this.isMyTurn = true;
          this.moves = 3;
          this.phase = 'playing';
          actions.push(...this.startTurn());
        } else {
          this.isMyTurn = false;
        }
        break;

      case 'umc':
        // Update morale
        this.morale = (payload?.op as number) ?? 0;
        this.opMorale = (payload?.local as number) ?? 0;
        break;

      case 'ut':
        // Update moves
        this.moves = (payload?.op as number) ?? 0;
        break;

      case 'ppcc':
        // Opponent played card
        if (Number(payload?.client) !== this.clientId) {
          actions.push(...this.handleOpponentCardPlay(payload));
        }
        break;

      case 'apc':
        // Play accepted, continue turn
        if (this.isMyTurn && this.waitingForAcceptance) {
          this.waitingForAcceptance = false;
          actions.push(...this.continueTurn());
        }
        break;

      case 'piac':
        // Attack broadcast - if we're defender, accept
        if (Number(payload?.client) !== this.clientId) {
          this.attackedRow = payload?.slot as number ?? -1;
          actions.push(Actions.createFinalizeAttackMessage(
            payload?.row as number ?? 0,
            payload?.slot as number ?? 0,
            this.clientId
          ));
        }
        break;

      case 'cr':
        // Combat results
        const winner = Number(payload?.cardvalue);
        if (winner === 1 && this.attackedRow >= 0) {
          // Bot lost, discard
          actions.push(...this.discardFromCombatLoss(this.attackedRow));
        }
        const acAction = Actions.createAcceptCombatMessage(this.clientId);
        acAction.delay = winner === 1 ? 500 : 2000;
        actions.push(acAction);
        break;

      case 'fc':
        // Combat finished
        this.attackedRow = -1;
        if (this.isMyTurn) {
          if (this.moves > 0 && this.shouldAttack()) {
            actions.push(...this.performAttack());
          } else {
            actions.push(...this.endTurn());
          }
        }
        break;

      case 'lhp':
        // Land played
        if (Number(payload?.clientId) !== this.clientId) {
          this.opCardsInPlay.push({
            cardIndex: payload?.cardValue as number ?? 0,
            uniqueId: payload?.uniqueId as number ?? 0,
            row: this.opCardsInPlay.filter(c => getCard(c.cardIndex)?.type === 'Land').length,
            slot: 0,
            owner: payload?.clientId as number ?? 0
          });
        }
        break;

      case 'pet':
        // Player ended turn - not our turn
        if (data !== this.clientId) {
          this.isMyTurn = false;
        }
        break;

      case 'fdac':
        // Card discarded
        this.handleCardDiscard(payload);
        break;
    }

    return actions;
  }

  /**
   * Start the bot's turn
   */
  private startTurn(): BotAction[] {
    const actions: BotAction[] = [];

    this.cardsPlayedThisTurn = 0;
    this.attacksThisTurn = 0;
    this.waitingForAcceptance = false;

    // Draw a card at start of turn (if not first turn)
    if (this.botTurnCount > 1) {
      actions.push(...this.drawCards(1));
    }

    // Play land if needed
    if (this.botTurnCount <= 3 || this.cardsInPlay.filter(c => getCard(c.cardIndex)?.type === 'Land').length < this.MAX_LANDS) {
      actions.push(...this.discoverNewLand());
    }

    // Play cards
    actions.push(...this.playCardsForTurn());

    return actions;
  }

  /**
   * Continue turn after acceptance
   */
  private continueTurn(): BotAction[] {
    const actions: BotAction[] = [];

    this.cardsPlayedThisTurn++;

    // Decide how many cards to play based on difficulty
    const cardsPerTurn = this.difficulty > 70 ? 3 : 2;

    if (this.cardsPlayedThisTurn < cardsPerTurn && this.hand.length > 0) {
      actions.push(...this.playCardsForTurn());
    } else if (this.shouldAttack()) {
      actions.push(...this.performAttack());
    } else {
      actions.push(...this.endTurn());
    }

    return actions;
  }

  /**
   * Play cards for the turn
   */
  private playCardsForTurn(): BotAction[] {
    const actions: BotAction[] = [];

    if (this.hand.length === 0) return actions;

    // Get best card to play based on situation
    const cardToPlay = this.selectBestCard();
    if (cardToPlay === null) {
      // No good card, try to attack or end turn
      if (this.shouldAttack()) {
        actions.push(...this.performAttack());
      } else {
        actions.push(...this.endTurn());
      }
      return actions;
    }

    // Find a slot to play it
    const { row, slot } = this.findBestSlot(cardToPlay);

    // Play the card
    const uniqueId = this.generateUniqueId();
    const cardData = getCard(cardToPlay);

    // Track the card
    this.cardsInPlay.push({
      cardIndex: cardToPlay,
      uniqueId,
      row,
      slot,
      owner: this.clientId
    });

    // Remove from hand
    const handIdx = this.hand.indexOf(cardToPlay);
    if (handIdx !== -1) {
      this.hand.splice(handIdx, 1);
    }

    this.waitingForAcceptance = true;

    actions.push(Actions.createPlayCardMessage(
      cardToPlay,
      row,
      slot,
      this.clientId,
      cardData?.subType === 'Explorer' ? 'Darwin' : '',
      false,
      uniqueId
    ));

    // Send deck state update
    actions.push(this.createDeckStateAction());

    // Send accept message
    actions.push(Actions.createAcceptPlayMessage(cardToPlay, row, this.clientId));

    return actions;
  }

  /**
   * Select the best card to play from hand
   */
  private selectBestCard(): number | null {
    if (this.hand.length === 0) return null;

    // Prioritize based on situation
    const lowMorale = this.morale < 1000;

    // Get cards by priority
    const prioritized = this.hand
      .map(idx => ({ idx, card: getCard(idx) }))
      .filter(c => c.card !== undefined)
      .sort((a, b) => {
        // Morale cards first when morale is low
        if (lowMorale) {
          const aMorale = a.card!.moraleGain ?? 0;
          const bMorale = b.card!.moraleGain ?? 0;
          if (aMorale !== bMorale) return bMorale - aMorale;
        }

        // Otherwise by priority
        return (b.card!.priority ?? 50) - (a.card!.priority ?? 50);
      });

    // Add randomness based on difficulty
    const randomFactor = (100 - this.difficulty) / 100 * 0.3;
    if (Math.random() < randomFactor && prioritized.length > 1) {
      // Pick a random card instead of best
      const randomIdx = Math.floor(Math.random() * prioritized.length);
      return prioritized[randomIdx].idx;
    }

    return prioritized.length > 0 ? prioritized[0].idx : null;
  }

  /**
   * Find best slot for a card
   */
  private findBestSlot(cardIndex: number): { row: number; slot: number } {
    const card = getCard(cardIndex);

    // Active cards go to Active Area (row 14)
    if (card?.type === 'Active') {
      return { row: this.ACTIVE_AREA_ROW, slot: 0 };
    }

    // Find land with space
    const myLands = this.cardsInPlay.filter(c => getCard(c.cardIndex)?.type === 'Land');
    for (let i = 0; i < myLands.length; i++) {
      const cardsOnLand = this.cardsInPlay.filter(
        c => c.row === i && getCard(c.cardIndex)?.type !== 'Land'
      ).length;

      if (cardsOnLand < this.MAX_CARDS_PER_LAND) {
        return { row: i, slot: cardsOnLand };
      }
    }

    // Default to first row
    return { row: 0, slot: 0 };
  }

  /**
   * Should the bot attack?
   */
  private shouldAttack(): boolean {
    if (this.attacksThisTurn >= this.MAX_ATTACKS_PER_TURN) return false;
    if (this.morale < this.MORALE_THRESHOLD) return false;
    if (this.botTurnCount < this.civBuildingTurns) return false;

    // Check if we have characters to attack with
    const myCharacters = this.cardsInPlay.filter(c => getCard(c.cardIndex)?.type === 'Character');
    const opCharacters = this.opCardsInPlay.filter(c => getCard(c.cardIndex)?.type === 'Character');

    return myCharacters.length > 0 && opCharacters.length > 0;
  }

  /**
   * Perform an attack
   */
  private performAttack(): BotAction[] {
    const actions: BotAction[] = [];

    // Find strongest character
    const myCharacters = this.cardsInPlay
      .filter(c => getCard(c.cardIndex)?.type === 'Character')
      .map(c => ({ ...c, card: getCard(c.cardIndex)! }))
      .sort((a, b) => (b.card.attack + b.card.defense) - (a.card.attack + a.card.defense));

    if (myCharacters.length === 0) return this.endTurn();

    const attacker = myCharacters[0];

    // Find target (weakest opponent character)
    const targets = this.opCardsInPlay
      .filter(c => getCard(c.cardIndex)?.type === 'Character')
      .map(c => ({ ...c, card: getCard(c.cardIndex)! }))
      .sort((a, b) => (a.card.attack + a.card.defense) - (b.card.attack + b.card.defense));

    if (targets.length === 0) return this.endTurn();

    const target = targets[0];

    this.attacksThisTurn++;
    this.phase = 'combat';

    actions.push(Actions.createAttackMessage(attacker.row, target.row, this.clientId));

    return actions;
  }

  /**
   * Play a land from deck
   */
  private playLandFromDeck(): BotAction[] {
    const actions: BotAction[] = [];

    if (this.lands.length === 0) return actions;

    const landIdx = this.lands.shift()!;
    const uniqueId = this.generateUniqueId();
    const row = this.cardsInPlay.filter(c => getCard(c.cardIndex)?.type === 'Land').length;

    this.cardsInPlay.push({
      cardIndex: landIdx,
      uniqueId,
      row,
      slot: 0,
      owner: this.clientId
    });

    actions.push(Actions.createLandPlayedMessage(landIdx, uniqueId, this.clientId));

    return actions;
  }

  /**
   * Discover new land during turn
   */
  private discoverNewLand(): BotAction[] {
    return this.playLandFromDeck();
  }

  /**
   * End the turn
   */
  private endTurn(): BotAction[] {
    this.isMyTurn = false;
    this.phase = 'waiting';
    return [Actions.createEndTurnMessage(this.clientId)];
  }

  /**
   * Handle opponent card play
   */
  private handleOpponentCardPlay(data: Record<string, unknown>): BotAction[] {
    const actions: BotAction[] = [];

    // Track opponent's card
    this.opCardsInPlay.push({
      cardIndex: data.card as number ?? 0,
      uniqueId: data.uniqueId as number ?? 0,
      row: data.row as number ?? 0,
      slot: data.slot as number ?? 0,
      owner: data.client as number ?? 0
    });

    // Accept the play
    actions.push(Actions.createAcceptPlayMessage(
      data.card as number ?? 0,
      data.row as number ?? 0,
      this.clientId,
      '',
      true
    ));

    return actions;
  }

  /**
   * Discard from combat loss
   */
  private discardFromCombatLoss(row: number): BotAction[] {
    const actions: BotAction[] = [];

    // Find cards on the attacked row
    const cardsOnRow = this.cardsInPlay.filter(c => c.row === row && getCard(c.cardIndex)?.type !== 'Land');

    if (cardsOnRow.length === 0) return actions;

    // Discard weakest card
    const weakest = cardsOnRow
      .map(c => ({ ...c, card: getCard(c.cardIndex)! }))
      .sort((a, b) => (a.card.attack + a.card.defense) - (b.card.attack + b.card.defense))[0];

    if (weakest) {
      // Remove from tracking
      const idx = this.cardsInPlay.findIndex(c => c.uniqueId === weakest.uniqueId);
      if (idx !== -1) {
        this.cardsInPlay.splice(idx, 1);
      }

      actions.push(Actions.createForceDiscardMessage(weakest.uniqueId, weakest.uniqueId, this.clientId));
    }

    return actions;
  }

  /**
   * Handle card discard message
   */
  private handleCardDiscard(data: Record<string, unknown>): void {
    const clientId = data.clientId as number;
    const uniqueId = data.uniqueId as number;

    if (clientId === this.clientId) {
      // Our card was discarded
      const idx = this.cardsInPlay.findIndex(c => c.uniqueId === uniqueId);
      if (idx !== -1) {
        this.discard.push(this.cardsInPlay[idx].cardIndex);
        this.cardsInPlay.splice(idx, 1);
      }
    } else {
      // Opponent's card was discarded
      const idx = this.opCardsInPlay.findIndex(c => c.uniqueId === uniqueId);
      if (idx !== -1) {
        this.opCardsInPlay.splice(idx, 1);
      }
    }
  }

  /**
   * Create deck state action
   */
  private createDeckStateAction(): BotAction {
    return Actions.createUpdateDeckSizeMessage(
      this.hand.length,
      this.deck.length,
      this.lands.length,
      this.clientId
    );
  }

  /**
   * Generate unique ID
   */
  private generateUniqueId(): number {
    return this.uniqueIdCounter++;
  }

  /**
   * Shuffle array
   */
  private shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * Clean up resources
   */
  public dispose(): void {
    this.hand = [];
    this.deck = [];
    this.lands = [];
    this.cardsInPlay = [];
    this.opCardsInPlay = [];
    this.discard = [];
  }
}

// Register the bot with the registry
BotRegistry.register({
  botType: 'historical-conquest-bot',
  supportedGames: ['historical_conquest'],
  factory: () => new HistoricalConquestBot(),
  metadata: {
    name: 'Historical Conquest Bot',
    description: 'AI opponent for Historical Conquest card game',
    version: '1.0.0',
    author: 'Game On Dude!',
    defaultDifficulty: 50,
  },
});

export default HistoricalConquestBot;
