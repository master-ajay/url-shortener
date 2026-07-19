# ROADMAP.md — URL Shortener: Design, Decisions, and Learning Companion

> Read this with `CLAUDE.md`. `CLAUDE.md` tells AI *how to write code* in this repo. `ROADMAP.md` tells you *why the system is shaped this way* — and what you should be able to defend as an SDE-III before claiming to know each layer.

## How to Use This Document

Each stage answers six questions, in order:

1. **What problem does this stage solve?** — what the system can't do yet
2. **What are the design alternatives?** — 2–4 ways to solve it
3. **Which option wins here, and why?** — the chosen design + rationale
4. **What did we give up?** — trade-offs, accepted risks
5. **What can still break?** — failure modes, edge cases
6. **What concepts must you defend in an interview?** — the LLD/HLD vocabulary

Each stage ends with concrete tasks. The tasks are *what* to implement; the design notes above them are *why* it must be that way.

**Stages are gates, not phases.** Don't enter Stage N+1 until you have a stress test showing Stage N is the bottleneck. The whole point is to *feel* each problem before you fix it.

---

## Mental Model: How URL Shorteners Actually Fail

Internalize this before any stage. A URL shortener has two operations:

- **WRITE** — `POST /shorten` — rare (~1% of real traffic)
- **READ** — `GET /:code` → 301/302 — dominant (~99%)

This asymmetry shapes every decision:

- We cache aggressively on reads, not writes
- We can tolerate slow writes; we cannot tolerate slow reads
- We can use eventual consistency for analytics; never for the redirect itself
- We can throw money at read replicas; sharding the write path is a last resort

Production URL shorteners (bit.ly, TinyURL) sustain 10K–100K RPS on reads. Most of it is served from cache, not the database. **Your design must converge to this shape by Stage 4.**

---

## Career Lens: Frontend → SDE1 → SDE2 → (a bit of) SDE3

The starting point is **4 years of React/frontend experience, new to backend entirely.** The path is a ladder, climbed in order — get SDE1 backend fundamentals solid first, then SDE2 ownership, then borrow a few SDE3 habits. Skipping straight to "think like SDE3" without the SDE1/SDE2 floor underneath produces someone who can talk about trade-offs but can't actually build the thing — that's a real failure mode in interviews, not just a style choice.

Roughly, the existing stages map onto the ladder:

| Stage(s) | Rung | What "ready" looks like |
|---|---|---|
| 0–1 | **SDE1** | Can implement a well-specified task correctly (pool vs client, validation, error handling) without hand-holding on syntax; knows *what* each piece does, even if not yet *why it's the only correct choice* |
| 2–3 | **SDE2** | Can pick correctly between options someone else listed, and explain why, unprompted; owns a feature end-to-end including its failure modes; debugs from symptom to root cause |
| 4–6 | **SDE3 (taste, not full fluency)** | Starts generating the option list himself, not just picking from one; asks "what breaks at 10x" before being told it broke; can say what was deliberately *not* built and why |

### What actually separates the three rungs

| Dimension | SDE1 | SDE2 | SDE3 |
|---|---|---|---|
| Scope | Implements a well-specified task correctly, with guidance | Implements a well-specified task correctly, unassisted, and owns its bugs | Takes "we need a URL shortener" and produces the spec, including what's *not* in scope |
| Trade-offs | Follows the chosen design; can explain *what* it does | Picks correctly between options someone else listed, and *why* | Generates the option list, including the one nobody mentioned |
| Numbers | Not expected yet | Optimizes when told "this is slow" | Estimates capacity *before* writing code — catches the wrong design before it's built |
| Failure modes | Knows the failure mode when it's pointed out | Fixes the bug that paged | Asks "what else breaks the same way" and fixes the class of bug |
| Reversibility | Not expected yet | Ships the feature | Asks "if this is wrong, what does rollback cost?" before shipping |
| Communication | Explains what the code does | Explains what they built and why | Explains why a *simpler* thing was deliberately not built |

The drills below (capacity estimate, trade-off form, staff-review) are SDE2/SDE3 habits — start applying the easy version of them once Stage 1's SDE1 fundamentals are actually solid, not before. Trying to run the trade-off drill on code you can't yet write unassisted just produces guessing dressed up as analysis.

### Before you implement: napkin-math capacity estimate

Before touching code for a stage, answer with rough numbers (powers of 10 are fine, this is not precision engineering):

- What's the actual read:write ratio and RPS at *this* stage? (We already know it's ~99:1 reads — but at 10 RPS vs 10K RPS the right design differs.)
- What's the data size? (rows × bytes/row — does it fit in RAM? In one Redis instance? In `allkeys-lru` with room to spare?)
- What's the latency budget? (p99 target — if redirect must be <50ms, a single synchronous DB round-trip at ~5-10ms is fine; a synchronous external API call at 200ms is not.)
- What's the blast radius if this component goes down — does the whole system stop, or does it degrade?

If you can't produce these numbers, that's the tell that you're about to design from vibes, not constraints — the single most common SDE2 mistake in system design interviews.

### During: name what you're giving up, and your exit condition

For every design choice, state it in this exact form — it's also how you should answer system design interview follow-ups:

> "I chose **X** over **Y** because **[constraint/number]**. I'm giving up **[specific cost]**. I'd switch to **Y** when **[specific measurable trigger]**."

Example already in this doc (Stage 3): "Cache-aside over write-through because writes are rare and we don't want write latency coupled to cache latency. Giving up: instant cache consistency. Switch trigger: if staleness-driven bugs start showing up, or write volume grows past X%."

