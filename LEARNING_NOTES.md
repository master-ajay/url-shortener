# URL Shortener: Detailed Learning & Interview Guide

A comprehensive guide covering **what we built**, **why we built it that way**, and **interview questions** for each concept.

**Project:** Production-grade URL Shortener  
**Stage:** 0 → 1 (Basic API with middleware, validation, error handling, logging, rate limiting, security)  
**Stack:** Node.js + Express + PostgreSQL + Zod + Pino

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Core Problem & Solution](#core-problem--solution)
3. [Express.js Fundamentals](#expressjs-fundamentals)
4. [Layered Architecture](#layered-architecture)
5. [Middleware Chain](#middleware-chain)
6. [Request/Response Cycle](#requestresponse-cycle)
7. [Database Design & Optimization](#database-design--optimization)
8. [Input Validation with Zod](#input-validation-with-zod)
9. [Error Handling Pattern](#error-handling-pattern)
10. [Structured Logging with Pino](#structured-logging-with-pino)
11. [Rate Limiting Strategy](#rate-limiting-strategy)
12. [Security with Helmet](#security-with-helmet)
13. [Code Organization & Patterns](#code-organization--patterns)
14. [Centralized Environment Configuration](#centralized-environment-configuration)
15. [Graceful Shutdown](#graceful-shutdown)
16. [Response Wrapper Classes: ApiResponse & ApiError](#response-wrapper-classes-apiresponse--apierror)
17. [Test Suite: Current State](#test-suite-current-state)
18. [Interview Q&A](#interview-qa)

---

## Project Overview

### What We Built

A **URL Shortening Service** that:

```
Long URL Input:
https://github.com/anthropics/anthropic-sdk-python/blob/main/README.md

↓ Process ↓

Short URL Output:
http://localhost:3000/abc123

↓ On Redirect ↓

Original URL:
https://github.com/anthropics/anthropic-sdk-python/blob/main/README.md
```

### Two Core Endpoints

**1. Shorten Endpoint** (`POST /shorten`)
```bash
curl -X POST http://localhost:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://github.com/anthropics/anthropic-sdk-python"}'
```

**Response (201 Created):**
```json
{
  "statusCode": 201,
  "data": {
    "code": "abc123",
    "short_url": "http://localhost:3000/abc123",
    "success": true
  },
  "message": "Success",
  "success": true
}
```

**2. Redirect Endpoint** (`GET /:code`)
```bash
curl -i http://localhost:3000/abc123
```

**Response (301 Redirect):**
```
HTTP/1.1 301 Moved Permanently
Location: https://github.com/anthropics/anthropic-sdk-python
Content-Length: 0
```

---

## Core Problem & Solution

### The Problem

Given a long URL, generate a **unique, short code** that:
- ✅ Takes minimal storage
- ✅ Maps back to the original URL uniquely
- ✅ Handles collisions gracefully
- ✅ Doesn't expose internal IDs (for privacy)
- ✅ Can handle millions of URLs at scale

### Our Solution: Random Short Codes

This is the **actual current implementation** (`src/services/url.service.js`):

```javascript
// src/services/url.service.js
const db = require("../config/db");
const base62 = require("../utils/base62");

async function createShortUrl(url, retriedTimes = 0) {
  if (retriedTimes === 10) {
    throw new Error("Failed to insert after 10 retries");
  }

  if (!isValidUrl(url)) {
    throw new Error("Invalid URL");
  }

  // Pick a random integer 0–999,999,999, then encode it in base62
  const code = base62(Math.floor(Math.random() * 1000000000));

  try {
    await db.query(
      "INSERT INTO short_urls (short_code, original_url) VALUES ($1, $2)",
      [code, url],
    );
    return code;
  } catch (error) {
    if (error.code === "23505") {
      // Unique violation — recurse with a new random code
      return createShortUrl(url, retriedTimes + 1);
    }
    throw error;
  }
}

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
```

```javascript
// src/utils/base62.js — converts a number to a base62 string
const base62Generator = (num) => {
  const Alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (num === 0) return Alphabet[0];

  let base62 = "";
  while (num > 0) {
    const remainder = num % 62;
    num = Math.floor(num / 62);
    base62 = Alphabet[remainder] + base62;
  }
  return base62;
};
```

**Notes on the real implementation (vs. a naive description):**
- **Recursion, not a loop.** Retries happen via recursive calls (`createShortUrl(url, retriedTimes + 1)`), capped at 10 attempts. Functionally equivalent to a loop, but worth knowing if asked to read the stack trace or refactor it.
- **Code length varies.** Because the input is a random integer between `0` and `999,999,999` (not a fixed-width random string), the base62 output is usually **5–6 characters**, occasionally shorter (small numbers encode to fewer characters). This differs from generating a fixed-length 6-char string directly.
- **Double validation exists.** The service calls `isValidUrl()` *in addition to* the Zod schema validation that already ran in the `validate` middleware. This is redundant — see [Interview Q&A](#interview-qa) for why that's worth flagging in a code review.
- **Plain `Error`, not `ApiError`.** The service throws a generic `Error`, not the project's `ApiError` class. `asyncHandler` still catches it, but the error handler falls back to `statusCode = 500` since `Error` has no `statusCode` property — meaning "Invalid URL" thrown here surfaces as a 500, not a 400, even though it's a client error.

### Why This Approach? (Not Sequential or Hash-based)

#### ❌ Sequential Approach
```javascript
// Bad: Just increment: 1, 2, 3, 4, ...
id = 1 → shortCode = "1"  // Reveals business info (only 1 URL shortened?)
id = 1000000 → shortCode = "1000000"  // Exposes scale
```
**Problems:**
- Exposes internal database IDs
- Reveals number of URLs (competitive intelligence)
- Predictable (attackers can guess all codes)
- Sequential numbering is guessable

#### ❌ Hash-based Approach
```javascript
// Bad: Hash the URL and truncate
shortCode = md5(url).substring(0, 6)  // Example: "a3f2d1"
```
**Problems:**
- Same URL always hashes to same code (wastes DB space)
- Truncation causes collisions
- Can't regenerate without storing hash

#### ✅ Random Approach (What We Do)
```javascript
// Good: Generate random base62 code and retry on collision
shortCode = randomBase62(6)  // Example: "AbC123"
```
**Advantages:**
- Different URL → different code (no waste)
- Low collision probability (62^6 = 56 billion possible codes)
- Doesn't expose IDs or scale
- Not predictable (good security)
- Easy to implement

### Why ~6 Characters?

```
Base62 alphabet size: 62 (a-z, A-Z, 0-9)
Random integer space: 0 to 999,999,999 (10^9 values)
62^5 = 916,132,832  ← just under 10^9
62^6 = 56,800,235,584  ← comfortably covers 10^9

So most codes land at 5-6 characters, since 10^9 random values
map into a base62 space sized between 62^5 and 62^6.

Birthday-paradox collision estimate at 10^9 possible inputs:
noticeable collision rate emerges well before 10^9 rows are stored
(this is tighter than a "true" 6-char random string from the full
62^6 space — worth knowing this is a known limitation of the
current implementation, not a deliberate space/collision trade-off).
```

**Known limitation:** Because the random value is drawn from a fixed range (`0`–`999,999,999`) rather than directly sampling 6 base62 characters, the actual keyspace is smaller than `62^6`. As the table grows, collisions (and therefore retries) will become more frequent than a naive `62^6` calculation suggests. A future improvement would be to generate 6 random base62 characters directly, or increase the random integer range.

---

## Express.js Fundamentals

### What is Express?

Express is a **minimal web framework** for Node.js that provides:
- **Routing** — Map URLs to handlers
- **Middleware** — Plugin architecture for request processing
- **Request/Response utilities** — Helpers for parsing, sending data
- **Error handling** — Central error catching mechanism

### Why Express?

We chose Express because:

| Aspect | Express | Why |
|--------|---------|-----|
| **Learning curve** | Easy | Simple, minimal boilerplate |
| **Performance** | High | Lightweight, optimized |
| **Ecosystem** | Massive | Tons of middleware available |
| **Maturity** | Battle-tested | Used by thousands of companies |
| **Flexibility** | Very flexible | Minimal opinions, you decide architecture |

### How Our Express App Works

```javascript
// src/app.js
const express = require('express');
const app = express();

// 1. Middleware (runs on EVERY request, in order)
app.use(helmet());                    // Security
app.use(requestId);                   // Logging
app.use(httpLogger);                  // Observability
app.use(limiter);                     // Rate limiting
app.use(cors({ origin: '*' }));       // CORS
app.use(express.json());              // Parse JSON body

// 2. Routes (specific endpoints)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', pid: process.pid });
});

// Routes for URL shortening
app.use('/', urlRoutes);  // POST /shorten, GET /:code

// 3. Global error handler (catches ALL errors)
app.use(errorHandler);

module.exports = app;
```

### How Requests Flow Through Express

```
1. HTTP Request arrives
   ↓
2. Route matching (Express finds which route handler to call)
   ↓
3. Middleware chain executes (in registration order)
   ↓
4. Route handler (controller) runs
   ↓
5. Response sent OR error thrown
   ↓
6. If error, error handler middleware catches it
   ↓
7. Response sent to client
```

### Key Express Methods We Use

```javascript
// Request handling
app.get(path, handler)          // GET requests
app.post(path, handler)         // POST requests
app.put(path, handler)          // PUT requests
app.delete(path, handler)       // DELETE requests

// Middleware
app.use(middleware)             // Global middleware
app.use(path, middleware)       // Path-specific middleware

// Routing
const router = express.Router()
router.post('/shorten', handler)
app.use('/', router)

// Response methods
res.json(data)                  // Send JSON
res.status(200)                 // Set status
res.header('X-Custom', value)   // Set headers
res.redirect(url)               // Redirect
```

### Interview Questions

**Q1: What's the difference between `app.use()` and route handlers?**

A: 
- `app.use()` runs for EVERY request matching the path (or all requests if no path)
- Route handlers (`app.get()`, `app.post()`) run only for that specific method + path
- Middleware returns nothing; handlers send response

```javascript
// This runs for every request
app.use(logger);

// This runs only for POST /shorten
app.post('/shorten', handler);
```

**Q2: What happens if you don't call `next()` in middleware?**

A: The request hangs. The next middleware/handler won't run. The response won't be sent.

```javascript
app.use((req, res, next) => {
  console.log('Request received');
  // If you forget next(), request stops here!
  next();  // ← MUST call this
});
```

**Q3: Why is error handler middleware always last?**

A: Because middleware is executed in registration order. If error handler is not last, it won't catch errors from later middleware/handlers.

```javascript
// ✅ CORRECT
app.use(routes);
app.use(errorHandler);  // Last

// ❌ WRONG
app.use(errorHandler);  // Won't catch errors from routes!
app.use(routes);
```

---

## Layered Architecture

### What is Layered Architecture?

A design pattern where code is organized into **horizontal layers**, each with a specific responsibility.

### Our 4-Layer Architecture

```
┌─────────────────────────────────────────────┐
│     1. PRESENTATION LAYER (HTTP)            │
│     - Express app                           │
│     - Routes definition                     │
│     - Request/response handling             │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│     2. CONTROLLER LAYER (Business Entry)    │
│     - Receive HTTP request                  │
│     - Call services                         │
│     - Validate response                     │
│     - Send HTTP response                    │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│     3. SERVICE LAYER (Business Logic)       │
│     - Shorten URL logic                     │
│     - Retry mechanism                       │
│     - Data transformation                   │
│     - Call database                         │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│     4. DATABASE LAYER (Persistence)         │
│     - Raw SQL queries                       │
│     - Connection pooling                    │
│     - Error handling for DB                 │
│     - PostgreSQL                            │
└─────────────────────────────────────────────┘
```

### What Each Layer Does

#### Layer 1: Presentation (Routes)
```javascript
// src/routes/url.routes.js
router.post('/shorten', validate(shortenUrlSchema), shorten);
router.get('/:code', validate(redirectSchema), redirect);
```

**Responsibility:**
- Define API endpoints
- Apply validation middleware
- Map URLs to controllers

#### Layer 2: Controllers
```javascript
// src/controllers/url.controller.js
const shorten = asyncHandler(async (req, res) => {
  const { url } = req.body;  // From request
  
  const shortUrl = await urlService.createShortUrl(url);  // Call service
  
  // Validate response matches schema
  const validated = shortenResponseSchema.parse({
    success: true,
    code: shortUrl.short_code,
    short_url: shortUrl.short_url
  });
  
  res.status(201).json({
    statusCode: 201,
    data: validated,
    message: 'Success',
    success: true
  });
});
```

**Responsibility:**
- Receive HTTP requests
- Call appropriate service
- Validate response format
- Send HTTP responses
- Never touch database directly

#### Layer 3: Services
```javascript
// src/services/url.service.js
const createShortUrl = async (originalUrl) => {
  for (let i = 0; i < 10; i++) {
    const shortCode = generateRandomBase62Code(6);
    
    try {
      const result = await db.query(
        'INSERT INTO short_urls (short_code, original_url) VALUES ($1, $2) RETURNING *',
        [shortCode, originalUrl]
      );
      return {
        short_code: result.rows[0].short_code,
        short_url: `${process.env.BASE_URL}/${result.rows[0].short_code}`
      };
    } catch (error) {
      if (error.code !== '23505') throw error;
    }
  }
  throw new Error('Failed to generate unique code');
};
```

**Responsibility:**
- Contain business logic
- Orchestrate database calls
- Handle retries and transformations
- Never know about HTTP/Express

#### Layer 4: Database
```javascript
// Raw queries executed from service
db.query(
  'INSERT INTO short_urls (short_code, original_url) VALUES ($1, $2) RETURNING *',
  [shortCode, originalUrl]
);

db.query(
  'SELECT original_url FROM short_urls WHERE short_code = $1',
  [code]
);
```

**Responsibility:**
- Execute SQL safely
- Return raw data
- Handle connection pooling

### Why Layered Architecture?

| Benefit | How |
|---------|-----|
| **Testability** | Each layer can be tested independently |
| **Reusability** | Services can be used by multiple controllers |
| **Maintainability** | Changes in one layer don't affect others |
| **Scalability** | Easy to add caching, replication layers |
| **Clear responsibility** | Each layer has one job |

### Example: Adding Caching Layer

Without layered architecture, we'd change everywhere.
With layers, we just add a new service method:

```javascript
// New caching layer (Stage 1→2)
const getShortUrlWithCache = async (code) => {
  // Check Redis cache first
  const cached = await redis.get(`short_url:${code}`);
  if (cached) return cached;
  
  // If not cached, get from database
  const data = await db.query(...);
  
  // Cache it
  await redis.set(`short_url:${code}`, data, 'EX', 86400);
  
  return data;
};
```

Controller doesn't change, just calls new method!

### Interview Questions

**Q1: Why separate controller and service layers?**

A:
- **Controllers** should handle HTTP (parsing requests, sending responses)
- **Services** should contain business logic (resusable, testable)
- Services can be used by CLI, API, background jobs, etc.

```javascript
// BAD: Business logic in controller
app.post('/shorten', async (req, res) => {
  const shortCode = generateCode();
  await db.query(...);  // ← DB logic here
  res.json(...);
});

// GOOD: Business logic in service
app.post('/shorten', async (req, res) => {
  const result = await urlService.createShortUrl(req.body.url);
  res.json(result);
});
```

**Q2: What if you need to add caching? How does layered architecture help?**

A: With layers, caching becomes just another service method. Controllers don't change. Example: wrap DB calls with Redis check.

**Q3: How do you test a controller if it calls a service?**

A: Mock the service! Services are dependencies of controllers.

```javascript
const mockService = {
  createShortUrl: jest.fn().mockResolvedValue({ code: 'abc123' })
};

test('should call service', async () => {
  await shortenController(req, res);
  expect(mockService.createShortUrl).toHaveBeenCalledWith(url);
});
```

---

## Middleware Chain

### What We Built

A **middleware chain** that processes every request in sequence:

```
Request → Helmet → RequestId → Logger → RateLimiter → CORS → JSON Parser → Route → Response
```

### Our Middleware Stack

```javascript
// src/app.js
// Order matters!
app.use(helmet());           // 1. Security headers
app.use(requestId);          // 2. Attach request ID
app.use(httpLogger);         // 3. Log request
app.use(limiter);            // 4. Rate limit
app.use(cors({ ... }));      // 5. CORS headers
app.use(express.json());     // 6. Parse JSON body
app.use('/', routes);        // 7. Routes
app.use(errorHandler);       // 8. Error handler
```

### What Each Middleware Does

#### 1. Helmet (Security)
```javascript
// src/middleware/helmet.js
const helmet = require('helmet');
app.use(helmet());

// Sets security headers:
// Content-Security-Policy: default-src 'self'
// X-Frame-Options: SAMEORIGIN
// X-Content-Type-Options: nosniff
// Strict-Transport-Security: max-age=31536000
```

**Why first?** Security should be applied to EVERY request before processing.

#### 2. RequestId (Logging)
```javascript
// src/middleware/requestId.js
app.use((req, res, next) => {
  req.id = crypto.randomUUID();  // Unique ID per request
  next();
});

// Now every log from this request has req.id
// Helps trace requests across logs
```

**Why second?** We need to attach ID early so all downstream logging can use it.

#### 3. HTTP Logger (Observability)
```javascript
// src/middleware/httpLogger.js
const pinoHttp = require('pino-http');
app.use(pinoHttp({ logger }));

// Automatically logs:
// - Request method, URL, headers
// - Response status, time
// - Request ID correlation
```

**Why third?** We've attached ID, now log all requests.

#### 4. Rate Limiter (Traffic Control)
```javascript
// src/middleware/rateLimiter.js
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100                    // 100 requests per window
});
app.use(limiter);
```

**Why fourth?** Reject bad traffic before parsing bodies or processing.

#### 5. CORS (Cross-Origin Requests)
```javascript
// src/app.js
app.use(cors({
  origin: process.env.CORS_ORIGIN,  // Usually *, or specific domain
  credentials: true
}));
```

**Why fifth?** Handle preflight requests, allow cross-origin access.

#### 6. JSON Parser (Request Parsing)
```javascript
// src/app.js
app.use(express.json({ limit: '16kb' }));
```

**Why sixth?** Controllers need parsed `req.body`.

#### 7. Routes (Business Logic)
```javascript
// src/routes/url.routes.js
app.use('/', routes);
```

**Why seventh?** All setup done, now execute business logic.

#### 8. Error Handler (Error Catching)
```javascript
// src/middleware/errorHandler.js
app.use((error, req, res, next) => {
  const status = error.statusCode || 500;
  res.status(status).json({ error: error.message });
});
```

**Why last?** Catches ALL errors from above layers.

### Why Order Matters (Not Arbitrary!)

#### Wrong Order 1: Error handler first
```javascript
app.use(errorHandler);  // Won't catch errors from below!
app.use(routes);
```
Error handler never runs because errors from routes come after.

#### Wrong Order 2: Rate limiter before security
```javascript
app.use(limiter);      // Attackers hit your server first
app.use(helmet);       // Security applied too late
```
Attackers cause DoS, security headers added to error responses.

#### Wrong Order 3: Parser before validation
```javascript
app.use(express.json());
app.use(validation);   // Can't validate, body not parsed!
```
JSON not parsed, validation sees undefined body.

### How to Add New Middleware

```javascript
// Example: Add authentication middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: 'No token' });
  req.user = verifyToken(token);
  next();
};

// Add after rate limiter, before routes
app.use(helmet);
app.use(requestId);
app.use(httpLogger);
app.use(limiter);
app.use(authMiddleware);  // ← New middleware here
app.use(routes);
app.use(errorHandler);
```

### Interview Questions

**Q1: Why is middleware order important?**

A: Each middleware depends on previous ones. For example:
- Logger needs requestId (already attached)
- Routes need body parsed (express.json already ran)
- Error handler catches errors from all above layers
- Wrong order = features don't work

**Q2: What happens if middleware doesn't call `next()`?**

A: The request chain stops. No error handler, no response sent, client hangs.

```javascript
// BAD: Middleware chain stops
app.use((req, res, next) => {
  console.log('Logged');
  // Forgot next()! Request stops here
});

// GOOD
app.use((req, res, next) => {
  console.log('Logged');
  next();  // Continue chain
});
```

**Q3: How do you make middleware apply to only certain routes?**

A: Pass path to `app.use()`:

```javascript
// Apply to all routes
app.use(middleware);

// Apply only to /api/*
app.use('/api', middleware);

// Apply only to specific route
app.post('/admin', adminMiddleware, handler);
```

**Q4: Can you have multiple error handlers?**

A: Only the first one runs. Put it last, and it catches ALL errors above.

```javascript
app.use(routes);
app.use(errorHandler1);  // This one runs for ANY error above
app.use(errorHandler2);  // This never runs
```

---

## Request/Response Cycle

### What Happens Step-by-Step

Let's trace a real request through our middleware chain:

```
Client sends POST request to http://localhost:3000/shorten
{"url": "https://github.com"}

        ↓ STEP 1: REQUEST ARRIVES ↓

Express matches route: POST /shorten
Begins middleware chain...

        ↓ STEP 2: HELMET ↓

app.use(helmet())
Adds security headers to response object
Calls next()

        ↓ STEP 3: REQUEST ID ↓

app.use(requestId)
req.id = "550e8400-e29b-41d4-a716-446655440000"
All logs now include this ID
Calls next()

        ↓ STEP 4: HTTP LOGGER ↓

app.use(httpLogger)
Logs: POST /shorten from IP X.X.X.X at 10:30:45
Starts timer
Calls next()

        ↓ STEP 5: RATE LIMITER ↓

app.use(rateLimiter)
Checks: Is this IP within limit? (95/100 used)
Yes, continues
Adds X-RateLimit headers to response
Calls next()

        ↓ STEP 6: CORS ↓

app.use(cors)
Checks: Is origin allowed? (CORS_ORIGIN = "*")
Yes, adds Access-Control-Allow headers
Calls next()

        ↓ STEP 7: JSON PARSER ↓

app.use(express.json())
Parses request body from bytes to JavaScript object:
req.body = { url: "https://github.com" }
Calls next()

        ↓ STEP 8: VALIDATION MIDDLEWARE ↓

validate(shortenUrlSchema)
Zod validates: Is req.body.url a valid URL?
Yes, continues
Calls next()

        ↓ STEP 9: ROUTE HANDLER (CONTROLLER) ↓

app.post('/shorten', shorten)

shorten() controller runs:
  const { url } = req.body;  // "https://github.com"
  
  try {
    // Call service
    const result = await urlService.createShortUrl(url);
    
    // Build response
    const response = {
      statusCode: 201,
      data: {
        code: result.short_code,
        short_url: result.short_url,
        success: true
      },
      message: "Success",
      success: true
    };
    
    // Validate response shape
    const validated = shortenResponseSchema.parse(response);
    
    // Send response
    res.status(201).json(validated);
  } catch (error) {
    next(error);  // Pass to error handler
  }

        ↓ STEP 10: RESPONSE SENT ↓

HTTP/1.1 201 Created
Content-Type: application/json
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 94
... helmet security headers ...

{
  "statusCode": 201,
  "data": {
    "code": "abc123",
    "short_url": "http://localhost:3000/abc123",
    "success": true
  },
  "message": "Success",
  "success": true
}

        ↓ STEP 11: LOGGER FINISHES ↓

httpLogger middleware finishes
Logs: POST /shorten 201 45ms (status, duration, request ID)

Response sent to client
Request-response cycle complete!
```

### Error Case: Invalid URL

```
Client sends: {"url": "not-a-url"}

        ↓ Same steps 1-7 ↓

        ↓ STEP 8: VALIDATION FAILS ↓

validate(shortenUrlSchema)
Zod checks: Is "not-a-url" a valid URL?
No! Throws validation error
next(error) is called

        ↓ STEP 8B: ERROR HANDLER ↓

app.use(errorHandler)
Catches the validation error
Responds with 400:

HTTP/1.1 400 Bad Request
{
  "statusCode": 400,
  "data": {
    "success": false,
    "errors": [
      {
        "field": "body.url",
        "message": "Invalid URL format"
      }
    ]
  },
  "message": "Success",
  "success": false
}

        ↓ STEP 9: LOGGER FINISHES ↓

Logs: POST /shorten 400 2ms
```

### Interview Questions

**Q1: What is middleware and why do we need it?**

A: Middleware is functions that process requests before they reach handlers. We need it because:
- Security (Helmet)
- Logging (tracking requests)
- Rate limiting (prevent abuse)
- Parsing (convert bytes to objects)
- Validation (ensure input quality)

**Q2: Trace a request through our middleware. What does each step do?**

A: [As shown above in the detailed trace]

**Q3: What happens if validation fails?**

A: Validation middleware calls `next(error)` with the error. The error handler catches it and responds with 400 Bad Request.

**Q4: Why do we validate in middleware instead of in the controller?**

A: Because middleware is cleaner and reusable. If validation fails, the controller never runs. Cleaner separation of concerns.

---

## Database Design & Optimization

### What We Built

A **PostgreSQL database** with a single table for storing URL mappings:

```sql
CREATE TABLE short_urls (
  id SERIAL PRIMARY KEY,
  short_code VARCHAR(10) UNIQUE NOT NULL,
  original_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_short_code ON short_urls(short_code);
```

### What Each Column Does

| Column | Type | Purpose | Why |
|--------|------|---------|-----|
| `id` | SERIAL PRIMARY KEY | Internal identifier | Every table needs a unique ID |
| `short_code` | VARCHAR(10) UNIQUE | User-facing short URL | What clients use; must be unique |
| `original_url` | TEXT | The full URL | What we redirect to |
| `created_at` | TIMESTAMP | Audit trail | When was URL shortened (analytics) |

### Why PostgreSQL?

| Aspect | PostgreSQL | Why |
|--------|-----------|-----|
| **Reliability** | ACID compliance | Data won't corrupt |
| **Scale** | Handles millions of rows | URL shortener will grow |
| **Indexing** | Excellent indexing | Fast lookups by short_code |
| **Types** | Strong typing | Data integrity |
| **Community** | Huge, active | Help available, well-documented |

#### ACID Explained

- **A**tomicity: Transaction all-or-nothing (insert both columns or neither)
- **C**onsistency: Data stays valid (UNIQUE constraint enforced)
- **I**solation: Concurrent requests don't interfere
- **D**urability: Data survives crashes

### Index Strategy: Why `idx_short_code`?

#### Without Index
```
SELECT original_url FROM short_urls WHERE short_code = 'abc123'

Database must scan EVERY row to find 'abc123'
1,000,000 URLs → scans 1,000,000 rows → SLOW
```

#### With Index
```
SELECT original_url FROM short_urls WHERE short_code = 'abc123'

Database uses B-tree index
Finds 'abc123' in ~20 comparisons → FAST
1,000,000 URLs → scans ~20 rows → 50,000x faster!
```

**Why only on short_code?**
- Shorten endpoint: insert (no WHERE needed, no index helps)
- Redirect endpoint: WHERE short_code = ? (index helps!)
- Redirects are 10-100x more common than shortens
- Index every column used in WHERE clauses

### Handling Uniqueness: Retry Strategy

#### The Challenge
```
We want to generate codes randomly:
Code = "abc123" → Insert
Code = "def456" → Insert
Code = "abc123" again → COLLISION!

How do we handle collisions?
```

#### Bad Approach: Check Then Insert
```javascript
// ❌ BAD: Race condition
const exists = await db.query(
  'SELECT id FROM short_urls WHERE short_code = $1',
  [code]
);

if (!exists.rows.length) {
  // Between check and insert, another request
  // inserts same code!
  await db.query('INSERT INTO short_urls ...');
}
```

**Problem:** Race condition! Another request might insert code between check and insert.

#### Good Approach: Insert with Retry (our actual implementation, recursive)
```javascript
// ✅ GOOD: Let database enforce unique constraint
async function createShortUrl(url, retriedTimes = 0) {
  if (retriedTimes === 10) {
    throw new Error('Failed to insert after 10 retries');
  }

  const code = base62(Math.floor(Math.random() * 1000000000));

  try {
    await db.query(
      'INSERT INTO short_urls (short_code, original_url) VALUES ($1, $2)',
      [code, url]
    );
    return code;
  } catch (error) {
    // PostgreSQL error 23505 = unique constraint violation
    if (error.code === '23505') {
      return createShortUrl(url, retriedTimes + 1);  // recurse, try new code
    }
    throw error;  // different error, rethrow
  }
}
```

A `for` loop would work just as well functionally — the project uses recursion instead. Either is valid; recursion here keeps the function self-contained without an explicit loop variable, at the minor cost of stacking call frames up to 10 deep on heavy collision.

**Why better:**
- No race conditions (database enforces uniqueness)
- Simpler code (one query instead of two)
- More efficient (usually succeeds first try)

### Connection Pooling

```javascript
// src/config/db.js
const pool = new pg.Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  // Pool reuses connections
  // Without pool: new connection for each query = slow
  // With pool: reuse connections = fast
});

const query = (text, params) => {
  return pool.query(text, params);
};
```

**Why pooling?**
- Creating a database connection takes ~100ms
- Reusing connections takes ~1ms
- 100x performance improvement!
- Limits max connections (prevents exhaustion)

### Parameterized Queries

```javascript
// ❌ BAD: String concatenation (SQL injection risk!)
const url = "'; DROP TABLE short_urls; --";
const query = `INSERT INTO short_urls (original_url) VALUES ('${url}')`;
// Becomes: INSERT INTO short_urls (original_url) VALUES (''; DROP TABLE short_urls; --')
// Deletes entire table!

// ✅ GOOD: Parameterized queries
const url = "'; DROP TABLE short_urls; --";
const query = 'INSERT INTO short_urls (original_url) VALUES ($1)';
const result = await db.query(query, [url]);
// Database treats $1 as DATA, not SQL
// URL is safely escaped
```

### Interview Questions

**Q1: Why do we use PostgreSQL instead of MongoDB?**

A: PostgreSQL is better for this use case because:
- ACID compliance (data won't corrupt)
- Structured data (URLmappings are simple: code → URL)
- Excellent indexing (fast lookups)
- Joins (if we add users, comments, etc.)
- Cost (PostgreSQL is cheaper for structured data)

MongoDB is better for unstructured data (documents, JSON).

**Q2: What's the difference between `id` and `short_code`? Why do we need both?**

A:
- `id`: Internal database identifier (1, 2, 3...) - never exposed to clients
- `short_code`: User-facing identifier (abc123) - what clients use in URLs

We need both because:
- `id` is efficient for joins and internal operations
- `short_code` is what users see and must be unique

**Q3: Why index short_code but not id?**

A: `id` is already indexed (PRIMARY KEY is automatically indexed). We index `short_code` because:
- Most queries are: WHERE short_code = ?
- Without index, each redirect scans entire table
- With index, lookups are O(log n) instead of O(n)

**Q4: Explain the collision handling strategy. Why not check-then-insert?**

A: Check-then-insert has a race condition:

```
Thread 1: SELECT * WHERE code='abc123' → not found
Thread 2: SELECT * WHERE code='abc123' → not found
Thread 1: INSERT 'abc123'
Thread 2: INSERT 'abc123' → ERROR! Unique violation

Solution: Let database enforce uniqueness, retry on violation
```

**Q5: Why use parameterized queries?**

A: Prevents SQL injection attacks. Examples:

```javascript
// ❌ User input directly in SQL
const url = "'; DROP TABLE short_urls; --";
const dangerous = `INSERT INTO short_urls VALUES ('${url}')`;
// This drops the entire table!

// ✅ Use parameters
const safe = 'INSERT INTO short_urls VALUES ($1)';
await db.query(safe, [url]);
// Database treats input as data, not SQL
```

**Q6: What happens if connection pool is exhausted?**

A: New requests queue up waiting for a connection. If queue grows too much:
- Requests timeout
- Clients get 5XX errors
- Service becomes unresponsive

Solution: Monitor pool usage, set connection limits based on capacity.

---

## Input Validation with Zod

### What We Built

A **schema validation system** using Zod to ensure all inputs are valid before processing:

```javascript
// src/validators/url.validator.js
const shortenUrlSchema = z.object({
  body: z.object({
    url: z.string()
      .min(1, 'URL is required')
      .url('Invalid URL format')  // ← Validates URL format
  })
});

const redirectSchema = z.object({
  params: z.object({
    code: z.string()
      .min(3, 'Code too short')
      .max(20, 'Code too long')
  })
});

const shortenResponseSchema = z.object({
  success: z.boolean(),
  code: z.string(),
  short_url: z.string().url()
});
```

### Why Zod (Not Just Manual Validation)?

#### Manual Validation (❌ Messy)
```javascript
// ❌ BAD: Validation spread everywhere
app.post('/shorten', (req, res) => {
  const { url } = req.body;
  
  // Validation scattered
  if (!url) {
    return res.status(400).json({ error: 'URL required' });
  }
  
  if (typeof url !== 'string') {
    return res.status(400).json({ error: 'URL must be string' });
  }
  
  if (url.length < 1) {
    return res.status(400).json({ error: 'URL too short' });
  }
  
  // Try to validate URL format (regex is complex)
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }
  
  // NOW business logic
});
```

#### Zod (✅ Clean)
```javascript
// ✅ GOOD: Schema is single source of truth
const schema = z.object({
  url: z.string().min(1).url()
});

const validate = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (error) {
    res.status(400).json({ errors: error.issues });
  }
};

app.post('/shorten', validate(schema), handler);
```

### Validation Flow

```
Request arrives with data

      ↓

Zod schema validates:
- Is url provided?
- Is url a string?
- Is url a valid URL?

      ↓

If valid: Continue to handler
If invalid: Return 400 with error details
```

### Real Examples

#### Valid Request
```bash
curl -X POST http://localhost:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://github.com"}'
```

**Validation passes**, continues to handler.

#### Invalid: Missing Field
```bash
curl -X POST http://localhost:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Response (400):**
```json
{
  "statusCode": 400,
  "data": {
    "success": false,
    "errors": [
      {
        "field": "body.url",
        "message": "Required"
      }
    ]
  }
}
```

#### Invalid: Not a URL
```bash
curl -X POST http://localhost:3000/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url": "not-a-url"}'
```

**Response (400):**
```json
{
  "statusCode": 400,
  "data": {
    "success": false,
    "errors": [
      {
        "field": "body.url",
        "message": "Invalid url"
      }
    ]
  }
}
```

### Response Validation

```javascript
// We also validate responses!
const shortenResponseSchema = z.object({
  success: z.boolean(),
  code: z.string(),
  short_url: z.string().url()
});

// In controller
const response = {
  success: true,
  code: 'abc123',
  short_url: 'http://localhost:3000/abc123'
};

const validated = shortenResponseSchema.parse(response);
res.json(validated);  // If validation fails, error handler catches
```

**Why validate responses?**
- Ensures API contract is kept
- Catches bugs before sending to clients
- Single source of truth for API shape

### Interview Questions

**Q1: Why validate input?**

A: Because invalid input causes problems:
- Crashes (e.g., calling `.toLowerCase()` on non-string)
- Security issues (SQL injection, XSS)
- Bad data in database
- Poor user experience

Validating early catches problems before they propagate.

**Q2: What's the difference between validation and type checking?**

A:
- **Type checking** (TypeScript): Compile-time, before code runs
- **Validation** (Zod): Runtime, when data arrives

Both are important:
- TypeScript catches bugs during development
- Zod catches invalid external input at runtime

```typescript
// TypeScript: compile-time
const url: string = getValue();  // If getValue() returns number → error

// Zod: runtime
const schema = z.object({ url: z.string() });
schema.parse(userInput);  // If userInput.url isn't string → error
```

**Q3: Should you validate response from your own code?**

A: Yes! Because:
- Catches bugs early (you send wrong shape)
- Documents API contract (response shape is schema)
- Prevents breaking clients

**Q4: What if validation fails? Where should error be handled?**

A: In middleware or globally. Don't duplicate error handling everywhere.

```javascript
// Validation in middleware
const validate = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (error) {
    // Handle error once, centrally
    return res.status(400).json({ errors: error.issues });
  }
};
```

**Q5: What does `z.string().url()` do?**

A: It validates that the string is a valid URL using Node's URL parsing:

```javascript
z.string().url()

// Accepts:
'https://github.com'
'http://localhost:3000'
'https://example.com/path?query=value'

// Rejects:
'not a url'
'github.com'  // Missing protocol
'javascript:alert(1)'  // Not HTTP/HTTPS
```

---

## Error Handling Pattern

### What We Built

A **centralized error handling system** where:
1. Errors are thrown from any layer
2. Middleware catches them
3. Error handler responds consistently

### The Pattern

```javascript
// Layer 1: Define error class
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Layer 2: Controllers throw errors
const shorten = asyncHandler(async (req, res) => {
  const result = await urlService.createShortUrl(req.body.url);
  if (!result) {
    throw new ApiError(500, 'Failed to create short URL');  // ← Throw
  }
  res.json(result);
});

// Layer 3: asyncHandler wraps controller
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);  // ← Catch and pass
};

// Layer 4: Error handler middleware
app.use((error, req, res, next) => {  // Must have 4 params!
  const status = error.statusCode || 500;
  res.status(status).json({
    statusCode: status,
    success: false,
    message: error.message
  });
});
```

### Error Flow Diagram

```
Controller throws error
        ↓
asyncHandler catches promise rejection
        ↓
Calls next(error)
        ↓
Express routes to error handler middleware
        ↓
Error handler sends JSON response
        ↓
Client receives error
```

### Real Examples

#### Successful Request
```
POST /shorten → Controller → Service → Database → Response
```

#### Error in Controller (sync)
```
POST /shorten
  ↓
Controller: throw new ApiError(400, 'Invalid input')
  ↓
asyncHandler: nope, was sync, not caught!
  ↓
Error handler: ERROR! Not caught!
  
✅ FIX: Controller must be async or use try-catch
```

#### Error in Service (async)
```
POST /shorten
  ↓
Controller: const result = await service.doSomething()
  ↓
Service throws: throw new Error('Database connection failed')
  ↓
asyncHandler catches promise rejection
  ↓
asyncHandler calls: next(error)
  ↓
Error handler middleware
  ↓
Response: 500 Internal Server Error
```

#### Validation Error
```
POST /shorten with invalid URL
  ↓
Validation middleware checks schema
  ↓
Zod throws: ZodError
  ↓
Validation middleware catches
  ↓
Response: 400 Bad Request (no error handler needed)
```

### Why asyncHandler?

```javascript
// ❌ BAD: Unhandled promise rejection
const shorten = async (req, res) => {
  // If any await rejects, it's not caught!
  const result = await db.query(...);  // If this rejects...
  res.json(result);  // ...error is not caught anywhere
};

// ✅ GOOD: asyncHandler wraps controller
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);  // ← Catches rejects
};

const shorten = asyncHandler(async (req, res) => {
  const result = await db.query(...);  // Rejection caught
  res.json(result);
});
```

### Error Response Format

```json
{
  "statusCode": 400,
  "success": false,
  "message": "Invalid URL format",
  "data": null
}
```

### Interview Questions

**Q1: Why centralize error handling?**

A: Because consistent error handling:
- Ensures all errors return same format
- Prevents duplicating error code everywhere
- Makes debugging easier (know where errors go)
- Makes changing error format easy (change one place)

**Q2: What's the difference between throwing an error and returning an error?**

A:
```javascript
// ❌ Return error (bad for async)
const handler = (req, res) => {
  const result = doSomething();
  if (!result) {
    return res.status(400).json({ error: 'Failed' });
  }
  res.json(result);
};

// ✅ Throw error (good, explicit intent)
const handler = asyncHandler(async (req, res) => {
  const result = await doSomething();
  if (!result) {
    throw new ApiError(400, 'Failed');  // ← Clear this is an error
  }
  res.json(result);
});
```

Throwing is better because:
- Error handler catches ALL throws (async, sync, etc.)
- Clear intent (throw = error, return = success)
- Can't forget error handling

**Q3: Why does error handler have 4 parameters?**

A: Express checks parameter count. 4 params = error handler.

```javascript
// 3 params = normal middleware
app.use((req, res, next) => {});

// 4 params = error handler (Express routes errors here)
app.use((error, req, res, next) => {});
```

**Q4: What happens if you throw an error in error handler?**

A: It crashes the server. Always respond in error handler.

```javascript
app.use((error, req, res, next) => {
  // ✅ MUST respond
  res.status(500).json({ error: error.message });
  
  // ❌ DON'T throw again
  // throw new Error('...');
});
```

**Q5: How do you handle database errors?**

A: Catch in service, convert to ApiError:

```javascript
// Service
const createUrl = async (url) => {
  try {
    return await db.query(INSERT_SQL);
  } catch (error) {
    if (error.code === '23505') {
      // Unique violation, retry
    }
    throw new ApiError(500, 'Database error');  // ← Generic message
    // Log actual error internally for debugging
  }
};
```

---

## Structured Logging with Pino

### What We Built

A **structured logging system** where logs are JSON objects (not strings), enabling:
- Machine-readable logs
- Easy searching in ELK / Datadog
- Log correlation by request ID
- Performance monitoring

### The System

```javascript
// src/lib/logger.js
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true  // Pretty print in development
    }
  }
});

module.exports = logger;
```

### How It Works

#### Development: Pretty-Printed
```bash
npm run dev

# Logs appear like:
[15:30:45.123] INFO: POST /shorten 201 45ms requestId=550e8400
[15:30:46.456] INFO: GET /abc123 301 2ms requestId=e29b41d4
[15:30:47.789] ERROR: Database connection failed requestId=a716446
```

#### Production: Raw JSON
```bash
NODE_ENV=production npm start

# Logs output as JSON (one per line):
{"level":"info","time":"2026-06-20T15:30:45.123Z","pid":12345,"msg":"POST /shorten 201 45ms","requestId":"550e8400"}
{"level":"info","time":"2026-06-20T15:30:46.456Z","pid":12345,"msg":"GET /abc123 301 2ms","requestId":"e29b41d4"}
{"level":"error","time":"2026-06-20T15:30:47.789Z","pid":12345,"msg":"Database connection failed","requestId":"a716446"}
```

### HTTP Logging (pino-http)

```javascript
// src/middleware/httpLogger.js
const pinoHttp = require('pino-http');

const httpLogger = pinoHttp({
  logger,
  customLogLevel: (req, res) => {
    if (res.statusCode >= 400) return 'error';
    if (res.statusCode >= 300) return 'warn';
    return 'info';
  }
});

app.use(httpLogger);

// Automatically logs every request:
// - Method, URL, status, duration
// - Request ID (from req.id)
// - Response headers
// - Query params (safe)
```

### Request ID Correlation

```javascript
// Every log from the same request has same ID
// src/middleware/requestId.js
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  next();
});

// In logs
// [15:30:45] INFO: Request received requestId=abc123
// [15:30:45] INFO: Database query requestId=abc123
// [15:30:45] INFO: Response sent requestId=abc123
// ↑ Same ID = can trace single request through all logs
```

### Log Levels

```javascript
logger.fatal('App crashed');       // Level 60
logger.error('Database failed');   // Level 50
logger.warn('High memory usage');  // Level 40
logger.info('Request received');   // Level 30
logger.debug('Detailed info');     // Level 20
logger.trace('Very detailed');     // Level 10
```

### Structured Data

```javascript
// ❌ Unstructured (strings)
logger.info(`User ${userId} logged in`);
// Output: "User 123 logged in"
// Hard to search: Can't easily find by userId

// ✅ Structured (objects)
logger.info({ userId, action: 'login', timestamp: Date.now() });
// Output: {"userId":123,"action":"login","timestamp":1687...}
// Easy to search: queries like: userId=123 AND action=login
```

### Production Setup

```bash
# Production redirects logs to external service
# Usually ELK Stack (Elasticsearch, Logstash, Kibana) or Datadog

# Benefits:
# - Centralized logging (logs from all servers in one place)
# - Full-text search (find errors by message, userId, etc.)
# - Alerting (email if error rate > 5%)
# - Dashboards (visualize request patterns)
# - History (logs retained for 30 days)
```

### Interview Questions

**Q1: What's the difference between structured and unstructured logging?**

A:
```javascript
// Unstructured: String logs
console.log('User 123 from IP 192.168.1.1 logged in');

// Machine can't parse this. Hard to find logs about user 123.

// Structured: JSON logs
logger.info({ userId: 123, ip: '192.168.1.1', action: 'login' });

// Machine can parse. Easy to query: userId=123 AND action=login
```

**Q2: Why log the request ID?**

A: To trace a single request through all logs:

```
Request arrives
  ↓ log: requestId=abc123
Database query
  ↓ log: requestId=abc123
Response sent
  ↓ log: requestId=abc123

Now can search by requestId=abc123 and see entire request flow
```

**Q3: What's the difference between info, warn, error, debug levels?**

A:
```
fatal (60) - App is crashing
error (50) - Something went wrong (DB error, validation failed)
warn (40)  - Something unusual (slow query, high memory)
info (30)  - Normal operations (request received, user logged in)
debug (20) - Detailed info (variable values, function calls)
trace (10) - Very detailed (every operation)

In development: use debug level (see lots of info)
In production: use info level (less noise, critical stuff only)
```

**Q4: How do you log in production without flooding logs?**

A: Use appropriate log levels:

```javascript
// Don't do this in production (too much data)
logger.debug(`Query ${SQL} with params ${params}`);

// Do this (less data, critical info only)
if (queryTime > 1000) {
  logger.warn({ queryTime, sql: SQL, duration });  // Alert on slow queries
}
```

**Q5: How do you integrate with ELK or Datadog?**

A: Redirect logs to external service:

```javascript
// In production, logs go to stdout (JSON)
// Docker/Kubernetes redirects stdout to log agent
// Log agent (Filebeat, Logstash) sends to ELK/Datadog

// No code change needed! Just infrastructure.
```

---

## Rate Limiting Strategy

### What We Built

A **rate limiting system** that restricts requests to 100 per 15 minutes per IP:

```javascript
// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15-minute window
  max: 100,                   // 100 requests per window
  message: 'Too many requests, please try again later',
  standardHeaders: true,      // Return rate limit info in headers
  legacyHeaders: false,
  skip: (req) => req.path === '/health'  // Don't limit health checks
});

app.use(limiter);
```

### How It Works

```
Request 1 arrives from IP 192.168.1.1
  ↓
Limiter checks: How many requests from this IP in last 15 min?
  ↓
Count: 0 (first request)
  ↓
Limit check: 0 < 100? Yes, allow
  ↓
Request proceeds
  ↓
Add headers:
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 99
  X-RateLimit-Reset: 1687299600

---

Request 101 arrives from same IP (within 15 min)
  ↓
Limiter checks count
  ↓
Count: 100 (at limit)
  ↓
Limit check: 100 < 100? No, reject!
  ↓
Response 429 Too Many Requests
  ↓
Headers:
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 0
  X-RateLimit-Reset: 1687299600 (in 5 minutes)

Client sees "Retry after 5 minutes"
```

### Rate Limit Headers

```
X-RateLimit-Limit: 100
  ↑ Maximum requests per window

X-RateLimit-Remaining: 42
  ↑ How many requests left

X-RateLimit-Reset: 1687299600
  ↑ Unix timestamp when window resets
```

### Why Rate Limiting?

| Reason | What It Prevents |
|--------|-----------------|
| **DoS Protection** | Malicious users flooding with requests |
| **Resource Protection** | Database getting overwhelmed |
| **Fair Use** | All users get equal share |
| **Cost Control** | Cloud services are billed per request |
| **Graceful Degradation** | Better to reject than crash |

#### Example: Without Rate Limiting
```
Attacker sends 1,000,000 requests/second
  ↓
Database handles 100 queries/second
  ↓
Queue grows: 10,000 pending requests
  ↓
Memory usage grows: Server runs out of RAM
  ↓
Server crashes
  ↓
All users affected (even legitimate ones)
```

#### Example: With Rate Limiting
```
Attacker sends 1,000,000 requests/second
  ↓
Limiter rejects after 100/IP
  ↓
Attacker gets 429 Too Many Requests
  ↓
Database handles ~100 requests/second
  ↓
Legitimate users unaffected
```

### Advanced Rate Limiting

#### Rate Limit by User ID
```javascript
const userLimiter = rateLimit({
  keyGenerator: (req) => req.user?.id || req.ip,
  windowMs: 60 * 1000,  // 1 minute
  max: 10               // 10 per minute per user
});

app.use('/admin', userLimiter);
```

#### Different Limits for Different Endpoints
```javascript
const strictLimiter = rateLimit({ windowMs: 60000, max: 5 });
const lenientLimiter = rateLimit({ windowMs: 60000, max: 100 });

app.post('/login', strictLimiter, loginHandler);  // Brute force protection
app.get('/search', lenientLimiter, searchHandler); // Less restricted
```

#### Disable Rate Limiting for Internal Requests
```javascript
const limiter = rateLimit({
  skip: (req) => {
    return req.ip.startsWith('10.0') ||  // Internal network
           req.path === '/health';        // Health checks
  }
});
```

### Interview Questions

**Q1: Why rate limit?**

A: To prevent abuse and protect resources:
- Prevents DoS attacks (user sends 1M requests/second)
- Protects database from overload
- Fair use (all users get equal share)
- Cost control (you pay per request in cloud)

**Q2: What's the difference between IP-based and user-based rate limiting?**

A:
```javascript
// IP-based: Limit per IP address
// Good for public APIs (detect abusive IPs)
// Bad for shared networks (N users behind 1 IP)
keyGenerator: (req) => req.ip

// User-based: Limit per user ID
// Good for authenticated APIs (fairness per user)
// Bad for public APIs (users not logged in)
keyGenerator: (req) => req.user?.id
```

**Q3: What should the limits be?**

A: Depends on use case:
- Shorten API: 100/15 min (typically ~7 requests/min, leaves margin)
- Login endpoint: 5/minute (prevents brute force)
- Read-only search: 100/minute (less sensitive)
- Health check: unlimited (internal use)

Rule of thumb: 10x normal usage as limit.

**Q4: What's the difference between 429 and 503?**

A:
- **429 Too Many Requests**: Client sent too many requests
- **503 Service Unavailable**: Server is overloaded

Both mean "try again later", but for different reasons.

**Q5: How do you handle rate limiting in load-balanced systems?**

A: Problem: If you have 3 servers, attacker sends 100 req/server = 300 total (bypasses limit).

Solution: Use shared rate limiter:
```javascript
// Instead of in-memory rate limiter (per server)
const limiter = rateLimit();

// Use Redis-based rate limiter (shared across servers)
const RedisStore = require('rate-limit-redis');
const limiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rate-limit:'
  })
});
```

---

## Security with Helmet

### What We Built

**Helmet middleware** that automatically sets security headers protecting against common web vulnerabilities:

```javascript
// src/app.js
const helmet = require('helmet');
app.use(helmet());
```

### Security Headers Set by Helmet

#### 1. Content Security Policy (CSP)
```
Content-Security-Policy: default-src 'self';script-src 'self' cdn.example.com
```

**Protects against:** XSS (Cross-Site Scripting)  
**What it does:** Only load scripts from same domain + cdn.example.com

#### 2. X-Frame-Options
```
X-Frame-Options: SAMEORIGIN
```

**Protects against:** Clickjacking  
**What it does:** Only allow embedding in iframes from same domain

#### 3. X-Content-Type-Options
```
X-Content-Type-Options: nosniff
```

**Protects against:** MIME type sniffing  
**What it does:** Browser must respect Content-Type header, can't guess

#### 4. Strict-Transport-Security (HSTS)
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

**Protects against:** Downgrade to HTTP  
**What it does:** Force HTTPS for 1 year

#### 5. X-XSS-Protection
```
X-XSS-Protection: 0
```

**Protects against:** XSS (deprecated, use CSP instead)

#### 6. Referrer-Policy
```
Referrer-Policy: no-referrer
```

**Protects against:** Information leakage  
**What it does:** Don't send referer header

### Real Examples of Attacks

#### Attack 1: XSS (Cross-Site Scripting)

```html
<!-- Attacker injects script -->
<img src="x" onerror="alert('hacked!')">

<!-- CSP prevents this -->
<script> 
// This script from different domain won't load
// CSP: default-src 'self' only allows same-domain scripts
</script>
```

**CSP Header prevents:** Loading scripts from attacker's domain

#### Attack 2: Clickjacking

```html
<!-- Attacker's website -->
<iframe src="http://yourbank.com/transfer" style="opacity: 0;"></iframe>
<!-- Invisible button overlaid on top, tricks user -->
<button>Click here to win $1000!</button>
```

**X-Frame-Options prevents:** Your site can't be embedded in iframe

#### Attack 3: MIME Sniffing

```javascript
// Attacker uploads fake image
// Content-Type: image/jpeg
// But file contains: <script>alert('hacked')</script>

// Without X-Content-Type-Options
// Browser thinks: "It's an image... but it looks like script"
// Executes script (dangerous!)

// With X-Content-Type-Options: nosniff
// Browser thinks: "Header says image, must be image"
// Doesn't execute script
```

#### Attack 4: Downgrade to HTTP

```
User visits: https://myapp.com
Attacker intercepts traffic (Man-in-the-Middle)
Downgrades connection to: http://myapp.com
Intercepts sensitive data (passwords, tokens)

HSTS prevents this:
Browser: "I saw max-age=31536000, must always use HTTPS"
User visits http://myapp.com
Browser automatically upgrades to https://myapp.com
Attacker can't intercept
```

### Helmet Configuration

```javascript
// Basic setup (all defaults)
app.use(helmet());

// Custom configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'trusted-cdn.com'],
      styleSrc: ["'self'", 'fonts.googleapis.com']
    }
  },
  hsts: {
    maxAge: 31536000,        // 1 year
    includeSubDomains: true,
    preload: true            // Add to HSTS preload list
  }
}));
```

### Interview Questions

**Q1: What security vulnerabilities does Helmet protect against?**

A:
1. **XSS** - Content Security Policy
2. **Clickjacking** - X-Frame-Options
3. **MIME sniffing** - X-Content-Type-Options
4. **Downgrade attack** - HSTS
5. **Information leakage** - Referrer-Policy

**Q2: What's the difference between CSP and HSTS?**

A:
- **CSP** (Content Security Policy): Controls what scripts/styles can load
- **HSTS** (Strict-Transport-Security): Forces HTTPS connection

**Q3: Can Helmet prevent SQL injection?**

A: No. SQL injection is on the server-side. Helmet protects client-side attacks (XSS, clickjacking).

Prevent SQL injection with:
- Parameterized queries (not string concatenation)
- Input validation
- Principle of least privilege (DB user has minimal permissions)

**Q4: Why is `X-Content-Type-Options: nosniff` important?**

A: Browsers can "guess" file types by scanning content (MIME sniffing). Attacker uploads:
```
File: fake-image.jpg
Content-Type: image/jpeg (wrong!)
Content: <script>alert('hacked')</script>

