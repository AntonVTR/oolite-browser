// Save/load to localStorage — pure data logic, no DOM. The browser (main.js)
// passes localStorage; tests pass a Map-backed stub, node passes null.
//
// The save is versioned: parseSave() rejects anything that is not exactly
// SAVE_VERSION or fails its shape check, so an old or corrupt save can never
// crash the game — loadGame() just returns false and the title screen starts
// fresh.

import { spawnPirate, spawnTrader, spawnPolice, spawnStation, spawnAsteroidField } from './game.js';
import { missionState, MISSION_IDS } from './missions.js';

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
  // The galaxy (1..8, #8) is optional so saves written before it existed
  // still load; when present it must be a real galaxy number, or the whole
  // save is refused (same rule as crime below).
  let galaxy = 1;
  if (data.galaxy !== undefined) {
    if (!Number.isInteger(data.galaxy) || data.galaxy < 1 || data.galaxy > 8) return null;
    galaxy = data.galaxy;
  }
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
  // Mission state is optional so saves written before it existed still load;
  // when present every id must be a known mission and the counts sane, or the
  // whole save is refused (same rule as crime above).
  let mission = missionState();
  if (data.mission !== undefined) {
    const m = data.mission;
    const known = (id) => typeof id === 'string' && MISSION_IDS.includes(id);
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    if (m.active !== null && !known(m.active)) return null;
    if (!num(m.jumps) || m.jumps < 0) return null;
    if (!Array.isArray(m.done) || !m.done.every(known)) return null;
    mission = { active: m.active, jumps: m.jumps, done: [...new Set(m.done)] };
  }
  const player = { shipKey: p.shipKey, cargo: { ...p.cargo } };
  for (const f of PLAYER_FIELDS) player[f] = p[f];
  // Extra missile pylons are optional so saves written before they existed
  // still load; when present they must be a sane count.
  let pylons = 0;
  if (p.pylons !== undefined) {
    if (!num(p.pylons) || p.pylons < 0) return null;
    pylons = p.pylons;
  }
  player.pylons = pylons;
  // Equipment is optional so saves written before it existed still load.
  player.equipment = {};
  if (p.equipment && typeof p.equipment === 'object' && !Array.isArray(p.equipment)) {
    for (const [k, v] of Object.entries(p.equipment)) if (v === true) player.equipment[k] = true;
  }
  return { v: SAVE_VERSION, phase: data.phase, systemIndex: data.systemIndex,
    galaxy, kills: data.kills, crime, mission, player };
}

export function saveData(g) {
  const p = g.player;
  const player = { shipKey: p.shipKey, cargo: { ...p.cargo }, pylons: p.pylons || 0 };
  for (const f of PLAYER_FIELDS) player[f] = p[f];
  player.equipment = { ...p.equipment };
  return { v: SAVE_VERSION, phase: g.phase, systemIndex: g.systemIndex,
    galaxy: g.galaxy || 1,
    kills: g.kills, crime: g.crime,
    mission: { active: g.mission.active, jumps: g.mission.jumps, done: [...g.mission.done] },
    player };
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
  g.galaxy = d.galaxy;
  g.kills = d.kills;
  g.crime = d.crime;
  g.mission = d.mission;
  Object.assign(g.player, d.player);

  g.entities = [];
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
  g.heatTick = 0;
  g.energyLow = false;
  g.player.cabinTemp = 60; // the cabin is not in the save: loads start cool
  g.dockHint = 0;
  g.launchSeq = 0; // never resume a launch ride from a save
  g.ecmTime = 0;
  g.ecmCooldown = 0;
  g.markets = {}; // prices belong to a (galaxy, system) pair — start clean (#8)
  g.galConfirm = false;
  g.witchspace = false; // saves never hold a stranded commander (#10)
  // a load rebuilds the station for the loaded system, so a save from a
  // dodecahedron system comes back to its own station type (#13)
  g.station = null;
  spawnStation(g);
  if (d.phase === 'flight') {
    const st = g.station;
    g.player.pos = [st.pos[0] + 1200, st.pos[1], st.pos[2] - 2966];
    g.player.quat = [0, 0, 0, 1];
    g.player.speed = 150;
    g.player.throttle = 0.45;
    spawnPirate(g);
    spawnTrader(g);
    spawnPolice(g);
    spawnAsteroidField(g); // the rebuilt sky carries rocks too (#12)
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
      galaxy: d.galaxy,
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
