// Save/load to localStorage — pure data logic, no DOM. The browser (main.js)
// passes localStorage; tests pass a Map-backed stub, node passes null.
//
// The save is versioned: parseSave() rejects anything that is not exactly
// SAVE_VERSION or fails its shape check, so an old or corrupt save can never
// crash the game — loadGame() just returns false and the title screen starts
// fresh.

import { spawnPirate, spawnTrader } from './game.js';

export const SAVE_KEY = 'oolite-browser.save';
export const SAVE_VERSION = 1;

// Manual saves live in a handful of slots next to the auto-save; the menus
// (slots.js) show one row per slot and never load one that fails validation.
export const SLOT_COUNT = 3;
const slotKey = (i) => `${SAVE_KEY}.slot${i}`;
const validSlot = (i) => Number.isInteger(i) && i >= 0 && i < SLOT_COUNT;

// Player fields the save carries. Ship stats travel as they stand instead of
// being re-derived from shipKey: the game itself wrote them (buyShip does the
// same derivation), so they cannot drift from what was flown.
const PLAYER_FIELDS = [
  'credits', 'fuel', 'maxCargo', 'maxSpeed', 'thrust', 'pitchRate', 'rollRate',
  'yawRate', 'maxEnergy', 'energy', 'maxShield', 'fwdShield', 'aftShield',
  'missiles', 'radius',
];

const num = (v) => typeof v === 'number' && Number.isFinite(v);

function validCargo(cargo) {
  if (!cargo || typeof cargo !== 'object' || Array.isArray(cargo)) return false;
  return Object.entries(cargo).every(([k, v]) => typeof k === 'string' && num(v) && v >= 0);
}

// Normalise and validate in one pass. Returns a clean copy or null; never
// throws, whatever the input.
function validate(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.v !== SAVE_VERSION) return null;
  if (data.phase !== 'flight' && data.phase !== 'docked') return null;
  if (!Number.isInteger(data.systemIndex) || data.systemIndex < 0 || data.systemIndex > 255) return null;
  if (!num(data.kills) || data.kills < 0) return null;
  // Legal status is optional so saves written before it existed still load;
  // when present it must be a sane number, or the whole save is refused.
  let crime = 0;
  if (data.crime !== undefined) {
    if (!num(data.crime) || data.crime < 0) return null;
    crime = data.crime;
  }
  const p = data.player;
  if (!p || typeof p !== 'object') return null;
  if (typeof p.shipKey !== 'string' || !p.shipKey) return null;
  if (!validCargo(p.cargo)) return null;
  for (const f of PLAYER_FIELDS) if (!num(p[f])) return null;
  const player = { shipKey: p.shipKey, cargo: { ...p.cargo } };
  for (const f of PLAYER_FIELDS) player[f] = p[f];
  // Equipment is optional so saves written before it existed still load.
  player.equipment = {};
  if (p.equipment && typeof p.equipment === 'object' && !Array.isArray(p.equipment)) {
    for (const [k, v] of Object.entries(p.equipment)) if (v === true) player.equipment[k] = true;
  }
  return { v: SAVE_VERSION, phase: data.phase, systemIndex: data.systemIndex,
    kills: data.kills, crime, player };
}

export function saveData(g) {
  const p = g.player;
  const player = { shipKey: p.shipKey, cargo: { ...p.cargo } };
  for (const f of PLAYER_FIELDS) player[f] = p[f];
  player.equipment = { ...p.equipment };
  return { v: SAVE_VERSION, phase: g.phase, systemIndex: g.systemIndex,
    kills: g.kills, crime: g.crime, player };
}

export function serializeSave(g) {
  return JSON.stringify(saveData(g));
}

export function parseSave(text) {
  if (typeof text !== 'string') return null;
  try {
    return validate(JSON.parse(text));
  } catch (e) {
    return null;
  }
}

// Restore into an existing game (createGame() output). The world is rebuilt,
// not saved: the station always exists and a restored flight starts framed on
// it, the way a launch or a jump leaves it.
export function applySave(g, data) {
  const d = validate(data);
  if (!d) return false;
  g.phase = d.phase;
  g.hudVisible = d.phase === 'flight';
  g.systemIndex = d.systemIndex;
  g.kills = d.kills;
  g.crime = d.crime;
  Object.assign(g.player, d.player);

  g.entities = g.entities.filter((e) => e.type === 'station');
  g.shots = [];
  g.explosions = [];
  g.missiles = [];
  g.target = null;
  g.messages = [];
  g.alert = 'green';
  g.weaponTemp = 0;
  g.weaponOffline = 0;
  g.weaponCooldown = 0;
  g.shieldCooldown = 0;
  g.dockHint = 0;
  g.ecmTime = 0;
  g.ecmCooldown = 0;
  if (d.phase === 'flight') {
    const st = g.station;
    g.player.pos = [st.pos[0] + 1200, st.pos[1], st.pos[2] - 2966];
    g.player.quat = [0, 0, 0, 1];
    g.player.speed = 150;
    g.player.throttle = 0.45;
    spawnPirate(g);
    spawnTrader(g);
    spawnPolice(g);
  }
  return true;
}

export function defaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch (e) {
    return null; // storage blocked (Safari private mode): play without saves
  }
}

export function saveGame(g, storage = defaultStorage()) {
  if (!storage || (g.phase !== 'flight' && g.phase !== 'docked')) return false;
  try {
    storage.setItem(SAVE_KEY, serializeSave(g));
    return true;
  } catch (e) {
    return false; // quota exceeded or storage refused the write
  }
}

export function loadGame(g, storage = defaultStorage()) {
  if (!storage) return false;
  let text = null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch (e) {
    return false;
  }
  const d = parseSave(text);
  return d ? applySave(g, d) : false;
}

export function hasSave(storage = defaultStorage()) {
  if (!storage) return false;
  try {
    return parseSave(storage.getItem(SAVE_KEY)) !== null;
  } catch (e) {
    return false;
  }
}

// ---- manual slots ----------------------------------------------------------
// What a slot holds, for the SAVE/LOAD menus: null when it is empty, corrupt
// or out of range — a bad slot reads as empty, so it can only be overwritten,
// never loaded.

export function slotInfo(i, storage = defaultStorage()) {
  if (!storage || !validSlot(i)) return null;
  try {
    const d = parseSave(storage.getItem(slotKey(i)));
    if (!d) return null;
    return {
      phase: d.phase,
      systemIndex: d.systemIndex,
      kills: d.kills,
      credits: d.player.credits,
    };
  } catch (e) {
    return null;
  }
}

export function saveSlot(g, i, storage = defaultStorage()) {
  if (!storage || !validSlot(i)) return false;
  if (g.phase !== 'flight' && g.phase !== 'docked') return false;
  try {
    storage.setItem(slotKey(i), serializeSave(g));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadSlot(g, i, storage = defaultStorage()) {
  if (!storage || !validSlot(i)) return false;
  let text = null;
  try {
    text = storage.getItem(slotKey(i));
  } catch (e) {
    return false;
  }
  const d = parseSave(text);
  return d ? applySave(g, d) : false;
}

// The title screen shows LOAD only when some slot can actually be loaded.
export function hasAnySlot(storage = defaultStorage()) {
  for (let i = 0; i < SLOT_COUNT; i++) if (slotInfo(i, storage)) return true;
  return false;
}
