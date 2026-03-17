# Master Execution Plan: Patient Data Update Feature

> Execution order, ownership slots, and gate criteria for `POST /update-patient-record`.
> Follow this plan top-to-bottom. Each stage must pass its gate before the next begins.

---

## Execution Flow

```
┌─────────────────────────────────────────────────────────┐
│  STAGE 1 — Foundation (blocking)                        │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Task 1: Date Normaliser Utilities                │  │
│  │  File:   llmHelpers.js                            │  │
│  │  Adds:   normaliseDate(), isValidCalendarDate()   │  │
│  │  Tests:  tests/unit/date-normaliser.test.js       │  │
│  │  Hours:  3     Test cases: 12                     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │  Gate: all 12 tests pass
                          ▼
┌─────────────────────────────────────────────────────────┐
│  STAGE 2 — Parallel (run simultaneously)                │
│                                                         │
│  ┌──────────────────────┐  ┌──────────────────────────┐ │
│  │ Task 2               │  │ Task 3                   │ │
│  │ Request Validator    │  │ Update Patient Record    │ │
│  │                      │  │ Service                  │ │
│  │ File: llmHelpers.js  │  │ File: llmHelpers.js      │ │
│  │ Adds: validateUpdate │  │ Adds: updatePatient      │ │
│  │       Request()      │  │       Record()           │ │
│  │                      │  │                          │ │
│  │ Tests:               │  │ Tests:                   │ │
│  │  unit/request-       │  │  unit/update-patient-    │ │
│  │  validator.test.js   │  │  record.test.js          │ │
│  │                      │  │                          │ │
│  │ Hours: 2             │  │ Hours: 4                 │ │
│  │ Test cases: 15       │  │ Test cases: 11           │ │
│  └──────────────────────┘  └──────────────────────────┘ │
└─────────────────────────┬───────────────────────────────┘
                          │  Gate: all 26 tests pass
                          ▼
┌─────────────────────────────────────────────────────────┐
│  STAGE 3 — HTTP Wiring (blocking)                       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Task 4: Route Handler                            │  │
│  │  File:   index.js                                 │  │
│  │  Adds:   POST /update-patient-record route        │  │
│  │          updated require(), availableRoutes,      │  │
│  │          startup log, module.exports              │  │
│  │  Tests:  tests/unit/route-update-patient.test.js  │  │
│  │  Hours:  3     Test cases: 8                      │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │  Gate: all 8 tests pass
                          │        manual requests.http verified
                          ▼
┌─────────────────────────────────────────────────────────┐
│  STAGE 4 — Integration (blocking)                       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Task 5: Integration Tests                        │  │
│  │  File:   tests/integration/                       │  │
│  │          update-patient-record.test.js            │  │
│  │  Proves: full HTTP → route → MongoDB round-trip   │  │
│  │  Hours:  4     Test cases: 10                     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │  Gate: all 10 tests pass
                          ▼
                    ✅ FEATURE DONE
```

---

## Stage-by-Stage Details

---

### Stage 1 — Task 1: Date Normaliser Utilities

**Why first:** Every other component calls `normaliseDate`. Nothing else can be built or tested without it.

| | |
|--|--|
| **Task pack** | `task-pack-1-date-normaliser.md` |
| **File to modify** | `llmHelpers.js` |
| **Functions to add** | `normaliseDate(raw)`, `isValidCalendarDate(y, m, d)` |
| **Export** | Add `normaliseDate` to `module.exports` |
| **Test file** | `tests/unit/date-normaliser.test.js` |
| **Test cases** | 12 |
| **Estimated hours** | 3 |

**Gate criteria before Stage 2:**
- [ ] `npm test` — all 12 date-normaliser tests pass
- [ ] `normaliseDate('23/12/2008')` returns `'2008-12-23'` (UK format)
- [ ] `normaliseDate('2008-02-30')` returns `null` (impossible date)
- [ ] `normaliseDate` exported from `module.exports`

---

### Stage 2 — Tasks 2 & 3: Parallel

Both tasks depend only on Task 1. Assign to two developers/agents simultaneously.

---

#### Task 2: Request Validator

| | |
|--|--|
| **Task pack** | `task-pack-2-request-validator.md` |
| **File to modify** | `llmHelpers.js` |
| **Function to add** | `validateUpdateRequest(data)` |
| **Export** | Add `validateUpdateRequest` to `module.exports` |
| **Test file** | `tests/unit/request-validator.test.js` |
| **Test cases** | 15 |
| **Estimated hours** | 2 |
| **Unblocks** | Task 4 |

