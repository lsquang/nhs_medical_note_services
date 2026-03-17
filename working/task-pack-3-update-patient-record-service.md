---
## ⚙️ AGENT TASK PACK: Task 3 — Update Patient Record Service
**Status:** [ ] Not Started | [ ] In Progress | [ ] In Review | [ ] Done

### Quick Reference
- **What to Build:** The MongoDB service function that finds a patient record by `patient_id` + `date` and applies a `$set` update with the caller's `results` fields.
- **Why It Matters:** This is the core database operation. An incorrect filter or update operator will silently corrupt or miss records.
- **Time Estimate:** 4 hours
- **Difficulty:** Medium

---

### 🎯 Implementation Task

**File to Modify:** `llmHelpers.js`
**Where to Insert:** After `validateUpdateRequest` (Task 2), before `module.exports`.

**Function Signature:**

```javascript
/**
 * Finds the first medicalNotes document matching { patient_id, date } and
 * applies a $set update containing the provided results fields plus updatedAt.
 *
 * The caller owns the db connection lifecycle — this function does NOT
 * open or close the MongoDB client.
 *
 * @param {import('mongodb').Db} db         - Active MongoDB db handle
 * @param {string}               patient_id - Normalised patient identifier (trimmed)
 * @param {string}               date       - ISO-8601 date string in YYYY-MM-DD format
 * @param {object}               results    - Caller-supplied fields to update
 * @returns {Promise<{ status: 'updated', document: object } | { status: 'not-found' }>}
 * @throws {Error & { code: string }} on invalid arguments or DB failure
 */
async function updatePatientRecord(db, patient_id, date, results) { ... }
```

**Full Implementation to Copy:**

```javascript
async function updatePatientRecord(db, patient_id, date, results) {
    // ── Guard clauses ────────────────────────────────────────────────────
    if (!db || typeof db.collection !== 'function') {
        const err = new Error('MongoDB database handle is required');
        err.code = 'INVALID_DB_HANDLE';
        throw err;
    }
    if (typeof patient_id !== 'string' || patient_id.trim() === '') {
        const err = new Error('patient_id is required and must be a string');
        err.code = 'INVALID_PATIENT_ID';
        throw err;
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const err = new Error('date must be a valid YYYY-MM-DD string');
        err.code = 'INVALID_DATE';
        throw err;
    }
    if (!results || typeof results !== 'object' || Array.isArray(results)) {
        const err = new Error('results must be a plain object');
        err.code = 'INVALID_RESULTS';
        throw err;
    }

    const normalised_id = patient_id.trim();
    const filter = { patient_id: normalised_id, date };
    const updateDoc = {
        $set: {
            ...results,
            updatedAt: new Date().toISOString(),
        },
    };

    console.log(JSON.stringify({
        event: 'updatePatientRecord.start',
        patient_id: normalised_id,
        date,
        fieldsToUpdate: Object.keys(results),
    }));

    let updatedDoc;
    try {
        const collection = db.collection('medicalNotes');
        updatedDoc = await collection.findOneAndUpdate(filter, updateDoc, {
            returnDocument: 'after',
            includeResultMetadata: false,
        });
    } catch (err) {
        console.error(JSON.stringify({
            event: 'updatePatientRecord.error',
            patient_id: normalised_id,
            date,
            message: err.message,
        }));
        const wrappedErr = new Error(
            `DB update failed for patient_id=${patient_id} date=${date}: ${err.message}`
        );
        wrappedErr.code = 'DB_UPDATE_FAILED';
        throw wrappedErr;
    }

    if (!updatedDoc) {
        console.log(JSON.stringify({
            event: 'updatePatientRecord.not_found',
            patient_id: normalised_id,
            date,
        }));
        return { status: 'not-found' };
    }

    console.log(JSON.stringify({
        event: 'updatePatientRecord.complete',
        patient_id: normalised_id,
        date,
        documentId: String(updatedDoc._id),
    }));

    return { status: 'updated', document: updatedDoc };
}
```

**Export Update:**

```javascript
module.exports = {
    // ... all existing exports ...
    normaliseDate,
    validateUpdateRequest,
    updatePatientRecord,   // <-- add this line
};
```

