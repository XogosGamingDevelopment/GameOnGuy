/**
 * Game On Dude! - Turn-Based Room
 * www.gameonguy.com
 *
 * Base room for turn-based games like Historical Conquest.
 * Handles turn order, action validation, and game state transitions.
 */

import { Room, RoomConstructorOptions } from '../rooms/Room';
import { PlayerState, GameAction, MessageType } from '../core/types';
import { Client } from '../core/Client';

// ============================================================================
// Types
// ============================================================================

export interface TurnInfo {
  currentPlayerId: string;
  turnNumber: number;
  roundNumber: number;
  startTime: number;
  timeRemaining: number;
  actionsThisTurn: TurnAction[];
}

export interface TurnAction {
  type: string;
  playerId: string;
  data: unknown;
  timestamp: number;
  isValid: boolean;
}

export interface PlayerTurnData {
  turnOrder: number;
  turnsPlayed: number;
  totalActions: number;
  timeUsed: number;
  isEliminated: boolean;
  data: Record<string, unknown>;
}

export interface TurnBasedState {
  phase: 'waiting' | 'setup' | 'playing' | 'between_turns' | 'ended';
  turnInfo: TurnInfo | null;
  turnOrder: string[];
  currentTurnIndex: number;
  roundNumber: number;
  maxRounds: number;
  playerData: Record<string, PlayerTurnData>;
  gameData: Record<string, unknown>;
  history: TurnAction[];
}

export interface TurnBasedRoomOptions extends RoomConstructorOptions {
  turnTimeLimit?: number;
  maxRounds?: number;
  actionsPerTurn?: number;
  allowUndo?: boolean;
  simultaneousTurns?: boolean;
  setupPhaseTime?: number;
}

// ============================================================================
// Turn-Based Room Implementation
// ============================================================================

export class TurnBasedRoom extends Room<TurnBasedState> {
  protected turnTimeLimit: number;
  protected maxRounds: number;
  protected actionsPerTurn: number;
  protected allowUndo: boolean;
  protected simultaneousTurns: boolean;
  protected setupPhaseTime: number;

  private turnTimer?: NodeJS.Timeout;
  private actionsThisTurn: number = 0;

  constructor(gameType: string, options: TurnBasedRoomOptions = {}) {
    super(gameType, {
      ...options,
      tickRate: options.tickRate ?? 1, // Very low tick rate for turn-based
    });

    this.turnTimeLimit = options.turnTimeLimit ?? 60000; // 60 seconds per turn
    this.maxRounds = options.maxRounds ?? 0; // 0 = unlimited
    this.actionsPerTurn = options.actionsPerTurn ?? 1;
    this.allowUndo = options.allowUndo ?? false;
    this.simultaneousTurns = options.simultaneousTurns ?? false;
    this.setupPhaseTime = options.setupPhaseTime ?? 0;
  }

  protected initializeState(): TurnBasedState {
    return {
      phase: 'waiting',
      turnInfo: null,
      turnOrder: [],
      currentTurnIndex: 0,
      roundNumber: 1,
      maxRounds: this.maxRounds,
      playerData: {},
      gameData: {},
      history: [],
    };
  }

  protected onPlayerJoin(player: PlayerState): void {
    this.state.playerData[player.id] = {
      turnOrder: this.players.size,
      turnsPlayed: 0,
      totalActions: 0,
      timeUsed: 0,
      isEliminated: false,
      data: {},
    };

    this.state.turnOrder.push(player.id);
  }

  protected onPlayerLeave(player: PlayerState): void {
    // Mark as eliminated rather than removing
    const playerData = this.state.playerData[player.id];
    if (playerData) {
      playerData.isEliminated = true;
    }

    // If it was their turn, move to next
    if (this.state.turnInfo?.currentPlayerId === player.id) {
      this.endTurn(true);
    }

    // Check win condition
    this.checkWinCondition();
  }

  protected onGameStart(): void {
    this.log.info('Turn-based game starting');

    // Randomize turn order
    this.shuffleTurnOrder();

    if (this.setupPhaseTime > 0) {
      this.startSetupPhase();
    } else {
      this.beginGame();
    }
  }

  protected onGameEnd(): unknown {
    this.clearTurnTimer();

    return {
      winner: this.determineWinner(),
      roundsPlayed: this.state.roundNumber,
      playerData: this.state.playerData,
      history: this.state.history,
    };
  }

  protected onTick(deltaTime: number): void {
    // Update turn timer
    if (this.state.turnInfo && this.state.phase === 'playing') {
      const elapsed = Date.now() - this.state.turnInfo.startTime;
      this.state.turnInfo.timeRemaining = Math.max(0, this.turnTimeLimit - elapsed);
    }
  }

