/**
 * Game On Dude! - Historical Conquest Game Room
 * www.gameonguy.com
 *
 * Turn-based historical card battle game. Players build decks, deploy units,
 * cast spells, and conquer territories through strategic gameplay.
 */

import { TurnBasedRoom, TurnBasedRoomOptions, TurnBasedState, TurnAction } from '../TurnBasedRoom';
import { PlayerState, GameAction } from '../../core/types';
import { BotManager } from '../../bots/BotManager';
import logger from '../../core/Logger';

// ============================================================================
// Types
// ============================================================================

export interface Card {
  id: string;
  name: string;
  type: 'unit' | 'spell' | 'structure' | 'event';
  era: 'ancient' | 'medieval' | 'renaissance' | 'modern';
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  cost: ResourceCost;
  stats?: CardStats;
  abilities: Ability[];
  description: string;
  imageUrl?: string;
}

export interface CardStats {
  attack: number;
  defense: number;
  health: number;
  range?: number;
  movement?: number;
}

export interface Ability {
  id: string;
  name: string;
  type: 'passive' | 'active' | 'triggered';
  trigger?: 'on_play' | 'on_attack' | 'on_defend' | 'on_death' | 'start_of_turn' | 'end_of_turn';
  effect: AbilityEffect;
  cooldown?: number;
  usesRemaining?: number;
}

export interface AbilityEffect {
  type: 'damage' | 'heal' | 'buff' | 'debuff' | 'summon' | 'draw' | 'destroy' | 'move' | 'resource';
  target: 'self' | 'enemy' | 'ally' | 'all_enemies' | 'all_allies' | 'random' | 'adjacent';
  value: number;
  duration?: number;
  statModifier?: Partial<CardStats>;
}

export interface ResourceCost {
  gold: number;
  influence?: number;
  military?: number;
}

export interface ResourcePool {
  gold: number;
  influence: number;
  military: number;
  goldPerTurn: number;
  influencePerTurn: number;
  militaryPerTurn: number;
}

export interface DeployedCard extends Card {
  instanceId: string;
  ownerId: string;
  position: number; // Slot position (0-5)
  currentHealth: number;
  currentAttack: number;
  currentDefense: number;
  buffs: Buff[];
  hasAttacked: boolean;
  hasMoved: boolean;
  turnsInPlay: number;
}

export interface Buff {
  id: string;
  name: string;
  statModifier: Partial<CardStats>;
  duration: number;
  source: string;
}

export interface Territory {
  id: string;
  name: string;
  controlledBy: string | null;
  defenseBonus: number;
  resourceBonus: Partial<ResourcePool>;
  slots: (DeployedCard | null)[];
}

export interface HistoricalConquestState extends TurnBasedState {
  decks: Record<string, Card[]>;
  hands: Record<string, Card[]>;
  discards: Record<string, Card[]>;
  resources: Record<string, ResourcePool>;
  territories: Territory[];
  battlefield: Record<string, DeployedCard[]>; // Player ID -> deployed cards
  turnPhase: 'draw' | 'main' | 'combat' | 'end';
  combatLog: CombatLogEntry[];
  winCondition: 'elimination' | 'territory' | 'points';
  pointsToWin: number;
  scores: Record<string, number>;
}

export interface CombatLogEntry {
  turn: number;
  attacker: string;
  defender: string;
  attackerCard: string;
  defenderCard?: string;
  damage: number;
  result: 'hit' | 'miss' | 'kill' | 'blocked';
  timestamp: number;
}

export interface HistoricalConquestOptions extends TurnBasedRoomOptions {
  startingHandSize?: number;
  maxHandSize?: number;
  startingGold?: number;
  goldPerTurn?: number;
  territoryCount?: number;
  slotsPerTerritory?: number;
  winCondition?: 'elimination' | 'territory' | 'points';
  pointsToWin?: number;
  cardDatabase?: Card[];
  /** If true, spawn bot immediately (player already waited in matchmaking) */
  fromMatchmakingTimeout?: boolean;
}

// ============================================================================
// Default Card Database
// ============================================================================

