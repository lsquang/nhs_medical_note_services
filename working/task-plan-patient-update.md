# Task Plan: Patient Data Update Feature

> Master task breakdown for `POST /update-patient-record`.
> Derived from `patient-data-update-feature.md`.
> Test framework: Node.js built-in `node:test` + `node:assert/strict` (matches existing `llmHelpers.merge.test.js`).

---

## Executive Summary

| Item | Value |
|------|-------|
| Total Tasks | 5 |
| Total Estimated Hours | 14–17 hours |
| Test Framework | `node:test` (built-in, no install required) |
| Critical Path | Task 1 → Task 2 → Task 4 and Task 1 → Task 3 → Task 4 → Task 5 |
| Highest Risk | Task 3 (MongoDB `findOneAndUpdate` + date string exact-match behaviour) |

### Risk Items

| Risk | Mitigation |
|------|-----------|
| Existing documents store `date` with time component (`"2008-12-23T00:00:00"`) | `normaliseDate` strips time; migration script provided in feature doc |
| `findOneAndUpdate` returns `null` on no-match (driver v5+) | Null-check in service, mapped to `status: 'not-found'` |
| Concurrent writes to same document | Last-write-wins via MongoDB doc-level locking — documented as acceptable for MVP |
| `node:test` mock module support is limited pre-Node 22 | Use dependency-injection pattern for DB handle in tests |

---

## Task Dependency Graph

```
Task 1: Date Normaliser Utilities
  │   (normaliseDate, isValidCalendarDate)
  │   ← No dependencies
  │
  ├──▶ Task 2: Request Validator
  │      (validateUpdateRequest)
  │      ← Depends on Task 1
  │
  └──▶ Task 3: Update Patient Record Service
         (updatePatientRecord in llmHelpers.js)
         ← Depends on Task 1
         │
         ├──▶ Task 4: Route Handler
         │      (POST /update-patient-record in index.js)
         │      ← Depends on Tasks 2 + 3
         │      │
         │      └──▶ Task 5: Integration Tests
         │               ← Depends on Tasks 3 + 4
         │
         └──▶ Task 5 (also depends on Task 3 directly)
```

### Parallel Execution Options

- **Tasks 2 and 3** can be worked simultaneously once Task 1 is done.
- **Task 5** must wait for Tasks 3 and 4.

---

## Complete Task List

---

### Task 1: Date Normaliser Utilities

**Priority:** Critical
**Dependencies:** None
**Estimated Complexity:** Medium
**Estimated Hours:** 3

#### 2.1 Implementation Requirements

