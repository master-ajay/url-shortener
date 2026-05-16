CREATE TABLE IF NOT EXISTS short_urls (
  id SERIAL PRIMARY KEY,
  short_code varchar(10) NOT NULL UNIQUE,
  original_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS short_urls_short_code_idx ON short_urls(short_code);
