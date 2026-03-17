---
## ⚙️ AGENT TASK PACK: Task 2 — Request Validator
**Status:** [ ] Not Started | [ ] In Progress | [ ] In Review | [ ] Done

### Quick Reference
- **What to Build:** A pure validation function that guards the `POST /update-patient-record` route against malformed or dangerous payloads.
- **Why It Matters:** Without this, malformed requests reach the database layer, and callers get cryptic MongoDB errors instead of actionable 400 responses.
- **Time Estimate:** 2 hours
- **Difficulty:** Low

---

### 🎯 Implementation Task

**File to Modify:** `llmHelpers.js`
**Where to Insert:** After `normaliseDate` / `isValidCalendarDate` (Task 1), before `dedupeKeyForArrayItem`.
**Also update:** `module.exports` at the bottom of `llmHelpers.js`.

> **Why `llmHelpers.js` and not `index.js`?**
> Placing the validator in `llmHelpers.js` makes it independently unit-testable without starting an HTTP server. The route handler in `index.js` imports and calls it.

**Function Signature:**

```javascript
/**
 * Validates and normalises the body payload for POST /update-patient-record.
 *
 * On success, returns a normalised object ready for the service layer.
 * On failure, throws a plain object { statusCode: number, message: string }
 * so the route handler can write the correct HTTP status without wrapping in Error.
 *
 * @param {unknown} data  - Parsed request body (from parseBody)
 * @returns {{ patient_id: string, date: string, results: object }}
 * @throws {{ statusCode: number, message: string }}
 */
function validateUpdateRequest(data) { ... }
```

**Full Implementation to Copy:**

```javascript
function validateUpdateRequest(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw { statusCode: 400, message: 'Request body must be a JSON object' };
    }

    // ── patient_id ───────────────────────────────────────────────────────
    if (typeof data.patient_id !== 'string' || data.patient_id.trim() === '') {
        throw { statusCode: 400, message: 'patient_id is required and must be a non-empty string' };
    }

    // ── date ─────────────────────────────────────────────────────────────
    if (typeof data.date !== 'string' || data.date.trim() === '') {
        throw { statusCode: 400, message: 'date is required and must be a non-empty string' };
    }
    const normalisedDate = normaliseDate(data.date.trim());
    if (!normalisedDate) {
        throw {
            statusCode: 400,
            message: `date "${data.date}" is not a valid calendar date. Use YYYY-MM-DD format.`,
        };
    }

    // ── results ──────────────────────────────────────────────────────────
    if (
        !data.results ||
        typeof data.results !== 'object' ||
        Array.isArray(data.results) ||
        Object.keys(data.results).length === 0
    ) {
        throw { statusCode: 400, message: 'results is required and must be a non-empty plain object' };
    }

    // ── protected fields guard ───────────────────────────────────────────
    const PROTECTED_FIELDS = ['_id', 'patient_id', 'date', 'createdAt'];
    for (const field of PROTECTED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data.results, field)) {
            throw {
                statusCode: 400,
                message: `results must not include protected field "${field}". It is managed by the system.`,
            };
        }
    }

    return {
        patient_id: data.patient_id.trim(),
        date: normalisedDate,
        results: data.results,
    };
}
```

**Export Update:**

```javascript
module.exports = {
    // ... all existing exports ...
    normaliseDate,          // from Task 1
    validateUpdateRequest,  // <-- add this line
};
```

**Requirements:**
1. Depends on `normaliseDate` (Task 1) — must be placed after it in the file
2. Throws `{ statusCode, message }` plain objects — NOT `new Error()` — so the route handler can do `res.writeHead(err.statusCode)`
3. Error messages must name the invalid field explicitly (e.g. `'patient_id is required...'`)
4. `patient_id` must be trimmed in the returned object
5. `date` in the returned object must always be `YYYY-MM-DD` (output of `normaliseDate`)
6. UK format `"23/12/2008"` must be accepted and normalised

