// Game simulation — pure logic, no DOM. Runs in the browser (main.js) and in
// node (tests/test-game.mjs). Ship numbers come from the real Oolite shipdata
// plist; where the port simplifies Oolite's model the line says `shortcut:`.
//
// Units are Oolite's: metres, seconds, degrees-ish rates in rad/s.

import {
  quatMul, quatAxisAngle, quatNormalize, quatRotate,
  norm, sub, add, scale, dot, cross, len, dist,
} from './math.js';
import { makeGalaxy, distanceLy } from './galaxy.js';

// The real 256-system Oolite galaxy (galaxy 1), generated from the upstream
// seed — system 0 is Tibedied, Lave is system 7, as in the original game.
export const SYSTEMS = makeGalaxy(1).systems;

// Elite-flavoured commodities: price moves against the system's economy.
const GOODS = [
  { key: 'food', name: 'Food', base: 3.6, trend: +1, unit: 't' },
  { key: 'minerals', name: 'Minerals', base: 4.2, trend: +1, unit: 't' },
  { key: 'machinery', name: 'Machinery', base: 60.8, trend: -1, unit: 't' },
  { key: 'computers', name: 'Computers', base: 128.4, trend: -1, unit: 't' },
  { key: 'furs', name: 'Furs', base: 68.4, trend: +1, unit: 't' },
  { key: 'weapons', name: 'Weapons', base: 78.6, trend: -1, unit: 't' },
];

export { GOODS };

// Combat rating: names from descriptions.plist "rating", thresholds from
// Oolite's OODisplayRatingStringFromKillCount (8, 16, 32, 64, 128, 512,
// 2560, 6400 kills). The port shows plain names — the plist decorates the top
// two with stars, which do not fit the save-slot rows.
export const RANKS = [
  'Harmless', 'Mostly Harmless', 'Poor', 'Average', 'Above Average',
  'Competent', 'Dangerous', 'Deadly', 'Elite',
];
const RANK_THRESHOLDS = [8, 16, 32, 64, 128, 512, 2560, 6400];

export function rankName(kills) {
  let i = 0;
  while (i < RANK_THRESHOLDS.length && kills >= RANK_THRESHOLDS[i]) i++;
  return RANKS[i];
}

// Legal status: Oolite's legalStatus points and display thresholds
// (OODisplayStringFromLegalStatus: >= 1 offender, >= 51 fugitive), with the
// three names from MISSING-FEATURES.md #2 ("Clear" — Oolite's own string
// table says "Clean").
export function legalStatus(crime) {
  return crime >= 51 ? 'Fugitive' : crime >= 1 ? 'Offender' : 'Clear';
}

// shortcut: Oolite tracks a bounty-like legalStatus with reason-specific
// values; this port uses one counter with the same display thresholds.
const CRIME_FIRING = 10;       // shot an innocent ship / the police
const CRIME_TRADER_KILL = 20;  // destroyed a trader
const CRIME_POLICE_KILL = 64;  // Oolite: attacking the police
const PROTECTION_ZONE = 5000;  // shortcut: station protection radius, metres

export function addCrime(g, points) {
  const before = legalStatus(g.crime);
  g.crime += points;
  const after = legalStatus(g.crime);
  if (after !== before) {
    pushMessage(g, `LEGAL STATUS: ${after.toUpperCase()}`, after === 'Fugitive' ? RED : YELLOW, 6);
  }
}

function inProtectionZone(g, pos) {
  return !!g.station && dist(pos, g.station.pos) <= PROTECTION_ZONE;
}

const RED = [1, 0, 0];
const GREEN = [0, 1, 0];
const BLUE = [0, 0, 1];
const YELLOW = [1, 1, 0];

// NPC rosters: combat ships hunt as hostile pirates, heavy haulers cross
// space in peace, and the Viper is the police (see spawnPolice below). Speed
// / turn / energy / bounty come from the real shipdata through def() below,
// so the heavy ships really are slow and tough.
const PIRATE_KEYS = ['mamba', 'krait', 'cobramk1', 'asp', 'gecko', 'constrictor'];
const TRADER_KEYS = ['python', 'anaconda', 'boa', 'boa-mk2', 'adder'];

function shipData(g, key) { return g.shipdata[key]; }
// Ship stats live in templates. Player hulls are thin layers over the real
// ship (oolite_template_X-player -> like_ship oolite_template_X), so follow the
// chain and merge child-over-parent the way Oolite's shipdata loader does.
function def(g, key) {
  const chain = [];
  const seen = new Set();
  let d = g.shipdata[`oolite_template_${key}`] || g.shipdata[key];
  while (d && chain.length < 5 && !seen.has(d)) {
    seen.add(d);
    chain.push(d);
    d = d.like_ship ? g.shipdata[d.like_ship] : null;
  }
  const out = {};
  for (let i = chain.length - 1; i >= 0; i--) Object.assign(out, chain[i]);
  delete out.like_ship;
  return out;
}

