// Self-checks for the plist and .dat mesh parsers. Run: node tests/test-parsers.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { parseMesh } = await import(join(root, 'web/src/mesh.js'));

// ---- plist -----------------------------------------------------------------
{
  const sample = `
  {
    /* block comment */
    // line comment
    name = "Cobra Mark III";
    bare = hello-world;
    speed = 350;
    ratio = -1.5e2;
    flag = yes;  off = no;
    list = ( 1, 2, "three four", (nested) );
    dict = { key = value; "quoted key" = 7; };
    url = "http://example.com/x";   // trailing comment
    empt = ();
  }`;
  const p = parsePlist(sample);
  assert.strictEqual(p.name, 'Cobra Mark III');
  assert.strictEqual(p.bare, 'hello-world');
  assert.strictEqual(p.speed, 350);
  assert.strictEqual(p.ratio, -150);
  assert.strictEqual(p.flag, true);
  assert.strictEqual(p.off, false);
  assert.deepStrictEqual(p.list, [1, 2, 'three four', ['nested']]);
  assert.strictEqual(p.dict.key, 'value');
  assert.strictEqual(p.dict['quoted key'], 7);
  assert.strictEqual(p.url, 'http://example.com/x');
  assert.deepStrictEqual(p.empt, []);
  console.log('plist: synthetic OK');
}

{
  const hud = parsePlist(readFileSync(join(root, 'web/assets/config/hud.plist'), 'utf8'));
  assert.strictEqual(hud.crosshair_scale, 32);
  assert.ok(Array.isArray(hud.dials) && hud.dials.length > 20, 'hud dials parsed');
  const scanner = hud.dials.find((d) => d.selector === 'drawScanner:');
  assert.strictEqual(scanner.width, 288);
  assert.strictEqual(scanner.height, 64);
  const speed = hud.dials.find((d) => d.selector === 'drawSpeedBar:');
  assert.strictEqual(speed.x, 200);
  assert.strictEqual(hud.overall_alpha, 0.75);
  console.log('plist: hud.plist OK,', hud.dials.length, 'dials,', hud.legends.length, 'legends');
}

{
  const shipdata = parsePlist(readFileSync(join(root, 'web/assets/config/shipdata.plist'), 'utf8'));
  const cobra = shipdata['oolite_template_cobra3'];
  assert.strictEqual(cobra.model, 'oolite_cobra3.dat');
  assert.strictEqual(cobra.max_flight_speed, 350);
  assert.strictEqual(cobra.materials.Hull.diffuse_map, 'oolite_cobra3_diffuse.png');
  assert.strictEqual(cobra.materials['oolite_cobra3_diffuse.png'] === undefined, true);
  const station = shipdata['oolite_template_coriolis-station'];
  assert.strictEqual(station.scan_class, 'CLASS_STATION');
  assert.ok(station.subentities.length >= 3, 'coriolis has model subentities');
  console.log('plist: shipdata.plist OK,', Object.keys(shipdata).length, 'entries');
}

{
  const planetinfo = parsePlist(readFileSync(join(root, 'web/assets/config/planetinfo.plist'), 'utf8'));
  // Find Lave: scan all system entries.
  let lave = null;
  for (const k of Object.keys(planetinfo)) {
    const e = planetinfo[k];
    if (e && e.name === 'Lave') { lave = e; break; }
  }
  assert.ok(lave, 'Lave found in planetinfo');
  assert.ok(lave.radius > 1000, 'Lave radius sane');
  assert.ok(lave.planet_distance > 100000, 'Lave planet distance sane');
  assert.ok(lave.sea_color, 'Lave sea colour');
  console.log('plist: planetinfo OK — Lave radius', lave.radius, 'km, planet_distance', lave.planet_distance);
}

// ---- mesh ------------------------------------------------------------------
{
  const text = readFileSync(join(root, 'web/assets/models/oolite_cobra3.dat'), 'utf8');
  const m = parseMesh(text);
  assert.strictEqual(m.vertices.length / 3, 1548);
  const totalTris = m.groups.reduce((s, g) => s + g.count / 3, 0);
  assert.strictEqual(totalTris, 1076, 'cobra3 face count');
  assert.deepStrictEqual(m.materials, ['Gun', 'Hull'], 'NAMES remap applied');
  assert.ok(m.bbox.radius > 50 && m.bbox.radius < 100, 'cobra3 radius');
  for (const g of m.groups) {
    for (let k = 0; k < g.normals.length; k++) assert.ok(Number.isFinite(g.normals[k]), 'normal finite');
    for (let k = 0; k < g.uvs.length; k++) assert.ok(Number.isFinite(g.uvs[k]), 'uv finite');
    assert.strictEqual(g.positions.length, g.count * 3);
    assert.strictEqual(g.uvs.length, (g.count / 3) * 6);
  }
  console.log('mesh: cobra3 OK — tris', totalTris, 'radius', m.bbox.radius.toFixed(1));
}

{
  // Station: material keys are texture file names (no NAMES section).
  const m = parseMesh(readFileSync(join(root, 'web/assets/models/oolite_coriolis.dat'), 'utf8'));
  assert.deepStrictEqual(m.materials, ['oolite_coriolis_diffuse.png']);
  assert.strictEqual(m.groups[0].count / 3, 50);
  assert.ok(m.bbox.radius > 500, 'coriolis radius ~500');
  console.log('mesh: coriolis OK — radius', m.bbox.radius.toFixed(1));
}

{
  // Krait has no NORMALS and no NAMES: face normals must be computed or read.
  const m = parseMesh(readFileSync(join(root, 'web/assets/models/oolite_krait.dat'), 'utf8'));
  assert.deepStrictEqual(m.materials, ['Hull']);
  assert.strictEqual(m.groups[0].count / 3, 1509);
  const bad = [...m.groups[0].normals].some((v) => !Number.isFinite(v));
  assert.ok(!bad, 'krait normals finite');
  console.log('mesh: krait OK');
}

{
  // Comments, commas and quads: synthetic case covering preprocessing.
  const dat = [
    'NVERTS 4 // comment',
    'NFACES 2',
    '# full line comment',
    'VERTEX',
    '0, 0, 0',
    '1, 0, 0',
    '0, 1, 0',
    '0, 0, 1',
    'FACES',
    '0 0 0  0 0 0  3  0 1 2',
    '0 0 0  0 0 1  4  0 1 2 3', // quad: only first 3 used
    'TEXTURES',
    'Hull  1.0 1.0  0 0  1 0  0 1',
    'Hull  1.0 1.0  0 0  1 0  0 1',
    'END',
  ].join('\n');
  const m = parseMesh(dat);
  assert.strictEqual(m.groups[0].count / 3, 2);
  assert.deepStrictEqual(m.materials, ['Hull']);
  assert.ok(Math.abs(m.groups[0].uvs[2] - 1) < 1e-6);
  console.log('mesh: synthetic OK');
}

console.log('\nAll parser tests passed.');
