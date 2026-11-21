// Device settings: touch layout and gamepad bindings — kept out of the
// commander save on their own localStorage entry, so a fresh commander gets
// the same controls and a corrupt settings blob can never refuse a load.
// Pure data logic (node tests pass a Map-backed stub); applying to the DOM
// is main.js / setup.js's job.

import { defaultStorage } from './save.js';
import { DEFAULT_PAD } from './controls.js';

export const SETTINGS_KEY = 'oolite-browser.settings';
export const SETTINGS_VERSION = 1;

const SIZES = ['s', 'm', 'l'];
const HANDS = ['right', 'left'];
const num = (v) => Number.isInteger(v) && v >= 0 && v <= 15; // standard pad: 16 buttons

export function defaultSettings() {
  return { v: SETTINGS_VERSION, size: 'm', hand: 'right', pad: { ...DEFAULT_PAD } };
}

// A pad binding is an array of button indexes; unknown actions and bad
// indexes fall back to the default for that action, the rest survives.
function validPad(pad) {
  if (!pad || typeof pad !== 'object' || Array.isArray(pad)) return null;
  const out = {};
  for (const [action, buttons] of Object.entries(DEFAULT_PAD)) {
    const b = pad[action];
    if (Array.isArray(b) && b.length && b.length <= 4 && b.every(num)) out[action] = [...b];
    else out[action] = [...buttons];
  }
  return out;
}

export function parseSettings(text) {
  if (typeof text !== 'string') return null;
  let d;
  try { d = JSON.parse(text); } catch (e) { return null; }
  if (!d || typeof d !== 'object' || d.v !== SETTINGS_VERSION) return null;
  const pad = validPad(d.pad);
  if (!pad) return null;
  return {
    v: SETTINGS_VERSION,
    size: SIZES.includes(d.size) ? d.size : 'm',
    hand: HANDS.includes(d.hand) ? d.hand : 'right',
    pad,
  };
}

export function loadSettings(storage = defaultStorage()) {
  if (!storage) return defaultSettings();
  try {
    return parseSettings(storage.getItem(SETTINGS_KEY)) || defaultSettings();
  } catch (e) {
    return defaultSettings();
  }
}

export function saveSettings(s, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ v: SETTINGS_VERSION, ...s }));
    return true;
  } catch (e) {
    return false; // quota exceeded or storage refused the write
  }
}