**Reference from Feature Document:**
- Section: **2. Payload Schema & Validation**
- Quote: *"Throws an object `{ statusCode, message }` on failure so the route can send the correct HTTP status without try/catch duplication."*
- Section: **7. Error Handling Strategy** — table of scenarios and their HTTP status codes

---

### ✅ Testing Task

**Test File Location:** `tests/unit/request-validator.test.js`

**Write These Tests:**

1. **Happy path — all valid fields**
   - Input: `{ patient_id: 'JOHN_DOE', date: '2008-12-23', results: { notes: 'x' } }`
   - Expected: returns `{ patient_id: 'JOHN_DOE', date: '2008-12-23', results: { notes: 'x' } }`

2. **Happy path — UK date normalised**
   - Input: `{ patient_id: 'JOHN_DOE', date: '23/12/2008', results: { notes: 'x' } }`
   - Expected: returned `date` equals `'2008-12-23'`

3. **Happy path — patient_id trimmed**
   - Input: `{ patient_id: '  JOHN_DOE  ', date: '2008-12-23', results: { notes: 'x' } }`
   - Expected: returned `patient_id` equals `'JOHN_DOE'`

4. **Missing patient_id**
   - Input: `{ date: '2008-12-23', results: { notes: 'x' } }`
   - Expected: throws `{ statusCode: 400, message: /patient_id/ }`

5. **Empty patient_id**
   - Input: `{ patient_id: '   ', date: '2008-12-23', results: { notes: 'x' } }`
   - Expected: throws `{ statusCode: 400 }`

6. **Missing date**
   - Input: `{ patient_id: 'JOHN_DOE', results: { notes: 'x' } }`
   - Expected: throws `{ statusCode: 400, message: /date/ }`

7. **Invalid date string**
   - Input: `{ patient_id: 'JOHN_DOE', date: 'not-a-date', results: { notes: 'x' } }`
   - Expected: throws `{ statusCode: 400, message: /not a valid calendar date/ }`

8. **Missing results**
   - Input: `{ patient_id: 'JOHN_DOE', date: '2008-12-23' }`
   - Expected: throws `{ statusCode: 400, message: /results/ }`

9. **results is null**
   - Input: `{ patient_id: 'JOHN_DOE', date: '2008-12-23', results: null }`
   - Expected: throws `{ statusCode: 400 }`

10. **results is an array**
    - Input: `{ patient_id: 'JOHN_DOE', date: '2008-12-23', results: ['a', 'b'] }`
    - Expected: throws `{ statusCode: 400 }`

11. **results is an empty object**
    - Input: `{ patient_id: 'JOHN_DOE', date: '2008-12-23', results: {} }`
    - Expected: throws `{ statusCode: 400 }`

12. **results contains _id**
    - Input: `{ ..., results: { _id: 'hack', notes: 'x' } }`
    - Expected: throws `{ statusCode: 400, message: /protected field "_id"/ }`

13. **results contains patient_id**
    - Input: `{ ..., results: { patient_id: 'NEW_ID' } }`
    - Expected: throws `{ statusCode: 400, message: /protected field "patient_id"/ }`

14. **results contains date**
    - Input: `{ ..., results: { date: '2099-01-01' } }`
    - Expected: throws `{ statusCode: 400, message: /protected field "date"/ }`

15. **results contains createdAt**
    - Input: `{ ..., results: { createdAt: 'fake' } }`
    - Expected: throws `{ statusCode: 400, message: /protected field "createdAt"/ }`

**Complete Test File to Copy and Modify:**

