/**
 * Game On Dude! - Trivia Game Room
 * www.gameonguy.com
 *
 * Base room for trivia-style games like Lightning Round and TimeQuest.
 * Supports timed questions, scoring, and rounds.
 */

import { Room, RoomConstructorOptions } from '../rooms/Room';
import { PlayerState, GameAction, MessageType } from '../core/types';
import { Client } from '../core/Client';

// ============================================================================
// Types
// ============================================================================

export interface Question {
  id: string;
  text: string;
  category?: string;
  subcategory?: string;
  difficulty?: number;
  points: number;
  answers: Answer[];
  correctAnswerId: string;
  timeLimit?: number; // Override default time limit
  metadata?: Record<string, unknown>;
}

export interface Answer {
  id: string;
  text: string;
}

export interface PlayerTriviaData {
  score: number;
  correctAnswers: number;
  wrongAnswers: number;
  streak: number;
  bestStreak: number;
  totalTime: number;
  answers: PlayerAnswer[];
}

export interface PlayerAnswer {
  questionId: string;
  answerId?: string;
  isCorrect: boolean;
  timeToAnswer: number;
  pointsEarned: number;
}

export interface TriviaState {
  phase: 'waiting' | 'showing_question' | 'accepting_answers' | 'showing_results' | 'round_end' | 'game_end';
  currentRound: number;
  totalRounds: number;
  currentQuestionIndex: number;
  questionsPerRound: number;
  currentQuestion?: Question;
  questionStartTime?: number;
  timeRemaining: number;
  playerData: Record<string, PlayerTriviaData>;
  answersThisQuestion: Record<string, { answerId: string; time: number }>;
  leaderboard: LeaderboardEntry[];
}

export interface LeaderboardEntry {
  playerId: string;
  username: string;
  score: number;
  rank: number;
}

export interface TriviaRoomOptions extends RoomConstructorOptions {
  questions?: Question[];
  questionsPerRound?: number;
  totalRounds?: number;
  questionTimeLimit?: number;
  resultsDisplayTime?: number;
  bonusTimeEnabled?: boolean;
  bonusTimeAmount?: number;
}

// ============================================================================
// Trivia Room Implementation
// ============================================================================

export class TriviaRoom extends Room<TriviaState> {
  private questions: Question[] = [];
  private currentQuestionPool: Question[] = [];
  private questionTimeLimit: number;
  private resultsDisplayTime: number;
  private bonusTimeEnabled: boolean;
  private bonusTimeAmount: number;
  private phaseTimer?: NodeJS.Timeout;

  constructor(gameType: string, options: TriviaRoomOptions = {}) {
    super(gameType, {
      ...options,
      tickRate: options.tickRate ?? 2, // Low tick rate for trivia
    });

    this.questions = options.questions ?? [];
    this.questionTimeLimit = options.questionTimeLimit ?? 15000; // 15 seconds
    this.resultsDisplayTime = options.resultsDisplayTime ?? 3000; // 3 seconds
    this.bonusTimeEnabled = options.bonusTimeEnabled ?? true;
    this.bonusTimeAmount = options.bonusTimeAmount ?? 2000; // 2 seconds bonus
  }

  protected initializeState(): TriviaState {
    return {
      phase: 'waiting',
      currentRound: 1,
      totalRounds: 2,
      currentQuestionIndex: 0,
      questionsPerRound: 9, // 3 categories x 3 questions
      timeRemaining: 0,
      playerData: {},
      answersThisQuestion: {},
      leaderboard: [],
    };
  }

  protected onPlayerJoin(player: PlayerState): void {
    // Initialize player trivia data
    this.state.playerData[player.id] = {
      score: 0,
      correctAnswers: 0,
      wrongAnswers: 0,
      streak: 0,
      bestStreak: 0,
      totalTime: 0,
      answers: [],
    };
    this.updateLeaderboard();
  }

  protected onPlayerLeave(player: PlayerState): void {
    // Keep player data for final results, just mark as disconnected
    // The base Room class handles the disconnection
  }

  protected onGameStart(): void {
    this.log.info('Trivia game starting');
    this.shuffleQuestions();
    this.startRound();
  }

