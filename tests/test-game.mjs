// Headless gameplay checks for the simulation. Run: node tests/test-game.mjs
// Uses the real shipdata.plist and .dat meshes shipped in web/assets.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { parseMesh } = await import(join(root, 'web/src/mesh.js'));
const { createGame, stepGame, launch, marketFor, buyGood, sellGood, cargoUsed, jump, SYSTEMS } =
  await import(join(root, 'web/src/game.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const shipdata = parsePlist(read('config/shipdata.plist'));
const parsedMeshes = {};
for (const m of ['cobra3', 'mamba', 'krait', 'python', 'cobramk1', 'asp', 'coriolis']) {
  parsedMeshes[m] = parseMesh(read(`models/oolite_${m}.dat`));
}
for (const s of ['faceplate', 'tris', 'dock']) {
  parsedMeshes[`oolite_coriolis_${s}`] = parseMesh(read(`models/oolite_coriolis_${s}.dat`));
}

const assets = { plists: { shipdata }, parsedMeshes };
const noInput = () => ({});

const g = createGame(assets);
assert.strictEqual(g.phase, 'title');
assert.strictEqual(g.hudVisible, false);
assert.ok(g.station && g.station.type === 'station', 'station spawned');
assert.strictEqual(g.player.maxSpeed, 350, 'real shipdata max_flight_speed');
assert.strictEqual(g.player.maxCargo, 20, 'real shipdata max_cargo');

// ---- launch + flight ------------------------------------------------------
launch(g);
assert.strictEqual(g.phase, 'flight');
assert.strictEqual(g.hudVisible, true);
// keep the world quiet and deterministic for the rest of the checks
g.entities = g.entities.filter((e) => e.type === 'station');
g.spawnTimer = 1e9;

const start = g.player.pos.slice();
for (let i = 0; i < 60; i++) stepGame(g, noInput(), 1 / 60);
const moved = Math.hypot(
  g.player.pos[0] - start[0], g.player.pos[1] - start[1], g.player.pos[2] - start[2]
);
assert.ok(moved > 50, `ship actually moves (${moved.toFixed(0)} m)`);

// HUD contract: everything hud.js reads must exist after a step
assert.strictEqual(g.playerRel.length, 9);
assert.strictEqual(typeof g.scannerEntities, 'function');
assert.ok(Array.isArray(g.scannerEntities()));
assert.ok(g.compass, 'compass target set');
for (const k of ['energy', 'maxEnergy', 'fwdShield', 'aftShield', 'maxShield', 'fuel',
  'cabinTemp', 'weaponTemp', 'missiles', 'pos', 'quat']) {
  assert.ok(g.player[k] !== undefined, `player.${k} present`);
}
assert.strictEqual(typeof g.dialSpeed, 'number');
assert.strictEqual(typeof g.alert, 'string');

// ---- combat: shoot a target down -----------------------------------------
const makeTarget = (over) => ({
  type: 'ship', shipKey: 'python', name: 'Python Trader', role: 'trader',
  pos: [g.player.pos[0], g.player.pos[1], g.player.pos[2] + 1800],
  quat: [0, 0, 0, 1], vel: [0, 0, 0], radius: parsedMeshes.python.bbox.radius,
  speed: 0, maxSpeed: 200, thrust: 20, pitchRate: 0.8, rollRate: 2, yawRate: 0.2,
  energy: 450, maxEnergy: 450, bounty: 0, hostile: false, fireCooldown: 0, think: 0,
  strafePhase: 0, alive: true, color: [0, 1, 0],
  ...over,
});

const victim = makeTarget({});
g.entities.push(victim);
const kills0 = g.kills;
for (let i = 0; i < 600 && g.kills === kills0; i++) stepGame(g, { fire: true }, 1 / 60);
assert.strictEqual(g.kills, kills0 + 1, 'laser destroys the target');
assert.ok(!g.entities.includes(victim), 'wreck removed from the world');

// ---- taking damage --------------------------------------------------------
g.entities = g.entities.filter((e) => e.type === 'station');
g.player.fwdShield = g.player.maxShield;
g.player.aftShield = g.player.maxShield;
g.player.energy = g.player.maxEnergy;
const shooter = makeTarget({ hostile: true, role: 'pirate', bounty: 40, color: [1, 0, 0],
  quat: [0, 1, 0, 0], // facing back at the player, as a real attacker would
  pos: [g.player.pos[0], g.player.pos[1], g.player.pos[2] + 600], energy: 60 });
g.entities.push(shooter);
for (let i = 0; i < 600
  && g.player.energy >= g.player.maxEnergy
  && g.player.fwdShield >= g.player.maxShield
  && g.phase === 'flight'; i++) {
  stepGame(g, noInput(), 1 / 60);
}
assert.ok(
  g.player.energy < g.player.maxEnergy || g.player.fwdShield < g.player.maxShield,
  'incoming fire drains shields/energy'
);

// ---- docking + market -----------------------------------------------------
g.entities = g.entities.filter((e) => e.type === 'station');
g.player.pos = [0, 0, 300];
g.player.speed = 20;
stepGame(g, noInput(), 1 / 60);
assert.strictEqual(g.phase, 'docked', 'slow near the station docks the ship');

const rows = marketFor(g);
assert.strictEqual(rows.length, 6, 'six commodities');
assert.ok(rows.every((r) => r.price > 0 && r.stock > 0));
const credits0 = g.player.credits;
assert.ok(buyGood(g, 'food', 3), 'buy works');
assert.strictEqual(g.player.cargo.food, 3);
assert.ok(g.player.credits < credits0, 'credits spent');
assert.strictEqual(cargoUsed(g), 3);
assert.ok(sellGood(g, 'food', 3), 'sell works');
assert.strictEqual(g.player.cargo.food, undefined);
assert.ok(Math.abs(g.player.credits - credits0) < 1e-9, 'round trip is lossless in one system');

g.player.credits = 100000;
for (let i = 0; i < 30; i++) buyGood(g, 'machinery', 5);
assert.ok(cargoUsed(g) <= g.player.maxCargo, 'cargo hold cap respected');

// ---- jump -----------------------------------------------------------------
launch(g);
const sys0 = g.systemIndex;
const fuel0 = g.player.fuel;
assert.ok(jump(g), 'jump succeeds with fuel');
assert.strictEqual(g.systemIndex, (sys0 + 1) % SYSTEMS.length);
assert.strictEqual(g.player.fuel, fuel0 - 10);
g.player.fuel = 0;
assert.strictEqual(jump(g), false, 'no fuel, no jump');

// ---- death ----------------------------------------------------------------
g.entities = g.entities.filter((e) => e.type === 'station');
g.player.fuel = 70;
g.player.fwdShield = 0;
g.player.aftShield = 0;
g.player.energy = 1;
g.entities.push(makeTarget({ hostile: true, role: 'pirate', color: [1, 0, 0],
  quat: [0, 1, 0, 0],
  pos: [g.player.pos[0], g.player.pos[1], g.player.pos[2] + 600], energy: 60 }));
for (let i = 0; i < 900 && g.phase === 'flight'; i++) stepGame(g, noInput(), 1 / 60);
assert.strictEqual(g.phase, 'dead', 'player can be killed');

console.log('game: all checks passed');
