BEGIN;
ALTER TABLE provider_market_items ADD COLUMN IF NOT EXISTS review_status text;
ALTER TABLE provider_market_items ADD COLUMN IF NOT EXISTS review_reason text NOT NULL DEFAULT '';
ALTER TABLE provider_market_items ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE provider_market_items ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE provider_market_items ADD COLUMN IF NOT EXISTS marketing_badge jsonb;
-- Legacy community entries must be reviewed before they are publicly visible again.
UPDATE provider_market_items SET review_status = CASE
    WHEN official THEN 'approved' WHEN published THEN 'pending' ELSE 'draft' END
WHERE review_status IS NULL;
ALTER TABLE provider_market_items ALTER COLUMN review_status SET DEFAULT 'pending';
ALTER TABLE provider_market_items ALTER COLUMN review_status SET NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_market_review_status'
        AND conrelid = 'provider_market_items'::regclass) THEN
        ALTER TABLE provider_market_items ADD CONSTRAINT provider_market_review_status
            CHECK (review_status IN ('draft', 'pending', 'approved', 'rejected'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS provider_market_review ON provider_market_items(review_status, published);
COMMIT;
