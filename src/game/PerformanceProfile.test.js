import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePerformanceMode } from './PerformanceProfile.js';

test('normalizes legacy VM/ultra names to ultra-low', () => {
  assert.equal(normalizePerformanceMode('ultra', false), 'ultra-low');
  assert.equal(normalizePerformanceMode('vm', false), 'ultra-low');
});

test('allows ultra-high on desktop mode', () => {
  assert.equal(normalizePerformanceMode('ultra-high', false), 'ultra-high');
  assert.equal(normalizePerformanceMode('high', false), 'ultra-high');
});

test('blocks ultra-high in mobile mode', () => {
  assert.equal(normalizePerformanceMode('ultra-high', true), 'normal');
  assert.equal(normalizePerformanceMode('high', true), 'normal');
});