Without nosniff: Browser sees script, executes it (vulnerable)
With nosniff: Browser respects Content-Type, treats as image (safe)
```

**Q5: What does HSTS max-age mean?**

A: After visiting your site with HSTS header:
```
Browser stores: "This site requires HTTPS for 31536000 seconds"
max-age = 31536000 seconds = 1 year

For 1 year:
User tries: http://myapp.com
Browser: "I remember, must use HTTPS"
Upgrades to: https://myapp.com

If attacker intercepts http connection
Browser won't downgrade to HTTP (can't be tricked)
```

---

## Code Organization & Patterns

### What We Built

A **structured codebase** organized into layers with clear responsibilities:

```
src/
├── app.js                      # Express app setup
├── server.js                   # Server entry point
├── config/db.js                # Database connection
├── controllers/
│   └── url.controller.js       # HTTP handlers
├── services/
│   └── url.service.js          # Business logic
├── routes/
│   └── url.routes.js           # Route definitions
├── validators/
│   └── url.validator.js        # Zod schemas
├── middleware/
│   ├── errorHandler.js         # Error handler
│   ├── validate.js             # Validation middleware
│   ├── rateLimiter.js          # Rate limiting
│   ├── httpLogger.js           # HTTP logging
│   └── requestId.js            # Request ID
├── utils/
│   ├── ApiError.js             # Error class
│   ├── asyncHandler.js         # Async wrapper
│   └── base62.js               # URL encoding
├── lib/
│   └── logger.js               # Pino logger
└── migrations/
    └── create_urls.sql         # Database schema
