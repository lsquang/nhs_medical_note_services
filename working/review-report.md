# REVIEW AGENT REPORT
**Feature:** Patient Data Update — `POST /update-patient-record`
**Review Date:** 2026-03-17
**Reviewer:** Review Agent (master_implementation_plan.md)

---

## Overall Verdict: ⛔ BLOCKED — Implementation Not Started

The review was triggered against the current codebase state. All 5 tasks from the master plan are **pending**. No new code has been written for this feature yet.

---

## 1. TEST RESULTS

```
npm test output:
  ✔ 9 existing merge tests — all pass
  ✗ 0 new feature tests — none exist yet

Total new tests expected:  52
Total new tests present:    0
```

| Task | Test File | Expected | Present | Status |
|------|-----------|----------|---------|--------|
| 1 — Date Normaliser | `tests/unit/date-normaliser.test.js` | 12 | 0 | ⛔ Missing |
| 2 — Request Validator | `tests/unit/request-validator.test.js` | 15 | 0 | ⛔ Missing |
| 3 — Service Function | `tests/unit/update-patient-record.test.js` | 11 | 0 | ⛔ Missing |
| 4 — Route Handler | `tests/unit/route-update-patient.test.js` | 8 | 0 | ⛔ Missing |
| 5 — Integration | `tests/integration/update-patient-record.test.js` | 10 | 0 | ⛔ Missing |

---

## 2. GATE CRITERIA — Stage 1 (Task 1)

**Gate:** All 12 `date-normaliser` tests pass + `normaliseDate` exported

| Criterion | Status | Evidence |
|-----------|--------|---------|
| `normaliseDate` exists in `llmHelpers.js` | ⛔ FAIL | Not present in file (lines 1–706) |
| `isValidCalendarDate` exists in `llmHelpers.js` | ⛔ FAIL | Not present |
| `normaliseDate` exported from `module.exports` | ⛔ FAIL | `module.exports` at line 694 does not include it |
| Test file `tests/unit/date-normaliser.test.js` exists | ⛔ FAIL | File not found |
| 12 tests pass | ⛔ FAIL | No tests to run |

**Stage 1 gate: NOT PASSED — Stage 2 must not begin**

---

## 3. GATE CRITERIA — Stage 2 (Tasks 2 & 3)

Cannot be evaluated until Stage 1 gate passes.

| Criterion | Status |
|-----------|--------|
| `validateUpdateRequest` in `llmHelpers.js` | ⛔ FAIL — not present |
| `updatePatientRecord` in `llmHelpers.js` | ⛔ FAIL — not present |
| Both exported from `module.exports` | ⛔ FAIL |
| 15 validator tests pass | ⛔ FAIL — no test file |
| 11 service tests pass | ⛔ FAIL — no test file |

---

## 4. GATE CRITERIA — Stage 3 (Task 4)

Cannot be evaluated until Stage 2 gate passes.

| Criterion | Status |
|-----------|--------|
| `require('./llmHelpers')` in `index.js` includes new functions | ⛔ FAIL — line 7 only imports original 5 exports |
| `POST /update-patient-record` route block present in `index.js` | ⛔ FAIL — not present |
| 404 `availableRoutes` updated | ⛔ FAIL |
| `server.listen` log updated | ⛔ FAIL |
| `module.exports = { server }` at bottom of `index.js` | ⛔ FAIL |
| 8 route tests pass | ⛔ FAIL |

---

## 5. GATE CRITERIA — Stage 4 (Task 5)

Cannot be evaluated until Stage 3 gate passes.

| Criterion | Status |
|-----------|--------|
| `tests/integration/update-patient-record.test.js` exists | ⛔ FAIL |
| 10 integration tests pass | ⛔ FAIL |

---

## 6. CODE QUALITY REVIEW

### `llmHelpers.js` — Current `module.exports` (line 694)

```javascript
module.exports = {
  convertToJson,
  fakeConvertToJson,
  addNote,
  listGeminiModels,
  connectMongo,
  findAllRecordsForPatient,
  mergePatientDocuments,
  mergePatientRecords,
  generateMongoQueryFromText,
  reformatResults,
  searchNotes,
};
```

**Missing exports required by downstream tasks:**
- `normaliseDate` (needed by Task 2, Task 4)
- `validateUpdateRequest` (needed by Task 4)
- `updatePatientRecord` (needed by Task 4)

### `index.js` — Current `require` (line 7)

```javascript
const { addNote, listGeminiModels, searchNotes, connectMongo, mergePatientRecords } = require('./llmHelpers');
```

**Missing imports required by the route:**
- `updatePatientRecord`
- `validateUpdateRequest`
- `normaliseDate`

### Positive Findings (existing code, no regressions)

- ✅ All 9 existing merge tests still pass — no regressions
- ✅ No syntax errors or crashes introduced
- ✅ `connectMongo` pattern is ready to be used by new route
- ✅ `parseBody` helper is available for new route handler

---

## 7. LOGICAL CORRECTNESS — Pre-implementation Notes

The following risks from `patient-data-update-feature.md` are not yet mitigated (pending implementation):

| Risk | Task that mitigates it | Current state |
|------|----------------------|---------------|
| UK date format `23/12/2008` won't match stored `2008-12-23` | Task 1 (`normaliseDate`) | ⛔ Not implemented |
| LLM-inserted docs may store `date` with time component | Task 1 + migration script | ⛔ Not implemented |
| `_id`/`patient_id` overwrite via `results` payload | Task 2 (`validateUpdateRequest`) | ⛔ Not implemented |
| MongoDB client left open on exception | Task 4 (`finally` block) | ⛔ Not implemented |

---

## 8. BLOCKING CONCERNS

| Concern | Severity | Blocks |
|---------|----------|--------|
| No new functions implemented | Critical | All stages |
| No test files created | Critical | All gates |
| `module.exports` not updated | Critical | Tasks 2, 3, 4 |
| `index.js` route missing | Critical | Task 4, Task 5 |
| `module.exports = { server }` missing from `index.js` | High | Task 4 unit tests, Task 5 integration tests |

---

## 9. RECOMMENDED NEXT ACTION

**Start Stage 1 immediately.**

The agent assigned to Task 1 should:

1. Open `task-pack-1-date-normaliser.md`
2. Add `normaliseDate` and `isValidCalendarDate` to `llmHelpers.js` after line 246 (`isPlainObject`)
3. Add `normaliseDate` to `module.exports`
4. Create `tests/unit/date-normaliser.test.js`
5. Run `npm test` — confirm 12 new tests pass alongside the existing 9

Only after Stage 1 gate is passed should Tasks 2 and 3 begin in parallel.

---

## Summary

| Stage | Gate Status | Can Proceed? |
|-------|------------|-------------|
| Stage 1 (Task 1) | ⛔ NOT PASSED | **Start now** |
| Stage 2 (Tasks 2 & 3) | ⛔ BLOCKED | Waiting on Stage 1 |
| Stage 3 (Task 4) | ⛔ BLOCKED | Waiting on Stage 2 |
| Stage 4 (Task 5) | ⛔ BLOCKED | Waiting on Stage 3 |

**Existing codebase integrity: ✅ HEALTHY — 9/9 merge tests passing, no regressions.**
