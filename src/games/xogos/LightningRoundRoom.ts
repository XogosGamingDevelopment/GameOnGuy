/**
 * Game On Dude! - Lightning Round Game Room
 * www.gameonguy.com
 *
 * Fast-paced multiplayer trivia game with category selection and point multipliers.
 * Players choose categories, answer quickly for bonus points, and compete on leaderboards.
 */

import { TriviaRoom, TriviaRoomOptions, Question, TriviaState } from '../TriviaRoom';
import { PlayerState, GameAction } from '../../core/types';
import { QuestionRepository, QuestionWithAnswers } from '../../database';

// ============================================================================
// Types
// ============================================================================

export interface Category {
  id: string;
  name: string;
  description?: string;
  questionCount: number;
  iconUrl?: string;
}

export interface LightningRoundState extends TriviaState {
  categories: Category[];
  availableCategories: Category[];
  selectedCategory?: Category;
  categorySelector?: string; // Player ID who selects category
  selectionTimeRemaining: number;
  pointValues: number[]; // [100, 200, 300] etc.
  currentPointValue: number;
  roundCategories: Category[]; // Categories used this round
  fastestAnswer?: { playerId: string; time: number };
  streakBonuses: Record<string, number>; // Extra points from streaks
}

export interface LightningRoundOptions extends TriviaRoomOptions {
  categoriesPerRound?: number;
  questionsPerCategory?: number;
  categorySelectionTime?: number;
  pointValues?: number[];
  streakBonusMultiplier?: number;
  questionRepository?: QuestionRepository;
}

// ============================================================================
// Lightning Round Room Implementation
// ============================================================================

export class LightningRoundRoom extends TriviaRoom {
  private categoriesPerRound: number;
  private questionsPerCategory: number;
  private categorySelectionTime: number;
  private pointValues: number[];
  private streakBonusMultiplier: number;
  private categorySelectionTimer?: NodeJS.Timeout;
  private questionRepository?: QuestionRepository;

  // Override state with Lightning Round specific state
  declare protected state: LightningRoundState;

  constructor(gameType: string, options: LightningRoundOptions = {}) {
    super(gameType, {
      ...options,
      questionsPerRound: (options.categoriesPerRound ?? 3) * (options.questionsPerCategory ?? 3),
      totalRounds: options.totalRounds ?? 2,
      questionTimeLimit: options.questionTimeLimit ?? 10000, // 10 seconds
      resultsDisplayTime: options.resultsDisplayTime ?? 2500,
      bonusTimeEnabled: true,
    });

    this.categoriesPerRound = options.categoriesPerRound ?? 3;
    this.questionsPerCategory = options.questionsPerCategory ?? 3;
    this.categorySelectionTime = options.categorySelectionTime ?? 8000;
    this.pointValues = options.pointValues ?? [100, 200, 300];
    this.streakBonusMultiplier = options.streakBonusMultiplier ?? 0.1;
    this.questionRepository = options.questionRepository;
  }

  protected initializeState(): LightningRoundState {
    const baseState = super.initializeState();
    return {
      ...baseState,
      categories: [],
      availableCategories: [],
      selectedCategory: undefined,
      categorySelector: undefined,
      selectionTimeRemaining: 0,
      pointValues: this.pointValues,
      currentPointValue: this.pointValues[0],
      roundCategories: [],
      streakBonuses: {},
    };
  }

  protected onPlayerJoin(player: PlayerState): void {
    super.onPlayerJoin(player);
    this.state.streakBonuses[player.id] = 0;
  }

  protected async onGameStart(): Promise<void> {
    this.log.info('Lightning Round game starting');

    // Load categories from database if available
    if (this.questionRepository) {
      await this.loadCategoriesFromDatabase();
    }

    this.startLightningRound();
  }

  /**
   * Load categories from database.
   */
  private async loadCategoriesFromDatabase(): Promise<void> {
    try {
      const categoryNames = await this.questionRepository!.getCategories('lightning_round');
      const categories: Category[] = [];

      for (const name of categoryNames) {
        const count = await this.questionRepository!.count({
          game_type: 'lightning_round',
          category: name,
        });
        categories.push({
          id: name.toLowerCase().replace(/\s+/g, '_'),
          name,
          questionCount: count,
        });
      }

      this.state.categories = categories;
      this.log.info({ categoryCount: categories.length }, 'Categories loaded from database');
    } catch (error) {
      this.log.error({ error }, 'Failed to load categories from database');
    }
  }

