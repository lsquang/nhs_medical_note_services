'use strict';
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { updatePatientRecord } = require('../../llmHelpers');

describe('updatePatientRecord', () => {
  let capturedFilter;
  let capturedUpdate;
  let mockReturnDoc;
  let mockDb;

  beforeEach(() => {
    capturedFilter = null;
    capturedUpdate = null;
    mockReturnDoc = {
      _id: 'doc-id-1',
      patient_id: 'JOHN_DOE',
      date: '2008-12-23',
      notes: 'Revised.',
      updatedAt: new Date().toISOString(),
    };

    mockDb = {
      collection: () => ({
        findOneAndUpdate: async (filter, update, _options) => {
          capturedFilter = filter;
          capturedUpdate = update;
          return mockReturnDoc;
        },
      }),
    };
  });

  // ── Happy paths ───────────────────────────────────────────────────────

  describe('when a matching document exists', () => {
    it('should return status "updated" with the document', async () => {
      const result = await updatePatientRecord(
        mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'Revised.' }
      );
      assert.equal(result.status, 'updated');
      assert.ok(result.document, 'document should be present');
      assert.equal(result.document.patient_id, 'JOHN_DOE');
    });

    it('should set updatedAt in the $set payload', async () => {
      await updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'x' });
      assert.ok(capturedUpdate.$set.updatedAt, 'updatedAt should be set');
      assert.doesNotThrow(() => new Date(capturedUpdate.$set.updatedAt));
    });

    it('should include caller fields in the $set payload', async () => {
      await updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'Revised note' });
      assert.equal(capturedUpdate.$set.notes, 'Revised note');
    });

    it('should query with exact patient_id and date', async () => {
      await updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'x' });
      assert.equal(capturedFilter.patient_id, 'JOHN_DOE');
      assert.equal(capturedFilter.date, '2008-12-23');
    });

    it('should trim whitespace from patient_id in the filter', async () => {
      await updatePatientRecord(mockDb, '  JOHN_DOE  ', '2008-12-23', { notes: 'x' });
      assert.equal(capturedFilter.patient_id, 'JOHN_DOE');
    });
  });

  // ── Not found ─────────────────────────────────────────────────────────

  describe('when no document matches the filter', () => {
    it('should return status "not-found"', async () => {
      mockDb.collection = () => ({
        findOneAndUpdate: async () => null,
      });
      const result = await updatePatientRecord(
        mockDb, 'UNKNOWN_PATIENT', '2099-01-01', { notes: 'x' }
      );
      assert.equal(result.status, 'not-found');
      assert.equal(result.document, undefined);
    });
  });

  // ── Guard clauses ─────────────────────────────────────────────────────

  describe('when db is invalid', () => {
    it('should reject with code INVALID_DB_HANDLE for null', async () => {
      await assert.rejects(
        () => updatePatientRecord(null, 'JOHN_DOE', '2008-12-23', { notes: 'x' }),
        (err) => { assert.equal(err.code, 'INVALID_DB_HANDLE'); return true; }
      );
    });
  });

  describe('when patient_id is invalid', () => {
    it('should reject with code INVALID_PATIENT_ID for empty string', async () => {
      await assert.rejects(
        () => updatePatientRecord(mockDb, '', '2008-12-23', { notes: 'x' }),
        (err) => { assert.equal(err.code, 'INVALID_PATIENT_ID'); return true; }
      );
    });
  });

  describe('when date format is wrong', () => {
    it('should reject with code INVALID_DATE for non-YYYY-MM-DD input', async () => {
      await assert.rejects(
        () => updatePatientRecord(mockDb, 'JOHN_DOE', '23/12/2008', { notes: 'x' }),
        (err) => { assert.equal(err.code, 'INVALID_DATE'); return true; }
      );
    });
  });

  describe('when results is not a plain object', () => {
    it('should reject with code INVALID_RESULTS for an array', async () => {
      await assert.rejects(
        () => updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', ['a', 'b']),
        (err) => { assert.equal(err.code, 'INVALID_RESULTS'); return true; }
      );
    });
  });

  // ── DB error propagation ──────────────────────────────────────────────

  describe('when MongoDB throws during findOneAndUpdate', () => {
    it('should reject with code DB_UPDATE_FAILED', async () => {
      mockDb.collection = () => ({
        findOneAndUpdate: async () => { throw new Error('connection reset'); },
      });
      await assert.rejects(
        () => updatePatientRecord(mockDb, 'JOHN_DOE', '2008-12-23', { notes: 'x' }),
        (err) => { assert.equal(err.code, 'DB_UPDATE_FAILED'); return true; }
      );
    });
  });

});
