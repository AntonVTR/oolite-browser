// Headless gameplay checks for the simulation. Run: node tests/test-game.mjs
// Uses the real shipdata.plist and .dat meshes shipped in web/assets.
import assert from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { parseMesh } = await import(join(root, 'web/src/mesh.js'));
const { SHIP_DEFS, resolveTextureName } = await import(join(root, 'web/src/assets.js'));
const { createGame, stepGame, launch, marketFor, buyGood, sellGood, cargoUsed, jump, SYSTEMS,
  spawnPirate, spawnTrader, shipyardFor, tradeInValue, buyShip, zoomScanner, launchMissile,
  activateECM, equipmentFor, buyEquipment, missileCap } =
  await import(join(root, 'web/src/game.js'));
const { Hud } = await import(join(root, 'web/src/hud.js'));
const { distanceLy } = await import(join(root, 'web/src/galaxy.js'));
const { quatRotate } = await import(join(root, 'web/src/math.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const shipdata = parsePlist(read('config/shipdata.plist'));
const shipyard = parsePlist(read('config/shipyard.plist'));
const equipment = parsePlist(read('config/equipment.plist'));
const parsedMeshes = {};
for (const m of ['cobra3', 'mamba', 'krait', 'python', 'cobramk1', 'asp', 'coriolis',
  'anaconda', 'boa', 'boa-mk2', 'gecko', 'viper']) {
  parsedMeshes[m] = parseMesh(read(`models/oolite_${m}.dat`));
}
for (const s of ['faceplate', 'tris', 'dock']) {
  parsedMeshes[`oolite_coriolis_${s}`] = parseMesh(read(`models/oolite_coriolis_${s}.dat`));
}

// Every SHIP_DEFS registration resolves: the shipdata template exists, the
// model file parses, and every material's diffuse texture is shipped on disk.
const onDisk = new Set(readdirSync(join(root, 'web/assets/textures')));
const checkTextures = (modelName, entry) => {
  const parsed = parseMesh(read(`models/${modelName}.dat`));
  for (const mat of parsed.materials) {
    const png = resolveTextureName(mat, entry, modelName);
    assert.ok(png && onDisk.has(png), `${modelName}/${mat} -> ${png} shipped`);
  }
};
for (const [key, def] of Object.entries(SHIP_DEFS)) {
  const entry = shipdata[def.shipKey];
  assert.ok(entry, `shipdata has template ${def.shipKey} (${key})`);
  checkTextures(def.model, entry);
  for (const sub of def.subentities || []) checkTextures(sub, shipdata[sub] || entry);
}

const assets = { plists: { shipyard, shipdata, equipment }, parsedMeshes };
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

// Launch framing: the station has to be ahead of the nose, and a fresh
// contact has to arrive inside the view cone — the old 360°/3–7 km spawn
// put every new ship off-screen, so the sky looked empty.
const nose = quatRotate(g.player.quat, [0, 0, 1]);
const rel = (e) => [e.pos[0] - g.player.pos[0], e.pos[1] - g.player.pos[1], e.pos[2] - g.player.pos[2]];
const ahead = (e) => { const r = rel(e); return nose[0] * r[0] + nose[1] * r[1] + nose[2] * r[2]; };
assert.ok(ahead(g.station) > 0, 'station ahead of the nose at launch');
const fresh = spawnPirate(g);
const freshDist = Math.hypot(rel(fresh)[0], rel(fresh)[1], rel(fresh)[2]);
assert.ok(ahead(fresh) > 0 && freshDist >= 700 && freshDist <= 2000,
  `pirate spawns in view (${freshDist.toFixed(0)} m ahead)`);
g.entities = g.entities.filter((e) => e.type === 'station');

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

// ---- missiles: launch, track, hit -----------------------------------------
g.entities = g.entities.filter((e) => e.type === 'station');
g.player.fwdShield = g.player.maxShield;
g.player.aftShield = g.player.maxShield;
g.player.energy = g.player.maxEnergy;
const quarry = makeTarget({ energy: 150 }); // one blastPower 180 warhead away from wrecked
g.entities.push(quarry);
g.target = quarry;
const pylon0 = g.player.missiles;
assert.strictEqual(g.missiles.length, 0, 'nothing in flight yet');
assert.ok(launchMissile(g), 'missile launches at the locked target');
assert.strictEqual(g.player.missiles, pylon0 - 1, 'the pylon is spent');
assert.strictEqual(g.missiles.length, 1, 'one missile in flight');
assert.strictEqual(g.missiles[0].hostile, false, 'player missiles are not hostile');
// an empty pylon refuses to launch while the lock is good
g.player.missiles = 0;
assert.strictEqual(launchMissile(g), false, 'empty pylons refuse to launch');
g.player.missiles = pylon0 - 1;
g.target = null;
assert.strictEqual(launchMissile(g), false, 'without a lock the launch is refused');
assert.strictEqual(g.player.missiles, pylon0 - 1, 'a refused launch spends no missile');
g.target = quarry;
for (let i = 0; i < 600 && quarry.alive; i++) stepGame(g, noInput(), 1 / 60);
assert.strictEqual(quarry.alive, false, 'the missile tracks its target and hits');
assert.strictEqual(g.missiles.length, 0, 'the missile is spent on impact');
assert.ok(g.explosions.length > 0, 'and the impact blows up');
assert.strictEqual(g.kills, kills0 + 2, 'a missile kill counts like a laser kill');
const kills1 = g.kills;
for (let i = 0; i < 60; i++) stepGame(g, noInput(), 1 / 60);
assert.strictEqual(g.player.missiles, pylon0 - 1, 'missiles are not auto-reloaded');
assert.strictEqual(g.kills, kills1, 'nothing else died in the meantime');

// ---- equipment: ECM is bought, fitted, then fires on a cooldown ------------
g.player.credits = 100000;
const ecmRow = equipmentFor(g).find((r) => r.key === 'EQ_ECM');
assert.ok(ecmRow, 'the station lists the ECM');
assert.strictEqual(ecmRow.price, 6000, 'priced from the real equipment.plist');
assert.strictEqual(g.hasEquipment('EQ_ECM'), false, 'not fitted yet');
assert.strictEqual(activateECM(g), false, 'the ECM refuses to fire unfitted');
assert.ok(buyEquipment(g, 'EQ_ECM'), 'bought at the station');
assert.strictEqual(g.hasEquipment('EQ_ECM'), true, 'fitted after the purchase');
assert.strictEqual(g.player.credits, 94000, 'the ECM costs 6000 CR');
assert.strictEqual(buyEquipment(g, 'EQ_ECM'), false, 'an owned ECM is not sold twice');

// extra missiles go into free pylons only, at the real 300 CR
const cap = missileCap(g);
assert.strictEqual(cap, 4, "the cobra's real max_missiles");
g.player.missiles = cap - 1;
const crBefore = g.player.credits;
assert.ok(buyEquipment(g, 'EQ_MISSILE'), 'a missile fits a free pylon');
assert.strictEqual(g.player.missiles, cap, 'pylon filled');
assert.strictEqual(g.player.credits, crBefore - 300, 'a missile costs 300 CR');
assert.strictEqual(buyEquipment(g, 'EQ_MISSILE'), false, 'full pylons refuse another');

// an incoming missile dies in the ECM sweep, which then goes on cooldown
g.player.energy = g.player.maxEnergy;
g.missiles.push({
  pos: [g.player.pos[0] + 800, g.player.pos[1], g.player.pos[2]],
  vel: [-100, 0, 0], target: g.player, hostile: true, life: 10,
});
assert.ok(activateECM(g), 'the fitted ECM fires');
assert.ok(g.ecmTime > 0, 'and runs for its 2.5 s');
for (let i = 0; i < 10 && g.missiles.length; i++) stepGame(g, noInput(), 1 / 60);
assert.strictEqual(g.missiles.length, 0, 'the sweep jams the inbound missile');
assert.ok(g.player.energy < g.player.maxEnergy, 'ECM drains energy while it runs');
assert.strictEqual(activateECM(g), false, 'and sits on a cooldown afterwards');
g.missiles = [];

// ---- NPC roster: new ships, peaceful traders, break-off ------------------
const distToPlayer = (e) => Math.hypot(
  e.pos[0] - g.player.pos[0], e.pos[1] - g.player.pos[1], e.pos[2] - g.player.pos[2]
);

// traders rotate through every heavy hauler and never turn hostile
g.entities = g.entities.filter((e) => e.type === 'station');
const seenTraders = new Set();
for (let i = 0; i < 8; i++) seenTraders.add(spawnTrader(g).shipKey);
assert.deepStrictEqual([...seenTraders].sort(), ['anaconda', 'boa', 'boa-mk2', 'python'],
  'trader rotation covers the heavy haulers');
assert.ok(g.entities.filter((e) => e.role === 'trader').every((e) => !e.hostile),
  'heavy traders spawn non-hostile');
for (let i = 0; i < 120; i++) stepGame(g, noInput(), 1 / 60);
const stillTrading = g.entities.filter((e) => e.role === 'trader');
assert.ok(stillTrading.length > 0, 'traders survive the simulation');
assert.ok(stillTrading.every((e) => !e.hostile), 'traders stay non-hostile while flying');

// a newly added ship can be spawned and shot down
const anaconda = g.entities.find((e) => e.shipKey === 'anaconda');
assert.ok(anaconda, 'anaconda spawned');
assert.strictEqual(anaconda.maxSpeed, 140, 'anaconda speed from real shipdata');
g.entities = g.entities.filter((e) => e === anaconda || e.type === 'station');
anaconda.pos = [g.player.pos[0], g.player.pos[1], g.player.pos[2] + 4000];
anaconda.quat = [0, 0, 0, 1];
const cr0 = g.player.credits;
for (let i = 0; i < 900 && anaconda.alive; i++) stepGame(g, { fire: true }, 1 / 60);
assert.strictEqual(anaconda.alive, false, 'laser destroys the anaconda');
assert.strictEqual(g.kills, kills0 + 3, 'kill counted (laser, missile, anaconda)');
assert.strictEqual(anaconda.bounty, 0, 'innocent trader carries no bounty');
assert.strictEqual(g.player.credits, cr0, 'so killing it pays nothing');
assert.ok(!g.entities.includes(anaconda), 'anaconda wreck removed');

// combat ships rotate through the hostile roster, all with a bounty
g.entities = g.entities.filter((e) => e.type === 'station');
const seenPirates = new Set();
const pirates = [];
for (let i = 0; i < 6; i++) { const s = spawnPirate(g); pirates.push(s); seenPirates.add(s.shipKey); }
assert.deepStrictEqual([...seenPirates].sort(), ['asp', 'cobramk1', 'gecko', 'krait', 'mamba', 'viper'],
  'pirate rotation covers the combat ships');
assert.ok(pirates.every((s) => s.hostile && s.role === 'pirate' && s.bounty > 0),
  'combat ships spawn hostile with a real bounty');
for (const s of pirates) {
  assert.strictEqual(s.bounty, Math.round(shipdata[`oolite_template_${s.shipKey}`].max_energy / 5),
    `${s.shipKey} bounty derived from the real shipdata max_energy`);
}
g.entities = g.entities.filter((e) => e.type === 'station');

// badly damaged pirates break off instead of fighting to the death
const wounded = spawnPirate(g);
wounded.pos = [g.player.pos[0], g.player.pos[1], g.player.pos[2] + 2500];
wounded.quat = [0, 0, 0, 1];
wounded.energy = Math.max(1, wounded.maxEnergy * 0.02); // below every breakOffAt
stepGame(g, noInput(), 1 / 60);
assert.strictEqual(wounded.breakingOff, true, 'badly damaged pirate breaks off');
assert.ok(!g.shots.some((s) => s.hostile), 'and stops shooting on the way out');
const d0 = distToPlayer(wounded);
for (let i = 0; i < 60; i++) stepGame(g, noInput(), 1 / 60);
assert.ok(distToPlayer(wounded) > d0 + 100, 'and runs away');

// an undamaged pirate keeps its nerve
const healthy = spawnPirate(g);
healthy.pos = [g.player.pos[0], g.player.pos[1], g.player.pos[2] + 2500];
healthy.quat = [0, 1, 0, 0]; // turned to face the player, as an attacker would
healthy.energy = healthy.maxEnergy;
stepGame(g, noInput(), 1 / 60);
assert.ok(!healthy.breakingOff, 'undamaged pirate stands and fights');
assert.ok(g.shots.some((s) => s.hostile), 'and returns fire');

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

// ---- shipyard ---------------------------------------------------------------
const yard0 = shipyardFor(g);
assert.strictEqual(yard0.length, 11, 'eleven player ships for sale');
assert.ok(yard0.every((r, i) => i === 0 || yard0[i - 1].price <= r.price),
  'listed cheapest first');
assert.strictEqual(yard0[0].key, 'adder-player', 'cheapest hull is the adder');
assert.strictEqual(yard0[0].price, 65000, 'real shipyard.plist price, not scaled');
assert.strictEqual(g.player.shipKey, 'cobra3-player');

// trade-in on the starting hull: floor((150000 * 75 * 95 + 5000) / 10000)
const ti0 = tradeInValue(g);
assert.strictEqual(ti0, 106875, 'trade-in is ~71% of hull price');

// affordability is checked before the manifest is sold
const heldRefused = cargoUsed(g);
g.player.credits = 0;
assert.strictEqual(buyShip(g, 'python-player'), false, 'python (200 000) out of reach');
assert.strictEqual(g.player.shipKey, 'cobra3-player', 'refused buy keeps the hull');
assert.strictEqual(g.player.credits, 0, 'refused buy charges nothing');
assert.strictEqual(cargoUsed(g), heldRefused, 'refused buy leaves the manifest alone');

// trade down: the cobra trade-in covers a cheaper hull and pays out the difference
g.player.credits = 5000;
const machPrice = marketFor(g).find((r) => r.key === 'machinery').price;
const held0 = cargoUsed(g);
assert.ok(buyShip(g, 'adder-player'), 'adder costs less than the trade-in');
assert.deepStrictEqual(g.player.cargo, {}, 'manifest sold off with the old hull');
assert.strictEqual(g.player.credits, 5000 + held0 * machPrice + (ti0 - 65000),
  'cash + cargo sale + trade-in - price');
assert.strictEqual(g.player.shipKey, 'adder-player');
assert.strictEqual(g.player.maxCargo, 2, 'adder-player template layer overrides cargo');
assert.strictEqual(g.player.maxSpeed, 240, 'adder stats resolved through like_ship');
assert.strictEqual(g.player.fuel, 70, 'new hull ships with a full tank');
assert.strictEqual(shipyardFor(g).length, 10, 'bought hull leaves the stock');
assert.strictEqual(tradeInValue(g), 46313, 'trade-in follows the new hull');

// the python player hull shares the python mesh for its collision radius
g.player.credits = 300000;
assert.ok(buyShip(g, 'python-player'), 'python affordable with cash');
assert.strictEqual(g.player.radius, parsedMeshes.python.bbox.radius,
  'radius resolved through the -player suffix');
assert.strictEqual(g.player.shipKey, 'python-player');

// ---- radar zoom --------------------------------------------------------------
assert.strictEqual(g.scannerZoom, 1, 'scanner starts at 1x');
for (const want of [2, 3, 4, 5, 1]) {
  assert.strictEqual(zoomScanner(g, 1), want, `zoom in wraps to ${want}`);
}
assert.strictEqual(zoomScanner(g, -1), 1, 'zoom out stops at 1x');

// tap hit-testing against the real hud.plist scanner dial (1280x800)
const hud = new Hud({ width: 0, height: 0, getContext: () => ({}) },
  { plists: { hud: parsePlist(read('config/hud.plist')), crosshairs: {} } });
hud.resize(1280, 800, 1);
// dial: x 0, y 68, y_origin -1, 288x64 -> centre (640, ~687), radii 240 x 53
assert.strictEqual(hud.scannerHit(640, 687), true, 'radar centre is a hit');
assert.strictEqual(hud.scannerHit(875, 687), true, 'radar right edge is a hit');
assert.strictEqual(hud.scannerHit(900, 687), false, 'past the ellipse is not');
assert.strictEqual(hud.scannerHit(640, 400), false, 'screen middle is not the radar');
assert.strictEqual(hud.scannerHit(60, 690), false, 'far left is not the radar');

// ---- jump -----------------------------------------------------------------
launch(g);
const sys0 = g.systemIndex;
const from = SYSTEMS[sys0];
const fuel0 = g.player.fuel; // 70 = 7.0 ly full tank
assert.strictEqual(from.name, 'LAVE', 'the classic starting system');
assert.ok(jump(g), 'jump succeeds with fuel');
assert.notStrictEqual(g.systemIndex, sys0, 'arrived in another system');
const arrived = SYSTEMS[g.systemIndex];
const ly = distanceLy(from, arrived);
assert.ok(ly <= 7, `target inside the 7 ly jump range (${ly} ly)`);
assert.strictEqual(g.player.fuel, fuel0 - Math.round(ly * 10), 'fuel costs the distance');
const stay = g.systemIndex;
g.player.fuel = 0;
assert.strictEqual(jump(g), false, 'no fuel, no jump');
assert.strictEqual(g.systemIndex, stay, 'stays put when the jump fails');

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
