# Node.js Techniques Guide for NHS Medical Note Services

> Comprehensive reference for Node.js patterns, best practices, and techniques applicable to the `nhs_medical_note_services` project.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Node.js Concepts](#2-core-nodejs-concepts)
3. [HTTP Server Patterns](#3-http-server-patterns)
4. [Asynchronous Programming](#4-asynchronous-programming)
5. [Database Integration (MongoDB)](#5-database-integration-mongodb)
6. [Environment Configuration](#6-environment-configuration)
7. [Error Handling Strategies](#7-error-handling-strategies)
8. [Input Validation & Security](#8-input-validation--security)
9. [LLM Integration Patterns](#9-llm-integration-patterns)
10. [Testing Techniques](#10-testing-techniques)
11. [Middleware Patterns](#11-middleware-patterns)
12. [Logging & Observability](#12-logging--observability)
13. [Module System & Code Organisation](#13-module-system--code-organisation)
14. [Performance Optimisation](#14-performance-optimisation)
15. [Security Best Practices](#15-security-best-practices)
16. [Deployment Considerations](#16-deployment-considerations)
17. [Recommendations for This Project](#17-recommendations-for-this-project)

---

## 1. Overview

### What is Node.js?

Node.js is a JavaScript runtime built on Chrome's V8 engine. It uses a non-blocking, event-driven I/O model, making it well-suited for I/O-heavy services such as:

- REST APIs that call external services (LLMs, databases)
- Real-time data pipelines
- Medical record ingestion and transformation services

### Relevance to `nhs_medical_note_services`

This project uses:
- Native `http` module as the HTTP server (no Express/Fastify)
- `mongodb` driver for database access
- `gemini-ai` SDK for LLM-powered text transformation and querying
- `dotenv` for environment configuration
- Built-in `node:test` module for unit tests
- `nodemon` for development server auto-reload

---

## 2. Core Node.js Concepts

### Event Loop

Node.js processes I/O operations asynchronously via the event loop. Understanding its phases is critical for writing non-blocking code.

```
Phases: timers → I/O callbacks → idle/prepare → poll → check → close callbacks
```

**Key rule**: Never block the event loop with synchronous heavy computation. For CPU-bound tasks (e.g. large JSON transformations), use `worker_threads`.

### Global Objects

| Global | Description |
|--------|-------------|
| `process` | Access env vars, argv, exit codes, signals |
| `global` | Global scope (avoid polluting it) |
| `__dirname` | Directory of current module (CommonJS only) |
| `__filename` | Full path of current module (CommonJS only) |
| `fetch` | Built-in since Node 18 — used in this project |

### Streams

For large medical note files or bulk record processing, prefer streams over loading entire files into memory.

```js
const { createReadStream } = require('fs');
const { Transform } = require('stream');

const noteParser = new Transform({
  transform(chunk, encoding, callback) {
    // parse and transform medical note chunk
    callback(null, processChunk(chunk));
  }
});

createReadStream('./notes.txt').pipe(noteParser).pipe(process.stdout);
```

---

## 3. HTTP Server Patterns

### Native `http` Module (Current Approach)

This project uses the built-in `http` module directly. This is lightweight but requires manual route matching.

```js
const http = require('http');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Parse body
  let body = '';
  for await (const chunk of req) body += chunk;
  const data = body ? JSON.parse(body) : {};

  // Route dispatch
  if (req.method === 'POST' && url.pathname === '/add-note') {
    // handle add-note
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(3000);
```

### Express.js (Recommended Upgrade)

Express adds routing, middleware support, and error handling with minimal overhead.

```js
const express = require('express');
const app = express();

app.use(express.json({ limit: '1mb' })); // body parsing + size limit

app.post('/add-note', async (req, res, next) => {
  try {
    const result = await addNote(req.body);
    res.json(result);
  } catch (err) {
    next(err); // pass to error handler
  }
});

// Centralised error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

app.listen(3000);
```

### Fastify (Alternative — Higher Performance)

Fastify offers schema-based validation and is ~2x faster than Express for JSON APIs.

```js
const fastify = require('fastify')({ logger: true });

fastify.post('/add-note', {
  schema: {
    body: {
      type: 'object',
      required: ['note'],
      properties: { note: { type: 'string' } }
    }
  }
}, async (request, reply) => {
  return addNote(request.body);
});
```

---

## 4. Asynchronous Programming

### Async/Await (Preferred)

All new code in this project should use `async/await` for clarity.

```js
async function addNote(rawText) {
  const structured = await convertToJson(rawText);   // LLM call
  const saved = await saveToMongo(structured);        // DB write
  return saved;
}
```

### Promise Combinators

| Method | Use Case |
|--------|----------|
| `Promise.all([...])` | Run parallel independent tasks — fail fast if any fails |
| `Promise.allSettled([...])` | Run parallel tasks — capture all results even if some fail |
| `Promise.race([...])` | Resolve/reject with first settled promise |
| `Promise.any([...])` | Resolve with first successful, reject only if all fail |

**Example** — parallel fetch of patient records and schema in this project:

```js
const [patientDocs, schema] = await Promise.all([
  db.collection('medicalNotes').find({ patient_id }).toArray(),
  loadSchema()
]);
```

### Avoiding Callback Hell

Replace deeply nested callbacks with `async/await` or `promisify`:

```js
const { promisify } = require('util');
const readFile = promisify(require('fs').readFile);

const data = await readFile('./data-structure.json', 'utf8');
```

### Timeout Pattern

For LLM calls that may hang, wrap with a timeout:

```js
function withTimeout(promise, ms, label = 'Operation') {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timeout]);
}

const result = await withTimeout(gemini.generate(prompt), 10_000, 'Gemini LLM');
```

---

## 5. Database Integration (MongoDB)

### Connection Pooling (Critical Fix for This Project)

The current code opens/closes a new MongoDB connection per operation. This is expensive and will degrade under load. Use a singleton connection pool instead.

```js
// db.js — singleton module
const { MongoClient } = require('mongodb');

let client;

async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    console.log('MongoDB connected');
  }
  return client.db(process.env.MONGODB_DB);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  if (client) await client.close();
  process.exit(0);
});

module.exports = { getDb };
```

```js
// Usage across all routes
const { getDb } = require('./db');

const db = await getDb();
const notes = await db.collection('medicalNotes').find({}).toArray();
```

### CRUD Patterns

```js
// Create
await db.collection('medicalNotes').insertOne({ ...note, createdAt: new Date() });

// Read
const note = await db.collection('medicalNotes').findOne({ _id: new ObjectId(id) });

// Update
await db.collection('medicalNotes').updateOne(
  { _id: new ObjectId(id) },
  { $set: { diagnosis: newDiagnosis, updatedAt: new Date() } }
);

// Delete
await db.collection('medicalNotes').deleteOne({ _id: new ObjectId(id) });
```

### Indexes

Add indexes for fields used in queries. For this project:

```js
// Run once during server startup or migration
async function ensureIndexes(db) {
  await db.collection('medicalNotes').createIndex({ patient_id: 1 });
  await db.collection('medicalNotes').createIndex({ createdAt: -1 });
  await db.collection('medicalNotes').createIndex({ patient: 'text' }); // full-text
}
```

### MongoDB Transactions (Already Used in Merge)

The merge feature already uses transactions correctly. Pattern for reference:

```js
const session = client.startSession();
try {
  await session.withTransaction(async () => {
    await col.insertOne(mergedDoc, { session });
    await col.deleteMany({ _id: { $in: oldIds } }, { session });
    await logs.insertOne(logEntry, { session });
  });
} finally {
  await session.endSession();
}
```

**Note**: Transactions require a MongoDB replica set. The current code already handles the standalone fallback gracefully.

### Schema Validation with Joi or Zod

Validate documents before inserting to prevent inconsistent data shapes.

```js
const Joi = require('joi');

const noteSchema = Joi.object({
  patient: Joi.string().required(),
  patient_id: Joi.string().required(),
  test: Joi.string().required(),
  date: Joi.string().isoDate().required(),
  diagnosis: Joi.object({
    primary: Joi.string(),
    diagnosis_date: Joi.string().isoDate(),
    stage: Joi.string()
  }),
  notes: Joi.string()
});

const { error, value } = noteSchema.validate(llmOutput);
if (error) throw new Error(`Invalid note structure: ${error.message}`);
```

---

## 6. Environment Configuration

### `dotenv` Usage (Current)

```js
require('dotenv').config({ override: true }); // .env overrides shell env
```

### Validated Configuration Pattern

Rather than accessing `process.env` scattered throughout code, centralise and validate at startup:

```js
// config.js
function loadConfig() {
  const required = ['GEMINI_API_KEY', 'MONGODB_URI'];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-1.5',
    mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017',
    mongoDb: process.env.MONGODB_DB ?? 'nhs_medical_node_dev',
  };
}

module.exports = { config: loadConfig() };
```

### `.env.example` Template

```bash
# Required
GEMINI_API_KEY=your-gemini-api-key-here
MONGODB_URI=mongodb://localhost:27017

# Optional
PORT=3000
GEMINI_MODEL=gemini-1.5
MONGODB_DB=nhs_medical_node_dev
```

---

## 7. Error Handling Strategies

### Centralised Error Handler (Express Pattern)

```js
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// Middleware
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode ?? 500;
  const isDev = process.env.NODE_ENV === 'development';

  res.status(statusCode).json({
    error: {
      code: err.code ?? 'INTERNAL_ERROR',
      message: err.message,
      ...(isDev && { stack: err.stack })
    }
  });
}
```

### Async Route Wrapper

Avoid try/catch in every route handler:

```js
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.post('/add-note', asyncHandler(async (req, res) => {
  const note = await processNote(req.body);
  res.json(note);
}));
```

### Graceful Shutdown

```js
async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(async () => {
    await mongoClient.close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

### Unhandled Rejection Guard

```js
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1); // fail fast — let process manager restart
});
```

---

## 8. Input Validation & Security

### Request Body Validation

Always validate at system boundaries (API endpoints, not internal functions).

```js
function validateAddNoteRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new AppError('Request body must be JSON', 400, 'INVALID_BODY');
  }
  if (!body.note || typeof body.note !== 'string') {
    throw new AppError('Field "note" is required and must be a string', 400, 'MISSING_NOTE');
  }
  if (body.note.length > 50_000) {
    throw new AppError('Note exceeds maximum length of 50,000 characters', 400, 'NOTE_TOO_LONG');
  }
  return body.note.trim();
}
```

### LLM Query Injection Prevention (Critical for This Project)

**Current Risk**: The `generateMongoQueryFromText` function passes LLM output directly as a MongoDB filter. This allows prompt injection attacks to generate arbitrary queries.

**Mitigation**:

```js
const ALLOWED_QUERY_FIELDS = new Set([
  'patient', 'patient_id', 'test', 'date', 'dob',
  'diagnosis.primary', 'diagnosis.stage'
]);

function sanitizeLLMQuery(rawFilter, depth = 0) {
  if (depth > 3) throw new Error('Query nesting too deep');
  if (typeof rawFilter !== 'object' || rawFilter === null) return rawFilter;

  const safe = {};
  for (const [key, value] of Object.entries(rawFilter)) {
    // Block MongoDB operators except in controlled positions
    if (key.startsWith('$') && !['$and', '$or', '$nor'].includes(key)) {
      continue; // strip unsafe operators
    }
    if (!key.startsWith('$') && !ALLOWED_QUERY_FIELDS.has(key)) {
      continue; // strip unknown fields
    }
    safe[key] = typeof value === 'object'
      ? sanitizeLLMQuery(value, depth + 1)
      : value;
  }
  return safe;
}
```

### Request Size Limits

```js
// Native http
let body = '';
req.on('data', chunk => {
  body += chunk;
  if (body.length > 1_000_000) { // 1MB limit
    req.destroy();
    res.writeHead(413);
    res.end(JSON.stringify({ error: 'Payload too large' }));
  }
});

// Express
app.use(express.json({ limit: '1mb' }));
```

---

## 9. LLM Integration Patterns

### Prompt Engineering

Structure prompts to produce predictable, parseable output.

```js
function buildNoteConversionPrompt(rawNote, schema) {
  return `
You are a medical data extraction assistant.

Convert the following medical note into a JSON object matching this exact schema:
${JSON.stringify(schema, null, 2)}

Rules:
- Output ONLY valid JSON, no markdown fences, no explanation
- Use null for missing fields, not empty strings
- Dates must be ISO 8601 format (YYYY-MM-DD)
- patient_id must be normalised to lowercase with hyphens

Medical note:
${rawNote}
`.trim();
}
```

### Response Parsing with Validation

```js
async function convertToJson(rawNote) {
  const prompt = buildNoteConversionPrompt(rawNote, dataStructure);
  let raw;

  try {
    raw = await withTimeout(gemini.generate(prompt), 15_000, 'convertToJson');
  } catch (err) {
    console.error('Gemini failed, using fallback:', err.message);
    return loadFallback('./fake-gemini-response.json');
  }

  // Strip markdown fences LLMs sometimes add
  const json = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AppError('LLM returned invalid JSON', 502, 'LLM_PARSE_ERROR');
  }

  const { error, value } = noteSchema.validate(parsed);
  if (error) throw new AppError(`LLM output failed schema validation: ${error.message}`, 502);

  return value;
}
```

### Retry with Exponential Backoff

```js
async function retryWithBackoff(fn, maxRetries = 3, baseDelayMs = 500) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

const result = await retryWithBackoff(() => gemini.generate(prompt));
```

### Transparent Fallback Signalling

Currently fallbacks return data that looks identical to real LLM output. Make degraded mode explicit:

```js
return {
  data: fallbackData,
  meta: {
    source: 'fallback',       // 'llm' | 'fallback'
    fallbackReason: err.message
  }
};
```

---

## 10. Testing Techniques

### Built-in `node:test` Module (Current)

Node 18+ ships with a test runner. No external dependencies needed.

```js
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('mergePatientRecords', () => {
  it('should merge scalar fields, newest wins', () => {
    const docs = [
      { patient: 'Alice', date: '2024-01-01', test: 'CT' },
      { patient: 'Alice', date: '2024-06-01', test: 'MRI' }
    ];
    const merged = mergeDocuments(docs);
    assert.equal(merged.test, 'MRI'); // newest
  });

  it('should reject empty patient_id', async () => {
    await assert.rejects(
      () => mergePatientRecords({ patient_id: '' }),
      { message: /patient_id required/ }
    );
  });
});
```

### Test Structure Recommendations

```
tests/
  unit/
    merge.test.js          # merge logic (existing)
    noteConversion.test.js # LLM prompt/response handling
    queryBuilder.test.js   # MongoDB query generation
  integration/
    routes.test.js         # HTTP endpoint tests
    db.test.js             # real MongoDB operations
  fixtures/
    sample-note.txt
    sample-structured.json
```

### Mocking LLM and Database in Unit Tests

```js
// Mock Gemini for unit tests
const { mock } = require('node:test');

before(() => {
  mock.module('gemini-ai', {
    namedExports: {
      Gemini: class {
        async generate() {
          return JSON.stringify({ patient: 'Test Patient', test: 'CT' });
        }
      }
    }
  });
});
```

### Integration Testing with Real MongoDB

```js
const { MongoMemoryServer } = require('mongodb-memory-server'); // npm package

let mongod;
before(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
});

after(async () => {
  await mongod.stop();
});
```

### HTTP Endpoint Testing

```js
const http = require('http');
const { createServer } = require('../index'); // export server factory

let server;
before(async () => { server = await createServer(); });
after(() => server.close());

it('POST /add-note returns 200 with structured note', async () => {
  const res = await fetch(`http://localhost:${server.address().port}/add-note`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'Patient John Doe, CT scan of chest...' })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.patient);
});
```

---

## 11. Middleware Patterns

### Request Logging

```js
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    console.log(JSON.stringify({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      requestId: req.headers['x-request-id']
    }));
  });
  next();
}
```

### Request ID Injection

```js
const { randomUUID } = require('crypto');

function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] ?? randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
```

### CORS (Tighten from Current `*`)

```js
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',');

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  next?.();
}
```

---

## 12. Logging & Observability

### Structured Logging with `pino`

`pino` is fast, structured, and outputs JSON — ideal for cloud log aggregation.

```js
const pino = require('pino');
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

logger.info({ patient_id: 'abc123', action: 'merge' }, 'Merge initiated');
logger.error({ err, patient_id }, 'Merge failed');
```

### Health Check Endpoint

```js
app.get('/health', async (req, res) => {
  const db = await getDb().catch(() => null);
  const mongoOk = db !== null;
  res.status(mongoOk ? 200 : 503).json({
    status: mongoOk ? 'ok' : 'degraded',
    checks: { mongo: mongoOk ? 'ok' : 'unreachable' },
    timestamp: new Date().toISOString()
  });
});
```

---

## 13. Module System & Code Organisation

### CommonJS vs ES Modules

This project uses CommonJS (`require`). ES Modules (`import/export`) are supported in Node 12+ but require `.mjs` extension or `"type": "module"` in `package.json`.

**Recommendation**: Stay with CommonJS for this project to avoid refactoring complexity.

### Recommended Module Structure

```
nhs_medical_note_services/
├── index.js                  # Server bootstrap only
├── app.js                    # Route registration, middleware
├── config.js                 # Environment config (validated)
├── db.js                     # MongoDB singleton connection
├── routes/
│   ├── notes.js              # /add-note, /get-data, /write-data
│   ├── query.js              # /query
│   └── merge.js              # /merge-patient-records
├── services/
│   ├── noteService.js        # Business logic for notes
│   ├── mergeService.js       # Merge orchestration (from llmHelpers)
│   └── llmService.js         # Gemini wrapper
├── models/
│   └── noteSchema.js         # Joi/Zod schema definitions
├── middleware/
│   ├── errorHandler.js
│   ├── requestLogger.js
│   └── validateBody.js
└── tests/
    ├── unit/
    └── integration/
```

---

## 14. Performance Optimisation

### Connection Pooling

Already covered in Section 5. The single most impactful change for this project.

### Caching LLM Responses

For repeated identical queries, cache LLM results to reduce latency and API costs:

```js
const cache = new Map();

async function cachedLLMQuery(text) {
  if (cache.has(text)) return cache.get(text);
  const result = await llm.generate(text);
  cache.set(text, result);
  // Evict after 5 minutes
  setTimeout(() => cache.delete(text), 5 * 60 * 1000);
  return result;
}
```

For production, use Redis with `ioredis`.

### Pagination

Always paginate collection queries — never return unbounded result sets:

```js
async function getNotes({ page = 1, limit = 20, filter = {} } = {}) {
  const db = await getDb();
  const skip = (page - 1) * limit;
  const [docs, total] = await Promise.all([
    db.collection('medicalNotes').find(filter).skip(skip).limit(limit).toArray(),
    db.collection('medicalNotes').countDocuments(filter)
  ]);
  return { docs, total, page, pages: Math.ceil(total / limit) };
}
```

---

## 15. Security Best Practices

### Authentication with JWT

```js
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

### Rate Limiting

```js
// Simple in-process rate limiter
const rateLimitStore = new Map();

function rateLimit({ windowMs = 60_000, max = 100 }) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = rateLimitStore.get(key) ?? { count: 0, reset: now + windowMs };

    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }
    entry.count++;
    rateLimitStore.set(key, entry);

    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}
```

### Helmet (Security Headers)

```js
const helmet = require('helmet');
app.use(helmet()); // Sets X-Frame-Options, CSP, HSTS, etc.
```

### Secrets Management

- Never commit `.env` files containing real keys
- Use `.env.example` with placeholder values in version control
- For production: use AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager

---

## 16. Deployment Considerations

### Process Manager: PM2

```bash
npm install -g pm2
pm2 start index.js --name nhs-notes --instances 2 --watch
pm2 save
pm2 startup
```

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000
USER node

CMD ["node", "index.js"]
```

### Environment Variables in Production

Never use `dotenv` `override: true` in production — only load from environment:

```js
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}
```

### Health & Readiness (for Kubernetes/ECS)

- `/health` — liveness: is the process running?
- `/ready` — readiness: is MongoDB connected and service ready to handle traffic?

---

## 17. Recommendations for This Project

Based on the current state of `nhs_medical_note_services`, here are prioritised recommendations:

### Priority 1 — Critical Architecture Fix

**Problem**: Split source of truth between in-memory array and MongoDB.

**Fix**: Replace `get-data` and `write-data` in-memory logic with MongoDB-backed CRUD:

```js
// Replace in-memory dataStore array with:
async function getNoteById(id) {
  const db = await getDb();
  return db.collection('medicalNotes').findOne({ _id: new ObjectId(id) });
}

