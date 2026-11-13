// Short-range chart: nearby systems carry the real galaxy.js data, and a
// chosen system inside the 7 ly ring jumps while anything else is refused.
// Run: node tests/test-chart.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { createGame, launch, jump, SYSTEMS } = await import(join(root, 'web/src/game.js'));
const { chartRows, GOVERNMENTS, ECONOMIES, CHART_RANGE_LY } =
  await import(join(root, 'web/src/chart.js'));
const { distanceLy } = await import(join(root, 'web/src/galaxy.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const assets = {
  plists: {
    shipyard: parsePlist(read('config/shipyard.plist')),
    shipdata: parsePlist(read('config/shipdata.plist')),
  },
  parsedMeshes: {},
};

const g = createGame(assets);
launch(g);
g.entities = g.entities.filter((e) => e.type === 'station');
g.spawnTimer = 1e9;

const from = SYSTEMS[g.systemIndex];
assert.strictEqual(from.name, 'LAVE', 'the classic starting system');

// ---- the list ---------------------------------------------------------------
const rows = chartRows(g);
assert.ok(rows.length >= 2, `Lave has neighbours in range (${rows.length})`);
assert.ok(rows.every((r) => r.index !== from.index), 'current system not listed');
assert.ok(rows.every((r) => r.distance > 0 && r.distance <= CHART_RANGE_LY),
  'every row is inside the 7 ly ring');
for (let i = 1; i < rows.length; i++) {
  assert.ok(rows[i - 1].distance <= rows[i].distance, 'nearest first');
}
// exactly the systems distanceLy puts in range — nothing invented, nothing missed
const expected = SYSTEMS.filter(
  (s) => s.index !== from.index && distanceLy(from, s) <= CHART_RANGE_LY,
);
assert.strictEqual(rows.length, expected.length, 'list matches distanceLy');

// the data is galaxy.js's own, named the way descriptions.plist names it
for (const r of rows) {
  const sys = SYSTEMS[r.index];
  assert.strictEqual(r.name, sys.name, `${sys.name} name`);
  assert.strictEqual(r.techLevel, sys.techLevel, `${sys.name} tech level`);
  assert.strictEqual(r.government, GOVERNMENTS[sys.government], `${sys.name} government`);
  assert.strictEqual(r.economy, ECONOMIES[sys.economy], `${sys.name} economy`);
  assert.ok(GOVERNMENTS.includes(r.government) && ECONOMIES.includes(r.economy));
  assert.strictEqual(r.cost, Math.max(1, Math.round(r.distance * 10)),
    `${sys.name} cost is the distance jump() charges`);
  assert.strictEqual(r.reachable, r.distance <= CHART_RANGE_LY, 'full tank reaches all of it');
}

// ---- jump to the chosen system ----------------------------------------------
const pick = rows[0];
assert.ok(jump(g, pick.index), 'nearest system jumps');
assert.strictEqual(g.systemIndex, pick.index, 'arrived where the chart said');
assert.strictEqual(g.player.fuel, 70 - pick.cost, 'fuel costs the distance');

// ---- outside the ring is refused --------------------------------------------
const here = SYSTEMS[g.systemIndex];
const outside = SYSTEMS.find(
  (s) => s.index !== here.index && distanceLy(here, s) > CHART_RANGE_LY,
);
assert.ok(outside, 'the galaxy has systems beyond 7 ly');
const stay = g.systemIndex;
const fuel0 = g.player.fuel;
assert.strictEqual(jump(g, outside.index), false, 'out-of-range jump refused');
assert.strictEqual(g.systemIndex, stay, 'stays put');
assert.strictEqual(g.player.fuel, fuel0, 'and keeps its fuel');
assert.strictEqual(g.messages[0].text, 'OUT OF JUMP RANGE', 'the HUD is told why');
assert.strictEqual(jump(g, g.systemIndex), false, 'cannot jump to the current system');
assert.strictEqual(g.systemIndex, stay);

// ---- the tank, not the chart, is the limit when fuel is short ---------------
const hereRows = chartRows(g); // same system as `stay`, full tank
g.player.fuel = 4; // 0.4 ly — every neighbour is out of reach
const short = chartRows(g);
assert.strictEqual(short.length, hereRows.length, 'fuel does not change the list, only reach');
assert.ok(short.every((r) => r.reachable === (r.distance <= 0.4)), 'reach follows the tank');
const unaffordable = short.find((r) => !r.reachable);
assert.ok(unaffordable, 'some neighbour needs more fuel than the tank holds');
assert.strictEqual(jump(g, unaffordable.index), false, 'fuel-poor jump refused');
assert.strictEqual(g.systemIndex, stay, 'stays put');
assert.strictEqual(g.messages[0].text, 'INSUFFICIENT FUEL FOR JUMP');

// ---- without a selection the jump still auto-targets the nearest -------------
g.player.fuel = 70;
const autoStay = g.systemIndex;
assert.ok(jump(g), 'jump() with no selection still auto-jumps');
assert.notStrictEqual(g.systemIndex, autoStay, 'and leaves the system');

console.log('chart: all checks passed');
