// CONTROLS setup page: the input tester (does one tap fire once?), gamepad
// button remapping and the touch layout. Same self-built overlay pattern as
// status.js — nothing touches the document until the page is opened, so the
// module imports cleanly under node.
//
// The tester reads the same log the real controls write to, and it survives
// open/close: tap TGT on the flight pad, reopen the page, the presses are
// still there.

import { inputLog, clearInputLog } from './inputlog.js';
import { ctrl, DEFAULT_PAD, PAD_ACTIONS, PAD_NAMES } from './controls.js';
import { makeTapButton, makeHoldButton, setTouchHand } from './touch.js';
import { loadSettings, saveSettings } from './settings.js';

const el = (id) => document.getElementById(id);

let overlay = null;
let open = false;
let tick = null; // log refresh while the page is open
let settings = null;
let phaseOf = () => 'title'; // main.js: is the flight pad supposed to show?

export function setPhaseSource(fn) {
  phaseOf = fn;
}

export function isSetupOpen() {
  return open;
}

// ---- settings ---------------------------------------------------------------
export function applySettings(s) {
  settings = s;
  const touch = el('touch');
  if (touch) touch.classList.toggle('lefty', s.hand === 'left');
  setTouchHand(s.hand);
  document.documentElement.style.setProperty(
    '--touch-scale', s.size === 's' ? '0.85' : s.size === 'l' ? '1.25' : '1');
  ctrl.padMap = { ...DEFAULT_PAD, ...s.pad };
}

export function initSettings() {
  applySettings(loadSettings());
}

function persist() {
  saveSettings(settings);
  applySettings(settings);
}

// ---- test tab ---------------------------------------------------------------
const KIND = { fired: 'ok', bind: 'ok', down: 'ok', blocked: 'warn', up: 'dim' };

function renderLog() {
  const box = overlay.querySelector('#input-log');
  const rows = inputLog().slice(-14).reverse();
  box.innerHTML = rows.length
    ? rows.map((r) =>
        `<div class="log-${KIND[r.kind] || 'dim'}">` +
        `<span class="lt">${r.t.toFixed(2)}s</span> ` +
        `<span class="ls">${r.source.toUpperCase()}</span> ` +
        `<span class="ln">${r.name}</span> <span class="lk">${r.kind}</span></div>`).join('')
    : '<div class="log-dim">no input yet — tap a button</div>';
}

// ---- gamepad tab ------------------------------------------------------------
function padConnected() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  return !!(pads && [...pads].find(Boolean));
}

function renderPad() {
  const box = overlay.querySelector('#pad-rows');
  box.innerHTML =
    (padConnected() ? '' : '<div class="hint">No gamepad detected — connect one to rebind.</div>') +
    PAD_ACTIONS.map((action) => {
      const names = (ctrl.padMap[action] || []).map((i) => PAD_NAMES[i]).join(', ');
      const capturing = ctrl.padCapture === action;
      return `<div class="pad-row${capturing ? ' cap' : ''}">` +
        `<span class="pad-act">${action.toUpperCase()}</span>` +
        `<span class="pad-btns">${capturing ? 'PRESS ANY BUTTON…' : (names || '—')}</span>` +
        `<button data-act="${action}">${capturing ? 'CANCEL' : 'REBIND'}</button></div>`;
    }).join('');
}

// ---- touch tab --------------------------------------------------------------
function renderTouch() {
  for (const [id, v] of [['#seg-size', settings.size], ['#seg-hand', settings.hand]]) {
    overlay.querySelectorAll(`${id} button`).forEach((b) =>
      b.classList.toggle('active', b.dataset.v === v));
  }
}

function showTab(name) {
  for (const t of ['test', 'pad', 'touch']) {
    overlay.querySelector(`#sec-${t}`).classList.toggle('hidden', t !== name);
    overlay.querySelector(`#tab-${t}`).classList.toggle('active', t === name);
  }
  if (name === 'pad') renderPad();
  if (name === 'touch') renderTouch();
}

