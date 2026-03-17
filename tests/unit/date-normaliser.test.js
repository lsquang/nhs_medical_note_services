'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseDate } = require('../../src/llmHelpers');

describe('normaliseDate', () => {

  // ── Happy paths ──────────────────────────────────────────────────────────

  describe('when given a valid YYYY-MM-DD string', () => {
    it('should return the date unchanged', () => {
      assert.equal(normaliseDate('2008-12-23'), '2008-12-23');
    });
  });

  describe('when given an ISO 8601 string with a time component', () => {
    it('should strip the time and return YYYY-MM-DD', () => {
      assert.equal(normaliseDate('2008-12-23T14:30:00'), '2008-12-23');
    });

    it('should handle UTC Z suffix', () => {
      assert.equal(normaliseDate('2008-12-23T00:00:00Z'), '2008-12-23');
    });
  });

  describe('when given a UK DD/MM/YYYY string', () => {
    it('should reformat to YYYY-MM-DD', () => {
      assert.equal(normaliseDate('23/12/2008'), '2008-12-23');
    });
  });

  describe('when given a natural language date string', () => {
    it('should parse and return YYYY-MM-DD', () => {
      assert.equal(normaliseDate('Dec 23 2008'), '2008-12-23');
    });
  });

  // ── Leap year handling ───────────────────────────────────────────────────

  describe('when given a valid leap-year date', () => {
    it('should accept 2000-02-29 (divisible by 400)', () => {
      assert.equal(normaliseDate('2000-02-29'), '2000-02-29');
    });

    it('should accept 2004-02-29 (divisible by 4)', () => {
      assert.equal(normaliseDate('2004-02-29'), '2004-02-29');
    });
  });

  describe('when given an invalid leap-year date', () => {
    it('should return null for 1900-02-29 (1900 is not a leap year)', () => {
      assert.equal(normaliseDate('1900-02-29'), null);
    });
  });

  // ── Invalid calendar dates ───────────────────────────────────────────────

  describe('when given an impossible calendar date', () => {
    it('should return null for Feb 30', () => {
      assert.equal(normaliseDate('2008-02-30'), null);
    });

    it('should return null for month 13', () => {
      assert.equal(normaliseDate('2008-13-01'), null);
    });
  });

  // ── Null / empty / garbage input ─────────────────────────────────────────

  describe('when given null or empty input', () => {
    it('should return null for null', () => {
      assert.equal(normaliseDate(null), null);
    });

    it('should return null for undefined', () => {
      assert.equal(normaliseDate(undefined), null);
    });

    it('should return null for empty string', () => {
      assert.equal(normaliseDate(''), null);
    });

    it('should return null for a non-date string', () => {
      assert.equal(normaliseDate('not-a-date'), null);
    });

    it('should never throw — returns null instead', () => {
      assert.doesNotThrow(() => normaliseDate('complete garbage!@#$'));
    });
  });

});
