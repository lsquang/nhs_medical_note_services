# Test Strategy: Patient Data Update Feature

> Testing pyramid, coverage targets, mock/stub strategy, fixtures, and integration test plan for `POST /update-patient-record`.

---

## Table of Contents

1. [Testing Pyramid Overview](#1-testing-pyramid-overview)
2. [Coverage Targets by Component](#2-coverage-targets-by-component)
3. [Mock & Stub Strategy](#3-mock--stub-strategy)
4. [Test Data Fixtures](#4-test-data-fixtures)
5. [Integration Test Strategy](#5-integration-test-strategy)
6. [Test Execution](#6-test-execution)
7. [Test File Map](#7-test-file-map)

---

## 1. Testing Pyramid Overview

```
                  ┌──────────────┐
                  │ Integration  │  10 tests  (Task 5)
                  │  Tests (E2E) │  HTTP → Route → MongoDB
                  └──────┬───────┘
                         │
              ┌──────────┴──────────┐
              │     Unit Tests      │  42 tests  (Tasks 1–4)
              │  (pure functions +  │  Fast, no I/O
              │   mock DB)          │
              └─────────────────────┘
```

| Layer | Count | Speed | Dependencies |
|-------|-------|-------|-------------|
| Unit (pure) | 23 | < 1 ms each | None |
| Unit (mock DB) | 11 | < 5 ms each | Hand-rolled mock object |
| Unit (HTTP) | 8 | < 50 ms each | Real HTTP server, no DB |
| Integration | 10 | 50–500 ms each | Real HTTP + real MongoDB |
| **Total** | **52** | | |

**Principle:** Test as much as possible without I/O. Reserve real MongoDB for the things that cannot be tested with mocks (exact string match behaviour, `findOneAndUpdate` driver semantics, index usage).

---

## 2. Coverage Targets by Component

| Component | File | Target | Key Risk |
|-----------|------|--------|---------|
| `normaliseDate` | `llmHelpers.js` | 100% | Leap year edge cases, timezone in `isValidCalendarDate` |
| `isValidCalendarDate` | `llmHelpers.js` | 100% | Feb 29 in non-leap centuries |
| `validateUpdateRequest` | `llmHelpers.js` | 100% | All 4 protected field names must be tested |
| `updatePatientRecord` | `llmHelpers.js` | 95%+ | `null` return from `findOneAndUpdate`, DB error wrapping |
| Route handler | `index.js` | 90%+ | `client.close()` in `finally`, `res.headersSent` guard |
| Integration (full path) | test file | N/A — E2E | Date normalisation matches stored format |

---

## 3. Mock & Stub Strategy

### Unit Tests — No External Dependencies

**For `normaliseDate` and `validateUpdateRequest`:**
These are pure functions. No mocking required. Call them directly with known inputs and assert outputs.

```javascript
const { normaliseDate, validateUpdateRequest } = require('../../llmHelpers');
assert.equal(normaliseDate('23/12/2008'), '2008-12-23');
```

### Unit Tests — Mock MongoDB Handle

**For `updatePatientRecord`:**
Inject a hand-rolled mock `db` object. This avoids `mongodb-memory-server` for unit tests, keeps tests fast, and lets you inspect exactly what filter and update doc were passed to MongoDB.

```javascript
// Pattern: replace collection method with a stub
const mockDb = {
    collection: (name) => ({
        findOneAndUpdate: async (filter, update, options) => {
            // capture for assertion or return controlled value
            return mockReturnDoc; // or return null for 'not-found' case
        },
    }),
};
```

**Why NOT use `jest.mock` or `node:test` mock module here?**
`node:test` module mocking (`mock.module`) requires Node 22+ for reliable ESM support. This project uses CommonJS and targets Node 18+. Dependency injection (passing `db` as a parameter) is more compatible and doesn't require framework support.

### Unit Tests — Real HTTP, No DB

**For the route handler:**
Start the actual `http` server from `index.js` on port `0`. Use `node:test`'s `before`/`after` lifecycle hooks to start/stop. Validation errors (400s) are testable without a DB connection because they are caught before `connectMongo` is called.

```javascript
const { server } = require('../../index');
before((done) => server.listen(0, '127.0.0.1', done));
after((done) => server.close(done));
```

### Integration Tests — Real MongoDB

Use a dedicated test database (`nhs_test_update_feature`) or `mongodb-memory-server`. Never run integration tests against the dev or production database.

```javascript
process.env.MONGODB_DB = 'nhs_test_update_feature';
// All test documents use patient_id prefix 'TEST_INTEG_' for safe cleanup
afterEach(async () => {
    await db.collection('medicalNotes').deleteMany({ patient_id: /^TEST_INTEG_/ });
});
```

---

## 4. Test Data Fixtures

### Canonical Test Patient Document

Used across multiple unit and integration tests as the base document:

```javascript
// tests/fixtures/sample-medical-note.js
module.exports = {
    patient: 'John Doe',
    patient_id: 'TEST_INTEG_001',
    test: 'CT thorax and abdomen with IV contrast',
    date: '2008-12-23',
    dob: '1955-03-10',
    diagnosis: {
        primary: 'Non-small cell lung carcinoma (adenocarcinoma)',
        diagnosis_date: '2008-09',
        stage: 'Stage IA2',
        tnm: { pT: 'T1b', pN: 'N0', cM: 'M0', resection_status: 'R0' },
        PD_L1_CPS: '25%',
    },
    procedures: [
        { procedure: 'Bronchoscopy with EBUS-TBNA', date: '2008-09-01' }
    ],
    findings: {
        lungs: 'Stable postoperative scarring.',
        pleura: 'No pleural effusion.',
    },
    assessment: ['Postoperative changes with no evidence of metastases.'],
    notes: 'Comprehensive CT evaluation demonstrating stable postoperative lung findings.',
    createdAt: '2024-01-15T10:00:00.000Z',
};
```

### Update Payload Fixtures

```javascript
// tests/fixtures/update-payloads.js
module.exports = {
    valid: {
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        results: {
            diagnosis: { primary: 'Revised diagnosis — MDT review', stage: 'Stage IB' },
            assessment: ['Updated assessment after consultant review on 2024-06-01.'],
            notes: 'Revised note text.',
        },
    },
    ukDateFormat: {
        patient_id: 'TEST_INTEG_001',
        date: '23/12/2008',  // UK format — should normalise to 2008-12-23
        results: { notes: 'UK date format test.' },
    },
    missingPatientId: {
        date: '2008-12-23',
        results: { notes: 'x' },
    },
    protectedFieldInjection: {
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        results: { _id: 'injected-id', notes: 'x' },
    },
    notFound: {
        patient_id: 'TEST_INTEG_NONEXISTENT_XYZ',
        date: '2099-01-01',
        results: { notes: 'This patient does not exist.' },
    },
};
```

### Date Edge Case Inputs for `normaliseDate`

```javascript
// tests/fixtures/date-inputs.js
module.exports = {
    valid: [
        { input: '2008-12-23',           expected: '2008-12-23' },
        { input: '2008-12-23T14:30:00',  expected: '2008-12-23' },
        { input: '2008-12-23T00:00:00Z', expected: '2008-12-23' },
        { input: '23/12/2008',           expected: '2008-12-23' },
        { input: 'Dec 23 2008',          expected: '2008-12-23' },
        { input: '2000-02-29',           expected: '2000-02-29' },  // leap year
        { input: '2004-02-29',           expected: '2004-02-29' },
    ],
    invalid: [
        { input: 'not-a-date',   reason: 'unparseable string' },
        { input: '2008-02-30',   reason: 'Feb 30 does not exist' },
        { input: '2008-13-01',   reason: 'month 13 does not exist' },
        { input: '1900-02-29',   reason: '1900 is not a leap year' },
        { input: '',             reason: 'empty string' },
        { input: null,           reason: 'null input' },
        { input: undefined,      reason: 'undefined input' },
    ],
};
```

---

## 5. Integration Test Strategy

### What Integration Tests Must Prove

1. **The date string match is exact** — `normaliseDate` output matches the `date` field stored in MongoDB
2. **`$set` preserves untouched fields** — `findings`, `procedures`, `createdAt` survive an update
3. **System fields are immutable** — `_id`, `patient_id`, `date`, `createdAt` are not changed by `$set`
4. **Filter precision** — updating one record on `2008-12-23` does NOT affect the same patient's record on `2009-06-15`
5. **`updatedAt` is always set** — the timestamp is present and valid after any update

### Integration Test Database Isolation

```
Test DB name:    nhs_test_update_feature
Test patient_id: Always prefixed TEST_INTEG_
Cleanup:         afterEach — deleteMany({ patient_id: /^TEST_INTEG_/ })
```

Never share the integration test DB with the development server. The `MONGODB_DB` environment variable is overridden in the test setup.

### Recommended Test Execution Order

```
1. Unit tests (Tasks 1–4)     → npm run test:unit
2. Integration tests (Task 5) → npm run test:integration
```

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "test": "node --test",
    "test:unit": "node --test tests/unit/**/*.test.js",
    "test:integration": "node --test tests/integration/**/*.test.js"
  }
}
```

### CI Pipeline Recommendation

```yaml
# Example GitHub Actions step
- name: Unit tests
  run: npm run test:unit

- name: Start MongoDB for integration tests
  uses: supercharge/mongodb-github-action@1.10.0
  with:
    mongodb-version: '6.0'

- name: Integration tests
  run: npm run test:integration
  env:
    MONGODB_URI: mongodb://localhost:27017
    MONGODB_DB: nhs_test_update_feature
```

---

## 6. Test Execution

### Run All Tests

```bash
npm test
```

### Run Unit Tests Only

```bash
node --test tests/unit/date-normaliser.test.js \
            tests/unit/request-validator.test.js \
            tests/unit/update-patient-record.test.js \
            tests/unit/route-update-patient.test.js
```

### Run Integration Tests Only

```bash
MONGODB_URI=mongodb://localhost:27017 \
MONGODB_DB=nhs_test_update_feature \
node --test tests/integration/update-patient-record.test.js
```

### Run a Single Test File

```bash
node --test tests/unit/date-normaliser.test.js
```

### Verbose Output

```bash
node --test --test-reporter=spec tests/unit/date-normaliser.test.js
```

---

## 7. Test File Map

```
tests/
├── unit/
│   ├── date-normaliser.test.js         ← Task 1 — normaliseDate (11 cases)
│   ├── request-validator.test.js       ← Task 2 — validateUpdateRequest (15 cases)
│   ├── update-patient-record.test.js   ← Task 3 — updatePatientRecord (11 cases)
│   └── route-update-patient.test.js    ← Task 4 — HTTP route handler (8 cases)
├── integration/
│   └── update-patient-record.test.js   ← Task 5 — Full E2E round-trip (10 cases)
└── fixtures/
    ├── sample-medical-note.js          ← Base document for seeding
    ├── update-payloads.js              ← Request body fixtures
    └── date-inputs.js                  ← Date edge-case inputs
```

### Existing Test File (unchanged)

```
llmHelpers.merge.test.js    ← Existing merge unit tests (not part of this feature)
```

---

*Generated for `nhs_medical_note_services` — node:test built-in / CommonJS / MongoDB 5.x driver*