  protected onGameAction(player: PlayerState, action: GameAction): void {
    // Validate it's the player's turn (unless simultaneous)
    if (!this.simultaneousTurns && this.state.turnInfo?.currentPlayerId !== player.id) {
      this.sendToPlayer(player.id, {
        type: 'action_rejected',
        payload: { reason: 'Not your turn' },
      });
      return;
    }

    // Check if player is eliminated
    const playerData = this.state.playerData[player.id];
    if (playerData?.isEliminated) {
      this.sendToPlayer(player.id, {
        type: 'action_rejected',
        payload: { reason: 'You have been eliminated' },
      });
      return;
    }

    switch (action.type) {
      case 'turn_action':
        this.handleTurnAction(player, action.data);
        break;

      case 'end_turn':
        this.handleEndTurn(player);
        break;

      case 'undo':
        if (this.allowUndo) {
          this.handleUndo(player);
        }
        break;

      case 'forfeit':
        this.handleForfeit(player);
        break;

      default:
        this.handleGameSpecificAction(player, action);
    }
  }

  // ============================================================================
  // Game Flow
  // ============================================================================

  private startSetupPhase(): void {
    this.state.phase = 'setup';

    this.broadcast({
      type: 'setup_phase',
      payload: { duration: this.setupPhaseTime },
    });

    setTimeout(() => {
      this.beginGame();
    }, this.setupPhaseTime);
  }

  private beginGame(): void {
    this.state.phase = 'playing';
    this.state.roundNumber = 1;
    this.state.currentTurnIndex = 0;

    this.onGameBegin();

    this.broadcast({
      type: 'game_begin',
      payload: {
        turnOrder: this.state.turnOrder,
        state: this.state,
      },
    });

    this.startTurn();
  }

  private startTurn(): void {
    // Skip eliminated players
    while (this.isCurrentPlayerEliminated()) {
      this.state.currentTurnIndex = (this.state.currentTurnIndex + 1) % this.state.turnOrder.length;

      // Check if we've gone through all players
      if (this.state.currentTurnIndex === 0) {
        this.state.roundNumber++;
        if (this.maxRounds > 0 && this.state.roundNumber > this.maxRounds) {
          this.endGame();
          return;
        }
      }
    }

    const currentPlayerId = this.state.turnOrder[this.state.currentTurnIndex];

    this.state.turnInfo = {
      currentPlayerId,
      turnNumber: this.getTotalTurns() + 1,
      roundNumber: this.state.roundNumber,
      startTime: Date.now(),
      timeRemaining: this.turnTimeLimit,
      actionsThisTurn: [],
    };

    this.actionsThisTurn = 0;

    // Call hook for turn start
    this.onTurnStart(currentPlayerId);

    this.broadcast({
      type: 'turn_start',
      payload: {
        playerId: currentPlayerId,
        turnNumber: this.state.turnInfo.turnNumber,
        roundNumber: this.state.roundNumber,
        timeLimit: this.turnTimeLimit,
      },
    });

    // Start turn timer
    this.startTurnTimer();
  }

  private endTurn(forced: boolean = false): void {
    if (!this.state.turnInfo) return;

    this.clearTurnTimer();

    const playerId = this.state.turnInfo.currentPlayerId;
    const playerData = this.state.playerData[playerId];

    if (playerData) {
      playerData.turnsPlayed++;
      playerData.timeUsed += Date.now() - this.state.turnInfo.startTime;
    }

    // Call hook for turn end
    this.onTurnEnd(playerId, forced);

    this.broadcast({
      type: 'turn_end',
      payload: {
        playerId,
        forced,
        actions: this.state.turnInfo.actionsThisTurn,
      },
    });

    // Move to next player
    this.state.currentTurnIndex = (this.state.currentTurnIndex + 1) % this.state.turnOrder.length;

    // Check for new round
    if (this.state.currentTurnIndex === 0) {
      this.state.roundNumber++;

      this.broadcast({
        type: 'round_end',
        payload: { roundNumber: this.state.roundNumber - 1 },
      });

      if (this.maxRounds > 0 && this.state.roundNumber > this.maxRounds) {
        this.endGame();
        return;
      }

      this.onRoundEnd();
    }

    // Check win condition
    if (this.checkWinCondition()) {
      return;
    }

    this.state.phase = 'between_turns';

    // Brief pause between turns
    setTimeout(() => {
      this.state.phase = 'playing';
      this.startTurn();
    }, 1000);
  }

  // ============================================================================
  // Action Handling
  // ============================================================================

