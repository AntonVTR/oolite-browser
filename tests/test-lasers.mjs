// Laser types and mounts (MISSING-FEATURES #16): the real equipment.plist
// laser rows on a forward and an aft mount, their damage/cooldown/heat
// differences, the switch that picks what you shoot, and the save that keeps
// the fit. Run: node tests/test-lasers.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const {
  createGame, stepGame, launch, spawnAsteroid, equipmentFor, buyEquipment,
  cycleLaserMount, syncWeaponState, LASERS,
} = await import(join(root, 'web/src/game.js'));
const { serializeSave, parseSave, applySave } =
  await import(join(root, 'web/src/save.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const shipdata = parsePlist(read('config/shipdata.plist'));
const shipyard = parsePlist(read('config/shipyard.plist'));
const equipment = parsePlist(read('config/equipment.plist'));
const tradeGoods = parsePlist(read('config/trade-goods.plist'));
// no meshes: radiusOf() falls back to 60 m, which is all the ray test needs
const assets = { plists: { shipyard, shipdata, equipment, 'trade-goods': tradeGoods },
  parsedMeshes: {} };

const newGame = () => {
  const g = createGame(assets);
  g.rand = () => 1;
  launch(g);
  g.entities = g.entities.filter((e) => e.type === 'station');
  g.spawnTimer = 1e9; // only the shots below may fill the sky
  return g;
};
const step = (g, input = {}) => stepGame(g, input, 1 / 60);
const hot = (g) => { g.weaponCooldown = 0; g.weaponTemp = 0; g.weaponsOnline = true; };
const makeShip = (g, pos, over = {}) => ({
  type: 'ship', shipKey: 'python', name: 'Python Trader', role: 'trader',
  pos, quat: [0, 0, 0, 1], vel: [0, 0, 0], radius: 60,
  speed: 0, maxSpeed: 200, thrust: 20, pitchRate: 0.8, rollRate: 2, yawRate: 0.2,
  energy: 450, maxEnergy: 450, bounty: 0, hostile: false, fireCooldown: 0, think: 1e9,
  strafePhase: 0, alive: true, color: [0, 1, 0],
  ...over,
});

// ---- the default fit and the shop rows -------------------------------------
const g = newGame();
assert.deepStrictEqual(g.player.weapons, { fore: 'EQ_WEAPON_BEAM_LASER', aft: null },
  'the hull starts with the free forward beam');
assert.strictEqual(g.weaponMount, 'fore', 'primed on the forward mount');
assert.strictEqual(g.weaponKey, 'WEAPON_BEAM_LASER', 'crosshair art from crosshairs.plist');
assert.strictEqual(g.weaponLabel, 'FORE · BEAM', 'HUD line under the crosshair');

const rows = equipmentFor(g);
assert.strictEqual(rows.length, 13, 'thirteen equipment rows in techlevel order');
const row = (key) => rows.find((r) => r.key === key);
for (const [key, price] of [['EQ_WEAPON_PULSE_LASER', 4000],
  ['EQ_WEAPON_BEAM_LASER', 10000], ['EQ_WEAPON_MINING_LASER', 8000]]) {
  const r = row(key);
  assert.ok(r, `the shop sells ${key}`);
  assert.strictEqual(r.price, price, `${key} at its real equipment.plist price`);
  assert.ok(r.laser, 'laser rows carry their mount state');
  assert.ok(r.note.includes('fore: Beam'), `the note reads the mounts (${r.note})`);
}
assert.strictEqual(row('EQ_WEAPON_BEAM_LASER').fore, true, 'the forward beam is marked fitted');
assert.strictEqual(row('EQ_WEAPON_BEAM_LASER').aft, false);
assert.strictEqual(row('EQ_WEAPON_PULSE_LASER').fore, false);

// ---- fitting: the free mount takes the new laser ---------------------------
g.player.credits = 20000;
assert.ok(buyEquipment(g, 'EQ_WEAPON_PULSE_LASER', 'aft'),
  'the pulse laser is bought for the aft mount');
assert.strictEqual(g.player.weapons.aft, 'EQ_WEAPON_PULSE_LASER', 'into the aft mount');
assert.strictEqual(g.player.weapons.fore, 'EQ_WEAPON_BEAM_LASER', 'leaving the forward beam');
assert.strictEqual(g.player.credits, 16000, 'at the plist price');
assert.strictEqual(g.weaponMount, 'aft', 'and primes what was just fitted');
assert.strictEqual(g.weaponKey, 'WEAPON_PULSE_LASER', 'the crosshair follows the mount');
assert.strictEqual(g.weaponLabel, 'AFT · PULSE', 'so does the HUD line');
assert.ok(g.messages.some((m) => m.text === 'PULSE LASER FITTED AFT'), 'and it says so');
assert.strictEqual(buyEquipment(g, 'EQ_WEAPON_PULSE_LASER', 'aft'), false,
  'a laser already in a mount is not sold twice into it');

// ---- the mount switch ------------------------------------------------------
const sw = newGame();
cycleLaserMount(sw);
assert.strictEqual(sw.weaponMount, 'aft', 'T / LASER swaps the primed mount');
assert.strictEqual(sw.weaponLabel, 'AFT · NO LASER', 'with an empty aft mount the line says so');
assert.strictEqual(sw.weaponKey, 'WEAPON_NONE', 'and the no-weapon crosshair');
assert.ok(sw.messages.some((m) => m.text === 'LASER: AFT — NOTHING FITTED'), 'the switch is reported');
cycleLaserMount(sw);
assert.strictEqual(sw.weaponMount, 'fore');
assert.strictEqual(sw.weaponKey, 'WEAPON_BEAM_LASER', 'back to the beam');

// an empty mount refuses to fire instead of firing nothing
sw.player.weapons.fore = null;
syncWeaponState(sw);
hot(sw);
step(sw, { fire: true });
assert.strictEqual(sw.shots.length, 0, 'no laser, no shot');
assert.ok(sw.messages.some((m) => m.text === 'NO LASER FITTED (FORE)'), 'and it says why');

// ---- the aft mount fires astern --------------------------------------------
const rearG = newGame();
rearG.player.credits = 20000;
assert.ok(buyEquipment(rearG, 'EQ_WEAPON_PULSE_LASER', 'aft')); // primes the aft mount
const front = makeShip(rearG, [rearG.player.pos[0], rearG.player.pos[1],
  rearG.player.pos[2] + 1800]);
const behind = makeShip(rearG, [rearG.player.pos[0], rearG.player.pos[1],
  rearG.player.pos[2] - 1800]);
rearG.entities.push(front, behind);
hot(rearG);
step(rearG, { fire: true });
assert.ok(behind.energy < behind.maxEnergy, 'the aft laser hits what is astern');
assert.strictEqual(front.energy, front.maxEnergy, 'and nothing ahead of the nose');

// ---- damage / cooldown / heat per weapon -----------------------------------
// Fire each weapon once into empty space and read the numbers back.
const fireOnce = (key) => {
  const x = newGame();
  x.player.weapons.fore = key;
  syncWeaponState(x);
  hot(x);
  step(x, { fire: true });
  return x;
};
const beamShot = fireOnce('EQ_WEAPON_BEAM_LASER');
assert.strictEqual(beamShot.weaponCooldown, 0.45, 'the beam recharges in 0.45 s');
assert.strictEqual(beamShot.weaponTemp, 55, 'and adds 55 to the weapon dial');
const pulseShot = fireOnce('EQ_WEAPON_PULSE_LASER');
assert.strictEqual(pulseShot.weaponCooldown, 0.9, 'the pulse is half as fast');
assert.strictEqual(pulseShot.weaponTemp, 70, 'and hotter per shot');
assert.ok(pulseShot.weaponCooldown > beamShot.weaponCooldown, 'slower than the beam');
const miningShot = fireOnce('EQ_WEAPON_MINING_LASER');
assert.strictEqual(miningShot.weaponCooldown, 2.5, 'the mining laser is the slow one');
assert.strictEqual(miningShot.weaponTemp, 10, 'and runs cool, as the plist says');
assert.ok(miningShot.weaponTemp < beamShot.weaponTemp, 'cooler than any combat laser');

// one shot into a rock: the damage each weapon really deals
const damageOnRock = (key) => {
  const x = newGame();
  x.player.weapons.fore = key;
  const rock = spawnAsteroid(x, [x.player.pos[0], x.player.pos[1], x.player.pos[2] + 1500]);
  rock.vel = [0, 0, 0];
  hot(x);
  step(x, { fire: true });
  return rock.maxEnergy - rock.energy;
};
assert.strictEqual(damageOnRock('EQ_WEAPON_BEAM_LASER'), 60, 'the beam dents a rock');
assert.strictEqual(damageOnRock('EQ_WEAPON_PULSE_LASER'), 90, 'the pulse hits harder');
assert.strictEqual(damageOnRock('EQ_WEAPON_MINING_LASER'), 120,
  'the mining laser one-shots the 100-energy rock (#12)');
assert.ok(LASERS.EQ_WEAPON_MINING_LASER.range > LASERS.EQ_WEAPON_BEAM_LASER.range,
  'and reaches 12.5 km against the beam\u2019s 6 km');

// ---- saves: the mounts travel, the old flag comes forward -------------------
const s = newGame();
s.phase = 'docked';
s.player.weapons = { fore: 'EQ_WEAPON_MINING_LASER', aft: 'EQ_WEAPON_PULSE_LASER' };
const back = newGame();
assert.strictEqual(applySave(back, parseSave(serializeSave(s))), true, 'save applies');
assert.deepStrictEqual(back.player.weapons,
  { fore: 'EQ_WEAPON_MINING_LASER', aft: 'EQ_WEAPON_PULSE_LASER' }, 'both mounts survive');
assert.strictEqual(back.weaponKey, 'WEAPON_MINING_LASER', 'the crosshair is re-read on load');
assert.strictEqual(back.weaponLabel, 'FORE · MINING', 'and so is the HUD line');

// a save from before the mounts carried its laser as an equipment flag
const legacy = JSON.parse(serializeSave(s));
delete legacy.player.weapons;
legacy.player.equipment = { EQ_WEAPON_MINING_LASER: true, EQ_ECM: true };
const legacyBack = newGame();
assert.strictEqual(applySave(legacyBack, parseSave(JSON.stringify(legacy))), true,
  'the old save still loads');
assert.deepStrictEqual(legacyBack.player.weapons,
  { fore: 'EQ_WEAPON_MINING_LASER', aft: null }, 'its laser comes forward onto the fore mount');
assert.strictEqual(legacyBack.player.equipment.EQ_WEAPON_MINING_LASER, undefined,
  'and leaves the equipment list behind');

// a malformed mount pair refuses the whole save, like a bad crime field
const base = JSON.parse(serializeSave(s));
for (const bad of [
  JSON.stringify({ ...base, player: { ...base.player, weapons: { fore: 'EQ_WEAPON_BOGUS' } } }),
  JSON.stringify({ ...base, player: { ...base.player, weapons: 'fore' } }),
  JSON.stringify({ ...base, player: { ...base.player, weapons: [] } }),
]) {
  assert.strictEqual(parseSave(bad), null, `rejects ${bad.slice(-60)}`);
}

console.log('lasers: all checks passed');
