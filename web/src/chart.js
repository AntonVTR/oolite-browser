// Chart screen — the port of Oolite's short-range chart plus, since #9, the
// long-range (whole-galaxy) chart and the original's system data screen:
//
//   - the real chart backdrop (upstream Resources/Images/
//     oolite-short-range-chart.png, copied to web/assets/images/) with systems
//     plotted at their galaxy coordinates the way GuiDisplayGen.m -drawStarChart
//     draws them — short range: a 64-unit window centred on the current system
//     at max zoom, y over 128 units; long range: the whole galaxy, x over 256
//     and y over 512 units centred on (128, 128), upstream's compact mode —
//     so both views share one projection at 4× zoom difference;
//   - a list of systems with their real data from galaxy.js (the short-range
//     list is everything inside the 7 ly jump ring, the long-range one the
//     whole galaxy, nearest first);
//   - the data screen the ZX guide shows on `P`: distance, economy,
//     government, tech level, population, gross productivity, average radius
//     and the description — every field straight from galaxy.js;
//   - the GALACTIC JUMP button (#8): armed by the first press, crossing on
//     the second.
//
// chartRows(), longRangeRows(), systemReadout() and ringSize() are pure and
// run in node (tests/test-chart.mjs). The screen builds its own DOM and
// styles because index.html / style.css are outside this change's scope, so
// nothing here touches the document until it is opened.

import { systemsIn, jump, galacticJump } from './game.js';
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