  /**
   * Start a new round with category selection.
   */
  private startLightningRound(): void {
    this.log.info({ round: this.state.currentRound }, 'Starting Lightning Round');

    // Reset round state
    this.state.roundCategories = [];
    this.state.currentQuestionIndex = 0;

    // Prepare available categories for this round
    this.state.availableCategories = this.shuffleArray([...this.state.categories]).slice(
      0,
      this.categoriesPerRound + 2 // Extra for selection
    );

    this.broadcast({
      type: 'round_start',
      payload: {
        round: this.state.currentRound,
        totalRounds: this.state.totalRounds,
        categoriesPerRound: this.categoriesPerRound,
        questionsPerCategory: this.questionsPerCategory,
        pointValues: this.pointValues,
      },
    });

    // Start category selection phase
    this.startCategorySelection();
  }

  /**
   * Start category selection phase.
   */
  private startCategorySelection(): void {
    if (this.state.roundCategories.length >= this.categoriesPerRound) {
      // All categories selected, start questions
      this.startCategoryQuestions();
      return;
    }

    // Determine who selects the category (rotate through players)
    const playerIds = Array.from(this.players.keys());
    const selectorIndex =
      (this.state.roundCategories.length + (this.state.currentRound - 1) * this.categoriesPerRound) %
      playerIds.length;
    this.state.categorySelector = playerIds[selectorIndex];

    this.state.phase = 'showing_question'; // Reuse for category selection
    this.state.selectionTimeRemaining = this.categorySelectionTime;

    this.broadcast({
      type: 'category_selection',
      payload: {
        selector: this.state.categorySelector,
        selectorUsername: this.players.get(this.state.categorySelector)?.username,
        availableCategories: this.state.availableCategories,
        timeLimit: this.categorySelectionTime,
        categoryNumber: this.state.roundCategories.length + 1,
        totalCategories: this.categoriesPerRound,
      },
    });

    // Set timer for auto-selection
    this.categorySelectionTimer = setTimeout(() => {
      this.autoSelectCategory();
    }, this.categorySelectionTime);
  }

  /**
   * Handle category selection by player.
   */
  private handleCategorySelection(player: PlayerState, categoryId: string): void {
    if (player.id !== this.state.categorySelector) {
      this.sendToPlayer(player.id, {
        type: 'selection_rejected',
        payload: { reason: 'Not your turn to select' },
      });
      return;
    }

    const category = this.state.availableCategories.find((c) => c.id === categoryId);
    if (!category) {
      this.sendToPlayer(player.id, {
        type: 'selection_rejected',
        payload: { reason: 'Invalid category' },
      });
      return;
    }

    this.clearCategorySelectionTimer();
    this.selectCategory(category, player.id);
  }

  /**
   * Auto-select a random category when timer expires.
   */
  private autoSelectCategory(): void {
    const category =
      this.state.availableCategories[
        Math.floor(Math.random() * this.state.availableCategories.length)
      ];
    this.selectCategory(category, this.state.categorySelector!, true);
  }

  /**
   * Process category selection.
   */
  private selectCategory(category: Category, selectedBy: string, isAuto: boolean = false): void {
    this.state.selectedCategory = category;
    this.state.roundCategories.push(category);

    // Remove from available categories
    this.state.availableCategories = this.state.availableCategories.filter(
      (c) => c.id !== category.id
    );

    this.broadcast({
      type: 'category_selected',
      payload: {
        category,
        selectedBy,
        isAutoSelected: isAuto,
        categoryNumber: this.state.roundCategories.length,
      },
    });

    // Load questions for this category and start
    this.loadCategoryQuestions(category).then(() => {
      setTimeout(() => {
        if (this.state.roundCategories.length < this.categoriesPerRound) {
          this.startCategorySelection();
        } else {
          this.startCategoryQuestions();
        }
      }, 1500);
    });
  }

