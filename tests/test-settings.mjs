// Device settings (CONTROLS page): round trip through localStorage-shaped
// storage, corrupt blobs falling back to defaults, and the per-action pad
// validation that keeps one bad binding from wiping the rest.

import assert from 'node:assert/strict';
import {
  defaultSettings, parseSettings, loadSettings, saveSettings,
  SETTINGS_KEY, SETTINGS_VERSION,
} from '../web/src/settings.js';
import { DEFAULT_PAD } from '../web/src/controls.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

// ---- defaults ---------------------------------------------------------------
const d = defaultSettings();
assert.equal(d.v, SETTINGS_VERSION);
assert.equal(d.size, 'm');
assert.equal(d.hand, 'right');
assert.deepEqual(d.pad, DEFAULT_PAD, 'default pad bindings');

// ---- round trip -------------------------------------------------------------
const s = fakeStorage();
const custom = defaultSettings();
custom.size = 'l';
custom.hand = 'left';
custom.pad.fire = [1];
assert.equal(saveSettings(custom, s), true, 'settings save');
assert.ok(s.getItem(SETTINGS_KEY), 'settings live under their own key');
const back = loadSettings(s);
assert.equal(back.size, 'l');
assert.equal(back.hand, 'left');
assert.deepEqual(back.pad.fire, [1]);
assert.deepEqual(back.pad.target, DEFAULT_PAD.target, 'untouched actions keep their defaults');

// ---- corrupt or foreign blobs ----------------------------------------------
assert.equal(parseSettings('{not json'), null, 'corrupt json');
assert.equal(parseSettings('null'), null, 'json null');
assert.equal(parseSettings('42'), null, 'json scalar');
assert.equal(parseSettings(JSON.stringify({ v: 99, pad: DEFAULT_PAD })), null, 'wrong version');
assert.equal(parseSettings(JSON.stringify({ v: SETTINGS_VERSION })), null, 'no pad block');
assert.deepEqual(loadSettings({ getItem: () => '{not json' }), defaultSettings(),
  'corrupt storage falls back to defaults');
assert.deepEqual(loadSettings(null), defaultSettings(), 'no storage falls back to defaults');
assert.equal(saveSettings(d, null), false, 'no storage, no save');

// ---- pad validation: bad entries fall back per action -----------------------
const p = parseSettings(JSON.stringify({ v: SETTINGS_VERSION, pad: {
  ...DEFAULT_PAD, fire: [99], target: [1, 2, 3, 4, 5], dock: 'back',
} }));
assert.deepEqual(p.pad.fire, DEFAULT_PAD.fire, 'out-of-range index falls back');
assert.deepEqual(p.pad.target, DEFAULT_PAD.target, 'too many buttons falls back');
assert.deepEqual(p.pad.dock, DEFAULT_PAD.dock, 'non-array binding falls back');
assert.deepEqual(p.pad.jump, DEFAULT_PAD.jump, 'missing action falls back');
const p2 = parseSettings(JSON.stringify({ v: SETTINGS_VERSION, pad: { ...DEFAULT_PAD, dock: [2] } }));
assert.deepEqual(p2.pad.dock, [2], 'a valid rebind survives');

// ---- size / hand clamp ------------------------------------------------------
const p3 = parseSettings(JSON.stringify({ v: SETTINGS_VERSION, size: 'xl', hand: 'middle', pad: DEFAULT_PAD }));
assert.equal(p3.size, 'm', 'unknown size falls back');
assert.equal(p3.hand, 'right', 'unknown hand falls back');

console.log('settings: ok');
