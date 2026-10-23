-- =============================================
-- FitConnect PostgreSQL Schema
-- =============================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    avatar_id INTEGER NOT NULL DEFAULT 1,
    email_verified_at TIMESTAMPTZ,
    auth_version INTEGER NOT NULL DEFAULT 1,

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
    weight_kg NUMERIC(5,1),
    revision INTEGER NOT NULL DEFAULT 1,
    request_key VARCHAR(64),

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
-- Account verification and migration metadata
-- =============================================

-- Existing databases must still apply db/migrate.php; CREATE TABLE does not add columns.
CREATE TABLE IF NOT EXISTS account_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('verify', 'reset')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_rate_limits (
    key_hash CHAR(64) PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 1,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_account_tokens_user ON account_tokens(user_id, purpose, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique ON users(LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_line_user_id_unique ON users(line_user_id) WHERE line_user_id IS NOT NULL;

-- The upgrade runner also reads this file before upgrading older workouts tables.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'workouts' AND column_name = 'request_key') THEN
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_request_key ON workouts(user_id, request_key) WHERE request_key IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_line_bind_code ON users(line_bind_code);

CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts(user_id, date);

CREATE INDEX IF NOT EXISTS idx_leaderboard_date ON leaderboard_snapshots(date);

CREATE INDEX IF NOT EXISTS idx_email_notifications_user_id ON email_notifications(user_id);
