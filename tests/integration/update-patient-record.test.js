'use strict';
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');

// Use a dedicated test database — never touches dev data
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
process.env.MONGODB_DB  = 'nhs_test_update_feature';

const { server } = require('../../src/index');

let baseUrl;
let mongoClient;
let testDb;

before(() => new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        try {
            mongoClient = new MongoClient(process.env.MONGODB_URI);
            await mongoClient.connect();
            testDb = mongoClient.db(process.env.MONGODB_DB);
            resolve();
        } catch (err) {
            reject(err);
        }
    });
}));

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (mongoClient) await mongoClient.close();
});

afterEach(async () => {
    // Clean up all test documents — prefix ensures safety
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
        createdAt: '2024-01-15T10:00:00.000Z',
        ...doc,
    });
    return result.insertedId;
}

async function findDoc(patient_id, date) {
    return testDb.collection('medicalNotes').findOne({ patient_id, date });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

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

        it('should set updatedAt on the document after update', async () => {
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
            assert.equal(jun.notes, 'Jun 2009'); // unchanged
        });

        it('should accept UK date format and match the stored YYYY-MM-DD record', async () => {
            await insertDoc({ patient_id: 'TEST_INTEG_001', date: '2008-12-23', notes: 'Original.' });

            const { status } = await postUpdate({
                patient_id: 'TEST_INTEG_001',
                date: '23/12/2008', // UK format — normalised to 2008-12-23
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