  protected onGameEnd(): unknown {
    this.clearPhaseTimer();
    this.updateLeaderboard();

    return {
      finalLeaderboard: this.state.leaderboard,
      playerData: this.state.playerData,
      totalRounds: this.state.totalRounds,
    };
  }

  protected onTick(deltaTime: number): void {
    // Update time remaining
    if (this.state.questionStartTime && this.state.phase === 'accepting_answers') {
      const elapsed = Date.now() - this.state.questionStartTime;
      this.state.timeRemaining = Math.max(0, this.questionTimeLimit - elapsed);
    }
  }

  protected onGameAction(player: PlayerState, action: GameAction): void {
    switch (action.type) {
      case 'submit_answer':
        this.handleAnswerSubmission(player, action.data as { answerId: string });
        break;

      case 'select_question':
        this.handleQuestionSelection(player, action.data as { questionId: string });
        break;

      default:
        this.log.warn({ actionType: action.type }, 'Unknown game action');
    }
  }

  // ============================================================================
  // Game Flow
  // ============================================================================

  private startRound(): void {
    this.log.info({ round: this.state.currentRound }, 'Starting round');

    // Prepare questions for this round
    this.currentQuestionPool = this.getQuestionsForRound(this.state.currentRound);
    this.state.currentQuestionIndex = 0;

    this.broadcast({
      type: 'round_start',
      payload: {
        round: this.state.currentRound,
        totalRounds: this.state.totalRounds,
        questionsAvailable: this.currentQuestionPool.length,
      },
    });

    // Start first question
    this.showNextQuestion();
  }

  private showNextQuestion(): void {
    if (this.state.currentQuestionIndex >= this.currentQuestionPool.length) {
      this.endRound();
      return;
    }

    const question = this.currentQuestionPool[this.state.currentQuestionIndex];
    this.state.currentQuestion = question;
    this.state.phase = 'showing_question';
    this.state.answersThisQuestion = {};

    // Send question to all players (without correct answer)
    this.broadcast({
      type: 'question',
      payload: {
        questionIndex: this.state.currentQuestionIndex + 1,
        totalQuestions: this.currentQuestionPool.length,
        question: {
          id: question.id,
          text: question.text,
          category: question.category,
          points: question.points,
          answers: question.answers,
          timeLimit: question.timeLimit ?? this.questionTimeLimit,
        },
      },
    });

    // Brief delay before accepting answers
    this.setPhaseTimer(() => {
      this.startAcceptingAnswers();
    }, 500);
  }

  private startAcceptingAnswers(): void {
    this.state.phase = 'accepting_answers';
    this.state.questionStartTime = Date.now();
    this.state.timeRemaining = this.questionTimeLimit;

    this.broadcast({
      type: 'answers_open',
      payload: { timeLimit: this.questionTimeLimit },
    });

    // Set timer for when answers close
    this.setPhaseTimer(() => {
      this.closeAnswers();
    }, this.questionTimeLimit);
  }

  private closeAnswers(): void {
    this.state.phase = 'showing_results';

    // Process unanswered players
    this.players.forEach((player) => {
      if (!this.state.answersThisQuestion[player.id]) {
        this.processAnswer(player.id, undefined, this.questionTimeLimit);
      }
    });

    // Calculate results
    const results = this.calculateQuestionResults();

    this.broadcast({
      type: 'question_results',
      payload: {
        correctAnswerId: this.state.currentQuestion!.correctAnswerId,
        results,
        leaderboard: this.state.leaderboard,
      },
    });

    // Show results then move to next question
    this.setPhaseTimer(() => {
      this.state.currentQuestionIndex++;
      this.showNextQuestion();
    }, this.resultsDisplayTime);
  }

  private endRound(): void {
    this.state.phase = 'round_end';
    this.updateLeaderboard();

    this.broadcast({
      type: 'round_end',
      payload: {
        round: this.state.currentRound,
        leaderboard: this.state.leaderboard,
      },
    });

    if (this.state.currentRound >= this.state.totalRounds) {
      // Game over
      this.setPhaseTimer(() => {
        this.state.phase = 'game_end';
        this.endGame();
      }, 3000);
    } else {
      // Next round
      this.setPhaseTimer(() => {
        this.state.currentRound++;
        this.startRound();
      }, 5000);
    }
  }

