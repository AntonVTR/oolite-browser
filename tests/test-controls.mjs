// Gamepad edge detection: one action per press. Run: node tests/test-controls.mjs
// A level-triggered target button hopped the selection every frame while held
// (or while the pad drifted), which the touch debounce could never catch.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { setupGamepad, setupMouse, ctrl } = await import(join(root, 'web/src/controls.js'));

// Stand in for the browser's gamepad API: 16 buttons, none pressed.
const fake = {
  buttons: Array.from({ length: 16 }, () => ({ pressed: false })),
  axes: [0, 0, 0, 0],
};
const setPads = (pads) => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { getGamepads: () => pads }, configurable: true,
  });
};
setPads([fake]);

setupGamepad();
const pad = ctrl.sources.pad;

let r = pad.poll();
assert.equal(r.target, false, 'an idle pad cycles nothing');

fake.buttons[1].pressed = true; // B = next target
r = pad.poll();
assert.equal(r.target, true, 'the press cycles once');
r = pad.poll();
assert.equal(r.target, false, 'a held button does not cycle every frame');
fake.buttons[1].pressed = false;
r = pad.poll();
assert.equal(r.target, false, 'the release cycles nothing');
fake.buttons[1].pressed = true;
r = pad.poll();
assert.equal(r.target, true, 'the next press cycles again');

// a disconnected pad must forget its edges, or reconnecting mid-press
// would fire the action without a new press
setPads([]);
assert.equal(pad.poll(), null, 'no pad → no input');
setPads([fake]);
r = pad.poll();
assert.equal(r.target, false, 'reconnect while held does not fire');

// The wheel is a rate: it fades to zero like the mouse stick. It used to
// latch at whatever the last scroll set, pinning the throttle at 0 or 1
// for the rest of the flight.
const listeners = {};
const canvas = {
  addEventListener: (type, fn) => { listeners[type] = fn; },
  setPointerCapture: () => {},
};
setupMouse(canvas);
listeners.wheel({ deltaY: -100, preventDefault: () => {} });
let w = ctrl.sources.mouse.poll();
assert.ok(w.throttle > 0 && w.throttle < 0.5, 'a scroll up feeds a positive rate');
for (let i = 0; i < 40; i++) w = ctrl.sources.mouse.poll();
assert.equal(w.throttle, 0, 'and it fades back to zero, not latches');
listeners.wheel({ deltaY: 100, preventDefault: () => {} });
w = ctrl.sources.mouse.poll();
assert.ok(w.throttle < 0 && w.throttle > -0.5, 'a scroll down feeds a negative rate');
for (let i = 0; i < 40; i++) w = ctrl.sources.mouse.poll();
assert.equal(w.throttle, 0, 'that fades back too');

console.log('test-controls: ok');
