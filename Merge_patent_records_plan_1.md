Patient Record Merge and Cleanup — Agent Task Skeleton

Phase 1 — API Contract & Scope Boundary

[x] 1.1 — Define POST /merge-patient-records API contract in index.js
What to do:
Add a new Express route POST /merge-patient-records to index.js. The route must define and validate the request/response shape only — no business logic lives here.
Request body shape:
jsonDownloadCopy code{ "patient_id": "<string, required>", "dryRun": "<boolean, optional, default false>" }
Response shape (success):
jsonDownloadCopy code{
  "status": "merged" | "no-op" | "not-found" | "dry-run",
  "matchedCount": "<number>",
  "mergedDocumentId": "<string | null>",
  "sourceIds": ["<string>"],
  "archivedCount": "<number>",
  "deletedCount": "<number>",
  "warnings": ["<string>"]
}
Constraints:

* Return HTTP 400 if patient_id is missing or not a string.
* Return HTTP 400 if dryRun is present but not a boolean.
* Do not import or reference any in-memory state (e.g., any array or map declared in index.js for other routes).
* The route handler body must only call the merge orchestrator from llmHelpers.js and return its result.

Tests to include:

* POST with no body → 400, message references patient_id.
* POST with patient_id: 123 (non-string) → 400.
* POST with dryRun: "yes" (non-boolean) → 400.
* POST with valid patient_id, no dryRun → passes validation and reaches orchestrator (mock orchestrator to confirm call).
* POST with valid patient_id and dryRun: true → passes validation and reaches orchestrator with dryRun=true.


[x] 1.2 — Enforce scope boundary: merge feature must only use MongoDB paths from llmHelpers.js
What to do:
Audit index.js and confirm no in-memory state (arrays, maps, plain objects used as stores) is accessible to the new route. Document the boundary with a short comment block above the new route in index.js.
Add a lint/guard mechanism — either a code comment convention or a lightweight runtime assertion — that will make it obvious if someone later tries to pass in-memory state into the merge orchestrator.
The merge orchestrator function signature in llmHelpers.js must accept only { patient_id, dryRun } and a MongoDB db handle (or collection references). It must not accept any array or plain-object store as a parameter.
Tests to include:

* Unit test: call the orchestrator with an extra unexpected parameter (e.g., an in-memory array) and verify the function ignores/rejects it or that the TypeScript/JSDoc type annotation flags it.
* Integration smoke test: confirm the route wires db from the MongoDB connection, not a local variable standing in for a store.


Phase 2 — Data Access, Merge Engine & Transactional Write

[x] 2.1 — Add findAllRecordsForPatient(db, patient_id) helper in llmHelpers.js
What to do:
Export a function findAllRecordsForPatient(db, patient_id) that queries the medicalNotes collection and returns all documents where patient_id matches, sorted by createdAt ascending. If createdAt is absent on any document, fall back to _id ascending as the secondary sort (ObjectId sort order approximates insertion order).
Return the raw array of documents. Throw a typed error if the DB call fails.
Tests to include:

* Collection has 0 matching docs → returns empty array.
* Collection has 1 matching doc → returns array of length 1.
* Collection has 3 matching docs with varying createdAt values → returned in ascending createdAt order.
* Collection has docs missing createdAt → returned in ascending _id order.
* Collection has docs for multiple patient IDs → only the requested patient_id docs are returned.


[x] 2.2 — Add mergePatientDocuments(docs) merge engine in llmHelpers.js
What to do:
Export a pure function mergePatientDocuments(docs) that accepts an array of documents (sorted oldest-first) and returns a single merged document. The function must apply the following policies deterministically:
Merge policies (apply in this order):
Scalar and nested fields — newest non-empty wins:
Iterate docs from oldest to newest. For each scalar field, the last (newest) document that has a non-null, non-undefined, non-empty-string value for that field wins. For nested objects, apply the same rule field-by-field within the nested object (shallow merge of nested objects, newest non-empty wins per sub-key).
Arrays — union + dedupe by stable key:
Refer to data-structure.json for which fields are arrays and what the stable dedup key is for each (e.g., medications deduped by medicationName, diagnoses by code). Collect all array items across all docs, dedupe by stable key keeping the newest version of each keyed item, and produce a single merged array.
Notes text — concatenate with source metadata:
The notes field (or equivalent free-text field identified in data-structure.json) must be preserved from all source documents. Concatenate them in chronological order. Prefix each segment with a metadata header, for example:
[Source: <_id>, recorded: <createdAt>]
<original notes text>

