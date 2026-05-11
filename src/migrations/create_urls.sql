CREATE TABLE IF NOT EXISTS create_urls (
  id SERIAL PRIMARY KEY,
  short_code varchar(10) NOT NULL UNIQUE,
  original_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_short_code ON create_urls(short_code);
