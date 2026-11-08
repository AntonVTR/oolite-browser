// Browser entry point: loads Oolite's real assets, builds GPU resources and
// runs the loop (input → game.js → renderer → HUD → audio).

import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { setupKeyboard, setupMouse, setupGamepad, updateCtrl } from './controls.js';
import { setupTouchControls, clearTouchEdges } from './touch.js';
import { loadAssets, SHIP_DEFS, resolveTextureName } from './assets.js';
import {
  createGame, stepGame, launch, marketFor, buyGood, sellGood, cargoUsed,
  SYSTEMS,
} from './game.js';
import { mat4, mat4FromQuatPosScale, quatRotate, add, scale as vscale } from './math.js';

const el = (id) => document.getElementById(id);
const glCanvas = el('gl');
const hudCanvas = el('hud');

const PLANET_POS = [0, 6000, 62000];
const PLANET_R = 9000;
// Sun behind and above the launch heading so ships ahead are lit, as in Elite.
const SUN_POS = [-30000, 25000, -50000];
const SUN_R = 9000;

let renderer, hud, audio, assets, game;
let stars, sphereGpu, gpu = {}, meshTex = {};
let boomTex;
let jumpRequested = false;
let prevPhase = 'title';
let lastT = performance.now();
let fpsSmooth = 60;

// ---------------------------------------------------------------------------
// procedural explosion sprite (no explosion art in the Oolite asset subset)
function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function glowTexture(inner, outer) {
  const [c, x] = makeCanvas(128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return c;
}

// ---------------------------------------------------------------------------
function buildStars() {
  const n = 1400;
  const pos = [], col = [], size = [];
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 600000;
    pos.push(Math.cos(th) * s * r, u * r, Math.sin(th) * s * r);
    const warm = Math.random();
    if (warm < 0.15) col.push(1, 0.85, 0.6);
    else if (warm < 0.3) col.push(0.7, 0.85, 1);
    else col.push(1, 1, 1);
    size.push(1 + Math.random() * 2.4);
  }
  return renderer.makePoints(pos, col, size);
}

function buildGpu() {
  sphereGpu = renderer.uploadSphere();
  for (const [id, parsed] of Object.entries(assets.parsedMeshes)) {
    gpu[id] = renderer.uploadMesh(parsed);
  }
  // material index → GL texture, per mesh
  const where = {};
  for (const [key, def] of Object.entries(SHIP_DEFS)) {
    where[key] = { entry: assets.plists.shipdata[def.shipKey], base: def.model };
    for (const sub of def.subentities || []) {
      where[sub] = {
        entry: assets.plists.shipdata[sub] || assets.plists.shipdata[def.shipKey],
        base: sub,
      };
    }
  }
  for (const [id, parsed] of Object.entries(assets.parsedMeshes)) {
    const info = where[id] || {};
    meshTex[id] = parsed.materials.map((mat) => {
      const png = resolveTextureName(mat, info.entry, info.base);
      const img = png && assets.textures[png];
      return img ? renderer.makeTexture(img) : null;
    });
  }
  boomTex = renderer.makeTexture(glowTexture('rgba(255,255,255,1)', 'rgba(255,140,30,0.85)'));
  stars = buildStars();
}

// ---------------------------------------------------------------------------
const tmpModel = mat4();
function modelMatrix(pos, quat, s = 1) {
  return mat4FromQuatPosScale(tmpModel, quat, pos, s);
}

function drawEntity(e) {
  const key = e.shipKey;
  const gmesh = gpu[key];
  if (!gmesh) return;
  renderer.drawMesh(gmesh, modelMatrix(e.pos, e.quat, 1), {
    textures: meshTex[key],
    sunDir: renderer.sunDirView(SUN_POS),
    fallbackColor: e.color.concat(1),
  });
  if (e.type !== 'station') return;
  // Coriolis subentities: hull faceplate, lit triangles and the dock sleeve.
  const subs = SHIP_DEFS.coriolis.subentities || [];
  const offsets = { oolite_coriolis_dock: [0, 0, 500.2561] }; // from shipdata
  for (const sub of subs) {
    const sg = gpu[sub];
    if (!sg) continue;
    const off = offsets[sub] || [0, 0, 0];
    const world = add(e.pos, quatRotate(e.quat, off));
    renderer.drawMesh(sg, modelMatrix(world, e.quat, 1), {
      textures: meshTex[sub],
      sunDir: renderer.sunDirView(SUN_POS),
      fallbackColor: [0.7, 0.7, 0.75, 1],
    });
  }
}

