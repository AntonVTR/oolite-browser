// Game simulation — pure logic, no DOM. Runs in the browser (main.js) and in
// node (tests/test-game.mjs). Ship numbers come from the real Oolite shipdata
// plist; where the port simplifies Oolite's model the line says `shortcut:`.
//
// Units are Oolite's: metres, seconds, degrees-ish rates in rad/s.

import {
  quatMul, quatAxisAngle, quatNormalize, quatRotate, quatConjugate, quatFromBasis,
  norm, sub, add, scale, dot, cross, len, dist,
} from './math.js';
import { galaxySystems, distanceLy } from './galaxy.js';
import {
  missionState, missionSpawnKey, missionOnJump, missionOnKill, missionOnDock,
} from './missions.js';

// Galaxy 1's systems — the classic fixture (Lave is system 7). Live screens
// never touch this: they read the commander's galaxy through systemsIn(g).
export const SYSTEMS = galaxySystems(1);

// The 256 systems of the galaxy the commander is currently in (#8).
export function systemsIn(g) {
  return galaxySystems(g.galaxy || 1);
}

// The real 17 commodities from upstream Resources/Config/trade-goods.plist
// (copied to web/assets/config by tools/copy-assets.sh). The plist's `name`
// only holds the localization key, so the display strings are the
// "commodity-name …" entries of descriptions.plist; quantity_unit 0/1/2 is
// t/kg/g.
const COMMODITY_NAMES = {
  food: 'Food', textiles: 'Textiles', radioactives: 'Radioactives',
  slaves: 'Slaves', liquor_wines: 'Liquor/Wines', luxuries: 'Luxuries',
  narcotics: 'Narcotics', computers: 'Computers', machinery: 'Machinery',
  alloys: 'Alloys', firearms: 'Firearms', furs: 'Furs', minerals: 'Minerals',
  gold: 'Gold', platinum: 'Platinum', gem_stones: 'Gem-Stones',
  alien_items: 'Alien Items',
};
const QUANTITY_UNITS = ['t', 'kg', 'g'];

