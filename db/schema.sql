-- FitConnect Schema (PostgreSQL for Supabase/Railway)

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    line_user_id TEXT,
    line_bind_code VARCHAR(10),
    line_bind_code_expires_at TIMESTAMPTZ,
    height INTEGER DEFAULT 0,
    weight INTEGER DEFAULT 0,
    avatar_id INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workouts Table
CREATE TABLE IF NOT EXISTS workouts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    calories INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);

-- User Totals (Optional Cache)
CREATE TABLE IF NOT EXISTS user_totals (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_calories BIGINT NOT NULL DEFAULT 0
);

-- Leaderboard Snapshots
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    total_minutes INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_date ON leaderboard_snapshots(date);

-- Email Notifications
CREATE TABLE IF NOT EXISTS email_notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ DEFAULT NULL
);

-- Achievements
CREATE TABLE IF NOT EXISTS achievements (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    unlocked_at TIMESTAMPTZ DEFAULT NOW()
);