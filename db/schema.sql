-- =============================================
-- FitConnect PostgreSQL Schema
-- =============================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    avatar_id INTEGER NOT NULL DEFAULT 1,

    line_user_id TEXT UNIQUE,
    line_bind_code VARCHAR(10),
    line_bind_code_expires_at TIMESTAMPTZ,

    height NUMERIC(5,1),
    weight NUMERIC(5,1),

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workouts (
    id BIGSERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    date TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    calories INTEGER NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_totals (
    user_id INTEGER PRIMARY KEY
        REFERENCES users(id)
        ON DELETE CASCADE,

    total_calories BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id BIGSERIAL PRIMARY KEY,

    date DATE NOT NULL,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    rank INTEGER NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_notifications (
    id BIGSERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    type VARCHAR(50) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS achievements (
    id BIGSERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    type VARCHAR(50) NOT NULL,

    unlocked_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, type)
);

-- =============================================
-- Indexes
-- =============================================

CREATE INDEX IF NOT EXISTS idx_users_line_bind_code ON users(line_bind_code);

CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);

CREATE INDEX IF NOT EXISTS idx_leaderboard_date ON leaderboard_snapshots(date);

CREATE INDEX IF NOT EXISTS idx_email_notifications_user_id ON email_notifications(user_id);