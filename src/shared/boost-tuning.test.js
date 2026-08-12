import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_BOOST_PADS_MASK,
  BOOST_PADS,
  BOOST_TUNING,
  isBoostPadActive,
  withBoostPadActive
} from './boost-tuning.js';

test('reference boost layout contains six full and twenty-eight small pads', () => {
  assert.equal(BOOST_PADS.length, 34);
  assert.equal(BOOST_PADS.filter((pad) => pad.kind === 'large').length, 6);
  assert.equal(BOOST_PADS.filter((pad) => pad.kind === 'small').length, 28);
  assert.equal(BOOST_TUNING.smallAmount, 12);
  assert.equal(BOOST_PADS.find((pad) => pad.id === 2)?.x, -49);
  assert.equal(BOOST_PADS.find((pad) => pad.id === 3)?.x, 49);
});

test('boost mask helpers preserve pads above the JavaScript 32-bit bitwise range', () => {
  assert.equal(ALL_BOOST_PADS_MASK, 2 ** 34 - 1);
  assert.equal(isBoostPadActive(ALL_BOOST_PADS_MASK, 33), true);
  const withoutLast = withBoostPadActive(ALL_BOOST_PADS_MASK, 33, false);
  assert.equal(isBoostPadActive(withoutLast, 33), false);
  assert.equal(isBoostPadActive(withoutLast, 32), true);
  assert.equal(withBoostPadActive(withoutLast, 33, true), ALL_BOOST_PADS_MASK);
});
