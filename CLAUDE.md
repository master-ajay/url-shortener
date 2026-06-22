# CLAUDE.md — URL Shortener Development Guide

**Status:** Stage 2 Complete ✅  
**Read first:** `ROADMAP.md` (design decisions, trade-offs, interview concepts)

---

## Quick Start

```bash
npm run dev      # Development (nodemon)
npm start        # Production
npm test         # Run tests
npx jest <path>  # Single test file
```

**Setup:** PostgreSQL must be running. Apply migrations:
```bash
psql $PG_CONNECTION_STRING -f src/migrations/create_urls.sql
psql $PG_CONNECTION_STRING -f src/migrations/add_clicks_column.sql
psql $PG_CONNECTION_STRING -f src/migrations/add_expires_at_column.sql
```

**Required `.env`:**
```
PORT=3000
BASE_URL=http://localhost:3000
PG_CONNECTION_STRING=postgresql://user@localhost:5432/url_shortener
CORS_ORIGIN=*
LOG_LEVEL=info
NODE_ENV=development
```

---

## Core Pattern: Request Lifecycle

**Middleware chain** (in `src/app.js`):
1. `requestId` → Attach UUID to `req.id`
2. `requestContext.run()` → Store `req.id` in AsyncLocalStorage
3. `httpLogger` → Log HTTP request/response with correlation
4. `rateLimiter` → 100 req/15 min (bypass with `NODE_ENV=test`)
5. CORS, body parsers
6. Routes → Controller → Service → DB
7. `errorHandler` → Catch and format errors

---

## Adding a Feature (4 Steps)

1. **Validator** (`src/validators/url.validator.js`): Zod schema for request + response
2. **Route** (`src/routes/url.routes.js`): `router.post(..., validate(schema), controller)`
3. **Controller** (`src/controllers/url.controller.js`): Extract params, call service, format response
4. **Service** (`src/services/url.service.js`): Business logic, DB queries

**Error pattern:**
- Throw `new ApiError(status, message)` in service/controller
- Wrap controller with `asyncHandler` (catches async errors)
- `errorHandler` middleware formats the response

---

## Database Schema

**Table:** `short_urls`
| Column | Type | Notes |
|--------|------|-------|
| `short_code` | VARCHAR(10) UNIQUE | Indexed; collision retry 10x |
| `original_url` | TEXT | Validated with Zod |
| `created_at` | TIMESTAMP | Auto-set |
| `clicks` | INT DEFAULT 0 | Atomic `RETURNING clicks` |
| `expires_at` | TIMESTAMP | Default NOW() + 30 days |

**Queries use raw SQL** (no ORM). DB connection via `pg.Pool` (Stage 1 fixed from `pg.Client`).

---

## Logging & Observability

**Pino logger** (`src/lib/logger.js`):
- Use `getContextLogger()` in all services (auto-injects `reqId`)
- Development: Pretty-printed via `pino-pretty`
- Production: Raw JSON

**Request correlation:**
- Every request has unique `req.id` (UUID)
- Stored in AsyncLocalStorage via `requestContext`
- All logs include `reqId` field automatically
- Trace single request end-to-end

---

## Testing (SDE2 Standard)

**Organization:**
- `src/__tests__/unit/` — Pure functions (no I/O)
- `src/__tests__/integration/` — Route + service + mocked DB

**Rules:**
- **Test pyramid:** Unit-test logic, integration-test wiring
- **Mock boundaries:** DB boundary (`src/config/__mocks__/db.js`), never mock internal code
- **Test contracts:** Assert response status/shape (Zod matches), not implementation
- **One behavior per test** — Use Arrange-Act-Assert
- **Minimum coverage per route:**
  - Happy path (correct status + shape)
  - Each validation error (400)
  - Each domain error (404, 409, 410, etc.)
  - Side effects (retry, rate limit, expiry)

Run `npm test` before PR.

---

## Current Architecture (Stage 2)

### Endpoints

**POST /shorten**
- Input: `{ url, custom_code? }`
- Output: `{ code, short_url }`
- Error: 400 (invalid URL/code), 409 (code taken)

**GET /:code**
- Redirect: 301 to original URL
- Error: 404 (not found), 410 (expired)
- Side effect: Atomic increment `clicks`

**GET /stats/:code**
- Output: `{ code, original_url, clicks, created_at, expires_at, is_expired }`
- Error: 404 (not found)

### Features Completed

| Feature | Status | File |
|---------|--------|------|
| Request correlation | ✅ | `src/config/asyncContext.js` |
| Structured logging | ✅ | `src/utils/contextLogger.js` |
| Click counter | ✅ | `src/services/url.service.js` |
| URL expiry (TTL) | ✅ | 410 Gone on expired |
| Custom codes | ✅ | Zod validation + collision check |
| Stress tested | ✅ | 6K req/sec, p99=27ms |

---

## Known Constraints

- **Rate limiter:** 100 req/15 min (becomes bottleneck before DB at 6K+/sec)
- **TTL enforcement:** Lazy (check on read, not background cleanup)
- **Custom code validation:** Must add denylist (reserved: admin, api, health, stats, etc.)
- **Sync click increment:** Hot-row contention at 1K+ RPS → fixed in Stage 3 with Redis

---

## Next: Stage 3 (Redis Cache)

**Goal:** p99 < 5ms, 10K+ req/sec  
**Solution:** Cache-aside pattern for redirects  
**Trade-off:** Eventual consistency (TTL 5-60 min)

See `ROADMAP.md` for full Stage 3 design.

---

## Style Conventions

- No comments unless WHY is non-obvious
- Error messages: lowercase, 50 chars max
- Database: Raw SQL with parameterized queries (no ORM)
- Logging: Structured fields, not string interpolation
- Schema validation: Input (request) + Output (response) in Zod
- Tests: 1 behavior per `it()`, Arrange-Act-Assert

---

**Last updated:** 2026-06-22 (Stage 2 completion)
