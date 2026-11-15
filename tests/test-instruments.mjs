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

// 1 km above the surface: the dial is nearly empty
g.player.pos = [PLANET_POS[0], PLANET_POS[1], PLANET_POS[2] - PLANET_R - 1000];
g.player.quat = [0, 0, 0, 1];
g.player.speed = 0;
g.player.throttle = 0;
step(1);
assert.ok(g.altitudeFraction > 0 && g.altitudeFraction < 0.05,
  `1 km up reads nearly empty (${g.altitudeFraction.toFixed(3)})`);

// under the surface: the ship bounces back out and pays hull for the impact
const hull0 = g.player.energy + g.player.fwdShield + g.player.aftShield;
g.player.pos = [PLANET_POS[0], PLANET_POS[1], PLANET_POS[2] - PLANET_R + 50];
step(1);
assert.ok(surfaceDist() > 0, `bounced above the surface (${surfaceDist().toFixed(1)} m)`);
assert.ok(g.player.energy + g.player.fwdShield + g.player.aftShield < hull0,
  'the impact costs hull');
assert.ok(g.messages.some((m) => m.text === 'PLANET IMPACT'), 'the impact says so');

// climbing away fills the dial again
g.player.pos = [PLANET_POS[0], PLANET_POS[1], PLANET_POS[2] - PLANET_R - 30000];
step(1);
assert.ok(g.altitudeFraction > 0.7, `30 km up reads mostly full (${g.altitudeFraction.toFixed(2)})`);

console.log('instruments: altitude ok');
