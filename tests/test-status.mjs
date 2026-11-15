// Status screen rows: the in-flight status page shows the five fields of the
// original status page, straight from live game state. Run: node tests/test-status.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { createGame, launch, addCrime, SYSTEMS } =
  await import(join(root, 'web/src/game.js'));
const { statusRows } = await import(join(root, 'web/src/status.js'));

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
g.spawnTimer = 1e9; // no random contacts while the rows are checked

const field = (list, label) => list.find(([k]) => k === label)[1];

const rows = statusRows(g);
assert.deepStrictEqual(rows.map(([k]) => k),
  ['Present system', 'Fuel', 'Cash', 'Legal status', 'Rating'],
  'the five fields of the original status page, in order');
assert.strictEqual(field(rows, 'Present system'), 'LAVE', 'present system from the galaxy');
assert.strictEqual(field(rows, 'Fuel'), '7.0 ly', 'fuel in light years, one decimal');
assert.strictEqual(field(rows, 'Cash'), '100.0 CR', 'cash with one decimal');
assert.strictEqual(field(rows, 'Legal status'), 'Clear', 'a new commander is clean');
assert.strictEqual(field(rows, 'Rating'), 'Harmless', 'a new commander is Harmless');

// the rows follow the live state
g.player.fuel = 42;
g.player.credits = 1234.5;
const changed = statusRows(g);
assert.strictEqual(field(changed, 'Fuel'), '4.2 ly', 'fuel tracks the tank');
assert.strictEqual(field(changed, 'Cash'), '1234.5 CR', 'cash tracks the wallet');

addCrime(g, 1);
assert.strictEqual(field(statusRows(g), 'Legal status'), 'Offender', 'one offence is an Offender');
addCrime(g, 50);
assert.strictEqual(field(statusRows(g), 'Legal status'), 'Fugitive', '51+ crime is a Fugitive');

g.kills = 8;
assert.strictEqual(field(statusRows(g), 'Rating'), 'Mostly Harmless', 'kill ladder step');
g.kills = 6400;
assert.strictEqual(field(statusRows(g), 'Rating'), 'Elite', 'kill ladder top');

g.systemIndex = 0;
assert.strictEqual(field(statusRows(g), 'Present system'), 'TIBEDIED',
  `present system follows the galaxy (${SYSTEMS[0].name})`);

// stranded in witchspace (#10) there is no system to show, only the state
g.witchspace = true;
assert.ok(field(statusRows(g), 'Present system').includes('WITCHSPACE'),
  'the status screen says where you really are');
g.witchspace = false;

console.log('status: all checks passed');
