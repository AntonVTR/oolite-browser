// Fuel scooping (#11): kills leave cargo canisters (and wrecks an escape
// capsule) that EQ_FUEL_SCOOPS collects, and the scoop dial's data follows
// the state. Run: node tests/test-scoop.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { createGame, stepGame, launch, spawnCargo, spawnEscapeCapsule, cargoUsed } =
  await import(join(root, 'web/src/game.js'));
const { Hud } = await import(join(root, 'web/src/hud.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const assets = {
  plists: {
    shipyard: parsePlist(read('config/shipyard.plist')),
    shipdata: parsePlist(read('config/shipdata.plist')),
    'trade-goods': parsePlist(read('config/trade-goods.plist')),
  },
  parsedMeshes: {},
};

const g = createGame(assets);
launch(g);
g.entities = g.entities.filter((e) => e.type === 'station'); // no random wingmen
g.spawnTimer = 1e9; // no random contacts while the scoop rules are checked
const step = () => stepGame(g, {}, 1 / 60);
const ahead = (m) => [g.player.pos[0], g.player.pos[1], g.player.pos[2] + m];
const behind = (m) => [g.player.pos[0], g.player.pos[1], g.player.pos[2] - m];

// ---- the dial data --------------------------------------------------------
assert.strictEqual(g.scoopStatus, 'none', 'a fresh commander has no scoop dial');
const free = spawnCargo(g, ahead(100), 'gold', 2);
step();
assert.ok(g.entities.includes(free), 'without EQ_FUEL_SCOOPS a canister floats on');
assert.strictEqual(g.scoopStatus, 'none', 'the dial stays hidden unscooped');

// ---- canister pickup ------------------------------------------------------
g.player.equipment.EQ_FUEL_SCOOPS = true;
step();
assert.ok(!g.entities.includes(free), 'the scoops take a canister ahead of the nose');
assert.strictEqual(g.player.cargo.gold, 2, 'its tonnes go into the hold');
assert.strictEqual(cargoUsed(g), 2, 'the manifest counts them');
assert.strictEqual(g.scoopStatus, 'active', 'a fresh scoop lights the dial');

// behind the nose the scoops do not reach
const rear = spawnCargo(g, behind(100), 'gold', 1);
step();
assert.ok(g.entities.includes(rear), 'the scoops only face forward');
rear.alive = false;
g.entities = g.entities.filter((e) => e.alive);

// let the dial settle back to okay
for (let i = 0; i < 90; i++) step();
assert.strictEqual(g.scoopStatus, 'okay', 'free scoops read okay');

// ---- a full hold ----------------------------------------------------------
g.scoopT = 0;
g.player.cargo = { food: g.player.maxCargo };
const blocked = spawnCargo(g, ahead(100), 'gold', 1);
step();
assert.ok(g.entities.includes(blocked), 'a full hold takes no more cargo');
assert.strictEqual(g.scoopStatus, 'full', 'the dial reads full');
assert.ok(g.messages.some((m) => m.text === 'HOLD FULL'), 'and the HUD says so');
blocked.alive = false;
g.entities = g.entities.filter((e) => e.alive);
g.player.cargo = {};
g.scoopT = 0;
step();
assert.strictEqual(g.scoopStatus, 'okay', 'emptying the hold frees the dial again');

// ---- escape capsule from a wreck ------------------------------------------
const pod = spawnEscapeCapsule(g, ahead(100));
step();
assert.ok(!g.entities.includes(pod), 'an escape capsule is scooped too');
assert.strictEqual(cargoUsed(g), 0, 'the crew is the payload, not cargo');
assert.ok(g.messages.some((m) => m.text === 'ESCAPE POD RESCUED'), 'the rescue is reported');

// ---- a kill drops loot ----------------------------------------------------
const victim = {
  type: 'ship', shipKey: 'python', name: 'Python Trader', role: 'trader',
  pos: ahead(1800), quat: [0, 0, 0, 1], vel: [0, 0, 0],
  radius: 60, speed: 100, maxSpeed: 200, thrust: 20, pitchRate: 0.8, rollRate: 2,
  yawRate: 0.2, energy: 200, maxEnergy: 200, bounty: 0, hostile: false,
  fireCooldown: 0, think: 1e9, strafePhase: 0, alive: true, color: [0, 1, 0],
};
g.entities.push(victim);
for (let i = 0; i < 600 && victim.alive; i++) stepGame(g, { fire: true }, 1 / 60);
assert.ok(!victim.alive, 'the laser kills the target');
const loot = g.entities.filter((e) => e.type === 'cargo' && e.cargo);
assert.ok(loot.length >= 1, 'the wreck leaves at least one cargo canister');

// and that canister can be scooped like any other
const drop = loot[0];
drop.pos = ahead(100);
g.player.cargo = {};
step();
assert.ok(!g.entities.includes(drop), 'loot from a wreck scoops the same way');
assert.strictEqual(cargoUsed(g), drop.cargo.qty, 'with its tonnes in the hold');

// ---- the dial itself draws ------------------------------------------------
// A recording 2D context: every method call is logged, so "the dial drew" is
// "ctx.fill() happened".
const log = [];
const ctx = new Proxy({}, {
  get: (t, k) => (typeof k === 'symbol' ? undefined : () => { log.push(k); }),
  set: () => true,
});
const hud = new Hud({ width: 0, height: 0, getContext: () => ctx },
  { plists: { hud: parsePlist(read('config/hud.plist')), crosshairs: {} } });
hud.resize(1280, 800, 1);
hud.g = g;
const info = { x: -132, y: 92, y_origin: -1, alpha: 0.75 };
const fills = () => log.filter((k) => k === 'fill').length;

log.length = 0;
g.scoopStatus = 'none';
hud.drawScoopStatus(info);
assert.strictEqual(fills(), 0, 'no scoops fitted: the dial draws nothing');

for (const status of ['okay', 'active', 'full']) {
  log.length = 0;
  g.scoopStatus = status;
  hud.drawScoopStatus(info);
  assert.strictEqual(fills(), 5, `${status} draws all three sections`);
}
g.scoopStatus = 'okay';

console.log('scoop: all checks passed');
