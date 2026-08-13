import assert from 'node:assert/strict';
import test from 'node:test';
import { CAR_STYLES, getCarStyle, normalizeCarStyle, shouldUsePremiumCarModel } from './car-styles.js';

const expectedPremium = {
  vortex: ['OCTANE', 'octane'],
  titan: ['MCLAREN 570S', 'mclaren'],
  apex: ['DOMINUS', 'dominus'],
  razor: ['FENNEC', 'fennec']
};

test('all four compatibility ids expose the named premium cars', () => {
  assert.equal(CAR_STYLES.length, 4);
  for (const [id, [name, premiumModel]] of Object.entries(expectedPremium)) {
    assert.equal(normalizeCarStyle(id), id);
    assert.equal(getCarStyle(id).name, name);
    assert.equal(getCarStyle(id).premiumModel, premiumModel);
  }
});

test('all real car models are gated to ultra high only', () => {
  for (const id of Object.keys(expectedPremium)) {
    assert.equal(shouldUsePremiumCarModel(id, false), false);
    assert.equal(shouldUsePremiumCarModel(id, true), true);
  }
  assert.equal(normalizeCarStyle('not-a-car'), 'vortex');
});
