---
## ⚙️ AGENT TASK PACK: Task 1 — Date Normaliser Utilities
**Status:** [ ] Not Started | [ ] In Progress | [ ] In Review | [ ] Done

### Quick Reference
- **What to Build:** Two pure utility functions that parse and validate date strings for use in the patient update feature.
- **Why It Matters:** Every other component depends on a reliable, timezone-safe date string — without this, the MongoDB string-equality match on the `date` field will silently miss records.
- **Time Estimate:** 3 hours
- **Difficulty:** Medium

---

### 🎯 Implementation Task

**File to Modify:** `llmHelpers.js`
**Where to Insert:** After the `isPlainObject` helper (around line 246), before `dedupeKeyForArrayItem`.

**Function Signatures:**

```javascript
/**
 * Parses a date string and returns it normalised to "YYYY-MM-DD".
 * Returns null if the input cannot be parsed as a valid calendar date.
 *
 * Supported input formats:
 *   - YYYY-MM-DD              (stored format, returned unchanged)
 *   - YYYY-MM-DDTHH:mm:ss...  (ISO 8601 with time — time is stripped)
 *   - DD/MM/YYYY              (UK NHS format)
 *   - Natural language        ("Dec 23 2008") — via Date parser fallback
 *
 * @param {string} raw
 * @returns {string|null}  "YYYY-MM-DD" or null
 */
function normaliseDate(raw) { ... }

/**
 * Returns true only when year/month/day form a real Gregorian calendar date.
 * Uses Date.UTC to avoid local timezone offsets affecting the check.
 *
 * @param {number} y  Full year (e.g. 2008)
 * @param {number} m  Month 1–12
 * @param {number} d  Day 1–31
 * @returns {boolean}
 */
function isValidCalendarDate(y, m, d) { ... }
```

**Full Implementation to Copy:**

```javascript
function normaliseDate(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim();

    // Pattern 1: YYYY-MM-DD (with optional time component)
    const isoPattern = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/;
    const isoMatch = s.match(isoPattern);
    if (isoMatch) {
        const [, y, m, d] = isoMatch;
        return isValidCalendarDate(Number(y), Number(m), Number(d))
            ? `${y}-${m}-${d}`
            : null;
    }

    // Pattern 2: DD/MM/YYYY (UK NHS format)
    const ukPattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const ukMatch = s.match(ukPattern);
    if (ukMatch) {
        const [, d, m, y] = ukMatch;
        return isValidCalendarDate(Number(y), Number(m), Number(d))
            ? `${y}-${m}-${d}`
            : null;
    }

    // Pattern 3: Natural language fallback (e.g. "Dec 23 2008")
    const parsed = new Date(s);
    if (isNaN(parsed.getTime())) return null;
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function isValidCalendarDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    const check = new Date(Date.UTC(y, m - 1, d));
    return (
        check.getUTCFullYear() === y &&
        check.getUTCMonth() + 1 === m &&
        check.getUTCDate() === d
    );
}
```

**Export Update:**

Add `normaliseDate` to the existing `module.exports` at the bottom of `llmHelpers.js`:

```javascript
module.exports = {
    // ... all existing exports ...
    normaliseDate,   // <-- add this line
};
```

> `isValidCalendarDate` is an internal helper — do NOT export it.

**Requirements:**
1. `normaliseDate` must never throw — always return `string | null`
2. Use `Date.UTC` inside `isValidCalendarDate` — never `new Date(y, m-1, d)` — to prevent local system timezone from affecting validation
3. UK format `DD/MM/YYYY` is a first-class supported format for NHS data entry
4. Strip time components (`T14:30:00`, `Z`, `+01:00`) from ISO strings before returning

**Reference from Feature Document:**
- Section: **3. Date Handling Strategy**
- Quote: *"Clients may submit dates in various formats (`23/12/2008`, `Dec 23 2008`, `2008-12-23T00:00:00`). Before the DB query, normalise to `YYYY-MM-DD` to guarantee an exact string match against stored values."*
- Quote: *"Use `Date.UTC` in `isValidCalendarDate` — not `new Date(y, m-1, d)` — to eliminate local timezone offsets from validation logic."*

---

### ✅ Testing Task

**Test File Location:** `tests/unit/date-normaliser.test.js`

**Write These Tests:**

1. **Happy Path — stored format passthrough**
   - Input: `"2008-12-23"`
   - Expected: `"2008-12-23"` (unchanged)

2. **ISO with time component**
   - Input: `"2008-12-23T14:30:00"`
   - Expected: `"2008-12-23"` (time stripped)