const DEFAULT_CARDS: Card[] = [
  // Ancient Era Units
  {
    id: 'roman_legionnaire',
    name: 'Roman Legionnaire',
    type: 'unit',
    era: 'ancient',
    rarity: 'common',
    cost: { gold: 2 },
    stats: { attack: 2, defense: 3, health: 4 },
    abilities: [
      {
        id: 'shield_wall',
        name: 'Shield Wall',
        type: 'passive',
        effect: { type: 'buff', target: 'adjacent', value: 1, statModifier: { defense: 1 } },
      },
    ],
    description: 'A disciplined soldier of Rome. Provides defense bonus to adjacent allies.',
  },
  {
    id: 'greek_hoplite',
    name: 'Greek Hoplite',
    type: 'unit',
    era: 'ancient',
    rarity: 'common',
    cost: { gold: 2 },
    stats: { attack: 3, defense: 2, health: 3 },
    abilities: [],
    description: 'A citizen-soldier armed with spear and shield.',
  },
  {
    id: 'persian_immortal',
    name: 'Persian Immortal',
    type: 'unit',
    era: 'ancient',
    rarity: 'rare',
    cost: { gold: 4 },
    stats: { attack: 3, defense: 3, health: 5 },
    abilities: [
      {
        id: 'undying',
        name: 'Undying',
        type: 'triggered',
        trigger: 'on_death',
        effect: { type: 'heal', target: 'self', value: 2 },
      },
    ],
    description: 'Elite Persian warriors who seem to never fall.',
  },
  // Medieval Era Units
  {
    id: 'knight',
    name: 'Knight',
    type: 'unit',
    era: 'medieval',
    rarity: 'uncommon',
    cost: { gold: 4 },
    stats: { attack: 4, defense: 3, health: 5 },
    abilities: [
      {
        id: 'charge',
        name: 'Charge',
        type: 'triggered',
        trigger: 'on_play',
        effect: { type: 'damage', target: 'enemy', value: 2 },
      },
    ],
    description: 'Armored cavalry that deals damage when deployed.',
  },
  {
    id: 'longbowman',
    name: 'Longbowman',
    type: 'unit',
    era: 'medieval',
    rarity: 'common',
    cost: { gold: 3 },
    stats: { attack: 3, defense: 1, health: 3, range: 2 },
    abilities: [],
    description: 'English archer with deadly range.',
  },
  {
    id: 'castle',
    name: 'Castle',
    type: 'structure',
    era: 'medieval',
    rarity: 'rare',
    cost: { gold: 6 },
    stats: { attack: 0, defense: 5, health: 10 },
    abilities: [
      {
        id: 'fortify',
        name: 'Fortify',
        type: 'passive',
        effect: { type: 'buff', target: 'all_allies', value: 0, statModifier: { defense: 2 } },
      },
    ],
    description: 'A mighty fortress that protects all allies.',
  },
  // Spells
  {
    id: 'rally',
    name: 'Rally the Troops',
    type: 'spell',
    era: 'ancient',
    rarity: 'common',
    cost: { gold: 2 },
    abilities: [
      {
        id: 'rally_effect',
        name: 'Rally',
        type: 'active',
        effect: { type: 'buff', target: 'all_allies', value: 0, statModifier: { attack: 2 }, duration: 1 },
      },
    ],
    description: 'All allies gain +2 attack until end of turn.',
  },
  {
    id: 'fireball',
    name: 'Fireball',
    type: 'spell',
    era: 'medieval',
    rarity: 'uncommon',
    cost: { gold: 3 },
    abilities: [
      {
        id: 'fireball_effect',
        name: 'Fireball',
        type: 'active',
        effect: { type: 'damage', target: 'enemy', value: 4 },
      },
    ],
    description: 'Deal 4 damage to an enemy unit.',
  },
  {
    id: 'heal',
    name: 'Battlefield Medicine',
    type: 'spell',
    era: 'renaissance',
    rarity: 'common',
    cost: { gold: 2 },
    abilities: [
      {
        id: 'heal_effect',
        name: 'Heal',
        type: 'active',
        effect: { type: 'heal', target: 'ally', value: 3 },
      },
    ],
    description: 'Restore 3 health to an ally.',
  },
  {
    id: 'reinforcements',
    name: 'Call Reinforcements',
    type: 'event',
    era: 'modern',
    rarity: 'rare',
    cost: { gold: 5 },
    abilities: [
      {
        id: 'reinforcements_effect',
        name: 'Reinforcements',
        type: 'active',
        effect: { type: 'draw', target: 'self', value: 3 },
      },
    ],
    description: 'Draw 3 cards.',
  },
];

