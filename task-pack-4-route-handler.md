---
## ⚙️ AGENT TASK PACK: Task 4 — Route Handler
**Status:** [ ] Not Started | [ ] In Progress | [ ] In Review | [ ] Done

### Quick Reference
- **What to Build:** The `POST /update-patient-record` HTTP route block in `index.js` that wires validation, DB connection, and the service function together.
- **Why It Matters:** This is the public API surface — correct HTTP status codes, response shapes, and connection cleanup are essential for API consumers.
- **Time Estimate:** 3 hours
- **Difficulty:** Medium

---

### 🎯 Implementation Task

**File to Modify:** `index.js`

**Changes Required (4 locations in the file):**

---

#### Change 1 — Update `require` at the top of `index.js`

```javascript
// BEFORE:
const { addNote, listGeminiModels, searchNotes, connectMongo, mergePatientRecords } = require('./llmHelpers');

// AFTER:
const {
    addNote,
    listGeminiModels,
    searchNotes,
    connectMongo,
    mergePatientRecords,
    updatePatientRecord,    // Task 3
    validateUpdateRequest,  // Task 2
    normaliseDate,          // Task 1 — used inside validateUpdateRequest
} = require('./llmHelpers');
```

---

#### Change 2 — Add `validateUpdateRequest` inline call helper (just below `parseBody`)

> `validateUpdateRequest` is already defined in `llmHelpers.js` (Task 2) and imported above. No additional helper function is needed in `index.js`.

---

#### Change 3 — Add the route block in `http.createServer`

**Where:** Insert immediately after the `/merge-patient-records` block ends (`return;`), before the final 404 handler.

```javascript
// Route: Update a patient record by patient_id + exact date
// Scope: MongoDB-backed only. Does not touch the in-memory medicalNotes array.
if (pathname === '/update-patient-record' && method === 'POST') {
    console.log('Incoming POST /update-patient-record');
    parseBody(req, async (error, data) => {
        if (res.headersSent) return;

        if (error) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, message: 'Invalid JSON data' }));
            return;
        }

        // Validate and normalise request payload
        let patient_id, date, results;
        try {
            ({ patient_id, date, results } = validateUpdateRequest(data));
        } catch (validationErr) {
            res.writeHead(validationErr.statusCode || 400);
            res.end(JSON.stringify({ success: false, message: validationErr.message }));
            return;
        }

        let client = null;
        try {
            const connection = await connectMongo();
            client = connection.client;

            const result = await updatePatientRecord(connection.db, patient_id, date, results);

            if (result.status === 'not-found') {
                res.writeHead(404);
                res.end(JSON.stringify({
                    success: false,
                    message: `No record found for patient_id="${patient_id}" on date="${date}"`,
                }));
                return;
            }

            res.writeHead(200);
            res.end(JSON.stringify({
                success: true,
                message: 'Record updated successfully',
                data: result.document,
            }));
        } catch (err) {
            console.error('updatePatientRecord error', err);
            res.writeHead(500);
            res.end(JSON.stringify({ success: false, message: err.message || 'Internal server error' }));
        } finally {
            if (client) {
                try {
                    await client.close();
                } catch (closeErr) {
                    console.error('Failed to close MongoDB client after update', closeErr);
                }
            }
        }
    });
    return;
}
```

---

#### Change 4 — Update the 404 `availableRoutes` array and startup log

**In the 404 handler** (`res.end(JSON.stringify({ ... availableRoutes: [...] }))`)

```javascript
availableRoutes: [
    'POST /add-note - Add a new medical note',
    'GET /get-data - Get all notes or specific note by id query param',
    'POST /write-data - Update an existing note by id',
    'POST /query - Run LLM-generated MongoDB search and format results',
    'POST /merge-patient-records - Validate merge contract and call MongoDB merge orchestrator',
    'POST /update-patient-record - Update a patient record by patient_id and date',  // <-- add
]
```

**In `server.listen` startup log:**

