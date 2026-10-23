ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5,1);
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS request_key VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_request_key ON workouts(user_id, request_key) WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique ON users(LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_line_user_id_unique ON users(line_user_id) WHERE line_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('verify', 'reset')),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_account_tokens_user ON account_tokens(user_id, purpose, created_at);
CREATE TABLE IF NOT EXISTS account_rate_limits (
    key_hash CHAR(64) PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 1,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO user_totals (user_id, total_calories)
SELECT u.id, COALESCE(SUM(w.calories), 0)::BIGINT
FROM users u LEFT JOIN workouts w ON w.user_id = u.id GROUP BY u.id
ON CONFLICT (user_id) DO UPDATE SET total_calories = EXCLUDED.total_calories;
