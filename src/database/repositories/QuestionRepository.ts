/**
 * Game On Dude! - Question Repository
 * www.gameonguy.com
 *
 * Database operations for trivia questions.
 */

import { DatabaseService } from '../DatabaseService';
import logger from '../../core/Logger';

export interface Question {
  id: string;
  game_type: string;
  category: string | null;
  subcategory: string | null;
  difficulty: number;
  points: number;
  question_text: string;
  correct_answer_id: string | null;
  time_limit: number;
  metadata: Record<string, unknown> | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Answer {
  id: string;
  question_id: string;
  answer_text: string;
  is_correct: boolean;
  display_order: number;
}

export interface QuestionWithAnswers extends Question {
  answers: Answer[];
}

export interface CreateQuestionDTO {
  game_type: string;
  category?: string;
  subcategory?: string;
  difficulty?: number;
  points?: number;
  question_text: string;
  time_limit?: number;
  metadata?: Record<string, unknown>;
  answers: CreateAnswerDTO[];
}

export interface CreateAnswerDTO {
  answer_text: string;
  is_correct: boolean;
  display_order?: number;
}

export interface QuestionFilters {
  game_type?: string;
  category?: string;
  subcategory?: string;
  difficulty?: number;
  min_difficulty?: number;
  max_difficulty?: number;
  exclude_ids?: string[];
}

export class QuestionRepository {
  private readonly log = logger.child({ component: 'QuestionRepository' });

  constructor(private db: DatabaseService) {}

  /**
   * Find question by ID.
   */
  async findById(id: string): Promise<Question | null> {
    return this.db.queryOne<Question>('SELECT * FROM questions WHERE id = $1', [id]);
  }

  /**
   * Find question with answers.
   */
  async findByIdWithAnswers(id: string): Promise<QuestionWithAnswers | null> {
    const question = await this.findById(id);
    if (!question) return null;

    const answers = await this.db.query<Answer>(
      'SELECT * FROM answers WHERE question_id = $1 ORDER BY display_order ASC',
      [id]
    );

    return { ...question, answers };
  }

  /**
   * Get questions by game type.
   */
  async getByGameType(gameType: string, count: number = 10): Promise<QuestionWithAnswers[]> {
    const questions = await this.db.query<Question>(
      `SELECT * FROM questions
       WHERE game_type = $1 AND is_active = TRUE
       ORDER BY RANDOM()
       LIMIT $2`,
      [gameType, count]
    );

    return this.attachAnswers(questions);
  }

  /**
   * Get questions by category.
   */
  async getByCategory(category: string, count: number = 10): Promise<QuestionWithAnswers[]> {
    const questions = await this.db.query<Question>(
      `SELECT * FROM questions
       WHERE category = $1 AND is_active = TRUE
       ORDER BY RANDOM()
       LIMIT $2`,
      [category, count]
    );

    return this.attachAnswers(questions);
  }

  /**
   * Get random questions with filters.
   */
  async getRandom(filters: QuestionFilters, count: number = 10): Promise<QuestionWithAnswers[]> {
    const conditions: string[] = ['is_active = TRUE'];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.game_type) {
      conditions.push(`game_type = $${paramIndex++}`);
      params.push(filters.game_type);
    }

    if (filters.category) {
      conditions.push(`category = $${paramIndex++}`);
      params.push(filters.category);
    }

    if (filters.subcategory) {
      conditions.push(`subcategory = $${paramIndex++}`);
      params.push(filters.subcategory);
    }

    if (filters.difficulty) {
      conditions.push(`difficulty = $${paramIndex++}`);
      params.push(filters.difficulty);
    }

    if (filters.min_difficulty) {
      conditions.push(`difficulty >= $${paramIndex++}`);
      params.push(filters.min_difficulty);
    }

    if (filters.max_difficulty) {
      conditions.push(`difficulty <= $${paramIndex++}`);
      params.push(filters.max_difficulty);
    }

    if (filters.exclude_ids && filters.exclude_ids.length > 0) {
      conditions.push(`id NOT IN (${filters.exclude_ids.map(() => `$${paramIndex++}`).join(', ')})`);
      params.push(...filters.exclude_ids);
    }

    params.push(count);

    const query = `
      SELECT * FROM questions
      WHERE ${conditions.join(' AND ')}
      ORDER BY RANDOM()
      LIMIT $${paramIndex}
    `;

    const questions = await this.db.query<Question>(query, params);
    return this.attachAnswers(questions);
  }

  /**
   * Get categories for a game type.
   */
  async getCategories(gameType: string): Promise<string[]> {
    const result = await this.db.query<{ category: string }>(
      `SELECT DISTINCT category FROM questions
       WHERE game_type = $1 AND category IS NOT NULL AND is_active = TRUE
       ORDER BY category`,
      [gameType]
    );
    return result.map((r) => r.category);
  }