- Add `normaliseDate(raw: string): string | null` to `llmHelpers.js`
- Add `isValidCalendarDate(y, m, d): boolean` to `llmHelpers.js`
- Place both near the top of the file alongside `normalizeText`, `isNonEmptyValue`, `isPlainObject`
- Export `normaliseDate` from `module.exports`
- `isValidCalendarDate` is an internal helper — does **not** need to be exported
- Must handle: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm:ss` (strip time), `DD/MM/YYYY` (UK NHS format), natural language fallback via `new Date()`
- Must use `Date.UTC` (not local `new Date()`) for calendar validation to eliminate timezone drift
- Returns `null` for invalid or unparseable input — never throws

#### 2.2 Unit Test Requirements

**Test Framework:** `node:test` + `node:assert/strict`
**Test File Location:** `tests/unit/date-normaliser.test.js`
**Minimum Test Coverage:** 95%+

**Test Cases to Write:**

- [ ] Happy path: `"2008-12-23"` → `"2008-12-23"`
- [ ] ISO with time part: `"2008-12-23T14:30:00"` → `"2008-12-23"`
- [ ] UK format: `"23/12/2008"` → `"2008-12-23"`
- [ ] Natural language: `"Dec 23 2008"` → `"2008-12-23"`
- [ ] Invalid string: `"not-a-date"` → `null`
- [ ] Impossible date: `"2008-02-30"` → `null`
- [ ] Leap year valid: `"2000-02-29"` → `"2000-02-29"`
- [ ] Leap year invalid: `"1900-02-29"` → `null` (1900 not a leap year)
- [ ] Null input → `null`
- [ ] Empty string → `null`
- [ ] Month out of range: `"2008-13-01"` → `null`

**Test Template:**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseDate } = require('../../llmHelpers');

describe('normaliseDate', () => {
  describe('when given a valid YYYY-MM-DD string', () => {
    it('should return the date unchanged', () => {
      assert.equal(normaliseDate('2008-12-23'), '2008-12-23');
    });
  });

  describe('when given an ISO string with a time component', () => {
    it('should strip the time and return YYYY-MM-DD', () => {
      assert.equal(normaliseDate('2008-12-23T14:30:00'), '2008-12-23');
    });
  });

  describe('when given a UK DD/MM/YYYY string', () => {
    it('should reformat to YYYY-MM-DD', () => {
      assert.equal(normaliseDate('23/12/2008'), '2008-12-23');
    });
  });

  describe('when given an impossible calendar date', () => {
    it('should return null', () => {
      assert.equal(normaliseDate('2008-02-30'), null);
    });
  });

  describe('when given null or empty input', () => {
    it('should return null for null', () => {
      assert.equal(normaliseDate(null), null);
    });
    it('should return null for empty string', () => {
      assert.equal(normaliseDate(''), null);
    });
  });
});
```

#### 2.3 Acceptance Criteria

- [ ] All unit tests pass with `npm test`
- [ ] `normaliseDate` exported and importable in `index.js`
- [ ] JSDoc comment on `normaliseDate` describes all handled formats
- [ ] `Date.UTC` used inside `isValidCalendarDate` (no local timezone)
- [ ] Never throws — always returns `string | null`

#### 2.4 Definition of Done

- [ ] Tests written first (TDD)
- [ ] All unit tests pass
- [ ] Manual test: call `normaliseDate('23/12/2008')` from Node REPL
- [ ] Self-review complete

---

### Task 2: Request Validator

**Priority:** Critical
**Dependencies:** Task 1 (`normaliseDate`)
**Estimated Complexity:** Low
**Estimated Hours:** 2

#### 2.1 Implementation Requirements

- Add `validateUpdateRequest(data)` to `index.js`, below the existing `parseBody` helper
- Must import/use `normaliseDate` from `llmHelpers.js`
- Validates: body is a plain object, `patient_id` is non-empty string, `date` is parseable, `results` is non-empty plain object
- Guards against protected fields: `_id`, `patient_id`, `date`, `createdAt` inside `results`
- On failure: throws `{ statusCode: 400, message: '...' }` (not an `Error` instance — matches route handler catch pattern)
- On success: returns `{ patient_id: trimmed, date: normalisedISO, results }`

#### 2.2 Unit Test Requirements

**Test Framework:** `node:test` + `node:assert/strict`
**Test File Location:** `tests/unit/request-validator.test.js`
**Minimum Test Coverage:** 95%+

**Test Cases to Write:**

- [ ] Happy path: valid `{ patient_id, date, results }` → returns normalised object
- [ ] `patient_id` missing → throws `{ statusCode: 400 }`
- [ ] `patient_id` is empty string → throws `{ statusCode: 400 }`
- [ ] `date` missing → throws `{ statusCode: 400 }`
- [ ] `date` is invalid string `"not-a-date"` → throws `{ statusCode: 400 }`
- [ ] `results` missing → throws `{ statusCode: 400 }`
- [ ] `results` is `null` → throws `{ statusCode: 400 }`
- [ ] `results` is an array → throws `{ statusCode: 400 }`
- [ ] `results` is an empty object `{}` → throws `{ statusCode: 400 }`
- [ ] `results` contains `_id` → throws `{ statusCode: 400 }`
- [ ] `results` contains `patient_id` → throws `{ statusCode: 400 }`
- [ ] `patient_id` with surrounding whitespace → trimmed in output
- [ ] `date` in UK format `"23/12/2008"` → normalised to `"2008-12-23"` in output

