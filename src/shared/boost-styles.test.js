import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOST_STYLES, DEFAULT_BOOST_STYLE, getBoostStyle, normalizeBoostStyle } from './boost-styles.js';

test('boost cosmetics expose four selectable styles with a safe fallback', () => {
  assert.equal(BOOST_STYLES.length, 4);
  assert.equal(normalizeBoostStyle(' ION '), 'ion');
  assert.equal(normalizeBoostStyle('unknown'), DEFAULT_BOOST_STYLE);
  assert.equal(getBoostStyle('plasma').name, 'PLASMA');
});