async function updateNote(id, update) {
  const db = await getDb();
  return db.collection('medicalNotes').findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { ...update, updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
}
```

### Priority 2 — Security Fix for LLM Query Injection

Apply `sanitizeLLMQuery()` (see Section 8) before using any LLM-generated MongoDB filter.

### Priority 3 — Connection Pooling

Replace per-operation `MongoClient` creation with the singleton `getDb()` pattern (see Section 5).

### Priority 4 — Schema Validation

Define a single authoritative `noteSchema` with Joi or Zod. Validate LLM output before inserting to MongoDB.

### Priority 5 — Test Coverage

Add integration tests for routes using `node:test` + `mongodb-memory-server`. Current coverage only covers merge logic.

### Priority 6 — Centralised Error Handling

Wrap all route handlers with `asyncHandler`. Add a single error handler middleware. Remove duplicated `try/catch` from every route.

### Priority 7 — Structured Logging

Replace `console.log`/`console.error` with `pino` for JSON-structured logs suitable for log aggregation.

---

## Summary Table

| Area | Current State | Recommended Approach |
|------|--------------|---------------------|
| HTTP Server | Native `http` module | Migrate to Express for routing/middleware |
| Database Access | Per-operation connections | Singleton connection pool |
| Data Persistence | Split memory + MongoDB | Unified MongoDB-backed CRUD |
| Error Handling | Route-local try/catch | Centralised error middleware |
| LLM Query Safety | Raw filter passed to MongoDB | `sanitizeLLMQuery()` whitelist |
| Input Validation | Minimal | Joi/Zod schema at route boundaries |
| Testing | Merge unit tests only | Unit + integration test suite |
| Logging | `console.log` | Structured pino logger |
| Security | None | JWT auth, rate limiting, helmet |
| Config | `process.env` scattered | Centralised validated config module |

---

*Generated for `nhs_medical_note_services` — Node.js 18+ / MongoDB 5.x / Google Gemini AI*
