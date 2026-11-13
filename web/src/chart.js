// Short-range chart screen — the port of Oolite's GUI_SCREEN_SHORT_RANGE_CHART:
// the real chart backdrop (upstream Resources/Images/oolite-short-range-chart.png,
// copied to web/assets/images/) with systems plotted at their galaxy
// coordinates the way GuiDisplayGen.m -drawStarChart draws them at max zoom —
// a 64 x 64 chart-unit window centred on the current system, y axis at half
// scale — plus a list of every system inside the 7 ly jump range with its
// real data from galaxy.js.
//
// chartRows() is pure and runs in node (tests/test-chart.mjs). The screen
// builds its own DOM and styles because index.html / style.css are outside
// this change's scope, so nothing here touches the document until it is
// opened.

import { SYSTEMS, jump } from './game.js';
import { distanceLy } from './galaxy.js';

// descriptions.plist "government" and economy name tables.
export const GOVERNMENTS = [
  'Anarchy', 'Feudal', 'Multi-Government', 'Dictatorship',
  'Communist', 'Confederacy', 'Democracy', 'Corporate State',
];
export const ECONOMIES = [
  'Rich Industrial', 'Average Industrial', 'Poor Industrial', 'Mainly Industrial',
  'Mainly Agricultural', 'Rich Agricultural', 'Average Agricultural', 'Poor Agricultural',
];

export const CHART_RANGE_LY = 7;

// Every system inside jump range except the current one, nearest first, with
// the real data and whether the tank currently buys the hop.
export function chartRows(g) {
  const from = SYSTEMS[g.systemIndex];
  const reach = Math.min(CHART_RANGE_LY, g.player.fuel / 10);
  const rows = [];
  for (const sys of SYSTEMS) {
    if (sys.index === from.index) continue;
    const distance = distanceLy(from, sys);
    if (distance > CHART_RANGE_LY) continue;
    rows.push({
      index: sys.index,
      name: sys.name,
      techLevel: sys.techLevel,
      government: GOVERNMENTS[sys.government],
      economy: ECONOMIES[sys.economy],
      distance,
      cost: Math.max(1, Math.round(distance * 10)), // tenths of a ly, as jump() charges
      reachable: distance <= reach,
    });
  }
  rows.sort((a, b) => a.distance - b.distance);
  return rows;
}

// ---- screen ----------------------------------------------------------------
const CHART_CSS = `
#chart { justify-content: flex-start; overflow-y: auto; touch-action: pan-y; }
#chart-map {
  position: relative; width: 100%; aspect-ratio: 2 / 1;
  margin: 10px 0 14px; border: 1px solid rgba(0,255,100,0.35);
  overflow: hidden; background: #001108;
}
#chart-map img { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.9; }
.chart-ring {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  border: 1px dashed rgba(0,255,100,0.55); border-radius: 50%; pointer-events: none;
}
.chart-dot {
  position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px;
  border-radius: 50%; background: rgba(255,255,200,0.4);
}
.chart-dot.near { background: #ff9; box-shadow: 0 0 6px rgba(255,255,150,0.85); cursor: pointer; }
.chart-dot.here { background: #3f6; box-shadow: 0 0 8px rgba(0,255,100,0.9); width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; }
#chart-sub { opacity: 0.8; }
`;

let overlay = null;
let open = false;
let gameRef = null;
let afterAction = null; // main.js playEvents(): flush jump/beep sounds at once

const el = (id) => document.getElementById(id);