function renderScene() {
  const p = game.player;
  renderer.beginFrame(p.pos, p.quat);
  const sunDir = renderer.sunDirView(SUN_POS);

  renderer.drawStars(stars);

  // shortcut: no planet art ships with the copied asset subset, so the world
  // is a flat-shaded sphere instead of a textured globe.
  renderer.drawMesh(sphereGpu, modelMatrix(PLANET_POS, [0, 0, 0, 1], PLANET_R), {
    fallbackColor: [0.32, 0.55, 0.80, 1],
    sunDir,
    ambient: [0.12, 0.12, 0.16],
    sunCol: [1.0, 0.98, 0.92],
  });
  renderer.drawMesh(sphereGpu, modelMatrix(SUN_POS, [0, 0, 0, 1], SUN_R), {
    tint: [1, 1, 0.85, 1],
    emissive: 1.4,
    ambient: [0, 0, 0],
    sunCol: [0, 0, 0],
  });

  for (const e of game.entities) drawEntity(e);

  for (const s of game.shots) {
    renderer.drawBeam(s.from, s.to, 3.5, s.hostile ? [1, 0.25, 0.15, 0.9] : [0.4, 1, 0.4, 0.95]);
  }
  for (const x of game.explosions) {
    const t = 1 - x.life / x.maxLife;
    const size = x.size * (0.5 + t * 1.4);
    renderer.drawBillboard(x.pos, size, size, boomTex, [1, 1, 1, Math.max(0, 1 - t)]);
  }
}

// ---------------------------------------------------------------------------
// project a world point to normalised screen coords (0..1, y down)
function project(pos) {
  const v = renderer.view, pr = renderer.proj;
  const vx = v[0] * pos[0] + v[4] * pos[1] + v[8] * pos[2] + v[12];
  const vy = v[1] * pos[0] + v[5] * pos[1] + v[9] * pos[2] + v[13];
  const vz = v[2] * pos[0] + v[6] * pos[1] + v[10] * pos[2] + v[14];
  const cx = pr[0] * vx + pr[4] * vy + pr[8] * vz + pr[12];
  const cy = pr[1] * vx + pr[5] * vy + pr[9] * vz + pr[13];
  const cw = pr[3] * vx + pr[7] * vy + pr[11] * vz + pr[15];
  if (cw <= 0.0001) return null;
  return { x: (cx / cw) * 0.5 + 0.5, y: 0.5 - (cy / cw) * 0.5 };
}

function updateTargetReticle() {
  const t = game.target;
  if (!t) { game.target = null; return; }
  const a = project(t.pos);
  if (!a) { t.onScreen = false; return; }
  const right = quatRotate(game.player.quat, [1, 0, 0]);
  const b = project(add(t.pos, vscale(right, t.radius)));
  const w = glCanvas.clientWidth, h = glCanvas.clientHeight;
  t.onScreen = a.x > -0.15 && a.x < 1.15 && a.y > -0.15 && a.y < 1.15;
  t.sx = a.x;
  t.sy = a.y;
  t.rpx = b ? Math.max(8, Math.abs(b.x - a.x) * w) : 24;
  t.range = Math.hypot(
    t.pos[0] - game.player.pos[0],
    t.pos[1] - game.player.pos[1],
    t.pos[2] - game.player.pos[2]
  );
  t.name = t.name || 'SHIP';
}

function playEvents() {
  for (const ev of game.events) {
    switch (ev.type) {
      case 'laser': audio.play('laser', { volume: 0.45 }); break;
      case 'hit': audio.play('hit', { volume: 0.5 }); break;
      case 'boom': audio.play('bigbang', { volume: 0.7 }); break;
      case 'beep': audio.play('beep', { volume: 0.35 }); break;
      case 'buy': audio.play('buy', { volume: 0.6 }); break;
      case 'sell': audio.play('sell', { volume: 0.6 }); break;
      case 'docking': audio.play('guiclick', { volume: 0.6 }); break;
      case 'jump': audio.play('beep', { volume: 0.7, rate: 0.6 }); break;
      default: break;
    }
  }
}

// ---------------------------------------------------------------------------
function buildMarketScreen() {
  const sys = SYSTEMS[game.systemIndex];
  el('dock-title').textContent = `${sys.name} — STATION`;
  const p = game.player;
  const used = cargoUsed(game);
  const cargoLines = Object.entries(p.cargo)
    .map(([k, v]) => `  ${k}: ${v} t`).join('\n') || '  (empty)';
  el('dock-status').textContent =
    `Credits: ${p.credits.toFixed(1)} CR\n` +
    `Fuel: ${(p.fuel / 10).toFixed(1)} ly   Cargo: ${used}/${p.maxCargo} t\n` +
    `Kills: ${game.kills}\n` +
    `${sys.description}\n` +
    `Cargo hold:\n${cargoLines}`;

  const rows = marketFor(game);
  const table = el('market');
  table.innerHTML =
    '<tr><th>Commodity</th><th>Price</th><th>Stock</th><th>Held</th><th></th></tr>' +
    rows.map((r) => {
      const held = p.cargo[r.key] || 0;
      return `<tr>
        <td>${r.name}</td>
        <td>${r.price.toFixed(1)}</td>
        <td>${r.stock}</td>
        <td>${held}</td>
        <td>
          <button data-act="buy" data-key="${r.key}">BUY</button>
          <button data-act="sell" data-key="${r.key}" ${held ? '' : 'disabled'}>SELL</button>
        </td></tr>`;
    }).join('');
}

