import assert from 'node:assert/strict';
import test from 'node:test';
import { getCarStyle, normalizeCarStyle, shouldUsePremiumCarModel } from './car-styles.js';

test('razor compatibility id is presented as FENNEC', () => {
  assert.equal(normalizeCarStyle('razor'), 'razor');
  assert.equal(getCarStyle('razor').name, 'FENNEC');
  assert.equal(getCarStyle('razor').premiumModel, 'fennec');
});

test('premium FENNEC model is gated to ultra high only', () => {
  assert.equal(shouldUsePremiumCarModel('razor', false), false);
  assert.equal(shouldUsePremiumCarModel('razor', true), true);
  assert.equal(shouldUsePremiumCarModel('vortex', true), false);
});