// ============================================================================
// Historical Conquest Room Implementation
// ============================================================================

const hcLog = logger.child({ component: 'HistoricalConquestRoom' });

export class HistoricalConquestRoom extends TurnBasedRoom {
  private readonly startingHandSize: number;
  private readonly maxHandSize: number;
  private readonly startingGold: number;
  private readonly goldPerTurn: number;
  private readonly territoryCount: number;
  private readonly slotsPerTerritory: number;
  private readonly cardDatabase: Card[];
  private readonly victoryCondition: 'elimination' | 'territory' | 'points';
  private readonly victoryPoints: number;

  // Bot spawning
  private botManager: BotManager;
  private botSpawnTimeout: NodeJS.Timeout | null = null;
  private readonly BOT_TIMEOUT_MS = 20000; // 20 seconds
  private readonly spawnBotImmediately: boolean; // If player came from matchmaking timeout

  declare protected state: HistoricalConquestState;

  constructor(gameType: string, options: HistoricalConquestOptions = {}) {
    super(gameType, {
      ...options,
      turnTimeLimit: options.turnTimeLimit ?? 90000, // 90 seconds per turn
      actionsPerTurn: options.actionsPerTurn ?? 10, // Multiple actions per turn
      allowUndo: true,
      setupPhaseTime: options.setupPhaseTime ?? 30000, // 30 seconds setup
    });

    this.startingHandSize = options.startingHandSize ?? 5;
    this.maxHandSize = options.maxHandSize ?? 10;
    this.startingGold = options.startingGold ?? 3;
    this.goldPerTurn = options.goldPerTurn ?? 2;
    this.territoryCount = options.territoryCount ?? 3;
    this.slotsPerTerritory = options.slotsPerTerritory ?? 5;
    this.cardDatabase = options.cardDatabase ?? DEFAULT_CARDS;
    this.victoryCondition = options.winCondition ?? 'elimination';
    this.victoryPoints = options.pointsToWin ?? 20;

    // If player came from matchmaking timeout, spawn bot immediately
    this.spawnBotImmediately = options.fromMatchmakingTimeout ?? false;

    // Initialize bot manager for room-level bot spawning
    this.botManager = new BotManager(this as any);
    hcLog.info(
      { roomId: this.id, spawnBotImmediately: this.spawnBotImmediately },
      'HistoricalConquestRoom created with bot support'
    );
  }

  protected initializeState(): HistoricalConquestState {
    const baseState = super.initializeState();
    return {
      ...baseState,
      decks: {},
      hands: {},
      discards: {},
      resources: {},
      territories: this.createTerritories(),
      battlefield: {},
      turnPhase: 'draw',
      combatLog: [],
      winCondition: this.victoryCondition,
      pointsToWin: this.victoryPoints,
      scores: {},
    };
  }

  private createTerritories(): Territory[] {
    const territories: Territory[] = [];
    const names = ['Northern Plains', 'Eastern Mountains', 'Southern Coast', 'Western Forest', 'Central Valley'];

    for (let i = 0; i < this.territoryCount; i++) {
      territories.push({
        id: `territory_${i}`,
        name: names[i % names.length],
        controlledBy: null,
        defenseBonus: 0,
        resourceBonus: { goldPerTurn: 1 },
        slots: new Array(this.slotsPerTerritory).fill(null),
      });
    }

    return territories;
  }