  private handleTurnAction(player: PlayerState, data: unknown): void {
    if (this.actionsThisTurn >= this.actionsPerTurn) {
      this.sendToPlayer(player.id, {
        type: 'action_rejected',
        payload: { reason: 'No actions remaining this turn' },
      });
      return;
    }

    // Validate action through game-specific logic
    const validation = this.validateAction(player, data);

    const turnAction: TurnAction = {
      type: 'turn_action',
      playerId: player.id,
      data,
      timestamp: Date.now(),
      isValid: validation.isValid,
    };

    if (!validation.isValid) {
      this.sendToPlayer(player.id, {
        type: 'action_rejected',
        payload: { reason: validation.reason },
      });
      return;
    }

    // Process the action
    this.processAction(player, data);

    // Record action
    this.state.turnInfo!.actionsThisTurn.push(turnAction);
    this.state.history.push(turnAction);
    this.actionsThisTurn++;

    const playerData = this.state.playerData[player.id];
    if (playerData) {
      playerData.totalActions++;
    }

    // Broadcast action to all players
    this.broadcast({
      type: 'action_performed',
      payload: {
        playerId: player.id,
        action: turnAction,
        actionsRemaining: this.actionsPerTurn - this.actionsThisTurn,
      },
    });

    // Auto end turn if no actions remaining
    if (this.actionsThisTurn >= this.actionsPerTurn) {
      this.endTurn();
    }
  }

  private handleEndTurn(player: PlayerState): void {
    if (this.state.turnInfo?.currentPlayerId !== player.id) {
      return;
    }

    this.endTurn();
  }

  private handleUndo(player: PlayerState): void {
    if (this.state.turnInfo?.currentPlayerId !== player.id) {
      return;
    }

    const lastAction = this.state.turnInfo.actionsThisTurn.pop();
    if (lastAction) {
      this.undoAction(player, lastAction);
      this.actionsThisTurn--;

      this.broadcast({
        type: 'action_undone',
        payload: { playerId: player.id },
      });
    }
  }

  private handleForfeit(player: PlayerState): void {
    const playerData = this.state.playerData[player.id];
    if (playerData) {
      playerData.isEliminated = true;
    }

    this.broadcast({
      type: 'player_forfeited',
      payload: { playerId: player.id },
    });

    if (this.state.turnInfo?.currentPlayerId === player.id) {
      this.endTurn(true);
    }

    this.checkWinCondition();
  }

  // ============================================================================
  // Timer Management
  // ============================================================================

  private startTurnTimer(): void {
    this.clearTurnTimer();

    this.turnTimer = setTimeout(() => {
      this.log.info({ playerId: this.state.turnInfo?.currentPlayerId }, 'Turn timed out');

      // Perform default action or end turn
      this.onTurnTimeout(this.state.turnInfo!.currentPlayerId);
      this.endTurn(true);
    }, this.turnTimeLimit);
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = undefined;
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private shuffleTurnOrder(): void {
    for (let i = this.state.turnOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.state.turnOrder[i], this.state.turnOrder[j]] = [
        this.state.turnOrder[j],
        this.state.turnOrder[i],
      ];
    }

    // Update turn order in player data
    this.state.turnOrder.forEach((playerId, index) => {
      const playerData = this.state.playerData[playerId];
      if (playerData) {
        playerData.turnOrder = index;
      }
    });
  }

  private isCurrentPlayerEliminated(): boolean {
    const playerId = this.state.turnOrder[this.state.currentTurnIndex];
    return this.state.playerData[playerId]?.isEliminated ?? false;
  }

  private getTotalTurns(): number {
    let total = 0;
    Object.values(this.state.playerData).forEach((data) => {
      total += data.turnsPlayed;
    });
    return total;
  }

  private getActivePlayers(): string[] {
    return this.state.turnOrder.filter(
      (id) => !this.state.playerData[id]?.isEliminated
    );
  }

  // ============================================================================
  // Hooks for Subclasses
  // ============================================================================

  /**
   * Called when the game begins, after setup phase.
   */
  protected onGameBegin(): void {}

  /**
   * Called at the start of each turn.
   */
  protected onTurnStart(playerId: string): void {}

  /**
   * Called at the end of each turn.
   */
  protected onTurnEnd(playerId: string, forced: boolean): void {}

  /**
   * Called when a turn times out.
   */
  protected onTurnTimeout(playerId: string): void {}

  /**
   * Called at the end of each round.
   */
  protected onRoundEnd(): void {}

  /**
   * Validate an action before processing.
   */
  protected validateAction(player: PlayerState, data: unknown): { isValid: boolean; reason?: string } {
    return { isValid: true };
  }

  /**
   * Process a validated action. Update game state here.
   */
  protected processAction(player: PlayerState, data: unknown): void {}

  /**
   * Undo a previously performed action.
   */
  protected undoAction(player: PlayerState, action: TurnAction): void {}

  /**
   * Handle game-specific actions not covered by base class.
   */
  protected handleGameSpecificAction(player: PlayerState, action: GameAction): void {}

  /**
   * Check if the game has been won. Return true to end the game.
   */
  protected checkWinCondition(): boolean {
    const activePlayers = this.getActivePlayers();

    if (activePlayers.length <= 1) {
      this.endGame();
      return true;
    }

    return false;
  }

  /**
   * Determine the winner at game end.
   */
  protected determineWinner(): string | null {
    const activePlayers = this.getActivePlayers();
    return activePlayers.length === 1 ? activePlayers[0] : null;
  }
}
