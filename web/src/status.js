// STATUS screen — the in-flight commander status page (MISSING-FEATURES.md
// #3): commander, present system, fuel, cash, legal status and rating — the
// fields of the original status page (original key `5`, keyconfig.plist
// key_gui_screen_status). The hyperspace nav target is skipped: the chart
// jumps immediately — there is nothing to show.
//
// Same overlay pattern as slots.js: the screen builds its own DOM from the
// shared .overlay/.panel/.market styles in style.css (no extra CSS needed),
// and nothing touches the document until it is opened. statusRows() is pure
// and runs in node (tests/test-status.mjs).

import { systemsIn, rankName, legalStatus } from './game.js';

// The fields, straight from live game state.
export function statusRows(g) {
  const p = g.player;
  const rows = [
    ['Commander', g.commanderName || 'JAMESON'],
    ['Present system', g.witchspace ? 'WITCHSPACE (no station)' : systemsIn(g)[g.systemIndex].name],
    ['Fuel', `${(p.fuel / 10).toFixed(1)} ly`],
    ['Cash', `${p.credits.toFixed(1)} CR`],
    ['Legal status', legalStatus(g.crime)],
    ['Rating', rankName(g.kills)],
  ];
  // the C64's pet only has a line of its own when one is aboard (#23)
  if (g.trumbles) rows.push(['Trumbles', String(g.trumbles)]);
  return rows;
}

// ---- screen ----------------------------------------------------------------
let overlay = null;
let open = false;
let gameRef = null;

const el = (id) => document.getElementById(id);

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'status';
  overlay.className = 'overlay hidden';
  overlay.innerHTML =
    '<div class="panel">' +
      '<h1>STATUS</h1>' +
      '<table id="status-list" class="market"></table>' +
      '<div class="row"><button id="btnStatusClose" class="big">CLOSE</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#btnStatusClose').addEventListener('click', () => closeStatus());
  return overlay;
}

function setTouchVisible(show) {
  const touch = el('touch');
  if (touch) touch.classList.toggle('hidden', !show);
}

function render(g) {
  el('status-list').innerHTML = statusRows(g)
    .map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`)
    .join('');
}

// Toggle from the 5 key or the STATUS button; only while flying, like the chart.
export function toggleStatus(g) {
  if (open) {
    closeStatus();
    return true;
  }
  if (g.phase !== 'flight') return false;
  gameRef = g;
  ensureOverlay();
  render(g);
  overlay.classList.remove('hidden');
  setTouchVisible(false); // the screen owns it; no stick grabs behind it
  open = true;
  return true;
}

export function closeStatus() {
  if (!open) return;
  open = false;
  if (overlay) overlay.classList.add('hidden');
  // back to the flight controls, but never over a menu (docked / dead)
  if (gameRef && gameRef.phase === 'flight') setTouchVisible(true);
}

export function isStatusOpen() {
  return open;
}
