---
## ⚙️ AGENT TASK PACK: Task 5 — Integration Tests
**Status:** [ ] Not Started | [ ] In Progress | [ ] In Review | [ ] Done

### Quick Reference
- **What to Build:** End-to-end integration tests that run the full HTTP → route → service → real MongoDB round-trip for `POST /update-patient-record`.
- **Why It Matters:** Unit tests with mock DBs cannot catch date string mismatch, index behaviour, or driver version quirks. Integration tests catch these at the boundary where real bugs live.
- **Time Estimate:** 4 hours
- **Difficulty:** High

---

### 🎯 Implementation Task

**File to Create:** `tests/integration/update-patient-record.test.js`

**MongoDB Setup Options (choose one):**

**Option A — Local MongoDB (simplest, requires running MongoDB)**
```javascript
// Uses the same MONGODB_URI as the dev server
process.env.MONGODB_URI = 'mongodb://localhost:27017';
process.env.MONGODB_DB  = 'nhs_test_update_feature';
```

**Option B — `mongodb-memory-server` (self-contained, no external dependency)**
```bash
npm install --save-dev mongodb-memory-server
```
```javascript
const { MongoMemoryServer } = require('mongodb-memory-server');
let mongod;
before(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.MONGODB_DB  = 'nhs_test';
});
after(async () => { await mongod.stop(); });
```

**Recommended:** Option B for CI pipelines. Option A for local development.

**Requirements:**
1. Each test must insert known documents into a clean collection (`beforeEach`)
2. Each test must clean up inserted documents (`afterEach`) — use a test-specific `patient_id` prefix to make cleanup safe
3. Server must be started on an ephemeral port (port `0`) so tests never conflict with the dev server
4. All 5 HTTP status codes must be exercised: 200, 400, 404
5. Document state in MongoDB must be verified directly (not just from HTTP response) for the success case

---

### ✅ Testing Task

**Test File Location:** `tests/integration/update-patient-record.test.js`

**Write These Tests:**

1. **Full round-trip: insert → update → verify in DB**
   - Setup: insert `{ patient_id: 'TEST_INTEG_001', date: '2008-12-23', notes: 'Original note.', diagnosis: { primary: 'Old' } }`
   - Action: `POST /update-patient-record` with `{ patient_id: 'TEST_INTEG_001', date: '2008-12-23', results: { notes: 'Updated note.', diagnosis: { primary: 'Revised' } } }`
   - Expected HTTP: `200`, `body.success === true`, `body.data.notes === 'Updated note.'`
   - Expected DB: query `medicalNotes` directly — `notes` field equals `'Updated note.'`

2. **updatedAt is set after update**
   - Setup: insert a document without `updatedAt`
   - Action: POST update
   - Expected DB: `updatedAt` field exists and is a valid ISO string

3. **System fields are NOT overwritten**
   - Setup: insert document; capture `_id`, `patient_id`, `date`, `createdAt`
   - Action: POST update with new `notes`
   - Expected DB: `_id`, `patient_id`, `date`, `createdAt` are identical to pre-update values

4. **Untouched fields are preserved**
   - Setup: insert `{ ..., findings: { lungs: 'Clear' }, procedures: [{ procedure: 'CT', date: '2008-12-23' }] }`
   - Action: POST update with only `{ notes: 'New note.' }` in `results`
   - Expected DB: `findings.lungs === 'Clear'` and `procedures` array unchanged

5. **Only the matching date record is updated**
   - Setup: insert two records for `TEST_INTEG_002` — one on `2008-12-23`, one on `2009-06-15`
   - Action: POST update targeting `date: '2008-12-23'`
   - Expected DB: record for `2009-06-15` is unchanged

6. **UK date format normalised end-to-end**
   - Setup: insert record with `date: '2008-12-23'`
   - Action: POST with `date: '23/12/2008'` (UK format) in the request
   - Expected HTTP: `200` — the normalisation matched the stored record correctly

7. **404 when patient_id does not exist**
   - Action: POST with `patient_id: 'NONEXISTENT_PATIENT_XYZ'`, `date: '2024-01-01'`
   - Expected HTTP: `404`, `body.success === false`

