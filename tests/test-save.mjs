// Save/load checks: round trip through localStorage-shaped storage, and the
// guarantee that an old or corrupt save is rejected instead of crashing.
// Run: node tests/test-save.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { createGame, launch, buyGood, dock, cargoUsed } =
  await import(join(root, 'web/src/game.js'));
const { quatRotate } = await import(join(root, 'web/src/math.js'));
const {
  saveData, serializeSave, parseSave, applySave, saveGame, loadGame, hasSave,
  defaultStorage, SAVE_KEY, SAVE_VERSION,
} = await import(join(root, 'web/src/save.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const shipdata = parsePlist(read('config/shipdata.plist'));
const shipyard = parsePlist(read('config/shipyard.plist'));
// no meshes: radiusOf() falls back to 60 m, which is enough for save logic
const assets = { plists: { shipyard, shipdata }, parsedMeshes: {} };
const newGame = () => createGame(assets);

// Map-backed stand-in for localStorage (node has none).
function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

// ---- round trip: docked -----------------------------------------------------
const g = newGame();
launch(g);
g.entities = g.entities.filter((e) => e.type === 'station');
g.spawnTimer = 1e9;
g.player.credits = 5000;
assert.ok(buyGood(g, 'food', 4), 'buy cargo to carry across the save');
g.systemIndex = 42; // pretend we jumped on
g.kills = 3;
dock(g);
assert.strictEqual(g.phase, 'docked');

const text = serializeSave(g);
assert.strictEqual(saveData(g).v, SAVE_VERSION, 'save carries its version');

const back = newGame();
assert.strictEqual(applySave(back, parseSave(text)), true, 'save applies');
assert.strictEqual(back.phase, 'docked');
assert.strictEqual(back.hudVisible, false);
assert.strictEqual(back.systemIndex, 42);
assert.strictEqual(back.kills, 3);
assert.strictEqual(back.player.credits, g.player.credits);
assert.strictEqual(back.player.fuel, g.player.fuel);
assert.strictEqual(back.player.shipKey, 'cobra3-player');
assert.deepStrictEqual(back.player.cargo, g.player.cargo, 'manifest survives');
assert.strictEqual(cargoUsed(back), 4);
assert.ok(back.entities.every((e) => e.type === 'station'),
  'world is rebuilt, not saved');
assert.ok(back.shots.length === 0 && back.explosions.length === 0);

// ---- round trip: flight -----------------------------------------------------
const flying = newGame();
launch(flying);
flying.entities = flying.entities.filter((e) => e.type === 'station');
flying.spawnTimer = 1e9;
flying.player.credits = 777;
const restored = newGame();
assert.strictEqual(applySave(restored, parseSave(serializeSave(flying))), true);
assert.strictEqual(restored.phase, 'flight');
assert.strictEqual(restored.hudVisible, true, 'HUD comes back with the ship');
assert.strictEqual(restored.player.credits, 777);
// framed on the station the way a launch or a jump leaves it
const nose = quatRotate(restored.player.quat, [0, 0, 1]);
const st = restored.station;
const rel = [st.pos[0] - restored.player.pos[0], st.pos[1] - restored.player.pos[1],
  st.pos[2] - restored.player.pos[2]];
assert.ok(nose[0] * rel[0] + nose[1] * rel[1] + nose[2] * rel[2] > 0,
  'restored flight starts with the station ahead');
assert.ok(restored.entities.some((e) => e.type === 'ship' && e.hostile),
  'contacts respawned in flight');

// ---- storage ----------------------------------------------------------------
assert.strictEqual(defaultStorage(), null, 'node has no localStorage');
assert.strictEqual(saveGame(g, null), false, 'no storage, no save, no throw');
assert.strictEqual(loadGame(newGame(), null), false);
assert.strictEqual(hasSave(null), false);

const store = fakeStorage();
assert.strictEqual(hasSave(store), false, 'no save yet');
assert.strictEqual(saveGame(g, store), true);
assert.strictEqual(hasSave(store), true, 'save is there');
const loaded = newGame();
assert.strictEqual(loadGame(loaded, store), true);
assert.strictEqual(loaded.phase, 'docked');
assert.strictEqual(loaded.systemIndex, 42);
assert.strictEqual(loaded.player.credits, g.player.credits);

// a title-screen game is never written out (nothing worth continuing)
const atTitle = newGame();
atTitle.player.credits = 999;
assert.strictEqual(saveGame(atTitle, store), false);
assert.strictEqual(parseSave(store.getItem(SAVE_KEY)).player.credits, g.player.credits,
  'the existing save is left alone');

// ---- old / corrupt saves never crash ---------------------------------------
const base = JSON.parse(serializeSave(g));
const bad = [
  '{oops',
  '',
  'null',
  '42',
  '"text"',
  JSON.stringify({ ...base, v: SAVE_VERSION + 1 }),          // future version
  JSON.stringify({ ...base, v: 0 }),                          // old version
  JSON.stringify({ ...base, phase: 'title' }),                // never a real phase
  JSON.stringify({ ...base, phase: 'dead' }),
  JSON.stringify({ ...base, systemIndex: 999 }),              // outside the galaxy
  JSON.stringify({ ...base, systemIndex: 7.5 }),
  JSON.stringify({ ...base, kills: -1 }),
  JSON.stringify({ ...base, player: null }),
  JSON.stringify({ ...base, player: { ...base.player, shipKey: '' } }),
  JSON.stringify({ ...base, player: { ...base.player, cargo: { food: 'lots' } } }),
  JSON.stringify({ ...base, player: { ...base.player, credits: 'NaN' } }),
  JSON.stringify({ ...base, player: { ...base.player, fuel: null } }),
  JSON.stringify({ ...base, player: { ...base.player, maxSpeed: undefined } }),
];
for (const text2 of bad) {
  assert.strictEqual(parseSave(text2), null, `rejects ${JSON.stringify(text2).slice(0, 48)}`);
}
assert.strictEqual(applySave(newGame(), null), false);
assert.strictEqual(applySave(newGame(), {}), false);
assert.strictEqual(applySave(newGame(), JSON.parse(JSON.stringify({ ...base, v: 99 }))), false);

// a corrupt blob in storage: hasSave/loadGame say no and leave the game alone
store.setItem(SAVE_KEY, '{corrupt');
assert.strictEqual(hasSave(store), false);
const untouched = newGame();
const credits0 = untouched.player.credits;
assert.strictEqual(loadGame(untouched, store), false);
assert.strictEqual(untouched.phase, 'title');
assert.strictEqual(untouched.player.credits, credits0, 'game untouched');

console.log('save: all checks passed');
