// SAVE (station) and LOAD (title) slot menus — three manual save slots beside
// the auto-save. Same overlay pattern as chart.js: the screen builds its own
// DOM from the shared .overlay/.panel/.market styles in style.css (no extra
// CSS needed) because index.html and style.css are outside this change's
// scope, and nothing here touches the document until a menu is opened.

import { SYSTEMS } from './game.js';
import { SLOT_COUNT, slotInfo, saveSlot, loadSlot } from './save.js';

let overlay = null;
let mode = 'save'; // 'save' (station) | 'load' (title)
let gameRef = null;
let storageRef = null;
let armed = -1;        // slot waiting for its overwrite confirmation
let onAction = null;   // main.js playEvents(): flush the UI beep at once
let onLoaded = null;   // main.js: drop the title screen after a load

const el = (id) => document.getElementById(id);

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'slots';
  overlay.className = 'overlay hidden';
  overlay.innerHTML =
    '<div class="panel">' +
      '<h1 id="slots-title">SAVE GAME</h1>' +
      '<div class="sub" id="slots-sub"></div>' +
      '<table id="slots-list" class="market"></table>' +
      '<div class="row"><button id="btnSlotsClose" class="big">CLOSE</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#btnSlotsClose').addEventListener('click', closeSlots);
  // one delegated click for the slot buttons (the table body is re-rendered)
  overlay.querySelector('#slots-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-slot]');
    if (btn && !btn.disabled) pick(Number(btn.dataset.slot));
  });
  return overlay;
}

function render() {
  const saving = mode === 'save';
  el('slots-title').textContent = saving ? 'SAVE GAME' : 'LOAD GAME';
  el('slots-sub').textContent = saving
    ? 'pick a slot — a filled one asks to confirm the overwrite'
    : 'pick a saved game';
  let rows = '';
  for (let i = 0; i < SLOT_COUNT; i++) {
    const info = slotInfo(i, storageRef);
    const contents = info
      ? `${SYSTEMS[info.systemIndex].name} · ${info.credits.toFixed(1)} CR · ` +
        `${info.phase.toUpperCase()} · ${info.kills} kills`
      : 'empty';
    const action = saving
      ? `<button data-slot="${i}">${info ? (armed === i ? 'CONFIRM' : 'OVERWRITE') : 'SAVE'}</button>`
      : `<button data-slot="${i}"${info ? '' : ' disabled'}>LOAD</button>`;
    rows += `<tr><td>SLOT ${i + 1}</td><td>${contents}</td><td>${action}</td></tr>`;
  }
  el('slots-list').innerHTML =
    '<tr><th>Slot</th><th>Contents</th><th></th></tr>' + rows;
}

function pick(i) {
  const info = slotInfo(i, storageRef);
  if (mode === 'save') {
    // a filled slot needs a second click, so nothing is overwritten by one tap
    if (info && armed !== i) { armed = i; render(); return; }
    if (!saveSlot(gameRef, i, storageRef)) return;
    armed = -1;
    gameRef.events.push({ type: 'beep' }); // main.js's onAction plays it at once
    if (onAction) onAction();
    render();
    return;
  }
  if (!info || !loadSlot(gameRef, i, storageRef)) return;
  closeSlots();
  if (onLoaded) onLoaded();
}

// opts: { mode: 'save'|'load', onAction, onLoaded }
export function openSlots(g, storage, opts = {}) {
  gameRef = g;
  storageRef = storage;
  mode = opts.mode === 'load' ? 'load' : 'save';
  onAction = opts.onAction || null;
  onLoaded = opts.onLoaded || null;
  armed = -1;
  ensureOverlay();
  render();
  overlay.classList.remove('hidden');
}

export function closeSlots() {
  if (overlay) overlay.classList.add('hidden');
  armed = -1;
}
