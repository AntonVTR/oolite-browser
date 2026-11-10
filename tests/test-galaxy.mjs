// Self-checks for the galaxy generator. Run: node tests/test-galaxy.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { makeGalaxy, systemAt, distanceLy } = await import(join(root, 'web/src/galaxy.js'));

// ---- structure -------------------------------------------------------------
const galaxy1 = makeGalaxy(1);
assert.equal(galaxy1.systems.length, 256, 'a galaxy holds 256 systems');
assert.equal(makeGalaxy().systems.length, 256, 'galaxyNumber defaults to 1');

// ---- names -----------------------------------------------------------------
const names = galaxy1.systems.map(s => s.name);
assert.equal(new Set(names).size, 256, 'system names are unique');

// The original game's galaxy 1 opens with TIBEDIED; LAVE — the system the
// player starts in — is index 7. Upstream says so itself: planetinfo key
// "0 7" is Lave, and Resources/Config/characters.plist reads
// "origin = 7; // system number seven (Lave in Galaxy 0)". The brief assumed
// LAVE sits at index 0; the game data disagrees, so the real invariants are
// asserted here (see report for the one-line reorder if index 0 must be LAVE).
assert.deepEqual(
  names.slice(0, 8),
  ['TIBEDIED', 'QUBE', 'LELEER', 'BIARGE', 'XEQUERIN', 'TIRAOR', 'RABEDIRA', 'LAVE'],
  'first eight names follow the original order',
);
assert.equal(names[7], 'LAVE', 'LAVE is system index 7 of galaxy 1');
assert.equal(names[0], 'TIBEDIED', 'first system of galaxy 1');
assert.equal(
  makeGalaxy(2).systems[0].name,
  'AUSIS',
  'galaxy 2 = galaxy 1 with every seed byte rotated left once',
);

// ---- every system is populated ---------------------------------------------
galaxy1.systems.forEach((s, i) => {
  assert.equal(s.index, i, `system ${i} carries its index`);
  assert.ok(s.name.length > 0, `system ${i} has a name`);
  assert.ok(s.description.length > 0, `system ${i} has a description`);
  assert.ok(Number.isInteger(s.government) && s.government >= 0 && s.government <= 7,
    `system ${i} government populated (${s.government})`);
  assert.ok(Number.isInteger(s.economy) && s.economy >= 0 && s.economy <= 7,
    `system ${i} economy populated (${s.economy})`);
  // tech level can legitimately be 0 (upstream has 20 such systems, e.g.
  // galaxy 1's Qudira: government 0, economy 7).
  assert.ok(Number.isInteger(s.techLevel) && s.techLevel >= 0, `system ${i} tech level`);
  assert.ok(s.population > 0 && s.productivity > 0 && s.radius > 0, `system ${i} figures`);
});

// ---- Lave, cross-checked against upstream planetinfo "0 7" ------------------
const lave = systemAt(galaxy1, 7);
assert.equal(lave.name, 'LAVE');
assert.deepEqual([lave.x, lave.y], [20, 173], 'Lave chart coordinates');
assert.equal(lave.government, 3);
assert.equal(lave.economy, 5);
assert.equal(lave.techLevel, 4);
assert.equal(lave.population, 25);
assert.equal(lave.productivity, 7000);
assert.equal(lave.radius, 4116);
assert.ok(lave.description.startsWith('Lave is most famous for'),
  `description is Oolite's own text, got: ${lave.description}`);
assert.equal(systemAt(galaxy1, 7), lave, 'systemAt returns the matching system');
assert.equal(systemAt(galaxy1, 263), lave, 'index wraps at 256, like upstream (& 0xFF)');

// ---- distance and the 7 ly jump rule ---------------------------------------
// Oolite's distanceBetweenPlanetPositions(): 0.4 * trunc(sqrt(dx^2 + (dy/2)^2)),
// over the chart coordinates Lave (20,173), Leesti (13,186), Riedquat (3,181)
// and Quator (14,137) — giving 3.6, 6.8 and 7.2 light years.
assert.equal(distanceLy(lave, lave), 0, 'distance to self is 0');
const leesti = systemAt(galaxy1, 55);
const riedquat = systemAt(galaxy1, 46);
const quator = systemAt(galaxy1, 27);
const leestiDistance = distanceLy(lave, leesti);
assert.ok(Math.abs(leestiDistance - 3.6) < 1e-9, `Lave-Leesti is 3.6 ly, got ${leestiDistance}`);
assert.ok(Math.abs(distanceLy(lave, riedquat) - 6.8) < 1e-9, 'Lave-Riedquat is 6.8 ly');
assert.ok(Math.abs(distanceLy(lave, quator) - 7.2) < 1e-9, 'Lave-Quator is 7.2 ly');

// MAX_JUMP_RANGE is 7.0 ly and distances come in steps of 0.4 ly, so 6.8 ly is
// the furthest hop that fits and 7.2 ly never does.
const JUMP_RANGE = 7;
assert.ok(leestiDistance <= JUMP_RANGE, '3.6 ly: within jump range');
assert.ok(distanceLy(lave, riedquat) <= JUMP_RANGE, '6.8 ly: just within jump range');
assert.ok(distanceLy(lave, quator) > JUMP_RANGE, '7.2 ly: one step beyond jump range');

console.log('galaxy: 256 systems, first eight '
  + `${names.slice(0, 8).join(', ')}, LAVE at index 7, distances OK`);