Canonical key:
The returned merged document must carry the _id and patient_id of the earliest (first) document in the input array.
Tests to include:

* Two docs, no conflicts → merged doc contains all fields.
* Two docs, same scalar field — newer non-empty value wins over older non-empty value.
* Two docs, newer doc has empty string for a field → older non-empty value is preserved (empty does not win).
* Two docs, newer doc has null for a field → older non-empty value is preserved.
* Three docs, array field with overlapping entries → deduped by stable key, newest version of each keyed item retained.
* Two docs, both have notes text → merged notes contains both segments with metadata headers in chronological order.
* One doc → returned as-is (no mutation).
* Merged doc _id equals the _id of the earliest input doc.
* Merged doc patient_id equals the patient_id of the earliest input doc.


[x] 2.3 — Add mergePatientRecords(db, patient_id, dryRun) transactional orchestrator in llmHelpers.js
What to do:
Export the main orchestrator mergePatientRecords(db, patient_id, dryRun). This function sequences all steps and returns the structured response object. Use a MongoDB session with withTransaction to wrap the write steps so they are atomic.
Step sequence:

1. Call findAllRecordsForPatient to get docs.
2. Apply safeguards (see task 2.4 below) — if a safeguard fires, return early without writes.
3. Call mergePatientDocuments(docs) to produce mergedDoc.
4. Identify canonicalDoc = docs[0] (earliest), sourceDocs = docs.slice(1) (non-canonical).
5. If dryRun === true: return preview response with status: "dry-run", mergedDoc, sourceIds, no DB writes.
6. Within a transaction:
a. Replace the canonical document in medicalNotes by _id with mergedDoc.
b. Insert all sourceDocs into archivedNotes collection as-is (preserve original documents verbatim).
c. Delete all sourceDocs from medicalNotes by _id.
d. Insert one audit document into mergeLogs collection (see task 2.5 for schema).
7. Return structured response with status: "merged", counts, and mergedDocumentId.

Tests to include:

* dryRun=true with 3 docs → no documents written to any collection, response has status: "dry-run" and mergedDoc preview.
* Live run with 3 docs → medicalNotes contains exactly 1 doc for patient_id after the call.
* Live run with 3 docs → archivedNotes contains exactly 2 docs for patient_id.
* Live run with 3 docs → deleted docs no longer exist in medicalNotes.
* Live run → mergedDocumentId in response matches the _id of the earliest original doc.
* Live run → mergeLogs contains exactly 1 new entry for the operation.
* Simulate a transaction failure mid-write (mock) → no partial state left in any collection.


[x] 2.4 — Add safeguards: zero matches, one match, mixed patient_id guard
What to do:
Inside mergePatientRecords, before any write logic, add three safeguard checks:
Zero matches:
If docs.length === 0, return immediately:
jsonDownloadCopy code{ "status": "not-found", "matchedCount": 0, "mergedDocumentId": null, "sourceIds": [], "archivedCount": 0, "deletedCount": 0, "warnings": [] }
One match:
If docs.length === 1, return immediately (idempotent no-op):
jsonDownloadCopy code{ "status": "no-op", "matchedCount": 1, "mergedDocumentId": "<the single doc _id>", "sourceIds": ["<the single doc _id>"], "archivedCount": 0, "deletedCount": 0, "warnings": [] }
Mixed patient_id guard:
After fetching docs, verify every doc in the array has the same patient_id value as the requested patient_id. If any mismatch is found (which would indicate a DB query bug), throw an internal error and do not proceed. Add a warning entry to the warnings array describing which _id had a mismatched value.
Tests to include:

* patient_id with no matching docs → status: "not-found", no DB writes.
* patient_id with exactly 1 matching doc → status: "no-op", no DB writes, mergedDocumentId = that doc's _id.
* Inject a mocked findAllRecordsForPatient that returns docs with mixed patient_id values → orchestrator throws before any write.
* Idempotency: run live merge, then run again on same patient_id → second call returns status: "no-op".


[x] 2.5 — Define and insert audit log entry into mergeLogs
What to do:
As the final step in the transaction (step 6d in task 2.3), insert one document into the mergeLogs collection with the following schema:
jsonDownloadCopy code{
  "patient_id": "<string>",
  "canonicalId": "<ObjectId — _id of the record that was replaced/kept>",
  "sourceIds": ["<ObjectId>", "..."],
  "archivedCount": "<number>",
  "deletedCount": "<number>",
  "mergedAt": "<ISODate timestamp>",
  "dryRun": false
}
For dry-run calls, do not insert into mergeLogs.
Tests to include:

