// SAVE (station) and LOAD (title) slot menus — three manual save slots beside
// the auto-save. Same overlay pattern as chart.js: the screen builds its own
// DOM from the shared .overlay/.panel/.market styles in style.css (no extra
// CSS needed) because index.html and style.css are outside this change's
// scope, and nothing here touches the document until a menu is opened.

import { rankName } from './game.js';
import { galaxySystems } from './galaxy.js';
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

// Rows are built with textContent: the contents cell carries the commander
// name from the save, and innerHTML would hand it to the parser.
function render() {
  const saving = mode === 'save';
  el('slots-title').textContent = saving ? 'SAVE GAME' : 'LOAD GAME';
  el('slots-sub').textContent = saving
    ? 'pick a slot — a filled one asks to confirm the overwrite'
    : 'pick a saved game';
  const table = el('slots-list');
  table.textContent = '';
  const head = document.createElement('tr');
  for (const label of ['Slot', 'Contents', '']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  table.append(head);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const info = slotInfo(i, storageRef);
    const contents = info
      ? `${info.name || 'JAMESON'} · ${galaxySystems(info.galaxy || 1)[info.systemIndex].name} · ` +
        `${info.credits.toFixed(1)} CR · ` +
        `${info.phase.toUpperCase()} · ${info.kills} kills · ${rankName(info.kills)}`
      : 'empty';
    const tr = document.createElement('tr');
    const slot = document.createElement('td');
    const body = document.createElement('td');
    const cell = document.createElement('td');
    const btn = document.createElement('button');
    slot.textContent = `SLOT ${i + 1}`;
    body.textContent = contents;
    btn.dataset.slot = String(i);
    btn.textContent = saving
      ? (info ? (armed === i ? 'CONFIRM' : 'OVERWRITE') : 'SAVE')
      : 'LOAD';
    if (!saving) btn.disabled = !info;
    cell.append(btn);
    tr.append(slot, body, cell);
    table.append(tr);
  }
}

function pick(i) {
  const info = slotInfo(i, storageRef);
  if (mode === 'save') {
    // a filled slot needs a second click, so nothing is overwritten by one tap
    if (info && armed !== i) { armed = i; render(); return; }
    if (!saveSlot(gameRef, i, storageRef)) {
      // a refused write (private mode, quota) must not read as a saved slot
      el('slots-sub').textContent = 'SAVE FAILED — storage is full or blocked';
      return;
    }
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