**Requirements:**
1. Filter must be `{ patient_id: patient_id.trim(), date }` — exact string equality on both fields
2. Update must use `$set`, NOT `replaceOne` — untouched fields (e.g. `findings`, `procedures`) must be preserved
3. `$set` must include `updatedAt: new Date().toISOString()` regardless of what the caller provides
4. Use `findOneAndUpdate` with `{ returnDocument: 'after', includeResultMetadata: false }` to get the full updated document in one round-trip
5. When `findOneAndUpdate` returns `null`, return `{ status: 'not-found' }` — do NOT throw
6. Guard clauses use `err.code` pattern matching `findAllRecordsForPatient` and other existing helpers
7. Emit structured JSON log at start, not-found, complete, and error — matching `mergePatientRecords` log style
8. Never open or close a MongoDB connection — the caller (`connectMongo`) owns the lifecycle
9. Do not protect against overwriting `_id`, `patient_id`, `date`, or `createdAt` here — that is `validateUpdateRequest`'s responsibility (separation of concerns)

**Reference from Feature Document:**
- Section: **4. Database Query Design**
- Quote: *"Use `$set` applies only the provided fields, leaving untouched fields intact. This is the safe default for a partial-update endpoint."*
- Quote: *"`findOneAndUpdate` with `returnDocument: 'after'` returns the full updated record in a single round-trip."*
- Section: **5. Service Layer — llmHelpers.js** — full implementation code

---

### ✅ Testing Task

**Test File Location:** `tests/unit/update-patient-record.test.js`

**Testing strategy:** Use a hand-rolled mock `db` object with a replaceable `findOneAndUpdate` stub. This avoids `mongodb-memory-server` for unit tests and keeps tests fast and dependency-free.

**Write These Tests:**

1. **Happy path — document found and updated**
   - Setup: mock `findOneAndUpdate` returns a document
   - Input: valid `db`, `'JOHN_DOE'`, `'2008-12-23'`, `{ notes: 'Revised.' }`
   - Expected: `{ status: 'updated', document: { patient_id: 'JOHN_DOE', ... } }`

2. **updatedAt is set**
   - Setup: capture the `updateDoc` passed to `findOneAndUpdate`
   - Expected: `updateDoc.$set.updatedAt` is a valid ISO string

3. **$set contains caller's fields**
   - Setup: capture `updateDoc`
   - Expected: `updateDoc.$set.notes === 'Revised.'`

4. **Filter uses exact patient_id and date**
   - Setup: capture `filter` passed to `findOneAndUpdate`
   - Expected: `filter.patient_id === 'JOHN_DOE'` and `filter.date === '2008-12-23'`

5. **No matching document → not-found**
   - Setup: mock `findOneAndUpdate` returns `null`
   - Expected: `{ status: 'not-found' }`

6. **db is null → throws INVALID_DB_HANDLE**
   - Input: `null` as `db`
   - Expected: rejects with `err.code === 'INVALID_DB_HANDLE'`

7. **patient_id is empty → throws INVALID_PATIENT_ID**
   - Input: `''` as `patient_id`
   - Expected: rejects with `err.code === 'INVALID_PATIENT_ID'`

8. **date is not YYYY-MM-DD → throws INVALID_DATE**
   - Input: `'23/12/2008'` as `date` (UK format — should already be normalised by this point)
   - Expected: rejects with `err.code === 'INVALID_DATE'`

9. **results is an array → throws INVALID_RESULTS**
   - Input: `['a']` as `results`
   - Expected: rejects with `err.code === 'INVALID_RESULTS'`

10. **MongoDB throws during findOneAndUpdate → wraps as DB_UPDATE_FAILED**
    - Setup: mock `findOneAndUpdate` throws `new Error('connection reset')`
    - Expected: rejects with `err.code === 'DB_UPDATE_FAILED'`

11. **patient_id with whitespace is trimmed in filter**
    - Input: `'  JOHN_DOE  '` as `patient_id`
    - Expected: `filter.patient_id === 'JOHN_DOE'` (no surrounding spaces)

**Complete Test File to Copy and Modify:**