* Live merge → mergeLogs has 1 entry with correct patient_id, canonicalId, sourceIds array, archivedCount, deletedCount, and a valid mergedAt timestamp.
* Dry-run merge → mergeLogs has 0 new entries.
* sourceIds in the log entry matches the _id values of non-canonical docs (not the canonical).
* canonicalId equals docs[0]._id.


Phase 3 — Endpoint Wiring, Dry-Run & Operational Logging

[x] 3.1 — Wire POST /merge-patient-records endpoint in index.js
What to do:
Complete the route handler stubbed in task 1.1. After input validation passes, call mergePatientRecords(db, patient_id, dryRun) from llmHelpers.js. Map the returned result object directly to the HTTP response body. Use appropriate HTTP status codes:

* 200 for status: "merged", "no-op", "dry-run".
* 404 for status: "not-found".
* 500 for unexpected errors (wrap in try/catch, log the error, return { error: "internal error" }).

Tests to include:

* End-to-end: POST with a patient_id that exists in MongoDB with 3 docs → 200 with status: "merged".
* End-to-end: POST with a patient_id that has no docs → 404.
* End-to-end: POST with dryRun: true → 200 with status: "dry-run", no DB mutations.
* End-to-end: POST with patient_id that has 1 doc → 200 with status: "no-op".
* Simulate orchestrator throwing → route returns 500 with { error: "internal error" }.


[x] 3.2 — Add dry-run preview mode (no writes path)
What to do:
Confirm the dry-run path is correctly isolated in mergePatientRecords. The dry-run response must include:
jsonDownloadCopy code{
  "status": "dry-run",
  "matchedCount": "<number>",
  "mergedDocumentId": null,
  "sourceIds": ["<string>"],
  "mergedPreview": { "<full merged document object>" },
  "archivedCount": 0,
  "deletedCount": 0,
  "warnings": []
}
No transaction is opened. No collection is touched. mergeLogs receives no entry.
Tests to include:

* Dry-run with 3 docs → mergedPreview matches what a live run's canonical doc would look like.
* Dry-run → medicalNotes count before and after the call is identical.
* Dry-run → archivedNotes count before and after is identical.
* Dry-run → mergeLogs count before and after is identical.
* Dry-run response includes sourceIds for all matched docs.


[x] 3.3 — Add operational logging for merge lifecycle and counts
What to do:
Add structured console.log (or your existing logger) statements at the following points inside mergePatientRecords:

* On entry: log patient_id, dryRun flag.
* After fetch: log matchedCount.
* After safeguard short-circuit: log which safeguard triggered.
* After merge engine: log field count of merged doc.
* After each write step (replace, archive insert, delete, log insert): log step name and affected count.
* On completion: log final status and counts.
* On error: log error message and patient_id.

Log format must be consistent and machine-parseable (JSON lines preferred if your logger supports it).
Tests to include:

* Spy on the logger: confirm entry log fires with correct patient_id and dryRun.
* Spy on the logger: confirm "not-found" safeguard log fires for zero-match case.
* Spy on the logger: confirm completion log fires with correct status: "merged" and counts after a live run.
* Confirm no sensitive patient data fields (e.g., raw field values from the document) appear in log output.


Phase 4 — HTTP Request Scenarios & Regression Checks

[x] 4.1 — Add merge endpoint manual verification requests to requests.http
Completed:
Added labelled request blocks in requests.http for:

* Missing patient_id validation (expect 400)
* Invalid dryRun type validation (expect 400)
* Dry-run preview scenario
* Live merge scenario
* One-match scenario (seed-dependent)
* Zero-match scenario (expect 404)
* Rollback simulation note

Live checks executed:

* Missing patient_id returned 400
* Invalid dryRun type returned 400
* Zero-match returned 404 with not-found payload

[x] 4.2 — Run regression checks on existing routes
Completed:
Executed regression smoke checks against running server for legacy routes after merge feature integration.

Observed status codes:

* POST /add-note → 201
* GET /get-data → 200
* POST /write-data → 200
* POST /query → 200
* GET /list-models → 500 (expected when GEMINI_API_KEY is not set; environment/config issue, not merge regression)

Conclusion:

* No behavioral regression observed in existing core routes.