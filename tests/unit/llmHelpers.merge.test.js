const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findAllRecordsForPatient,
  mergePatientDocuments,
  mergePatientRecords,
} = require('../../src/llmHelpers');

function createFakeSession(failAtStep) {
  return {
    async withTransaction(fn) {
      await fn();
      if (failAtStep === 'after') {
        throw new Error('forced transaction failure');
      }
    },
    async endSession() {},
  };
}

function createFakeDb(docs, options = {}) {
  const state = {
    medicalNotes: docs.map((d) => ({ ...d })),
    archivedNotes: [],
    mergeLogs: [],
  };

  const behavior = {
    failAtReplace: options.failAtReplace || false,
  };

  const collection = (name) => ({
    find(query) {
      return {
        async toArray() {
          if (name !== 'medicalNotes') return [];
          return state.medicalNotes.filter((d) => d.patient_id === query.patient_id).map((d) => ({ ...d }));
        },
      };
    },
    async replaceOne(filter, doc) {
      if (behavior.failAtReplace) throw new Error('replace failed');
      const idx = state.medicalNotes.findIndex((d) => String(d._id) === String(filter._id));
      if (idx === -1) return { matchedCount: 0, modifiedCount: 0 };
      state.medicalNotes[idx] = { ...doc };
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async insertMany(inputDocs) {
      if (name !== 'archivedNotes') return { insertedCount: 0 };
      state.archivedNotes.push(...inputDocs.map((d) => ({ ...d })));
      return { insertedCount: inputDocs.length };
    },
    async deleteMany(filter) {
      if (name !== 'medicalNotes') return { deletedCount: 0 };
      const idSet = new Set((filter._id && filter._id.$in || []).map((id) => String(id)));
      const before = state.medicalNotes.length;
      state.medicalNotes = state.medicalNotes.filter((d) => !idSet.has(String(d._id)));
      return { deletedCount: before - state.medicalNotes.length };
    },
    async insertOne(doc) {
      if (name !== 'mergeLogs') return { insertedId: null };
      const withId = { ...doc, _id: `log-${state.mergeLogs.length + 1}` };
      state.mergeLogs.push(withId);
      return { insertedId: withId._id };
    },
  });

  return {
    db: {
      client: {
        startSession() {
          return createFakeSession(options.failAtStep);
        },
      },
      collection,
    },
    state,
  };
}

function doc(id, patient, createdAt, patch = {}) {
  return {
    _id: id,
    patient_id: patient,
    createdAt,
    diagnosis: { stage: 'I' },
    procedures: [],
    notes: `note-${id}`,
    ...patch,
  };
}

test('findAllRecordsForPatient returns sorted docs by createdAt then _id fallback', async () => {
  const { db } = createFakeDb([
    doc('3', 'p1', '2026-01-03T00:00:00.000Z'),
    doc('1', 'p1', '2026-01-01T00:00:00.000Z'),
    doc('2', 'p1', '2026-01-02T00:00:00.000Z'),
    doc('4', 'p2', '2026-01-02T00:00:00.000Z'),
  ]);

  const result = await findAllRecordsForPatient(db, 'p1');
  assert.deepEqual(result.map((d) => d._id), ['1', '2', '3']);
});

test('mergePatientDocuments applies newest non-empty rules and notes concatenation', () => {
  const input = [
    doc('1', 'p1', '2026-01-01T00:00:00.000Z', {
      diagnosis: { stage: 'I', code: 'A' },
      procedures: [{ id: 'proc-1', procedure: 'xray' }],
      test: 'CT',
      emptyField: 'old',
    }),
    doc('2', 'p1', '2026-01-02T00:00:00.000Z', {
      diagnosis: { stage: 'II' },
      procedures: [{ id: 'proc-1', procedure: 'xray-new' }, { id: 'proc-2', procedure: 'biopsy' }],
      test: '',
      emptyField: null,
    }),
  ];

  const merged = mergePatientDocuments(input);
  assert.equal(merged._id, '1');
  assert.equal(merged.patient_id, 'p1');
  assert.equal(merged.diagnosis.stage, 'II');
  assert.equal(merged.diagnosis.code, 'A');
  assert.equal(merged.test, 'CT');
  assert.equal(merged.procedures.length, 2);
  assert.match(merged.notes, /Source: 1/);
  assert.match(merged.notes, /Source: 2/);
});

test('mergePatientRecords returns not-found for zero matches', async () => {
  const { db } = createFakeDb([]);
  const result = await mergePatientRecords({ patient_id: 'p-x', dryRun: false }, db);

  assert.equal(result.status, 'not-found');
  assert.equal(result.matchedCount, 0);
  assert.equal(result.deletedCount, 0);
});

test('mergePatientRecords returns no-op for one match', async () => {
  const { db } = createFakeDb([doc('1', 'p1', '2026-01-01T00:00:00.000Z')]);
  const result = await mergePatientRecords({ patient_id: 'p1', dryRun: false }, db);

  assert.equal(result.status, 'no-op');
  assert.equal(result.matchedCount, 1);
  assert.equal(result.mergedDocumentId, '1');
});

test('mergePatientRecords dry-run returns preview without writes', async () => {
  const { db, state } = createFakeDb([
    doc('1', 'p1', '2026-01-01T00:00:00.000Z'),
    doc('2', 'p1', '2026-01-02T00:00:00.000Z', { diagnosis: { stage: 'III' } }),
  ]);
  const before = JSON.stringify(state);

  const result = await mergePatientRecords({ patient_id: 'p1', dryRun: true }, db);

  assert.equal(result.status, 'dry-run');
  assert.ok(result.mergedPreview);
  assert.equal(JSON.stringify(state), before);
});

test('mergePatientRecords live run archives and deletes non-canonical docs', async () => {
  const { db, state } = createFakeDb([
    doc('1', 'p1', '2026-01-01T00:00:00.000Z'),
    doc('2', 'p1', '2026-01-02T00:00:00.000Z'),
    doc('3', 'p1', '2026-01-03T00:00:00.000Z'),
  ]);

  const result = await mergePatientRecords({ patient_id: 'p1', dryRun: false }, db);

  assert.equal(result.status, 'merged');
  assert.equal(result.mergedDocumentId, '1');
  assert.equal(result.archivedCount, 2);
  assert.equal(result.deletedCount, 2);
  assert.equal(state.medicalNotes.filter((d) => d.patient_id === 'p1').length, 1);
  assert.equal(state.archivedNotes.filter((d) => d.patient_id === 'p1').length, 2);
  assert.equal(state.mergeLogs.length, 1);
});

test('mergePatientRecords removes duplicate records for patient_id JOHN_DOE', async () => {
  const { db, state } = createFakeDb([
    doc('10', 'JOHN_DOE', '2026-01-01T00:00:00.000Z', {
      procedures: [{ id: 'proc-1', procedure: 'xray' }],
      diagnosis: { stage: 'I', code: 'A' },
      notes: 'first note',
    }),
    doc('11', 'JOHN_DOE', '2026-01-02T00:00:00.000Z', {
      procedures: [{ id: 'proc-1', procedure: 'xray-updated' }, { id: 'proc-2', procedure: 'ct' }],
      diagnosis: { stage: 'II' },
      notes: 'second note',
    }),
  ]);

  const result = await mergePatientRecords({ patient_id: 'JOHN_DOE', dryRun: false }, db);

  assert.equal(result.status, 'merged');
  assert.equal(result.matchedCount, 2);
  assert.equal(result.mergedDocumentId, '10');
  assert.equal(result.archivedCount, 1);
  assert.equal(result.deletedCount, 1);

  const activeDocs = state.medicalNotes.filter((d) => d.patient_id === 'JOHN_DOE');
  assert.equal(activeDocs.length, 1);
  assert.equal(state.archivedNotes.filter((d) => d.patient_id === 'JOHN_DOE').length, 1);

  const merged = activeDocs[0];
  assert.equal(merged._id, '10');
  assert.equal(merged.diagnosis.stage, 'II');
  assert.equal(merged.procedures.length, 2);
});

test('mergePatientRecords throws on mixed patient ids from fetch helper path', async () => {
  const { db } = createFakeDb([
    doc('1', 'p1', '2026-01-01T00:00:00.000Z'),
    doc('2', 'p2', '2026-01-02T00:00:00.000Z'),
  ]);

  await assert.rejects(
    () => mergePatientRecords({ patient_id: 'p1', dryRun: false }, {
      ...db,
      collection(name) {
        if (name !== 'medicalNotes') return db.collection(name);
        return {
          find() {
            return {
              async toArray() {
                return [
                  doc('1', 'p1', '2026-01-01T00:00:00.000Z'),
                  doc('2', 'p2', '2026-01-02T00:00:00.000Z'),
                ];
              }
            };
          }
        };
      }
    }),
    /Mismatched patient_id/
  );
});

test('mergePatientRecords surfaces transaction failure', async () => {
  const { db } = createFakeDb([
    doc('1', 'p1', '2026-01-01T00:00:00.000Z'),
    doc('2', 'p1', '2026-01-02T00:00:00.000Z'),
  ], { failAtReplace: true });

  await assert.rejects(
    () => mergePatientRecords({ patient_id: 'p1', dryRun: false }, db),
    /replace failed/
  );
});
