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
const { chartRows, longRangeRows, systemReadout, ringSize, GOVERNMENTS,
  ECONOMIES, CHART_RANGE_LY } =
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
g.rand = () => 1; // pin the jump rolls: no mis-jump may fire by chance (#10)
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

// ---- long-range view and the data screen (#9) ------------------------------
const longRows = longRangeRows(g);
assert.strictEqual(longRows.length, 255, 'the long-range list holds the whole galaxy');
assert.ok(longRows.every((r) => r.index !== from.index), 'except the current system');
assert.ok(longRows.some((r) => r.distance > CHART_RANGE_LY),
  'systems beyond the 7 ly ring are listed too');
for (let i = 1; i < longRows.length; i++) {
  assert.ok(longRows[i - 1].distance <= longRows[i].distance, 'nearest first');
}
// the short-range chart is exactly that list clipped to the ring
assert.deepStrictEqual(chartRows(g), longRows.filter((r) => r.distance <= CHART_RANGE_LY),
  'short range = long range inside the 7 ly ring');
// both views follow the commander's galaxy, not the galaxy-1 fixture
g.galaxy = 2;
assert.notDeepStrictEqual(longRangeRows(g).map((r) => r.name),
  longRows.map((r) => r.name), 'the long view switches with the galaxy');
g.galaxy = 1;

// the data screen: every field is galaxy.js's own, nothing invented
const other = longRows[0];
const ro = systemReadout(g, other.index);
const sys = SYSTEMS[other.index];
assert.strictEqual(ro.name, sys.name, 'name');
assert.strictEqual(ro.distance, other.distance, 'distance to the present system');
assert.strictEqual(ro.economy, ECONOMIES[sys.economy], 'economy');
assert.strictEqual(ro.government, GOVERNMENTS[sys.government], 'government');
assert.strictEqual(ro.techLevel, sys.techLevel, 'tech level');
assert.strictEqual(ro.population, sys.population, 'population');
assert.strictEqual(ro.productivity, sys.productivity, 'gross productivity');
assert.strictEqual(ro.radius, sys.radius, 'average radius');
assert.strictEqual(ro.description, sys.description, 'description');
assert.ok(ro.population > 0 && ro.productivity > 0 && ro.radius > 0, 'figures present');
assert.strictEqual(systemReadout(g, g.systemIndex).distance, 0, 'you are 0 ly from yourself');
assert.strictEqual(systemReadout(g, 999), null, 'unknown index has no data');

// the fuel ring: fuel/2 chart units across, drawn in each view's projection
const shortRing = ringSize(70, 'short');
assert.strictEqual(shortRing.width, (35 / 64) * 100, 'full tank spans 35 of the 64-unit window');
assert.strictEqual(shortRing.height, (35 / 128) * 100, 'y over 128, the drawStarChart window');
assert.strictEqual(((shortRing.width / 100) * 64) / 2 * 0.4, 7,
  'the ring really is the 7 ly jump range');
const longRing = ringSize(70, 'long');
assert.strictEqual(longRing.width, shortRing.width / 4, 'long view is the same ring at 4× zoom-out');
assert.strictEqual(longRing.height, shortRing.height / 4, 'both axes zoom together');

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
