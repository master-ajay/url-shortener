# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is a **learning project** being built in stages toward a production-grade URL shortener. Do not over-engineer features or add infrastructure beyond the current stage. Implement only what is asked — the complexity is added deliberately, stage by stage.

## Commands

```bash
npm run dev        # Start with nodemon (development)
npm start          # Start without nodemon (production)
npm test           # Run Jest tests
npx jest <path>    # Run a single test file
```

The app requires a running PostgreSQL instance. Apply the schema before starting:

```bash
psql $PG_CONNECTION_STRING -f src/migrations/create_urls.sql
```

## Environment Variables

Required in `.env`:

| Variable | Purpose |
|---|---|
| `PORT` | HTTP server port (default: 3000) |
| `BASE_URL` | Used to construct `short_url` in the shorten response |
| `PG_CONNECTION_STRING` | PostgreSQL connection string |
| `CORS_ORIGIN` | Allowed CORS origin |
| `LOG_LEVEL` | Pino log level (default: `info`) |
| `NODE_ENV` | `development` enables `pino-pretty` transport |

## Architecture

### Request Lifecycle

Every request flows through this middleware chain (in order, defined in `src/app.js`):

1. `requestId` — attaches a UUID (`req.id`) used for log correlation
2. `httpLogger` (pino-http) — logs request/response using `req.id`
3. `rateLimiter` — 100 req / 15 min global limit
4. CORS, body parsers
5. Route handlers → controller → service → PostgreSQL
6. `errorHandler` — catches anything thrown or passed to `next(err)`

### Adding a New Route

Follow this chain — every step is required:

1. Add a Zod schema to `src/validators/url.validator.js`
2. Register the route in `src/routes/url.routes.js` with `validate(schema)` middleware
3. Write the controller in `src/controllers/url.controller.js` — wrap with `asyncHandler`, throw `ApiError` for errors
4. Put DB logic in `src/services/url.service.js` — raw `db.query()`, no ORM

### Error Handling Pattern

Controllers never call `res.status(...).json(...)` for errors:

- Throw `new ApiError(statusCode, message)` for known errors
- Wrap every controller with `asyncHandler` (`src/utils/asynchandler.js`) to forward async errors to `next(err)`
- `errorHandler` middleware (`src/middleware/errorHandler.js`) sends the final JSON error response

Validation failures (Zod) return `400` directly from the `validate` middleware and do **not** go through `errorHandler`.

### Validation

Zod schemas in `src/validators/url.validator.js` cover request input and response shape. The `validate(schema)` middleware parses `{ body, params, query }` before the handler runs. Response shape is also validated with Zod inside the controller before `res.json()`.

### Database

`src/config/db.js` exports a `pg.Pool`. The service layer calls `db.query()` directly.

The only table is `short_urls` (schema in `src/migrations/create_short_urls.sql`):

- `short_code varchar(10) UNIQUE` — indexed via `idx_short_code`
- On `unique_violation` (pg error `23505`), `createShortUrl` retries up to 10 times

### Logging

`src/lib/logger.js` exports a Pino instance. Use this everywhere instead of `console`. In development, logs are pretty-printed via `pino-pretty`; in production, raw JSON is emitted.

## Known Issues / Tech Debt

- **`ApiResponse` class is unused** (`src/utils/ApiResponse.js`): Defined but never imported anywhere. Responses are sent as plain objects. Either adopt it consistently or remove it.
- **No tests exist yet**: Jest and supertest are installed but there are no test files. Tests should be added before the caching/scaling stages.
- **`trust proxy` is commented out** in `app.js`: Must be enabled when deploying behind a reverse proxy (nginx, Render, Railway) or rate limiting and IP detection will be wrong.
