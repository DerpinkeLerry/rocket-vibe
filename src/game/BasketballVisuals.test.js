import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ballSource = await readFile(new URL('./Ball.js', import.meta.url), 'utf8');
const gameSource = await readFile(new URL('./Game.js', import.meta.url), 'utf8');
const chatSource = await readFile(new URL('./ChatPanel.js', import.meta.url), 'utf8');

test('basketball ball uses procedural leather texture and disables the soccar premium model', () => {
  assert.match(ballSource, /createBasketballTextures\s*\(/);
  assert.match(ballSource, /ProceduralBasketballVisual/);
  assert.match(ballSource, /this\.ultraHigh && !this\.basketballMode/);
});

test('game passes basketball mode into arena and ball', () => {
  assert.match(gameSource, /gameMode: this\.gameMode/);
  assert.match(gameSource, /matchConfig\?\.gameMode === 'basketball'/);
});

test('chat panel exposes all quick chats plus text entry', () => {
  assert.match(chatSource, /QUICK CHAT/);
  assert.match(chatSource, /TEXT CHAT/);
  assert.match(chatSource, /maxlength=\"\$\{CHAT_MAX_CHARS\}\"/);
  assert.match(chatSource, /onQuickChat/);
  assert.match(chatSource, /onTextChat/);
});