function wireDockScreen() {
  el('market').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.act === 'buy') buyGood(game, btn.dataset.key, 1);
    else sellGood(game, btn.dataset.key, 1);
    playEvents();
    buildMarketScreen();
  });
  el('btnLaunch').addEventListener('click', () => {
    audio.unlock();
    launch(game);
    hideOverlays();
    el('touch').classList.remove('hidden');
  });
  el('btnRefuel').addEventListener('click', () => {
    const p = game.player;
    if (p.fuel >= 70) return;
    if (p.credits < 2) { return; }
    p.credits -= 2;
    p.fuel = 70;
    audio.play('buy', { volume: 0.6 });
    buildMarketScreen();
  });
}

function hideOverlays() {
  for (const id of ['title', 'docked', 'dead', 'loading']) el(id).classList.add('hidden');
}

function syncPhase() {
  if (game.phase === prevPhase) return;
  prevPhase = game.phase;
  if (game.phase === 'docked') {
    el('touch').classList.add('hidden');
    buildMarketScreen();
    el('docked').classList.remove('hidden');
  } else if (game.phase === 'dead') {
    el('touch').classList.add('hidden');
    audio.stopEngine();
    el('dead-stats').textContent =
      `Credits ${game.player.credits.toFixed(1)} CR · Kills ${game.kills} · ` +
      `Reached ${SYSTEMS[game.systemIndex].name}`;
    el('dead').classList.remove('hidden');
  } else if (game.phase === 'flight') {
    hideOverlays();
    el('touch').classList.remove('hidden');
  }
}

// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.resize(w, h, dpr);
  hud.resize(w, h, dpr);
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (dt > 0) fpsSmooth = fpsSmooth * 0.9 + (1 / dt) * 0.1;
  game.fps = fpsSmooth;

  const c = updateCtrl();
  stepGame(game, {
    pitch: c.pitch, yaw: c.yaw, roll: c.roll,
    throttle: c.throttle, throttleSet: c.throttleSet,
    fire: c.fire, injectors: c.injectors,
    targetNext: c.targetNext, dockRequest: c.dockRequest,
    jump: jumpRequested,
  }, dt);
  c.targetNext = false;
  c.dockRequest = false;
  jumpRequested = false;
  clearTouchEdges();

  syncPhase();
  playEvents();

  if (game.phase === 'flight') {
    renderScene();
    updateTargetReticle();
    hud.draw(game);
    audio.setEngine(game.player.throttle, true);
  } else if (game.phase === 'title' || game.phase === 'dead') {
    // keep the sky alive behind the menus
    renderScene();
    hud.draw(game);
    audio.setEngine(0, false);
  } else {
    hud.draw(game);
    audio.setEngine(0, false);
  }

  requestAnimationFrame(frame);
}

async function main() {
  renderer = new Renderer(glCanvas);
  hud = new Hud(hudCanvas, { plists: { hud: {}, crosshairs: {} } });
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));

  try {
    assets = await loadAssets((done, total, label) => {
      const pct = total ? Math.round((done / total) * 100) : 0;
      el('loading-fill').style.width = `${pct}%`;
      el('loading-label').textContent = label || '';
    });
  } catch (err) {
    el('loading-label').textContent = `failed to load: ${err.message}`;
    throw err;
  }

  hud = new Hud(hudCanvas, assets);
  hud.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio || 1, 2));
  buildGpu();

  game = createGame(assets);
  audio = new GameAudio(assets.sounds);

  setupKeyboard(window);
  setupMouse(glCanvas);
  setupGamepad();
  setupTouchControls({});
  wireDockScreen();

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyJ') jumpRequested = true;
  });

  el('btnStart').addEventListener('click', () => {
    audio.unlock();
    launch(game);
    hideOverlays();
    el('touch').classList.remove('hidden');
  });
  el('btnRestart').addEventListener('click', () => {
    game = createGame(assets);
    prevPhase = 'title';
    audio.unlock();
    launch(game);
    hideOverlays();
    el('touch').classList.remove('hidden');
  });
  el('btnJump').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    jumpRequested = true;
  });

  // ?autostart skips the title screen (used by the headless smoke test)
  const query = new URLSearchParams(location.search);
  if (query.has('autostart')) {
    audio.unlock();
    launch(game);
    hideOverlays();
    el('touch').classList.remove('hidden');
    // ?dock drops the ship next to the station so the market screen is testable
    if (query.has('dock')) {
      game.player.pos = [0, 0, 300];
      game.player.speed = 20;
    }
  }

  requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(frame); });
}

main().catch((err) => {
  console.error(err);
  const label = document.getElementById('loading-label');
  if (label) label.textContent = `error: ${err.message}`;
});
