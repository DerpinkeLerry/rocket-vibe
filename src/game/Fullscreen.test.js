import test from 'node:test';
import assert from 'node:assert/strict';
import { canRequestFullscreen, isFullscreenActive, requestGameFullscreen } from './Fullscreen.js';

test('start-screen fullscreen helper requests fullscreen on the document element', async () => {
  const previousDocument = globalThis.document;
  const previousScreen = globalThis.screen;
  let requested = 0;
  let locked = 0;
  const documentElement = {
    async requestFullscreen() {
      requested += 1;
      globalThis.document.fullscreenElement = documentElement;
    }
  };
  globalThis.document = {
    documentElement,
    fullscreenElement: null
  };
  globalThis.screen = {
    orientation: {
      async lock(mode) {
        if (mode === 'landscape') locked += 1;
      }
    }
  };

  try {
    assert.equal(canRequestFullscreen(documentElement), true);
    assert.equal(isFullscreenActive(), false);
    assert.equal(await requestGameFullscreen(documentElement), true);
    assert.equal(requested, 1);
    assert.equal(locked, 1);
    assert.equal(isFullscreenActive(), true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousScreen === undefined) delete globalThis.screen;
    else globalThis.screen = previousScreen;
  }
});