  protected onPlayerJoin(player: PlayerState): void {
    super.onPlayerJoin(player);

    const playerCount = this.players.size;
    const isBot = this.botManager.isBot(player.id);

    hcLog.info(
      { roomId: this.id, playerId: player.id, playerCount, isBot },
      'Player joined Historical Conquest room'
    );

    // Create player deck (shuffled copy of card database)
    this.state.decks[player.id] = this.shuffleArray([...this.cardDatabase]);
    this.state.hands[player.id] = [];
    this.state.discards[player.id] = [];
    this.state.battlefield[player.id] = [];
    this.state.scores[player.id] = 0;

    // Initialize resources
    this.state.resources[player.id] = {
      gold: this.startingGold,
      influence: 0,
      military: 0,
      goldPerTurn: this.goldPerTurn,
      influencePerTurn: 1,
      militaryPerTurn: 1,
    };

    // Room-level bot spawning logic
    if (playerCount === 1 && !isBot) {
      // First human player joined - spawn bot (immediately or after timeout)
      const timeoutMs = this.spawnBotImmediately ? 100 : this.BOT_TIMEOUT_MS;

      hcLog.info(
        {
          roomId: this.id,
          timeoutMs,
          spawnBotImmediately: this.spawnBotImmediately,
          reason: this.spawnBotImmediately ? 'from matchmaking timeout' : 'normal room join'
        },
        'Starting bot spawn timeout'
      );

      this.botSpawnTimeout = setTimeout(async () => {
        // Check if still only 1 player after timeout
        if (this.players.size === 1) {
          hcLog.info({ roomId: this.id }, 'Spawning bot opponent');

          try {
            const bot = await this.botManager.spawnBot({
              difficulty: 50,
            });

            if (bot) {
              hcLog.info(
                { roomId: this.id, botId: bot.id, botName: bot.username },
                'Bot spawned successfully'
              );
            } else {
              hcLog.error({ roomId: this.id }, 'Failed to spawn bot - no bot returned');
            }
          } catch (error) {
            hcLog.error({ roomId: this.id, error }, 'Error spawning bot');
          }
        } else {
          hcLog.info(
            { roomId: this.id, playerCount: this.players.size },
            'Timeout fired but room already has enough players'
          );
        }
      }, timeoutMs);
    } else if (playerCount === 2 && this.botSpawnTimeout) {
      // Second player joined - cancel bot timeout
      hcLog.info({ roomId: this.id }, 'Second player joined - cancelling bot spawn timeout');
      clearTimeout(this.botSpawnTimeout);
      this.botSpawnTimeout = null;
    }
  }

  protected onGameBegin(): void {
    // Draw starting hands for all players
    this.players.forEach((player) => {
      this.drawCards(player.id, this.startingHandSize);
    });

    this.broadcast({
      type: 'game_initialized',
      payload: {
        territories: this.state.territories,
        winCondition: this.victoryCondition,
        pointsToWin: this.victoryPoints,
      },
    });
  }

  protected onTurnStart(playerId: string): void {
    this.state.turnPhase = 'draw';

    // Collect resources
    this.collectResources(playerId);

    // Draw a card
    this.drawCards(playerId, 1);

    // Reset card states
    this.state.battlefield[playerId]?.forEach((card) => {
      card.hasAttacked = false;
      card.hasMoved = false;
      card.turnsInPlay++;
    });

    // Trigger start of turn abilities
    this.triggerAbilities(playerId, 'start_of_turn');

    // Process buffs
    this.processBuffDurations(playerId);

    this.broadcast({
      type: 'turn_phase',
      payload: {
        playerId,
        phase: 'draw',
        resources: this.state.resources[playerId],
        hand: this.state.hands[playerId],
      },
    });

    // Move to main phase
    setTimeout(() => {
      this.state.turnPhase = 'main';
      this.broadcast({
        type: 'turn_phase',
        payload: { playerId, phase: 'main' },
      });
    }, 1000);
  }

  protected onTurnEnd(playerId: string, forced: boolean): void {
    // Trigger end of turn abilities
    this.triggerAbilities(playerId, 'end_of_turn');

    // Discard excess cards
    const hand = this.state.hands[playerId];
    while (hand.length > this.maxHandSize) {
      const discarded = hand.pop();
      if (discarded) {
        this.state.discards[playerId].push(discarded);
      }
    }
  }

  protected validateAction(player: PlayerState, data: unknown): { isValid: boolean; reason?: string } {
    const action = data as { actionType: string; [key: string]: unknown };

    switch (action.actionType) {
      case 'play_card':
        return this.validatePlayCard(player.id, action.cardId as string, action.targetSlot as number);

      case 'attack':
        return this.validateAttack(
          player.id,
          action.attackerInstanceId as string,
          action.defenderInstanceId as string
        );

      case 'use_ability':
        return this.validateAbilityUse(
          player.id,
          action.cardInstanceId as string,
          action.abilityId as string,
          action.targetInstanceId as string
        );

      case 'end_phase':
        return { isValid: true };

      default:
        return { isValid: false, reason: 'Unknown action type' };
    }
  }

