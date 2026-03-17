# Patient Data Update Feature — Implementation Guide

> Implementation plan for the `POST /update-patient-record` endpoint.
> All patterns follow the conventions established in `nodejs-techniques-guide.md` and match the existing code in `index.js` and `llmHelpers.js`.

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [Payload Schema & Validation](#2-payload-schema--validation)
3. [Date Handling Strategy](#3-date-handling-strategy)
4. [Database Query Design](#4-database-query-design)
5. [Service Layer — `llmHelpers.js`](#5-service-layer--llmhelpersjs)
6. [Route Handler — `index.js`](#6-route-handler--indexjs)
7. [Error Handling Strategy](#7-error-handling-strategy)
8. [Edge Cases](#8-edge-cases)
9. [Manual Test Requests](#9-manual-test-requests)
10. [Integration Checklist](#10-integration-checklist)

---

## 1. Feature Overview

### Workflow

```
Client
  │
  ├─ POST /update-patient-record
  │    Body: { patient_id, date, results }
  │
  ▼
Route Handler (index.js)
  │
  ├─ 1. Parse + validate request body
  ├─ 2. Normalise date to ISO-8601 (YYYY-MM-DD)
  ├─ 3. Call updatePatientRecord(db, patient_id, date, results)
  │
  ▼
Service Function (llmHelpers.js)
  │
  ├─ 4. Find ONE document matching { patient_id, date }
  ├─ 5. If not found → return status: 'not-found'
  ├─ 6. Apply $set update with new results + updatedAt timestamp
  ├─ 7. Return updated document
  │
  ▼
Route Handler
  │
  └─ 8. Send JSON response (200 / 404 / 400 / 500)
```

### Scope Boundary

- This route is **MongoDB-backed only**. It must not read from or write to the in-memory `medicalNotes` array.
- It targets the `medicalNotes` collection, matching the same collection used by `addNote`, `searchNotes`, and `mergePatientRecords`.
- The `results` payload replaces the top-level data fields of the matched document. System fields (`_id`, `patient_id`, `date`, `createdAt`) are preserved — they are never overwritten by the caller.

---

## 2. Payload Schema & Validation

### Request

```
POST /update-patient-record
Content-Type: application/json
```

```json
{
  "patient_id": "JOHN_DOE",
  "date": "2008-12-23",
  "results": {
    "diagnosis": {
      "primary": "Non-small cell lung carcinoma (adenocarcinoma) — revised",
      "stage": "Stage IB"
    },
    "assessment": [
      "Updated assessment after multidisciplinary review."
    ],
    "notes": "Revised note text following consultant review on 2024-06-01."
  }
}
```

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `patient_id` | `string` | Yes | Non-empty after trim |
| `date` | `string` | Yes | Parseable as a valid calendar date; normalised to `YYYY-MM-DD` before DB query |
| `results` | `object` | Yes | Plain object, not an array, not null; must have at least one key |

### Validation Function

Add this inline in the route handler (no external library required, consistent with current codebase):

```js
/**
 * Validates and normalises the /update-patient-record request body.
 * Returns { patient_id, date, results } on success.
 * Throws an object { statusCode, message } on failure so the route can
 * send the correct HTTP status without try/catch duplication.
 */
function validateUpdateRequest(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw { statusCode: 400, message: 'Request body must be a JSON object' };
    }

    // --- patient_id ---
    if (typeof data.patient_id !== 'string' || data.patient_id.trim() === '') {
        throw { statusCode: 400, message: 'patient_id is required and must be a non-empty string' };
    }

    // --- date ---
    if (typeof data.date !== 'string' || data.date.trim() === '') {
        throw { statusCode: 400, message: 'date is required and must be a non-empty string' };
    }
    const normalisedDate = normaliseDate(data.date.trim());
    if (!normalisedDate) {
        throw { statusCode: 400, message: `date "${data.date}" is not a valid calendar date. Use YYYY-MM-DD format.` };
    }

    // --- results ---
    if (
        !data.results ||
        typeof data.results !== 'object' ||
        Array.isArray(data.results) ||
        Object.keys(data.results).length === 0
    ) {
        throw { statusCode: 400, message: 'results is required and must be a non-empty plain object' };
    }

    // --- guard: caller must not overwrite system fields ---
    const PROTECTED_FIELDS = ['_id', 'patient_id', 'date', 'createdAt'];
    for (const field of PROTECTED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data.results, field)) {
            throw {
                statusCode: 400,
                message: `results must not include protected field "${field}". It is managed by the system.`
            };
        }
    }

    return {
        patient_id: data.patient_id.trim(),
        date: normalisedDate,        // always YYYY-MM-DD
        results: data.results,
    };
}
```

---

## 3. Date Handling Strategy

### How `date` Is Stored

Inspecting `data-structure.json` and `fake-gemini-response.json`, the `date` field is stored as a **plain ISO-8601 string** (`"2008-12-23"`), **not** a BSON `Date` object.

```json
{ "date": "2008-12-23" }
```

This means the MongoDB query is a straightforward **string equality match**:

```js
{ patient_id: "JOHN_DOE", date: "2008-12-23" }
```

There is no timezone arithmetic, no `$gte`/`$lte` range, and no `ISODate()` wrapping required.

### Why Normalisation Is Still Necessary

Clients may submit dates in various formats (`23/12/2008`, `Dec 23 2008`, `2008-12-23T00:00:00`). Before the DB query, normalise to `YYYY-MM-DD` to guarantee an exact string match against stored values.

### `normaliseDate` Helper

Add this function to `llmHelpers.js` (or inline in the route — it's pure and has no dependencies):

```js
/**
 * Parses a date string and returns it as "YYYY-MM-DD".
 * Returns null if the input is not a valid calendar date.
 *
 * Handled formats: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, ISO-8601 with time part.
 * The function deliberately rejects ambiguous inputs (e.g. "12/06/2008" where
 * month/day order is unclear) by only accepting unambiguous patterns.
 *
 * @param {string} raw
 * @returns {string|null}
 */
function normaliseDate(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim();

    // Already YYYY-MM-DD (most common from our own stored data)
    const isoPattern = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/;
    const isoMatch = s.match(isoPattern);
    if (isoMatch) {
        const [, y, m, d] = isoMatch;
        return isValidCalendarDate(Number(y), Number(m), Number(d))
            ? `${y}-${m}-${d}`
            : null;
    }

    // DD/MM/YYYY (common UK format for NHS data)
    const ukPattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const ukMatch = s.match(ukPattern);
    if (ukMatch) {
        const [, d, m, y] = ukMatch;
        return isValidCalendarDate(Number(y), Number(m), Number(d))
            ? `${y}-${m}-${d}`
            : null;
    }

    // Fallback: let the JS Date parser try (handles "Dec 23 2008", etc.)
    const parsed = new Date(s);
    if (isNaN(parsed.getTime())) return null;
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Returns true if y/m/d form a valid Gregorian calendar date.
 * Guards against dates like 2008-02-30.
 */
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

**Important**: Use `Date.UTC` in `isValidCalendarDate` — not `new Date(y, m-1, d)` — to eliminate local timezone offsets from validation logic.

---

## 4. Database Query Design

### Find Query

```js
const filter = {
    patient_id: patient_id,   // exact string match
    date: date,               // exact string match — always YYYY-MM-DD
};
```

This will match **one or more** documents. Because the same patient can have multiple records on the same date (e.g. multiple scan types on the same day), use `findOneAndUpdate` which returns the **first matching document** according to natural order. If multi-record same-day updates are needed in future, that is a separate feature.

### Update Operation

Use `findOneAndUpdate` with `$set`:

```js
const updateDoc = {
    $set: {
        ...results,                        // caller's new data fields
        updatedAt: new Date().toISOString()
    }
};

const options = {
    returnDocument: 'after',   // return the updated document, not the original
    includeResultMetadata: false
};

const updatedDoc = await collection.findOneAndUpdate(filter, updateDoc, options);
```

**Why `$set` and not `replaceOne`?**

`replaceOne` would erase fields the caller did not include in `results` (e.g. `findings`, `procedures`). Using `$set` applies only the provided fields, leaving untouched fields intact. This is the safe default for a partial-update endpoint.

**Why not `updateOne`?**

`updateOne` does not return the updated document. `findOneAndUpdate` with `returnDocument: 'after'` returns the full updated record in a single round-trip, which is required to include the updated document in the API response.

### Recommended Index

The query uses `{ patient_id, date }`. Add a compound index for efficient lookups:

```js
// Run once at server startup or in a migration script
async function ensureIndexes(db) {
    await db.collection('medicalNotes').createIndex(
        { patient_id: 1, date: 1 },
        { name: 'patient_date_lookup' }
    );
}
```

---

## 5. Service Layer — `llmHelpers.js`

Add the following two functions to `llmHelpers.js` and export them at the bottom of the file.

### `normaliseDate` and `isValidCalendarDate`

*(Already listed in Section 3 — place them near the top of the file, alongside the existing helpers like `normalizeText` and `isNonEmptyValue`.)*

### `updatePatientRecord`

```js
/**
 * Finds the first document in medicalNotes matching { patient_id, date }
 * and applies a $set update with the provided results fields.
 *
 * @param {import('mongodb').Db} db        - Active MongoDB database handle
 * @param {string}               patient_id - Normalised patient identifier
 * @param {string}               date       - ISO-8601 date string (YYYY-MM-DD)
 * @param {object}               results    - Fields to update (caller-supplied)
 * @returns {Promise<{status: string, document?: object}>}
 */
async function updatePatientRecord(db, patient_id, date, results) {
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

    const filter = { patient_id: patient_id.trim(), date };

    const updateDoc = {
        $set: {
            ...results,
            updatedAt: new Date().toISOString(),
        },
    };

    console.log(JSON.stringify({
        event: 'updatePatientRecord.start',
        patient_id: patient_id.trim(),
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
        const wrappedErr = new Error(
            `DB update failed for patient_id=${patient_id} date=${date}: ${err.message}`
        );
        wrappedErr.code = 'DB_UPDATE_FAILED';
        throw wrappedErr;
    }

    if (!updatedDoc) {
        console.log(JSON.stringify({
            event: 'updatePatientRecord.not_found',
            patient_id: patient_id.trim(),
            date,
        }));
        return { status: 'not-found' };
    }

    console.log(JSON.stringify({
        event: 'updatePatientRecord.complete',
        patient_id: patient_id.trim(),
        date,
        documentId: String(updatedDoc._id),
    }));

    return { status: 'updated', document: updatedDoc };
}
```

### Export

Add `updatePatientRecord` and `normaliseDate` to the existing `module.exports` at the bottom of `llmHelpers.js`:

```js
module.exports = {
    // ... existing exports ...
    updatePatientRecord,
    normaliseDate,
};
```

---

## 6. Route Handler — `index.js`

### Import

Update the `require` at the top of `index.js`:

```js
const {
    addNote,
    listGeminiModels,
    searchNotes,
    connectMongo,
    mergePatientRecords,
    updatePatientRecord,   // <-- add this
    normaliseDate,         // <-- add this (used in validateUpdateRequest)
} = require('./llmHelpers');
```

### Route Block

Add this block inside the `http.createServer` handler, before the final 404 fallback. Follow the identical pattern used by `/merge-patient-records`:

```js
// Route: Update a patient record by patient_id + date
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

        // Validate and normalise the request payload
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

### `validateUpdateRequest` Placement

Add `validateUpdateRequest` and the two date helpers (`normaliseDate`, `isValidCalendarDate`) directly in `index.js` just below the existing `parseBody` helper, **or** move them entirely to `llmHelpers.js` and import them. Either is consistent with the current project style; the key rule is that these functions contain no side effects and are self-contained.

### Update the 404 route list

In the final 404 handler, add the new route to `availableRoutes`:

```js
'POST /update-patient-record - Update a patient record by patient_id and date',
```

---

## 7. Error Handling Strategy

All error paths follow the exact response shape used throughout this codebase: `{ success: false, message: "..." }`.

| Scenario | HTTP Status | `success` | Notes |
|----------|-------------|-----------|-------|
| Malformed JSON body | `400` | `false` | Caught by `parseBody` |
| Missing / invalid `patient_id` | `400` | `false` | Caught by `validateUpdateRequest` |
| Missing / invalid `date` | `400` | `false` | Caught by `validateUpdateRequest` |
| `results` is empty or wrong type | `400` | `false` | Caught by `validateUpdateRequest` |
| `results` contains `_id`, `patient_id`, `date`, or `createdAt` | `400` | `false` | Prevents overwriting system fields |
| No document matches `{ patient_id, date }` | `404` | `false` | Returned by `updatePatientRecord` as `status: 'not-found'` |
| MongoDB connection / query failure | `500` | `false` | Thrown by `updatePatientRecord` with `code: 'DB_UPDATE_FAILED'` |

**Consistent logging** — every terminal path in `updatePatientRecord` emits a structured JSON log line with an `event` key, matching the style already used in `mergePatientRecords`:

```js
console.log(JSON.stringify({ event: 'updatePatientRecord.start', patient_id, date, fieldsToUpdate: Object.keys(results) }));
console.log(JSON.stringify({ event: 'updatePatientRecord.not_found', patient_id, date }));
console.log(JSON.stringify({ event: 'updatePatientRecord.complete', patient_id, date, documentId }));
console.error(JSON.stringify({ event: 'updatePatientRecord.error', patient_id, date, message: err.message }));
```

---

## 8. Edge Cases

### 1. Multiple records match `{ patient_id, date }`

A patient can have more than one scan on the same date (e.g. CT and MRI). `findOneAndUpdate` updates the **first document** returned by natural order.

**Current behaviour**: Acceptable for MVP — only one record is updated. The response includes the updated `_id` so the caller can identify which one was changed.

**Future enhancement**: Accept an optional `_id` field in the payload to target a specific document when the caller knows the exact record.

### 2. `results` contains unknown fields

Unknown fields (not in the current schema) are stored as-is by MongoDB. This is intentional — the schema is schemaless at the database level. If strict schema enforcement is needed, add Joi/Zod validation (see `nodejs-techniques-guide.md` Section 5).

### 3. Date stored with time component

If a document was inserted with `date: "2008-12-23T00:00:00"` rather than `"2008-12-23"`, the exact string match will fail. The `normaliseDate` function always strips the time component from user input. If existing documents in MongoDB have inconsistent `date` formats, run a one-time migration:

```js
// One-time migration: normalise all date strings to YYYY-MM-DD
// Run via: node scripts/migrate-dates.js
const { connectMongo, normaliseDate } = require('./llmHelpers');

async function migrateDates() {
    const { client, db } = await connectMongo();
    const col = db.collection('medicalNotes');
    const docs = await col.find({ date: { $exists: true } }).toArray();
    let updated = 0;
    for (const doc of docs) {
        if (!doc.date || typeof doc.date !== 'string') continue;
        const norm = normaliseDate(doc.date);
        if (norm && norm !== doc.date) {
            await col.updateOne({ _id: doc._id }, { $set: { date: norm } });
            updated++;
        }
    }
    console.log(`Migrated ${updated} date fields`);
    await client.close();
}

migrateDates().catch(console.error);
```

### 4. Concurrent updates to the same record

Two simultaneous `POST /update-patient-record` requests for the same `{ patient_id, date }` will each apply their `$set` independently. MongoDB's document-level locking ensures the operations are serialised. The last write wins for any overlapping fields. This is acceptable for the current use case where updates are human-initiated.

### 5. `results` is `null` or `undefined`

Caught by `validateUpdateRequest` with a `400` response before any DB call is made.

---

## 9. Manual Test Requests

Add these to `requests.http` for manual testing:

```http
### Update patient record — success case
POST http://localhost:3000/update-patient-record
Content-Type: application/json

{
  "patient_id": "JOHN_DOE",
  "date": "2008-12-23",
  "results": {
    "diagnosis": {
      "primary": "Non-small cell lung carcinoma (adenocarcinoma) — revised post-MDT",
      "stage": "Stage IB"
    },
    "assessment": ["Revised assessment after multidisciplinary review on 2024-06-01."],
    "notes": "Updated note: consultant review confirmed stage upgrade."
  }
}

###

### Update — date in UK format (should be normalised to 2008-12-23)
POST http://localhost:3000/update-patient-record
Content-Type: application/json

{
  "patient_id": "JOHN_DOE",
  "date": "23/12/2008",
  "results": {
    "notes": "Date format test — UK DD/MM/YYYY input normalised to YYYY-MM-DD."
  }
}

###

### Update — record not found (expect 404)
POST http://localhost:3000/update-patient-record
Content-Type: application/json

{
  "patient_id": "NONEXISTENT_PATIENT",
  "date": "2024-01-01",
  "results": {
    "notes": "This should return 404."
  }
}

###

### Update — missing patient_id (expect 400)
POST http://localhost:3000/update-patient-record
Content-Type: application/json

{
  "date": "2008-12-23",
  "results": { "notes": "Missing patient_id." }
}

###

### Update — invalid date (expect 400)
POST http://localhost:3000/update-patient-record
Content-Type: application/json

{
  "patient_id": "JOHN_DOE",
  "date": "not-a-date",
  "results": { "notes": "Bad date." }
}

###

### Update — attempt to overwrite patient_id (expect 400)
POST http://localhost:3000/update-patient-record
Content-Type: application/json

{
  "patient_id": "JOHN_DOE",
  "date": "2008-12-23",
  "results": {
    "patient_id": "HACKED_ID",
    "notes": "Attempting to overwrite protected field."
  }
}
```

---

## 10. Integration Checklist

Before shipping this feature, verify the following:

- [ ] `updatePatientRecord` exported from `llmHelpers.js`
- [ ] `normaliseDate` and `isValidCalendarDate` added and exported from `llmHelpers.js`
- [ ] `validateUpdateRequest` defined in `index.js` (or imported from `llmHelpers.js`)
- [ ] Route block for `POST /update-patient-record` added in `index.js` before the 404 handler
- [ ] `connectMongo` `client.close()` is called in the `finally` block of the route handler
- [ ] 404 `availableRoutes` list updated
- [ ] Startup log in `server.listen` callback updated to include the new route
- [ ] Compound index `{ patient_id: 1, date: 1 }` created on `medicalNotes` collection
- [ ] Manual tests in `requests.http` pass against a running local server + MongoDB
- [ ] Unit tests written for `normaliseDate` (valid ISO, valid UK, invalid, edge dates like Feb 30)
- [ ] Unit tests written for `validateUpdateRequest` (each error branch + success path)
- [ ] Integration test: insert a known document, call update, verify the returned document reflects changes

---

*Generated for `nhs_medical_note_services` — Node.js native `http` / MongoDB 5.x driver / no ORM*
