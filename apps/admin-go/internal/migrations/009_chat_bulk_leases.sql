CREATE TABLE IF NOT EXISTS chat_relay_bulk_leases (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id text NOT NULL,
    writer_id uuid NOT NULL,
    fencing_epoch text NOT NULL,
    hour_start timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    bytes bigint NOT NULL CHECK (bytes > 0 AND bytes <= 1048576),
    reserved bigint NOT NULL CHECK (reserved >= 0 AND reserved <= bytes),
    sent bigint NOT NULL DEFAULT 0 CHECK (sent >= 0 AND sent <= bytes),
    state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved','writing','uncertain','closed')),
    CHECK (sent + reserved <= bytes)
);
-- Preserve whether an expired writer ever had authority and whether its final receipt was committed.
ALTER TABLE chat_relay_bulk_leases
    ADD COLUMN IF NOT EXISTS claimed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reported boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS chat_relay_bulk_leases_pending
    ON chat_relay_bulk_leases (user_id, hour_start) WHERE state <> 'closed';
CREATE INDEX IF NOT EXISTS chat_relay_bulk_leases_expiry
    ON chat_relay_bulk_leases (expires_at) WHERE state IN ('reserved','writing');