// Every system except the current one, nearest first, with the real data and
// whether the tank currently buys the hop. Both views render this list: the
// long-range chart shows all of it, the short-range chart clips it to the
// 7 ly ring.
export function longRangeRows(g) {
  const systems = systemsIn(g);
  const from = systems[g.systemIndex];
  const reach = Math.min(CHART_RANGE_LY, g.player.fuel / 10);
  const rows = [];
  for (const sys of systems) {
    if (sys.index === from.index) continue;
    const distance = distanceLy(from, sys);
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

// The systems inside jump range except the current one, nearest first.
export function chartRows(g) {
  return longRangeRows(g).filter((r) => r.distance <= CHART_RANGE_LY);
}

// The original's data screen (ZX guide key `P`): the fields Oolite's
// descriptions.plist "sysdata-*" lines print, straight from galaxy.js —
// nothing invented. population is in tenths of a billion (Oolite prints
// population × 0.1 "Billion"), productivity in millions of credits, radius
// in km, exactly as upstream's sysdata strings format them.
export function systemReadout(g, idx) {
  const systems = systemsIn(g);
  const sys = systems[idx];
  if (!sys) return null;
  const from = systems[g.systemIndex];
  return {
    index: sys.index,
    name: sys.name,
    current: sys.index === from.index,
    distance: sys.index === from.index ? 0 : distanceLy(from, sys),
    economy: ECONOMIES[sys.economy],
    government: GOVERNMENTS[sys.government],
    techLevel: sys.techLevel,
    population: sys.population,
    productivity: sys.productivity,
    radius: sys.radius,
    description: sys.description,
  };
}

// The fuel-range ring in percent of the map box. Reach is fuel/10 ly =
// fuel/4 chart units of radius, so the diameter is fuel/2 units, drawn in
// each view's own projection (short: 64 x 128 units, long: 256 x 512).
export function ringSize(fuel, view = 'short') {
  const diameter = fuel / 2;
  return view === 'long'
    ? { width: (diameter / 256) * 100, height: (diameter / 512) * 100 }
    : { width: (diameter / 64) * 100, height: (diameter / 128) * 100 };
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
.chart-dot.sel { background: #fff; box-shadow: 0 0 8px rgba(255,255,255,0.9); cursor: pointer; }
#chart-map.long .chart-dot { cursor: pointer; }
#chart-data {
  text-align: left; font-size: clamp(12px, 3.2vw, 15px); line-height: 1.55;
  border: 1px solid rgba(0,255,100,0.25); border-radius: 6px;
  padding: 8px 10px; margin-bottom: 12px; opacity: 0.92;
}
#chart-data .dname { color: #4f8; letter-spacing: 0.1em; font-size: clamp(14px, 3.8vw, 18px); }
#chart-data .ddesc { opacity: 0.8; font-style: italic; margin-top: 4px; }
#chart-list tr.sel td { background: rgba(0,255,100,0.10); }
#chart-sub { opacity: 0.8; }
`;

let overlay = null;
let open = false;
let gameRef = null;
let afterAction = null; // main.js playEvents(): flush jump/beep sounds at once
let view = 'short';     // 'short' (7 ly ring) | 'long' (whole galaxy) — #9
let selected = -1;      // system the data panel shows

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
      '<h1 id="chart-title">SHORT RANGE CHART</h1>' +
      '<div class="tabs">' +
        '<button id="btnChartShort" class="tab active">SHORT RANGE</button>' +
        '<button id="btnChartLong" class="tab">LONG RANGE</button>' +
      '</div>' +
      '<div class="sub" id="chart-sub"></div>' +
      '<div id="chart-map"></div>' +
      '<div id="chart-data"></div>' +
      '<table id="chart-list" class="market"></table>' +
      '<div class="row">' +
        '<button id="btnChartGal" class="big">GALACTIC JUMP</button>' +
        '<button id="btnChartClose" class="big">CLOSE</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#btnChartClose').addEventListener('click', () => closeChart());
  // The view toggle (#9): same .tabs row the station screen uses.
  overlay.querySelector('#btnChartShort').addEventListener('click', () => setView('short'));
  overlay.querySelector('#btnChartLong').addEventListener('click', () => setView('long'));
  // The galaxy jump (#8): the first press arms, the second crosses — a
  // 50 000 CR one-shot drive must never be spent by one stray tap.
  overlay.querySelector('#btnChartGal').addEventListener('click', () => {
    if (galacticJump(gameRef)) {
      if (afterAction) afterAction();
      closeChart(); // the arrival message belongs on the HUD, not the chart
      return;
    }
    render(gameRef); // armed (or refused): the label carries the state
  });
  // one delegated click each for the list (jump button, or select the row)
  // and the map's stars
  overlay.querySelector('#chart-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-idx]');
    if (btn) {
      if (!btn.disabled) doJump(Number(btn.dataset.idx));
      return;
    }
    const row = e.target.closest('tr[data-idx]');
    if (row) select(Number(row.dataset.idx));
  });
  overlay.querySelector('#chart-map').addEventListener('click', (e) => {
    const dot = e.target.closest('[data-idx]');
    if (!dot) return;
    const idx = Number(dot.dataset.idx);
    // a tap on an in-range star jumps on the short chart, as it always has;
    // the long-range map browses instead, so it only moves the data panel
    if (view === 'short' && dot.classList.contains('near')) doJump(idx);
    else select(idx);
  });
  return overlay;
}

function setTouchVisible(show) {
  const touch = el('touch');
  if (touch) touch.classList.toggle('hidden', !show);
}

function setView(v) {
  if (view === v || !gameRef) return;
  view = v;
  render(gameRef);
}

function select(idx) {
  selected = idx;
  render(gameRef);
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
  const systems = systemsIn(g);
  const from = systems[g.systemIndex];
  const rows = view === 'long' ? longRangeRows(g) : chartRows(g);
  const fuel = g.player.fuel;
  const long = view === 'long';

  el('chart-title').textContent = long ? 'LONG RANGE CHART' : 'SHORT RANGE CHART';
  el('btnChartShort').classList.toggle('active', !long);
  el('btnChartLong').classList.toggle('active', long);
  el('chart-sub').textContent = long
    ? `${from.name} · galaxy ${g.galaxy} · ${systems.length} systems · fuel ${(fuel / 10).toFixed(1)} ly`
    : `${from.name} · fuel ${(fuel / 10).toFixed(1)} ly · ${rows.length} in range`;

  // Backdrop, fuel-range ring and the stars. Short range keeps the original
  // 64-unit window around the ship; long range draws the whole galaxy the
  // way upstream's compact chart does (x over 256, y over 512, centred on
  // 128/128) — the same projection zoomed out 4×.
  let dots = '';
  if (long) {
    for (const sys of systems) {
      const here = sys.index === from.index;
      const sel = sys.index === selected;
      const near = !here && distanceLy(from, sys) <= CHART_RANGE_LY;
      const cls = here ? 'chart-dot here' : sel ? 'chart-dot sel'
        : near ? 'chart-dot near' : 'chart-dot';
      const pos = `left:${((sys.x / 256) * 100).toFixed(2)}%;`
        + `top:${(75 - (sys.y / 512) * 100).toFixed(2)}%;`;
      dots += `<div class="${cls}" style="${pos}" title="${sys.name}" data-idx="${sys.index}"></div>`;
    }
  } else {
    for (const sys of systems) {
      const dx = sys.x - from.x;
      const dy = sys.y - from.y;
      if (Math.abs(dx) > 42 || Math.abs(dy) > 74) continue; // Oolite's clip border at zoom 1
      const near = sys.index !== from.index && distanceLy(from, sys) <= CHART_RANGE_LY;
      const cls = sys.index === from.index ? 'chart-dot here' : near ? 'chart-dot near' : 'chart-dot';
      const pos = `left:${(50 + (dx / 64) * 100).toFixed(2)}%;top:${(50 - (dy / 128) * 100).toFixed(2)}%;`;
      dots += `<div class="${cls}" style="${pos}" title="${sys.name}"${near ? ` data-idx="${sys.index}"` : ''}></div>`;
    }
  }
  const ring = ringSize(fuel, view);
  const ringPos = long
    ? `left:${((from.x / 256) * 100).toFixed(2)}%;top:${(75 - (from.y / 512) * 100).toFixed(2)}%;`
    : 'left:50%;top:50%;';
  const map = el('chart-map');
  map.classList.toggle('long', long);
  map.innerHTML =
    '<img src="assets/images/oolite-short-range-chart.png" alt="">' +
    `<div class="chart-ring" style="${ringPos}width:${ring.width.toFixed(2)}%;height:${ring.height.toFixed(2)}%"></div>` +
    dots;

  // The data screen (#9): whatever the selection is, the panel always says
  // something — it opens on the system you are in.
  const ro = systemReadout(g, selected >= 0 ? selected : g.systemIndex);
  el('chart-data').innerHTML = !ro ? '' : `
    <div class="dname">${ro.name}</div>
    <div>Distance: ${ro.distance.toFixed(1)} ly</div>
    <div>Economy: ${ro.economy}</div>
    <div>Government: ${ro.government}</div>
    <div>Tech level: ${ro.techLevel}</div>
    <div>Population: ${(ro.population / 10).toFixed(1)} billion</div>
    <div>Gross productivity: ${ro.productivity} mcr</div>
    <div>Average radius: ${ro.radius} km</div>
    <div class="ddesc">${ro.description}</div>`;

  el('chart-list').innerHTML =
    '<tr><th>System</th><th>ly</th><th>TL</th><th>Government</th><th>Economy</th><th></th></tr>' +
    rows.map((r) => `<tr data-idx="${r.index}"${r.index === selected ? ' class="sel"' : ''}>
      <td>${r.name}</td>
      <td>${r.distance.toFixed(1)}</td>
      <td>${r.techLevel}</td>
      <td>${r.government}</td>
      <td>${r.economy}</td>
      <td><button data-idx="${r.index}" ${r.reachable ? '' : 'disabled'}>JUMP ${r.cost}</button></td>
    </tr>`).join('');

  // The galaxy-jump button carries its own state: without a fitted drive it
  // says so and stays dead, an armed press offers the confirm (#8).
  const gal = el('btnChartGal');
  const fitted = !!g.player.equipment.EQ_GAL_DRIVE;
  gal.disabled = !fitted;
  gal.textContent = !fitted ? 'GALACTIC — NO DRIVE'
    : g.galConfirm ? `CONFIRM — GALAXY ${(g.galaxy & 7) + 1}`
    : 'GALACTIC JUMP';
}

// Toggle from the C key or the CHART button. onAction is main.js's playEvents,
// called after any action that pushed sound events; initialView picks the
// opening view ('long' for the ?chart=long smoke).
export function toggleChart(g, onAction, initialView) {
  if (open) {
    closeChart();
    return true;
  }
  if (g.phase !== 'flight') return false; // chart only while flying
  gameRef = g;
  afterAction = onAction || null;
  ensureOverlay();
  view = initialView === 'long' ? 'long' : 'short';
  selected = g.systemIndex; // the data screen opens on where you are
  render(g);
  overlay.classList.remove('hidden');
  setTouchVisible(false); // the chart owns the screen; no stick grabs behind it
  open = true;
  return true;
}

export function closeChart() {
  if (!open) return;
  open = false;
  if (gameRef) gameRef.galConfirm = false; // an armed galactic press dies here
  if (overlay) overlay.classList.add('hidden');
  // back to the flight controls, but never over a menu (docked / dead)
  if (gameRef && gameRef.phase === 'flight') setTouchVisible(true);
}

export function isChartOpen() {
  return open;
}
