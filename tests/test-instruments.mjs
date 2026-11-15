// Live instruments (#17): altitude and the planet, cabin temperature, the
// alert ladder, the ENERGY LOW warning. Run: node tests/test-instruments.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { createGame, stepGame, launch, PLANET_POS, PLANET_R, SUN_POS, SUN_R } =
  await import(join(root, 'web/src/game.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const assets = {
  plists: {
    shipdata: parsePlist(read('config/shipdata.plist')),
    shipyard: parsePlist(read('config/shipyard.plist')),
    equipment: parsePlist(read('config/equipment.plist')),
    'trade-goods': parsePlist(read('config/trade-goods.plist')),
    planetinfo: parsePlist(read('config/planetinfo.plist')),
  },
  parsedMeshes: {}, // hull radii fall back to 60 m; nothing here needs meshes
};

const g = createGame(assets);
g.rand = () => 1; // pin the jump rolls
launch(g);
g.entities = g.entities.filter((e) => e.type === 'station');
g.spawnTimer = 1e9; // keep the sky quiet
const step = (n = 1, input = {}) => {
  for (let i = 0; i < n; i++) stepGame(g, input, 1 / 60);
};
const surfaceDist = () => Math.hypot(
  g.player.pos[0] - PLANET_POS[0],
  g.player.pos[1] - PLANET_POS[1],
  g.player.pos[2] - PLANET_POS[2],
) - PLANET_R;

// ---- altitude and the planet (#17) -----------------------------------------
// the launch framing sits well over 40 km up: the dial reads full
step(1);
assert.strictEqual(g.altitudeFraction, 1, 'high altitude reads full');

// 1 km above the surface: the dial is nearly empty and the low-altitude
// warning flag is up (yellow alert)
g.player.pos = [PLANET_POS[0], PLANET_POS[1], PLANET_POS[2] - PLANET_R - 1000];
g.player.quat = [0, 0, 0, 1];
g.player.speed = 0;
g.player.throttle = 0;
step(1);
assert.ok(g.altitudeFraction > 0 && g.altitudeFraction < 0.05,
  `1 km up reads nearly empty (${g.altitudeFraction.toFixed(3)})`);
assert.strictEqual(g.alert, 'yellow', 'low altitude reads yellow');

// under the surface: the ship bounces back out and pays hull for the impact
const hull0 = g.player.energy + g.player.fwdShield + g.player.aftShield;
g.player.pos = [PLANET_POS[0], PLANET_POS[1], PLANET_POS[2] - PLANET_R + 50];
step(1);
assert.ok(surfaceDist() > 0, `bounced above the surface (${surfaceDist().toFixed(1)} m)`);
assert.ok(g.player.energy + g.player.fwdShield + g.player.aftShield < hull0,
  'the impact costs hull');
assert.ok(g.messages.some((m) => m.text === 'PLANET IMPACT'), 'the impact says so');
assert.strictEqual(g.alert, 'red', 'the impact reads red');

// climbing away fills the dial again
g.player.pos = [PLANET_POS[0], PLANET_POS[1], PLANET_POS[2] - PLANET_R - 30000];
step(1);
assert.ok(g.altitudeFraction > 0.7, `30 km up reads mostly full (${g.altitudeFraction.toFixed(2)})`);

// ---- cabin temperature (#17) ------------------------------------------------
// far from the sun the cabin sinks back to its 60 minimum
g.player.pos = [40000, 0, 0]; // clear of the station, the planet and the sun
g.player.cabinTemp = 200;
step(600); // 10 s
assert.strictEqual(g.player.cabinTemp, 60, 'the cabin cools to its minimum in space');

// just outside the sun's surface the heat gets in
g.player.pos = [SUN_POS[0], SUN_POS[1], SUN_POS[2] + SUN_R + 500];
g.player.cabinTemp = 60;
step(600);
assert.ok(g.player.cabinTemp > 60,
  `the cabin heats near the sun (${g.player.cabinTemp.toFixed(1)})`);

// past 256 the overheating cabin starts costing hull, and reads red
g.player.cabinTemp = 300;
const hotHull = g.player.energy + g.player.fwdShield + g.player.aftShield;
step(60); // 1 s: two 25-point hits
assert.ok(g.player.energy + g.player.fwdShield + g.player.aftShield <= hotHull - 25,
  'overheat costs hull');
assert.strictEqual(g.alert, 'red', 'overheat reads red');

// ---- alert ladder (#17) -----------------------------------------------------
// settle: cool cabin, full banks, no recent hits, nothing in the air
g.player.pos = [40000, 0, 0];
g.player.cabinTemp = 60;
g.player.energy = g.player.maxEnergy;
g.player.fwdShield = g.player.maxShield;
g.player.aftShield = g.player.maxShield;
step(400); // let the shield cooldown from the earlier hits run out
assert.strictEqual(g.alert, 'green', 'nothing wrong reads green');

// energy critical: yellow, and ENERGY LOW is said once — not every frame
g.player.energy = 30;
step(1);
assert.strictEqual(g.alert, 'yellow', 'critical energy reads yellow');
assert.ok(g.messages.some((m) => m.text === 'ENERGY LOW'), 'ENERGY LOW is said');
const warns = g.messages.filter((m) => m.text === 'ENERGY LOW').length;
step(30);
assert.strictEqual(g.messages.filter((m) => m.text === 'ENERGY LOW').length, warns,
  'the warning is not repeated every frame');

// banks back up: green again
g.player.energy = g.player.maxEnergy;
step(1);
assert.strictEqual(g.alert, 'green', 'back to green');

console.log('instruments: all checks passed');
