// Virtual touch controls: left stick (pitch/yaw), throttle slider, roll buttons,
// fire / injectors / target / dock buttons. Pointer events work with touch,
// mouse and stylus; CSS keeps them clear of the HUD edges.

import { ctrl, enableGyro, startGyro, stopGyro } from './controls.js';

function el(id) { return document.getElementById(id); }

function makeStick(node, knob, onChange) {
  let activeId = null;
  const rectOf = () => node.getBoundingClientRect();
  const move = (e) => {
    if (e.pointerId !== activeId) return;
    const r = rectOf();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const rad = r.width / 2;
    let dx = (e.clientX - cx) / rad;
    let dy = (e.clientY - cy) / rad;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    knob.style.transform = `translate(${dx * rad * 0.6}px, ${dy * rad * 0.6}px)`;
    onChange(dx, -dy); // screen y is down, pitch up is +
  };
  const end = (e) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    knob.style.transform = 'translate(0,0)';
    onChange(0, 0);
  };
  node.addEventListener('pointerdown', (e) => {
    activeId = e.pointerId;
    node.setPointerCapture(e.pointerId);
    move(e);
    e.preventDefault();
  });
  node.addEventListener('pointermove', move);
  node.addEventListener('pointerup', end);
  node.addEventListener('pointercancel', end);
}

function makeHoldButton(node, onDown, onUp) {
  let id = null;
  const down = (e) => {
    id = e.pointerId;
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    onDown(true);
    e.preventDefault();
  };
  const up = (e) => {
    if (id !== null && e && e.pointerId !== undefined && e.pointerId !== id) return;
    id = null;
    onUp();
    if (e) e.preventDefault();
  };
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerup', up);
  node.addEventListener('pointercancel', up);
}

function makeTapButton(node, onTap) {
  node.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
}

export function setupTouchControls({ onGyroToggle }) {
  const state = { pitch: 0, yaw: 0, roll: 0, fire: false, injectors: false,
                  throttleSet: null, targetNext: false, dock: false };
  ctrl.touchState = state;

  const stickL = el('stickL');
  const knobL = el('stickL-knob');
  if (stickL) makeStick(stickL, knobL, (x, y) => { state.yaw = -x; state.pitch = y; });

  // throttle slider: vertical drag sets absolute throttle target
  const slider = el('throttle');
  const knob = el('throttle-knob');
  if (slider) {
    let active = null;
    const setFromEvent = (e) => {
      const r = slider.getBoundingClientRect();
      const v = 1 - (e.clientY - r.top) / r.height;
      state.throttleSet = Math.max(0, Math.min(1, v));
      knob.style.top = `${(1 - state.throttleSet) * 100}%`;
    };
    slider.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      slider.setPointerCapture(e.pointerId);
      setFromEvent(e);
      e.preventDefault();
    });
    slider.addEventListener('pointermove', (e) => { if (e.pointerId === active) setFromEvent(e); });
    const stop = (e) => { if (e.pointerId === active) active = null; };
    slider.addEventListener('pointerup', stop);
    slider.addEventListener('pointercancel', stop);
  }

  const fire = el('btnFire');
  if (fire) makeHoldButton(fire, () => { state.fire = true; }, () => { state.fire = false; });
  const inj = el('btnInjectors');
  if (inj) makeHoldButton(inj, () => { state.injectors = true; }, () => { state.injectors = false; });
  const rollL = el('btnRollL');
  const rollR = el('btnRollR');
  if (rollL) makeHoldButton(rollL, () => { state.roll = -1; }, () => { state.roll = 0; });
  if (rollR) makeHoldButton(rollR, () => { state.roll = 1; }, () => { state.roll = 0; });
  const tgt = el('btnTarget');
  if (tgt) makeTapButton(tgt, () => { state.targetNext = true; });
  const dock = el('btnDock');
  if (dock) makeTapButton(dock, () => { state.dock = true; });

  const gyro = el('btnGyro');
  if (gyro) {
    makeTapButton(gyro, async () => {
      if (ctrl.gyroOn) {
        stopGyro();
        ctrl.gyroOn = false;
        gyro.classList.remove('on');
        gyro.textContent = 'GYRO';
        return;
      }
      const ok = await enableGyro();
      if (ok) {
        startGyro();
        ctrl.gyroOn = true;
        gyro.classList.add('on');
        gyro.textContent = 'GYRO ON';
      } else {
        gyro.textContent = 'NO GYRO';
        setTimeout(() => { gyro.textContent = 'GYRO'; }, 1500);
      }
      if (onGyroToggle) onGyroToggle(ctrl.gyroOn);
    });
  }
  return state;
}

// Called each frame so one-shot touch actions clear after being read.
export function clearTouchEdges() {
  const s = ctrl.touchState;
  if (s) { s.targetNext = false; s.dock = false; }
}
