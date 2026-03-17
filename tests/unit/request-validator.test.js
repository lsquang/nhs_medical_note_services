'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateUpdateRequest } = require('../../llmHelpers');

const BASE_VALID = {
  patient_id: 'JOHN_DOE',
  date: '2008-12-23',
  results: { notes: 'A note.' },
};

describe('validateUpdateRequest', () => {

  // ── Happy paths ───────────────────────────────────────────────────────

  describe('when given a fully valid payload', () => {
    it('should return the normalised fields', () => {
      const result = validateUpdateRequest(BASE_VALID);
      assert.equal(result.patient_id, 'JOHN_DOE');
      assert.equal(result.date, '2008-12-23');
      assert.deepEqual(result.results, { notes: 'A note.' });
    });

    it('should trim patient_id whitespace', () => {
      const result = validateUpdateRequest({ ...BASE_VALID, patient_id: '  JOHN_DOE  ' });
      assert.equal(result.patient_id, 'JOHN_DOE');
    });

    it('should normalise a UK date format to YYYY-MM-DD', () => {
      const result = validateUpdateRequest({ ...BASE_VALID, date: '23/12/2008' });
      assert.equal(result.date, '2008-12-23');
    });
  });

  // ── patient_id validation ────────────────────────────────────────────

  describe('when patient_id is invalid', () => {
    it('should throw 400 when patient_id is missing', () => {
      const { patient_id, ...rest } = BASE_VALID;
      assert.throws(() => validateUpdateRequest(rest), (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /patient_id/);
        return true;
      });
    });

    it('should throw 400 when patient_id is an empty string', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, patient_id: '' }),
        (err) => err.statusCode === 400
      );
    });

    it('should throw 400 when patient_id is whitespace only', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, patient_id: '   ' }),
        (err) => err.statusCode === 400
      );
    });
  });

  // ── date validation ──────────────────────────────────────────────────

  describe('when date is invalid', () => {
    it('should throw 400 when date is missing', () => {
      const { date, ...rest } = BASE_VALID;
      assert.throws(() => validateUpdateRequest(rest), (err) => {
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /date/);
        return true;
      });
    });

    it('should throw 400 when date is not a valid calendar date', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, date: 'not-a-date' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.match(err.message, /not a valid calendar date/);
          return true;
        }
      );
    });
  });

  // ── results validation ───────────────────────────────────────────────

  describe('when results is invalid', () => {
    it('should throw 400 when results is missing', () => {
      const { results, ...rest } = BASE_VALID;
      assert.throws(() => validateUpdateRequest(rest), (err) => err.statusCode === 400);
    });

    it('should throw 400 when results is null', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, results: null }),
        (err) => err.statusCode === 400
      );
    });

    it('should throw 400 when results is an array', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, results: ['a', 'b'] }),
        (err) => err.statusCode === 400
      );
    });

    it('should throw 400 when results is an empty object', () => {
      assert.throws(
        () => validateUpdateRequest({ ...BASE_VALID, results: {} }),
        (err) => err.statusCode === 400
      );
    });
  });

  // ── protected field guard ────────────────────────────────────────────

  describe('when results contains a protected system field', () => {
    for (const field of ['_id', 'patient_id', 'date', 'createdAt']) {
      it(`should throw 400 and name the protected field "${field}"`, () => {
        assert.throws(
          () => validateUpdateRequest({ ...BASE_VALID, results: { [field]: 'injected', notes: 'x' } }),
          (err) => {
            assert.equal(err.statusCode, 400);
            assert.match(err.message, new RegExp(`protected field "${field}"`));
            return true;
          }
        );
      });
    }
  });

});
