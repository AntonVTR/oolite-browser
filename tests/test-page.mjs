// The page contract the other tests cannot see: main.js and the overlay
// screens reach for element ids that live in index.html or are built by JS
// at runtime, and the first paint must not wait for the texture PNGs.
// A renamed id breaks a screen the moment it opens (main().catch puts
// "error: …" on the loading screen) while every other test stays green.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'web/index.html'), 'utf8');
const files = readdirSync(join(root, 'web/src')).filter((f) => f.endsWith('.js'));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(root, 'web/src', f), 'utf8')]));

// Strip comments and the id lookups themselves, so a name that only survives
// at the ask site is a typo rather than a definition.
const body = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
  .replace(/\bel\([^)]*\)/g, ' ')
  .replace(/getElementById\([^)]*\)/g, ' ')
  .replace(/querySelector(?:All)?\([^)]*\)/g, ' ');

// Ids that exist: the markup, plus any name the JS itself holds — `el.id =
// 'x'`, an `id="x"` inside an innerHTML template, or the ['btnMissile',
// 'MISSILE'] pair that names a button it creates.
const defined = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
for (const code of Object.values(src)) {
  const b = body(code);
  for (const m of b.matchAll(/(?<![-\w])id\s*=\s*['"]([^'"]+)['"]/g)) defined.add(m[1]);
  for (const m of b.matchAll(/'([A-Za-z0-9_-]+)'/g)) defined.add(m[1]);
}

// Ids the code asks for.
const asked = new Set();
for (const code of Object.values(src)) {
  for (const m of code.matchAll(/\bel\(['"]([^'"]+)['"]\)/g)) asked.add(m[1]);
  for (const m of code.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) asked.add(m[1]);
  for (const m of code.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_-]+)/g)) asked.add(m[1]);
}

const missing = [...asked].filter((id) => !defined.has(id));
assert.deepEqual(missing, [], `ids asked for but never created: ${missing.join(', ')}`);

// First paint must not wait on the textures: loadAssets() stops at the
// plists, meshes and sounds, and main.js fetches the PNGs afterwards.
const assets = src['assets.js'];
const cut = assets.indexOf('export async function loadTextures');
assert.ok(cut > 0, 'assets.js must export loadTextures()');
const loadAssets = assets.slice(assets.indexOf('export async function loadAssets'), cut);
assert.ok(!loadAssets.includes('fetchImage('),
  'loadAssets() must not fetch textures before the title screen');
assert.ok(src['main.js'].includes('loadTextures(assets)'),
  'main.js must fetch the textures in the background');

console.log(`page contract ok: ${asked.size} ids asked for, ${defined.size} defined`);
