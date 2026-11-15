// View-matrix convention check. Run: node tests/test-view.mjs
// The camera must look along the ship's nose (+Z), keep starboard on screen
// right (+X) and up on screen top (+Y) — Oolite's frame is left-handed, so
// buildView() flips Z relative to a plain inverse-rigid transform.
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildView, lineIndices } = await import(join(root, 'web/src/render.js'));
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

// ---- changeable views (#14) ------------------------------------------------
const { viewQuat } = await import(join(root, 'web/src/render.js'));
const { setView, cycleView, VIEWS } = await import(join(root, 'web/src/game.js'));

// selector state: setView only accepts real views, cycleView walks all four
const sel = { view: 'front' };
setView(sel, 'aft');
assert.strictEqual(sel.view, 'aft', 'setView switches');
setView(sel, 'nonsense');
assert.strictEqual(sel.view, 'aft', 'setView ignores an unknown view');
const seen = [];
for (let i = 0; i < 4; i++) { cycleView(sel); seen.push(sel.view); }
assert.deepStrictEqual(seen, ['port', 'starboard', 'front', 'aft'], 'cycle wraps through all four');
assert.deepStrictEqual(VIEWS, ['front', 'aft', 'port', 'starboard'], 'the original key order');

// Every view must look the right way from every attitude: the camera's
// forward (what buildView aims along) points at the expected ship direction,
// up stays up, and the map stays orthonormal.
const viewCases = [
  { quat: [0, 0, 0, 1], name: 'level' },
  { quat: quatNormalize(quatAxisAngle(0, 1, 0, Math.PI / 3)), name: 'yawed' },
  { quat: quatNormalize(quatAxisAngle(1, 0, 0, -Math.PI / 5)), name: 'pitched' },
  { quat: quatNormalize(quatAxisAngle(0, 0, 1, Math.PI / 2.5)), name: 'rolled' },
];
const expect = (view, quat) => {
  const nose = quatRotate(quat, [0, 0, 1]);
  const starboard = quatRotate(quat, [1, 0, 0]);
  return {
    front: nose,
    aft: [-nose[0], -nose[1], -nose[2]],
    port: [-starboard[0], -starboard[1], -starboard[2]],
    starboard,
  }[view];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
for (const c of viewCases) {
  for (const view of VIEWS) {
    const cam = viewQuat(view, c.quat);
    const want = expect(view, c.quat);
    const dir = quatRotate(cam, [0, 0, 1]);
    assert.ok(dot(dir, want) > 1 - 1e-6, `${c.name}/${view}: camera looks the right way`);
    const up = quatRotate(cam, [0, 1, 0]);
    const shipUp = quatRotate(c.quat, [0, 1, 0]);
    assert.ok(dot(up, shipUp) > 1 - 1e-6, `${c.name}/${view}: up stays up`);

    // through the real view matrix: the wanted direction is in front of GL
    const m = buildView(new Float32Array(16), [0, 0, 0], cam);
    const v = rotate(m, want);
    assert.ok(v[2] < -1e-6, `${c.name}/${view}: wanted direction in front (z < 0)`);
    // side views frame the nose the way a head turn would: looking left, the
    // nose sits off to your right; looking right, it is off to your left
    if (view === 'starboard') assert.ok(rotate(m, quatRotate(c.quat, [0, 0, 1]))[0] < -1e-6,
      `${c.name}/starboard: nose off to screen left`);
    if (view === 'port') assert.ok(rotate(m, quatRotate(c.quat, [0, 0, 1]))[0] > 1e-6,
      `${c.name}/port: nose off to screen right`);
    if (view === 'aft') assert.ok(rotate(m, quatRotate(c.quat, [1, 0, 0]))[0] < -1e-6,
      `${c.name}/aft: starboard flips to screen left`);
  }
}

// ---- cockpit frame (#14) ---------------------------------------------------
// Drawn on the HUD canvas: it must not throw, must stop above the bottom
// gauge band, and must name the view when it is not the forward one.
const { Hud, BOTTOM_BAND } = await import(join(root, 'web/src/hud.js'));
const drawLog = [];
const hudCtx = new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : (...a) => { drawLog.push([k, ...a]); }),
  set: (t, k, v) => { t[k] = v; return true; },
});
const hud = new Hud({ width: 0, height: 0, getContext: () => hudCtx },
  { plists: { hud: {}, crosshairs: {} } });
hud.resize(800, 600, 1);
const fake = (view) => ({
  hudVisible: true, view, showCrosshair: false, target: null, time: 0,
});

hud.draw(fake('front'));
const rects = drawLog.filter((c) => c[0] === 'fillRect');
assert.ok(rects.length >= 3, 'frame draws the top bar and both pillars');
for (const r of rects) {
  assert.ok(r[2] + r[4] <= 600 - BOTTOM_BAND * hud.s + 1e-6,
    `frame element stops above the gauge band (got bottom ${r[2] + r[4]})`);
}
assert.ok(!drawLog.some((c) => c[0] === 'fillText'), 'forward view needs no label');

drawLog.length = 0;
hud.draw(fake('aft'));
assert.ok(drawLog.some((c) => c[0] === 'fillText' && c[1] === 'AFT VIEW'),
  'aft view names itself under the canopy bow');

drawLog.length = 0;
hud.draw({ ...fake('aft'), hudVisible: false });
assert.ok(!drawLog.some((c) => c[0] === 'fillRect'), 'no frame without a HUD');

// ---- wireframe display mode (#22) -------------------------------------------
// The edge list turns each triangle of the soup into its three strokes.
assert.deepStrictEqual([...lineIndices(3)], [0, 1, 1, 2, 2, 0], 'one triangle, three edges');
assert.deepStrictEqual([...lineIndices(6)], [0, 1, 1, 2, 2, 0, 3, 4, 4, 5, 5, 3],
  'two triangles keep their own vertices');
assert.strictEqual(lineIndices(4), null, 'a group that is not a triangle soup has no edges');
assert.strictEqual(lineIndices(65538), null, 'beyond uint16 the group keeps its fill');

console.log('view: all checks passed');