```

### Why This Structure?

| Folder | Purpose | Example |
|--------|---------|---------|
| `controllers/` | Handle HTTP requests | Parse input, call service, send response |
| `services/` | Business logic | Retry logic, data transformation |
| `routes/` | URL to handler mapping | `POST /shorten → shortenController` |
| `validators/` | Input/output schemas | Zod validation rules |
| `middleware/` | Request processing | Logging, validation, security |
| `utils/` | Helper functions | Error class, async wrapper |
| `lib/` | External integrations | Logger setup |
| `config/` | Configuration | Database connection |

### File Naming Conventions

```
url.controller.js     ← Controller for URL feature
url.service.js        ← Service for URL feature
url.routes.js         ← Routes for URL feature
url.validator.js      ← Validators for URL feature
errorHandler.js       ← Global error handler (no feature prefix)
asyncHandler.js       ← Utility (no feature prefix)
```

### Single Responsibility Principle

Each file has ONE job:

```javascript
// ✅ GOOD: Controller only handles HTTP
// controllers/url.controller.js
const shorten = asyncHandler(async (req, res) => {
  const result = await urlService.createShortUrl(req.body.url);
  res.status(201).json(result);
});

// ✅ GOOD: Service only handles business logic
// services/url.service.js
const createShortUrl = async (url) => {
  for (let i = 0; i < 10; i++) {
    const code = generateRandomCode();
    try {
      return await db.query(INSERT_QUERY, [code, url]);
    } catch (error) {
      if (error.code !== '23505') throw error;
    }
  }
};