  // ============================================================================
  // Answer Handling
  // ============================================================================

  private handleAnswerSubmission(player: PlayerState, data: { answerId: string }): void {
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

    this.processAnswer(player.id, data.answerId, timeToAnswer);

    this.sendToPlayer(player.id, {
      type: 'answer_accepted',
      payload: { timeToAnswer },
    });

    // Notify others that player has answered (without revealing answer)
    this.broadcastExcept(player.id, {
      type: 'player_answered',
      payload: { playerId: player.id },
    });

    // Check if all players have answered
    if (Object.keys(this.state.answersThisQuestion).length >= this.players.size) {
      this.clearPhaseTimer();
      this.closeAnswers();
    }
  }

  private processAnswer(playerId: string, answerId: string | undefined, timeToAnswer: number): void {
    const playerData = this.state.playerData[playerId];
    if (!playerData) return;

    const question = this.state.currentQuestion!;
    const isCorrect = answerId === question.correctAnswerId;

    let pointsEarned = 0;
    if (isCorrect) {
      // Base points + time bonus
      pointsEarned = question.points;

      if (this.bonusTimeEnabled) {
        const timeBonus = Math.floor(
          (1 - timeToAnswer / this.questionTimeLimit) * question.points * 0.5
        );
        pointsEarned += Math.max(0, timeBonus);
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

    this.updateLeaderboard();
  }

  private handleQuestionSelection(player: PlayerState, data: { questionId: string }): void {
    // For games where players select questions (like Lightning Round)
    const question = this.currentQuestionPool.find((q) => q.id === data.questionId);

    if (!question) {
      this.sendToPlayer(player.id, {
        type: 'selection_rejected',
        payload: { reason: 'Question not found' },
      });
      return;
    }

    // Remove from pool and show
    this.currentQuestionPool = this.currentQuestionPool.filter((q) => q.id !== data.questionId);
    this.state.currentQuestion = question;

    this.broadcast({
      type: 'question_selected',
      payload: {
        selectedBy: player.id,
        question: {
          id: question.id,
          text: question.text,
          category: question.category,
          points: question.points,
          answers: question.answers,
        },
      },
    });

    this.startAcceptingAnswers();
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private calculateQuestionResults(): Record<string, { isCorrect: boolean; points: number }> {
    const results: Record<string, { isCorrect: boolean; points: number }> = {};

    Object.entries(this.state.answersThisQuestion).forEach(([playerId, answer]) => {
      const playerData = this.state.playerData[playerId];
      const lastAnswer = playerData?.answers[playerData.answers.length - 1];

      results[playerId] = {
        isCorrect: lastAnswer?.isCorrect ?? false,
        points: lastAnswer?.pointsEarned ?? 0,
      };
    });

    return results;
  }

  private updateLeaderboard(): void {
    const entries: LeaderboardEntry[] = [];

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

    // Sort by score descending
    entries.sort((a, b) => b.score - a.score);

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    this.state.leaderboard = entries;
  }

  private shuffleQuestions(): void {
    // Fisher-Yates shuffle
    for (let i = this.questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.questions[i], this.questions[j]] = [this.questions[j], this.questions[i]];
    }
  }

  private getQuestionsForRound(round: number): Question[] {
    const startIndex = (round - 1) * this.state.questionsPerRound;
    return this.questions.slice(startIndex, startIndex + this.state.questionsPerRound);
  }

  private setPhaseTimer(callback: () => void, delay: number): void {
    this.clearPhaseTimer();
    this.phaseTimer = setTimeout(callback, delay);
  }

  private clearPhaseTimer(): void {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = undefined;
    }
  }

  // ============================================================================
  // Public API for loading questions
  // ============================================================================

  public setQuestions(questions: Question[]): void {
    this.questions = questions;
  }

  public addQuestions(questions: Question[]): void {
    this.questions.push(...questions);
  }
}
