// View-matrix convention check. Run: node tests/test-view.mjs
// The camera must look along the ship's nose (+Z), keep starboard on screen
// right (+X) and up on screen top (+Y) — Oolite's frame is left-handed, so
// buildView() flips Z relative to a plain inverse-rigid transform.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildView } = await import(join(root, 'web/src/render.js'));
const { quatAxisAngle, quatNormalize, quatRotate } = await import(join(root, 'web/src/math.js'));

function apply(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ];
}

// Rotation part only — for directions, where translation must not apply.
function rotate(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}

const cases = [
  { name: 'straight and level', quat: [0, 0, 0, 1], pos: [0, 0, 0] },
  { name: 'yawed 90° left', quat: quatNormalize(quatAxisAngle(0, 1, 0, Math.PI / 2)), pos: [10, -5, 3] },
  { name: 'pitched up 30°', quat: quatNormalize(quatAxisAngle(1, 0, 0, -Math.PI / 6)), pos: [-100, 20, 400] },
  { name: 'rolled 45°', quat: quatNormalize(quatAxisAngle(0, 0, 1, Math.PI / 4)), pos: [7, 7, 7] },
];

for (const c of cases) {
  const m = buildView(new Float32Array(16), c.pos, c.quat);

  // Ship axes expressed in world space.
  const nose = quatRotate(c.quat, [0, 0, 1]);
  const starboard = quatRotate(c.quat, [1, 0, 0]);
  const up = quatRotate(c.quat, [0, 1, 0]);

  const vNose = rotate(m, nose);
  const vStar = rotate(m, starboard);
  const vUp = rotate(m, up);

  assert.ok(vNose[2] < -1e-6, `${c.name}: nose must be in front of the GL camera (z < 0)`);
  assert.ok(vStar[0] > 1e-6, `${c.name}: starboard must be screen right (x > 0)`);
  assert.ok(vUp[1] > 1e-6, `${c.name}: up must be screen up (y > 0)`);

  // The map must be orthonormal (no shear / scale).
  const col = (i) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(len(col(i)) - 1) < 1e-5, `${c.name}: column ${i} unit length`);

  // Position maps to the camera origin: view of the camera position itself.
  const origin = apply(m, c.pos);
  assert.ok(Math.hypot(origin[0], origin[1], origin[2]) < 1e-3, `${c.name}: camera sits at the view origin`);
}

console.log('view: all checks passed');