**What it validates:**
- `patient_id` — non-empty string, trimmed
- `date` — parseable, normalised to `YYYY-MM-DD` via `normaliseDate`
- `results` — non-empty plain object
- `results` does not contain `_id`, `patient_id`, `date`, or `createdAt`

**Throws:** `{ statusCode: 400, message: '...' }` — not an `Error` instance

---

#### Task 3: Update Patient Record Service

| | |
|--|--|
| **Task pack** | `task-pack-3-update-patient-record-service.md` |
| **File to modify** | `llmHelpers.js` |
| **Function to add** | `updatePatientRecord(db, patient_id, date, results)` |
| **Export** | Add `updatePatientRecord` to `module.exports` |
| **Test file** | `tests/unit/update-patient-record.test.js` |
| **Test cases** | 11 |
| **Estimated hours** | 4 |
| **Unblocks** | Tasks 4 and 5 |

**Key design decisions:**
- Filter: `{ patient_id: patient_id.trim(), date }` — exact string equality
- Update: `$set` (not `replaceOne`) — preserves untouched fields
- Returns `{ status: 'not-found' }` when `findOneAndUpdate` returns `null`
- Returns `{ status: 'updated', document }` on success
- Does NOT open/close MongoDB — caller owns connection lifecycle

**Merge conflict note:** Both Task 2 and Task 3 modify `llmHelpers.js`. Coordinate insertion order:
- Task 2's `validateUpdateRequest` goes **before** Task 3's `updatePatientRecord`
- Both go before `module.exports`

**Gate criteria before Stage 3 (both tasks must pass):**
- [ ] `npm test` — all 15 validator tests pass
- [ ] `npm test` — all 11 service tests pass
- [ ] `validateUpdateRequest` and `updatePatientRecord` both exported
- [ ] No conflicts in `llmHelpers.js` between the two additions

---

### Stage 3 — Task 4: Route Handler

**Why after Stage 2:** The route handler imports and calls both `validateUpdateRequest` and `updatePatientRecord`. Both must be working before wiring.

| | |
|--|--|
| **Task pack** | `task-pack-4-route-handler.md` |
| **File to modify** | `index.js` (4 locations) |
| **Test file** | `tests/unit/route-update-patient.test.js` |
| **Test cases** | 8 |
| **Estimated hours** | 3 |

**4 changes to make in `index.js`:**

| # | Location | Change |
|---|----------|--------|
| 1 | Top `require` | Add `updatePatientRecord`, `validateUpdateRequest`, `normaliseDate` to destructure |
| 2 | After `/merge-patient-records` block | Insert `POST /update-patient-record` route block |
| 3 | 404 handler `availableRoutes` array | Add entry for new route |
| 4 | `server.listen` startup log | Add `console.log` line for new endpoint |

**Also add to bottom of `index.js`:**
```javascript
module.exports = { server };
```
This enables the route unit tests and integration tests to start the server programmatically.

**Gate criteria before Stage 4:**
- [ ] `npm test` — all 8 route tests pass
- [ ] `POST /update-patient-record` with missing `patient_id` → HTTP 400
- [ ] `POST /update-patient-record` with `results: { _id: 'x' }` → HTTP 400
- [ ] All 6 manual `requests.http` scenarios run and return expected status codes
- [ ] `client.close()` confirmed in `finally` block (code review)

---

### Stage 4 — Task 5: Integration Tests

**Why last:** Requires both the route (Task 4) and service (Task 3) to be fully working against a real database.

| | |
|--|--|
| **Task pack** | `task-pack-5-integration-tests.md` |
| **File to create** | `tests/integration/update-patient-record.test.js` |
| **Test cases** | 10 |
| **Estimated hours** | 4 |
| **DB required** | Local MongoDB OR `mongodb-memory-server` |

**What integration tests prove that unit tests cannot:**

| Concern | Why a mock can't catch it |
|---------|--------------------------|
| Date string exact-match | Mock accepts any filter; real MongoDB requires the string to match byte-for-byte |
| `$set` preserves untouched fields | Mock returns whatever you tell it; real MongoDB only sets the specified fields |
| `_id` never overwritten | Must verify directly in DB after update |
| UK date format matches stored record | End-to-end normalisation path needs the real collection |
| `updatedAt` persisted correctly | Requires real round-trip |