function ensureOverlay() {
  if (overlay) return overlay;
  if (!document.getElementById('chart-style')) {
    const style = document.createElement('style');
    style.id = 'chart-style';
    style.textContent = CHART_CSS;
    document.head.appendChild(style);
  }
  overlay = document.createElement('div');
  overlay.id = 'chart';
  overlay.className = 'overlay hidden';
  overlay.innerHTML =
    '<div class="panel">' +
      '<h1>SHORT RANGE CHART</h1>' +
      '<div class="sub" id="chart-sub"></div>' +
      '<div id="chart-map"></div>' +
      '<table id="chart-list" class="market"></table>' +
      '<div class="row"><button id="btnChartClose" class="big">CLOSE</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#btnChartClose').addEventListener('click', () => closeChart());
  // one delegated click each for the list buttons and the map's in-range dots
  overlay.querySelector('#chart-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-idx]');
    if (btn && !btn.disabled) doJump(Number(btn.dataset.idx));
  });
  overlay.querySelector('#chart-map').addEventListener('click', (e) => {
    const dot = e.target.closest('[data-idx]');
    if (dot) doJump(Number(dot.dataset.idx));
  });
  return overlay;
}

function setTouchVisible(show) {
  const touch = el('touch');
  if (touch) touch.classList.toggle('hidden', !show);
}

function doJump(idx) {
  // Success or refusal both leave a message for the HUD, so the chart closes
  // either way; main.js's onAction plays the jump sound straight away (the
  // frame loop would clear the event first).
  jump(gameRef, idx);
  if (afterAction) afterAction();
  closeChart();
}

function render(g) {
  const from = SYSTEMS[g.systemIndex];
  const rows = chartRows(g);
  const fuel = g.player.fuel;
  el('chart-sub').textContent =
    `${from.name} · fuel ${(fuel / 10).toFixed(1)} ly · ${rows.length} in range`;

  // Backdrop, fuel-range ring (same ellipse maths as drawStarChart: 5 chart
  // units per ly, x over 64 units, y over 128) and the stars in view.
  let dots = '';
  for (const sys of SYSTEMS) {
    const dx = sys.x - from.x;
    const dy = sys.y - from.y;
    if (Math.abs(dx) > 42 || Math.abs(dy) > 74) continue; // Oolite's clip border at zoom 1
    const near = sys.index !== from.index && distanceLy(from, sys) <= CHART_RANGE_LY;
    const cls = sys.index === from.index ? 'chart-dot here' : near ? 'chart-dot near' : 'chart-dot';
    const pos = `left:${(50 + (dx / 64) * 100).toFixed(2)}%;top:${(50 - (dy / 128) * 100).toFixed(2)}%;`;
    dots += `<div class="${cls}" style="${pos}" title="${sys.name}"${near ? ` data-idx="${sys.index}"` : ''}></div>`;
  }
  el('chart-map').innerHTML =
    '<img src="assets/images/oolite-short-range-chart.png" alt="">' +
    `<div class="chart-ring" style="width:${((fuel * 100) / 64).toFixed(1)}%;height:${((fuel * 100) / 128).toFixed(1)}%"></div>` +
    dots;

  el('chart-list').innerHTML =
    '<tr><th>System</th><th>ly</th><th>TL</th><th>Government</th><th>Economy</th><th></th></tr>' +
    rows.map((r) => `<tr>
      <td>${r.name}</td>
      <td>${r.distance.toFixed(1)}</td>
      <td>${r.techLevel}</td>
      <td>${r.government}</td>
      <td>${r.economy}</td>
      <td><button data-idx="${r.index}" ${r.reachable ? '' : 'disabled'}>JUMP ${r.cost}</button></td>
    </tr>`).join('');
}

// Toggle from the C key or the CHART button. onAction is main.js's playEvents,
// called after any action that pushed sound events.
export function toggleChart(g, onAction) {
  if (open) {
    closeChart();
    return true;
  }
  if (g.phase !== 'flight') return false; // chart only while flying
  gameRef = g;
  afterAction = onAction || null;
  ensureOverlay();
  render(g);
  overlay.classList.remove('hidden');
  setTouchVisible(false); // the chart owns the screen; no stick grabs behind it
  open = true;
  return true;
}

export function closeChart() {
  if (!open) return;
  open = false;
  if (overlay) overlay.classList.add('hidden');
  // back to the flight controls, but never over a menu (docked / dead)
  if (gameRef && gameRef.phase === 'flight') setTouchVisible(true);
}

export function isChartOpen() {
  return open;
}