```javascript
server.listen(PORT, () => {
    console.log(`NHS Medical Note Services running on port ${PORT}`);
    console.log(`\nAvailable endpoints:`);
    console.log(`  POST http://localhost:${PORT}/add-note`);
    console.log(`  GET  http://localhost:${PORT}/get-data`);
    console.log(`  POST http://localhost:${PORT}/write-data`);
    console.log(`  POST http://localhost:${PORT}/query`);
    console.log(`  POST http://localhost:${PORT}/merge-patient-records`);
    console.log(`  POST http://localhost:${PORT}/update-patient-record`);  // <-- add
});
```

---

**Requirements:**
1. Follow the identical pattern as `/merge-patient-records`: `parseBody` → validate → `connectMongo` → service call → `client.close()` in `finally`
2. `res.headersSent` guard must be the first check inside `parseBody` callback
3. Validation errors (`validationErr.statusCode`) map directly to HTTP status — never hardcode `400` for all validation failures
4. `client.close()` must be called in the `finally` block — NOT only in the success path
5. Response shape must match existing routes: `{ success: boolean, message: string, data?: object }`

**Reference from Feature Document:**
- Section: **6. Route Handler — index.js** — complete route block
- Section: **7. Error Handling Strategy** — HTTP status code table

---

### ✅ Testing Task

**Test File Location:** `tests/unit/route-update-patient.test.js`

**Testing strategy:** Start the actual HTTP server on an ephemeral port; stub `connectMongo` and `updatePatientRecord` using `node:test` mock module, or test via HTTP calls with a test MongoDB. For the unit tests below, use the HTTP layer with a stubbed service.

> **Prerequisite:** For HTTP-level testing, `index.js` must export the server so tests can start/stop it. Add at the bottom of `index.js`:
>
> ```javascript
> module.exports = { server };
> ```

**Write These Tests:**

1. **Valid payload → 200 with updated document**
   - Input: `{ patient_id: 'JOHN_DOE', date: '2008-12-23', results: { notes: 'Revised.' } }`
   - Expected: `status 200`, body `{ success: true, data: { ... } }`

2. **Malformed JSON body → 400 "Invalid JSON data"**
   - Input: raw string `"not json"` as body
   - Expected: `status 400`, `success: false`

3. **Missing patient_id → 400**
   - Input: `{ date: '2008-12-23', results: { notes: 'x' } }`
   - Expected: `status 400`, message contains `"patient_id"`

4. **Invalid date → 400**
   - Input: `{ patient_id: 'JOHN_DOE', date: 'bad-date', results: { notes: 'x' } }`
   - Expected: `status 400`, message contains `"not a valid calendar date"`

5. **results with protected field → 400**
   - Input: `{ patient_id: 'JOHN_DOE', date: '2008-12-23', results: { _id: 'hack' } }`
   - Expected: `status 400`, message contains `"protected field"`

6. **Record not found → 404**
   - Input: `{ patient_id: 'NOBODY', date: '2099-01-01', results: { notes: 'x' } }`
   - Expected: `status 404`, `success: false`

7. **MongoDB service throws → 500**
   - Setup: stub `updatePatientRecord` to throw
   - Expected: `status 500`, `success: false`

8. **client.close called even on 404 path**
   - Setup: spy on `client.close`
   - Expected: `close()` called exactly once regardless of outcome

**Complete Test File to Copy and Modify:**

```javascript
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Start server on a random port before tests run
// This requires index.js to export: module.exports = { server };
const { server } = require('../../index');

let baseUrl;

before((done) => {
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        done();
    });
});

after((done) => {
    server.close(done);
});

async function post(path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

describe('POST /update-patient-record', () => {

  // NOTE: Tests 1, 6, 7, 8 require a real or mocked MongoDB.
  // Run them as integration tests (Task 5) against a test database.
  // The unit tests below (2–5) exercise validation without DB.

  describe('when patient_id is missing', () => {
    it('should respond 400 with a patient_id error message', async () => {
      const { status, body } = await post('/update-patient-record', {
        date: '2008-12-23',
        results: { notes: 'x' },
      });
      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.match(body.message, /patient_id/);
    });
  });

  describe('when date is invalid', () => {
    it('should respond 400 with a date error message', async () => {
      const { status, body } = await post('/update-patient-record', {
        patient_id: 'JOHN_DOE',
        date: 'bad-date',
        results: { notes: 'x' },
      });
      assert.equal(status, 400);
      assert.match(body.message, /not a valid calendar date/);
    });
  });

  describe('when results contains a protected field', () => {
    it('should respond 400 naming the protected field', async () => {
      const { status, body } = await post('/update-patient-record', {
        patient_id: 'JOHN_DOE',
        date: '2008-12-23',
        results: { _id: 'injected' },
      });
      assert.equal(status, 400);
      assert.match(body.message, /protected field "_id"/);
    });
  });

  describe('when results is empty', () => {
    it('should respond 400', async () => {
      const { status, body } = await post('/update-patient-record', {
        patient_id: 'JOHN_DOE',
        date: '2008-12-23',
        results: {},
      });
      assert.equal(status, 400);
      assert.equal(body.success, false);
    });
  });

});
```

---

### 📋 Checklist Before Submitting

- [ ] `updatePatientRecord`, `validateUpdateRequest`, `normaliseDate` added to `require('./llmHelpers')` destructure
- [ ] Route block added before the 404 handler
- [ ] `res.headersSent` guard is the first check in `parseBody` callback
- [ ] `client.close()` in `finally` block (mirrors `/merge-patient-records`)
- [ ] 404 `availableRoutes` array updated
- [ ] `server.listen` startup log updated
- [ ] `module.exports = { server }` added at the bottom of `index.js`
- [ ] All unit tests pass with `npm test`
- [ ] Manual test using `requests.http` — run all 6 test cases from feature doc

### 🔗 Depends On Tasks
- Task 2: Request Validator (`validateUpdateRequest`)
- Task 3: Update Patient Record Service (`updatePatientRecord`)

### 🚀 Unblocks Tasks
- Task 5: Integration Tests

---