**Test Template:**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
// validateUpdateRequest is defined in index.js — extract to a shared module
// or test it via the HTTP endpoint in integration tests.
// For unit testing, move the function to llmHelpers.js and export it.
const { validateUpdateRequest } = require('../../llmHelpers');

describe('validateUpdateRequest', () => {
  const validPayload = {
    patient_id: 'JOHN_DOE',
    date: '2008-12-23',
    results: { notes: 'Updated note.' },
  };

  describe('when given a valid payload', () => {
    it('should return normalised fields', () => {
      const result = validateUpdateRequest(validPayload);
      assert.equal(result.patient_id, 'JOHN_DOE');
      assert.equal(result.date, '2008-12-23');
      assert.deepEqual(result.results, { notes: 'Updated note.' });
    });
  });

  describe('when patient_id is missing', () => {
    it('should throw with statusCode 400', () => {
      const { patient_id, ...noId } = validPayload;
      assert.throws(
        () => validateUpdateRequest(noId),
        (err) => err.statusCode === 400
      );
    });
  });

  describe('when results contains a protected field', () => {
    it('should throw with statusCode 400 for _id', () => {
      assert.throws(
        () => validateUpdateRequest({ ...validPayload, results: { _id: 'hack' } }),
        (err) => err.statusCode === 400 && /protected field/.test(err.message)
      );
    });
  });
});
```

#### 2.3 Acceptance Criteria

- [ ] All 13 test cases pass
- [ ] Error messages are specific (name the invalid field)
- [ ] Returned `date` is always `YYYY-MM-DD`
- [ ] Returned `patient_id` is always trimmed

#### 2.4 Definition of Done

- [ ] Tests written first
- [ ] Function extracted to `llmHelpers.js` (or a dedicated `validators.js`) to allow unit testing independent of the HTTP server
- [ ] All tests pass

---

### Task 3: Update Patient Record Service

**Priority:** Critical
**Dependencies:** Task 1 (date format regex guard)
**Estimated Complexity:** Medium
**Estimated Hours:** 4

#### 2.1 Implementation Requirements

- Add `updatePatientRecord(db, patient_id, date, results)` to `llmHelpers.js`
- Guard all four parameters at function entry (throw with `err.code` pattern matching existing code)
- Filter: `{ patient_id: patient_id.trim(), date }`
- Update: `$set: { ...results, updatedAt: new Date().toISOString() }`
- Use `findOneAndUpdate` with `{ returnDocument: 'after', includeResultMetadata: false }`
- Return `{ status: 'not-found' }` when `findOneAndUpdate` returns `null`
- Return `{ status: 'updated', document: updatedDoc }` on success
- Emit structured `console.log(JSON.stringify({ event: '...', ... }))` at start, not-found, complete, and error — matching existing `mergePatientRecords` log style
- Export `updatePatientRecord` from `module.exports`
- Never close the `db` connection — caller owns the lifecycle (matching existing `mergePatientRecords` contract)

#### 2.2 Unit Test Requirements

**Test Framework:** `node:test` + `node:assert/strict`
**Test File Location:** `tests/unit/update-patient-record.test.js`
**Minimum Test Coverage:** 95%+

**Test Cases to Write:**

- [ ] Happy path: matching document → returns `{ status: 'updated', document: { ...updatedFields } }`
- [ ] No matching document → returns `{ status: 'not-found' }`
- [ ] `db` is null → throws with `code: 'INVALID_DB_HANDLE'`
- [ ] `patient_id` is empty string → throws with `code: 'INVALID_PATIENT_ID'`
- [ ] `date` is not `YYYY-MM-DD` format → throws with `code: 'INVALID_DATE'`
- [ ] `results` is an array → throws with `code: 'INVALID_RESULTS'`
- [ ] MongoDB throws during `findOneAndUpdate` → re-throws with `code: 'DB_UPDATE_FAILED'`
- [ ] Updated document contains `updatedAt` field set to ISO string
- [ ] `$set` does not overwrite `_id` or `patient_id` (verify filter contains both fields)
- [ ] Whitespace in `patient_id` is trimmed before filter

**Test Template (using injected mock db):**

```javascript
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { updatePatientRecord } = require('../../llmHelpers');