  /**
   * Get subcategories for a category.
   */
  async getSubcategories(category: string): Promise<string[]> {
    const result = await this.db.query<{ subcategory: string }>(
      `SELECT DISTINCT subcategory FROM questions
       WHERE category = $1 AND subcategory IS NOT NULL AND is_active = TRUE
       ORDER BY subcategory`,
      [category]
    );
    return result.map((r) => r.subcategory);
  }

  /**
   * Create a new question with answers.
   */
  async create(data: CreateQuestionDTO): Promise<QuestionWithAnswers> {
    return this.db.transaction(async (client) => {
      // Create question
      const questionQuery = `
        INSERT INTO questions (game_type, category, subcategory, difficulty, points, question_text, time_limit, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;

      const questionResult = await client.query<Question>(questionQuery, [
        data.game_type,
        data.category ?? null,
        data.subcategory ?? null,
        data.difficulty ?? 1,
        data.points ?? 100,
        data.question_text,
        data.time_limit ?? 15000,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]);

      const question = questionResult.rows[0];
      const answers: Answer[] = [];

      // Create answers
      let correctAnswerId: string | null = null;
      for (let i = 0; i < data.answers.length; i++) {
        const answer = data.answers[i];
        const answerQuery = `
          INSERT INTO answers (question_id, answer_text, is_correct, display_order)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `;

        const answerResult = await client.query<Answer>(answerQuery, [
          question.id,
          answer.answer_text,
          answer.is_correct,
          answer.display_order ?? i,
        ]);

        answers.push(answerResult.rows[0]);

        if (answer.is_correct) {
          correctAnswerId = answerResult.rows[0].id;
        }
      }

      // Update question with correct answer ID
      if (correctAnswerId) {
        await client.query('UPDATE questions SET correct_answer_id = $1 WHERE id = $2', [
          correctAnswerId,
          question.id,
        ]);
        question.correct_answer_id = correctAnswerId;
      }

      this.log.info({ questionId: question.id, category: data.category }, 'Question created');
      return { ...question, answers };
    });
  }

  /**
   * Bulk create questions.
   */
  async bulkCreate(questions: CreateQuestionDTO[]): Promise<number> {
    let created = 0;
    for (const question of questions) {
      try {
        await this.create(question);
        created++;
      } catch (error) {
        this.log.error({ error, question: question.question_text }, 'Failed to create question');
      }
    }
    this.log.info({ created, total: questions.length }, 'Bulk question creation complete');
    return created;
  }

  /**
   * Update a question.
   */
  async update(
    id: string,
    data: Partial<Omit<CreateQuestionDTO, 'answers'>>
  ): Promise<Question | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, keyof typeof data> = {
      game_type: 'game_type',
      category: 'category',
      subcategory: 'subcategory',
      difficulty: 'difficulty',
      points: 'points',
      question_text: 'question_text',
      time_limit: 'time_limit',
      metadata: 'metadata',
    };

    for (const [column, key] of Object.entries(fieldMap)) {
      if (data[key] !== undefined) {
        fields.push(`${column} = $${paramIndex++}`);
        values.push(column === 'metadata' ? JSON.stringify(data[key]) : data[key]);
      }
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const query = `UPDATE questions SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await this.db.query<Question>(query, values);
    return result[0] ?? null;
  }

  /**
   * Deactivate a question.
   */
  async deactivate(id: string): Promise<boolean> {
    const affected = await this.db.execute('UPDATE questions SET is_active = FALSE WHERE id = $1', [id]);
    return affected > 0;
  }

  /**
   * Delete a question and its answers.
   */
  async delete(id: string): Promise<boolean> {
    const affected = await this.db.execute('DELETE FROM questions WHERE id = $1', [id]);
    return affected > 0;
  }

  /**
   * Count questions.
   */
  async count(filters?: QuestionFilters): Promise<number> {
    const conditions: string[] = ['is_active = TRUE'];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.game_type) {
      conditions.push(`game_type = $${paramIndex++}`);
      params.push(filters.game_type);
    }

    if (filters?.category) {
      conditions.push(`category = $${paramIndex++}`);
      params.push(filters.category);
    }

    const query = `SELECT COUNT(*) FROM questions WHERE ${conditions.join(' AND ')}`;
    const result = await this.db.queryOne<{ count: string }>(query, params);
    return parseInt(result?.count ?? '0');
  }

  /**
   * Attach answers to questions.
   */
  private async attachAnswers(questions: Question[]): Promise<QuestionWithAnswers[]> {
    if (questions.length === 0) return [];

    const questionIds = questions.map((q) => q.id);
    const placeholders = questionIds.map((_, i) => `$${i + 1}`).join(', ');

    const answers = await this.db.query<Answer>(
      `SELECT * FROM answers WHERE question_id IN (${placeholders}) ORDER BY display_order ASC`,
      questionIds
    );

    const answersByQuestion = new Map<string, Answer[]>();
    for (const answer of answers) {
      const existing = answersByQuestion.get(answer.question_id) ?? [];
      existing.push(answer);
      answersByQuestion.set(answer.question_id, existing);
    }

    return questions.map((q) => ({
      ...q,
      answers: answersByQuestion.get(q.id) ?? [],
    }));
  }
}
