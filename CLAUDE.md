# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is a **learning project** being built in stages toward a production-grade URL shortener. Do not over-engineer features or add infrastructure beyond the current stage. Implement only what is asked — the complexity is added deliberately, stage by stage.

See `ROADMAP.md` for the full 6-stage design plan: problem statement, design alternatives considered, chosen design + rationale, trade-offs, failure modes, and interview concepts per stage. Always tie code changes back to the stage they belong to and avoid jumping ahead.

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

## Testing Standards

Tests live under `src/__tests__/`, split by type — this split is structural, not just a naming hint:

- `src/__tests__/unit/` — pure functions, no I/O (`isValidUrl.test.js`, `base62.test.js`)
- `src/__tests__/integration/` — route + controller + service wired together via `supertest`, with `db.query` mocked (`shorten.test.js`, `redirect.test.js`)

True E2E (real deployed server, real DB, real network) doesn't exist yet — it requires deploy/CI infra that doesn't show up until Stage 4+. Don't build it early.

The bar here is SDE2, not "happy path exists":

- **Test pyramid** — push logic into unit-testable functions (`isValidUrl`, `base62`, retry-on-collision) and unit-test those directly. Integration tests only need to prove the wiring is correct — they should not re-derive every edge case already covered by a unit test.
- **Mock at the boundary, not the internals** — never mock your own service/controller code under test. The DB boundary has a manual mock at `src/config/__mocks__/db.js` (`{ query: jest.fn() }`); calling `jest.mock("../../config/db")` in an integration test auto-applies it, so each test only needs `db.query.mockResolvedValueOnce(...)` / `mockRejectedValueOnce(...)`, not redefining the mock shape every time.
- **Test the contract, not the implementation** — assert on `response.status` / `response.body` shape (matching the Zod schema), not on internal call mechanics, *unless* the interaction itself is the behavior under test (e.g., proving collision retry calls `db.query` again on a `23505` error).
- **One behavior per `it()`, Arrange-Act-Assert structure.** A test name with "and" in it should be split into two tests.
- **Minimum required cases per route before merging:**
  - Happy path (correct status + response shape)
  - Each validation failure (400) — one test per invalid input variant
  - Each domain error (404, 409, etc.)
  - Documented side effects: retry-on-collision, rate-limit 429, expiry 410, etc.
- Run `npm test` before opening a PR.

## Known Issues / Tech Debt

- **Tests are in progress**: `src/__tests__/shorten.test.js` exists but is a stub — see Testing Standards above for the bar to clear before S1-T7 is done.
- **`trust proxy` is commented out** in `app.js`: Must be enabled when deploying behind a reverse proxy (nginx, Render, Railway) or rate limiting and IP detection will be wrong.