// ❌ BAD: Controller mixes HTTP + business logic
const shorten = async (req, res) => {
  const url = req.body.url;
  
  // Business logic here (should be in service!)
  for (let i = 0; i < 10; i++) {
    const code = generateRandomCode();
    // ... retry logic ...
  }
  
  res.json(result);
};
```

### Testing implications

With good organization, testing is easy:

```javascript
// Easy to test service (no HTTP dependency)
test('should retry on collision', async () => {
  const result = await urlService.createShortUrl('https://example.com');
  expect(result.short_code).toBeDefined();
});

// Easy to test controller (mock service)
test('should return 201', async () => {
  const mockService = { createShortUrl: jest.fn().mockResolvedValue(...) };
  const res = await request(app).post('/shorten');
  expect(res.status).toBe(201);
});

// Hard to test with mixed logic
// Can't test without HTTP server + database
```

### Interview Questions

**Q1: Why separate controllers and services?**

A: **Controllers** handle HTTP, **services** handle logic.

```javascript
// Controller's job: HTTP
- Parse request
- Call service
- Format response

// Service's job: Logic
- Shorten URL
- Retry on collision
- Transform data

Service can be used by:
- REST API
- GraphQL API  
- CLI tool
- Background job
- gRPC service

If logic in controller, must duplicate for each interface!
```

**Q2: How do you test this code?**

A: By mocking dependencies at layer boundaries:

```javascript
// Unit test: Service (no dependencies)
test('should retry on collision', () => {
  const result = urlService.createShortUrl(...);
  expect(result).toBeDefined();
});

