// Travel features — MISSING-FEATURES.md #8 galactic hyperspace, #9 long-range
// chart (see tests/test-chart.mjs) and #10 witchspace interception.
// Run: node tests/test-travel.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { createGame, launch, systemsIn, galacticJump, equipmentFor,
  buyEquipment, SYSTEMS } = await import(join(root, 'web/src/game.js'));
const { galaxySystems, distanceLy } = await import(join(root, 'web/src/galaxy.js'));

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

console.log('travel: galactic hyperspace checks passed');