8. **404 when patient_id exists but date does not match**
   - Setup: insert record for `TEST_INTEG_003` on `2008-12-23`
   - Action: POST with `date: '2099-12-31'`
   - Expected HTTP: `404`

9. **400 for missing patient_id**
   - Action: POST `{ date: '2008-12-23', results: { notes: 'x' } }`
   - Expected HTTP: `400`, message contains `"patient_id"`

10. **400 when results contains _id**
    - Action: POST with `results: { _id: 'injected', notes: 'x' }`
    - Expected HTTP: `400`, message contains `"protected field"`

**Complete Test File to Copy and Modify:**

```javascript
'use strict';
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');

// ── Test database setup ──────────────────────────────────────────────────────
// Option A: uncomment for local MongoDB
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
process.env.MONGODB_DB  = 'nhs_test_update_feature';

// Option B: uncomment for mongodb-memory-server
// const { MongoMemoryServer } = require('mongodb-memory-server');
// let mongod;
// before(async () => {
//     mongod = await MongoMemoryServer.create();
//     process.env.MONGODB_URI = mongod.getUri();
// });
// after(async () => { if (mongod) await mongod.stop(); });

// ── Server setup ─────────────────────────────────────────────────────────────
// Requires index.js to export: module.exports = { server };
const { server } = require('../../index');
let baseUrl;
let mongoClient;
let testDb;

before(async () => {
    // Start HTTP server on ephemeral port
    await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            baseUrl = `http://127.0.0.1:${port}`;
            resolve();
        });
    });

    // Direct DB connection for test assertions
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();
    testDb = mongoClient.db(process.env.MONGODB_DB);
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (mongoClient) await mongoClient.close();
});

// Clean up test documents after each test
afterEach(async () => {
    await testDb.collection('medicalNotes').deleteMany({
        patient_id: { $regex: /^TEST_INTEG_/ },
    });
});