// Unit test: Controller (mock service)
test('should return 201', () => {
  const mockService = { createShortUrl: jest.fn(...) };
  const res = controller(mockService);
  expect(res.status).toBe(201);
});

// Integration test: Full flow (real dependencies)
test('should create short URL end-to-end', () => {
  const res = request(app).post('/shorten');
  expect(res.status).toBe(201);
});
```

**Q3: How would you add caching? Where?**

A: In service layer, wrapping database calls:

```javascript
// service/url.service.js
const getUrl = async (code) => {
  // Check cache first
  const cached = await redis.get(`url:${code}`);
  if (cached) return cached;
  
  // Get from database
  const data = await db.query(SELECT_QUERY, [code]);
  
  // Cache it
  await redis.set(`url:${code}`, data);
  
  return data;
};

// Controller doesn't change!
// Controller doesn't need to know about cache
// Service handles it internally
```

**Q4: What if you need to add logging?**

A: Add at layer boundaries:

```javascript
// Service logs business logic
logger.info({ action: 'shortening_url', url });

// Controller logs HTTP
logger.info({ method: 'POST', path: '/shorten', status: 201 });

// Middleware logs cross-cutting concerns
logger.info({ requestId, duration });
```

---

## Centralized Environment Configuration

### What We Built

Instead of every file calling `process.env.X` directly, `src/config/env.js` reads `.env` once and re-exports the values as a plain object:

```javascript
// src/config/env.js
require("dotenv").config();