  /**
   * Load questions for a category.
   */
  private async loadCategoryQuestions(category: Category): Promise<void> {
    if (this.questionRepository) {
      try {
        const questions = await this.questionRepository.getRandom(
          {
            game_type: 'lightning_round',
            category: category.name,
          },
          this.questionsPerCategory
        );

        // Convert database questions to room format
        const roomQuestions: Question[] = questions.map((q, index) => ({
          id: q.id,
          text: q.question_text,
          category: q.category ?? undefined,
          difficulty: q.difficulty,
          points: this.pointValues[index % this.pointValues.length],
          answers: q.answers.map((a) => ({
            id: a.id,
            text: a.answer_text,
          })),
          correctAnswerId: q.correct_answer_id ?? q.answers.find((a) => a.is_correct)?.id ?? '',
          timeLimit: q.time_limit,
        }));

        this.addQuestions(roomQuestions);
      } catch (error) {
        this.log.error({ error, category: category.name }, 'Failed to load category questions');
      }
    }
  }

  /**
   * Start the questions phase for selected categories.
   */
  private startCategoryQuestions(): void {
    this.state.currentQuestionIndex = 0;

    this.broadcast({
      type: 'questions_starting',
      payload: {
        categories: this.state.roundCategories,
        totalQuestions: this.categoriesPerRound * this.questionsPerCategory,
      },
    });

    setTimeout(() => {
      this.showLightningQuestion();
    }, 1500);
  }

  /**
   * Show next Lightning Round question with point value progression.
   */
  private showLightningQuestion(): void {
    // Calculate point value based on question index within category
    const questionInCategory = this.state.currentQuestionIndex % this.questionsPerCategory;
    this.state.currentPointValue = this.pointValues[questionInCategory] ?? this.pointValues[0];

    // Reset fastest answer tracker
    this.state.fastestAnswer = undefined;

    // Call parent's question showing logic
    // We'll broadcast additional Lightning Round specific data
    const question = this.getCurrentQuestion();
    if (!question) {
      this.endLightningRound();
      return;
    }

    this.state.currentQuestion = { ...question, points: this.state.currentPointValue };
    this.state.phase = 'showing_question';
    this.state.answersThisQuestion = {};

    this.broadcast({
      type: 'question',
      payload: {
        questionIndex: this.state.currentQuestionIndex + 1,
        totalQuestions: this.categoriesPerRound * this.questionsPerCategory,
        pointValue: this.state.currentPointValue,
        category: this.state.roundCategories[
          Math.floor(this.state.currentQuestionIndex / this.questionsPerCategory)
        ],
        question: {
          id: question.id,
          text: question.text,
          category: question.category,
          points: this.state.currentPointValue,
          answers: question.answers,
          timeLimit: question.timeLimit ?? 10000,
        },
      },
    });

    // Brief delay then accept answers
    setTimeout(() => {
      this.startAcceptingLightningAnswers();
    }, 500);
  }

  /**
   * Start accepting answers with Lightning Round specific timing.
   */
  private startAcceptingLightningAnswers(): void {
    this.state.phase = 'accepting_answers';
    this.state.questionStartTime = Date.now();
    this.state.timeRemaining = this.state.currentQuestion?.timeLimit ?? 10000;

    this.broadcast({
      type: 'answers_open',
      payload: {
        timeLimit: this.state.timeRemaining,
        pointValue: this.state.currentPointValue,
      },
    });

    // Set timer for when answers close
    setTimeout(() => {
      this.closeLightningAnswers();
    }, this.state.timeRemaining);
  }