describe('updatePatientRecord', () => {
  let mockDb;
  let capturedFilter;
  let capturedUpdate;

  beforeEach(() => {
    capturedFilter = null;
    capturedUpdate = null;
    mockDb = {
      collection: () => ({
        findOneAndUpdate: async (filter, update, options) => {
          capturedFilter = filter;
          capturedUpdate = update;
          return {
            _id: 'doc-id-1',
            patient_id: 'JOHN_DOE',
            date: '2008-12-23',
            notes: 'Updated note.',
            updatedAt: update.$set.updatedAt,
          };
        },
      }),
    };
  });

  describe('when a matching document exists', () => {
    it('should return status "updated" with the document', async () => {
      const result = await updatePatientRecord(
        mockDb,
        'JOHN_DOE',
        '2008-12-23',
        { notes: 'Updated note.' }
      );
      assert.equal(result.status, 'updated');
      assert.ok(result.document);
      assert.equal(result.document.patient_id, 'JOHN_DOE');
    });

    it('should set updatedAt on the document', async () => {
      await updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'x' });
      assert.ok(capturedUpdate.$set.updatedAt);
      assert.doesNotThrow(() => new Date(capturedUpdate.$set.updatedAt));
    });
  });

  describe('when no document matches', () => {
    it('should return status "not-found"', async () => {
      mockDb.collection = () => ({
        findOneAndUpdate: async () => null,
      });
      const result = await updatePatientRecord(
        mockDb, 'UNKNOWN', '2024-01-01', { notes: 'x' }
      );
      assert.equal(result.status, 'not-found');
    });
  });

  describe('when db handle is invalid', () => {
    it('should throw with code INVALID_DB_HANDLE', async () => {
      await assert.rejects(
        () => updatePatientRecord(null, 'JOHN_DOE', '2008-12-23', {}),
        (err) => err.code === 'INVALID_DB_HANDLE'
      );
    });
  });

  describe('when date format is wrong', () => {
    it('should throw with code INVALID_DATE', async () => {
      await assert.rejects(
        () => updatePatientRecord(mockDb, 'JOHN_DOE', '23/12/2008', {}),
        (err) => err.code === 'INVALID_DATE'
      );
    });
  });
});
```

#### 2.3 Acceptance Criteria

- [ ] All 10 test cases pass
- [ ] `$set` filter verified to include `updatedAt`
- [ ] Guard clauses use `err.code` pattern matching rest of `llmHelpers.js`
- [ ] Structured JSON log emitted at each lifecycle stage
- [ ] Exported in `module.exports`

#### 2.4 Definition of Done

- [ ] Tests written first
- [ ] All tests pass
- [ ] Manual verify: call function with real MongoDB in dev environment

---

### Task 4: Route Handler

**Priority:** High
**Dependencies:** Tasks 2 + 3
**Estimated Complexity:** Medium
**Estimated Hours:** 3

#### 2.1 Implementation Requirements

- Add `POST /update-patient-record` handler block to `index.js`
- Place it before the final 404 handler, after `/merge-patient-records`
- Use existing `parseBody` for body parsing
- Call `validateUpdateRequest` (from Task 2) inside a `try/catch` — caught error provides `statusCode` + `message`
- Call `connectMongo()` for the DB connection; close `client` in `finally`
- Call `updatePatientRecord(connection.db, patient_id, date, results)` (from Task 3)
- Map `status: 'not-found'` → HTTP 404 with `{ success: false, message: '...' }`
- Map `status: 'updated'` → HTTP 200 with `{ success: true, message: 'Record updated successfully', data: document }`
- Unexpected errors → HTTP 500 with `{ success: false, message: err.message }`
- Update `availableRoutes` array in the 404 handler
- Update startup `console.log` in `server.listen` to list the new endpoint
- Add `updatePatientRecord` and `normaliseDate` to the destructured `require('./llmHelpers')` at top

#### 2.2 Unit Test Requirements

**Test Framework:** `node:test` + `node:assert/strict`
**Test File Location:** `tests/unit/route-update-patient.test.js`
**Minimum Test Coverage:** 95%+

**Test Cases to Write:**

- [ ] Valid request → responds 200 with `success: true` and updated document
- [ ] Invalid JSON body → responds 400 `"Invalid JSON data"`
- [ ] Missing `patient_id` → responds 400 with validation message
- [ ] Invalid `date` → responds 400 with validation message
- [ ] `results` with protected field → responds 400 with protection message
- [ ] Record not found → responds 404 with `success: false`
- [ ] MongoDB service throws → responds 500
- [ ] `client.close()` is called in every path (including error paths)

**Test Template:**

```javascript
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// The server must be exportable as a factory for testability.
// Add `module.exports = { server }` or export a `createServer()` helper from index.js.

