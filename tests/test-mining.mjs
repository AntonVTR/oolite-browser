// Asteroid mining (#12): real rocks in the sky, the mining laser from
// equipment.plist, and ore that pays at the market. Run: node tests/test-mining.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const {
  createGame, stepGame, launch, spawnAsteroid, spawnAsteroidField, ORE_GOODS,
  sellGood, equipmentFor, buyEquipment, cargoUsed,
} = await import(join(root, 'web/src/game.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const assets = {
  plists: {
    shipyard: parsePlist(read('config/shipyard.plist')),
    shipdata: parsePlist(read('config/shipdata.plist')),
    equipment: parsePlist(read('config/equipment.plist')),
    'trade-goods': parsePlist(read('config/trade-goods.plist')),
  },
  parsedMeshes: {},
};

const g = createGame(assets);
launch(g);
g.entities = g.entities.filter((e) => e.type === 'station');
g.spawnTimer = 1e9;
const step = (input = {}) => stepGame(g, input, 1 / 60);
const ahead = (m) => [g.player.pos[0], g.player.pos[1], g.player.pos[2] + m];

// ---- the field ------------------------------------------------------------
const n1 = spawnAsteroidField(g);
const rocks = g.entities.filter((e) => e.type === 'rock');
assert.strictEqual(rocks.length, n1, 'the field is out there');
assert.ok(n1 >= 1 && n1 <= 7, `1-7 rocks per system (${n1})`);
assert.strictEqual(rocks[0].energy, 100, 'real shipdata oolite_template_asteroid max_energy');
assert.strictEqual(rocks[0].bounty, 10, 'the small fee for destroying one');
// the count comes from the (galaxy, system) pair, so it is the same field
// on every launch in this system
g.entities = g.entities.filter((e) => e.type === 'station');
assert.strictEqual(spawnAsteroidField(g), n1, 'the field is deterministic per system');

// ---- breaking a rock with the standard laser -------------------------------
const rock = g.entities.find((e) => e.type === 'rock');
rock.pos = ahead(1500);
rock.vel = [0, 0, 0];
step({ fire: true }); // first shot
assert.ok(rock.alive, 'one pulse-laser shot only dents a rock (60 vs 100)');
for (let i = 0; i < 60 && rock.alive; i++) step({ fire: true });
assert.ok(!rock.alive, 'the second shot breaks it');
const ore = g.entities.filter((e) => e.type === 'cargo' && e.cargo
  && ORE_GOODS.includes(e.cargo.good));
assert.ok(ore.length >= 1, 'the rock releases ore canisters');

// ---- scooping the ore and selling it ---------------------------------------
g.player.equipment.EQ_FUEL_SCOOPS = true;
ore[0].pos = ahead(100);
step();
assert.ok(!g.entities.includes(ore[0]), 'the scoops take the ore');
assert.strictEqual(cargoUsed(g), ore[0].cargo.qty, 'its tonnes are in the hold');
const credits0 = g.player.credits;
const good = ore[0].cargo.good;
const sold = sellGood(g, good, ore[0].cargo.qty);
assert.ok(sold, `the station buys ${good}`);
assert.ok(g.player.credits > credits0, `the ore paid out (${g.player.credits - credits0} CR)`);

// ---- the mining laser ------------------------------------------------------
const row = equipmentFor(g).find((r) => r.key === 'EQ_WEAPON_MINING_LASER');
assert.ok(row, 'the shop sells the Mining Laser');
assert.strictEqual(row.price, 8000, 'the real equipment.plist price');

// out of the standard beam's 6 km but inside the mining laser's 12.5 km
const far = spawnAsteroid(g, ahead(7000));
far.vel = [0, 0, 0];
g.weaponCooldown = 0;
g.weaponTemp = 0;
g.weaponsOnline = true;
step({ fire: true });
assert.ok(far.alive, 'the standard beam does not reach 7 km');
g.player.credits = 10000;
assert.ok(buyEquipment(g, 'EQ_WEAPON_MINING_LASER'),
  'the Mining Laser is bought and fitted to the forward mount (#16)');
g.weaponCooldown = 0;
g.weaponTemp = 0; // the real shot_temperature of 10 per shot, not 55
step({ fire: true });
assert.ok(!far.alive, 'the mining laser reaches it and breaks the rock in one shot');
assert.strictEqual(g.weaponTemp, 10, 'the mining laser runs cool (real shot_temperature)');

console.log('mining: all checks passed');