```javascript
'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { updatePatientRecord } = require('../../llmHelpers');

describe('updatePatientRecord', () => {
  let capturedFilter;
  let capturedUpdate;
  let mockReturnDoc;
  let mockDb;

  beforeEach(() => {
    capturedFilter = null;
    capturedUpdate = null;
    mockReturnDoc = {
      _id: 'doc-id-1',
      patient_id: 'JOHN_DOE',
      date: '2008-12-23',
      notes: 'Revised.',
      updatedAt: new Date().toISOString(),
    };

    mockDb = {
      collection: () => ({
        findOneAndUpdate: async (filter, update, _options) => {
          capturedFilter = filter;
          capturedUpdate = update;
          return mockReturnDoc;
        },
      }),
    };
  });

  // ── Happy paths ───────────────────────────────────────────────────────

  describe('when a matching document exists', () => {
    it('should return status "updated" with the document', async () => {
      const result = await updatePatientRecord(
        mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'Revised.' }
      );
      assert.equal(result.status, 'updated');
      assert.ok(result.document, 'document should be present');
      assert.equal(result.document.patient_id, 'JOHN_DOE');
    });

    it('should set updatedAt in the $set payload', async () => {
      await updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'x' });
      assert.ok(capturedUpdate.$set.updatedAt, 'updatedAt should be set');
      assert.doesNotThrow(() => new Date(capturedUpdate.$set.updatedAt));
    });

    it('should include caller fields in the $set payload', async () => {
      await updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'Revised note' });
      assert.equal(capturedUpdate.$set.notes, 'Revised note');
    });

    it('should query with exact patient_id and date', async () => {
      await updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'x' });
      assert.equal(capturedFilter.patient_id, 'JOHN_DOE');
      assert.equal(capturedFilter.date, '2008-12-23');
    });

    it('should trim whitespace from patient_id in the filter', async () => {
      await updatePatientRecord(mockDb, '  JOHN_DOE  ', '2008-12-23', { notes: 'x' });
      assert.equal(capturedFilter.patient_id, 'JOHN_DOE');
    });
  });

  // ── Not found ─────────────────────────────────────────────────────────

  describe('when no document matches the filter', () => {
    it('should return status "not-found"', async () => {
      mockDb.collection = () => ({
        findOneAndUpdate: async () => null,
      });
      const result = await updatePatientRecord(
        mockDb, 'UNKNOWN_PATIENT', '2099-01-01', { notes: 'x' }
      );
      assert.equal(result.status, 'not-found');
      assert.equal(result.document, undefined);
    });
  });

  // ── Guard clauses ─────────────────────────────────────────────────────

  describe('when db is invalid', () => {
    it('should reject with code INVALID_DB_HANDLE for null', async () => {
      await assert.rejects(
        () => updatePatientRecord(null, 'JOHN_DOE', '2008-12-23', { notes: 'x' }),
        (err) => { assert.equal(err.code, 'INVALID_DB_HANDLE'); return true; }
      );
    });
  });

  describe('when patient_id is invalid', () => {
    it('should reject with code INVALID_PATIENT_ID for empty string', async () => {
      await assert.rejects(
        () => updatePatientRecord(mockDb, '', '2008-12-23', { notes: 'x' }),
        (err) => { assert.equal(err.code, 'INVALID_PATIENT_ID'); return true; }
      );
    });
  });

  describe('when date format is wrong', () => {
    it('should reject with code INVALID_DATE for non-YYYY-MM-DD input', async () => {
      await assert.rejects(
        () => updatePatientRecord(mockDb, 'JOHN_DOE', '23/12/2008', { notes: 'x' }),
        (err) => { assert.equal(err.code, 'INVALID_DATE'); return true; }
      );
    });
  });

  describe('when results is not a plain object', () => {
    it('should reject with code INVALID_RESULTS for an array', async () => {
      await assert.rejects(
        () => updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', ['a', 'b']),
        (err) => { assert.equal(err.code, 'INVALID_RESULTS'); return true; }
      );
    });
  });

  // ── DB error propagation ──────────────────────────────────────────────

  describe('when MongoDB throws during findOneAndUpdate', () => {
    it('should reject with code DB_UPDATE_FAILED', async () => {
      mockDb.collection = () => ({
        findOneAndUpdate: async () => { throw new Error('connection reset'); },
      });
      await assert.rejects(
        () => updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'x' }),
        (err) => { assert.equal(err.code, 'DB_UPDATE_FAILED'); return true; }
      );
    });
  });

});
```

---

### 📋 Checklist Before Submitting

- [ ] `updatePatientRecord` added to `llmHelpers.js`
- [ ] `updatePatientRecord` added to `module.exports`
- [ ] `tests/unit/update-patient-record.test.js` created
- [ ] All 11 test cases pass with `npm test`
- [ ] `$set` used (not `replaceOne`)
- [ ] `returnDocument: 'after'` option passed to `findOneAndUpdate`
- [ ] `null` return from `findOneAndUpdate` mapped to `{ status: 'not-found' }`
- [ ] Structured JSON logs emitted at all lifecycle stages
- [ ] Function does NOT open or close a MongoDB connection
- [ ] Guard clauses use `err.code` pattern

### 🔗 Depends On Tasks
- Task 1: Date Normaliser Utilities (regex guard on `date` format)

### 🚀 Unblocks Tasks
- Task 4: Route Handler
- Task 5: Integration Tests

---