3. **ISO with UTC timezone**
   - Input: `"2008-12-23T00:00:00Z"`
   - Expected: `"2008-12-23"`

4. **UK format — NHS data entry**
   - Input: `"23/12/2008"`
   - Expected: `"2008-12-23"`

5. **Natural language**
   - Input: `"Dec 23 2008"`
   - Expected: `"2008-12-23"`

6. **Impossible date — Feb 30**
   - Input: `"2008-02-30"`
   - Expected: `null`

7. **Valid leap year**
   - Input: `"2000-02-29"`
   - Expected: `"2000-02-29"`

8. **Invalid leap year (1900 not a leap year)**
   - Input: `"1900-02-29"`
   - Expected: `null`

9. **Month out of range**
   - Input: `"2008-13-01"`
   - Expected: `null`

10. **Null input**
    - Input: `null`
    - Expected: `null`

11. **Empty string**
    - Input: `""`
    - Expected: `null`

12. **Unparseable string**
    - Input: `"not-a-date"`
    - Expected: `null`

**Complete Test File to Copy and Modify:**

```javascript
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseDate } = require('../../llmHelpers');

describe('normaliseDate', () => {

  // ── Happy paths ──────────────────────────────────────────────────────────

  describe('when given a valid YYYY-MM-DD string', () => {
    it('should return the date unchanged', () => {
      assert.equal(normaliseDate('2008-12-23'), '2008-12-23');
    });
  });

  describe('when given an ISO 8601 string with a time component', () => {
    it('should strip the time and return YYYY-MM-DD', () => {
      assert.equal(normaliseDate('2008-12-23T14:30:00'), '2008-12-23');
    });

    it('should handle UTC Z suffix', () => {
      assert.equal(normaliseDate('2008-12-23T00:00:00Z'), '2008-12-23');
    });
  });

  describe('when given a UK DD/MM/YYYY string', () => {
    it('should reformat to YYYY-MM-DD', () => {
      assert.equal(normaliseDate('23/12/2008'), '2008-12-23');
    });
  });

  describe('when given a natural language date string', () => {
    it('should parse and return YYYY-MM-DD', () => {
      assert.equal(normaliseDate('Dec 23 2008'), '2008-12-23');
    });
  });

  // ── Leap year handling ───────────────────────────────────────────────────

  describe('when given a valid leap-year date', () => {
    it('should accept 2000-02-29 (divisible by 400)', () => {
      assert.equal(normaliseDate('2000-02-29'), '2000-02-29');
    });

    it('should accept 2004-02-29 (divisible by 4)', () => {
      assert.equal(normaliseDate('2004-02-29'), '2004-02-29');
    });
  });

  describe('when given an invalid leap-year date', () => {
    it('should return null for 1900-02-29 (not a leap year)', () => {
      assert.equal(normaliseDate('1900-02-29'), null);
    });
  });

  // ── Invalid calendar dates ───────────────────────────────────────────────

  describe('when given an impossible calendar date', () => {
    it('should return null for Feb 30', () => {
      assert.equal(normaliseDate('2008-02-30'), null);
    });

    it('should return null for month 13', () => {
      assert.equal(normaliseDate('2008-13-01'), null);
    });
  });

  // ── Null / empty / garbage input ─────────────────────────────────────────

  describe('when given null or empty input', () => {
    it('should return null for null', () => {
      assert.equal(normaliseDate(null), null);
    });

    it('should return null for undefined', () => {
      assert.equal(normaliseDate(undefined), null);
    });

    it('should return null for empty string', () => {
      assert.equal(normaliseDate(''), null);
    });

    it('should return null for a non-date string', () => {
      assert.equal(normaliseDate('not-a-date'), null);
    });

    it('should never throw — returns null instead', () => {
      assert.doesNotThrow(() => normaliseDate('complete garbage!@#$'));
    });
  });

});
```

---

### 📋 Checklist Before Submitting

- [ ] `normaliseDate` function added to `llmHelpers.js`
- [ ] `isValidCalendarDate` added to `llmHelpers.js` (not exported)
- [ ] `normaliseDate` added to `module.exports`
- [ ] `tests/unit/date-normaliser.test.js` created
- [ ] All 12+ test cases pass with `npm test`
- [ ] `Date.UTC` used (not local `new Date()`) inside `isValidCalendarDate`
- [ ] JSDoc comment on `normaliseDate` lists all supported formats
- [ ] Function never throws for any input

### 🔗 Depends On Tasks
- None (no dependencies)

### 🚀 Unblocks Tasks
- Task 2: Request Validator
- Task 3: Update Patient Record Service

---
