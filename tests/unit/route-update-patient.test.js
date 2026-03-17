'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Start the real HTTP server on an ephemeral port.
// Validation errors (400s) fire before connectMongo is called, so no DB needed.
const { server } = require('../../src/index');

let baseUrl;

before(() => new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
    });
}));

after(() => new Promise((resolve) => {
    server.close(resolve);
}));

async function post(path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
}

describe('POST /update-patient-record — route validation', () => {

    describe('when patient_id is missing', () => {
        it('should respond 400 with a patient_id error message', async () => {
            const { status, body } = await post('/update-patient-record', {
                date: '2008-12-23',
                results: { notes: 'x' },
            });
            assert.equal(status, 400);
            assert.equal(body.success, false);
            assert.match(body.message, /patient_id/);
        });
    });

    describe('when patient_id is empty', () => {
        it('should respond 400', async () => {
            const { status, body } = await post('/update-patient-record', {
                patient_id: '',
                date: '2008-12-23',
                results: { notes: 'x' },
            });
            assert.equal(status, 400);
            assert.equal(body.success, false);
        });
    });

    describe('when date is invalid', () => {
        it('should respond 400 with a date error message', async () => {
            const { status, body } = await post('/update-patient-record', {
                patient_id: 'JOHN_DOE',
                date: 'bad-date',
                results: { notes: 'x' },
            });
            assert.equal(status, 400);
            assert.match(body.message, /not a valid calendar date/);
        });
    });

    describe('when results is an empty object', () => {
        it('should respond 400', async () => {
            const { status, body } = await post('/update-patient-record', {
                patient_id: 'JOHN_DOE',
                date: '2008-12-23',
                results: {},
            });
            assert.equal(status, 400);
            assert.equal(body.success, false);
        });
    });

    describe('when results contains a protected field "_id"', () => {
        it('should respond 400 naming the protected field', async () => {
            const { status, body } = await post('/update-patient-record', {
                patient_id: 'JOHN_DOE',
                date: '2008-12-23',
                results: { _id: 'injected' },
            });
            assert.equal(status, 400);
            assert.match(body.message, /protected field "_id"/);
        });
    });

    describe('when results contains protected field "patient_id"', () => {
        it('should respond 400 naming the protected field', async () => {
            const { status, body } = await post('/update-patient-record', {
                patient_id: 'JOHN_DOE',
                date: '2008-12-23',
                results: { patient_id: 'NEW_ID' },
            });
            assert.equal(status, 400);
            assert.match(body.message, /protected field "patient_id"/);
        });
    });

    describe('when the route is hit with non-POST method', () => {
        it('should respond 404', async () => {
            const res = await fetch(`${baseUrl}/update-patient-record`, { method: 'GET' });
            assert.equal(res.status, 404);
        });
    });

    describe('when body is not valid JSON', () => {
        it('should respond 400 with invalid JSON message', async () => {
            const res = await fetch(`${baseUrl}/update-patient-record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: 'not json at all',
            });
            const body = await res.json();
            assert.equal(res.status, 400);
            assert.equal(body.success, false);
        });
    });

});