// Sorted the way Oolite's goodsSorter orders the market: by the plist's
// sort_order (100 … 1700).
function goodsFrom(plist) {
  return Object.entries(plist || {})
    .map(([key, d]) => ({
      ...d,
      key,
      name: COMMODITY_NAMES[key] || key,
      unit: QUANTITY_UNITS[d.quantity_unit] || 't',
      // a good with any legality above zero is contraband (the plist marks
      // slaves, narcotics and firearms with the "illegal" comment)
      illegal: (d.legality_export || 0) + (d.legality_import || 0) > 0,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

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
// Passenger runs (#15): light traffic that shuts between station and planet
// and runs from danger on sight. shortcut: none of the port's 14 meshes is a
// dedicated liner, so the shuttle role rides the Cobra and the Adder — the
// Adder's own shipdata roles include `shuttle`.
const PASSENGER_KEYS = ['cobra3', 'adder'];

// Behaviour states and ranges (#15). Every NPC either fights its nearest foe,
// runs from a threat, or patrols on a straight line.
const PEACEFUL_ROLES = ['trader', 'passenger'];
const ENGAGE_RANGE = 8000;    // how close a hostile must be to fight at all
const POLICE_ENGAGE = 10000;  // the protection radius a clean viper patrols
const PASSENGER_FLEE = 4000;  // shuttles run from a hostile on sight
const FLEE_RANGE = 15000;     // keep running while the threat is this close
const MAX_PEACEFUL = 2;       // one hauler and one shuttle: inhabited, not crowded
// A gentler launch: the first hostile finishLaunch puts in the sky waits out
// this grace before it picks a foe, and holds fire a beat longer, so the ride
// out of the tube does not end with laser fire in your face.
const LAUNCH_GRACE = 10;      // seconds before that first hostile engages
const LAUNCH_FIRE_DELAY = 1.5; // extra seconds before its very first shot

// Ship stats live in templates. Player hulls are thin layers over the real
// ship (oolite_template_X-player -> like_ship oolite_template_X), so follow the
// chain and merge child-over-parent the way Oolite's shipdata loader does.
// Cached per game: shipdata never changes at runtime and def() runs every
// frame (the recharge rate), so rebuilding the merge each call is pure waste.
// Callers must treat the result as read-only.
const defCache = new WeakMap();
function def(g, key) {
  let cache = defCache.get(g);
  if (!cache) { cache = new Map(); defCache.set(g, cache); }
  const hit = cache.get(key);
  if (hit) return hit;
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
  cache.set(key, out);
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
    engageDelay: 0, // seconds left before a launch-graced hostile picks a foe
    think: 0,
    strafePhase: Math.random() * Math.PI * 2,
    alive: true,
  };
}

// Which station a system gets (#13), from the real planetinfo.plist: every
// system entry carries station = "coriolis" | "dodecahedron" under the
// "galaxy-1 system" key Oolite's OOSystemDescriptionManager reads.
//
// Docking geometry (#6, #13): each station type carries its own sleeve
// offset from shipdata — a sleeve on the station's +Z face. With easy mode
// off, docking is judged against this frame: approach along its axis and
// under the 120 m/s limit.
// shortcut: both sleeves are judged against the same 130 m lateral budget
// even though their real mouths differ (the meshes span ~121 m and ~105×40 m).
const DOCK_OFFSET = [0, 0, 500.2561]; // Coriolis, from shipdata
const SLOT_HALF = 130;   // half-width of the docking slot, metres
const DOCK_SPEED = 120;  // m/s, the docking limit from the original

function stationKind(g) {
  const info = g.planetinfo && g.planetinfo[`${(g.galaxy || 1) - 1} ${g.systemIndex}`];
  return info && /dodo|dodec/i.test(info.station || '') ? 'dodo' : 'coriolis';
}

const STATIONS = {
  coriolis: { name: 'Coriolis Station', dockOffset: DOCK_OFFSET },
  dodo: { name: 'Dodecahedron Station', dockOffset: [0, 0, 560.3216] }, // shipdata
};

export function spawnStation(g) {
  const kind = stationKind(g);
  const st = makeShip(g, kind, [0, 0, 0], [0, 0, 0, 1],
    { name: STATIONS[kind].name, role: 'station' });
  st.type = 'station';
  st.maxSpeed = 0;
  // The station holds still. Upstream rolls it about the dock axis
  // (station_roll = "0.08"; // 1G at rim, Universe.m:5048), but any spin here
  // sweeps the sleeve past the approach and turns the slot into a moving
  // target — the port's Y-axis spin carried it round at 10 m/s.
  st.spin = 0;
  st.color = BLUE;
  st.dockOffset = STATIONS[kind].dockOffset;
  // Contact is judged against the hull planes, not a sphere (hullTouch): the
  // hull mesh draws every face but the docking one — the faceplate subentity
  // covers it — so the sleeve's own plane caps the mouth.
  const hull = hullPlanes(g, kind);
  if (hull) hull.push([0, 0, 1, st.dockOffset[2]]);
  st.hull = hull;
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
  // Round-robin so every combat ship in the roster actually shows up — but a
  // Navy hunt (#7) puts its stolen ship in the sky instead.
  const key = missionSpawnKey(g) || PIRATE_KEYS[g.pirateSeq++ % PIRATE_KEYS.length];
  const d = def(g, key);
  // Most shipdata templates carry no bounty; scale those by hull energy.
  const bounty = d.bounty || Math.round((d.max_energy || 256) / 5);
  const s = makeShip(g, key, spawnAhead(g, 2000, 4000), [0, 0, 0, 1],
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

// Passenger traffic (#15): the light shuttle runs, non-hostile like the
// haulers but quick to run — see updateNPC for the flee rules.
export function spawnPassenger(g) {
  const key = PASSENGER_KEYS[g.passengerSeq++ % PASSENGER_KEYS.length];
  const s = makeShip(g, key, spawnAhead(g, 1000, 2800), [0, 0, 0, 1],
    { hostile: false, role: 'passenger' });
  g.entities.push(s);
  return s;
}

export function spawnThargoid(g) {
  const d = def(g, 'thargoid');
  const s = makeShip(g, 'thargoid', spawnAhead(g, 2000, 4000), [0, 0, 0, 1],
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

// ---- free-floating loot (#11) ---------------------------------------------
// Kills leave cargo canisters behind and wrecks may leave an escape capsule
// (MISSING-FEATURES.md #11); both are type:'cargo' entities the fuel scoops
// pick up. Upstream models them as ShipEntity debris (cargopod /
// escape-capsule roles) that gets tractored in; here they drift and tumble
// until a scoop collects them.
function tumbleSpin() {
  const a = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return { axis: [a[0] / l, a[1] / l, a[2] / l], rate: (Math.random() - 0.5) * 1.2 };
}

function makeDebris(g, key, name, pos) {
  const t = tumbleSpin();
  return {
    type: 'cargo',
    shipKey: key,
    name,
    role: 'cargo',
    pos: pos.slice(),
    quat: [0, 0, 0, 1],
    vel: [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8],
    radius: radiusOf(g, key),
    tumbleAxis: t.axis,
    tumbleRate: t.rate,
    alive: true,
    color: [1, 1, 1], // unpowered debris reads white on the scanner
  };
}

export function spawnCargo(g, pos, good, qty) {
  const c = makeDebris(g, 'barrel', 'Cargo Canister', pos);
  c.cargo = { good, qty };
  g.entities.push(c);
  return c;
}

export function spawnEscapeCapsule(g, pos) {
  const c = makeDebris(g, 'escapecapsule', 'Escape Capsule', pos);
  c.cargo = null; // the crew is the payload: scooping it is a rescue
  g.entities.push(c);
  return c;
}

// What a wreck leaves behind: one or two canisters of cargo (Oolite's
// releaseCargoPodsDebris rolls likely_cargo per ship) and — when the hull
// says so — an escape capsule (shipdata has_escape_pod: a probability on
// many hulls, yes/no on others). shortcut: the port's canisters carry the
// goods directly instead of Oolite's per-pod commodity rolls.
function releaseDebris(g, ship) {
  const at = () => add(ship.pos, [
    (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120,
  ]);
  const n = 1 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const good = g.goods[Math.floor(Math.random() * g.goods.length)].key;
    spawnCargo(g, at(), good, 1 + Math.floor(Math.random() * 3));
  }
  const ep = def(g, ship.shipKey).has_escape_pod;
  const chance = typeof ep === 'number' ? ep : ep ? 1 : 0;
  if (chance > 0 && Math.random() < chance) spawnEscapeCapsule(g, at());
}

// EQ_FUEL_SCOOPS collects loose cargo too (#11): a canister or escape
// capsule within SCOOP_RANGE ahead of the nose is taken on the spot —
// canisters need hold space, an escape capsule is a rescue and always fits.
function tryScoop(g, debris) {
  if (!g.hasEquipment('EQ_FUEL_SCOOPS')) return;
  const p = g.player;
  const to = sub(debris.pos, p.pos);
  if (len(to) > SCOOP_RANGE) return;
  if (dot(to, quatRotate(p.quat, [0, 0, 1])) <= 0) return; // scoops face forward
  if (debris.cargo) {
    const { good, qty } = debris.cargo;
    if (cargoUsed(g) + qty > p.maxCargo) {
      if (!g.messages.some((m) => m.text === 'HOLD FULL')) pushMessage(g, 'HOLD FULL', RED, 3);
      return;
    }
    p.cargo[good] = (p.cargo[good] || 0) + qty;
    pushMessage(g, `SCOOPED ${qty} ${COMMODITY_NAMES[good] || good}`.toUpperCase(), GREEN, 4);
  } else {
    pushMessage(g, 'ESCAPE POD RESCUED', GREEN, 4);
  }
  g.scoopT = 1;
  debris.alive = false;
}

// ---- asteroids (#12) ------------------------------------------------------
// The real rocks: shipdata oolite_template_asteroid (energy 100, no
// recharge, CLASS_ROCK, bounty 10) on the real oolite_asteroid mesh. Broken
// rocks release ore canisters — see damageRock below.
// Oolite's four ore commodities from trade-goods.plist, the goods a rock can
// be worth (upstream's splinter debris carries CARGO_MINERALS, i.e. minerals;
// see the shortcut in damageRock).
export const ORE_GOODS = ['minerals', 'gold', 'platinum', 'gem_stones'];

export function spawnAsteroid(g, pos) {
  const d = def(g, 'asteroid');
  const t = tumbleSpin();
  const a = {
    type: 'rock',
    shipKey: 'asteroid',
    name: 'Asteroid',
    role: 'asteroid',
    pos: pos.slice(),
    quat: [0, 0, 0, 1],
    vel: [(Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10],
    radius: radiusOf(g, 'asteroid'),
    energy: d.max_energy || 100,
    maxEnergy: d.max_energy || 100,
    bounty: d.bounty || 10, // the "small fee paid for their destruction"
    tumbleAxis: t.axis,
    tumbleRate: t.rate,
    alive: true,
    color: [1, 1, 1], // unpowered rock reads white on the scanner
  };
  g.entities.push(a);
  return a;
}

// The field. shortcut: Oolite's script populator (oolite-populator.js)
// scatters cluster after cluster along the witchpoint lanes from
// scrambledPseudoRandomNumber() seeds; the port puts one deterministic
// handful (1–7 rocks, count from the galaxy/system pair) 8–20 km ahead of
// the nose on launch and arrival, so every system has rocks to mine without
// a script engine.
export function spawnAsteroidField(g) {
  const n = 1 + Math.floor(pseudoRandom((g.galaxy || 1) * 1000 + g.systemIndex) * 7);
  for (let i = 0; i < n; i++) spawnAsteroid(g, spawnAhead(g, 8000, 20000));
  return n;
}

// A rock the player shoots: no kills, no crime, no mission progress — mining
// is not combat. It pays the shipdata bounty and drops ore canisters the
// scoops can collect (#11) and the market buys (#12).
// shortcut: upstream breaks an asteroid into boulders, the boulders into
// splinters, and only scooping a splinter yields 1 t of minerals — three
// stages over as many shots. The port collapses that to one stage: the rock
// releases ore canisters directly, rolled from the four ore goods so mining
// actually pays.
function damageRock(g, rock, amount) {
  rock.energy -= amount;
  g.events.push({ type: 'hit' });
  if (rock.energy > 0) return;
  rock.alive = false;
  g.explosions.push({ pos: rock.pos.slice(), life: 0.9, maxLife: 0.9, size: rock.radius * 3 });
  g.events.push({ type: 'boom' });
  g.player.credits += rock.bounty;
  const n = 1 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const good = ORE_GOODS[Math.floor(Math.random() * ORE_GOODS.length)];
    spawnCargo(g, add(rock.pos, [
      (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120, (Math.random() - 0.5) * 120,
    ]), good, 1 + Math.floor(Math.random() * 3));
  }
  pushMessage(g, `ASTEROID BROKEN — ${rock.bounty} CR, ORE RELEASED`, YELLOW, 5);
}

// The sun: main.js draws it as a sphere at exactly this spot, and the fuel
// scoops only work inside its corona, so the simulation carries the position
// too. Distance is measured from the sun's centre.
export const SUN_POS = [-30000, 25000, -50000];
export const SUN_R = 9000;
// The system's one planet (drawn by main.js): the body the altitude dial
// measures against and the thing you can fly into (#17).
export const PLANET_POS = [0, 6000, 62000];
export const PLANET_R = 9000;
// Oolite's dial top: 40 km above the surface reads full (PLAYER_DIAL_MAX_
// ALTITUDE in PlayerEntity.h).
const DIAL_MAX_ALTITUDE = 40000;
// Cabin temperature (#17): upstream's model — the sun's heat falls off with
// the square of the distance (SUN_TEMPERATURE * (R/d)^2), the cabin gains it
// at SHIP_INSULATION_FACTOR and leaks it at SHIP_COOLING_FACTOR
// (ShipEntity.h). shortcut: no atmosphere term and no heat-insulation gear;
// every ship here insulates at 1.0, so skimming is what cooks you.
const SUN_TEMPERATURE = 1250;
const SHIP_MIN_CABIN_TEMP = 60;
const SHIP_MAX_CABIN_TEMP = 256;
const SHIP_INSULATION_FACTOR = 0.00175;
const SHIP_COOLING_FACTOR = 0.1;
const HEAT_THRESHOLD = 100; // heatInsulation × 100, insulation 1.0
const SUN_CORONA = SUN_R * 1.5; // scoop range from the centre, metres
const SCOOP_RATE = 20;          // fuel units (0.1 ly) per second while skimming
// Cargo pickup range for EQ_FUEL_SCOOPS: a canister this close ahead of the
// nose goes straight into the hold.
// shortcut: Oolite tractors cargo in from further out with an animation and
// only scoops on the ship's underside; the port collects within 200 m in
// front of the nose, which a touch stick can actually line up.
const SCOOP_RANGE = 200;

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
    view: 'front', // camera view (#14): front | aft | port | starboard
    weaponsOnline: true,
    weaponKey: 'WEAPON_BEAM_LASER',
    weaponLabel: 'FORE · BEAM', // HUD line under the crosshair (#16)
    weaponMount: 'fore',        // which mount FIRE shoots: fore | aft (#16)
    lockProgress: 0,            // missile lock on the target, 0..1 (#18)
    lockTarget: null,           // what the lock was built on
    systemIndex: 7, // Lave — the classic starting system
    galaxy: 1,     // which of the 8 galaxies the commander is in (#8)
    galConfirm: false, // a GALACTIC press is armed, waiting for the second (#8)
    witchspace: false, // a mis-jump stranded the ship: no station, thargoids (#10)
    rand: Math.random, // seam for the jump rolls — tests pin it (#10)
    events: [],
    messages: [],
    explosions: [],
    shots: [],
    missiles: [], // missiles in flight (player's and incoming)
    entities: [],
    target: null,
    targetBounty: 0,
    compass: null,
    // The scanner reads the live list; set once here rather than rebuilt as a
    // new closure on every launch and every frame.
    scannerEntities: () => g.entities,
    playerRel: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    altitudeFraction: 1, // metres above the planet over 40 km, 0..1 (#17)
    dialSpeed: 0,
    dialRoll: 0,
    dialPitch: 0,
    kills: 0,
    crime: 0, // legal status points: 0 clear, >= 1 offender, >= 51 fugitive
    commanderName: 'JAMESON', // asked for on a fresh commander, saved (#19)
    trumbles: 0, // the C64's cargo-eating pet, saved (#23)
    mission: missionState(), // the Galactic Navy chain (#7), travels in the save
    pirateSeq: 0,
    traderSeq: 0,
    passengerSeq: 0,
    equipmentTypes: assets.plists.equipment || [], // real equipment.plist rows
    hasEquipment: (key) => !!g.player.equipment[key],

    shipdata: assets.plists.shipdata,
    parsedMeshes: assets.parsedMeshes,
    shipyard: assets.plists.shipyard,
    // per-system world data: which station type the system gets (#13)
    planetinfo: assets.plists.planetinfo || {},
    // the station's commodities, from the real trade-goods.plist
    goods: goodsFrom(assets.plists['trade-goods']),
    markets: {}, // systemIndex -> generated market, mutated by trades
    // what the station still has for sale: every yard hull with shipdata stats
    yardStock: Object.keys(assets.plists.shipyard).filter(
      (k) => assets.plists.shipdata[`oolite_template_${k}`],
    ),

    player: null,
    station: null,
    autoDock: false, // a fitted docking computer is flying the ship
    scooping: false, // the fuel scoops are drinking at the sun
    scoopStatus: 'none', // scoop dial (#11): none | okay | active | full
    scoopT: 0,     // seconds since a canister went into the hold
    spawnTimer: 0,
    weaponCooldown: 0,
    weaponTemp: 0,
    weaponOffline: 0,
    shieldCooldown: 0,
    heatTick: 0,      // seconds until the next overheat hit may land (#17)
    energyLow: false, // the ENERGY LOW warning was already said (#17)
    dockHint: 0,
    easyDock: false,  // start-screen checkbox: assisted docking (off = real, #6)
    launchSeq: 0,     // seconds left of the launch trip (0 = not riding one)
    launchT: 0,       // position along the launch path, 0..1
    launchLen: 0,     // length of the launch path, metres
    dockPhase: 0,     // docking computer's approach phase (real mode, #6)
    dockSwing: null,  // frozen side vector for the autopilot's swing wide
    hitCooldown: 0,   // seconds until the station may hurt you again
    scraped: false,   // easy mode: a crash suspends the assisted dock until
                      // you are clear of the hull again (its speed bleed
                      // would otherwise drop you under the limit on impact)
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
    energy: pd.max_energy || 256,
    fwdShield: BASE_MAX_SHIELD,
    aftShield: BASE_MAX_SHIELD,
    fuel: pd.fuel || 70,
    missiles: pd.max_missiles || 0,
    cabinTemp: 60,
    weaponTemp: 0,
    credits: 100,
    cargo: {},
    equipment: {}, // fitted gear: EQ_ECM, …
    pylons: 0,    // extra missile racks bought beyond the hull's own
    // The two laser mounts (#16): the hull starts with the free forward beam,
    // the aft mount is empty until a laser is fitted there.
    weapons: { fore: 'EQ_WEAPON_BEAM_LASER', aft: null },
    shipKey: 'cobra3-player', // yard key of the starting hull, for trade-in
    alive: true,
  };
  // Hull stats (speed, thrust, rates, radius, hold, energy, shields) come
  // from the template — the same call buyShip makes, so a fresh commander and
  // a bought hull can never drift apart.
  applyEquipmentStats(g);

  syncWeaponState(g); // weaponKey / weaponLabel for the HUD and crosshair
  spawnStation(g);
  return g;
}

export function cargoUsed(g) {
  return Object.values(g.player.cargo).reduce((s, v) => s + v, 0);
}

// ---- views (#14) -----------------------------------------------------------
// The original's four view directions (keys 1–4). This is only the selector;
// the camera turn itself is render.js viewQuat(), applied on top of the
// ship's own attitude so every view keeps the horizon where it belongs.
export const VIEWS = ['front', 'aft', 'port', 'starboard'];

export function setView(g, v) {
  if (VIEWS.includes(v)) g.view = v;
}

export function cycleView(g) {
  g.view = VIEWS[(VIEWS.indexOf(g.view) + 1) % VIEWS.length];
}

// Scanner zoom, 1×…5× — Oolite's z / Z keys (SCANNER_ZOOM_LEVELS 5). dir +1
// wraps 5 → 1 (the source instead ramps back down), dir -1 stops at 1×.
export function zoomScanner(g, dir) {
  const z = g.scannerZoom + dir;
  g.scannerZoom = z > 5 ? 1 : z < 1 ? 1 : z;
  return g.scannerZoom;
}

// Oolite's market generation, from OOCommodities.m: economicBiasForGood gives
// the good's distance from its peak export/import economies (-1 … +1),
// generatePriceForGood / generateQuantityForGood then push the plist average
// away from (price) or towards (quantity) that bias, plus a random term that
// is the difference of two randf() draws. price_average is in decicredits, so
// the price is divided by 10 into the port's credits.
function economicBias(good, economy) {
  const exDiff = Math.abs(economy - good.peak_export) * 2;
  const imDiff = Math.abs(economy - good.peak_import) * 2;
  const distance = (exDiff + imDiff) / 2; // both diffs are even, so exact
  if (exDiff === imDiff) return 0;
  return exDiff > imDiff ? -(1 - imDiff / distance) : 1 - exDiff / distance;
}

const MARKET_CAPACITY = 127; // MAIN_SYSTEM_MARKET_LIMIT

function generateMarket(g) {
  const sys = systemsIn(g)[g.systemIndex];
  return g.goods.map((good, i) => {
    const bias = economicBias(good, sys.economy);
    const s = g.systemIndex * 131 + i * 17;
    const rnd = (a, b) => pseudoRandom(s + a) - pseudoRandom(s + b);
    // trunc() is the C cast in the source: whole decicredits, whole units
    const price = Math.max(0, Math.trunc(
      good.price_average * (1 - good.price_economic * bias
        + good.price_random * rnd(0.1, 0.6))));
    const stock = Math.min(MARKET_CAPACITY, Math.max(0, Math.trunc(
      good.quantity_average * (1 + good.quantity_economic * bias
        + good.quantity_random * rnd(1.1, 1.6)))));
    return { ...good, price: price / 10, stock };
  });
}

// Prices and stock belong to the system: generated once per visit, then moved
// by every trade, the way Oolite's station market keeps its quantities.
// shortcut: the market itself is not saved — a reload regenerates it.
export function marketFor(g) {
  // keyed by galaxy as well: the same index is a different system next door
  // in galaxy 2 (#8)
  const key = (g.galaxy || 1) * 256 + g.systemIndex;
  if (!g.markets[key]) g.markets[key] = generateMarket(g);
  return g.markets[key];
}

export function buyGood(g, key, qty = 1) {
  const row = marketFor(g).find((r) => r.key === key);
  if (!row) return false;
  const free = g.player.maxCargo - cargoUsed(g);
  const n = Math.min(qty, free, row.stock, Math.floor(g.player.credits / row.price));
  if (n <= 0) { pushMessage(g, 'UNABLE TO BUY', RED); return false; }
  g.player.credits -= n * row.price;
  row.stock -= n;
  g.player.cargo[key] = (g.player.cargo[key] || 0) + n;
  g.events.push({ type: 'buy' });
  pushMessage(g, `BOUGHT ${n} ${row.name.toUpperCase()} FOR ${(n * row.price).toFixed(1)} CR`, GREEN);
  return true;
}

export function sellGood(g, key, qty = 1) {
  const row = marketFor(g).find((r) => r.key === key);
  if (!row) { pushMessage(g, 'NOTHING TO SELL', RED); return false; }
  const held = g.player.cargo[key] || 0;
  // the station will not flood its own market: cap the sale at capacity
  const n = Math.min(qty, held, MARKET_CAPACITY - row.stock);
  if (n <= 0) { pushMessage(g, 'NOTHING TO SELL', RED); return false; }
  g.player.cargo[key] = held - n;
  if (!g.player.cargo[key]) delete g.player.cargo[key];
  row.stock += n;
  g.player.credits += n * row.price;
  g.events.push({ type: 'sell' });
  pushMessage(g, `SOLD ${n} ${row.name.toUpperCase()} FOR ${(n * row.price).toFixed(1)} CR`, GREEN);
  // Selling a good that is illegal to export is a crime: Oolite sums
  // exportLegality * quantity (StationEntity legalStatusOfManifest) when you
  // leave with the goods; the port charges the sale, the moment the cargo
  // actually leaves your hold.
  if (row.legality_export > 0) {
    pushMessage(g, `SELLING ${row.name.toUpperCase()} IS ILLEGAL`, RED);
    addCrime(g, row.legality_export * n);
  }
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
  p.missiles = d.max_missiles || 0;
  p.fuel = d.fuel || 70; // the new hull ships with a full tank
  // hull stats first, then the fitted gear that adds to them (the cargo bay
  // and the shield booster follow the commander to the new ship)
  applyEquipmentStats(g);
  p.energy = p.maxEnergy;
  g.yardStock = g.yardStock.filter((k) => k !== key);
  pushMessage(g, `${shipName(g, key).toUpperCase()} BOUGHT — TRADE-IN ${tradeIn} CR`, GREEN, 6);
  g.events.push({ type: 'buy' });
  return true;
}

// ---- equipment -------------------------------------------------------------
// Sold at the station the way the shipyard sells hulls, at the real
// equipment.plist prices, listed by the plist's own techlevel.
// shortcut: no ship-compatibility gating — everything on the list fits.
const EQUIPMENT_KEYS = [
  'EQ_CARGO_BAY', 'EQ_MISSILE', 'EQ_ECM',
  'EQ_WEAPON_PULSE_LASER', 'EQ_WEAPON_BEAM_LASER',
  'EQ_FUEL_SCOOPS', 'EQ_ESCAPE_POD', 'EQ_ENERGY_UNIT', 'EQ_DOCK_COMP',
  'EQ_GAL_DRIVE', 'EQ_FUEL_INJECTION', 'EQ_SHIELD_BOOSTER',
  'EQ_WEAPON_MINING_LASER',
];

// Fitted gear that changes the ship's numbers. Oolite applies the three
// stat items in addEquipmentItem / oolite-equipment-control.js from the same
// equipment.plist script_info values; here they are re-derived from the hull
// and the equipment, so a hull swap at the shipyard keeps them.
const EXTRA_CARGO = 15;           // shipdata extra_cargo default, tonnes
const SHIELD_BOOST = 128;         // equipment.plist oolite_shield_increase
const ENERGY_RECHARGE_MULT = 1.8; // equipment.plist oolite_energy_recharge_multiplier
const BASE_MAX_SHIELD = 150;

export function applyEquipmentStats(g) {
  const p = g.player;
  const d = def(g, p.shipKey);
  const eq = p.equipment;
  // The hull's own flight numbers. One implementation: createGame() and
  // buyShip() both come through here, so the two can never disagree.
  p.maxSpeed = d.max_flight_speed || 300;
  p.thrust = d.thrust || 30;
  p.pitchRate = d.max_flight_pitch || 1;
  p.rollRate = d.max_flight_roll || 2;
  p.yawRate = (d.max_flight_pitch || 1) / 4; // shortcut: Oolite derives yaw from pitch
  p.radius = radiusOf(g, p.shipKey);
  p.maxCargo = (d.max_cargo || 20) + (eq.EQ_CARGO_BAY ? EXTRA_CARGO : 0);
  p.maxEnergy = d.max_energy || 256;
  p.maxShield = BASE_MAX_SHIELD + (eq.EQ_SHIELD_BOOSTER ? SHIELD_BOOST : 0);
  p.energy = Math.min(p.energy, p.maxEnergy);
  p.fwdShield = Math.min(p.fwdShield, p.maxShield);
  p.aftShield = Math.min(p.aftShield, p.maxShield);
}

// The row's hint column: what the item does before it is bought. Laser rows
// do not use it — their note reads out the two mounts instead (#16).
const EQUIPMENT_NOTES = {
  EQ_CARGO_BAY: `+${EXTRA_CARGO} t hold`,
  EQ_ENERGY_UNIT: `recharge ×${ENERGY_RECHARGE_MULT}`,
  EQ_SHIELD_BOOSTER: `+${SHIELD_BOOST} shields`,
  EQ_DOCK_COMP: 'auto-dock on DOCK',
  EQ_FUEL_SCOOPS: 'skim the sun',
  EQ_ESCAPE_POD: 'survives destruction',
  EQ_GAL_DRIVE: 'one jump to the next galaxy',
  EQ_FUEL_INJECTION: 'boost ×2.5',
};

// Which laser sits in which mount (#16) — the note column of every laser row.
function mountNote(p) {
  const at = (m) => {
    const spec = LASERS[(p.weapons || {})[m]];
    return spec ? spec.name.replace(' Laser', '') : '—';
  };
  return `fore: ${at('fore')} · aft: ${at('aft')}`;
}

export function missileCap(g) {
  // the hull's built-in pylons plus every extra rack bought at the station
  return Math.max(def(g, g.player.shipKey).max_missiles || 0, g.player.pylons || 0);
}

export function equipmentFor(g) {
  const stock = g.equipmentTypes || [];
  const p = g.player;
  return EQUIPMENT_KEYS.map((key) => {
    const e = stock.find((row) => row[3] === key);
    if (!e) return null;
    const row = { key, name: e[2], price: e[1] };
    if (key === 'EQ_MISSILE') {
      // A missile fills a free pylon; past the hull's own pylons it brings its
      // own rack, so the row never runs out of something to sell.
      // shortcut: Oolite hulls have fixed pylons and sell no extra racks.
      return { ...row, note: `pylons ${p.missiles}/${missileCap(g)}`, can: true };
    }
    if (LASERS[key]) {
      // Two buttons, one per mount (#16): FORE fits it forward, AFT rearward,
      // each disabled where that laser already sits. can stays true — the
      // price and the mount are checked by buyEquipment itself.
      return { ...row, laser: true, note: mountNote(p),
        fore: p.weapons.fore === key, aft: p.weapons.aft === key, can: true };
    }
    const owned = !!p.equipment[key];
    return { ...row, note: owned ? 'fitted' : EQUIPMENT_NOTES[key] || '', can: !owned };
  }).filter(Boolean);
}

// Fitting a laser (#16): the shop's FORE / AFT button picks the mount. A
// mount that already holds a laser has it replaced.
// shortcut: the port does not sell the replaced weapon back.
function buyLaser(g, key, mount) {
  const p = g.player;
  const m = mount === 'aft' ? 'aft' : 'fore';
  if (p.weapons[m] === key) return false; // already fitted there
  const row = equipmentFor(g).find((r) => r.key === key);
  if (!row) return false;
  if (p.credits < row.price) { pushMessage(g, 'INSUFFICIENT CREDITS', RED); return false; }
  p.credits -= row.price;
  p.weapons[m] = key;
  g.weaponMount = m; // prime what was just fitted, so the next shot is it
  syncWeaponState(g);
  g.events.push({ type: 'buy' });
  pushMessage(g, `${row.name.toUpperCase()} FITTED ${m.toUpperCase()}`, GREEN);
  return true;
}

export function buyEquipment(g, key, mount) {
  if (LASERS[key]) return buyLaser(g, key, mount);
  const row = equipmentFor(g).find((r) => r.key === key);
  const p = g.player;
  if (!row || !row.can) return false;
  if (p.credits < row.price) { pushMessage(g, 'INSUFFICIENT CREDITS', RED); return false; }
  p.credits -= row.price;
  let racked = true;
  if (key === 'EQ_MISSILE') {
    const cap = missileCap(g);
    p.missiles++;
    racked = p.missiles <= cap;
    if (!racked) p.pylons = Math.max(p.pylons || 0, p.missiles);
  } else {
    p.equipment[key] = true;
    applyEquipmentStats(g);
  }
  g.events.push({ type: 'buy' });
  pushMessage(g, key === 'EQ_MISSILE'
    ? (racked ? 'MISSILE FITTED' : 'MISSILE + PYLON FITTED')
    : `${row.name.toUpperCase()} FITTED`, GREEN);
  return true;
}

// --- real docking (MISSING-FEATURES #6) -----------------------------------
// The slot frame and its constants (DOCK_OFFSET, SLOT_HALF, DOCK_SPEED) live
// with the station types above: the sleeve is on the station's +Z face, so
// dockFrame() reads the offset off the station.

function dockFrame(g) {
  const st = g.station;
  return {
    pos: add(st.pos, quatRotate(st.quat, st.dockOffset || DOCK_OFFSET)),
    normal: quatRotate(st.quat, [0, 0, 1]), // out of the slot
    up: quatRotate(st.quat, [0, 1, 0]),     // rolls with the station
  };
}

// Where the ship sits relative to the slot: axial > 0 is outside the mouth,
// lat is how far off the slot's axis, facing is how straight the nose points
// in (1 = nose along the axis). Roll is not judged — the original has no
// roll gate either (DockEntity shipIsInDockingCorridor:).
function lane(g) {
  const f = dockFrame(g);
  const rel = sub(g.player.pos, f.pos);
  const axial = dot(rel, f.normal);
  return {
    ...f,
    axial,
    lat: len(sub(rel, scale(f.normal, axial))),
    facing: dot(quatRotate(g.player.quat, [0, 0, 1]), scale(f.normal, -1)),
  };
}

const linedUp = (l) => l.lat < SLOT_HALF && l.facing > 0.9;

// --- station contact ---------------------------------------------------------
// The station hull as inward half-spaces in its own frame. Both station
// meshes are convex, so their facet planes bound them exactly — flipped to
// keep the station's centre inside, since a mesh face can wind either way.
// shortcut: the plane set is built once per station; a concave station mesh
// would need the real convex-hull test instead.
function hullPlanes(g, kind) {
  const m = g.parsedMeshes && g.parsedMeshes[kind];
  if (!m || !m.groups) return null;
  const planes = [];
  for (const grp of m.groups) {
    const P = grp.positions;
    for (let t = 0; t < P.length; t += 9) {
      const ax = P[t], ay = P[t + 1], az = P[t + 2];
      const ux = P[t + 3] - ax, uy = P[t + 4] - ay, uz = P[t + 5] - az;
      const vx = P[t + 6] - ax, vy = P[t + 7] - ay, vz = P[t + 8] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz);
      if (L < 1e-6) continue;
      nx /= L; ny /= L; nz /= L;
      let d = nx * ax + ny * ay + nz * az;
      if (d < 0) { nx = -nx; ny = -ny; nz = -nz; d = -d; }
      planes.push([nx, ny, nz, d]);
    }
  }
  return planes.length ? planes : null;
}

// Contact: the ship's radius expands every plane. The old test was a sphere
// of the mesh's vertex radius — 703 m on the Coriolis, whose faces sit at
// 500 m — so the "hull" reached 200 m past the docking face and bounced
// clean approaches off empty space before they reached the slot.
function hullTouch(st, pos, pr) {
  if (!st.hull) return dist(st.pos, pos) < st.radius + pr;
  const rel = quatRotate(quatConjugate(st.quat), sub(pos, st.pos));
  for (const h of st.hull) {
    if (h[0] * rel[0] + h[1] * rel[1] + h[2] * rel[2] > h[3] + pr) return false;
  }
  return true;
}

// The shove after a scrape: out through the face the ship is actually
// touching — the shallowest exit — so clipping the rim beside the slot throws
// you back out of the mouth instead of through the hull.
function hullExit(st, pos, pr) {
  const rel = quatRotate(quatConjugate(st.quat), sub(pos, st.pos));
  let bi = 0, bp = Infinity;
  for (let i = 0; i < st.hull.length; i++) {
    const h = st.hull[i];
    const pen = h[3] + pr - (h[0] * rel[0] + h[1] * rel[1] + h[2] * rel[2]);
    if (pen < bp) { bp = pen; bi = i; }
  }
  const h = st.hull[bi];
  return add(st.pos, quatRotate(st.quat, [
    rel[0] + h[0] * (bp + 1), rel[1] + h[1] * (bp + 1), rel[2] + h[2] * (bp + 1),
  ]));
}

// A rough approach shreds the hold as well as the hull: one tonne of a
// random good goes out through the breach.
function loseCargo(g) {
  const keys = Object.keys(g.player.cargo);
  if (!keys.length) return;
  const k = keys[Math.floor(Math.random() * keys.length)];
  g.player.cargo[k] -= 1;
  if (g.player.cargo[k] <= 0) delete g.player.cargo[k];
  pushMessage(g, 'CARGO LOST IN THE COLLISION', RED, 5);
}

// Roll the ship onto a reference up (the station's) about its own nose —
// the docking computer's way of flying in level with the slot.
function matchRoll(e, upTarget, dt, rate) {
  const fwd = quatRotate(e.quat, [0, 0, 1]);
  const up = quatRotate(e.quat, [0, 1, 0]);
  const have = sub(up, scale(fwd, dot(up, fwd)));
  const want = sub(upTarget, scale(fwd, dot(upTarget, fwd)));
  const hl = len(have);
  const wl = len(want);
  if (hl < 1e-4 || wl < 1e-4) return; // nose pole: roll means nothing there
  const hn = scale(have, 1 / hl);
  const wn = scale(want, 1 / wl);
  const axis = cross(hn, wn);
  const axl = len(axis);
  let ang;
  if (axl < 1e-5) {
    if (dot(hn, wn) > 0) return; // already rolled in
    ang = Math.PI;               // exactly inverted: roll the long way round
  } else {
    ang = Math.atan2(axl, dot(hn, wn));
  }
  const a = axl < 1e-5 ? fwd : scale(axis, 1 / axl);
  e.quat = quatNormalize(quatMul(quatAxisAngle(a[0], a[1], a[2], Math.min(ang, rate * dt)), e.quat));
}

// Trumbles (#23): the C64's novelty pet that eats your cargo. One may crawl
// aboard when you dock with a hold that has something in it (1/8), and from
// then on every arrival costs it a tonne. shortcut: no multiplying litters
// and no sprite — one trumble, counted on the status screen.
const TRUMBLE_CHANCE = 1 / 8;

function boardTrumble(g) {
  if (g.trumbles > 0 || cargoUsed(g) <= 0 || g.rand() >= TRUMBLE_CHANCE) return;
  g.trumbles = 1;
  pushMessage(g, 'A TRUMBLE CRAWLS ABOARD', YELLOW, 6);
}

function feedTrumbles(g) {
  if (!g.trumbles) return;
  const c = g.player.cargo;
  const key = c.food > 0 ? 'food' : Object.keys(c).find((k) => c[k] > 0);
  if (!key) return; // an empty hold cannot lose cargo to a hungry pet
  c[key] -= 1;
  if (c[key] <= 0) delete c[key];
  pushMessage(g, `THE TRUMBLE ATE 1 t OF ${key.toUpperCase()}`, YELLOW, 5);
}

export function dock(g) {
  g.phase = 'docked';
  g.hudVisible = false;
  g.alert = 'green';
  g.autoDock = false; // whatever was flying the ship has let go
  // Simplest rule for clearing a record: docking forgives every crime.
  if (g.crime > 0) {
    g.crime = 0;
    pushMessage(g, 'LEGAL STATUS CLEAR — DOCKED', GREEN, 6);
  }
  g.events.push({ type: 'docking' });
  pushMessage(g, `DOCKED AT ${systemsIn(g)[g.systemIndex].name}`, GREEN, 6);
  // docking delivers a carried Navy mission (#7)
  const missionMsg = missionOnDock(g);
  if (missionMsg) pushMessage(g, missionMsg, GREEN, 6);
  boardTrumble(g); // the pet may be waiting at the airlock (#23)
}

// The launch trip (MISSING-FEATURES #6): ten seconds riding out through the
// station's force-field sleeve on a fixed path instead of teleporting. The
// path lives in the station's frame — it turns with the slot it leaves — and
// ends framed the way the old launch framed you: station ahead of the nose,
// offset far enough aside that the flight path clears the hull.
const LAUNCH_TIME = 10; // seconds from the tube to open space
const LAUNCH_PATH = [
  [0, 0, 300],      // inside the station, at the slot
  [0, 0, 1100],     // straight out along the tube
  [-1200, 0, 3300], // swing wide so the path clears the hull
  [-1200, 0, 2400], // framed: station ahead-left of the nose, 1200 m of clearance
];

// Cubic Bezier on the path's control points, and its derivative.
function bez(P, t) {
  const u = 1 - t;
  return add(
    add(scale(P[0], u * u * u), scale(P[1], 3 * u * u * t)),
    add(scale(P[2], 3 * u * t * t), scale(P[3], t * t * t)),
  );
}
function bezDeriv(P, t) {
  const u = 1 - t;
  return add(
    add(scale(sub(P[1], P[0]), 3 * u * u), scale(sub(P[2], P[1]), 6 * u * t)),
    scale(sub(P[3], P[2]), 3 * t * t),
  );
}
function curveLength(P, samples) {
  let total = 0;
  let prev = bez(P, 0);
  for (let i = 1; i <= samples; i++) {
    const cur = bez(P, i / samples);
    total += dist(prev, cur);
    prev = cur;
  }
  return total;
}

// Hand over to ordinary flight, with the framing values the old launch used.
function finishLaunch(g) {
  g.launchSeq = 0;
  g.player.speed = 150;
  g.player.throttle = 0.45;
  pushMessage(g, 'LAUNCHED — GOOD LUCK, COMMANDER', GREEN, 6);
  if (!g.entities.some((e) => e.type === 'ship' && e.hostile)) {
    const first = spawnPirate(g);
    first.engageDelay = LAUNCH_GRACE;
    first.fireCooldown = LAUNCH_FIRE_DELAY + Math.random() * LAUNCH_FIRE_DELAY;
  }
  // Entities survive docking, so an unguarded spawn would stack one more
  // viper on every dock/launch cycle — same guard as the pirate above.
  if (!g.entities.some((e) => e.role === 'police')) spawnPolice(g);
  // and one field of rocks per outing (#12)
  if (!g.entities.some((e) => e.type === 'rock')) spawnAsteroidField(g);
}

// Instant launch: teleport onto the launch framing and fly on. Tests, the
// smokes and ?autostart use it; the UI buttons take the ten-second ride.
export function launch(g) {
  const st = g.station;
  // Start off to one side so the station drifts past ahead of the canopy.
  // Straight-out (+Z) put it directly behind the nose, where it can never
  // be seen; the lateral offset also means the flight path clears it by ~500 m.
  g.player.pos = [st.pos[0] + 1200, st.pos[1], st.pos[2] - 2966];
  g.player.quat = [0, 0, 0, 1];
  g.phase = 'flight';
  g.hudVisible = true;
  finishLaunch(g);
}

// The watched launch: stepGame rides g.launchSeq down, then finishLaunch
// takes over. The player watches; the stick and every other input are dead.
export function launchTrip(g) {
  const st = g.station;
  g.phase = 'flight';
  g.hudVisible = true;
  g.compass = st;
  g.launchSeq = LAUNCH_TIME;
  g.launchT = 0;
  g.launchLen = curveLength(LAUNCH_PATH, 128);
  const p = g.player;
  p.pos = add(st.pos, bez(LAUNCH_PATH, 0));
  const up = quatRotate(st.quat, [0, 1, 0]);
  const fwd = quatRotate(st.quat, norm(bezDeriv(LAUNCH_PATH, 0)));
  p.quat = quatFromBasis(cross(up, fwd), up, fwd);
  p.speed = g.launchLen / LAUNCH_TIME;
  p.throttle = Math.min(1, p.speed / p.maxSpeed);
}

// One frame of the ride: the ship rides the path at a constant speed (arc
// length / time), and nothing can hurt it until finishLaunch hands the
// controls back.
function stepLaunch(g, dt) {
  const st = g.station;
  const p = g.player;
  st.quat = quatNormalize(quatMul(quatAxisAngle(0, 1, 0, st.spin * dt), st.quat));
  g.launchSeq -= dt;
  const ds = (g.launchLen / LAUNCH_TIME) * dt;
  const d = bezDeriv(LAUNCH_PATH, g.launchT);
  g.launchT = Math.min(1, g.launchT + ds / (len(d) || 1));
  p.pos = add(st.pos, quatRotate(st.quat, bez(LAUNCH_PATH, g.launchT)));
  const up = quatRotate(st.quat, [0, 1, 0]);
  const fwd = quatRotate(st.quat, norm(bezDeriv(LAUNCH_PATH, g.launchT)));
  p.quat = quatFromBasis(cross(up, fwd), up, fwd);
  p.vel = scale(fwd, p.speed);

  // The HUD plumbing stepGame normally does, on the far side of its return.
  g.dialSpeed = p.maxSpeed ? p.speed / p.maxSpeed : 0;
  const ex = quatRotate(p.quat, [1, 0, 0]);
  const ey = quatRotate(p.quat, [0, 1, 0]);
  const ez = quatRotate(p.quat, [0, 0, 1]);
  g.playerRel.set([ex[0], ex[1], ex[2], ey[0], ey[1], ey[2], ez[0], ez[1], ez[2]]);
  for (const m of g.messages) m.life -= dt;
  g.messages = g.messages.filter((m) => m.life > 0);
  if (g.launchSeq <= 0) finishLaunch(g);
}

// selected: a system index from the short-range chart; without one the jump
// goes to the nearest system in range, as before.
//
// Witchspace interception (#10): the original's mis-jump chance is 0.78% per
// jump — MJP is called from TT18 instead of arriving (elite.bbcelite.com) —
// and it strands you with the fuel already spent and three Thargoids aboard.
// shortcut: the probability has no published source beyond that 0.78%, so it
// is taken literally; both rolls go through g.rand, a seam the tests pin.
const WITCHSPACE_CHANCE = 1 / 128;         // 0.78%, the original's odds
const WITCHSPACE_LUCK = 0.25;              // a dry escape roll (shortcut)
const WITCHSPACE_LUCK_INJECTORS = 0.5;     // … doubled with the injectors

export function jump(g, selected) {
  if (g.phase !== 'flight') return false;
  const systems = systemsIn(g);
  const from = systems[g.systemIndex];
  // Oolite rule: any system within 7 ly, and the jump costs the distance in
  // light years of fuel (fuel is in tenths of a ly) — see PlayerEntity.m
  // fuelRequiredForJump / maxHyperspaceDistance.
  const reach = Math.min(7, g.player.fuel / 10);
  let target = -1;
  let cost = 0;
  if (selected !== undefined) {
    // Chart selection: same 7 ly ring and same fuel cost, to the chosen
    // system instead of the nearest one.
    const sys = systems[selected];
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
    for (let step = 1; step < systems.length; step++) {
      const idx = (from.index + step) % systems.length;
      const ly = distanceLy(from, systems[idx]);
      if (ly <= reach) { target = idx; cost = Math.max(1, Math.round(ly * 10)); break; }
    }
    if (target < 0) {
      // Stranded with a tank that buys nothing: the jump itself is the way
      // out of witchspace — one luck roll per press (see witchspaceLuck).
      if (g.witchspace) return witchspaceLuck(g, systems);
      pushMessage(g, g.player.fuel < 70 ? 'INSUFFICIENT FUEL FOR JUMP' : 'NO SYSTEM IN RANGE', RED);
      return false;
    }
  }
  g.player.fuel -= cost;
  g.systemIndex = target;
  g.galConfirm = false; // a jump cancels any armed galactic press
  g.events.push({ type: 'jump' });
  if (!g.witchspace && g.rand() < WITCHSPACE_CHANCE) {
    enterWitchspace(g); // intercepted: no arrival, no station, three Thargoids
  } else {
    arriveClean(g);
    pushMessage(g, `WITCHSPACE — ARRIVED AT ${systems[g.systemIndex].name}`, GREEN, 6);
  }
  // a carried Navy mission counts this jump (#7)
  const missionMsg = missionOnJump(g);
  if (missionMsg) pushMessage(g, missionMsg, GREEN, 6);
  return true;
}

// The ZX-original in-system J-drive (#20): a fast hop along the nose that
// refuses to fire — with an audible warning — when a ship, the station, the
// planet or the sun sits near the departure or the arrival point.
// shortcut: the ZX drive's exact range and failure distances are not
// published, so the port picks clear numbers and checks both ends of the hop.
const JDRIVE_HOP = 20000;  // metres covered in one hop
const JDRIVE_CLEAR = 3000; // metres of clear space both ends must have

export function jdrive(g) {
  if (g.phase !== 'flight') return false;
  const p = g.player;
  const fwd = quatRotate(p.quat, [0, 0, 1]);
  const to = add(p.pos, scale(fwd, JDRIVE_HOP));
  const blocked = (pt) =>
    g.entities.some((e) => e.type !== 'cargo' && dist(e.pos, pt) < e.radius + JDRIVE_CLEAR)
    || dist(pt, PLANET_POS) < PLANET_R + JDRIVE_CLEAR
    || dist(pt, SUN_POS) < SUN_R + JDRIVE_CLEAR;
  if (blocked(p.pos) || blocked(to)) {
    pushMessage(g, 'J-DRIVE BLOCKED — OBSTRUCTION NEARBY', YELLOW, 4);
    g.events.push({ type: 'jdrive' }); // the original's audible warning
    return false;
  }
  p.pos = to;
  pushMessage(g, `J-DRIVE HOP — ${JDRIVE_HOP / 1000} KM`, GREEN, 3);
  g.events.push({ type: 'jdriveHop' });
  return true;
}

// The original's MJP: a mis-jump strands you in witchspace — no sun, no
// planet, no station, three Thargoids (MJP loops GTHG until it has spawned
// three) and the jump's fuel already spent (Wikipedia). shortcut: the port
// keeps the destination system's index as your position, so the chart has
// coordinates to jump from — the original's position is "in-between systems".
function enterWitchspace(g) {
  g.witchspace = true;
  g.autoDock = false; // nothing is flying the ship any more
  g.entities = [];
  g.shots = [];
  g.explosions = [];
  g.missiles = [];
  g.target = null;
  g.station = null;
  for (let i = 0; i < 3; i++) spawnThargoid(g);
  pushMessage(g, 'MIS-JUMP — WITCHSPACE', RED, 6);
  pushMessage(g, 'NO STATION — JUMP TO ESCAPE', YELLOW, 6);
}

// In witchspace with a tank that buys nothing: one luck roll per JUMP press.
// The injectors tap the witch-drive's own fuel, so they double the chance.
// shortcut: the original strands you until you reload (and its escape pod is
// fatal here) — the port keeps the fatal pod but always leaves a way out, so
// an auto-save-only browser session cannot dead-end.
function witchspaceLuck(g, systems) {
  const chance = g.player.equipment.EQ_FUEL_INJECTION
    ? WITCHSPACE_LUCK_INJECTORS : WITCHSPACE_LUCK;
  if (g.rand() >= chance) {
    pushMessage(g, 'STILL LOST IN WITCHSPACE', RED, 5);
    return false;
  }
  // tumble out into the nearest system, whatever the range cost would be
  const from = systems[g.systemIndex];
  let target = -1;
  let best = Infinity;
  for (const s of systems) {
    if (s.index === from.index) continue;
    const d = distanceLy(from, s);
    if (d < best) { best = d; target = s.index; }
  }
  g.systemIndex = target;
  g.events.push({ type: 'jump' });
  arriveClean(g);
  pushMessage(g, `LUCKY BOUNCE OUT OF WITCHSPACE — ${systems[target].name}`, GREEN, 6);
  return true;
}

// The far side of any jump: a fresh sky with the station framed ahead of the
// nose. jump() and the galactic jump both land this way; it is also the way
// out of witchspace (#10).
function arriveClean(g) {
  g.witchspace = false;
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
  spawnPassenger(g); // the hauler and the shuttle of the local traffic (#15)
  spawnPolice(g);
  spawnAsteroidField(g); // a fresh sky has fresh rocks to mine (#12)
  feedTrumbles(g); // every arrival costs the trumble a tonne (#23)
}

// --- galactic hyperspace (MISSING-FEATURES #8) -----------------------------
// The original's Ghy routine (elite.bbcelite.com): a one-shot drive, no fuel
// cost, galaxy 8 wraps round to 1, you land on the system nearest the
// galaxy's centre coordinates (96, 96), and changing galaxy clears the
// criminal record (Ghy sets FIST to 0). The chart's GALACTIC button presses
// this twice, so a 50 000 CR drive is never spent by one stray tap.
export function galacticJump(g) {
  if (g.phase !== 'flight') return false;
  if (!g.player.equipment.EQ_GAL_DRIVE) {
    pushMessage(g, 'NO GALACTIC DRIVE FITTED', RED);
    return false;
  }
  if (!g.galConfirm) {
    g.galConfirm = true;
    pushMessage(g,
      `GALACTIC HYPERSPACE — PRESS AGAIN TO ENTER GALAXY ${(g.galaxy & 7) + 1}`,
      YELLOW, 6);
    return false;
  }
  const systems = galaxySystems((g.galaxy & 7) + 1);
  // arrive at the system nearest (96, 96), the way the original's TT111
  // resolves its arrival coordinates
  let target = 0;
  let best = Infinity;
  for (const s of systems) {
    const d = distanceLy({ x: 96, y: 96 }, s);
    if (d < best) { best = d; target = s.index; }
  }
  delete g.player.equipment.EQ_GAL_DRIVE; // one-shot: Ghy zeroes GHYP
  g.galConfirm = false;
  if (g.crime > 0) pushMessage(g, 'LEGAL STATUS CLEAR — NEW GALAXY', GREEN, 6);
  g.crime = 0;
  g.galaxy = (g.galaxy & 7) + 1;
  g.systemIndex = target;
  g.events.push({ type: 'jump' });
  arriveClean(g);
  pushMessage(g,
    `GALACTIC HYPERSPACE — ARRIVED IN GALAXY ${g.galaxy} AT ${systems[target].name}`,
    GREEN, 6);
  // a carried Navy mission counts this jump too (#7)
  const missionMsg = missionOnJump(g);
  if (missionMsg) pushMessage(g, missionMsg, GREEN, 6);
  return true;
}

// ---- combat ---------------------------------------------------------------
// Lasers (#16): the port's per-shot numbers in the shape of the
// equipment.plist weapon_info rows — range, damage per shot, seconds between
// shots and the heat each shot adds. shortcut: upstream's beam laser is a
// 0.1 s / 6 damage repeater and this port has always fired one 60-damage
// shot every 0.45 s, so the three rows keep that scale and take their
// differences from the plist's own ordering: the pulse hits harder and
// slower, the mining laser hits hardest and runs cool, the beam is the fast
// one. The Military Laser (60 000 CR, 30 km range) is deliberately not sold:
// at 12 damage every 0.1 s it outranges and out-damages everything for a
// price a commander can earn in an afternoon (see MISSING-FEATURES.md #16).
export const LASERS = {
  EQ_WEAPON_PULSE_LASER: {
    name: 'Pulse Laser', crosshair: 'WEAPON_PULSE_LASER',
    range: 6000, damage: 90, cooldown: 0.9, temp: 70,
  },
  EQ_WEAPON_BEAM_LASER: {
    name: 'Beam Laser', crosshair: 'WEAPON_BEAM_LASER',
    range: 6000, damage: 60, cooldown: 0.45, temp: 55,
  },
  EQ_WEAPON_MINING_LASER: {
    name: 'Mining Laser', crosshair: 'WEAPON_MINING_LASER',
    range: 12500, damage: 120, cooldown: 2.5, temp: 10,
  },
};
export const LASER_KEYS = Object.keys(LASERS);

// What FIRE shoots (#16): the primed mount, forward or aft. weaponKey picks
// the crosshair art out of crosshairs.plist, weaponLabel is the HUD line
// under the crosshair that reads the choice back.
export function syncWeaponState(g) {
  const spec = LASERS[g.player.weapons[g.weaponMount]];
  g.weaponKey = spec ? spec.crosshair : 'WEAPON_NONE';
  const short = spec ? spec.name.split(' ')[0].toUpperCase() : 'NO LASER';
  g.weaponLabel = `${g.weaponMount.toUpperCase()} · ${short}`;
}

// T in flight, the LASER touch button: swap what the gun is primed on.
export function cycleLaserMount(g) {
  g.weaponMount = g.weaponMount === 'fore' ? 'aft' : 'fore';
  syncWeaponState(g);
  const spec = LASERS[g.player.weapons[g.weaponMount]];
  pushMessage(g,
    `LASER: ${g.weaponMount.toUpperCase()} — ${spec ? spec.name.toUpperCase() : 'NOTHING FITTED'}`,
    spec ? YELLOW : RED, 4);
  g.events.push({ type: 'beep' });
}

function fireLaser(g) {
  const p = g.player;
  const mount = g.weaponMount; // 'fore' | 'aft' (#16)
  const spec = LASERS[p.weapons[mount]];
  if (!spec) {
    // rate-limited so a held fire button cannot spam the message
    if (g.weaponCooldown <= 0) {
      pushMessage(g, `NO LASER FITTED (${mount.toUpperCase()})`, RED, 3);
      g.weaponCooldown = 1;
    }
    return;
  }
  // the aft mount fires astern — that is what a rear laser is for (#16)
  const fwd = quatRotate(p.quat, mount === 'aft' ? [0, 0, -1] : [0, 0, 1]);
  const origin = add(p.pos, scale(fwd, p.radius));
  const range = spec.range;
  let best = null;
  let bestT = range;
  for (const e of g.entities) {
    if (!e.alive || (e.type !== 'ship' && e.type !== 'rock')) continue;
    const to = sub(e.pos, origin);
    const t = dot(to, fwd);
    if (t <= 0 || t > bestT) continue;
    const closest = sub(to, scale(fwd, t));
    if (len(closest) <= e.radius * 1.6) { best = e; bestT = t; }
  }
  const end = add(origin, scale(fwd, best ? bestT : range));
  g.shots.push({ from: origin, to: end, life: 0.12, hostile: false, hit: !!best });
  g.events.push({ type: 'laser' });
  g.weaponCooldown = spec.cooldown;
  g.weaponTemp = Math.min(300, g.weaponTemp + spec.temp);
  if (g.weaponTemp >= 256) {
    g.weaponOffline = 2;
    g.weaponsOnline = false;
    pushMessage(g, 'LASER OVERHEATED', RED);
  }
  if (best) {
    // the mining laser's 120 is what one-shots the 100-energy rock (#12)
    if (best.type === 'rock') damageRock(g, best, spec.damage);
    else damageShip(g, best, spec.damage, true);
  }
}

function damageShip(g, ship, amount, fromPlayer, attacker) {
  // Crimes: hit the police anywhere, or any innocent ship inside the
  // station's protection zone (MISSING-FEATURES.md #2). Firing crime is
  // charged once per innocent target, not on every beam tick.
  if (fromPlayer && !ship.hostile && !ship.playerAttacked
      && (ship.role === 'police' || inProtectionZone(g, ship.pos))) {
    ship.playerAttacked = true;
    addCrime(g, CRIME_FIRING);
  }
  // Peaceful shipping runs from whoever hit it (#15) — haulers once they are
  // hit, shuttles also on sight (see updateNPC).
  if (!ship.hostile && PEACEFUL_ROLES.includes(ship.role)) {
    ship.fleeing = true;
    ship.fleeFrom = attacker || g.player;
  }
  ship.energy -= amount;
  g.events.push({ type: 'hit' });
  if (ship.energy > 0) return;
  ship.alive = false;
  g.explosions.push({ pos: ship.pos.slice(), life: 0.9, maxLife: 0.9, size: ship.radius * 3 });
  g.events.push({ type: 'boom' });
  releaseDebris(g, ship); // canisters and an escape capsule for the scoops (#11)
  if (fromPlayer) {
    g.kills++;
    if (ship.role === 'trader') addCrime(g, CRIME_TRADER_KILL);
    else if (ship.role === 'police') addCrime(g, CRIME_POLICE_KILL);
    g.player.credits += ship.bounty;
    pushMessage(g, `SHIP DESTROYED — ${ship.bounty} CR BOUNTY`, YELLOW, 6);
    const missionMsg = missionOnKill(g, ship);
    if (missionMsg) pushMessage(g, missionMsg, GREEN, 6);
  } else if (PEACEFUL_ROLES.includes(ship.role)) {
    // a kill the commander did not make: no bounty, no crime, but the sky
    // reports the shipping it just lost (#15)
    pushMessage(g, `${String(ship.name || ship.shipKey).toUpperCase()} DESTROYED`, RED, 4);
  }
}

// ---- escape pod ------------------------------------------------------------
// The pod tows the commander back to the station: the ship and everything
// fitted to it survive, the manifest does not (MISSING-FEATURES.md #5).
function escapePod(g) {
  const p = g.player;
  p.cargo = {};
  p.energy = p.maxEnergy;
  p.fwdShield = p.maxShield;
  p.aftShield = p.maxShield;
  g.explosions.push({ pos: p.pos.slice(), life: 1.2, maxLife: 1.2, size: p.radius * 4 });
  g.events.push({ type: 'boom' });
  g.missiles = [];
  g.shots = [];
  g.target = null;
  dock(g);
  pushMessage(g, 'ESCAPE POD — SHIP INTACT, CARGO LOST', YELLOW, 6);
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
    // A fitted escape pod trades destruction for a rescue: same ship, no cargo.
    // In witchspace there is nothing to rescue you to, so the pod is fatal
    // there — exactly what the original does (#10).
    if (p.equipment.EQ_ESCAPE_POD && !g.witchspace) { escapePod(g); return; }
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
// Lock states (#18): your missile only tracks when the reticle has held the
// target in the forward arc for MISSILE_LOCK_TIME — before that it goes out
// dumbfire, straight and blind. An incoming missile locks the same way and
// flies straight until it has you, so turning out of its seeker cone (or the
// ECM sweep) breaks the lock before it ever steers.
// shortcut: no pylon missile types, no missile-vs-missile interception.
const MISSILE_SPEED = 750;
const MISSILE_RANGE = 30000;
const MISSILE_DAMAGE = 180;
const MISSILE_FUSE = 25;
const MISSILE_TURN = 1.8;       // rad/s of course change
const MISSILE_LOCK_TIME = 1.5;  // seconds of steady aim to lock on (#18)
const MISSILE_LOCK_RANGE = 8000;
const MISSILE_SEEKER_COS = 0.5; // seeker cone, 60° off the missile's nose

// The lock on the current target (#18): it builds while the target sits in
// the forward arc inside MISSILE_LOCK_RANGE and breaks the moment it does
// not. Switching targets breaks it too — the reticle has to settle again.
export function updateMissileLock(g, dt) {
  const t = g.target;
  if (g.lockTarget !== t) {
    const was = g.lockProgress >= 1;
    g.lockTarget = t;
    g.lockProgress = 0;
    if (was) pushMessage(g, 'MISSILE LOCK BROKEN', YELLOW, 3);
    return;
  }
  if (!t || !t.alive) { g.lockProgress = 0; return; }
  const nose = quatRotate(g.player.quat, [0, 0, 1]);
  const to = sub(t.pos, g.player.pos);
  const range = len(to) || 1;
  const inArc = dot(nose, scale(to, 1 / range)) > 0.5;
  if (range <= MISSILE_LOCK_RANGE && inArc) {
    const before = g.lockProgress;
    g.lockProgress = Math.min(1, g.lockProgress + dt / MISSILE_LOCK_TIME);
    if (before < 1 && g.lockProgress >= 1) {
      pushMessage(g, 'MISSILE LOCKED', GREEN, 3);
      g.events.push({ type: 'beep' });
    }
  } else if (g.lockProgress >= 1) {
    g.lockProgress = 0;
    pushMessage(g, 'MISSILE LOCK BROKEN', YELLOW, 3);
  } else {
    g.lockProgress = 0;
  }
}

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
  const homing = g.lockProgress >= 1; // no lock yet: it goes out dumb (#18)
  g.missiles.push({
    pos: add(p.pos, scale(fwd, p.radius + 5)),
    vel: scale(fwd, MISSILE_SPEED),
    target: homing ? t : null,
    homing,
    owner: p,
    hostile: false,
    life: MISSILE_RANGE / MISSILE_SPEED,
  });
  g.lockProgress = 0; // the next missile has to lock on as well
  g.events.push({ type: 'missile' });
  pushMessage(g, homing ? 'MISSILE LAUNCHED' : 'MISSILE LAUNCHED — NO LOCK (DUMBFIRE)',
    homing ? YELLOW : RED, 3);
  return true;
}

// Hostile ships loose missiles at the player, as Oolite's combat AI does.
// They start blind (lock 0) and pick the target up in flight (#18).
export function launchMissileAt(g, from, target, hostile) {
  const dir = norm(sub(target.pos, from.pos));
  g.missiles.push({
    pos: add(from.pos, scale(dir, from.radius + 5)),
    vel: scale(dir, MISSILE_SPEED),
    target,
    hostile: !!hostile,
    lock: 0,
    life: MISSILE_RANGE / MISSILE_SPEED,
  });
  g.events.push({ type: 'missile' });
  if (hostile) pushMessage(g, 'INCOMING MISSILE', RED, 3);
  return true;
}

// Closest point on the segment prev → prev+seg to `pos`, within `r` of it.
// Fusing against the whole segment matters: at 750 m/s a 50 ms step can
// skip clean past a small target.
function segmentHit(prev, seg, seg2, pos, r) {
  let f = seg2 > 0 ? dot(sub(pos, prev), seg) / seg2 : 0;
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  return dist(add(prev, scale(seg, f)), pos) <= r;
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
    const prev = m.pos;

    // A dumbfire has no guidance at all: straight from the launcher and
    // blind, fusing against whatever hull it runs into except the one that
    // fired it (#18).
    if (!m.homing && !m.hostile) {
      m.pos = add(prev, scale(m.vel, dt));
      const seg = sub(m.pos, prev);
      const seg2 = dot(seg, seg);
      for (const e of g.entities) {
        if (!e.alive || e === m.owner || (e.type !== 'ship' && e.type !== 'rock')) continue;
        if (segmentHit(prev, seg, seg2, e.pos, e.radius + MISSILE_FUSE)) {
          m.target = e; // so detonate() knows what it hit
          detonate(g, m);
          break;
        }
      }
      continue;
    }

    const t = m.target;
    const valid = t && (t === p ? p.alive : t.alive && g.entities.includes(t));
    if (!valid) { m.life = 0; continue; }
    const dir = norm(m.vel);
    const want = norm(sub(t.pos, m.pos));

    // An incoming missile locks on in flight: it flies straight until the
    // target has sat in its seeker cone for MISSILE_LOCK_TIME, so breaking
    // the cone (or the ECM) leaves it blind (#18).
    if (m.hostile && !(m.lock >= 1)) {
      const holding = dot(dir, want) > MISSILE_SEEKER_COS
        && dist(m.pos, t.pos) <= MISSILE_LOCK_RANGE;
      m.lock = holding ? Math.min(1, (m.lock || 0) + dt / MISSILE_LOCK_TIME) : 0;
    }
    const steers = m.hostile ? m.lock >= 1 : !!m.homing;

    if (steers) {
      const ax = cross(dir, want);
      const axl = len(ax);
      if (axl > 1e-6) {
        const angle = Math.atan2(axl, Math.max(-1, Math.min(1, dot(dir, want))));
        const step = Math.min(angle, MISSILE_TURN * dt);
        const q = quatAxisAngle(ax[0] / axl, ax[1] / axl, ax[2] / axl, step);
        m.vel = scale(quatRotate(q, dir), MISSILE_SPEED);
      }
    }
    m.pos = add(prev, scale(m.vel, dt));
    const seg = sub(m.pos, prev);
    const seg2 = dot(seg, seg);
    if (segmentHit(prev, seg, seg2, t.pos, t.radius + MISSILE_FUSE)) detonate(g, m);
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
  const facing = dot(fwd, d);
  let axis;
  if (axl > 1e-5) axis = [ax[0] / axl, ax[1] / axl, ax[2] / axl];
  else if (facing < 0) {
    // exactly astern: the cross product vanishes, so turn onto any axis at
    // right angles to the nose (up, unless the nose points up or down)
    const alt = cross(fwd, Math.abs(fwd[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
    axis = scale(alt, 1 / len(alt));
  } else return; // already pointing that way
  const angle = Math.atan2(axl, Math.max(-1, Math.min(1, facing)));
  const step = Math.min(angle, rate * dt);
  const q = quatAxisAngle(axis[0], axis[1], axis[2], step);
  e.quat = quatNormalize(quatMul(q, e.quat));
}

function integrate(e, dt, speedScale = 1) {
  const fwd = quatRotate(e.quat, [0, 0, 1]);
  e.speed = e.maxSpeed * speedScale;
  e.vel = scale(fwd, e.speed);
  e.pos = add(e.pos, scale(e.vel, dt));
}

// Who this NPC fights right now (#15): null means nobody worth chasing, so
// the ship patrols. The police hunt hostiles while your record is clean and
// you the moment it is not; Thargoids attack everything that moves; pirates
// go for whatever is closest — you, or the peaceful shipping that crosses
// their path (the original's pilots farm their rating on traders).
function pickFoe(g, e) {
  const p = g.player;
  const cands = [];
  const see = (other, range) => {
    if (other && other.alive && dist(other.pos, e.pos) <= range) cands.push(other);
  };
  if (e.role === 'police') {
    if (e.hostile) return p.alive ? p : null;
    for (const o of g.entities) {
      if (o.type === 'ship' && o !== e && o.hostile && o.role !== 'police') see(o, POLICE_ENGAGE);
    }
  } else if (e.role === 'thargoid') {
    see(p, ENGAGE_RANGE);
    for (const o of g.entities) {
      if (o.type === 'ship' && o !== e
        && (PEACEFUL_ROLES.includes(o.role) || o.role === 'police')) see(o, ENGAGE_RANGE);
    }
  } else {
    // Pirates do not fight inside the station's protection zone — the law
    // owns that sky, and a pirate in there draws the police (stepGame).
    if (inProtectionZone(g, e.pos)) return null;
    if (!inProtectionZone(g, p.pos)) see(p, ENGAGE_RANGE);
    for (const o of g.entities) {
      if (o.type === 'ship' && o !== e && PEACEFUL_ROLES.includes(o.role)
        && !inProtectionZone(g, o.pos)) see(o, ENGAGE_RANGE);
    }
  }
  let best = null;
  let bestD = Infinity;
  for (const c of cands) {
    const d = dist(c.pos, e.pos);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// The nearest hostile ship within `range` of e — what a shuttle runs from.
function nearestHostile(g, e, range) {
  let best = null;
  let bestD = Infinity;
  for (const o of g.entities) {
    if (o.type !== 'ship' || !o.hostile) continue;
    const d = dist(o.pos, e.pos);
    if (d <= range && d < bestD) { bestD = d; best = o; }
  }
  return best;
}

// Run away from a threat until it is far behind, then rejoin the traffic.
function fleeStep(e, g, dt) {
  const from = e.fleeFrom && e.fleeFrom.pos ? e.fleeFrom.pos : g.player.pos;
  if (dist(from, e.pos) > FLEE_RANGE) { e.fleeing = false; return false; }
  steerToward(e, add(e.pos, scale(norm(sub(e.pos, from)), 2000)), dt, e.pitchRate);
  integrate(e, dt, 1);
  return true;
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

  // --- peaceful shipping: patrol, and run from what cannot be fought (#15)
  if (e.role === 'trader' || e.role === 'passenger') {
    if (!e.fleeing) {
      // shuttles run from a hostile on sight, haulers only once they are hit
      // (damageShip sets fleeing and whoever hit them as the threat)
      if (e.role === 'passenger') {
        const t = nearestHostile(g, e, PASSENGER_FLEE);
        if (t) { e.fleeing = true; e.fleeFrom = t; }
      }
    }
    if (e.fleeing && fleeStep(e, g, dt)) {
      if (d > 25000) e.alive = false;
      return;
    }
    if (d > 20000) { e.alive = false; return; }
    integrate(e, dt, 0.5);
    return;
  }

  // A clean commander's police escort flies with the traders — until a
  // hostile comes close enough to protect them from (#15).
  if (e.role === 'police' && !e.hostile) {
    const guard = pickFoe(g, e);
    if (guard) { engageNPC(e, g, dt, guard); return; }
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

  // The launch grace: the first hostile out here drifts for a few seconds
  // before it chooses a foe, so a fresh commander is not fired on at once.
  if (e.engageDelay > 0) {
    e.engageDelay -= dt;
    if (d > 20000) { e.alive = false; return; }
    integrate(e, dt, 0.5);
    return;
  }

  const foe = pickFoe(g, e);
  if (!foe) {
    // A pirate stopped by the protection zone does not coast through it on
    // a collision course with whoever it was hunting — it breaks off and
    // leaves, which also lets the viper line up on its tail.
    if (e.role === 'pirate'
      && (inProtectionZone(g, e.pos) || inProtectionZone(g, p.pos))) e.breakingOff = true;
    // nobody in range worth fighting: keep the sky moving on a straight line
    if (d > 20000) { e.alive = false; return; }
    integrate(e, dt, 0.5);
    return;
  }
  engageNPC(e, g, dt, foe);
}

// The fight itself: turn onto the foe, close, fire when aligned. The foe is
// the player or another ship — NPC-on-NPC laser fire costs the victim hull
// and pays nobody (shortcut: no NPC kill rewards or ratings here).
function engageNPC(e, g, dt, foe) {
  const p = g.player;
  const df = dist(foe.pos, e.pos);

  e.think -= dt;
  if (e.think <= 0) {
    e.think = 0.4 + Math.random() * 0.6;
    e.strafePhase += 0.7;
  }

  let aimAt = foe.pos;
  if (df < 700) {
    // Too close: fly past instead of pinning on the foe.
    const fwd = quatRotate(e.quat, [0, 0, 1]);
    aimAt = add(e.pos, scale(fwd, 2000));
  } else if (df < 4000) {
    // Circle strafe so dogfights do not become head-on stalls.
    const tangent = cross(norm(sub(foe.pos, e.pos)), [0, 1, 0]);
    aimAt = add(foe.pos, scale(norm(tangent), Math.sin(e.strafePhase) * 600));
  }
  steerToward(e, aimAt, dt, e.pitchRate * 0.9);
  integrate(e, dt, df < 900 ? 1.0 : 0.85);

  // Fire when roughly aligned and in range.
  e.fireCooldown -= dt;
  const fwd = quatRotate(e.quat, [0, 0, 1]);
  const aim = norm(sub(foe.pos, e.pos));
  const aligned = dot(fwd, aim);
  if (e.fireCooldown <= 0 && df < 3500 && aligned > 0.985) {
    e.fireCooldown = 1.1 + Math.random() * 0.7;
    const hits = aligned > 0.995 || Math.random() < 0.5;
    g.shots.push({
      from: add(e.pos, scale(fwd, e.radius)),
      to: foe.pos.slice(),
      life: 0.12,
      hostile: foe === p, // only a shot at the commander can hurt the player
      npc: foe !== p,     // …and amber on the scanner beam for the rest
      hit: hits,
    });
    g.events.push({ type: 'laser' });
    if (hits) {
      if (foe === p) damagePlayer(g, 35);
      else damageShip(g, foe, 35, false, e);
    }
  }

  // Missiles are for the commander: a hostile busy with the shipping does
  // not loose one at you from across the sky. The first shot waits 15–40 s
  // so a fresh commander is not swarmed on launch.
  // shortcut: NPCs carry unlimited missiles — only the player counts a pylon.
  if (foe !== p) return;
  if (e.missileCd === undefined) e.missileCd = 15 + Math.random() * 25;
  e.missileCd -= dt;
  if (e.missileCd <= 0) {
    e.missileCd = e.role === 'thargoid' ? 18 + Math.random() * 15 : 25 + Math.random() * 30;
    const inbound = g.missiles.reduce((n, m) => n + (m.hostile ? 1 : 0), 0);
    const shoots = e.role === 'thargoid' || Math.random() < 0.5;
    if (df < 6000 && df > 200 && inbound < 2 && p.alive && shoots) {
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
  if (g.hitCooldown > 0) g.hitCooldown -= dt;

  // The launch trip (MISSING-FEATURES #6) runs itself: ten seconds of tube,
  // input ignored, nothing can hurt the ship — then finishLaunch hands over.
  if (g.launchSeq > 0) { stepLaunch(g, dt); return g; }

  // one-shot inputs
  if (input.jump) jump(g);
  if (g.phase !== 'flight') return g;

  const p = g.player;

  // --- flight ------------------------------------------------------------
  // A DOCK request with EQ_DOCK_COMP fitted hands the ship to its autopilot.
  // Easy mode flies at the station as a whole (the old shortcut); real mode
  // flies the slot — swing wide onto the side the ship came in on, sit on the
  // axis a kilometre out, then crawl in (#6).
  const autoDocking = g.autoDock && !!g.station;
  const autoLane = autoDocking && !g.easyDock ? lane(g) : null;
  if (autoDocking) {
    if (autoLane) {
      const side = g.dockSwing || cross(autoLane.normal, autoLane.up);
      const S = add(autoLane.pos, add(scale(autoLane.normal, 1000), scale(side, 2500)));
      const A = add(autoLane.pos, scale(autoLane.normal, 1000));
      if (g.dockPhase === 0 && (dist(p.pos, S) < 400 || autoLane.axial > 600)) g.dockPhase = 1;
      else if (g.dockPhase === 1
        && (dist(p.pos, A) < 400 || (autoLane.axial < 800 && autoLane.lat < 300))) g.dockPhase = 2;
      let aim;
      if (g.dockPhase === 0) aim = S;
      else if (g.dockPhase === 1) aim = A;
      else {
        // Final approach: close on the axis — straight at the mouth from far
        // out, then 600 m down the axis so the bearing stays shallow enough
        // for the slot's alignment budget through the contact zone. The mouth
        // holds still (the station does not spin), so a straight line in works.
        const toAxis = autoLane.axial >= 400
          ? autoLane.pos
          : add(autoLane.pos, scale(autoLane.normal, autoLane.axial - 600));
        aim = add(p.pos, scale(norm(sub(toAxis, p.pos)), 600));
      }
      steerToward(p, aim, dt, p.pitchRate);
      matchRoll(p, autoLane.up, dt, p.rollRate);
    } else {
      steerToward(p, g.station.pos, dt, p.pitchRate);
    }
  }

  const pitch = input.pitch || 0;
  const yaw = input.yaw || 0;
  const roll = input.roll || 0;
  if (!autoDocking && (pitch || yaw || roll)) {
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

  if (autoDocking) {
    if (autoLane) {
      // Real mode: pace by the distance to the slot mouth — 300 m/s out
      // front, down to a crawl by the sleeve, with a floor so the approach
      // always completes. Contact lands well under the 120 m/s limit.
      const dm = dist(autoLane.pos, p.pos);
      const want = Math.max(40, Math.min(dm > 900 ? 300 : 150, (dm - 100) * 0.35));
      p.throttle = want / p.maxSpeed;
    } else {
      // Easy mode: throttle from the distance left, as it has always been —
      // full approach speed far out, down to a crawl by the station's 703 m
      // hull, so contact is always a soft dock.
      const sd = dist(g.station.pos, p.pos);
      p.throttle = Math.min(0.6, Math.max(0, (sd - 350) * 0.18 / p.maxSpeed));
    }
  } else if (input.throttleSet != null) p.throttle = input.throttleSet;
  else if (input.throttle) p.throttle = Math.max(0, Math.min(1, p.throttle + input.throttle * dt));
  // shortcut: Oolite also burns fuel at 0.25 units/s while boosting; here the
  // boost is only gated behind the EQ_FUEL_INJECTION purchase, and the
  // docking computer flies without it.
  const boosting = input.injectors && !autoDocking && g.hasEquipment('EQ_FUEL_INJECTION');
  const injector = boosting ? 2.5 : 1;
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

  // --- altitude and the planet (#17) ----------------------------------------
  // The dial shows metres above the surface over 40 km (Oolite's
  // PLAYER_DIAL_MAX_ALTITUDE). Under the surface the ship bounces off like
  // any other collision and pays hull for it — flying into the planet now
  // hurts instead of doing nothing.
  const alt = dist(p.pos, PLANET_POS) - PLANET_R;
  g.altitudeFraction = Math.max(0, Math.min(1, alt / DIAL_MAX_ALTITUDE));
  if (alt < 0 && g.hitCooldown <= 0) {
    const away = norm(sub(p.pos, PLANET_POS));
    p.pos = add(PLANET_POS, scale(away, PLANET_R + p.radius + 1));
    p.speed *= 0.3;
    pushMessage(g, 'PLANET IMPACT', RED, 4);
    damagePlayer(g, 40);
    g.hitCooldown = 1.5;
    if (g.phase !== 'flight') return g;
  }

  // --- cabin temperature (#17) ----------------------------------------------
  // Near the sun the cabin cooks, far from it it sinks back to its 60
  // minimum. Past 256 the crew pays for it: one hit twice a second until
  // the cabin gets back under the limit.
  const sunD = dist(p.pos, SUN_POS) || 1;
  const external = SUN_TEMPERATURE * (SUN_R * SUN_R) / (sunD * sunD);
  if (external > HEAT_THRESHOLD && external > p.cabinTemp) {
    p.cabinTemp += (external - p.cabinTemp) * SHIP_INSULATION_FACTOR * dt;
  } else if (p.cabinTemp > SHIP_MIN_CABIN_TEMP) {
    p.cabinTemp = Math.max(SHIP_MIN_CABIN_TEMP,
      p.cabinTemp + (external - HEAT_THRESHOLD - p.cabinTemp) * SHIP_COOLING_FACTOR * dt);
  }
  if (g.heatTick > 0) g.heatTick -= dt;
  if (p.cabinTemp > SHIP_MAX_CABIN_TEMP && g.heatTick <= 0) {
    damagePlayer(g, 25);
    g.heatTick = 0.5;
    if (g.phase !== 'flight') return g;
  }

  // --- shields / energy / temperature -------------------------------------
  g.shieldCooldown -= dt;
  if (g.shieldCooldown <= 0) {
    p.fwdShield = Math.min(p.maxShield, p.fwdShield + 8 * dt);
    p.aftShield = Math.min(p.maxShield, p.aftShield + 8 * dt);
  }
  // The hull's own recharge rate, resolved through its like_ship chain —
  // an adder recharges at 2, a python at 2.5, not the Cobra's 4.
  let recharge = def(g, p.shipKey).energy_recharge_rate || 4;
  if (g.hasEquipment('EQ_ENERGY_UNIT')) recharge *= ENERGY_RECHARGE_MULT;
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

  // --- alert state (#17) ----------------------------------------------------
  // Oolite's ladder (PlayerEntity alertCondition): red while the shields
  // still remember a hit, yellow while any warning flag is up — energy
  // critical, low altitude, the cabin cooking, a missile in the air —
  // green otherwise. The ENERGY LOW line is said once per crossing, the way
  // the upstream AI says it, not every frame.
  const energyCritical = p.energy < 64 && p.energy < p.maxEnergy * 0.8;
  if (energyCritical && !g.energyLow) pushMessage(g, 'ENERGY LOW', RED, 6);
  g.energyLow = energyCritical;
  const warning = energyCritical
    || g.altitudeFraction < 0.10
    || p.cabinTemp > SHIP_MAX_CABIN_TEMP * 0.9
    || g.missiles.some((m) => m.hostile);
  g.alert = g.shieldCooldown > 0 ? 'red' : warning ? 'yellow' : 'green';

  // --- fuel scooping -------------------------------------------------------
  // EQ_FUEL_SCOOPS: fly into the sun's corona and the scoops drink straight
  // from it until the tank is full (MISSING-FEATURES.md #11 sun skimming).
  const skimming = g.hasEquipment('EQ_FUEL_SCOOPS') && p.fuel < 70
    && dist(p.pos, SUN_POS) <= SUN_CORONA;
  if (skimming) {
    if (!g.scooping) pushMessage(g, 'FUEL SCOOPING', GREEN, 3);
    p.fuel = Math.min(70, p.fuel + SCOOP_RATE * dt);
    if (p.fuel >= 70) pushMessage(g, 'FUEL TANK FULL', GREEN, 4);
  }
  g.scooping = skimming;

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
    if (e.type === 'cargo' || e.type === 'rock') {
      // loose debris drifts and tumbles until a scoop takes it (#11) or a
      // laser breaks the rock (#12)
      e.pos = add(e.pos, scale(e.vel, dt));
      e.quat = quatNormalize(quatMul(
        quatAxisAngle(e.tumbleAxis[0], e.tumbleAxis[1], e.tumbleAxis[2], e.tumbleRate * dt),
        e.quat));
      if (e.type === 'cargo') tryScoop(g, e);
      continue;
    }
    updateNPC(e, g, dt);
  }
  g.entities = g.entities.filter((e) => e.alive);
  updateMissiles(g, dt);

  // The scoop dial (#11), Oolite's dialFuelScoopStatus: active while the
  // scoops are working (sun fuel or a canister going in), full when the hold
  // will not take more, okay when they are free to work, hidden unscooped.
  // Computed after the entity pass so a canister taken this frame already
  // reads active.
  g.scoopT = Math.max(0, g.scoopT - dt);
  g.scoopStatus = !g.hasEquipment('EQ_FUEL_SCOOPS') ? 'none'
    : (skimming || g.scoopT > 0) ? 'active'
    : cargoUsed(g) >= p.maxCargo ? 'full'
    : 'okay';

  // --- respawn contacts (#15) ----------------------------------------------
  // Caps, not timers, keep the sky inhabited without crowding it: at most two
  // hostiles, one hauler and one shuttle (MAX_PEACEFUL) and the viper patrol.
  g.spawnTimer -= dt;
  // One pass over the contacts instead of four filters and a find — this runs
  // every frame, and the arrays it used to build are pure garbage.
  let hostiles = 0, police = 0, peaceful = 0, hasTrader = false, intruder = null;
  for (const e of g.entities) {
    if (e.type !== 'ship') continue;
    if (e.hostile) hostiles++;
    if (e.role === 'police') police++;
    if (!e.hostile && e.role !== 'police') {
      peaceful++;
      if (e.role === 'trader') hasTrader = true;
    }
    // A pirate inside the station's protection zone calls the police out, clean
    // record or not: they come from the station onto the intruder and destroy
    // it there (pickFoe makes the pirate stand down in that sky).
    if (!intruder && e.role === 'pirate' && inProtectionZone(g, e.pos)) intruder = e;
  }
  if (intruder && police === 0) {
    const cop = spawnPolice(g);
    // halfway out to the intruder: always inside the viper's 10 km reach
    cop.pos = add(g.station.pos, scale(sub(intruder.pos, g.station.pos), 0.5));
  }
  if (g.witchspace) {
    // stranded: only the Thargoids are out here, and they keep coming (#10)
    if (g.spawnTimer <= 0 && hostiles < 3) {
      g.spawnTimer = 12;
      spawnThargoid(g);
    }
  } else if (g.spawnTimer <= 0) {
    g.spawnTimer = 12;
    if (hostiles < 2) {
      // a wanted commander gets the police on their tail instead of a free spawn
      if (g.crime > 0 && police === 0) spawnPolice(g);
      else if (hostiles === 0) spawnPirate(g);
      // one hostile in three is the alien instead of a pirate
      else if (Math.random() < 0.6) (Math.random() < 0.33 ? spawnThargoid(g) : spawnPirate(g));
    }
    if (peaceful < MAX_PEACEFUL) {
      if (!hasTrader) spawnTrader(g);
      else spawnPassenger(g);
    }
  }

  // --- shots fade ---------------------------------------------------------
  for (const s of g.shots) s.life -= dt;
  g.shots = g.shots.filter((s) => s.life > 0);
  for (const x of g.explosions) x.life -= dt;
  g.explosions = g.explosions.filter((x) => x.life > 0);

  // --- collisions ---------------------------------------------------------
  for (const e of g.entities) {
    if (e.type === 'cargo') continue; // loose cargo is scooped, not crashed into
    const d = dist(e.pos, p.pos);
    const touch = e.type === 'station'
      ? hullTouch(e, p.pos, p.radius)
      : d < e.radius + p.radius;
    // where a contact throws the ship: the station exits through its own
    // face, everything else off the sphere it was hit on
    const shove = () => (e.type === 'station' && e.hull)
      ? hullExit(e, p.pos, p.radius)
      : add(e.pos, scale(norm(sub(p.pos, e.pos)), e.radius + p.radius + 1));
    if (touch) {
      // Real docking (easy mode off): a slow, lined-up approach threads the
      // slot instead of bouncing off the hull; anything else — off the axis,
      // the nose not pointing in, too fast, or a hit anywhere else on the
      // station — costs hull and cargo. g.hitCooldown keeps one scrape to one
      // hit.
      if (e.type === 'station' && !g.easyDock) {
        const l = lane(g);
        if (linedUp(l) && p.speed < DOCK_SPEED) {
          if (l.axial < -p.radius * 0.6) {
            dock(g);
            if (g.phase !== 'flight') return g;
          }
          continue; // in the lane: sail through the sleeve, no bounce
        }
        // One scrape = one hit and one shove; between hits the ship keeps
        // flying, so a misaligned approach can still recover and line up.
        if (g.hitCooldown <= 0) {
          p.pos = shove();
          p.speed *= 0.3;
          damagePlayer(g, 25);
          loseCargo(g);
          g.hitCooldown = 1.5;
        }
        if (g.phase !== 'flight') return g;
        continue;
      }
      p.pos = shove();
      // The gate has to read the speed you arrived at: bleeding it to 30 %
      // first made every contact "slow enough" to dock, hot ones included.
      // And one scrape per cooldown, the rule real mode states above — a hull
      // you keep pressing into would otherwise pay 25 twice over. No distance
      // check: a contact is bounded by hull + ship radius (≤ 777 m on the
      // Coriolis), so the old 837 m gate could never actually refuse one.
      // The docking computer's own soft approach rides through the suspension.
      const hitSpeed = p.speed;
      p.speed *= 0.3;
      if (e.type === 'station') {
        if (hitSpeed < DOCK_SPEED && (!g.scraped || g.autoDock)) dock(g);
        else if (g.hitCooldown <= 0) {
          damagePlayer(g, 25);
          g.hitCooldown = 1.5;
          g.scraped = true;
        }
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
    // A crash voids the assisted dock until the ship is back out past the
    // 837 m radius — well clear of the hull's 574 m faces — and the hint
    // below says so the whole time it holds.
    if (g.scraped && sd > st.radius + p.radius + 60) g.scraped = false;
    // DOCK with a docking computer fitted hands the ship to its autopilot;
    // real mode without one says why nothing happens (the assisted shortcut
    // needs no computer — that is the checkbox on the start screen).
    if (input.dockRequest && g.hasEquipment('EQ_DOCK_COMP')) {
      if (!g.autoDock) {
        g.autoDock = true;
        const l0 = lane(g);
        // Start on the swing wide unless the ship is already out in front of
        // the slot; the side vector is frozen so the waypoint holds still.
        g.dockPhase = l0.axial < 600 ? 0 : 1;
        const rel0 = sub(p.pos, l0.pos);
        const lat0 = sub(rel0, scale(l0.normal, dot(rel0, l0.normal)));
        g.dockSwing = len(lat0) > 100 ? norm(lat0) : norm(cross(l0.normal, l0.up));
        pushMessage(g, 'DOCKING COMPUTER ENGAGED', BLUE, 4);
      }
    } else if (input.dockRequest && !g.easyDock) {
      pushMessage(g, 'DOCKING COMPUTER NOT FITTED', YELLOW, 3);
    }
    if (g.easyDock) {
      // Assisted mode (the game's original shortcut): crawl in under the
      // limit, or ask for it on the DOCK button. Both refusals say why —
      // a silent DOCK or a suspended assist reads as "easy mode is broken".
      if ((sd < 400 && p.speed < 120) || (input.dockRequest && sd < 1500 && p.speed < 250)) dock(g);
      else if (input.dockRequest && !g.autoDock) {
        pushMessage(g, 'DOCK NEEDS 1500 m AND 250 m/s', YELLOW, 3);
      } else if (sd < 3000 && (g.scraped || p.speed >= 120) && !g.autoDock) g.dockHint = 2;
      else g.dockHint = Math.max(0, g.dockHint - dt);
      if (g.dockHint > 0) {
        // While the crash lock holds, slowing down alone cannot help — say
        // what actually ends it instead of repeating the speed limit.
        const hint = g.scraped ? 'BACK CLEAR TO DOCK AGAIN' : 'SLOW TO <120 m/s TO DOCK';
        if (!g.messages.some((m) => m.text.startsWith(hint.slice(0, 6)))) {
          pushMessage(g, hint, BLUE, 3);
        }
      }
    } else {
      // Real mode: the collision lane above does the docking — this coaches
      // the approach and explains a refused DOCK request.
      g.dockHint = 0;
      if (!g.autoDock && sd < 3000) {
        const l = lane(g);
        const hint = p.speed >= DOCK_SPEED ? 'SLOW TO <120 m/s TO DOCK'
          : (l.facing <= 0.9 || l.lat >= SLOT_HALF) ? 'LINE UP WITH THE DOCKING SLOT'
          : '';
        if (hint && !g.messages.some((m) => m.text.startsWith(hint.slice(0, 8)))) {
          pushMessage(g, hint, BLUE, 3);
        }
      }
    }
  } else if (input.dockRequest) {
    // no station answers a DOCK request — you are in witchspace (#10)
    pushMessage(g, 'NO STATION TO DOCK AT', YELLOW, 3);
  }

  // --- targeting / compass ------------------------------------------------
  if (input.targetNext) cycleTarget(g);
  if (g.target && (!g.target.alive || !g.entities.includes(g.target))) g.target = null;
  updateMissileLock(g, dt); // the lock follows the reticle (#18)
  g.compass = g.target || g.station;
  g.targetBounty = g.target && g.target.bounty ? g.target.bounty : 0;

  // --- messages -----------------------------------------------------------
  for (const m of g.messages) m.life -= dt;
  g.messages = g.messages.filter((m) => m.life > 0);

  // --- scanner ------------------------------------------------------------
  return g;
}

export function cycleTarget(g) {
  const list = g.entities.filter((e) => e.type === 'ship');
  if (!list.length) { g.target = null; return; }
  const i = g.target ? list.indexOf(g.target) : -1;
  g.target = list[(i + 1) % list.length];
  g.events.push({ type: 'beep' });
}
