-- Add clicks column to track how may times URL was accessed
ALTER TABLE short_urls ADD COLUMN IF NOT EXISTS clicks INT DEFAULT 0;

-- Add created_at column to track when the URL was shortened
ALTER TABLE short_urls ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