  /**
   * Close answers and show results with Lightning Round bonuses.
   */
  private closeLightningAnswers(): void {
    this.state.phase = 'showing_results';

    // Process unanswered players
    this.players.forEach((player) => {
      if (!this.state.answersThisQuestion[player.id]) {
        this.processLightningRoundAnswer(player.id, undefined, this.state.timeRemaining);
      }
    });

    // Calculate results with streak bonuses
    const results = this.calculateLightningRoundResults();

    this.broadcast({
      type: 'question_results',
      payload: {
        correctAnswerId: this.state.currentQuestion!.correctAnswerId,
        results,
        leaderboard: this.state.leaderboard,
        fastestCorrect: this.state.fastestAnswer,
        pointValue: this.state.currentPointValue,
      },
    });

    // Show results then move to next question
    setTimeout(() => {
      this.state.currentQuestionIndex++;

      // Check if we've finished all questions for this round
      if (this.state.currentQuestionIndex >= this.categoriesPerRound * this.questionsPerCategory) {
        this.endLightningRound();
      } else {
        this.showLightningQuestion();
      }
    }, 2500);
  }

  /**
   * Process an answer with Lightning Round scoring.
   */
  private processLightningRoundAnswer(
    playerId: string,
    answerId: string | undefined,
    timeToAnswer: number
  ): void {
    const playerData = this.state.playerData[playerId];
    if (!playerData) return;

    const question = this.state.currentQuestion!;
    const isCorrect = answerId === question.correctAnswerId;

    let pointsEarned = 0;
    if (isCorrect) {
      // Base points
      pointsEarned = this.state.currentPointValue;

      // Time bonus (faster = more points, up to 50% bonus)
      const timeLimit = question.timeLimit ?? 10000;
      const timeBonus = Math.floor((1 - timeToAnswer / timeLimit) * pointsEarned * 0.5);
      pointsEarned += Math.max(0, timeBonus);

      // Streak bonus
      const streakBonus = Math.floor(playerData.streak * this.streakBonusMultiplier * pointsEarned);
      pointsEarned += streakBonus;
      this.state.streakBonuses[playerId] = (this.state.streakBonuses[playerId] ?? 0) + streakBonus;

      // Track fastest correct answer
      if (!this.state.fastestAnswer || timeToAnswer < this.state.fastestAnswer.time) {
        this.state.fastestAnswer = { playerId, time: timeToAnswer };
      }

      playerData.score += pointsEarned;
      playerData.correctAnswers++;
      playerData.streak++;
      playerData.bestStreak = Math.max(playerData.bestStreak, playerData.streak);
    } else {
      playerData.wrongAnswers++;
      playerData.streak = 0;
    }

    playerData.totalTime += timeToAnswer;
    playerData.answers.push({
      questionId: question.id,
      answerId,
      isCorrect,
      timeToAnswer,
      pointsEarned,
    });

    this.updateLightningLeaderboard();
  }

  /**
   * Calculate Lightning Round results with additional stats.
   */
  private calculateLightningRoundResults(): Record<
    string,
    { isCorrect: boolean; points: number; streak: number; timeBonus: number }
  > {
    const results: Record<
      string,
      { isCorrect: boolean; points: number; streak: number; timeBonus: number }
    > = {};

    Object.entries(this.state.answersThisQuestion).forEach(([playerId]) => {
      const playerData = this.state.playerData[playerId];
      const lastAnswer = playerData?.answers[playerData.answers.length - 1];

      if (lastAnswer) {
        const basePoints = this.state.currentPointValue;
        const timeBonus = lastAnswer.isCorrect
          ? Math.floor(
              (1 - lastAnswer.timeToAnswer / (this.state.currentQuestion?.timeLimit ?? 10000)) *
                basePoints *
                0.5
            )
          : 0;

        results[playerId] = {
          isCorrect: lastAnswer.isCorrect,
          points: lastAnswer.pointsEarned,
          streak: playerData.streak,
          timeBonus: Math.max(0, timeBonus),
        };
      }
    });

    return results;
  }

  /**
   * End the Lightning Round and show round summary.
   */
  private endLightningRound(): void {
    this.state.phase = 'round_end';
    this.updateLightningLeaderboard();

    this.broadcast({
      type: 'round_end',
      payload: {
        round: this.state.currentRound,
        leaderboard: this.state.leaderboard,
        categoriesPlayed: this.state.roundCategories,
        streakBonuses: this.state.streakBonuses,
        stats: this.calculateRoundStats(),
      },
    });

    if (this.state.currentRound >= this.state.totalRounds) {
      // Game over
      setTimeout(() => {
        this.state.phase = 'game_end';
        this.endGame();
      }, 5000);
    } else {
      // Next round
      setTimeout(() => {
        this.state.currentRound++;
        this.startLightningRound();
      }, 5000);
    }
  }

