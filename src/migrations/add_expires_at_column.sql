-- Add expiration timestamp to URLs (default: 30 days from creation)
ALTER TABLE short_urls ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP DEFAULT (NOW()+ INTERVAL '30 days')