describe('POST /update-patient-record', () => {
  let baseUrl;
  // Setup: start server on ephemeral port before tests
  // Teardown: close server after tests

  describe('when given a valid payload', () => {
    it('should respond 200 with the updated document', async () => {
      const res = await fetch(`${baseUrl}/update-patient-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: 'JOHN_DOE',
          date: '2008-12-23',
          results: { notes: 'Revised.' },
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(body.data);
    });
  });

  describe('when patient_id is missing', () => {
    it('should respond 400', async () => {
      const res = await fetch(`${baseUrl}/update-patient-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: '2008-12-23', results: { notes: 'x' } }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.success, false);
    });
  });

  describe('when the record does not exist', () => {
    it('should respond 404', async () => {
      const res = await fetch(`${baseUrl}/update-patient-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: 'NONEXISTENT',
          date: '2099-01-01',
          results: { notes: 'x' },
        }),
      });
      assert.equal(res.status, 404);
    });
  });
});
```

#### 2.3 Acceptance Criteria

- [ ] All 8 test cases pass
- [ ] `client.close()` verified in `finally` block
- [ ] `res.headersSent` guard present (matching existing routes)
- [ ] 404 `availableRoutes` updated
- [ ] Startup log updated

#### 2.4 Definition of Done

- [ ] Tests written first
- [ ] All tests pass
- [ ] Manually tested with `requests.http` test cases from feature doc

---

### Task 5: Integration Tests

**Priority:** High
**Dependencies:** Tasks 3 + 4
**Estimated Complexity:** High
**Estimated Hours:** 4

#### 2.1 Implementation Requirements

- Create `tests/integration/update-patient-record.test.js`
- Use a real local MongoDB instance (or `mongodb-memory-server` if available)
- Seed at least 2 known documents before each test; clean up after
- Test the full HTTP → route → service → MongoDB round-trip
- Cover all response status codes: 200, 400, 404, 500

#### 2.2 Test Cases to Write

- [ ] Insert document, update via HTTP, verify DB reflects changes
- [ ] Verify `updatedAt` is set on updated document
- [ ] Verify `createdAt` and `_id` are NOT changed after update
- [ ] Verify `patient_id` and `date` filter precision (update only the correct record when two exist)
- [ ] Two records for same patient on different dates — update only the target date
- [ ] UK date format in request normalised correctly end-to-end
- [ ] 404 when no matching `patient_id` + `date` combination exists
- [ ] 400 for missing `patient_id`
- [ ] 400 for attempting to set `_id` in `results`
- [ ] Verify `results` fields that are NOT in the payload are preserved on the document

#### 2.3 Acceptance Criteria

- [ ] All integration tests pass against a real (or in-memory) MongoDB
- [ ] Tests clean up inserted documents in `afterEach`
- [ ] No inter-test state leakage

#### 2.4 Definition of Done

- [ ] Tests pass with `npm test`
- [ ] CI pipeline (if present) runs integration tests
- [ ] Test output shows specific document IDs and field names in failure messages

---

## Task Matrix

| Task # | Component | Priority | Complexity | Est. Hours | Test Cases |
|--------|-----------|----------|------------|------------|------------|
| 1 | Date Normaliser Utilities | Critical | Medium | 3 | 11 |
| 2 | Request Validator | Critical | Low | 2 | 13 |
| 3 | Update Patient Record Service | Critical | Medium | 4 | 10 |
| 4 | Route Handler | High | Medium | 3 | 8 |
| 5 | Integration Tests | High | High | 4 | 10 |
| **Total** | | | | **16 hrs** | **52** |

---

## Test Summary

| Category | Count |
|----------|-------|
| Unit test files | 4 |
| Integration test files | 1 |
| Total test cases | 52 |
| Pure-function tests (no DB) | 34 |
| DB / HTTP integration tests | 18 |
| Target coverage | 95%+ all components |

### Integration Points Requiring Integration Tests

- `normaliseDate` ↔ `validateUpdateRequest` (date passed through correctly)
- `validateUpdateRequest` ↔ route handler (validation errors map to correct HTTP status)
- `updatePatientRecord` ↔ MongoDB `findOneAndUpdate` (exact string match on `patient_id` + `date`)
- Route handler ↔ `connectMongo` (client always closed in `finally`)

---

## Specialized Test Categories

### A. Data Validation Tests

- [ ] `patient_id` missing
- [ ] `patient_id` empty string
- [ ] `patient_id` whitespace-only
- [ ] `date` missing
- [ ] `date` invalid format (`"not-a-date"`)
- [ ] `date` impossible calendar date (`"2008-02-30"`)
- [ ] `results` missing
- [ ] `results` null
- [ ] `results` array
- [ ] `results` empty object
- [ ] `results` contains `_id`
- [ ] `results` contains `patient_id`
- [ ] `results` contains `date`
- [ ] `results` contains `createdAt`

### B. Database Operation Tests

- [ ] `findOneAndUpdate` called with correct filter `{ patient_id, date }`
- [ ] `$set` contains caller's fields plus `updatedAt`
- [ ] `returnDocument: 'after'` option is passed
- [ ] Returns `null` → `status: 'not-found'`
- [ ] Returns document → `status: 'updated'`
- [ ] MongoDB error propagates as `code: 'DB_UPDATE_FAILED'`

### C. API Integration Tests

- [ ] `POST /update-patient-record` route registered
- [ ] Non-POST method returns 404
- [ ] JSON `Content-Type` body parsed correctly
- [ ] 200 response contains `{ success: true, data: {...} }`
- [ ] 404 response contains `{ success: false, message: '...' }`
- [ ] 400 response contains `{ success: false, message: '...' }`
- [ ] 500 response contains `{ success: false, message: '...' }`

### D. Security & Audit Tests

- [ ] Protected fields (`_id`, `patient_id`, `date`, `createdAt`) rejected in `results`
- [ ] Structured audit log emitted on every update (`event: 'updatePatientRecord.complete'`)
- [ ] `patient_id` trimmed before DB query (prevent whitespace bypass)

### E. Edge Case & Error Tests

- [ ] No record found for valid `patient_id` + `date`
- [ ] Two records on same date — only first is updated
- [ ] `date` stored with time component in DB — string mismatch (documents migration path)
- [ ] Concurrent updates — last write wins (documented, not an error)
- [ ] MongoDB connection failure during `findOneAndUpdate`
- [ ] `client.close()` called even when `updatePatientRecord` throws

---

*Task packs for individual tasks are in `task-pack-1-date-normaliser.md` through `task-pack-5-integration-tests.md`.*