  protected processAction(player: PlayerState, data: unknown): void {
    const action = data as { actionType: string; [key: string]: unknown };

    switch (action.actionType) {
      case 'play_card':
        this.processPlayCard(player.id, action.cardId as string, action.targetSlot as number);
        break;

      case 'attack':
        this.processAttack(
          player.id,
          action.attackerInstanceId as string,
          action.defenderInstanceId as string
        );
        break;

      case 'use_ability':
        this.processAbilityUse(
          player.id,
          action.cardInstanceId as string,
          action.abilityId as string,
          action.targetInstanceId as string
        );
        break;

      case 'end_phase':
        this.advancePhase(player.id);
        break;
    }
  }

  protected handleGameSpecificAction(player: PlayerState, action: GameAction): void {
    // Handle viewing opponent's battlefield, etc.
    switch (action.type) {
      case 'view_battlefield':
        this.sendToPlayer(player.id, {
          type: 'battlefield_state',
          payload: {
            battlefield: this.state.battlefield,
            territories: this.state.territories,
          },
        });
        break;

      case 'view_hand':
        this.sendToPlayer(player.id, {
          type: 'hand_state',
          payload: {
            hand: this.state.hands[player.id],
            deckCount: this.state.decks[player.id]?.length ?? 0,
            discardCount: this.state.discards[player.id]?.length ?? 0,
          },
        });
        break;
    }
  }

  // ============================================================================
  // Card Playing
  // ============================================================================

  private validatePlayCard(
    playerId: string,
    cardId: string,
    targetSlot: number
  ): { isValid: boolean; reason?: string } {
    const hand = this.state.hands[playerId];
    const card = hand.find((c) => c.id === cardId);

    if (!card) {
      return { isValid: false, reason: 'Card not in hand' };
    }

    const resources = this.state.resources[playerId];
    if (resources.gold < card.cost.gold) {
      return { isValid: false, reason: 'Not enough gold' };
    }

    if (card.type === 'unit' || card.type === 'structure') {
      const battlefield = this.state.battlefield[playerId];
      if (battlefield.length >= this.slotsPerTerritory) {
        return { isValid: false, reason: 'Battlefield full' };
      }
    }

    return { isValid: true };
  }

  private processPlayCard(playerId: string, cardId: string, targetSlot: number): void {
    const hand = this.state.hands[playerId];
    const cardIndex = hand.findIndex((c) => c.id === cardId);
    if (cardIndex === -1) return;

    const card = hand[cardIndex];

    // Deduct cost
    this.state.resources[playerId].gold -= card.cost.gold;
    if (card.cost.influence) {
      this.state.resources[playerId].influence -= card.cost.influence;
    }
    if (card.cost.military) {
      this.state.resources[playerId].military -= card.cost.military;
    }

    // Remove from hand
    hand.splice(cardIndex, 1);

    if (card.type === 'unit' || card.type === 'structure') {
      // Deploy to battlefield
      const deployed: DeployedCard = {
        ...card,
        instanceId: `${card.id}_${Date.now()}`,
        ownerId: playerId,
        position: targetSlot,
        currentHealth: card.stats?.health ?? 1,
        currentAttack: card.stats?.attack ?? 0,
        currentDefense: card.stats?.defense ?? 0,
        buffs: [],
        hasAttacked: true, // Can't attack on deploy turn
        hasMoved: true,
        turnsInPlay: 0,
      };

      this.state.battlefield[playerId].push(deployed);

      // Trigger on_play abilities
      this.triggerCardAbilities(deployed, 'on_play', playerId);

      this.broadcast({
        type: 'card_deployed',
        payload: {
          playerId,
          card: deployed,
          position: targetSlot,
        },
      });
    } else {
      // Spell or event - resolve immediately
      this.resolveSpell(playerId, card, targetSlot);
      this.state.discards[playerId].push(card);
    }
  }

