import test from 'node:test';
import assert from 'node:assert/strict';
import { getPerformanceProfile, normalizePerformanceMode } from './PerformanceProfile.js';

test('normalizes legacy VM/ultra names to ultra-low', () => {
  assert.equal(normalizePerformanceMode('ultra', false), 'ultra-low');
  assert.equal(normalizePerformanceMode('vm', false), 'ultra-low');
});

test('allows ultra-high on desktop mode', () => {
  assert.equal(normalizePerformanceMode('ultra-high', false), 'ultra-high');
  assert.equal(normalizePerformanceMode('high', false), 'ultra-high');
});

test('allows ultra-high in mobile mode', () => {
  assert.equal(normalizePerformanceMode('ultra-high', true), 'ultra-high');
  assert.equal(normalizePerformanceMode('high', true), 'ultra-high');
});

test('desktop ultra-high uses a restrained supersampling range', () => {
  const profile = getPerformanceProfile(false, 'ultra-high');
  assert.equal(profile.initialPixelRatio, 1.28);
  assert.equal(profile.minPixelRatio, 0.95);
  assert.equal(profile.maxPixelRatio, 1.5);
});