**Gate criteria — feature complete:**
- [ ] All 10 integration tests pass against real (or in-memory) MongoDB
- [ ] `afterEach` cleanup confirmed — no `TEST_INTEG_` documents left between tests
- [ ] Feature document `patient-data-update-feature.md` integration checklist fully ticked

---

## Effort & Timeline Summary

| Stage | Tasks | Hours | Parallelisable |
|-------|-------|-------|----------------|
| 1 | Task 1 | 3 hrs | No |
| 2 | Tasks 2 + 3 | 4 hrs (parallel) | **Yes — run simultaneously** |
| 3 | Task 4 | 3 hrs | No |
| 4 | Task 5 | 4 hrs | No |
| **Total** | **5 tasks** | **14 hrs sequential / 10 hrs with parallel Stage 2** | |

---

## Total Test Count

| Stage | Task | Tests Added | Running Total |
|-------|------|-------------|--------------|
| 1 | Date Normaliser | 12 | 12 |
| 2 | Request Validator | 15 | 27 |
| 2 | Service Function | 11 | 38 |
| 3 | Route Handler | 8 | 46 |
| 4 | Integration | 10 | **56** |

---

## File Inventory

### Files to Modify

| File | Changes |
|------|---------|
| `llmHelpers.js` | Add `normaliseDate`, `isValidCalendarDate`, `validateUpdateRequest`, `updatePatientRecord`; update `module.exports` |
| `index.js` | Add route block, update `require`, update 404 list, update startup log, add `module.exports` |

### Files to Create

| File | Created by |
|------|-----------|
| `tests/unit/date-normaliser.test.js` | Task 1 |
| `tests/unit/request-validator.test.js` | Task 2 |
| `tests/unit/update-patient-record.test.js` | Task 3 |
| `tests/unit/route-update-patient.test.js` | Task 4 |
| `tests/integration/update-patient-record.test.js` | Task 5 |
| `tests/fixtures/sample-medical-note.js` | Task 5 |
| `tests/fixtures/update-payloads.js` | Task 5 |
| `tests/fixtures/date-inputs.js` | Task 1 (optional) |

### Reference Documents (read-only)

| File | Used by |
|------|---------|
| `patient-data-update-feature.md` | All tasks |
| `nodejs-techniques-guide.md` | All tasks |
| `task-pack-1-date-normaliser.md` | Agent doing Task 1 |
| `task-pack-2-request-validator.md` | Agent doing Task 2 |
| `task-pack-3-update-patient-record-service.md` | Agent doing Task 3 |
| `task-pack-4-route-handler.md` | Agent doing Task 4 |
| `task-pack-5-integration-tests.md` | Agent doing Task 5 |
| `test-strategy-patient-update.md` | All agents |

---

## Quick-Start Checklist

```
□ Stage 1
  □ Read task-pack-1-date-normaliser.md
  □ Add normaliseDate + isValidCalendarDate to llmHelpers.js
  □ Add normaliseDate to module.exports
  □ Create tests/unit/date-normaliser.test.js
  □ npm test → 12 passing
  ✓ GATE PASSED — begin Stage 2

□ Stage 2 (parallel)
  □ [Agent A] Read task-pack-2-request-validator.md
  □ [Agent A] Add validateUpdateRequest to llmHelpers.js + module.exports
  □ [Agent A] Create tests/unit/request-validator.test.js
  □ [Agent A] npm test → 15 passing

  □ [Agent B] Read task-pack-3-update-patient-record-service.md
  □ [Agent B] Add updatePatientRecord to llmHelpers.js + module.exports
  □ [Agent B] Create tests/unit/update-patient-record.test.js
  □ [Agent B] npm test → 11 passing

  □ Merge llmHelpers.js changes (Task 2 before Task 3, both before module.exports)
  ✓ GATE PASSED — begin Stage 3

□ Stage 3
  □ Read task-pack-4-route-handler.md
  □ Update require() in index.js
  □ Add POST /update-patient-record route block
  □ Update availableRoutes + startup log
  □ Add module.exports = { server } to index.js
  □ Create tests/unit/route-update-patient.test.js
  □ npm test → 8 passing
  □ Run requests.http manually — all 6 scenarios correct
  ✓ GATE PASSED — begin Stage 4

□ Stage 4
  □ Read task-pack-5-integration-tests.md
  □ Create tests/integration/update-patient-record.test.js
  □ Create tests/fixtures/ files
  □ npm test → 10 integration tests passing
  □ Tick all items in patient-data-update-feature.md § Integration Checklist
  ✓ FEATURE COMPLETE
```
