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
  const p = data.player;
  if (!p || typeof p !== 'object') return null;
  if (typeof p.shipKey !== 'string' || !p.shipKey) return null;
  if (!validCargo(p.cargo)) return null;
  for (const f of PLAYER_FIELDS) if (!num(p[f])) return null;
  const player = { shipKey: p.shipKey, cargo: { ...p.cargo } };
  for (const f of PLAYER_FIELDS) player[f] = p[f];
  return { v: SAVE_VERSION, phase: data.phase, systemIndex: data.systemIndex, kills: data.kills, player };
}

export function saveData(g) {
  const p = g.player;
  const player = { shipKey: p.shipKey, cargo: { ...p.cargo } };
  for (const f of PLAYER_FIELDS) player[f] = p[f];
  return { v: SAVE_VERSION, phase: g.phase, systemIndex: g.systemIndex, kills: g.kills, player };
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
  Object.assign(g.player, d.player);

  g.entities = g.entities.filter((e) => e.type === 'station');
  g.shots = [];
  g.explosions = [];
  g.target = null;
  g.messages = [];
  g.alert = 'green';
  g.weaponTemp = 0;
  g.weaponOffline = 0;
  g.weaponCooldown = 0;
  g.shieldCooldown = 0;
  g.dockHint = 0;
  if (d.phase === 'flight') {
    const st = g.station;
    g.player.pos = [st.pos[0] + 1200, st.pos[1], st.pos[2] - 2966];
    g.player.quat = [0, 0, 0, 1];
    g.player.speed = 150;
    g.player.throttle = 0.45;
    spawnPirate(g);
    spawnTrader(g);
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