```javascript
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateUpdateRequest } = require('../../llmHelpers');

const BASE_VALID = {
    patient_id: 'JOHN_DOE',
    date: '2008-12-23',
    results: { notes: 'A note.' },
};

describe('validateUpdateRequest', () => {

  // ── Happy paths ───────────────────────────────────────────────────────

  describe('when given a fully valid payload', () => {
    it('should return the normalised fields', () => {
      const result = validateUpdateRequest(BASE_VALID);
      assert.equal(result.patient_id, 'JOHN_DOE');
      assert.equal(result.date, '2008-12-23');
      assert.deepEqual(result.results, { notes: 'A note.' });
    });

    it('should trim patient_id whitespace', () => {
      const result = validateUpdateRequest({ ...BASE_VALID, patient_id: '  JOHN_DOE  ' });
      assert.equal(result.patient_id, 'JOHN_DOE');
    });

    it('should normalise a UK date format to YYYY-MM-DD', () => {
      const result = validateUpdateRequest({ ...BASE_VALID, date: '23/12/2008' });
      assert.equal(result.date, '2008-12-23');
    });
  });

  // ── patient_id validation ────────────────────────────────────────────

  describe('when patient_id is invalid', () => {
    it('should throw 400 when patient_id is missing', () => {
      const { patient_id, ...rest } = BASE_VALID;
      assert.throws(() => validateUpdateRequest(rest), (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /patient_id/);
        return true;
      });
    });

    it('should throw 400 when patient_id is an empty string', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, patient_id: '' }),
        (err) => err.statusCode === 400
      );
    });

    it('should throw 400 when patient_id is whitespace only', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, patient_id: '   ' }),
        (err) => err.statusCode === 400
      );
    });
  });

  // ── date validation ──────────────────────────────────────────────────

  describe('when date is invalid', () => {
    it('should throw 400 when date is missing', () => {
      const { date, ...rest } = BASE_VALID;
      assert.throws(() => validateUpdateRequest(rest), (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /date/);
        return true;
      });
    });

    it('should throw 400 when date is not a valid calendar date', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, date: 'not-a-date' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.match(err.message, /not a valid calendar date/);
          return true;
        }
      );
    });
  });

  // ── results validation ───────────────────────────────────────────────

  describe('when results is invalid', () => {
    it('should throw 400 when results is missing', () => {
      const { results, ...rest } = BASE_VALID;
      assert.throws(() => validateUpdateRequest(rest), (err) => err.statusCode === 400);
    });

    it('should throw 400 when results is null', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, results: null }),
        (err) => err.statusCode === 400
      );
    });

    it('should throw 400 when results is an array', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, results: ['a', 'b'] }),
        (err) => err.statusCode === 400
      );
    });

    it('should throw 400 when results is an empty object', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, results: {} }),
        (err) => err.statusCode === 400
      );
    });
  });

  // ── protected field guard ────────────────────────────────────────────

  describe('when results contains a protected system field', () => {
    for (const field of ['_id', 'patient_id', 'date', 'createdAt']) {
      it(`should throw 400 and name the protected field "${field}"`, () => {
        assert.throws(
          () => validateUpdateRequest({ ...BASE_VALID, results: { [field]: 'injected', notes: 'x' } }),
          (err) => {
            assert.equal(err.statusCode, 400);
            assert.match(err.message, new RegExp(`protected field "${field}"`));
            return true;
          }
        );
      });
    }
  });

});
```

---

### 📋 Checklist Before Submitting

- [ ] `validateUpdateRequest` added to `llmHelpers.js` after `normaliseDate`
- [ ] `validateUpdateRequest` added to `module.exports`
- [ ] `tests/unit/request-validator.test.js` created
- [ ] All 15 test cases pass with `npm test`
- [ ] Error messages name the specific invalid field
- [ ] Returned `date` is always `YYYY-MM-DD`
- [ ] Returned `patient_id` is always trimmed
- [ ] Throws plain `{ statusCode, message }` objects — not `Error` instances

### 🔗 Depends On Tasks
- Task 1: Date Normaliser Utilities (`normaliseDate` must be defined first)

### 🚀 Unblocks Tasks
- Task 4: Route Handler

---
