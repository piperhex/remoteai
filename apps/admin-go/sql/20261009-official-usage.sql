BEGIN;
CREATE TABLE IF NOT EXISTS official_usage_devices (
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id text NOT NULL,
    device_name text NOT NULL,
    reported_at bigint NOT NULL,
    PRIMARY KEY(owner_id, device_id)
);
CREATE TABLE IF NOT EXISTS official_usage_accounts (
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id text NOT NULL,
    label text NOT NULL,
    PRIMARY KEY(owner_id, account_id)
);
CREATE TABLE IF NOT EXISTS official_usage_minutes (
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id text NOT NULL,
    account_id text NOT NULL,
    minute_ts bigint NOT NULL,
    samples jsonb NOT NULL,
    total_tokens bigint NOT NULL,
    cost_usd double precision NOT NULL,
    PRIMARY KEY(owner_id, device_id, account_id, minute_ts)
);
CREATE INDEX IF NOT EXISTS official_usage_minutes_range ON official_usage_minutes(owner_id, account_id, minute_ts);
CREATE TABLE IF NOT EXISTS official_quota_observations (
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id text NOT NULL,
    device_id text NOT NULL,
    ts bigint NOT NULL,
    primary_remaining double precision,
    secondary_remaining double precision,
    primary_reset bigint,
    secondary_reset bigint,
    PRIMARY KEY(owner_id, account_id, device_id, ts)
);
CREATE TABLE IF NOT EXISTS official_quota_declines (
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id text NOT NULL,
    quota_window text NOT NULL CHECK(quota_window IN ('primary', 'secondary')),
    start_ts bigint NOT NULL,
    end_ts bigint NOT NULL,
    start_remaining double precision,
    remaining double precision,
    reset_at bigint,
    decline_percent double precision NOT NULL,
    consumed_usd double precision NOT NULL,
    after_usd double precision NOT NULL,
    is_current boolean NOT NULL DEFAULT true,
    PRIMARY KEY(owner_id, account_id, quota_window, start_ts)
);
CREATE INDEX IF NOT EXISTS official_quota_observations_range
    ON official_quota_observations(owner_id, account_id, ts);
CREATE UNIQUE INDEX IF NOT EXISTS official_quota_declines_current
    ON official_quota_declines(owner_id, account_id, quota_window) WHERE is_current;

COMMIT;