// ── Helpers ──────────────────────────────────────────────────────────────────
async function postUpdate(body) {
    const res = await fetch(`${baseUrl}/update-patient-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

async function insertDoc(doc) {
    const result = await testDb.collection('medicalNotes').insertOne({
        createdAt: new Date().toISOString(),
        ...doc,
    });
    return result.insertedId;
}

async function findDoc(patient_id, date) {
    return testDb.collection('medicalNotes').findOne({ patient_id, date });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /update-patient-record — integration', () => {

  describe('successful update', () => {

    it('should update specified fields and return the updated document', async () => {
      await insertDoc({
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        notes: 'Original note.',
        diagnosis: { primary: 'Old diagnosis' },
      });

      const { status, body } = await postUpdate({
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        results: { notes: 'Updated note.', diagnosis: { primary: 'Revised diagnosis' } },
      });

      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.data.notes, 'Updated note.');

      // Verify directly in DB
      const doc = await findDoc('TEST_INTEG_001', '2008-12-23');
      assert.equal(doc.notes, 'Updated note.');
      assert.equal(doc.diagnosis.primary, 'Revised diagnosis');
    });

    it('should set updatedAt on the document', async () => {
      await insertDoc({ patient_id: 'TEST_INTEG_001', date: '2008-12-23', notes: 'x' });

      await postUpdate({
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        results: { notes: 'Updated.' },
      });

      const doc = await findDoc('TEST_INTEG_001', '2008-12-23');
      assert.ok(doc.updatedAt, 'updatedAt should be set');
      assert.doesNotThrow(() => new Date(doc.updatedAt));
    });

    it('should NOT overwrite _id, patient_id, date, or createdAt', async () => {
      const insertedId = await insertDoc({
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        notes: 'Original.',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      await postUpdate({
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        results: { notes: 'Updated.' },
      });

      const doc = await findDoc('TEST_INTEG_001', '2008-12-23');
      assert.equal(String(doc._id), String(insertedId));
      assert.equal(doc.patient_id, 'TEST_INTEG_001');
      assert.equal(doc.date, '2008-12-23');
      assert.equal(doc.createdAt, '2024-01-01T00:00:00.000Z');
    });

    it('should preserve fields not included in results', async () => {
      await insertDoc({
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        notes: 'Original.',
        findings: { lungs: 'Clear.' },
        procedures: [{ procedure: 'CT', date: '2008-12-23' }],
      });

      await postUpdate({
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        results: { notes: 'Updated only.' },
      });

      const doc = await findDoc('TEST_INTEG_001', '2008-12-23');
      assert.equal(doc.findings.lungs, 'Clear.');
      assert.equal(doc.procedures.length, 1);
      assert.equal(doc.procedures[0].procedure, 'CT');
    });

    it('should update only the matching date record when patient has multiple', async () => {
      await insertDoc({ patient_id: 'TEST_INTEG_002', date: '2008-12-23', notes: 'Dec 2008' });
      await insertDoc({ patient_id: 'TEST_INTEG_002', date: '2009-06-15', notes: 'Jun 2009' });

      await postUpdate({
        patient_id: 'TEST_INTEG_002',
        date: '2008-12-23',
        results: { notes: 'Updated Dec 2008' },
      });

      const dec = await findDoc('TEST_INTEG_002', '2008-12-23');
      const jun = await findDoc('TEST_INTEG_002', '2009-06-15');
      assert.equal(dec.notes, 'Updated Dec 2008');
      assert.equal(jun.notes, 'Jun 2009');  // unchanged
    });

    it('should accept UK date format and match the stored YYYY-MM-DD record', async () => {
      await insertDoc({ patient_id: 'TEST_INTEG_001', date: '2008-12-23', notes: 'Original.' });

      const { status } = await postUpdate({
        patient_id: 'TEST_INTEG_001',
        date: '23/12/2008',  // UK format
        results: { notes: 'UK date accepted.' },
      });

      assert.equal(status, 200);
      const doc = await findDoc('TEST_INTEG_001', '2008-12-23');
      assert.equal(doc.notes, 'UK date accepted.');
    });
  });

  describe('not found cases', () => {

    it('should respond 404 when no record matches patient_id', async () => {
      const { status, body } = await postUpdate({
        patient_id: 'TEST_INTEG_NONEXISTENT',
        date: '2024-01-01',
        results: { notes: 'x' },
      });
      assert.equal(status, 404);
      assert.equal(body.success, false);
    });

    it('should respond 404 when patient exists but date does not match', async () => {
      await insertDoc({ patient_id: 'TEST_INTEG_003', date: '2008-12-23', notes: 'x' });

      const { status } = await postUpdate({
        patient_id: 'TEST_INTEG_003',
        date: '2099-12-31',
        results: { notes: 'Wrong date.' },
      });

      assert.equal(status, 404);
    });
  });

  describe('validation errors', () => {

    it('should respond 400 when patient_id is missing', async () => {
      const { status, body } = await postUpdate({
        date: '2008-12-23',
        results: { notes: 'x' },
      });
      assert.equal(status, 400);
      assert.match(body.message, /patient_id/);
    });

    it('should respond 400 when results contains a protected field', async () => {
      const { status, body } = await postUpdate({
        patient_id: 'TEST_INTEG_001',
        date: '2008-12-23',
        results: { _id: 'injected', notes: 'x' },
      });
      assert.equal(status, 400);
      assert.match(body.message, /protected field/);
    });
  });

});
```

---

### 📋 Checklist Before Submitting

- [ ] `tests/integration/update-patient-record.test.js` created
- [ ] All 10 test cases pass against a real (or in-memory) MongoDB
- [ ] `afterEach` cleans up all test documents with `TEST_INTEG_` prefix
- [ ] Server started on ephemeral port `0` (not hardcoded `3000`)
- [ ] Direct DB assertions used for success cases (not just HTTP response)
- [ ] Tests do not depend on data inserted by other tests (each test is self-contained)
- [ ] `npm test` passes all tests end-to-end

### 🔗 Depends On Tasks
- Task 3: Update Patient Record Service (service function must be implemented)
- Task 4: Route Handler (HTTP endpoint must be registered)

### 🚀 Unblocks Tasks
- None (final task in the chain)

---
