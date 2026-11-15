// Dodo stations (#13): the real planetinfo.plist decides Coriolis vs
// Dodecahedron per system, and the dodecahedron docks under the same rules
// on its own sleeve offset. Run: node tests/test-dodo.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { parseMesh } = await import(join(root, 'web/src/mesh.js'));
const { createGame, stepGame, launch, spawnStation } =
  await import(join(root, 'web/src/game.js'));
const { saveData, parseSave, applySave, serializeSave } =
  await import(join(root, 'web/src/save.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const planetinfo = parsePlist(read('config/planetinfo.plist'));
const parsedMeshes = {
  cobra3: parseMesh(read('models/oolite_cobra3.dat')),
  coriolis: parseMesh(read('models/oolite_coriolis.dat')),
  dodo: parseMesh(read('models/oolite_dodo.dat')),
};
const assets = {
  plists: {
    shipyard: parsePlist(read('config/shipyard.plist')),
    shipdata: parsePlist(read('config/shipdata.plist')),
    planetinfo,
    'trade-goods': parsePlist(read('config/trade-goods.plist')),
  },
  parsedMeshes,
};

const respawn = (g) => {
  g.entities = g.entities.filter((e) => e.type !== 'station');
  g.station = null;
  return spawnStation(g);
};

// ---- the default system keeps its Coriolis --------------------------------
const g = createGame(assets);
assert.strictEqual(g.station.shipKey, 'coriolis', 'Lave is a Coriolis in the real planetinfo');
assert.deepStrictEqual(g.station.dockOffset, [0, 0, 500.2561], 'the Coriolis sleeve offset');
assert.strictEqual(g.station.radius, parsedMeshes.coriolis.bbox.radius, 'real Coriolis mesh');

// ---- a dodecahedron system from the real planetinfo ------------------------
const dodoKeys = Object.keys(planetinfo)
  .filter((k) => k.startsWith('0 ') && planetinfo[k].station === 'dodecahedron');
assert.ok(dodoKeys.length > 0, 'galaxy 1 really has dodecahedron systems');
const dodoIndex = Number(dodoKeys[0].split(' ')[1]);
g.systemIndex = dodoIndex;
const st = respawn(g);
assert.strictEqual(st.shipKey, 'dodo', 'the system gets a Dodo');
assert.strictEqual(st.name, 'Dodecahedron Station');
assert.strictEqual(st.type, 'station');
assert.deepStrictEqual(st.dockOffset, [0, 0, 560.3216], 'its own sleeve offset from shipdata');
assert.strictEqual(st.radius, parsedMeshes.dodo.bbox.radius, 'real dodecahedron mesh');
assert.strictEqual(st.spin, 0.02, 'the same rotation rules as the Coriolis');
// and a system the planetinfo calls coriolis stays coriolis
const corKeys = Object.keys(planetinfo).filter((k) => k.startsWith('0 ')
  && planetinfo[k].station === 'coriolis' && k !== `0 ${dodoIndex}`);
g.systemIndex = Number(corKeys[0].split(' ')[1]);
assert.strictEqual(respawn(g).shipKey, 'coriolis', 'the other systems stay Coriolis');

// ---- docking the dodecahedron under the normal rules -----------------------
g.systemIndex = dodoIndex;
respawn(g);
launch(g);
g.entities = g.entities.filter((e) => e.type === 'station');
g.spawnTimer = 1e9;
g.easyDock = false; // real docking: the slot decides, not the shortcut (#6)
const p = g.player;
p.pos = [0, 0, 560.3216 - 80]; // 80 m inside the Dodo's sleeve, on its axis
p.quat = [0, 1, 0, 0];         // nose into the slot (-Z), rolled with the station
p.speed = 100;                 // under the 120 m/s limit
p.fwdShield = p.maxShield;
p.aftShield = p.maxShield;
stepGame(g, {}, 1 / 60);
assert.strictEqual(g.phase, 'docked', 'a lined-up, slow approach threads the Dodo sleeve');
// (the same spot against the Coriolis offset would sit 20 m short of the
// mouth, not 80 m inside it — the offset is what docked us)

// ---- saves keep their station type -----------------------------------------
const text = serializeSave(g);
const fresh = createGame(assets);
assert.strictEqual(fresh.station.shipKey, 'coriolis', 'a fresh game starts at Lave');
assert.ok(applySave(fresh, parseSave(text)), 'the save loads');
assert.strictEqual(fresh.systemIndex, dodoIndex, 'back into the same system');
assert.strictEqual(fresh.station.shipKey, 'dodo', 'and its own station type comes back');
assert.strictEqual(saveData(fresh).v, 1, 'the save format itself did not change');

console.log('dodo: all checks passed');
