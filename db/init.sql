-- Xogos Multiplayer Server - Database Schema
-- PostgreSQL initialization script

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    display_name VARCHAR(100),
    avatar_url TEXT,
    is_guest BOOLEAN DEFAULT FALSE,
    skill_rating INTEGER DEFAULT 1000,
    total_games_played INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE
);

-- User sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    user_agent TEXT
);

-- Game types table
CREATE TABLE IF NOT EXISTS game_types (
    id SERIAL PRIMARY KEY,
    type_key VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    min_players INTEGER DEFAULT 2,
    max_players INTEGER DEFAULT 10,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default game types
INSERT INTO game_types (type_key, name, category, min_players, max_players, description) VALUES
    ('lightning_round', 'Lightning Round', 'trivia', 2, 8, 'Fast-paced trivia game with multiple rounds'),
    ('time_quest', 'TimeQuest', 'trivia', 2, 4, 'Chronological ordering trivia game'),
    ('number_munchers', 'Number Munchers', 'real_time', 1, 4, 'Math-based competitive eating game'),
    ('historical_conquest', 'Historical Conquest', 'turn_based', 2, 4, 'Historical card battle game'),
    ('panic_attack', 'Panic Attack', 'real_time', 4, 15, 'Social deduction and task completion game')
ON CONFLICT (type_key) DO NOTHING;

-- Match history table
CREATE TABLE IF NOT EXISTS matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    room_code VARCHAR(50) NOT NULL,
    game_type VARCHAR(50) NOT NULL,
    game_mode VARCHAR(50),
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    player_count INTEGER,
    winner_id UUID REFERENCES users(id),
    metadata JSONB
);

-- Match participants table
CREATE TABLE IF NOT EXISTS match_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username VARCHAR(50) NOT NULL,
    score INTEGER DEFAULT 0,
    placement INTEGER,
    is_winner BOOLEAN DEFAULT FALSE,
    stats JSONB,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP WITH TIME ZONE
);

-- Questions table (for trivia games)
CREATE TABLE IF NOT EXISTS questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    game_type VARCHAR(50) NOT NULL,
    category VARCHAR(100),
    subcategory VARCHAR(100),
    difficulty INTEGER DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
    points INTEGER DEFAULT 100,
    question_text TEXT NOT NULL,
    correct_answer_id UUID,
    time_limit INTEGER DEFAULT 15000,
    metadata JSONB,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Answers table
CREATE TABLE IF NOT EXISTS answers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0
);

-- Add foreign key for correct_answer_id after answers table exists
ALTER TABLE questions
ADD CONSTRAINT fk_correct_answer
FOREIGN KEY (correct_answer_id) REFERENCES answers(id) ON DELETE SET NULL;

-- Leaderboard view (materialized for performance)
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard AS
SELECT
    u.id,
    u.username,
    u.display_name,
    u.avatar_url,
    u.skill_rating,
    u.total_games_played,
    u.total_wins,
    CASE WHEN u.total_games_played > 0
         THEN ROUND((u.total_wins::NUMERIC / u.total_games_played) * 100, 2)
         ELSE 0
    END as win_rate,
    RANK() OVER (ORDER BY u.skill_rating DESC) as global_rank
FROM users u
WHERE u.is_guest = FALSE AND u.total_games_played > 0
ORDER BY u.skill_rating DESC;

-- Create index on leaderboard
CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_id ON leaderboard(id);

-- Function to refresh leaderboard
CREATE OR REPLACE FUNCTION refresh_leaderboard()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger to refresh leaderboard when user stats change
DROP TRIGGER IF EXISTS trigger_refresh_leaderboard ON users;
CREATE TRIGGER trigger_refresh_leaderboard
    AFTER UPDATE OF skill_rating, total_games_played, total_wins ON users
    FOR EACH STATEMENT
    EXECUTE FUNCTION refresh_leaderboard();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_skill_rating ON users(skill_rating DESC);
CREATE INDEX IF NOT EXISTS idx_matches_game_type ON matches(game_type);
CREATE INDEX IF NOT EXISTS idx_matches_started_at ON matches(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_participants_user_id ON match_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_match_participants_match_id ON match_participants(match_id);
CREATE INDEX IF NOT EXISTS idx_questions_game_type ON questions(game_type);
CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
CREATE INDEX IF NOT EXISTS idx_answers_question_id ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to relevant tables
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_questions_updated_at
    BEFORE UPDATE ON questions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions (adjust as needed for your setup)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO xogos;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO xogos;
