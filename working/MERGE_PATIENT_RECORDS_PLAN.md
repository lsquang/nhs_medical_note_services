## Plan: Patient Record Merge and Cleanup

Build a new MongoDB-first flow that finds all records by patient_id, merges all fields deterministically, replaces the earliest record as canonical, archives and deletes old records, and logs the operation for traceability.

**Steps**
1. Phase 1 - Define API contract for POST /merge-patient-records in [index.js](index.js): required patient_id, optional dryRun, structured response with matchedCount, mergedDocumentId, sourceIds, archivedCount, deletedCount, warnings.
2. Phase 1 - Enforce scope boundary: new feature must only use MongoDB paths in [llmHelpers.js](llmHelpers.js), not in-memory state from [index.js](index.js).
3. Phase 2 - Add data access helpers in [llmHelpers.js](llmHelpers.js): find all records for patient_id, sorted by createdAt ascending (fallback _id ascending).
4. Phase 2 - Add merge engine in [llmHelpers.js](llmHelpers.js): fold N documents into one canonical document with deterministic rules.
5. Phase 2 - Apply selected policies:
- canonical key: patient_id
- target record: replace earliest source record
- conflict policy: newest non-empty wins for scalars and nested fields
- arrays: union + dedupe by stable key
- notes text: preserve and concatenate with source metadata
6. Phase 2 - Add transactional write sequence in [llmHelpers.js](llmHelpers.js):
- read matched docs
- build merged document
- replace canonical source document
- archive non-canonical sources into archivedNotes
- delete archived sources from medicalNotes
- insert audit event into mergeLogs
7. Phase 2 - Add safeguards: zero matches (not found response), one match (no-op response), mismatch guard if fetched docs contain mixed patient_id values.
8. Phase 3 - Wire endpoint in [index.js](index.js): validate input, call merge orchestrator, return structured result.
9. Phase 3 - Add dry-run preview mode: return merged output and sourceIds without DB writes/deletes.
10. Phase 3 - Add operational logging for merge lifecycle and counts.
11. Phase 4 - Add manual verification requests to [requests.http](requests.http): 0/1/many matches, dry-run, success path, rollback simulation.
12. Phase 4 - Run regression checks for existing routes in [requests.http](requests.http): ensure add/query behavior remains stable.

**Relevant files**
- [index.js](index.js) - new endpoint and request validation.
- [llmHelpers.js](llmHelpers.js) - merge helpers, orchestrator, transaction, archive/delete/log path.
- [requests.http](requests.http) - merge endpoint test scenarios.
- [data-structure.json](data-structure.json) - field map reference for nested/array merge behavior.

**Verification**
1. Seed MongoDB with 3+ documents sharing same patient_id and overlapping fields.
2. Execute dryRun=true and verify no writes, merged preview returned.
3. Execute live merge and verify exactly one canonical document remains in medicalNotes.
4. Verify non-canonical originals exist in archivedNotes and are removed from medicalNotes.
5. Verify canonical document id equals earliest source id.
6. Verify mergeLogs entry contains sourceIds, canonicalId, archiveCount, deleteCount, timestamp.
7. Re-run merge for same patient_id and verify idempotent no-op when only one record remains.
8. Re-run existing add/query requests to confirm no regressions.

**Decisions captured**
- Canonical patient field: patient_id.
- Old-data strategy: archive then delete.
- Merge target: replace earliest record and keep its _id.