module.exports = {
  PORT: process.env.PORT || 3000,
  BASE_URL: process.env.BASE_URL,
  PG_CONNECTION_STRING: process.env.PG_CONNECTION_STRING,
  LOG_LEVEL: process.env.LOG_LEVEL || "info",
  NODE_ENV: process.env.NODE_ENV || "production",
};
```

Other modules import from here instead of touching `process.env` directly:

```javascript
// src/config/db.js
const { PG_CONNECTION_STRING } = require("./env");

// src/lib/logger.js
const { LOG_LEVEL } = require("./env");

// src/controllers/url.controller.js
const { BASE_URL } = require("../config/env");
```

### Why Centralize Env Access?

| Without `env.js` | With `env.js` |
|---|---|
| `process.env.PORT` scattered across 10 files | One file owns env reading |
| Typos in variable names fail silently (`undefined`) | Defaults and shape are defined once |
| Hard to know all required env vars at a glance | `env.js` is the single checklist |
| Testing requires mocking `process.env` everywhere | Tests can mock/import one module |

### A Gap Worth Knowing

`env.js` does **not** export `CORS_ORIGIN`, even though `.env` defines it and `app.js` reads it via `process.env.CORS_ORIGIN` directly:

```javascript
// src/app.js — still reads process.env directly here
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
```

This is an inconsistency: most config flows through `env.js`, but CORS doesn't yet. If asked "what would you fix next," this is a clean, low-risk answer.

---

## Graceful Shutdown

### What We Built

`src/server.js` does two things beyond a typical "just call `app.listen`" setup: it **verifies the database connection before accepting traffic**, and it **shuts down cleanly on termination signals**.

```javascript
// src/server.js
const app = require("./app.js");
const { PORT } = require("./config/env");
const db = require("./config/db.js");