If you can't fill in the bracket with a *number or observable signal* (not "if it feels slow"), you don't actually know why you chose it — you're repeating a pattern you read somewhere.

### After: the staff-engineer self-review

Before checking a task off, write 2-3 sentences answering:

1. **What would a staff engineer push back on in this PR?** (Not "is the code clean" — that's SDE2-level review. Think: "why does this hold a DB connection during retry instead of failing fast", "why is this synchronous when it doesn't need to be", "what happens at 10x current load".)
2. **What's the rollback plan if this is wrong in production?** (Feature flag? Revert commit? Data migration needed to undo it? If "we'd have to manually fix rows," that's a finding — say so.)
3. **What did I deliberately NOT build, and why is that the right call *right now*?** (This is the CLAUDE.md "don't over-engineer" instruction, but argued from your own reasoning instead of just obeyed.)

### How this applies going forward

Each stage's existing "Trade-offs Accepted" and "Failure Modes" sections are the *answers* — written by someone who already did this exercise. Before reading them for a new stage, attempt the three drills above yourself first. Compare your answer to the doc. The gap between your answer and the doc's answer is exactly the gap between where you are and SDE3.

---

## Stage 0 — Baseline (Completed)

### Goal
Get *something* working end-to-end. Learn what breaks first under load.

### Current State
- Express + `pg.Pool` + Zod + Pino + Helmet
- Base62 short-code generator with retry on collision
- Rate limiting (100 req / 15 min, global)
- Central error handler with `ApiError` + `asyncHandler`

### Postmortem — Stress Test Results (Stage 0, 2026-05-17)

Tested `GET /:code` (redirect path) with autocannon, 30s each level. Pool max = 10 connections.

| Connections | Avg Req/s | p50   | p99    | Max      |
| ----------- | --------- | ----- | ------ | -------- |
| 10c         | 3,952     | 2ms   | 12ms   | 144ms    |
| 50c         | 4,122     | 8ms   | 88ms   | 1,600ms  |
| 100c        | 4,603     | 17ms  | 119ms  | 306ms    |

**Bottleneck confirmed:** throughput plateaued at ~4–4.6K req/s regardless of concurrency — classic DB connection pool saturation. At 50c, the worst second dropped to 114 req/s (pool fully exhausted). The 1,600ms max at 50c is a request queuing for a free pool connection.

**Expected gain from Stage 3 (Redis cache):** 80–95% cache hit rate → ~80–95% fewer DB queries → projected 40K+ req/s on cached reads.

### What's Still Broken (Intentionally)
- No tests
- No cache → every redirect hits Postgres
- No analytics, no TTL, no expiration
- No request timeouts
- No graceful shutdown
- In-memory rate limiter (won't survive horizontal scale)

### Concept to Internalize
*Premature optimization vs deliberate scaling.* You built the slow version on purpose so you can measure the breaking point and feel the next stage is necessary, not academic. **Production engineers earn their salary by knowing what *not* to build yet.**

---

## Stage 1 — Production Foundation

### The Problem

A demo that works in dev breaks in production for predictable reasons:
- One bad client takes down everyone (no rate limit, no timeout)
- One bug in a handler crashes the process (no error wrapper)
- One bad input corrupts the DB (no validation)
- One slow query blocks all others (no connection pool)
- One incident is unmappable (no structured logs, no request IDs)

Stage 1 is *the boring stage*. None of it is glamorous. All of it is non-negotiable.

### Design Alternatives

| Concern    | Option A                          | Option B                       | Option C                |
| ---------- | --------------------------------- | ------------------------------ | ----------------------- |
| DB client  | `pg.Client` (single conn)         | `pg.Pool` (N conns)            | ORM (Sequelize, Prisma) |
| Validation | Manual `if` checks                | Zod / Joi / Yup                | JSON Schema + Ajv       |
| Logging    | `console.log`                     | Pino (JSON)                    | Winston                 |
| Rate limit | In-memory `express-rate-limit`    | Redis-backed                   | Reverse proxy (Nginx)   |
| Errors     | `res.status().json()` per route   | Central handler + `ApiError`   | Error events on emitter |

### The Choices and Why

**`pg.Pool` over `pg.Client`.** Postgres connection setup costs ~50ms. A pool of 10 connections serves 10 concurrent queries; `Client` serializes everything. Cost: pool exhaustion if connections are held by slow queries — mitigated by query timeouts (Stage 5).

**Zod over manual validation.** Type inference doubles as runtime check. The schema is the single source of truth — you parse at the boundary and trust internal types after. Manual `if (!req.body.url)` drifts from types and forgets edge cases. Cost: ~50KB bundle.

**Pino over Winston.** Pino writes JSON via a worker thread, ~5x faster than Winston in benchmarks. Structured logs are queryable in any aggregator (Loki, ELK, Datadog). Cost: pretty-printing requires `pino-pretty` separately.

**In-memory rate limiter (for now).** Single Node process — no cluster yet. When we shard at Stage 4, this *must* move to Redis; otherwise every node has its own counter and 4 nodes = 4× the intended limit. We accept the debt; it'll be replaced when forced.

**Central error handler + `ApiError`.** Controllers throw; middleware formats. Wins: (1) consistent error shape across routes, (2) async errors via `asyncHandler` reach `next(err)` automatically, (3) stack traces never leak in production.

### Trade-offs Accepted

- Rate limiter won't survive horizontal scale → revisit at Stage 4
- No request timeouts → a stuck query holds a pool slot forever → Stage 5
- No graceful shutdown → SIGTERM kills in-flight requests → revisit before any real deploy
- `ApiResponse` class is unused → either adopt or delete (tracked in `CLAUDE.md`)

### Failure Modes You Should Know

1. **Pool exhaustion** — all 10 connections held by slow queries; new requests queue forever. Fix: query timeout + connection-acquisition timeout.
2. **Collision storm** — base62 6-char codes give ~56B keyspace; collisions stay rare until ~100M URLs. Retry-on-collision is fine *for now*; counter-based or Snowflake IDs scale better.
3. **Helmet too strict** — CSP can break frontend → measure before tightening.
4. **Rate limit IP spoofing** — with `trust proxy` off, every request looks like the LB's IP → all clients share one counter. With it on naïvely, `X-Forwarded-For` is spoofable. The right setting is `trust proxy = N` where N matches your LB hop count.

### Testing Strategy — the SDE2 bar

A junior writes one fat integration test per route and stops. An SDE2 is judged on this instead:

| Concern              | Junior approach                          | SDE2 bar (what we hold ourselves to)                              |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| What gets tested      | Only the happy path                       | Happy path + every validation branch + every domain error + side effects (retry, rate limit) |
| Test shape            | One big `it()` per endpoint               | Test pyramid — pure functions unit-tested directly, controller/route tested for wiring only |
| Mocking               | Mocks own functions, or nothing           | Mocks only the I/O boundary (`db.query`); real code everywhere else |
| Assertions            | "It ran without throwing"                 | Asserts on the contract (status + response shape vs Zod schema), not on incidental internals |
| Naming                | `test('it works')`                       | One behavior per test; name states the behavior and the expected outcome |

This isn't extra ceremony — it's what a reviewer checks before approving a PR with a new route. See `CLAUDE.md` → **Testing Standards** for the concrete checklist.

### Tasks (Stage 1)

- [x] S1-T1: `pg.Client` → `pg.Pool` (max 10)
- [x] S1-T2: URL format validation (Zod `.url()`)
- [x] S1-T3: DB index on `short_code`
- [x] S1-T4: Request logging via `pino-http`
- [x] S1-T5: Add Helmet
- [x] S1-T6: `express-rate-limit` middleware
- [x] S1-T7: Jest + Supertest suite, to the SDE2 bar above (20 tests, 5 suites, all passing):
  - [x] Unit: `isValidUrl` (valid http/https, invalid protocol, malformed string, empty string)
  - [x] Unit: `base62` (zero case, single-char, multi-char carry)
  - [x] Integration: `POST /shorten` happy path, 400 missing/invalid url, 400 unsupported scheme (`ftp://`), 500 on DB failure, retry-on-collision (succeeds on 2nd try), exhausts after 10 retries
  - [x] Integration: `GET /:code` 301 on hit, 404 on miss, 400 on code too short/long
  - [x] Integration: 429 after exceeding rate limit window
- [x] S1-T8: First stress test with `autocannon` — record p50/p95/p99 + error rate at 100 / 500 / 1000 connections

### Postmortem — Stress Test Results (Stage 1, 2026-06-20)

Tested `GET /:code` with autocannon, 30s each level, real Postgres (pool max 10, unchanged from Stage 0).

**Run 1 — rate limiter as configured (`max: 100` / 15 min).** 50 connections, 10s: **0 successful (2xx/3xx) responses out of 136,736 requests** — effectively every request after the first ~100 got `429`. The rate limiter is now *the* bottleneck, by a wide margin, before the DB pool is ever touched.

**Run 2 — rate limiter temporarily raised (`max: 1000000`) to find the underlying ceiling**, same code path as Stage 0:

| Connections | Avg Req/s | p50    | p99    | Max    | Status codes |
| ----------- | --------- | ------ | ------ | ------ | ------------- |
| 100c        | 6,325     | 14ms   | 29ms   | 468ms  | 100% `301`    |
| 500c        | 6,520     | 73ms   | 153ms  | 440ms  | 100% `301`    |
| 1000c       | 6,206     | 152ms  | 351ms  | 649ms  | 100% `301`    |

Limiter restored to `max: 100` immediately after — no lasting change to `rateLimiter.js`.

**Findings:**
- Throughput improved over Stage 0 (~4–4.6K → ~6.2–6.5K req/s) — the `idx_short_code` index plus pool reuse is paying off, even though pool size (10) is unchanged. Plateau still confirms the DB round-trip is the real ceiling once the limiter is out of the way.
- p50 latency scales roughly linearly with concurrency (14ms → 73ms → 152ms) while req/s stays flat — classic queuing-for-a-pool-slot behavior, same root cause as Stage 0, not yet fixed (query timeouts are a Stage 5 task).
- **The rate limiter being the dominant bottleneck at realistic load is itself the headline result for Stage 1**, not a footnote. It proves the limiter works (good), but also that "100 req/15min, global, single process" is a toy value — any real single-user benchmark or legitimate burst of traffic looks identical to an attack to this limiter. Per-IP limiting and a more realistic ceiling are implicit Stage 4 work (when the limiter must move to Redis anyway for horizontal scale).

### Interview Concepts (Stage 1)

- Connection pool sizing: PgTune rule `connections = (cores * 2) + effective_spindle_count`
- Why JSON logs beat text logs (queryability, structured fields, no regex parsing)
- Token-bucket vs leaky-bucket vs sliding-window rate limiting
- CORS preflight — when it fires, what each `Access-Control-*` header means
- Security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options — what each prevents
- Test pyramid — why unit tests should outnumber integration tests, and integration tests should outnumber e2e
- Mocking at the I/O boundary vs mocking your own code (and why the latter gives false confidence)
- Testing the contract vs testing the implementation — why brittle tests slow teams down

---

## Stage 2 — Observability and Product Features

### The Problem

You can't fix what you can't see. After Stage 1 you have logs; you don't have:
- **Correlation** — given a complaint "request X failed," can you find every log line about it?
- **Aggregation** — what's the p99 latency right now? How many 5xx in the last 5 min?
- **Product visibility** — how often is each short URL clicked? Which ones are expired?

This stage adds eyes and ears, plus the first product features (TTL, custom codes, click stats) that will stress the system in interesting ways at later stages.

### Design Alternatives

| Concern         | Option A                  | Option B                       | Option C                  |
| --------------- | ------------------------- | ------------------------------ | ------------------------- |
| Request ID      | UUIDv4                    | ULID (sortable, time-prefixed) | Snowflake                 |
| Click counter   | Sync `UPDATE` on each GET | Async queue → batch update     | Redis counter → PG flush  |
| TTL enforcement | Lazy (check on read)      | Eager (cron `DELETE`)          | TTL index (Mongo-style)   |
| Metrics         | Prometheus pull           | StatsD push                    | OpenTelemetry             |

### The Choices and Why

**UUIDv4 for request IDs.** Already using it. ULIDs would be marginally better (sortable, time-prefixed), but UUIDv4 is fine until you need to range-scan request IDs in a log store. Defer.

**Sync `UPDATE` for click counter (Stage 2–3).** Simple, correct, slow. At 1K RPS this becomes hot-row contention — every redirect locks the same counter row. Stage 3 caches the SELECT (URL lookup) but the UPDATE still hits DB on every redirect. Redis INCR + batch flush to DB deferred to Stage 6 — it requires a background worker and adds eventual consistency to click counts, which is Stage 6 scope.

**Lazy TTL check.** Add `expires_at TIMESTAMP` column. On read, check `now() < expires_at`. Pros: no background job. Cons: expired rows accumulate forever — needs a periodic cleanup job added at Stage 5 when row counts hurt.

**Prometheus pull.** Industry standard. Server-side `/metrics` endpoint, scraped by Prometheus. Pull model survives client crashes (next scrape sees the last value); push models lose data on transport failure.

### Trade-offs Accepted

- Click counter has hot-row contention → SELECT now cached (Stage 3), UPDATE still hits DB → fully fixed at Stage 6 (Redis INCR + batch flush)
- No real metrics dashboard yet → add Prometheus exporter here, Grafana later
- Custom codes need their own collision handling AND a denylist (reserved words like `admin`, `api`, `health`) — easy to forget

### Failure Modes

1. **Hot-row write contention** — `UPDATE … SET clicks = clicks + 1` serializes all writers behind the row lock.
2. **TTL race** — request reads URL at `T`, returns 301; user clicks at `T+1ms` when row was just expired and deleted. Treat redirect as "best effort within the request."
3. **Custom code collisions with reserved routes** — if a user shortens to `/health`, your health check route gets shadowed. Denylist required *before* lookup.
4. **Metric cardinality explosion** — putting `user_id` or `short_code` as a Prometheus label creates one time series per value. Prometheus melts at ~10M series. Use labels for *bounded* dimensions only.

### Tasks (Stage 2) — ✅ COMPLETED 2026-06-22

- [x] S2-T1: Request ID middleware + Pino log correlation — **AsyncLocalStorage for request context injection**
- [x] S2-T2: `clicks` column + increment on redirect + `GET /stats/:code` — **Atomic `RETURNING clicks` eliminates extra query**
- [x] S2-T3: `expires_at` column + 410 Gone on expired URLs — **Lazy expiry check; service throws ApiError(410)**
- [x] S2-T4: Custom short code support — **Zod validation; optional field; collision retry**
- [x] S2-T5: ~~`/metrics` endpoint~~ — **Deferred to Stage 3** (focus was latency measurement, not Prometheus)
- [x] S2-T6: Stress test at 6K RPS; **discovered rate limiter is the bottleneck, not database**

### Stage 2 Stress Test Results (2026-06-22)

**Setup:** 50 concurrent connections, 10-second test, NODE_ENV=test (rate limiter disabled)

| Endpoint | p50 | p95 | p99 | Throughput | Key Finding |
|----------|-----|-----|-----|-----------|------------|
| `/health` (no DB) | 6ms | 13ms | 22ms | 7.5K req/sec | Network I/O bound |
| `/:code` (with DB) | 6ms | 19ms | 27ms | 6.4K req/sec | Database adds only 5-6ms at p95/p99 |

**Critical Discovery:** The rate limiter (100 req/15min) is the bottleneck in Stage 1, not the database. When disabled, the database handles 6K+ req/sec efficiently. Each database operation (SELECT + UPDATE with atomic RETURNING) adds only 5-6ms at tail latencies. The database is **not the limiting factor** — this stage proves the architecture is ready for caching (Stage 3).

**See:** `STRESS_TEST_RESULTS.md` for full analysis and interview talking points.

### Interview Concepts (Stage 2)

- Logs vs metrics vs traces — the three pillars of observability
- Metric cardinality and why labels must be bounded
- p50 vs p95 vs p99 — why averaging latency lies
- Hot-row / hot-key problem in Postgres MVCC
- Lazy vs eager invalidation
- Request correlation via AsyncLocalStorage — why it's better than threading context through parameters
- Atomic database operations — why `RETURNING` eliminates need for separate SELECT
- Rate limiter as a bottleneck — when to move to distributed (Stage 4)

---

## Stage 3 — Redis Cache (Cache-Aside)

### The Problem

Stage 2's stress test shows: at ~1500 RPS, Postgres CPU pegs at 100%. Every redirect is a `SELECT … FROM short_urls WHERE short_code = $1`. The query is fast (indexed) but round trip + planner + lock + buffer pool work dominates.

Memory is ~1000× faster than disk and ~100× faster than even a fast SQL round trip. The fix is to put a cache between app and DB.

### Design Alternatives

| Concern          | Option A                    | Option B                              | Option C                       |
| ---------------- | --------------------------- | ------------------------------------- | ------------------------------ |
| Cache topology   | Cache-aside (look-aside)    | Read-through                          | Write-through                  |
| Cache server     | Redis                       | Memcached                             | In-process LRU                 |
| Invalidation     | TTL only                    | TTL + explicit delete on update       | Versioned keys                 |
| Stampede control | None (lose)                 | Single-flight (request coalescing)    | Probabilistic early expiry     |

### The Choices and Why

**Cache-aside (look-aside).** App checks cache → on miss, reads DB → populates cache. App owns the cache logic. Alternatives:
- *Read-through* needs a cache that knows your DB (RedisCacheModule, etc.) — more setup, less flexibility.
- *Write-through* couples writes to the cache — extra latency on a code path we don't care about (writes are rare).

Cache-aside is the canonical choice for read-heavy workloads. Cost: a race on writes — write DB then delete cache; a concurrent reader can repopulate the cache with stale data between the write and the delete. Mitigation: short TTL + accept eventual consistency.

**Redis over Memcached.** Redis has persistence (AOF/RDB), data structures (sorted sets for trending URLs later), pub/sub (cluster-wide cache invalidation at Stage 4). Memcached is faster for pure k/v but is a leaf you outgrow.

**Redis over in-process LRU.** In-process cache doesn't survive restart and isn't shared across nodes at Stage 4. Four nodes × M-size caches = 4× the cache misses vs one shared cache of size 4M.

**Single-flight to prevent stampede.** When a hot key expires, 1000 concurrent requests all see a miss and all stampede the DB. Single-flight (a.k.a. request coalescing) sends one to the DB; the rest wait on the same promise.

### Trade-offs Accepted

- **Eventual consistency** — writes aren't instantly visible. TTL of 5–60 min is the staleness ceiling. For a URL shortener, this is fine — shortcodes don't change.
- **Cold cache** — on Redis restart, the DB takes the full load for minutes. Mitigation: cache-warming script that pre-loads top-N keys.
- **Operational complexity** — one more thing to monitor, one more thing that can fail.

### Failure Modes You Must Know

1. **Cache stampede / thundering herd** — hot key expires → N concurrent misses → N DB queries for the same row. Mitigation: single-flight, probabilistic early expiry, lock-on-miss.
2. **Cache penetration** — attacker queries nonexistent codes → every request misses cache and hits DB. Mitigation: cache negative results (shorter TTL), Bloom filter.
3. **Cache avalanche** — all keys expire at the same instant → mass miss. Mitigation: TTL jitter (`baseTTL + random(0, 60)` seconds).
4. **Memory pressure / eviction** — Redis OOM → starts evicting under `allkeys-lru`. Hot keys stay, but you may evict valuable warm keys. Monitor `evicted_keys`.
5. **Network partition app↔Redis** — call with no timeout → request stalls. Always set `socketTimeout` < request timeout.

### Tasks (Stage 3) — ✅ COMPLETED 2026-07-17

- [x] S3-T1: Add Redis — local `redis` npm client, `REDIS_URL` env var, connect on startup in `server.js`
- [x] S3-T2: `src/lib/cache.js` — `get`, `set(ttl)`, `del`, `wrap(key, ttl, fn)` with single-flight via in-process `Map` of pending promises. All Redis calls wrapped in try/catch — Redis down degrades gracefully to DB.
- [x] S3-T3: Wrap `getOriginalUrl` with `cache.wrap` — SELECT never hits DB on cache hit. Cache key: `url:<code>`, stores `{ original_url, expires_at }`. Invalidated on 410.
- [x] S3-T4: On `createShortUrl`, pre-warm cache via `INSERT ... RETURNING original_url, expires_at` (write-around — single RETURNING query, no extra SELECT). Chosen over write-through: writes are rare, no benefit coupling write latency to cache.
- [x] S3-T5: ~~TTL jitter~~ — **moved to S4-T2** (single process, thundering herd risk is low; becomes critical at Stage 4 when N nodes share the same Redis cache and amplify expiry stampedes)
- [x] S3-T6: Stress test, target 10K RPS, document cache hit rate + p99 — **see results below**
- [x] S3-T7: Chaos test — kill Redis mid-stress, confirm graceful degradation to DB — **see results below**

### Stage 3 Stress Test Results (2026-07-17)

**Setup:** `NODE_ENV=test` (rate limiter off), `LOG_LEVEL=error`, warm key `stresstest`, Redis INFO `keyspace_hits/misses` for hit rate. Autocannon, 10s, no pipelining (matches Stage 2 methodology).

| Endpoint | Conns | p50 | p99 | Throughput | Cache hit rate |
|----------|-------|-----|-----|------------|----------------|
| `/health` (no I/O) | 50c | 2ms | 7ms | **15.9K req/sec** | n/a |
| `/:code` (cached + click UPDATE) | 50c | 10ms | 32ms | **4.4K req/sec** | **100%** (48.4K hits / 0 misses) |
| `/:code` | 100c | 16ms | 45ms | **5.4K req/sec** | **100%** (59.8K hits / 0 misses) |
| `/:code` (pipelined `-p 10`) | 50c | 73ms | 186ms | **6.2K req/sec** | **100%** |

**Did not hit 10K RPS on redirects — and that is the finding.** SELECT is fully cached (100% hit rate), but every redirect still does `UPDATE … clicks = clicks + 1`. Hot-row write contention + pool saturation keep throughput in the same 4–7K band as Stage 2. `/health` at 16K proves the Node process itself is not the limit yet.

**Critical Discovery:** Cache-aside solved the *read* path. The remaining bottleneck is the *sync click counter write* — exactly the Stage 6 problem (Redis INCR + batch flush). Entering Stage 4 (horizontal scale) still makes sense: more Node processes help CPU-bound work and set up shared-Redis concerns (TTL jitter, distributed rate limit), but redirect RPS will not jump an order of magnitude until Stage 6 removes the per-request UPDATE.

**Chaos fix shipped with S3-T7:** With Redis dead, `node-redis` queued commands forever (`disableOfflineQueue` default false) → redirects hung. Fixed in `redis.js` (`disableOfflineQueue: true`, `connectTimeout: 500`) and `cache.js` (`isReady` short-circuit + 200ms op timeout).

### Stage 3 Chaos Test Results (2026-07-17)

**Method:** autocannon 50c / 15s on `GET /stresstest`; `SIGKILL` Redis at t=5s; spot-check redirects during outage.

| Metric | Result |
|--------|--------|
| Client errors / timeouts | **0 / 0** |
| Status codes | **100% 301** (104,039) |
| Avg RPS across outage | 6.9K |
| p50 / p99 | 6ms / 13ms |
| Spot checks while Redis down | 5/5 → 301 |

**Verdict:** Graceful degradation confirmed — Redis outage does not take down redirects; lookups fall through to Postgres.

### Interview Concepts (Stage 3)

- Cache-aside vs read-through vs write-through vs write-behind
- TTL strategies: fixed, jittered, sliding, probabilistic early expiry
- "There are only two hard things in CS: cache invalidation and naming things"
- LRU vs LFU vs FIFO eviction
- Bloom filters for negative caching
- Hot key problem and why Redis cluster sharding makes it worse, not better

---

## Stage 4 — Horizontal Scale

### The Problem

A single Node process uses one CPU core. Modern boxes have 8–64 cores. At Stage 3 your bottleneck moved from DB to *the Node process itself* — event-loop saturation, GC pauses, single-threaded JS limits.

We need N processes serving traffic, fronted by a load balancer. This is the moment "stateless service" stops being a buzzword and becomes a hard requirement.

### Design Alternatives

| Concern         | Option A                  | Option B                  | Option C                  |
| --------------- | ------------------------- | ------------------------- | ------------------------- |
| Process model   | PM2 cluster mode          | Node `cluster` module     | Container per process     |
| Load balancer   | Nginx                     | HAProxy                   | Cloud LB (ALB/GCLB)       |
| LB algorithm    | Round-robin               | Least-conn                | IP hash (sticky)          |
| Session/state   | **Stateless**             | Sticky sessions           | Centralized session store |

### The Choices and Why

**PM2 cluster mode.** Wraps Node's `cluster` with monitoring, log aggregation, zero-downtime reload. For containerized deploys (K8s), drop PM2 and run one Node per pod — let the orchestrator do the multiplexing.

**Nginx.** Battle-tested, easy config, terminates TLS, serves static. Alternative for managed environments: cloud LB.

**Round-robin.** Simplest. Works because our service is stateless. Avoid sticky sessions — they create hot pods (one heavy user pins one pod) and break graceful shutdown.

**Stateless-first principle.** Rate limit must move to Redis. Anything stored in process memory (in-process cache, in-process counter, in-process WebSocket map) is now a bug. Audit `src/` for anything that won't survive a process restart.

### Trade-offs Accepted

- One more layer to debug — failure could be in app, Nginx, or LB config
- Deployment story required — `pm2 reload` for zero-downtime; watch in-flight requests
- TLS termination at Nginx → app sees `X-Forwarded-Proto`; must trust proxy correctly
- Logs are now distributed — log aggregation becomes mandatory

### Failure Modes

1. **One pod stuck, LB still routes to it.** Need health checks. Nginx `upstream` with `max_fails` + `fail_timeout`, or active `/health` polling.
2. **Graceful shutdown.** Pod gets SIGTERM, has ~30s to drain. Need `server.close()` + wait + close pool. The LB must stop sending new traffic *before* SIGTERM (K8s `preStop` hook).
3. **In-memory state survival.** Anything in process memory is gone on restart. Re-audit Stage 1's rate limiter — must be on Redis now.
4. **Connection multiplication.** 4 pods × 10 DB conns = 40 conns. Postgres `max_connections` is usually 100. At 16 pods you exhaust it → forces PgBouncer at Stage 5.
5. **Thundering herd on cold start.** New pod joins LB, immediately gets full traffic, cold cache → DB spike. Mitigation: cache warming + gradual LB ramp.

### Tasks (Stage 4)

- [x] S4-T1: Audit codebase for in-process state; move rate limiter to Redis (`rate-limit-redis`) — **MemoryStore → RedisStore (`rl:` prefix); `passOnStoreError: true` (fail-open). Remaining in-process: `cache.js` inFlight Map (OK; stampede mitigated further by S4-T2 jitter).**
- [ ] S4-T2: TTL jitter — `BASE_TTL + Math.floor(Math.random() * JITTER)` in `cache.js`. With N nodes sharing Redis, mass expiry = N× the stampede; jitter spreads it across a window.
- [ ] S4-T3: Graceful shutdown — `server.close()`, drain pool, exit on SIGTERM
- [ ] S4-T4: PM2 ecosystem file, cluster mode with `instances: max`
- [ ] S4-T5: Nginx config with upstream pool + health checks
- [ ] S4-T6: `/health` and `/ready` endpoints (liveness vs readiness)
- [ ] S4-T7: Stress test with 4 instances; target 50K RPS; verify even load distribution

### Interview Concepts (Stage 4)

- 12-Factor App (especially stateless processes, port binding, disposability)
- Liveness vs readiness probes — why you need both
- Graceful shutdown lifecycle: SIGTERM → stop accepting → drain → close → exit
- LB algorithms: round-robin, least-conn, weighted, IP hash, consistent hash — when each wins
- Why sticky sessions are an anti-pattern at scale
- Connection multiplication problem (and PgBouncer as the fix → Stage 5)

---

## Stage 5 — Database Scaling

### The Problem

Stage 4's stress test shows: at ~50K RPS the DB connection pool is saturated *again*. Two distinct problems:
1. **Connection multiplication** — pods × app_pool > `max_connections`. Fix: PgBouncer.
2. **Read throughput** — even a beefy primary can't serve 50K+ reads/s alone. Fix: read replicas.

### Design Alternatives

| Concern             | Option A                       | Option B            | Option C                         |
| ------------------- | ------------------------------ | ------------------- | -------------------------------- |
| Connection pooling  | PgBouncer (transaction mode)   | Pgpool-II           | App-level only                   |
| Read scaling        | Primary + N read replicas      | Sharded (horizontal)| Caching only (no replicas)       |
| Read routing        | App-level (manual)             | Proxy (RDS Proxy)   | Replication-aware ORM            |
| Replication         | Async streaming                | Synchronous         | Logical (per-table)              |

### The Choices and Why

**PgBouncer transaction mode.** Multiplexes thousands of client connections onto a small pool of real Postgres backends. Transaction mode (vs session) is aggressive — connection released after each transaction. Cost: loses prepared statements and a few other session features.

**Primary + read replicas (async streaming).** Writes go to primary, reads go to replicas. Async replication has ~50–500ms lag — fine for our workload, since a URL created 1s ago doesn't *need* to be on the replica immediately. For "read your own writes" guarantees, route the next read to primary.

**App-level routing (two pools).** `dbPrimary`, `dbReplica`. Service-layer chooses. Cost: developer discipline; benefit: explicit and debuggable. Proxy-level routing (RDS Proxy) hides this and obscures bugs.

### Trade-offs Accepted

- **Replication lag.** Just-written URL may not be on replica yet. Route the immediate follow-up read to primary; later reads can hit replica.
- **PgBouncer transaction mode breaks** prepared statements, `SET LOCAL`, advisory locks across statements, `LISTEN/NOTIFY`. Audit your queries first.
- **Operational complexity.** Failover stories for primary, replica promotion procedures, monitoring lag.

### Failure Modes

1. **Replica fell behind during backup or vacuum.** Reads return stale data for minutes. Monitor `pg_stat_replication.replay_lag`.
2. **Split-brain on failover.** Old primary recovers, doesn't know it was demoted, accepts writes → divergent state. Use Patroni or managed Postgres.
3. **PgBouncer SPOF.** Single TCP proxy. Run multiple behind their own LB.
4. **Connection-pool sizing math.** `app_pool < pgbouncer_pool < postgres_max_connections`. Get this wrong → cascading exhaustion.
5. **Long-running query on replica blocks WAL replay.** A 10-min analytics query stalls replication. Mitigation: `hot_standby_feedback` *or* dedicate a separate analytics replica.

### Tasks (Stage 5)

- [ ] S5-T1: PgBouncer in docker-compose, transaction mode
- [ ] S5-T2: Streaming replica as second Postgres
- [ ] S5-T3: Split `src/config/db.js` into `dbPrimary` + `dbReplica` pools
- [ ] S5-T4: Service-layer audit — annotate each query `[READ]` / `[WRITE]`, route accordingly
- [ ] S5-T5: Query timeout (`statement_timeout = 5s`) + connection-acquisition timeout
- [ ] S5-T6: Stress test 100K RPS; measure replica lag under load

### Interview Concepts (Stage 5)

- CAP theorem in practice — what choosing AP vs CP means for *this* system
- Sync vs async replication; RPO and RTO
- Read-your-own-writes consistency on async replicas
- PgBouncer pooling modes (session, transaction, statement) — what each breaks
- WAL, replication slots, replication lag
- Sharding strategies — range, hash, directory — and *why we didn't shard*

---

## Stage 6 — Async Architecture

### The Problem

Some operations don't need to happen in the request path:
- Click analytics — fire-and-forget, can be batched
- Notifications when a URL expires
- Computing trending URLs (sorted-set rollup)
- Geo-IP enrichment on clicks
- Webhooks to external systems

Doing them inline couples availability (analytics down → redirect breaks) and latency (geo-IP API 200ms → redirect 200ms slower).

Move them off the request path. Pattern: event-driven architecture — request emits an event, a worker processes it.

### Design Alternatives

| Concern             | Option A             | Option B                            | Option C                  |
| ------------------- | -------------------- | ----------------------------------- | ------------------------- |
| Queue tech          | Redis Streams        | Kafka                               | RabbitMQ                  |
| Delivery semantics  | At-most-once         | At-least-once + idempotent          | "Exactly-once" (illusion) |
| Worker pattern      | Long-running consumer| Serverless (Lambda)                 | Cron + batch              |
| Schema              | Free-form JSON       | JSON Schema                         | Avro / Protobuf           |

### The Choices and Why

**Redis Streams.** Already have Redis. Streams give consumer groups, message acking, replay. Cost: less durable than Kafka, lower ceiling (~1M msg/s vs Kafka's 10M+). For our scale, enough.

**At-least-once + idempotent consumers.** "Exactly-once" is marketing. The practical pattern is *at-least-once delivery + idempotent processing*. Each event has a unique ID; consumer records "I processed X" before acking. On retry, it sees X is done and skips.

**Long-running consumers in their own process.** Separate `workers/` directory, separate deploy. Scale independently of API pods. Cost: another deployable.

### Trade-offs Accepted

- Click counts become eventually consistent — stats endpoint may be 1–30s stale
- Worker outages create backlog → must monitor consumer lag
- Out-of-order delivery is possible → consumer logic must handle it
- Another moving part with its own failure modes

### Failure Modes

1. **Poison message** — one malformed event crashes the worker → whole stream stuck. Mitigation: try/catch handler, dead-letter stream after N retries.
2. **Consumer lag explosion** — producer outpaces consumer → unbounded growth. Alert on lag > threshold, scale workers horizontally.
3. **Idempotency dedup memory** — tracking "processed X" forever explodes memory. Use a time-bounded dedup window (e.g., 24h).
4. **Lost events on Redis crash** — Streams persist (AOF), but a crash mid-write can lose recent messages. For high-value events, use Kafka.
5. **Schema breakage** — old workers see new event shape, crash. Versioning required from day one.

### Tasks (Stage 6)

- [ ] S6-T1: Create `events:clicks` Redis stream
- [ ] S6-T2: API publishes click event (non-blocking, no `await`)
- [ ] S6-T3: `workers/click-aggregator.js` — consumer group, 1-sec batch windows, writes to DB
- [ ] S6-T4: Idempotency via event ID + a Redis SET of "processed in last 1h"
- [ ] S6-T5: Dead-letter stream + lag alerting
- [ ] S6-T6: Full-pipeline stress test — 100K RPS; measure click lag; validate counts match

### Interview Concepts (Stage 6)

- Synchronous vs asynchronous coupling
- At-most-once, at-least-once, exactly-once delivery semantics
- Idempotency keys and how to design them
- Outbox pattern (write to DB + queue atomically)
- Backpressure — when producers must slow down
- CQRS — why reads and writes can have separate models
- Event sourcing vs event-driven (not the same thing)

---

## Cross-Cutting Concerns

Topics that don't belong to one stage but you should master across all of them.

### Capacity Planning

At every stage, you should be able to answer:
- "If traffic doubles, what breaks first?"
- "What's the cheapest scale-up vs scale-out decision here?"
- "What's the cost per million requests?"

### Idempotency Everywhere

- **Write APIs** — accept `Idempotency-Key` header → store result, return cached on retry
- **Workers** — dedup by event ID
- **Migrations** — re-runnable (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`)

### Consistency Models

| Model              | Where it shows up                          |
| ------------------ | ------------------------------------------ |
| Strong (linearizable) | Postgres primary                         |
| Read-your-writes   | Primary for self, replica for others       |
| Eventual           | Redis cache, async workers, click counts   |
| Causal             | Distributed-systems territory; not needed  |

### Backpressure

Where does the system push back when overloaded? At every layer:
- Nginx → 503 if upstream maxed
- App → 429 from rate limiter
- DB → connection refused / timeout
- Worker → consumer-group rebalancing

A system without backpressure becomes a system that crashes.

### The Two Hard Things

> "There are only two hard things in computer science: cache invalidation and naming things." — Phil Karlton

Both bite this project. Stage 3 is when cache invalidation becomes real. Naming is daily (is it `shortCode`, `short_code`, `code`, `slug`?). Pick one convention per layer (DB: snake_case, JS: camelCase) and never deviate.

---

## Glossary

- **Cache-aside / look-aside** — app reads cache first, falls back to DB on miss, then populates cache.
- **CAP theorem** — under partition, you must choose between consistency and availability.
- **Cardinality** — number of distinct values; high cardinality kills metric systems.
- **Connection multiplication** — `pods × app_pool = total_db_conns`; explodes fast at scale.
- **Hot row / hot key** — single row/key getting disproportionate traffic; contention point.
- **Idempotency** — repeating an operation has the same effect as doing it once.
- **Liveness vs readiness** — liveness = "should I be restarted?"; readiness = "can I take traffic?"
- **MVCC** — Postgres concurrency model; readers don't block writers.
- **p50 / p95 / p99** — percentile latencies; p99 is "the slow 1%".
- **Probabilistic early expiry** — refresh cache keys probabilistically near expiry to smooth renewal load.
- **Replication lag** — time between write on primary and visibility on replica.
- **Single-flight** — when N requests want the same uncached value, only 1 fetches; others wait.
- **Stampede / thundering herd** — N concurrent cache misses for the same key.
- **Stateless** — request can be served by any instance with no prior knowledge.
- **TTL jitter** — randomize TTL slightly to avoid synchronized expiry.

---

## Versioning This Document

When you complete a stage, update the corresponding checkboxes and add a `### Postmortem` subsection capturing:
- What stress-test numbers you actually hit
- Which design alternative you'd choose differently in hindsight
- What surprised you

This document grows with the project. Treat it as part of the codebase — review it in PRs, refactor it like code.