  private resolveSpell(playerId: string, card: Card, targetSlot: number): void {
    for (const ability of card.abilities) {
      this.applyAbilityEffect(playerId, ability.effect, null);
    }

    this.broadcast({
      type: 'spell_cast',
      payload: {
        playerId,
        card,
        effects: card.abilities.map((a) => a.effect),
      },
    });
  }

  // ============================================================================
  // Combat
  // ============================================================================

  private validateAttack(
    attackerId: string,
    attackerInstanceId: string,
    defenderInstanceId: string
  ): { isValid: boolean; reason?: string } {
    const attacker = this.findCard(attackerInstanceId);
    if (!attacker || attacker.ownerId !== attackerId) {
      return { isValid: false, reason: 'Invalid attacker' };
    }

    if (attacker.hasAttacked) {
      return { isValid: false, reason: 'Unit has already attacked' };
    }

    const defender = this.findCard(defenderInstanceId);
    if (!defender) {
      return { isValid: false, reason: 'Invalid target' };
    }

    if (defender.ownerId === attackerId) {
      return { isValid: false, reason: 'Cannot attack own units' };
    }

    return { isValid: true };
  }

  private processAttack(attackerId: string, attackerInstanceId: string, defenderInstanceId: string): void {
    const attacker = this.findCard(attackerInstanceId);
    const defender = this.findCard(defenderInstanceId);
    if (!attacker || !defender) return;

    // Calculate damage
    const attackDamage = Math.max(0, attacker.currentAttack - defender.currentDefense);
    const counterDamage = Math.max(0, defender.currentAttack - attacker.currentDefense);

    // Apply damage
    defender.currentHealth -= attackDamage;
    attacker.currentHealth -= counterDamage;

    // Mark as attacked
    attacker.hasAttacked = true;

    // Trigger on_attack and on_defend abilities
    this.triggerCardAbilities(attacker, 'on_attack', attackerId);
    this.triggerCardAbilities(defender, 'on_defend', defender.ownerId);

    // Log combat
    const logEntry: CombatLogEntry = {
      turn: this.state.turnInfo?.turnNumber ?? 0,
      attacker: attackerId,
      defender: defender.ownerId,
      attackerCard: attacker.instanceId,
      defenderCard: defender.instanceId,
      damage: attackDamage,
      result: defender.currentHealth <= 0 ? 'kill' : attackDamage > 0 ? 'hit' : 'blocked',
      timestamp: Date.now(),
    };
    this.state.combatLog.push(logEntry);

    // Check for deaths
    if (defender.currentHealth <= 0) {
      this.destroyCard(defender);
      this.state.scores[attackerId] = (this.state.scores[attackerId] ?? 0) + 1;
    }

    if (attacker.currentHealth <= 0) {
      this.destroyCard(attacker);
      this.state.scores[defender.ownerId] = (this.state.scores[defender.ownerId] ?? 0) + 1;
    }

    this.broadcast({
      type: 'combat_result',
      payload: {
        attacker: { instanceId: attackerInstanceId, damage: counterDamage, destroyed: attacker.currentHealth <= 0 },
        defender: { instanceId: defenderInstanceId, damage: attackDamage, destroyed: defender.currentHealth <= 0 },
      },
    });
  }

  private destroyCard(card: DeployedCard): void {
    // Trigger on_death abilities
    this.triggerCardAbilities(card, 'on_death', card.ownerId);

    // Remove from battlefield
    const battlefield = this.state.battlefield[card.ownerId];
    const index = battlefield.findIndex((c) => c.instanceId === card.instanceId);
    if (index !== -1) {
      battlefield.splice(index, 1);
    }

    // Add to discard
    this.state.discards[card.ownerId].push(card);

    this.broadcast({
      type: 'card_destroyed',
      payload: {
        instanceId: card.instanceId,
        ownerId: card.ownerId,
      },
    });
  }

  // ============================================================================
  // Abilities
  // ============================================================================

  private validateAbilityUse(
    playerId: string,
    cardInstanceId: string,
    abilityId: string,
    targetInstanceId?: string
  ): { isValid: boolean; reason?: string } {
    const card = this.findCard(cardInstanceId);
    if (!card || card.ownerId !== playerId) {
      return { isValid: false, reason: 'Invalid card' };
    }

    const ability = card.abilities.find((a) => a.id === abilityId);
    if (!ability || ability.type !== 'active') {
      return { isValid: false, reason: 'Invalid ability' };
    }

    if (ability.usesRemaining !== undefined && ability.usesRemaining <= 0) {
      return { isValid: false, reason: 'Ability on cooldown' };
    }

    return { isValid: true };
  }