// 1. Verify DB connectivity before starting the server
db.query("SELECT 1")
  .then(() => console.log("Connected to url_shortener db"))
  .catch((error) => {
    console.log("DB connection failed", error);
    process.exit(1);  // Don't start if DB is unreachable
  });

const server = app.listen(PORT, () => {
  console.log(`Server started on ${PORT}`);
});

// 2. Handle termination signals gracefully
const gracefulshutdown = (signal) => {
  console.log(`[${process.pid}] ${signal} received`);
  server.close((err) => {
    if (err) {
      console.error("Error during server close:", err);
      process.exit(1);
    }
    db.end();  // Close DB pool
    console.log("All existing requests completed. Server closed.");
    process.exit(0);
  });

  // Force-exit safety net if close() hangs
  setTimeout(() => process.exit(1), 30000).unref();
};

process.on("SIGTERM", gracefulshutdown);
process.on("SIGINT", gracefulshutdown);
```

### Why This Matters

**The DB check is a "fail fast" pattern.** A server that starts successfully but can't reach its database will accept traffic and then error on every request — confusing to debug from the outside (looks "up" but isn't). Checking on boot means the process exits immediately with a clear log line instead.

**`server.close()` doesn't kill in-flight requests.** Unlike `process.exit()`, `server.close()` stops accepting *new* connections but lets requests already being processed finish. This matters for:
- Kubernetes/Docker sending `SIGTERM` before killing a container during a deploy
- Avoiding cutting off a user mid-request during a rolling restart

**The 30-second timeout (`.unref()`) is a safety net.** If a request hangs forever (e.g., a stuck DB query with no timeout), `server.close()`'s callback never fires, and the process would hang indefinitely on shutdown. The `setTimeout` forces an exit after 30s regardless. `.unref()` ensures this timer itself doesn't keep the process alive if shutdown already completed.

### Interview Angle

**Q: What's the difference between `process.exit()` and `server.close()`?**

A: `process.exit()` kills the process immediately — any request mid-flight is dropped, sockets are torn down ungracefully. `server.close()` stops the server from accepting *new* connections, but waits for existing ones to finish before its callback fires. Graceful shutdown should always prefer `close()` first, with `process.exit()` only as a final fallback (which is exactly the pattern used here).

---

## Response Wrapper Classes: ApiResponse & ApiError

### What We Built

Two small classes standardize the shape of every success and error response.

```javascript
// src/utils/ApiResponse.js
class ApiResponse {
  constructor(statusCode, data, message = "Success") {
    this.statusCode = statusCode;
    this.data = data;
    this.message = message;
    this.success = statusCode < 400;
    Object.freeze(this);  // Prevent mutation after creation
  }
}
```

```javascript
// src/utils/ApiError.js
class ApiError extends Error {
  constructor(statusCode, message = "Something went wrong", errors = [], stack = "") {
    super(message);
    this.statusCode = statusCode;
    this.data = null;
    this.message = message;
    this.success = false;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
```

### Where They're Actually Used

```javascript
// src/controllers/url.controller.js — success path uses ApiResponse
const response = new ApiResponse(201, { code, short_url, success: true });
res.status(response.statusCode).json(response);

// src/middleware/validate.js — validation failures use ApiResponse too
const response = new ApiResponse(400, { success: false, errors: [...] });
return res.status(response.statusCode).json(response);

// src/controllers/url.controller.js — domain errors use ApiError
throw new ApiError(404, "code not found");
```

**Note:** This contradicts older project documentation claiming `ApiResponse` is unused tech debt — it's actively used in both the controller and the validation middleware as of the current codebase. Always verify against the code rather than trusting a stale note (including this file, eventually).

### An Inconsistency Worth Knowing

`errorHandler.js` does **not** use either class — it builds the JSON response by hand:

```javascript
// src/middleware/errorHandler.js
res.status(statusCode).json({
  success: false,
  message: err.message,
  statusCode,
});
```

So there are now **two different code paths producing error-shaped JSON**: `validate.js` (via `ApiResponse`) and `errorHandler.js` (via a plain object). They happen to produce a similar shape today, but if one changes, the other won't follow automatically. This is a realistic "spot the inconsistency" interview prompt — and a good candidate for cleanup: route validation errors through `next(error)` and let `errorHandler` be the single place that formats error JSON, using `ApiError`/`ApiResponse` consistently.

### `Object.freeze()` on ApiResponse — Why?

```javascript
Object.freeze(this);
```

Once an `ApiResponse` is constructed, none of its properties can be reassigned (silently fails in non-strict mode, throws in strict mode/classes). This guards against a controller accidentally doing `response.success = false` after construction and shipping an inconsistent response. It's a small immutability guarantee for a value object that represents "the response we're about to send" — it shouldn't change after that point.

---

## Test Suite: Current State

`src/__tests__/shorten.test.js` exists but is a **stub, not a real test**:

```javascript
const request = require("supertest");
const app = require("../app");

describe("POST /shorten", () => {
  it("should create a short url", async () => {
    const response = await request(app);
    console.log(response, "response");
  });
});
```

This doesn't call `.post('/shorten')`, sends no body, and has **zero assertions** — it will pass regardless of what the API does. This lines up with the project's own tech-debt note: *"No tests exist yet... Tests should be added before the caching/scaling stages."* Treat this file as a placeholder, not coverage.

**What a real version would need (for later, not now — per project scope, don't jump ahead of the current stage):**
```javascript
it("should create a short url", async () => {
  const response = await request(app)
    .post("/shorten")
    .send({ url: "https://example.com" });

  expect(response.status).toBe(201);
  expect(response.body.data).toHaveProperty("code");
});
```

---

## Interview Q&A

### Foundational Questions

**Q: Explain the request lifecycle in your URL shortener.**

A: [Refer to "Request/Response Cycle" section - detailed 11-step flow]

**Q: Why did you use this architecture instead of putting everything in one file?**

A: Because layered architecture provides:
- Testability (each layer can be tested independently)
- Reusability (services can be used by multiple controllers)
- Maintainability (changes in one layer don't affect others)
- Scalability (easy to add caching, replication layers)

Without layers, all code is tightly coupled, hard to test, hard to change.

---

### Architecture Questions

**Q: What would happen if you got 10x traffic suddenly?**

A: Bottleneck analysis:

```
Database: 100 queries/second capacity
  → Add read replicas (replication)
  → Add caching (Redis)
  → Optimize queries (indexes)

Server: 100 requests/second capacity per instance
  → Add more server instances (horizontal scaling)
  → Use load balancer (nginx, HAProxy)

Network: 100 Mbps capacity
  → Upgrade network (ISP)
  → Use CDN for static assets

Each layer scales independently
```

**Q: How would you make this production-ready?**

A: Checklist:

```
Code:
- [ ] Error handling comprehensive
- [ ] Input validation strict
- [ ] Logging structured
- [ ] Security headers in place
- [ ] Rate limiting enabled

Deployment:
- [ ] Environment variables configured
- [ ] Secrets not in code
- [ ] Database backups automated
- [ ] Monitoring/alerting set up
- [ ] CI/CD pipeline working

Operations:
- [ ] Runbooks for common issues
- [ ] On-call process defined
- [ ] Incident response plan
- [ ] Post-mortem process
```

---

### Design Decision Questions

**Q: Why random codes instead of sequential?**

A: 3 approaches:

```
1. Sequential (1, 2, 3...)
   ❌ Exposes business metrics (only 1000 URLs shortened?)
   ❌ Predictable (attackers can guess codes)
   ❌ Reveals scale

2. Hash-based (md5 truncate)
   ❌ Same URL → same code (DB waste)
   ❌ Collision issues
   ❌ Complex

3. Random (our choice)
   ✅ Different URL → different code
   ✅ Not predictable
   ✅ Low collision probability (62^6 codes)
   ✅ Simple implementation (retry on collision)
```

**Q: Why 6 characters?**

A: Mathematical trade-off:

```
6 chars: 62^6 = 56 billion codes (~1 collision per 100M URLs)
7 chars: 62^7 = 3.5 trillion codes (~1 collision per 7 billion URLs)

6 chars is:
- Enough for years of data
- Short URLs (user-friendly)
- Cheap (less storage)

If we outgrow 6 chars (millions of URLs), upgrade to 7
```

**Q: Why PostgreSQL instead of MongoDB?**

A: Use case analysis:

```
URL Shortener data:
- Structured (code → URL)
- Relational (might add users, tags later)
- Requires atomicity (transaction must succeed fully)
- Simple queries (exact match lookups)

PostgreSQL:
✅ ACID compliance (data safety)
✅ Indexing (fast lookups)
✅ Mature (battle-tested)
✅ Cheap (open source)

MongoDB:
❌ Eventual consistency (data might be inconsistent)
❌ Higher latency
❌ Overkill for structured data
❌ Harder to query

MongoDB better for: blog posts (documents), time-series, flexible schema
PostgreSQL better for: structured, relational data
```

---

### Debugging Questions

**Q: How would you debug a slow endpoint?**

A: Systematic approach:

```
1. Measure: Add timing logs
   logger.info({ duration_ms, endpoint: '/shorten' });

2. Profile: Which layer is slow?
   - Middleware processing?
   - Validation?
   - Database query?
   - Network?

3. Identify: Use tools
   - APM (Application Performance Monitoring)
   - Database query logs
   - Network profiling

4. Fix:
   - Slow DB query? Add index
   - N+1 queries? Join instead
   - Slow middleware? Optimize regex
   - Network slow? Use CDN

5. Monitor: Ensure it stays fast
   - Alert if duration > 100ms
   - Trending dashboard
```

**Q: How would you debug a memory leak?**

A: 

```
1. Identify: Memory grows over time
   - Monitor: node --inspect app.js
   - DevTools Memory tab
   - Heap snapshots

2. Find culprit:
   - Global variables accumulating?
   - Listeners not removed?
   - Circular references?
   - Cache not evicting?

3. Fix:
   - Use WeakMap for caches
   - Remove event listeners
   - Break circular references
   - Add cache TTL/LRU

4. Verify:
   - Memory stable after fix
   - Monitor in production
   - Alert on memory > 500MB
```

---

### Knowledge Validation

**Q: Explain the middleware order. Why can't we swap any two?**

A: [Refer to "Middleware Chain" section - explains why order matters]

**Q: How does the retry mechanism prevent SQL injection?**

A: It doesn't. SQL injection prevention comes from:
- Parameterized queries ($ parameters)
- Input validation (Zod)

Retry mechanism solves unique constraint violations.

**Q: How would rate limiting help in a load-balanced system?**

A: Problem: Each server has own memory, limits don't coordinate.

```
3 servers, 100 limit each
Attacker sends 100 req to each server = 300 total (bypasses!)

Solution: Redis-based rate limiter shared across servers
```

---

### New Topics: Q&A

**Q: Why check the database connection before `app.listen()`?**

A: To fail fast with a clear error instead of starting a server that silently fails every request. A process that exits immediately on a bad DB connection is easier for an orchestrator (Docker/K8s) to detect and restart than one that "looks healthy" (port open) but errors on every request.

**Q: Walk me through what happens when your server receives `SIGTERM`.**

A: The `gracefulshutdown` handler runs: it calls `server.close()`, which stops accepting new connections but lets in-flight requests finish. Once all requests complete (or the 30-second timeout fires first), it closes the DB pool and exits with code 0. This is the standard pattern for zero-downtime deploys — the orchestrator sends `SIGTERM`, waits, then force-kills with `SIGKILL` if the process hasn't exited.

**Q: Your service throws a plain `Error` for "Invalid URL" instead of `ApiError(400, ...)`. What's the practical effect?**

A: The error handler does `err.statusCode || 500`. A plain `Error` has no `statusCode`, so it defaults to 500 — a client mistake (bad URL) gets reported as a server failure. This is a real bug to flag: client-facing validation errors should always carry a 4xx status via `ApiError`.

**Q: The service re-validates the URL with `isValidUrl()` even though Zod already validated it in middleware. Is that a problem?**

A: It's redundant, not wrong — defense in depth has a place if the service might be called from somewhere other than this HTTP route (e.g., a future CLI or background job that skips the middleware). But as written today, every caller is the validated HTTP path, so it's duplicate logic that adds a second place to update if the URL rules change. Worth simplifying unless there's a concrete second caller planned.

**Q: You found that `errorHandler.js` builds its JSON response manually instead of using `ApiResponse`. How would you fix that?**

A: Make `errorHandler.js` the single place that formats error responses, and have it construct an `ApiResponse`/use the `ApiError`'s own fields directly, e.g. `res.status(statusCode).json(new ApiResponse(statusCode, null, err.message))`. Then `validate.js` should stop building its own `ApiResponse` and instead `next(error)` so the same code path always produces error JSON. One source of truth instead of two.

---

## Key Takeaways

1. **Architecture matters**: Layers enable testing, maintenance, scaling
2. **Validation early**: Catch bad data before it causes damage
3. **Errors centralized**: Consistent handling, no duplicate code
4. **Logging structured**: Searchable, correlatable logs
5. **Security proactive**: Helmet + rate limiting + parameterized queries
6. **Database optimized**: Indexes, connection pooling, proper design
7. **Middleware ordered**: Order determines request flow
8. **Code organized**: Single responsibility, easy to test

---

## Next Steps

### Immediate (What You Can Do Now)

- [ ] Review request lifecycle in detail
- [ ] Practice explaining layered architecture
- [ ] Study each security header's purpose
- [ ] Plan how you'd scale to 10x traffic

### Short Term (Stage 1→2)

- [ ] Add caching layer (Redis)
- [ ] Add pagination to responses
- [ ] Add URL metadata (creation date, click count)
- [ ] Write comprehensive tests

### Medium Term (Stage 2→3)

- [ ] Database optimization (sharding, replication)
- [ ] Performance monitoring (APM)
- [ ] Advanced caching strategies (cache warming)
- [ ] Batch operations

### Interview Prep

- [ ] Study each section's Q&A (come prepared)
- [ ] Practice explaining trade-offs
- [ ] Be ready to design at scale (10M URLs/day)
- [ ] Know what you don't know (it's okay to say "I'd research that")

---

## Additional Resources

### Core Concepts
- **Middleware**: Express.js Guide
- **Validation**: Zod Documentation
- **Logging**: Pino Documentation
- **Security**: OWASP Top 10

### Books
- "Building Microservices" (Newman)
- "System Design Interview" (Xu)
- "The Pragmatic Programmer" (Hunt, Thomas)

### Articles
- "12 Factor App" (best practices)
- "OWASP Security Cheat Sheet"
- "Node.js Best Practices"
