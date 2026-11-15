// Travel features — MISSING-FEATURES.md #8 galactic hyperspace, #9 long-range
// chart (see tests/test-chart.mjs) and #10 witchspace interception.
// Run: node tests/test-travel.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { createGame, launch, stepGame, jump, systemsIn, galacticJump,
  equipmentFor, buyEquipment, jdrive, PLANET_POS, SYSTEMS } =
  await import(join(root, 'web/src/game.js'));
const { galaxySystems, distanceLy } = await import(join(root, 'web/src/galaxy.js'));
const { quatRotate, add, scale } = await import(join(root, 'web/src/math.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const assets = {
  plists: {
    shipyard: parsePlist(read('config/shipyard.plist')),
    shipdata: parsePlist(read('config/shipdata.plist')),
    equipment: parsePlist(read('config/equipment.plist')),
    'trade-goods': parsePlist(read('config/trade-goods.plist')),
  },
  parsedMeshes: {}, // no meshes: radiusOf() falls back to 60 m
};

const newGame = () => {
  const g = createGame(assets);
  g.rand = () => 1; // pin the jump rolls: the #10 tests set their own
  launch(g);
  g.entities = g.entities.filter((e) => e.type === 'station');
  g.spawnTimer = 1e9;
  return g;
};

// ---- #8 galactic hyperspace ------------------------------------------------
const g = newGame();
g.player.credits = 60000;
const row = equipmentFor(g).find((r) => r.key === 'EQ_GAL_DRIVE');
assert.ok(row, 'the station sells the galactic drive');
assert.strictEqual(row.price, 50000, 'at its real equipment.plist price');
assert.ok(buyEquipment(g, 'EQ_GAL_DRIVE'), 'and it can be bought');
assert.strictEqual(g.player.credits, 10000, 'paid exactly the plist price');

const fuel0 = g.player.fuel;
g.crime = 20;
assert.strictEqual(galacticJump(g), false, 'the first press only arms the drive');
assert.ok(g.galConfirm, 'the press is remembered');
assert.ok(g.messages.some((m) => m.text.includes('PRESS AGAIN')),
  'the HUD asks for the second press');
assert.strictEqual(g.galaxy, 1, 'still in galaxy 1');

assert.ok(galacticJump(g), 'the second press crosses galaxies');
assert.strictEqual(g.galaxy, 2, 'into galaxy 2');
assert.strictEqual(g.player.equipment.EQ_GAL_DRIVE, undefined,
  'the drive is one-shot, as in the original (Ghy zeroes GHYP)');
assert.strictEqual(g.player.fuel, fuel0, 'a galactic jump costs no fuel');
assert.strictEqual(g.crime, 0, 'changing galaxy clears the record (FIST = 0)');
assert.ok(g.station, 'a station waits in the new galaxy');
assert.strictEqual(g.entities.filter((e) => e.type === 'station').length, 1,
  'exactly one station');

// arrival: the system nearest the original's (96, 96) arrival point
const systems = systemsIn(g);
assert.strictEqual(systems.length, 256, 'a galaxy holds 256 systems');
let nearest = 0;
let best = Infinity;
for (const s of systems) {
  const d = distanceLy({ x: 96, y: 96 }, s);
  if (d < best) { best = d; nearest = s.index; }
}
assert.strictEqual(g.systemIndex, nearest, 'arrived at the system nearest (96, 96)');
assert.notStrictEqual(systems[g.systemIndex], SYSTEMS[g.systemIndex],
  'the index resolves into galaxy 2, not galaxy 1');

// no drive left, no crossing
assert.strictEqual(galacticJump(g), false, 'the spent drive refuses the next press');
assert.ok(g.messages.some((m) => m.text === 'NO GALACTIC DRIVE FITTED'),
  'and the HUD says why');

// galaxy 8 wraps back to 1 (upstream: galaxy_number &= 7)
g.galaxy = 8;
g.player.equipment.EQ_GAL_DRIVE = true;
assert.strictEqual(galacticJump(g), false, 'armed again');
assert.ok(galacticJump(g), 'galaxy 8 jumps');
assert.strictEqual(g.galaxy, 1, 'wraps to galaxy 1');
assert.strictEqual(systemsIn(g), galaxySystems(1), 'back on galaxy 1\'s systems');

// a carried Navy mission counts the galactic jump like any other (#7)
const g2 = newGame();
g2.mission = { active: 'thargplans', jumps: 0, done: ['conhunt'] };
g2.player.equipment.EQ_GAL_DRIVE = true;
assert.strictEqual(galacticJump(g2), false);
assert.ok(galacticJump(g2));
assert.strictEqual(g2.mission.jumps, 1, 'the galactic jump counts as a jump');

// ---- #10 witchspace interception -------------------------------------------
// The original's mis-jump: MJP is called from TT18 instead of arriving with
// 0.78% odds. g.rand is the seam both rolls go through, so pin it.

// intercepted: fuel spent, no station, three Thargoids (MJP spawns three)
const w = newGame();
w.rand = () => 0; // always intercept
const wFuel = w.player.fuel;
assert.ok(jump(w), 'the jump resolves before the intercept');
assert.ok(w.player.fuel < wFuel, 'the interrupted jump still spends its fuel');
assert.strictEqual(w.witchspace, true, 'stranded in witchspace');
assert.strictEqual(w.station, null, 'no station to dock at');
assert.ok(!w.entities.some((e) => e.type === 'station'), 'and none in the sky');
assert.strictEqual(w.entities.filter((e) => e.role === 'thargoid').length, 3,
  'three Thargoids on you, as the original spawns');
assert.ok(w.messages.some((m) => m.text === 'MIS-JUMP — WITCHSPACE'),
  'the HUD says what happened');

// DOCK has nothing to answer it
stepGame(w, { dockRequest: true }, 1 / 60);
assert.ok(w.messages.some((m) => m.text === 'NO STATION TO DOCK AT'),
  'and the HUD explains why');

// a jump the tank can afford escapes the normal way — back to where from
w.player.fuel = 70;
w.rand = () => 1; // clean roll on the way out
assert.ok(jump(w, 7), 'a funded jump out of witchspace works');
assert.strictEqual(w.witchspace, false, 'out of witchspace');
assert.ok(w.station, 'the station is waiting again');
assert.strictEqual(w.entities.filter((e) => e.role === 'thargoid').length, 0,
  'and the Thargoids are gone');

// dry: the luck roll misses, then lands
const w2 = newGame();
w2.rand = () => 0;
assert.ok(jump(w2));
w2.player.fuel = 0;
w2.rand = () => 0.9; // 0.9 >= 0.25
assert.strictEqual(jump(w2), false, 'no fuel and no luck: still stuck');
assert.strictEqual(w2.witchspace, true);
assert.ok(w2.messages.some((m) => m.text === 'STILL LOST IN WITCHSPACE'),
  'the HUD says you are still lost');
w2.rand = () => 0; // 0 < 0.25
assert.ok(jump(w2), 'a lucky bounce gets you out');
assert.strictEqual(w2.witchspace, false, 'free of witchspace');
assert.ok(w2.station, 'with a station again');

// the fuel injectors double the dry escape chance (0.25 → 0.5)
const w3 = newGame();
w3.rand = () => 0;
assert.ok(jump(w3));
w3.player.fuel = 0;
w3.rand = () => 0.3;
assert.strictEqual(jump(w3), false, '0.3 misses the plain 0.25 roll');
w3.player.equipment.EQ_FUEL_INJECTION = true;
assert.ok(jump(w3), 'and lands the injectors’ 0.5 roll');
assert.strictEqual(w3.witchspace, false);

// a clean roll arrives normally
const w4 = newGame();
w4.rand = () => 1; // 1 >= 0.78%: never intercepted
assert.ok(jump(w4));
assert.strictEqual(w4.witchspace, false, 'no intercept at the top of the roll');
assert.ok(w4.station, 'arrived with a station');

// the escape pod is fatal in witchspace, as in the original — and must never
// try to dock a station that is not there
const w5 = newGame();
w5.rand = () => 0;
assert.ok(jump(w5));
w5.player.equipment.EQ_ESCAPE_POD = true;
w5.player.fwdShield = 0;
w5.player.aftShield = 0;
w5.player.energy = 1;
w5.entities.push({
  type: 'ship', shipKey: 'python', name: 'Python Trader', role: 'pirate',
  pos: [w5.player.pos[0], w5.player.pos[1], w5.player.pos[2] + 600],
  quat: [0, 1, 0, 0], vel: [0, 0, 0], radius: 60, speed: 0, maxSpeed: 200,
  thrust: 20, pitchRate: 0.8, rollRate: 2, yawRate: 0.2, energy: 60,
  maxEnergy: 60, bounty: 40, hostile: true, fireCooldown: 0, think: 0,
  strafePhase: 0, alive: true, color: [1, 0, 0],
});
for (let i = 0; i < 900 && w5.phase === 'flight'; i++) stepGame(w5, {}, 1 / 60);
assert.strictEqual(w5.phase, 'dead', 'the escape pod is fatal in witchspace');

// ---- #20 in-system J-drive --------------------------------------------------
// The ZX-original fast hop: 20 km along the nose, free, refused with an
// audible warning when a ship, the station, the planet or the sun is near
// either end of the hop.
const j = newGame(); // launch leaves the station 3.2 km off, too far to matter
// here (node has no meshes, so every radius is the 60 m fallback) — a contact
// a kilometre off the nose is the nearby ship the ZX drive refuses to jump past
j.entities.push({ type: 'ship', radius: 60,
  pos: [j.player.pos[0], j.player.pos[1], j.player.pos[2] + 1000] });
const pos0 = [...j.player.pos];
assert.strictEqual(jdrive(j), false, 'the station nearby blocks the hop');
assert.ok(j.messages.some((m) => m.text === 'J-DRIVE BLOCKED — OBSTRUCTION NEARBY'),
  'the HUD says why');
assert.deepStrictEqual(j.player.pos, pos0, 'and the ship stays put');
assert.ok(j.events.some((e) => e.type === 'jdrive'), 'with the audible warning');

j.entities = [];
j.player.pos = [40000, -20000, 0]; // open sky: planet and sun both far off
const nose = quatRotate(j.player.quat, [0, 0, 1]);
const clear0 = [...j.player.pos];
assert.ok(jdrive(j), 'clear space: the drive fires');
assert.deepStrictEqual(j.player.pos, add(clear0, scale(nose, 20000)),
  'exactly 20 km along the nose');
assert.ok(j.events.some((e) => e.type === 'jdriveHop'), 'with the hop sound');

j.player.pos = add(scale(nose, -20000), PLANET_POS); // arrival lands on the planet
const atPlanet = [...j.player.pos];
assert.strictEqual(jdrive(j), false, 'arrival inside the planet is refused');
assert.deepStrictEqual(j.player.pos, atPlanet, 'the ship stays where it stood');

console.log('travel: all checks passed');
