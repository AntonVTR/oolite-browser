// NPC ecosystem (MISSING-FEATURES #15): passenger traffic, the flee/engage
// state each role gets, NPCs fighting each other, and the spawn caps that
// keep space inhabited without crowding it.
// Run: node tests/test-npcs.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const {
  createGame, stepGame, launch, spawnPirate, spawnTrader, spawnPassenger,
  spawnPolice, spawnThargoid,
} = await import(join(root, 'web/src/game.js'));
const { quatRotate } = await import(join(root, 'web/src/math.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const shipdata = parsePlist(read('config/shipdata.plist'));
const shipyard = parsePlist(read('config/shipyard.plist'));
const equipment = parsePlist(read('config/equipment.plist'));
const tradeGoods = parsePlist(read('config/trade-goods.plist'));
// no meshes: radiusOf() falls back to 60 m, which is all the AI needs
const assets = { plists: { shipyard, shipdata, equipment, 'trade-goods': tradeGoods },
  parsedMeshes: {} };

const newGame = () => {
  const g = createGame(assets);
  g.rand = () => 1; // pin the jump rolls: nothing here may mis-jump
  launch(g);
  g.entities = g.entities.filter((e) => e.type === 'station');
  g.spawnTimer = 1e9; // the respawn caps get their own game below
  return g;
};
const run = (g, n, input = {}) => {
  for (let i = 0; i < n; i++) stepGame(g, input, 1 / 60);
};
const noInput = () => ({});
const dist = (a, b) => Math.hypot(
  a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
const ahead = (g, m) => [g.player.pos[0], g.player.pos[1], g.player.pos[2] + m];
// an NPC that must not fight back while another ship is checked: turned 90°
// off both the player and anything placed on the +Z line
const sideway = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
const standStill = (g) => { g.player.throttle = 0; g.player.speed = 0; };

// ---- passenger traffic -----------------------------------------------------
const g = newGame();
const seen = new Set();
for (let i = 0; i < 4; i++) seen.add(spawnPassenger(g).shipKey);
assert.deepStrictEqual([...seen].sort(), ['adder', 'cobra3'],
  'the shuttle runs ride the Cobra and the Adder (the Adder has the `shuttle` role)');
const shuttle = g.entities.find((e) => e.role === 'passenger');
assert.ok(shuttle && !shuttle.hostile, 'shuttles spawn non-hostile');
const nose = quatRotate(g.player.quat, [0, 0, 1]);
const rel = [shuttle.pos[0] - g.player.pos[0],
  shuttle.pos[1] - g.player.pos[1], shuttle.pos[2] - g.player.pos[2]];
const along = nose[0] * rel[0] + nose[1] * rel[1] + nose[2] * rel[2];
const range = Math.hypot(rel[0], rel[1], rel[2]);
assert.ok(along > 0 && range >= 1000 && range <= 2800,
  `shuttle spawns ahead of the nose (${range.toFixed(0)} m)`);
assert.strictEqual(shuttle.name, shipdata[`oolite_template_${shuttle.shipKey}`].name,
  'real shipdata name');
assert.strictEqual(shuttle.maxSpeed, shipdata[`oolite_template_${shuttle.shipKey}`].max_flight_speed,
  'real shipdata max_flight_speed');

// ---- a hauler runs once it is hit ------------------------------------------
const haulerG = newGame();
standStill(haulerG);
const hauler = spawnTrader(haulerG);
hauler.pos = ahead(haulerG, 1500);
hauler.quat = [0, 0, 0, 1];
stepGame(haulerG, { fire: true }, 1 / 60);
assert.ok(hauler.energy < hauler.maxEnergy, 'the beam hits the hauler');
assert.strictEqual(hauler.fleeing, true, 'a hit turns a hauler tail-up');
assert.strictEqual(hauler.fleeFrom, haulerG.player, 'running from the commander who shot it');
const d0 = dist(hauler, haulerG.player);
run(haulerG, 60);
assert.ok(dist(hauler, haulerG.player) > d0 + 100, 'and it keeps its distance');
assert.ok(!hauler.hostile, 'a fleeing hauler never turns hostile');

// ---- a shuttle runs from a hostile on sight, before any shot lands ---------
const sightG = newGame();
const sightShuttle = spawnPassenger(sightG);
sightShuttle.pos = ahead(sightG, 1500);
sightShuttle.quat = [0, 0, 0, 1];
const baddie = spawnPirate(sightG);
baddie.pos = ahead(sightG, 1900); // 400 m off the shuttle: inside its nerve
baddie.quat = sideway;            // and pointing nowhere, so nobody fires yet
stepGame(sightG, noInput(), 1 / 60);
assert.strictEqual(sightShuttle.fleeing, true, 'a shuttle runs from a hostile on sight');
assert.strictEqual(sightShuttle.energy, sightShuttle.maxEnergy, 'without being hit first');
assert.strictEqual(sightShuttle.speed, sightShuttle.maxSpeed, 'and away at full throttle');

// ---- pirates attack the shipping, not only the commander -------------------
// The commander 15 km off: inside the 20 km despawn limit, outside the 8 km
// engagement range, so the pirate has nothing but the hauler to fight.
const huntG = newGame();
huntG.player.pos = [15000, 0, 0];
standStill(huntG);
const prey = spawnTrader(huntG);
prey.pos = [0, 0, 0];
prey.quat = [0, 0, 0, 1];
prey.energy = 30; // one volley from wrecked, so the kill is quick
const hunter = spawnPirate(huntG);
hunter.pos = [0, 0, 2000];
hunter.quat = [0, 1, 0, 0]; // already turned onto the hauler
run(huntG, 5);
assert.ok(!prey.alive, 'the pirate destroys the hauler');
assert.ok(huntG.shots.some((s) => s.npc && !s.hostile), 'NPC-on-NPC fire is on the scanner');
assert.strictEqual(huntG.kills, 0, 'a kill the commander did not make pays nothing');
assert.strictEqual(huntG.crime, 0, 'and is no crime of the commander');
assert.ok(huntG.messages.some((m) => m.text.endsWith('DESTROYED')),
  'the sky reports the shipping it lost');

// ---- the police protect a clean commander ----------------------------------
const beatG = newGame();
beatG.crime = 0;
beatG.player.pos = [15000, 0, 0];
standStill(beatG);
const cop = spawnPolice(beatG);
cop.pos = [0, 0, -1500];
cop.quat = [0, 0, 0, 1]; // down the +Z line, at the fight
const raided = spawnPirate(beatG);
raided.pos = [0, 0, 1500];
raided.quat = [0, 1, 0, 0];
run(beatG, 5);
assert.ok(!cop.hostile, 'a clean record keeps the viper on your side');
assert.ok(raided.alive && raided.energy < raided.maxEnergy,
  'the viper shoots the pirate instead of you');
assert.ok(beatG.shots.some((s) => s.npc && !s.hostile), 'with an NPC-on-NPC shot');
assert.ok(!beatG.shots.some((s) => s.hostile), 'and never a shot at the commander');

// ---- Thargoids attack the shipping too -------------------------------------
const alienG = newGame();
alienG.player.pos = [15000, 0, 0];
standStill(alienG);
const alien = spawnThargoid(alienG);
alien.pos = [0, 0, 0];
alien.quat = [0, 0, 0, 1];
const doomed = spawnPassenger(alienG);
doomed.pos = [0, 0, 1500];
doomed.quat = [0, 0, 0, 1];
run(alienG, 5);
assert.ok(doomed.energy < doomed.maxEnergy, 'the alien shoots the shuttle');
assert.ok(alienG.shots.some((s) => s.npc && !s.hostile), 'as an NPC-on-NPC shot');
assert.ok(!alienG.shots.some((s) => s.hostile), 'the commander is too far off to matter');

// ---- a gentler launch: the first hostile waits its turn --------------------
// finishLaunch hands a fresh commander ten seconds of grace: the first
// hostile arrives 2-4 km out, drifts without picking a foe, and holds fire.
const gentleG = createGame(assets);
gentleG.rand = () => 1;
launch(gentleG);
gentleG.spawnTimer = 1e9; // no fresh contacts mid-check: this is about the first one
const first = gentleG.entities.find((e) => e.type === 'ship' && e.hostile);
assert.ok(first, 'launch puts a hostile in the sky');
const firstD = dist(first, gentleG.player);
assert.ok(firstD >= 2000 && firstD <= 4000,
  `it spawns 2-4 km out (${firstD.toFixed(0)} m)`);
assert.ok(first.engageDelay > 0 && first.engageDelay <= 10,
  `with about ten seconds before it engages (${first.engageDelay.toFixed(1)} s)`);
assert.ok(first.fireCooldown > 0, 'and a short delay before its first shot');
standStill(gentleG);
for (let i = 0; i < 9 * 60; i++) stepGame(gentleG, noInput(), 1 / 60);
assert.ok(first.engageDelay > 0, 'after nine seconds it is still waiting');
assert.ok(first.fireCooldown > 0, 'and has not fired once (its cooldown never ran down)');
assert.ok(!gentleG.shots.some((s) => s.hostile), 'and not one shot has reached the commander');
for (let i = 0; i < 2 * 60; i++) stepGame(gentleG, noInput(), 1 / 60);
assert.ok(first.engageDelay <= 0, 'after ten seconds the grace is spent');

// ---- spawn caps: inhabited, not crowded ------------------------------------
const sky = createGame(assets);
sky.rand = () => 1;
launch(sky);
sky.player.throttle = 0;
sky.player.speed = 0;
sky.player.maxShield = 100000; // nothing here may kill the observer
sky.player.fwdShield = 100000;
sky.player.aftShield = 100000;
sky.player.maxEnergy = 100000;
sky.player.energy = 100000;
run(sky, 150 * 60); // 150 s of sky: twelve respawn ticks
const ships = sky.entities.filter((e) => e.type === 'ship');
const hostiles = ships.filter((e) => e.hostile).length;
const peaceful = ships.filter((e) => !e.hostile && e.role !== 'police').length;
assert.ok(ships.length >= 3, `the sky fills up (${ships.length} ships)`);
assert.ok(ships.length <= 5, `but never crowds (${ships.length} ships)`);
assert.ok(hostiles <= 2, `at most two hostiles (${hostiles})`);
assert.ok(peaceful <= 2, `at most one hauler and one shuttle (${peaceful})`);
assert.ok(ships.some((e) => e.role === 'trader') || ships.some((e) => e.role === 'passenger'),
  'with the local traffic still running');

console.log('npcs: all checks passed');
