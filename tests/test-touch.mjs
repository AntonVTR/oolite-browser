// Double-tap zoom guard. Run: node tests/test-touch.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { blocksDoubleTap, grabsStick } = await import(join(root, 'web/src/touch.js'));

const control = { closest: () => ({}) };   // stands in for <button>/<a>/<input>
const surface = { closest: () => null };   // canvas, market background
const last = { t: 1000, x: 200, y: 300 };

// fast second tap in the same spot → the zoom must be swallowed
assert.equal(blocksDoubleTap(1150, last, 210, 310, surface), true);
// too slow, or a different part of the screen → leave the tap alone
assert.equal(blocksDoubleTap(1400, last, 210, 310, surface), false);
assert.equal(blocksDoubleTap(1150, last, 400, 300, surface), false);
// a second tap on a control keeps its click (market BUY, TAP TO START)
assert.equal(blocksDoubleTap(1150, last, 210, 310, control), false);

// Floating stick: a touch in the left half of empty space grabs it there.
const touchAt = (x, target = surface) => ({ pointerType: 'touch', clientX: x, clientY: 300, target });
assert.equal(grabsStick(touchAt(100), 800), true, 'left half grabs');
assert.equal(grabsStick(touchAt(700), 800), false, 'right half never grabs');
assert.equal(grabsStick(touchAt(100, control), 800), false, 'a control keeps its tap');
assert.equal(grabsStick({ pointerType: 'mouse', clientX: 100, clientY: 300, target: surface }, 800),
  false, 'mouse keeps steering through the canvas');
assert.equal(grabsStick(touchAt(100), 800, () => true), false, 'a radar tap zooms instead');
assert.equal(grabsStick(touchAt(100), 800, () => false), true, 'off-radar still grabs');

console.log('test-touch: ok');