function pseudoRandom(seed) {
  let x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function pushMessage(g, text, color = YELLOW, life = 5) {
  g.messages.unshift({ text, color, life });
  if (g.messages.length > 5) g.messages.length = 5;
  g.events.push({ type: 'beep' });
}

function radiusOf(g, key) {
  // player hulls are keyed `X-player` but share the `X` mesh; hulls the port
  // does not ship a model for (adder, moray, fer-de-lance) fall back to 60 m
  const m = g.parsedMeshes[key] || g.parsedMeshes[key.replace(/-player$/, '')];
  return m && m.bbox ? m.bbox.radius : 60;
}

function makeShip(g, key, pos, quat, opts = {}) {
  const d = def(g, key);
  const maxEnergy = d.max_energy || 256;
  return {
    type: 'ship',
    shipKey: key,
    name: opts.name || d.name || key,
    pos: pos.slice(),
    quat: quat.slice(),
    vel: [0, 0, 0],
    radius: radiusOf(g, key),
    speed: 0,
    maxSpeed: d.max_flight_speed || 300,
    thrust: d.thrust || 30,
    pitchRate: d.max_flight_pitch || 1,
    rollRate: d.max_flight_roll || 2,
    yawRate: (d.max_flight_pitch || 1) / 4, // shortcut: Oolite derives yaw from pitch
    energy: maxEnergy,
    maxEnergy,
    bounty: opts.bounty || 0,
    hostile: !!opts.hostile,
    color: opts.hostile ? RED : GREEN,
    role: opts.role || 'pirate',
    // Hull fraction below which this ship may run for it instead of dying
    // game — one roll per ship, so badly damaged pirates break off unevenly.
    breakOffAt: 0.03 + Math.random() * 0.07,
    fireCooldown: 0,
    think: 0,
    strafePhase: Math.random() * Math.PI * 2,
    alive: true,
  };
}

function spawnStation(g) {
  const st = makeShip(g, 'coriolis', [0, 0, 0], [0, 0, 0, 1], { name: 'Coriolis Station', role: 'station' });
  st.type = 'station';
  st.maxSpeed = 0;
  st.spin = 0.02;
  st.color = BLUE;
  g.station = st;
  g.entities.push(st);
  return st;
}

// Contacts spawn inside the view cone: a ship 3 km off the port beam is as
// good as invisible, so keep new arrivals ahead of the nose and close enough
// to read as a ship rather than a pixel.
function spawnAhead(g, rangeMin, rangeMax) {
  const yaw = (Math.random() - 0.5) * 0.7;   // ±20°, inside the horizontal FOV
  const pitch = (Math.random() - 0.5) * 0.5;
  const nose = quatRotate(g.player.quat, [0, 0, 1]);
  const right = quatRotate(g.player.quat, [1, 0, 0]);
  const up = quatRotate(g.player.quat, [0, 1, 0]);
  const dir = norm(add(
    add(scale(nose, Math.cos(yaw)), scale(right, Math.sin(yaw))),
    scale(up, pitch),
  ));
  const range = rangeMin + Math.random() * (rangeMax - rangeMin);
  return add(g.player.pos, scale(dir, range));
}

export function spawnPirate(g) {
  // Round-robin so every combat ship in the roster actually shows up.
  const key = PIRATE_KEYS[g.pirateSeq++ % PIRATE_KEYS.length];
  const d = def(g, key);
  // Most shipdata templates carry no bounty; scale those by hull energy.
  const bounty = d.bounty || Math.round((d.max_energy || 256) / 5);
  const s = makeShip(g, key, spawnAhead(g, 700, 2000), [0, 0, 0, 1],
    { hostile: true, bounty, role: 'pirate' });
  s.think = Math.random();
  g.entities.push(s);
  return s;
}

export function spawnTrader(g) {
  const key = TRADER_KEYS[g.traderSeq++ % TRADER_KEYS.length];
  const s = makeShip(g, key, spawnAhead(g, 1200, 3200), [0, 0, 0, 1],
    { hostile: false, role: 'trader' });
  g.entities.push(s);
  return s;
}

export function spawnThargoid(g) {
  const d = def(g, 'thargoid');
  const s = makeShip(g, 'thargoid', spawnAhead(g, 900, 2600), [0, 0, 0, 1],
    { hostile: true, bounty: d.bounty || 100, role: 'thargoid' });
  s.think = Math.random();
  s.missileCd = 8 + Math.random() * 12; // alien warships shoot missiles early
  g.entities.push(s);
  return s;
}

// The Viper is the police, not a pirate: it patrols while your record is
// clean and turns on you the moment it is not (MISSING-FEATURES.md #2).
export function spawnPolice(g) {
  const d = def(g, 'viper');
  const s = makeShip(g, 'viper', spawnAhead(g, 800, 2400), [0, 0, 0, 1],
    { hostile: g.crime > 0, bounty: d.bounty || Math.round((d.max_energy || 256) / 5),
      role: 'police' });
  s.think = Math.random();
  g.entities.push(s);
  return s;
}

// ---------------------------------------------------------------------------
export function createGame(assets) {
  const g = {
    phase: 'title', // title | flight | docked | dead
    time: 0,
    fps: 60,
    alert: 'green',
    hudVisible: false,
    scannerZoom: 1, // radar zoom, 1×…5× (SCANNER_ZOOM_LEVELS)
    showCrosshair: true,
    weaponsOnline: true,
    weaponKey: 'WEAPON_BEAM_LASER',
    systemIndex: 7, // Lave — the classic starting system
    events: [],
    messages: [],
    explosions: [],
    shots: [],
    missiles: [], // missiles in flight (player's and incoming)
    entities: [],
    target: null,
    targetBounty: 0,
    compass: null,
    scannerEntities: () => [],
    playerRel: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    altitudeFraction: 0,
    dialSpeed: 0,
    dialRoll: 0,
    dialPitch: 0,
    kills: 0,
    crime: 0, // legal status points: 0 clear, >= 1 offender, >= 51 fugitive
    pirateSeq: 0,
    traderSeq: 0,
    equipmentTypes: assets.plists.equipment || [], // real equipment.plist rows
    hasEquipment: (key) => !!g.player.equipment[key],

    shipdata: assets.plists.shipdata,
    parsedMeshes: assets.parsedMeshes,
    shipyard: assets.plists.shipyard,
    // what the station still has for sale: every yard hull with shipdata stats
    yardStock: Object.keys(assets.plists.shipyard).filter(
      (k) => assets.plists.shipdata[`oolite_template_${k}`],
    ),

    player: null,
    station: null,
    spawnTimer: 0,
    weaponCooldown: 0,
    weaponTemp: 0,
    weaponOffline: 0,
    shieldCooldown: 0,
    dockHint: 0,
    ecmTime: 0,      // seconds left of the ECM effect
    ecmPulse: 0,     // countdown to the next jamming pulse
    ecmPulseNo: 0,   // pulses already fired (4 make one sweep)
    ecmCooldown: 0,  // re-arm time after a sweep
  };

  const pd = def(g, 'cobra3');
  g.player = {
    pos: [0, 0, 1400],
    quat: [0, 0, 0, 1],
    vel: [0, 0, 0],
    speed: 150,
    throttle: 0.45,
    radius: radiusOf(g, 'cobra3'),
    maxSpeed: pd.max_flight_speed || 350,
    thrust: pd.thrust || 32,
    pitchRate: pd.max_flight_pitch || 1,
    rollRate: pd.max_flight_roll || 2,
    yawRate: (pd.max_flight_pitch || 1) / 4,
    energy: pd.max_energy || 256,
    maxEnergy: pd.max_energy || 256,
    maxShield: 150,
    fwdShield: 150,
    aftShield: 150,
    fuel: pd.fuel || 70,
    maxCargo: pd.max_cargo || 20,
    missiles: pd.max_missiles || 0,
    cabinTemp: 60,
    weaponTemp: 0,
    credits: 100,
    cargo: {},
    equipment: {}, // fitted gear: EQ_ECM, …
    shipKey: 'cobra3-player', // yard key of the starting hull, for trade-in
    alive: true,
  };

  spawnStation(g);
  return g;
}

export function cargoUsed(g) {
  return Object.values(g.player.cargo).reduce((s, v) => s + v, 0);
}

// Scanner zoom, 1×…5× — Oolite's z / Z keys (SCANNER_ZOOM_LEVELS 5). dir +1
// wraps 5 → 1 (the source instead ramps back down), dir -1 stops at 1×.
export function zoomScanner(g, dir) {
  const z = g.scannerZoom + dir;
  g.scannerZoom = z > 5 ? 1 : z < 1 ? 1 : z;
  return g.scannerZoom;
}

// Deterministic market: prices/stock depend only on the system, so the screen
// is stable between opens.
export function marketFor(g) {
  const sys = SYSTEMS[g.systemIndex];
  return GOODS.map((good, i) => {
    const drift = (3.5 - sys.economy) * 0.08 * good.trend;
    const jitter = (pseudoRandom(g.systemIndex * 31 + i * 7) - 0.5) * 0.1;
    const price = Math.max(1, Math.round(good.base * (1 + drift + jitter) * 10) / 10);
    const stock = 8 + Math.floor(pseudoRandom(g.systemIndex * 17 + i * 13) * 40);
    return { ...good, price, stock };
  });
}

export function buyGood(g, key, qty = 1) {
  const row = marketFor(g).find((r) => r.key === key);
  if (!row) return false;
  const free = g.player.maxCargo - cargoUsed(g);
  const n = Math.min(qty, free, row.stock, Math.floor(g.player.credits / row.price));
  if (n <= 0) { pushMessage(g, 'UNABLE TO BUY', RED); return false; }
  g.player.credits -= n * row.price;
  g.player.cargo[key] = (g.player.cargo[key] || 0) + n;
  g.events.push({ type: 'buy' });
  pushMessage(g, `BOUGHT ${n} ${row.name.toUpperCase()} FOR ${(n * row.price).toFixed(1)} CR`, GREEN);
  return true;
}

export function sellGood(g, key, qty = 1) {
  const row = marketFor(g).find((r) => r.key === key);
  const held = g.player.cargo[key] || 0;
  const n = Math.min(qty, held);
  if (!row || n <= 0) { pushMessage(g, 'NOTHING TO SELL', RED); return false; }
  g.player.cargo[key] = held - n;
  if (!g.player.cargo[key]) delete g.player.cargo[key];
  g.player.credits += n * row.price;
  g.events.push({ type: 'sell' });
  pushMessage(g, `SOLD ${n} ${row.name.toUpperCase()} FOR ${(n * row.price).toFixed(1)} CR`, GREEN);
  return true;
}

// ---------------------------------------------------------------------------
// Shipyard. Prices are the real shipyard.plist credits values; Oolite's buy
// path multiplies by 10 only because its credits field is held in tenths, so
// the plist number is what is charged and displayed here.
// shortcut: stock is the full yard list minus bought hulls — Oolite instead
// rolls chance/techlevel/time per station.

export function shipyardFor(g) {
  return g.yardStock
    .map((key) => {
      const d = def(g, key);
      return {
        key,
        name: d.name || key,
        price: g.shipyard[key].price,
        cargo: d.max_cargo || 0,
        speed: d.max_flight_speed || 0,
      };
    })
    .sort((a, b) => a.price - b.price);
}

export function shipName(g, key) { return def(g, key).name || key; }

// Trade-in for the current hull: floor((price * 75 * factor + 5000) / 10000)
// credits (PlayerEntityContracts.m tradeInValue, minus its ×10 tenths step).
// shortcut: factor is Oolite's fresh-commander 95; the source raises it to 100
// after a purchase and with hull repair, and rounds through cunningFee — the
// port models neither hull condition nor that fee.
export function tradeInValue(g) {
  const y = g.shipyard[g.player.shipKey];
  const price = y ? y.price : 0;
  return Math.floor((price * 75 * 95 + 5000) / 10000);
}

export function buyShip(g, key) {
  const y = g.shipyard[key];
  if (!y || !g.yardStock.includes(key)) return false;
  const tradeIn = tradeInValue(g);
  // Affordability is checked before the manifest is sold, as in the source.
  if (g.player.credits + tradeIn < y.price) {
    pushMessage(g, 'INSUFFICIENT CREDITS', RED);
    return false;
  }
  // The old hull's cargo is sold off; the new ship starts empty with a full
  // tank (source: newShipCommonSetup zeroes the manifest and refuels).
  for (const k of Object.keys(g.player.cargo)) sellGood(g, k, g.player.cargo[k]);
  const p = g.player;
  p.credits += tradeIn - y.price;
  const d = def(g, key);
  p.shipKey = key;
  p.maxSpeed = d.max_flight_speed || 300;
  p.thrust = d.thrust || 30;
  p.pitchRate = d.max_flight_pitch || 1;
  p.rollRate = d.max_flight_roll || 2;
  p.yawRate = (d.max_flight_pitch || 1) / 4;
  p.maxEnergy = d.max_energy || 256;
  p.energy = p.maxEnergy;
  p.maxCargo = d.max_cargo || 20;
  p.missiles = d.max_missiles || 0;
  p.radius = radiusOf(g, key);
  p.fuel = d.fuel || 70;
  g.yardStock = g.yardStock.filter((k) => k !== key);
  pushMessage(g, `${shipName(g, key).toUpperCase()} BOUGHT — TRADE-IN ${tradeIn} CR`, GREEN, 6);
  g.events.push({ type: 'buy' });
  return true;
}

// ---- equipment -------------------------------------------------------------
// Sold at the station the way the shipyard sells hulls, at the real
// equipment.plist prices. The port models two items of Oolite's 41.
// shortcut: no tech-level or ship-compatibility gating on what is listed.
const EQUIPMENT_KEYS = ['EQ_ECM', 'EQ_MISSILE'];

export function missileCap(g) {
  return def(g, g.player.shipKey).max_missiles || 0;
}

export function equipmentFor(g) {
  const stock = g.equipmentTypes || [];
  const p = g.player;
  return EQUIPMENT_KEYS.map((key) => {
    const e = stock.find((row) => row[3] === key);
    if (!e) return null;
    if (key === 'EQ_MISSILE') {
      const cap = missileCap(g);
      return { key, name: e[2], price: e[1], note: `pylons ${p.missiles}/${cap}`, can: p.missiles < cap };
    }
    const owned = !!p.equipment[key];
    return { key, name: e[2], price: e[1], note: owned ? 'fitted' : '', can: !owned };
  }).filter(Boolean);
}

export function buyEquipment(g, key) {
  const row = equipmentFor(g).find((r) => r.key === key);
  const p = g.player;
  if (!row || !row.can) return false;
  if (p.credits < row.price) { pushMessage(g, 'INSUFFICIENT CREDITS', RED); return false; }
  p.credits -= row.price;
  if (key === 'EQ_MISSILE') p.missiles++;
  else p.equipment[key] = true;
  g.events.push({ type: 'buy' });
  pushMessage(g, key === 'EQ_MISSILE' ? 'MISSILE FITTED' : `${row.name.toUpperCase()} FITTED`, GREEN);
  return true;
}

export function dock(g) {
  g.phase = 'docked';
  g.hudVisible = false;
  g.alert = 'green';
  // Simplest rule for clearing a record: docking forgives every crime.
  if (g.crime > 0) {
    g.crime = 0;
    pushMessage(g, 'LEGAL STATUS CLEAR — DOCKED', GREEN, 6);
  }
  g.events.push({ type: 'docking' });
  pushMessage(g, `DOCKED AT ${SYSTEMS[g.systemIndex].name}`, GREEN, 6);
}

export function launch(g) {
  const st = g.station;
  // Start off to one side so the station drifts past ahead of the canopy.
  // Straight-out (+Z) put it directly behind the nose, where it can never
  // be seen; the lateral offset also means the flight path clears it by ~500 m.
  g.player.pos = [st.pos[0] + 1200, st.pos[1], st.pos[2] - 2966];
  g.player.quat = [0, 0, 0, 1];
  g.player.speed = 150;
  g.player.throttle = 0.45;
  g.phase = 'flight';
  g.hudVisible = true;
  pushMessage(g, 'LAUNCHED — GOOD LUCK, COMMANDER', GREEN, 6);
  if (!g.entities.some((e) => e.type === 'ship' && e.hostile)) spawnPirate(g);
  spawnPolice(g); // a viper patrol waits outside the station
}

// selected: a system index from the short-range chart; without one the jump
// goes to the nearest system in range, as before.
export function jump(g, selected) {
  if (g.phase !== 'flight') return false;
  const from = SYSTEMS[g.systemIndex];
  // Oolite rule: any system within 7 ly, and the jump costs the distance in
  // light years of fuel (fuel is in tenths of a ly) — see PlayerEntity.m
  // fuelRequiredForJump / maxHyperspaceDistance.
  const reach = Math.min(7, g.player.fuel / 10);
  let target = -1;
  let cost = 0;
  if (selected !== undefined) {
    // Chart selection: same 7 ly ring and same fuel cost, to the chosen
    // system instead of the nearest one.
    const sys = SYSTEMS[selected];
    if (!sys || sys.index === from.index) return false;
    const ly = distanceLy(from, sys);
    if (ly > 7) {
      pushMessage(g, 'OUT OF JUMP RANGE', RED);
      return false;
    }
    if (ly > reach) {
      pushMessage(g, 'INSUFFICIENT FUEL FOR JUMP', RED);
      return false;
    }
    target = sys.index;
    cost = Math.max(1, Math.round(ly * 10));
  } else {
    for (let step = 1; step < SYSTEMS.length; step++) {
      const idx = (from.index + step) % SYSTEMS.length;
      const ly = distanceLy(from, SYSTEMS[idx]);
      if (ly <= reach) { target = idx; cost = Math.max(1, Math.round(ly * 10)); break; }
    }
    if (target < 0) {
      pushMessage(g, g.player.fuel < 70 ? 'INSUFFICIENT FUEL FOR JUMP' : 'NO SYSTEM IN RANGE', RED);
      return false;
    }
  }
  g.player.fuel -= cost;
  g.systemIndex = target;
  g.events.push({ type: 'jump' });
  // Reset the sky: drop everything except the station, respawn contacts.
  g.entities = [];
  g.shots = [];
  g.explosions = [];
  g.missiles = [];
  g.target = null;
  spawnStation(g);
  // Same framing as launch: station ahead of the nose, not behind it.
  g.player.pos = [g.station.pos[0] + 1200, g.station.pos[1], g.station.pos[2] - 2966];
  g.player.speed = 150;
  spawnPirate(g);
  spawnTrader(g);
  spawnPolice(g);
  pushMessage(g, `WITCHSPACE — ARRIVED AT ${SYSTEMS[g.systemIndex].name}`, GREEN, 6);
  return true;
}

// ---- combat ---------------------------------------------------------------
function fireLaser(g) {
  const p = g.player;
  const fwd = quatRotate(p.quat, [0, 0, 1]);
  const origin = add(p.pos, scale(fwd, p.radius));
  const range = 6000;
  let best = null;
  let bestT = range;
  for (const e of g.entities) {
    if (!e.alive || e.type !== 'ship') continue;
    const to = sub(e.pos, origin);
    const t = dot(to, fwd);
    if (t <= 0 || t > bestT) continue;
    const closest = sub(to, scale(fwd, t));
    if (len(closest) <= e.radius * 1.6) { best = e; bestT = t; }
  }
  const end = add(origin, scale(fwd, best ? bestT : range));
  g.shots.push({ from: origin, to: end, life: 0.12, hostile: false });
  g.events.push({ type: 'laser' });
  g.weaponCooldown = 0.45;
  g.weaponTemp = Math.min(300, g.weaponTemp + 55);
  if (g.weaponTemp >= 256) {
    g.weaponOffline = 2;
    g.weaponsOnline = false;
    pushMessage(g, 'LASER OVERHEATED', RED);
  }
  if (best) damageShip(g, best, 60, true);
}

function damageShip(g, ship, amount, fromPlayer) {
  // Crimes: hit the police anywhere, or any innocent ship inside the
  // station's protection zone (MISSING-FEATURES.md #2).
  if (fromPlayer && !ship.hostile
      && (ship.role === 'police' || inProtectionZone(g, ship.pos))) {
    addCrime(g, CRIME_FIRING);
  }
  ship.energy -= amount;
  g.events.push({ type: 'hit' });
  if (ship.energy > 0) return;
  ship.alive = false;
  g.explosions.push({ pos: ship.pos.slice(), life: 0.9, maxLife: 0.9, size: ship.radius * 3 });
  g.events.push({ type: 'boom' });
  if (fromPlayer) {
    g.kills++;
    if (ship.role === 'trader') addCrime(g, CRIME_TRADER_KILL);
    else if (ship.role === 'police') addCrime(g, CRIME_POLICE_KILL);
    g.player.credits += ship.bounty;
    pushMessage(g, `SHIP DESTROYED — ${ship.bounty} CR BOUNTY`, YELLOW, 6);
  }
}

function damagePlayer(g, amount) {
  const p = g.player;
  if (p.fwdShield > 0) {
    const absorbed = Math.min(p.fwdShield, amount);
    p.fwdShield -= absorbed;
    amount -= absorbed;
  }
  if (amount > 0 && p.aftShield > 0) {
    const absorbed = Math.min(p.aftShield, amount);
    p.aftShield -= absorbed;
    amount -= absorbed;
  }
  if (amount > 0) p.energy -= amount;
  g.shieldCooldown = 6;
  g.alert = 'red';
  g.events.push({ type: 'hit' });
  if (p.energy <= 0) {
    p.alive = false;
    g.explosions.push({ pos: p.pos.slice(), life: 1.2, maxLife: 1.2, size: p.radius * 4 });
    g.events.push({ type: 'boom' });
    g.phase = 'dead';
    g.hudVisible = false;
  }
}

// ---- missiles --------------------------------------------------------------
// The real missile (shipdata oolite_template_missile): 750 m/s, 25 m
// proximity fuse, 30 km range, blastPower 180.
// shortcut: one standard missile per press at the locked target — no pylon
// missile types, no lock-on status, no missile-vs-missile interception.
const MISSILE_SPEED = 750;
const MISSILE_RANGE = 30000;
const MISSILE_DAMAGE = 180;
const MISSILE_FUSE = 25;
const MISSILE_TURN = 1.8; // rad/s of course change

export function launchMissile(g) {
  const p = g.player;
  const t = g.target;
  if (g.phase !== 'flight') return false;
  if (!t || !t.alive || t.type !== 'ship' || !g.entities.includes(t)) {
    pushMessage(g, 'NO MISSILE TARGET', RED);
    return false;
  }
  if (p.missiles <= 0) { pushMessage(g, 'OUT OF MISSILES', RED); return false; }
  p.missiles--;
  const fwd = quatRotate(p.quat, [0, 0, 1]);
  g.missiles.push({
    pos: add(p.pos, scale(fwd, p.radius + 5)),
    vel: scale(fwd, MISSILE_SPEED),
    target: t,
    hostile: false,
    life: MISSILE_RANGE / MISSILE_SPEED,
  });
  g.events.push({ type: 'missile' });
  pushMessage(g, 'MISSILE LAUNCHED', YELLOW, 3);
  return true;
}

// Hostile ships loose missiles at the player, as Oolite's combat AI does.
export function launchMissileAt(g, from, target, hostile) {
  const dir = norm(sub(target.pos, from.pos));
  g.missiles.push({
    pos: add(from.pos, scale(dir, from.radius + 5)),
    vel: scale(dir, MISSILE_SPEED),
    target,
    hostile: !!hostile,
    life: MISSILE_RANGE / MISSILE_SPEED,
  });
  g.events.push({ type: 'missile' });
  if (hostile) pushMessage(g, 'INCOMING MISSILE', RED, 3);
  return true;
}

function detonate(g, m) {
  m.life = 0;
  g.explosions.push({ pos: m.pos.slice(), life: 0.7, maxLife: 0.7, size: 40 });
  g.events.push({ type: 'boom' });
  const t = m.target;
  if (!t) return;
  if (m.hostile) {
    if (g.player.alive) damagePlayer(g, MISSILE_DAMAGE);
  } else if (t.alive && t.type === 'ship') {
    damageShip(g, t, MISSILE_DAMAGE, true);
  }
}

function updateMissiles(g, dt) {
  const p = g.player;
  for (const m of g.missiles) {
    m.life -= dt;
    const t = m.target;
    const valid = t && (t === p ? p.alive : t.alive && g.entities.includes(t));
    if (!valid) { m.life = 0; continue; }
    const dir = norm(m.vel);
    const want = norm(sub(t.pos, m.pos));
    const ax = cross(dir, want);
    const axl = len(ax);
    if (axl > 1e-6) {
      const angle = Math.atan2(axl, Math.max(-1, Math.min(1, dot(dir, want))));
      const step = Math.min(angle, MISSILE_TURN * dt);
      const q = quatAxisAngle(ax[0] / axl, ax[1] / axl, ax[2] / axl, step);
      m.vel = scale(quatRotate(q, dir), MISSILE_SPEED);
    }
    const prev = m.pos;
    m.pos = add(prev, scale(m.vel, dt));
    // Fuse against the whole segment travelled this frame, not just the end
    // point: at 750 m/s a 50 ms step can skip clean past a small target.
    const seg = sub(m.pos, prev);
    const seg2 = dot(seg, seg);
    let f = seg2 > 0 ? dot(sub(t.pos, prev), seg) / seg2 : 0;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
    if (dist(add(prev, scale(seg, f)), t.pos) <= t.radius + MISSILE_FUSE) detonate(g, m);
  }
  g.missiles = g.missiles.filter((m) => m.life > 0);
}

// ---- ECM -------------------------------------------------------------------
// Upstream: ECM_DURATION 2.5 s, four pulses a half second apart sweeping out
// to SCANNER_MAX_RANGE (25.6 km), draining 20 energy per second while it runs.
// shortcut: Oolite re-arms on energy alone; this adds a short cooldown so the
// button has an unmistakable rhythm on touch screens.
export function activateECM(g) {
  const p = g.player;
  if (g.phase !== 'flight' || g.ecmTime > 0 || g.ecmCooldown > 0) return false;
  if (!g.hasEquipment('EQ_ECM')) { pushMessage(g, 'NO ECM FITTED', RED); return false; }
  if (!g.weaponsOnline) return false;
  g.ecmTime = 2.5;
  g.ecmPulse = 0;
  g.ecmPulseNo = 0;
  pushMessage(g, 'ECM ACTIVE', BLUE, 3);
  g.events.push({ type: 'ecm' });
  return true;
}

function updateECM(g, dt) {
  const p = g.player;
  g.ecmTime -= dt;
  p.energy = Math.max(0, p.energy - 20 * dt);
  g.ecmPulse -= dt;
  if (g.ecmPulse <= 0 && g.ecmPulseNo < 4) {
    g.ecmPulseNo++;
    g.ecmPulse = 0.5;
    const radius = g.ecmPulseNo * 6400; // SCANNER_MAX_RANGE / 4 per pulse
    let jammed = 0;
    for (const m of g.missiles) {
      if (m.hostile && m.life > 0 && dist(m.pos, p.pos) <= radius) {
        m.life = 0;
        jammed++;
        g.explosions.push({ pos: m.pos.slice(), life: 0.5, maxLife: 0.5, size: 25 });
      }
    }
    if (jammed) {
      g.events.push({ type: 'boom' });
      pushMessage(g, 'MISSILE JAMMED', GREEN, 3);
    }
  }
  if (g.ecmTime <= 0 || p.energy <= 0) {
    if (p.energy <= 0 && g.ecmTime > 0) pushMessage(g, 'ECM OUT OF ENERGY', RED);
    g.ecmTime = 0;
    g.ecmCooldown = 5;
  }
}

// ---- steering -------------------------------------------------------------
function steerToward(e, targetPos, dt, rate) {
  const fwd = quatRotate(e.quat, [0, 0, 1]);
  const d = norm(sub(targetPos, e.pos));
  const ax = cross(fwd, d);
  const axl = len(ax);
  if (axl < 1e-5) return;
  const angle = Math.atan2(axl, Math.max(-1, Math.min(1, dot(fwd, d))));
  const step = Math.min(angle, rate * dt);
  const q = quatAxisAngle(ax[0] / axl, ax[1] / axl, ax[2] / axl, step);
  e.quat = quatNormalize(quatMul(q, e.quat));
}

function integrate(e, dt, speedScale = 1) {
  const fwd = quatRotate(e.quat, [0, 0, 1]);
  e.speed = e.maxSpeed * speedScale;
  e.vel = scale(fwd, e.speed);
  e.pos = add(e.pos, scale(e.vel, dt));
}

function updateNPC(e, g, dt) {
  const p = g.player;
  const toPlayer = sub(p.pos, e.pos);
  const d = len(toPlayer);

  // The police hunt only a wanted commander: a viper patrols alongside you
  // while your record is clean, and turns the moment it is not.
  if (e.role === 'police') {
    const wanted = g.crime > 0;
    if (e.hostile !== wanted) {
      e.hostile = wanted;
      e.color = wanted ? RED : GREEN;
      if (wanted) pushMessage(g, 'POLICE ATTACKING', RED, 5);
    }
  }

  if (e.role === 'trader' || (e.role === 'police' && !e.hostile)) {
    // Traders drift past on a straight line and never engage; a clean
    // commander's police escort drifts by the same way (shortcut: no patrol
    // routes — they fly a straight line like the traders do).
    if (d > 20000) { e.alive = false; return; }
    integrate(e, dt, 0.5);
    return;
  }

  // Badly damaged hostiles may break off instead of fighting to the death —
  // never a thargoid: the alien warship fights to the last hull.
  if (e.hostile && e.role !== 'thargoid' && !e.breakingOff
      && e.energy <= e.maxEnergy * (e.breakOffAt || 0.08)) {
    e.breakingOff = true;
    pushMessage(g, `${String(e.name || e.shipKey).toUpperCase()} BREAKING OFF`, BLUE, 4);
  }
  if (e.breakingOff) {
    if (d > 20000) { e.alive = false; return; }
    steerToward(e, add(e.pos, sub(e.pos, p.pos)), dt, e.pitchRate);
    integrate(e, dt, 1);
    return;
  }

  e.think -= dt;
  if (e.think <= 0) {
    e.think = 0.4 + Math.random() * 0.6;
    e.strafePhase += 0.7;
  }

  let aimAt = p.pos;
  if (d < 700) {
    // Too close: fly past instead of pinning on the player.
    const fwd = quatRotate(e.quat, [0, 0, 1]);
    aimAt = add(e.pos, scale(fwd, 2000));
  } else if (d < 4000) {
    // Circle strafe so dogfights do not become head-on stalls.
    const tangent = cross(norm(toPlayer), [0, 1, 0]);
    aimAt = add(p.pos, scale(norm(tangent), Math.sin(e.strafePhase) * 600));
  }
  steerToward(e, aimAt, dt, e.pitchRate * 0.9);
  integrate(e, dt, d < 900 ? 1.0 : 0.85);

  // Fire when roughly aligned and in range.
  e.fireCooldown -= dt;
  const fwd = quatRotate(e.quat, [0, 0, 1]);
  const aim = norm(sub(p.pos, e.pos));
  const aligned = dot(fwd, aim);
  if (e.fireCooldown <= 0 && d < 3500 && aligned > 0.985) {
    e.fireCooldown = 1.1 + Math.random() * 0.7;
    g.shots.push({
      from: add(e.pos, scale(fwd, e.radius)),
      to: add(p.pos, scale(norm(sub(e.pos, p.pos)), -len(sub(e.pos, p.pos)))),
      life: 0.12, hostile: true,
    });
    g.events.push({ type: 'laser' });
    if (aligned > 0.995 || Math.random() < 0.5) damagePlayer(g, 35);
  }

  // Missiles: hostiles loose one now and then once in range. The first shot
  // waits 15–40 s so a fresh commander is not swarmed on launch.
  // shortcut: NPCs carry unlimited missiles — only the player counts a pylon.
  if (e.missileCd === undefined) e.missileCd = 15 + Math.random() * 25;
  e.missileCd -= dt;
  if (e.missileCd <= 0) {
    e.missileCd = e.role === 'thargoid' ? 18 + Math.random() * 15 : 25 + Math.random() * 30;
    const inbound = g.missiles.reduce((n, m) => n + (m.hostile ? 1 : 0), 0);
    const shoots = e.role === 'thargoid' || Math.random() < 0.5;
    if (d < 6000 && d > 200 && inbound < 2 && p.alive && shoots) {
      launchMissileAt(g, e, p, true);
    }
  }
}

// ---- per-frame ------------------------------------------------------------
export function stepGame(g, input, dt) {
  dt = Math.min(dt, 0.05);
  g.events.length = 0;
  if (g.phase === 'title') return g;
  g.time += dt;

  // one-shot inputs
  if (input.jump) jump(g);
  if (g.phase !== 'flight') return g;

  const p = g.player;

  // --- flight ------------------------------------------------------------
  const pitch = input.pitch || 0;
  const yaw = input.yaw || 0;
  const roll = input.roll || 0;
  if (pitch || yaw || roll) {
    const q = quatMul(
      quatMul(
        quatAxisAngle(1, 0, 0, -pitch * p.pitchRate * dt),
        quatAxisAngle(0, 1, 0, -yaw * p.yawRate * dt)
      ),
      quatAxisAngle(0, 0, 1, -roll * p.rollRate * dt)
    );
    p.quat = quatNormalize(quatMul(p.quat, q));
  }
  g.dialPitch = pitch;
  g.dialRoll = roll;

  if (input.throttleSet != null) p.throttle = input.throttleSet;
  else if (input.throttle) p.throttle = Math.max(0, Math.min(1, p.throttle + input.throttle * dt));
  const injector = input.injectors ? 2.5 : 1;
  const targetSpeed = p.maxSpeed * p.throttle * injector;
  // shortcut: Oolite accelerates with `thrust`; here speed tracks the throttle
  // directly so touch controls feel immediate.
  p.speed += (targetSpeed - p.speed) * Math.min(1, dt * 2.5);
  const fwd = quatRotate(p.quat, [0, 0, 1]);
  p.vel = scale(fwd, p.speed);
  p.pos = add(p.pos, scale(p.vel, dt));
  g.dialSpeed = p.maxSpeed ? p.speed / (p.maxSpeed * injector) : 0;

  // world → ship rotation (rows are the ship's axes in world space)
  const ex = quatRotate(p.quat, [1, 0, 0]);
  const ey = quatRotate(p.quat, [0, 1, 0]);
  const ez = quatRotate(p.quat, [0, 0, 1]);
  g.playerRel.set([ex[0], ex[1], ex[2], ey[0], ey[1], ey[2], ez[0], ez[1], ez[2]]);

  // --- shields / energy / temperature -------------------------------------
  g.shieldCooldown -= dt;
  if (g.shieldCooldown <= 0) {
    p.fwdShield = Math.min(p.maxShield, p.fwdShield + 8 * dt);
    p.aftShield = Math.min(p.maxShield, p.aftShield + 8 * dt);
    g.alert = 'green';
  }
  const recharge = def(g, 'cobra3').energy_recharge_rate || 4;
  p.energy = Math.min(p.maxEnergy, p.energy + recharge * dt);
  g.weaponTemp = Math.max(0, g.weaponTemp - 45 * dt);
  if (g.weaponOffline > 0) {
    g.weaponOffline -= dt;
    if (g.weaponOffline <= 0 && g.weaponTemp < 200) {
      g.weaponsOnline = true;
      p.weaponTemp = 0;
    }
  }
  p.weaponTemp = g.weaponTemp;

  // --- weapons ------------------------------------------------------------
  g.weaponCooldown -= dt;
  if (input.fire && g.weaponCooldown <= 0 && g.weaponsOnline) fireLaser(g);
  if (input.launchMissile) launchMissile(g);
  if (g.ecmCooldown > 0) g.ecmCooldown = Math.max(0, g.ecmCooldown - dt);
  if (input.ecm) activateECM(g);
  if (g.ecmTime > 0) updateECM(g, dt);

  // --- entities -----------------------------------------------------------
  for (const e of g.entities) {
    if (!e.alive) continue;
    if (e.type === 'station') {
      e.quat = quatNormalize(quatMul(quatAxisAngle(0, 1, 0, e.spin * dt), e.quat));
      continue;
    }
    updateNPC(e, g, dt);
  }
  g.entities = g.entities.filter((e) => e.alive);
  updateMissiles(g, dt);

  // --- respawn contacts ---------------------------------------------------
  g.spawnTimer -= dt;
  const hostiles = g.entities.filter((e) => e.hostile).length;
  const police = g.entities.filter((e) => e.role === 'police').length;
  if (g.spawnTimer <= 0 && hostiles < 2) {
    g.spawnTimer = 12;
    // a wanted commander gets the police on their tail instead of a free spawn
    if (g.crime > 0 && police === 0) spawnPolice(g);
    else if (hostiles === 0) spawnPirate(g);
    // one hostile in three is the alien instead of a pirate
    else if (Math.random() < 0.6) (Math.random() < 0.33 ? spawnThargoid(g) : spawnPirate(g));
    if (!g.entities.some((e) => e.role === 'trader') && Math.random() < 0.5) spawnTrader(g);
  }

  // --- shots fade ---------------------------------------------------------
  for (const s of g.shots) s.life -= dt;
  g.shots = g.shots.filter((s) => s.life > 0);
  for (const x of g.explosions) x.life -= dt;
  g.explosions = g.explosions.filter((x) => x.life > 0);

  // --- collisions ---------------------------------------------------------
  for (const e of g.entities) {
    const d = dist(e.pos, p.pos);
    if (d < e.radius + p.radius) {
      const away = norm(sub(p.pos, e.pos));
      p.pos = add(e.pos, scale(away, e.radius + p.radius + 1));
      p.speed *= 0.3;
      if (e.type === 'station') {
        if (d < e.radius + p.radius + 60 && p.speed < 120) dock(g);
        else damagePlayer(g, 25);
      } else {
        damagePlayer(g, 15);
      }
      if (g.phase !== 'flight') return g;
    }
  }

  // --- docking ------------------------------------------------------------
  const st = g.station;
  if (st) {
    const sd = dist(st.pos, p.pos);
    if ((sd < 400 && p.speed < 120) || (input.dockRequest && sd < 1500 && p.speed < 250)) dock(g);
    else if (sd < 3000 && p.speed >= 120) g.dockHint = 2;
    else g.dockHint = Math.max(0, g.dockHint - dt);
    if (g.dockHint > 0 && !g.messages.some((m) => m.text.startsWith('SLOW'))) {
      pushMessage(g, 'SLOW TO <120 m/s TO DOCK', BLUE, 3);
    }
  }

  // --- targeting / compass ------------------------------------------------
  if (input.targetNext) cycleTarget(g);
  if (g.target && (!g.target.alive || !g.entities.includes(g.target))) g.target = null;
  g.compass = g.target || g.station;
  g.targetBounty = g.target && g.target.bounty ? g.target.bounty : 0;

  // --- messages -----------------------------------------------------------
  for (const m of g.messages) m.life -= dt;
  g.messages = g.messages.filter((m) => m.life > 0);

  // --- scanner ------------------------------------------------------------
  g.scannerEntities = () => g.entities;
  return g;
}

export function cycleTarget(g) {
  const list = g.entities.filter((e) => e.type === 'ship');
  if (!list.length) { g.target = null; return; }
  const i = g.target ? list.indexOf(g.target) : -1;
  g.target = list[(i + 1) % list.length];
  g.events.push({ type: 'beep' });
}