  /**
   * Calculate round statistics.
   */
  private calculateRoundStats(): Record<string, unknown> {
    const stats: Record<string, unknown> = {
      totalQuestions: this.categoriesPerRound * this.questionsPerCategory,
      categoriesPlayed: this.state.roundCategories.map((c) => c.name),
    };

    // Find best streak
    let bestStreak = 0;
    let bestStreakPlayer = '';
    this.players.forEach((player) => {
      const data = this.state.playerData[player.id];
      if (data && data.bestStreak > bestStreak) {
        bestStreak = data.bestStreak;
        bestStreakPlayer = player.username;
      }
    });
    stats.bestStreak = { player: bestStreakPlayer, streak: bestStreak };

    // Calculate average response time
    let totalTime = 0;
    let totalAnswers = 0;
    Object.values(this.state.playerData).forEach((data) => {
      totalTime += data.totalTime;
      totalAnswers += data.answers.length;
    });
    stats.avgResponseTime = totalAnswers > 0 ? Math.round(totalTime / totalAnswers) : 0;

    return stats;
  }

  /**
   * Override game action handling.
   */
  protected onGameAction(player: PlayerState, action: GameAction): void {
    switch (action.type) {
      case 'select_category':
        this.handleCategorySelection(player, action.data as string);
        break;

      case 'submit_answer':
        this.handleLightningAnswerSubmission(player, action.data as { answerId: string });
        break;

      default:
        super.onGameAction(player, action);
    }
  }

  /**
   * Handle answer submission with Lightning Round scoring.
   */
  private handleLightningAnswerSubmission(player: PlayerState, data: { answerId: string }): void {
    if (this.state.phase !== 'accepting_answers') {
      this.sendToPlayer(player.id, {
        type: 'answer_rejected',
        payload: { reason: 'Not accepting answers' },
      });
      return;
    }

    if (this.state.answersThisQuestion[player.id]) {
      this.sendToPlayer(player.id, {
        type: 'answer_rejected',
        payload: { reason: 'Already answered' },
      });
      return;
    }

    const timeToAnswer = Date.now() - (this.state.questionStartTime ?? Date.now());
    this.state.answersThisQuestion[player.id] = {
      answerId: data.answerId,
      time: timeToAnswer,
    };

    this.processLightningRoundAnswer(player.id, data.answerId, timeToAnswer);

    this.sendToPlayer(player.id, {
      type: 'answer_accepted',
      payload: {
        timeToAnswer,
        streak: this.state.playerData[player.id]?.streak ?? 0,
      },
    });

    // Notify others
    this.broadcastExcept(player.id, {
      type: 'player_answered',
      payload: { playerId: player.id },
    });

    // Check if all players have answered
    if (Object.keys(this.state.answersThisQuestion).length >= this.players.size) {
      this.closeLightningAnswers();
    }
  }

  /**
   * Get current question from queue.
   */
  private getCurrentQuestion(): Question | undefined {
    const questions = this.getQuestions();
    return questions[this.state.currentQuestionIndex];
  }

  /**
   * Get all loaded questions.
   */
  private getQuestions(): Question[] {
    return (this as any).questions ?? [];
  }

  /**
   * Update Lightning Round leaderboard.
   */
  private updateLightningLeaderboard(): void {
    const entries: TriviaState['leaderboard'] = [];

    this.players.forEach((player) => {
      const data = this.state.playerData[player.id];
      if (data) {
        entries.push({
          playerId: player.id,
          username: player.username,
          score: data.score,
          rank: 0,
        });
      }
    });

    entries.sort((a, b) => b.score - a.score);
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    this.state.leaderboard = entries;
  }

  private clearCategorySelectionTimer(): void {
    if (this.categorySelectionTimer) {
      clearTimeout(this.categorySelectionTimer);
      this.categorySelectionTimer = undefined;
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Set categories manually (for testing or when not using database).
   */
  public setCategories(categories: Category[]): void {
    this.state.categories = categories;
  }
}
