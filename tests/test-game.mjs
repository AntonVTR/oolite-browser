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
const { createGame, stepGame, launch, launchTrip, marketFor, buyGood, sellGood, cargoUsed, jump, SYSTEMS,
  spawnPirate, spawnTrader, spawnThargoid, shipyardFor, tradeInValue, buyShip, zoomScanner,
  launchMissile, activateECM, equipmentFor, buyEquipment, missileCap, rankName,
  legalStatus, addCrime, spawnPolice, SUN_POS, dock } =
  await import(join(root, 'web/src/game.js'));
const { Hud } = await import(join(root, 'web/src/hud.js'));
const { distanceLy } = await import(join(root, 'web/src/galaxy.js'));
const { quatRotate, quatConjugate } = await import(join(root, 'web/src/math.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const shipdata = parsePlist(read('config/shipdata.plist'));
const shipyard = parsePlist(read('config/shipyard.plist'));
const equipment = parsePlist(read('config/equipment.plist'));
const tradeGoods = parsePlist(read('config/trade-goods.plist'));
const parsedMeshes = {};
for (const m of ['cobra3', 'mamba', 'krait', 'python', 'cobramk1', 'asp', 'coriolis',
  'anaconda', 'boa', 'boa-mk2', 'gecko', 'viper', 'thargoid', 'constrictor', 'adder']) {
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

const assets = { plists: { shipyard, shipdata, equipment, 'trade-goods': tradeGoods }, parsedMeshes };
const noInput = () => ({});

const g = createGame(assets);
g.rand = () => 1; // pin the jump rolls: no mis-jump may fire by chance (#10)
assert.strictEqual(g.phase, 'title');
assert.strictEqual(g.hudVisible, false);
assert.ok(g.station && g.station.type === 'station', 'station spawned');
assert.strictEqual(g.player.maxSpeed, 350, 'real shipdata max_flight_speed');
assert.strictEqual(g.player.maxCargo, 20, 'real shipdata max_cargo');

// ---- combat rating ladder --------------------------------------------------
// Oolite's kill thresholds: 8, 16, 32, 64, 128, 512, 2560, 6400.
const rankCases = [
  [0, 'Harmless'], [7, 'Harmless'],
  [8, 'Mostly Harmless'], [15, 'Mostly Harmless'],
  [16, 'Poor'], [31, 'Poor'],
  [32, 'Average'], [63, 'Average'],
  [64, 'Above Average'], [127, 'Above Average'],
  [128, 'Competent'], [511, 'Competent'],
  [512, 'Dangerous'], [2559, 'Dangerous'],
  [2560, 'Deadly'], [6399, 'Deadly'],
  [6400, 'Elite'], [100000, 'Elite'],
];
for (const [kills, name] of rankCases) {
  assert.strictEqual(rankName(kills), name, `${kills} kills → ${name}`);
}

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
// the lock builds while the reticle holds the target in the forward arc (#18)
for (let i = 0; i < 150 && g.lockProgress < 1; i++) stepGame(g, noInput(), 1 / 60);
assert.strictEqual(g.lockProgress, 1, 'the reticle locks onto the target');
const pylon0 = g.player.missiles;
assert.strictEqual(g.missiles.length, 0, 'nothing in flight yet');
assert.ok(launchMissile(g), 'missile launches at the locked target');
assert.strictEqual(g.player.missiles, pylon0 - 1, 'the pylon is spent');
assert.strictEqual(g.missiles.length, 1, 'one missile in flight');
assert.strictEqual(g.missiles[0].hostile, false, 'player missiles are not hostile');
assert.strictEqual(g.missiles[0].homing, true, 'and a locked launch tracks');
// an empty pylon refuses to launch while the lock is good
g.player.missiles = 0;
assert.strictEqual(launchMissile(g), false, 'empty pylons refuse to launch');
g.player.missiles = pylon0 - 1;
g.target = null;
assert.strictEqual(launchMissile(g), false, 'without a target the launch is refused');
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

// extra missiles go into free pylons only, at the real 300 CR; past the
// hull's own pylons each missile brings its own rack — that is how the port
// sells more pylons (shortcut: Oolite hulls have a fixed pylon count).
const cap = missileCap(g);
assert.strictEqual(cap, 4, "the cobra's real max_missiles");
g.player.missiles = cap - 1;
const crBefore = g.player.credits;
assert.ok(buyEquipment(g, 'EQ_MISSILE'), 'a missile fits a free pylon');
assert.strictEqual(g.player.missiles, cap, 'pylon filled');
assert.strictEqual(g.player.credits, crBefore - 300, 'a missile costs 300 CR');
assert.ok(buyEquipment(g, 'EQ_MISSILE'), 'past the cap the missile brings a pylon');
assert.strictEqual(g.player.missiles, cap + 1, 'so one more missile is carried');
assert.strictEqual(g.player.pylons, cap + 1, 'and the rack is counted');
assert.strictEqual(missileCap(g), cap + 1, 'which raises the pylon count');
assert.strictEqual(g.player.credits, crBefore - 600, 'at the same 300 CR');

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

// ---- thargoid: the alien warship joins the fight ---------------------------
g.entities = g.entities.filter((e) => e.type === 'station');
const alien = spawnThargoid(g);
assert.strictEqual(alien.shipKey, 'thargoid', 'thargoid spawns from its own template');
assert.ok(alien.hostile && alien.role === 'thargoid', 'and is hostile');
assert.strictEqual(alien.name, 'Thargoid Warship', 'real shipdata name');
assert.strictEqual(alien.maxSpeed, 500, 'real shipdata max_flight_speed');
assert.strictEqual(alien.maxEnergy, 600, 'real shipdata max_energy');
assert.strictEqual(alien.bounty, 100, 'real shipdata bounty');
assert.strictEqual(alien.radius, parsedMeshes.thargoid.bbox.radius, 'radius from the real mesh');
// it attacks on sight…
alien.pos = [g.player.pos[0], g.player.pos[1], g.player.pos[2] + 1200];
alien.quat = [0, 1, 0, 0]; // turned to face the player
alien.energy = alien.maxEnergy;
stepGame(g, noInput(), 1 / 60);
assert.ok(g.shots.some((s) => s.hostile), 'the thargoid returns fire');
// …and never runs, however badly hurt
alien.energy = 1;
stepGame(g, noInput(), 1 / 60);
assert.strictEqual(alien.breakingOff, undefined, 'thargoids fight to the death');

// ---- NPC roster: new ships, peaceful traders, break-off ------------------
const distToPlayer = (e) => Math.hypot(
  e.pos[0] - g.player.pos[0], e.pos[1] - g.player.pos[1], e.pos[2] - g.player.pos[2]
);

// traders rotate through every heavy hauler and never turn hostile
g.entities = g.entities.filter((e) => e.type === 'station');
const seenTraders = new Set();
for (let i = 0; i < 10; i++) seenTraders.add(spawnTrader(g).shipKey);
assert.deepStrictEqual([...seenTraders].sort(), ['adder', 'anaconda', 'boa', 'boa-mk2', 'python'],
  'trader rotation covers the peaceful ships');
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
g.crime = 0; // the kills below are the only thing that may dirty the record
for (let i = 0; i < 900 && anaconda.alive; i++) stepGame(g, { fire: true }, 1 / 60);
assert.strictEqual(anaconda.alive, false, 'laser destroys the anaconda');
assert.strictEqual(g.kills, kills0 + 3, 'kill counted (laser, missile, anaconda)');
assert.strictEqual(anaconda.bounty, 0, 'innocent trader carries no bounty');
assert.strictEqual(g.player.credits, cr0, 'so killing it pays nothing');
assert.strictEqual(legalStatus(g.crime), 'Offender', 'killing a trader is a crime');
assert.ok(!g.entities.includes(anaconda), 'anaconda wreck removed');

// combat ships rotate through the hostile roster, all with a bounty
g.entities = g.entities.filter((e) => e.type === 'station');
const seenPirates = new Set();
const pirates = [];
for (let i = 0; i < 7; i++) { const s = spawnPirate(g); pirates.push(s); seenPirates.add(s.shipKey); }
assert.deepStrictEqual([...seenPirates].sort(),
  ['asp', 'cobramk1', 'constrictor', 'gecko', 'krait', 'mamba'],
  'pirate rotation covers the combat ships — vipers are the police now');
assert.ok(pirates.every((s) => s.hostile && s.role === 'pirate' && s.bounty > 0),
  'combat ships spawn hostile with a real bounty');
for (const s of pirates) {
  const tpl = shipdata[`oolite_template_${s.shipKey}`];
  // ships with an explicit shipdata bounty keep it (the constrictor's 250)
  const want = tpl.bounty || Math.round(tpl.max_energy / 5);
  assert.strictEqual(s.bounty, want, `${s.shipKey} bounty from the real shipdata`);
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

// ---- police, crimes and legal status ---------------------------------------
// legal status ladder: Oolite's display thresholds (1 offender, 51 fugitive)
assert.strictEqual(legalStatus(0), 'Clear');
assert.strictEqual(legalStatus(1), 'Offender');
assert.strictEqual(legalStatus(50), 'Offender');
assert.strictEqual(legalStatus(51), 'Fugitive');

// vipers are the police: they patrol while you are clean…
g.crime = 0;
g.entities = g.entities.filter((e) => e.type === 'station');
g.shots = []; // drop the pirate's last volley so the check below is about the cop
const cop = spawnPolice(g);
assert.strictEqual(cop.shipKey, 'viper', 'the viper is the police hull');
assert.strictEqual(cop.role, 'police');
assert.strictEqual(cop.hostile, false, 'a clean commander is not hunted');
cop.pos = [g.player.pos[0], g.player.pos[1], g.player.pos[2] - 1200];
cop.quat = [0, 0, 0, 1]; // right behind the player, aimed up their tail
g.player.fwdShield = g.player.maxShield;
g.player.aftShield = g.player.maxShield;
g.player.energy = g.player.maxEnergy;
stepGame(g, noInput(), 1 / 60);
assert.ok(!g.shots.some((s) => s.hostile), 'and never fire on a clean commander');

// …and hunt you the moment your record is not
addCrime(g, 64);
assert.strictEqual(legalStatus(g.crime), 'Fugitive');
stepGame(g, noInput(), 1 / 60);
assert.ok(g.shots.some((s) => s.hostile), 'a wanted commander is hunted by the police');
g.entities = g.entities.filter((e) => e.type === 'station');

// reset the weapon between the single-shot checks below
const hotWeapon = () => {
  g.weaponCooldown = 0; g.weaponTemp = 0; g.weaponOffline = 0; g.weaponsOnline = true;
};

// firing on an innocent inside the station's protection zone is a crime
g.crime = 0;
g.player.pos = [0, 0, 1500];
g.player.quat = [0, 0, 0, 1];
const inZone = makeTarget({ role: 'trader', pos: [0, 0, 3300] });
g.entities.push(inZone);
hotWeapon();
stepGame(g, { fire: true }, 1 / 60);
assert.strictEqual(inZone.alive, true, 'the shot only wounds the trader');
assert.ok(g.crime > 0, 'shooting an innocent in the protection zone is a crime');
assert.strictEqual(legalStatus(g.crime), 'Offender', 'one offence makes you an Offender');

// the same shot outside the zone is not (shortcut: no crime in open space)
g.crime = 0;
g.entities = g.entities.filter((e) => e.type === 'station');
g.player.pos = [0, 0, 20000];
const outZone = makeTarget({ role: 'trader', pos: [0, 0, 21800] });
g.entities.push(outZone);
hotWeapon();
stepGame(g, { fire: true }, 1 / 60);
assert.strictEqual(outZone.alive, true, 'the shot lands out there too');
assert.strictEqual(g.crime, 0, 'the same shot outside the zone is not a crime');
assert.strictEqual(legalStatus(g.crime), 'Clear');

// killing the police is the one crime that makes you a Fugitive at once
g.crime = 0;
g.entities = g.entities.filter((e) => e.type === 'station');
g.player.pos = [0, 0, 1500];
const doomedCop = spawnPolice(g);
doomedCop.pos = [0, 0, 2700];
doomedCop.quat = [0, 0, 0, 1];
doomedCop.energy = 60; // one beam volley takes it
hotWeapon();
stepGame(g, { fire: true }, 1 / 60);
assert.strictEqual(doomedCop.alive, false, 'the viper is destroyed');
assert.strictEqual(legalStatus(g.crime), 'Fugitive', 'killing the police makes you a Fugitive');

// ---- docking + market -----------------------------------------------------
g.crime = 40; // an offender flies home: docking is what clears the record
g.entities = g.entities.filter((e) => e.type === 'station');
g.player.pos = [0, 0, 300];
g.player.speed = 20;
g.easyDock = true; // this is the assisted shortcut the checkbox turns on (#6)
stepGame(g, noInput(), 1 / 60);
assert.strictEqual(g.phase, 'docked', 'slow near the station docks the ship');
assert.strictEqual(g.crime, 0, 'docking forgives every crime');

const rows = marketFor(g);
assert.strictEqual(rows.length, 17, 'every good of the real trade-goods.plist');
assert.deepStrictEqual(rows.map((r) => r.key),
  ['food', 'textiles', 'radioactives', 'slaves', 'liquor_wines', 'luxuries',
    'narcotics', 'computers', 'machinery', 'alloys', 'firearms', 'furs',
    'minerals', 'gold', 'platinum', 'gem_stones', 'alien_items'],
  'market order is the plist sort_order');
assert.ok(rows.every((r) => r.price > 0 && r.stock >= 0), 'prices and stock come from the plist');
assert.strictEqual(rows.find((r) => r.key === 'food').name, 'Food', 'display name resolved');
assert.strictEqual(rows.find((r) => r.key === 'liquor_wines').name, 'Liquor/Wines');
assert.strictEqual(rows.find((r) => r.key === 'gold').unit, 'kg', 'quantity_unit 1 is kg');
assert.strictEqual(rows.find((r) => r.key === 'gem_stones').unit, 'g', 'quantity_unit 2 is g');
assert.strictEqual(rows.find((r) => r.key === 'alien_items').stock, 0,
  'alien items have no quantity_average, so they are never for sale');

// ---- per-system economics (OOCommodities.m) --------------------------------
// Same system, same market; the economy shifts both numbers the way
// economicBiasForGood / generatePriceForGood / generateQuantityForGood do.
const at = (idx, fn) => {
  const prev = g.systemIndex;
  g.systemIndex = idx;
  const v = fn();
  g.systemIndex = prev;
  return v;
};
const priceAt = (idx, key) => at(idx, () => marketFor(g).find((r) => r.key === key).price);
const stockAt = (idx, key) => at(idx, () => marketFor(g).find((r) => r.key === key).stock);
const econ0 = SYSTEMS.find((s) => s.economy === 0).index; // rich industrial
const econ7 = SYSTEMS.find((s) => s.economy === 7).index; // poor agricultural

assert.ok(priceAt(econ7, 'food') < priceAt(econ0, 'food'),
  'food is cheaper where it is grown');
assert.ok(stockAt(econ7, 'food') > stockAt(econ0, 'food'),
  'and there is more of it for sale there');
assert.ok(priceAt(econ0, 'machinery') < priceAt(econ7, 'machinery'),
  'machinery is cheaper where it is built');

// every price and quantity stays inside the band the plist itself defines
for (const r of rows) {
  const d = tradeGoods[r.key];
  const lo = d.price_average * (1 - d.price_economic - d.price_random) / 10;
  const hi = d.price_average * (1 + d.price_economic + d.price_random) / 10;
  assert.ok(r.price >= lo - 0.1 && r.price <= hi,
    `${r.key} price ${r.price} inside the plist band [${lo}, ${hi}]`);
  const qLo = Math.max(0, Math.trunc(
    d.quantity_average * (1 - d.quantity_economic - d.quantity_random)));
  const qHi = Math.min(127, Math.trunc(
    d.quantity_average * (1 + d.quantity_economic + d.quantity_random)));
  assert.ok(r.stock >= qLo && r.stock <= qHi,
    `${r.key} stock ${r.stock} inside the plist band [${qLo}, ${qHi}]`);
}

// a second commander in the same system gets the same market
const otherG = createGame(assets);
otherG.systemIndex = econ7;
assert.strictEqual(marketFor(otherG).find((r) => r.key === 'food').price,
  priceAt(econ7, 'food'), 'the market is a pure function of the system');
const credits0 = g.player.credits;
const foodStock0 = rows.find((r) => r.key === 'food').stock;
assert.ok(buyGood(g, 'food', 3), 'buy works');
assert.strictEqual(g.player.cargo.food, 3);
assert.ok(g.player.credits < credits0, 'credits spent');
assert.strictEqual(cargoUsed(g), 3);
assert.strictEqual(rows.find((r) => r.key === 'food').stock, foodStock0 - 3,
  'the station sells from its own stock');
assert.ok(sellGood(g, 'food', 3), 'sell works');
assert.strictEqual(g.player.cargo.food, undefined);
assert.strictEqual(rows.find((r) => r.key === 'food').stock, foodStock0,
  'and buys them back into it');
assert.ok(Math.abs(g.player.credits - credits0) < 1e-9, 'round trip is lossless in one system');

// ---- illegal trade ----------------------------------------------------------
const slavesRow = rows.find((r) => r.key === 'slaves');
assert.ok(slavesRow.illegal, 'the market marks slaves as illegal');
assert.ok(!rows.find((r) => r.key === 'food').illegal, 'food carries no mark');
let crime = g.crime;
g.player.cargo.slaves = 4;
assert.ok(sellGood(g, 'slaves', 4), 'the station buys them anyway');
assert.strictEqual(g.crime, crime + 4, 'selling slaves is a crime: one point per tonne');
assert.strictEqual(legalStatus(g.crime), 'Offender', 'and it shows on the record');
crime = g.crime;
g.player.cargo.narcotics = 2;
assert.ok(sellGood(g, 'narcotics', 2), 'narcotics sell too');
assert.strictEqual(g.crime, crime + 4, 'narcotics carry the higher penalty: two per tonne');
// buying contraband is allowed — the crime is selling it
crime = g.crime;
g.player.credits = Math.max(g.player.credits, 1000);
assert.ok(buyGood(g, 'narcotics', 1), 'the market sells narcotics');
assert.strictEqual(g.crime, crime, 'buying illegal goods adds no crime');
assert.ok(sellGood(g, 'narcotics', 1), 'selling them does');
assert.strictEqual(g.crime, crime + 2, 'one more sale, two more points');
g.crime = 0; // leave the record the way docking set it

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
// entities survive docking, so relaunching must not stack a second patrol
const cops0 = g.entities.filter((e) => e.role === 'police').length;
launch(g);
assert.strictEqual(g.entities.filter((e) => e.role === 'police').length, cops0,
  'relaunch keeps the patrol it already has');
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

// ---- equipment range (iteration 3) ------------------------------------------
// A quiet commander for each mechanic: fresh game, contacts switched off.
const quiet = () => {
  const x = createGame(assets);
  launch(x);
  x.entities = x.entities.filter((e) => e.type === 'station');
  x.spawnTimer = 1e9;
  x.player.credits = 1000000;
  return x;
};
const run = (x, input, seconds) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepGame(x, input, 1 / 60);
};

// --- cargo bay, extra energy unit, shield booster: stat modifiers -----------
const stat = quiet();
const bayRow = equipmentFor(stat).find((r) => r.key === 'EQ_CARGO_BAY');
assert.ok(bayRow, 'the station lists the cargo bay');
assert.strictEqual(bayRow.price, 4000, 'at the real equipment.plist price');
assert.strictEqual(stat.player.maxCargo, 20, 'the cobra starts with 20 t');
assert.ok(buyEquipment(stat, 'EQ_CARGO_BAY'), 'bought at the station');
assert.strictEqual(stat.player.maxCargo, 35, 'the hold grows by the shipdata extra_cargo (15 t)');
assert.strictEqual(buyEquipment(stat, 'EQ_CARGO_BAY'), false, 'sold only once');

const energyG = quiet();
energyG.player.energy = 0;
run(energyG, noInput(), 1);
const plain = energyG.player.energy;
energyG.player.energy = 0;
assert.ok(buyEquipment(energyG, 'EQ_ENERGY_UNIT'), 'extra energy unit bought');
run(energyG, noInput(), 1);
assert.ok(energyG.player.energy > plain * 1.5,
  `energy unit recharges ${plain.toFixed(1)} → ${energyG.player.energy.toFixed(1)} in a second`);

const shieldG = quiet();
assert.strictEqual(shieldG.player.maxShield, 150, 'standard shields');
assert.ok(buyEquipment(shieldG, 'EQ_CARGO_BAY'), 'cargo bay bought');
assert.ok(buyEquipment(shieldG, 'EQ_SHIELD_BOOSTER'), 'shield boosters bought');
assert.strictEqual(shieldG.player.maxShield, 278, '150 + the equipment.plist 128');
shieldG.player.fwdShield = 150;
run(shieldG, noInput(), 2);
assert.ok(shieldG.player.fwdShield > 150, 'the boosted shield recharges past the old cap');

// a hull swap keeps the fitted gear's bonuses
buyShip(shieldG, 'adder-player');
assert.strictEqual(shieldG.player.maxCargo, 2 + 15, 'cargo bay follows the new hull');
assert.strictEqual(shieldG.player.maxShield, 278, 'and so do the shield boosters');

// --- fuel injection is bought, not free -------------------------------------
const inject = quiet();
inject.player.throttle = 1;
run(inject, { injectors: true }, 1);
assert.ok(inject.player.speed <= inject.player.maxSpeed + 1,
  'holding BOOST without the equipment does nothing');
assert.ok(buyEquipment(inject, 'EQ_FUEL_INJECTION'), 'fuel injectors bought');
run(inject, { injectors: true }, 1);
assert.ok(inject.player.speed > inject.player.maxSpeed * 2,
  'with them the ship really boosts');

// --- fuel scoops skim the sun -----------------------------------------------
const scoop = quiet();
scoop.player.equipment.EQ_FUEL_SCOOPS = true;
scoop.player.fuel = 10;
scoop.player.pos = SUN_POS.slice(); // straight into the corona
run(scoop, noInput(), 1);
assert.ok(scoop.player.fuel > 10, 'the scoops drink');
assert.ok(scoop.messages.some((m) => m.text === 'FUEL SCOOPING'), 'and say so');
run(scoop, noInput(), 4);
assert.strictEqual(scoop.player.fuel, 70, 'the tank fills to 7.0 ly');
assert.ok(scoop.messages.some((m) => m.text === 'FUEL TANK FULL'), 'and report the full tank');

const dry = quiet();
dry.player.fuel = 10;
dry.player.pos = SUN_POS.slice();
run(dry, noInput(), 2);
assert.strictEqual(dry.player.fuel, 10, 'without the scoops the sun gives nothing');

// --- docking computer: DOCK from anywhere -----------------------------------
const comp = quiet();
assert.ok(buyEquipment(comp, 'EQ_DOCK_COMP'), 'docking computer bought');
assert.strictEqual(equipmentFor(comp).find((r) => r.key === 'EQ_DOCK_COMP').price, 15000,
  'at the real equipment.plist price');
comp.player.pos = [0, 0, -2000];
comp.player.quat = [0, 1, 0, 0]; // turned away from the station
stepGame(comp, { dockRequest: true }, 1 / 60);
assert.strictEqual(comp.autoDock, true, 'DOCK hands the ship to the autopilot');
assert.ok(comp.messages.some((m) => m.text === 'DOCKING COMPUTER ENGAGED'), 'and says so');
run(comp, noInput(), 60);
assert.strictEqual(comp.phase, 'docked', 'auto-docked from 2 km while facing away');
assert.strictEqual(comp.autoDock, false, 'the autopilot lets go on docking');

// --- escape pod: destruction becomes a rescue --------------------------------
const pod = quiet();
pod.player.equipment.EQ_ESCAPE_POD = true;
pod.player.cargo = { food: 4 };
pod.player.fwdShield = 0;
pod.player.aftShield = 0;
pod.player.energy = 1;
pod.entities.push(makeTarget({ hostile: true, role: 'pirate', color: [1, 0, 0],
  quat: [0, 1, 0, 0],
  pos: [pod.player.pos[0], pod.player.pos[1], pod.player.pos[2] + 600], energy: 60 }));
for (let i = 0; i < 900 && pod.phase === 'flight'; i++) stepGame(pod, noInput(), 1 / 60);
assert.strictEqual(pod.phase, 'docked', 'the escape pod brings you back to the station');
assert.strictEqual(pod.player.alive, true, 'the commander survives');
assert.strictEqual(pod.player.shipKey, 'cobra3-player', 'with the ship');
assert.deepStrictEqual(pod.player.cargo, {}, 'but not the cargo');
assert.strictEqual(pod.player.equipment.EQ_ESCAPE_POD, true, 'the pod stays fitted');
assert.ok(pod.player.energy > 0, 'and the banks come back charged');
assert.ok(pod.messages.some((m) => m.text.startsWith('ESCAPE POD')), 'and it says what happened');

// --- extra pylons carry more missiles ---------------------------------------
const racks = quiet();
const cap0 = missileCap(racks);
assert.strictEqual(cap0, 4, "the cobra's own pylons");
racks.player.missiles = cap0;
assert.ok(buyEquipment(racks, 'EQ_MISSILE'), 'a missile past the cap brings a rack');
assert.strictEqual(racks.player.missiles, cap0 + 1, 'one more missile is carried');
assert.strictEqual(racks.player.pylons, cap0 + 1, 'and the rack is counted');
assert.strictEqual(missileCap(racks), cap0 + 1, 'which raises the pylon count');
assert.ok(buyEquipment(racks, 'EQ_MISSILE'), 'and it can be done again');
assert.strictEqual(missileCap(racks), cap0 + 2, 'each rack is kept');

// ---- real docking: match the station, line up, thread the slot (#6) --------
// Every game above runs with the start-screen checkbox off, so these are the
// default rules. A fresh quiet game has the station at the origin with an
// identity orientation, so the slot mouth sits at (0,0,500) and its axis runs
// out along +Z: a clean approach flies -Z, rolled with the station.

// On the axis, nose in, rolled with the station, under the limit — it
// threads the sleeve and docks.
const clean = quiet();
assert.strictEqual(clean.easyDock, false, 'real docking is the default');
clean.player.pos = [0, 0, 900]; // 400 m out from the slot mouth
clean.player.quat = [0, 1, 0, 0]; // nose pointing into the slot (-Z)
clean.player.speed = 100;
clean.player.throttle = 100 / clean.player.maxSpeed;
run(clean, noInput(), 6);
assert.strictEqual(clean.phase, 'docked', 'a slow aligned approach docks');

// Rolled 90° onto the slot: even a slow approach is refused until the ship
// matches the station's rotation — and the scrape costs hull and cargo.
const rolled = quiet();
rolled.player.pos = [0, 0, 900];
rolled.player.quat = [Math.SQRT1_2, Math.SQRT1_2, 0, 0]; // nose in, rolled 90°
rolled.player.speed = 100;
rolled.player.throttle = 100 / rolled.player.maxSpeed;
rolled.player.cargo = { food: 3 };
const rolledShield = rolled.player.fwdShield;
run(rolled, noInput(), 6);
assert.notStrictEqual(rolled.phase, 'docked', 'a rolled approach never docks');
assert.ok(rolled.player.fwdShield < rolledShield, 'the scrape costs shield');
assert.ok(cargoUsed(rolled) < 3, 'and it costs cargo');

// Hot on the lane: the corridor spits the ship out and takes hull and cargo.
const hot = quiet();
hot.player.pos = [0, 0, 900];
hot.player.quat = [0, 1, 0, 0];
hot.player.speed = 400;
hot.player.throttle = 1;
hot.player.cargo = { food: 3 };
const hotShield = hot.player.fwdShield;
run(hot, noInput(), 6);
assert.notStrictEqual(hot.phase, 'docked', 'a hot approach never docks');
assert.ok(hot.player.fwdShield < hotShield, 'and it costs shield');
assert.ok(cargoUsed(hot) < 3, 'and it costs cargo');

// Easy mode (the checkbox on) keeps the shortcut: success is the market dock
// above; a DOCK request over 250 m/s is refused, contact or not.
const easyFast = quiet();
easyFast.easyDock = true;
easyFast.player.pos = [0, 0, 1000]; // inside the 1500 m DOCK range
easyFast.player.speed = 300;
stepGame(easyFast, { dockRequest: true }, 1 / 60);
assert.strictEqual(easyFast.phase, 'flight', 'a hot DOCK request is refused');

// ---- the launch ride (#6) --------------------------------------------------
// Ten seconds in the tube, then the old launch framing: the ship ends at the
// path's end in the station frame, nose back along the path with the station
// ahead of it, at the launch speed and throttle.
const trip = createGame(assets);
launchTrip(trip);
assert.ok(trip.launchSeq > 9, 'the ride starts with ten seconds to go');
assert.strictEqual(trip.phase, 'flight', 'and the ship is already in flight');
for (let i = 0; i < 610 && trip.launchSeq > 0; i++) stepGame(trip, noInput(), 1 / 60);
assert.strictEqual(trip.launchSeq, 0, 'the ride ends after ten seconds');
assert.ok(trip.messages.some((m) => m.text.startsWith('LAUNCHED')), 'and says LAUNCHED');
assert.strictEqual(trip.player.speed, 150, 'hands over at the launch speed');
assert.strictEqual(trip.player.throttle, 0.45, 'and the launch throttle');
const stPos = trip.station.pos;
const stInv = quatConjugate(trip.station.quat);
const local = quatRotate(stInv, [
  trip.player.pos[0] - stPos[0], trip.player.pos[1] - stPos[1], trip.player.pos[2] - stPos[2],
]);
assert.ok(Math.abs(local[0] + 1200) < 1 && Math.abs(local[1]) < 1 && Math.abs(local[2] - 2400) < 1,
  'ends at the launch framing point, offset to clear the hull');
const tripNose = quatRotate(stInv, quatRotate(trip.player.quat, [0, 0, 1]));
assert.ok(tripNose[2] < -0.99 && Math.abs(tripNose[0]) < 0.01,
  'with the nose back along the path, station ahead of it');

// ---- trumbles (#23) ---------------------------------------------------------
// The C64's cargo-eating pet: one crawls aboard on a docked arrival with
// cargo in the hold (1/8), and from then on every arrival costs it a tonne.
const tr = createGame(assets);
launch(tr);
tr.entities = tr.entities.filter((e) => e.type === 'station');
tr.spawnTimer = 1e9;
assert.strictEqual(tr.trumbles, 0, 'a fresh commander has no trumble');
assert.ok(buyGood(tr, 'food', 3), 'and a hold with food in it');
tr.rand = () => 0.5; // 0.5 >= 1/8: the roll misses
dock(tr);
assert.strictEqual(tr.trumbles, 0, 'the 1/8 roll misses');
tr.rand = () => 0; // 0 < 1/8: the pet boards
dock(tr);
assert.strictEqual(tr.trumbles, 1, 'the next dock boards one');
assert.ok(tr.messages.some((m) => m.text === 'A TRUMBLE CRAWLS ABOARD'),
  'and the HUD says so');
dock(tr);
assert.strictEqual(tr.trumbles, 1, 'a second trumble never joins the first');
launch(tr); // back in the air with the pet aboard
tr.rand = () => 1; // a clean jump roll (no witchspace intercept)
const food0 = tr.player.cargo.food;
assert.ok(jump(tr), 'the jump fires');
assert.strictEqual(tr.player.cargo.food, food0 - 1, 'the trumble ate a tonne of food');
assert.ok(tr.messages.some((m) => m.text.includes('TRUMBLE ATE 1 t OF FOOD')),
  'and the HUD says what it ate');
assert.strictEqual(tr.trumbles, 1, 'it is still aboard afterwards');

console.log('game: all checks passed');