// ---- the page ---------------------------------------------------------------
function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'setup';
  overlay.className = 'overlay hidden';
  overlay.innerHTML =
    '<div class="panel">' +
      '<h1>CONTROLS</h1>' +
      '<div class="tabs">' +
        '<button id="tab-test" class="tab active">TEST</button>' +
        '<button id="tab-pad" class="tab">GAMEPAD</button>' +
        '<button id="tab-touch" class="tab">TOUCH</button>' +
      '</div>' +
      '<div id="sec-test">' +
        '<div class="hint">One tap must log <b>fired</b> once — a second line within a ' +
        'quarter second shows <b>blocked</b>, which is the debounce swallowing a ghost. ' +
        'The real buttons log too: close this page, tap TGT on the flight pad, reopen.</div>' +
        '<div class="row">' +
          '<button id="btnTestTap" class="ctl">TAP TEST</button>' +
          '<button id="btnTestHold" class="ctl">HOLD TEST</button>' +
        '</div>' +
        '<div id="input-log"></div>' +
        '<div class="row"><button id="btnLogClear">CLEAR</button></div>' +
      '</div>' +
      '<div id="sec-pad" class="hidden">' +
        '<div id="pad-rows"></div>' +
        '<div class="row"><button id="btnPadReset">RESET DEFAULTS</button></div>' +
        '<div class="hint">REBIND, then press a button on the connected gamepad — ' +
        'it replaces that action\'s binding.</div>' +
      '</div>' +
      '<div id="sec-touch" class="hidden">' +
        '<div class="set-group"><span class="set-label">BUTTON SIZE</span>' +
          '<div class="seg" id="seg-size">' +
            '<button data-v="s">S</button><button data-v="m">M</button>' +
            '<button data-v="l">L</button></div></div>' +
        '<div class="set-group"><span class="set-label">HAND</span>' +
          '<div class="seg" id="seg-hand">' +
            '<button data-v="right">RIGHT</button><button data-v="left">LEFT</button>' +
          '</div></div>' +
        '<div class="hint">LEFT swaps the sides: the stick grabs the right half of ' +
        'the screen, the buttons and throttle move left.</div>' +
      '</div>' +
      '<div class="row"><button id="btnSetupClose" class="big">CLOSE</button></div>' +
    '</div>';
  document.body.appendChild(overlay);

  overlay.querySelector('#btnSetupClose').addEventListener('click', closeSetup);
  for (const t of ['test', 'pad', 'touch']) {
    overlay.querySelector(`#tab-${t}`).addEventListener('click', () => showTab(t));
  }
  overlay.querySelector('#btnLogClear').addEventListener('click', () => {
    clearInputLog();
    renderLog();
  });
  // The two test buttons ride the real pipeline (makeTapButton /
  // makeHoldButton), so the debounce they exercise is the production one.
  makeTapButton(overlay.querySelector('#btnTestTap'), () => {});
  makeHoldButton(overlay.querySelector('#btnTestHold'), () => {}, () => {});

  overlay.querySelector('#pad-rows').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const action = b.dataset.act;
    ctrl.padCapture = ctrl.padCapture === action ? null : action;
    renderPad();
  });
  overlay.querySelector('#btnPadReset').addEventListener('click', () => {
    ctrl.padMap = { ...DEFAULT_PAD };
    settings.pad = { ...DEFAULT_PAD };
    saveSettings(settings);
    renderPad();
  });
  const seg = (id, key) => overlay.querySelector(id).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[key] = b.dataset.v;
    persist();
    renderTouch();
  });
  seg('#seg-size', 'size');
  seg('#seg-hand', 'hand');

  ctrl.onPadBind = () => {
    settings.pad = { ...ctrl.padMap };
    saveSettings(settings);
    if (open) renderPad();
  };
  return overlay;
}

export function openSetup() {
  if (!settings) initSettings();
  ensureOverlay();
  open = true;
  ctrl.padCapture = null;
  overlay.classList.remove('hidden');
  el('touch')?.classList.add('hidden'); // the page covers the flight pad
  showTab('test');
  renderLog();
  if (tick) clearInterval(tick);
  tick = setInterval(() => { if (open) renderLog(); }, 200);
}

export function closeSetup() {
  if (!open) return;
  open = false;
  ctrl.padCapture = null;
  if (tick) { clearInterval(tick); tick = null; }
  overlay.classList.add('hidden');
  if (phaseOf() === 'flight') el('touch')?.classList.remove('hidden');
}