  private processAbilityUse(
    playerId: string,
    cardInstanceId: string,
    abilityId: string,
    targetInstanceId?: string
  ): void {
    const card = this.findCard(cardInstanceId);
    if (!card) return;

    const ability = card.abilities.find((a) => a.id === abilityId);
    if (!ability) return;

    this.applyAbilityEffect(playerId, ability.effect, targetInstanceId ?? null);

    if (ability.cooldown) {
      ability.usesRemaining = ability.cooldown;
    }

    this.broadcast({
      type: 'ability_used',
      payload: {
        cardInstanceId,
        abilityId,
        targetInstanceId,
        effect: ability.effect,
      },
    });
  }

  private triggerAbilities(playerId: string, trigger: Ability['trigger']): void {
    const battlefield = this.state.battlefield[playerId];
    for (const card of battlefield) {
      this.triggerCardAbilities(card, trigger, playerId);
    }
  }

  private triggerCardAbilities(card: DeployedCard, trigger: Ability['trigger'], ownerId: string): void {
    for (const ability of card.abilities) {
      if (ability.type === 'triggered' && ability.trigger === trigger) {
        this.applyAbilityEffect(ownerId, ability.effect, null);
      }
    }
  }

  private applyAbilityEffect(playerId: string, effect: AbilityEffect, targetInstanceId: string | null): void {
    switch (effect.type) {
      case 'damage':
        if (targetInstanceId) {
          const target = this.findCard(targetInstanceId);
          if (target) {
            target.currentHealth -= effect.value;
            if (target.currentHealth <= 0) {
              this.destroyCard(target);
            }
          }
        }
        break;

      case 'heal':
        if (targetInstanceId) {
          const target = this.findCard(targetInstanceId);
          if (target && target.stats) {
            target.currentHealth = Math.min(target.stats.health, target.currentHealth + effect.value);
          }
        }
        break;

      case 'buff':
        this.applyBuff(playerId, effect, targetInstanceId);
        break;

      case 'draw':
        this.drawCards(playerId, effect.value);
        break;

      case 'resource':
        this.state.resources[playerId].gold += effect.value;
        break;
    }
  }

  private applyBuff(playerId: string, effect: AbilityEffect, targetInstanceId: string | null): void {
    const targets: DeployedCard[] = [];

    if (effect.target === 'all_allies') {
      targets.push(...this.state.battlefield[playerId]);
    } else if (targetInstanceId) {
      const target = this.findCard(targetInstanceId);
      if (target) targets.push(target);
    }

    for (const target of targets) {
      if (effect.statModifier) {
        const buff: Buff = {
          id: `buff_${Date.now()}`,
          name: 'Buff',
          statModifier: effect.statModifier,
          duration: effect.duration ?? 1,
          source: playerId,
        };

        target.buffs.push(buff);
        if (effect.statModifier.attack) target.currentAttack += effect.statModifier.attack;
        if (effect.statModifier.defense) target.currentDefense += effect.statModifier.defense;
      }
    }
  }

  private processBuffDurations(playerId: string): void {
    for (const card of this.state.battlefield[playerId]) {
      const expiredBuffs: Buff[] = [];

      for (const buff of card.buffs) {
        buff.duration--;
        if (buff.duration <= 0) {
          expiredBuffs.push(buff);
          // Remove buff effects
          if (buff.statModifier.attack) card.currentAttack -= buff.statModifier.attack;
          if (buff.statModifier.defense) card.currentDefense -= buff.statModifier.defense;
        }
      }

      card.buffs = card.buffs.filter((b) => !expiredBuffs.includes(b));
    }
  }

  // ============================================================================
  // Resources & Cards
  // ============================================================================

  private collectResources(playerId: string): void {
    const resources = this.state.resources[playerId];
    resources.gold += resources.goldPerTurn;
    resources.influence += resources.influencePerTurn;
    resources.military += resources.militaryPerTurn;

    // Territory bonuses
    for (const territory of this.state.territories) {
      if (territory.controlledBy === playerId && territory.resourceBonus.goldPerTurn) {
        resources.gold += territory.resourceBonus.goldPerTurn;
      }
    }
  }

  private drawCards(playerId: string, count: number): void {
    const deck = this.state.decks[playerId];
    const hand = this.state.hands[playerId];

    for (let i = 0; i < count && deck.length > 0; i++) {
      if (hand.length < this.maxHandSize) {
        const card = deck.shift();
        if (card) hand.push(card);
      }
    }

    // Reshuffle discard if deck empty
    if (deck.length === 0 && this.state.discards[playerId].length > 0) {
      this.state.decks[playerId] = this.shuffleArray([...this.state.discards[playerId]]);
      this.state.discards[playerId] = [];
    }

    this.sendToPlayer(playerId, {
      type: 'cards_drawn',
      payload: {
        hand: this.state.hands[playerId],
        deckRemaining: this.state.decks[playerId].length,
      },
    });
  }

  private findCard(instanceId: string): DeployedCard | null {
    for (const playerId of Object.keys(this.state.battlefield)) {
      const card = this.state.battlefield[playerId].find((c) => c.instanceId === instanceId);
      if (card) return card;
    }
    return null;
  }

  // ============================================================================
  // Game Flow
  // ============================================================================

  private advancePhase(playerId: string): void {
    switch (this.state.turnPhase) {
      case 'draw':
        this.state.turnPhase = 'main';
        break;
      case 'main':
        this.state.turnPhase = 'combat';
        break;
      case 'combat':
        this.state.turnPhase = 'end';
        // Auto-end turn after combat phase - broadcast that combat phase is complete
        // The parent class turn timer or explicit end_turn action will handle turn progression
        this.broadcast({
          type: 'combat_phase_complete',
          payload: { playerId },
        });
        break;
    }

    this.broadcast({
      type: 'turn_phase',
      payload: { playerId, phase: this.state.turnPhase },
    });
  }

  /**
   * Request to end the current turn - delegates to parent class behavior.
   */
  private requestEndTurn(): void {
    // The parent TurnBasedRoom class handles turn progression via endTurn()
    // This method is called after combat phase completes
    // The actual turn ending is handled by the parent class's turn timer or end_turn action
  }

  protected checkWinCondition(): boolean {
    switch (this.victoryCondition) {
      case 'elimination':
        return this.checkEliminationVictory();
      case 'points':
        return this.checkPointsVictory();
      case 'territory':
        return this.checkTerritoryVictory();
      default:
        return super.checkWinCondition();
    }
  }

  private checkEliminationVictory(): boolean {
    const activePlayers = this.state.turnOrder.filter((id) => {
      const data = this.state.playerData[id];
      return !data?.isEliminated;
    });

    if (activePlayers.length <= 1) {
      this.endGame();
      return true;
    }
    return false;
  }

  private checkPointsVictory(): boolean {
    for (const [playerId, score] of Object.entries(this.state.scores)) {
      if (score >= this.victoryPoints) {
        this.state.gameData.winner = playerId;
        this.endGame();
        return true;
      }
    }
    return false;
  }

  private checkTerritoryVictory(): boolean {
    for (const playerId of this.state.turnOrder) {
      const controlled = this.state.territories.filter((t) => t.controlledBy === playerId).length;
      if (controlled >= this.territoryCount) {
        this.state.gameData.winner = playerId;
        this.endGame();
        return true;
      }
    }
    return false;
  }

  protected determineWinner(): string | null {
    // Highest score wins
    let highestScore = 0;
    let winner: string | null = null;

    for (const [playerId, score] of Object.entries(this.state.scores)) {
      if (score > highestScore) {
        highestScore = score;
        winner = playerId;
      }
    }

    return winner ?? super.determineWinner();
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  public dispose(): void {
    hcLog.info({ roomId: this.id }, 'Disposing Historical Conquest room');

    // Clear bot spawn timeout
    if (this.botSpawnTimeout) {
      clearTimeout(this.botSpawnTimeout);
      this.botSpawnTimeout = null;
    }

    // Dispose bot manager
    if (this.botManager) {
      this.botManager.dispose();
    }

    // Call parent dispose
    super.dispose();
  }
}
