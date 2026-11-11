// Virtual touch controls: left stick (pitch/yaw), throttle slider, roll buttons,
// fire / injectors / target / dock buttons. Pointer events work with touch,
// mouse and stylus; CSS keeps them clear of the HUD edges.

import { ctrl, enableGyro, startGyro, stopGyro } from './controls.js';

function el(id) { return document.getElementById(id); }

// The slider knob: track height minus knob height (30 px, see style.css), so
// it stays inside the slider at 0 % as well as 100 %.
let throttleKnob = null;
function placeKnob(node, v) {
  const t = 1 - Math.max(0, Math.min(1, v));
  node.style.top = `calc(${t.toFixed(3)} * (100% - 30px))`;
}

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
  // release even if capture was lost and the finger lifted elsewhere
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

function makeHoldButton(node, onDown, onUp) {
  let id = null;
  const release = (e) => {
    if (id === null || (e && e.pointerId !== id)) return;
    id = null;
    onUp();
  };
  node.addEventListener('pointerdown', (e) => {
    id = e.pointerId;
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    onDown(true);
    e.preventDefault();
  });
  node.addEventListener('pointerup', (e) => { e.preventDefault(); release(e); });
  node.addEventListener('pointercancel', release);
  node.addEventListener('pointerleave', release); // finger slid off without capture
  // safety net: a release outside the button must still unstick it
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
}

function makeTapButton(node, onTap) {
  node.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
}

export function setupTouchControls({ onGyroToggle }) {
  const state = { pitch: 0, yaw: 0, roll: 0, fire: false, injectors: false,
                  throttleSet: null, targetNext: false, dock: false };
  ctrl.touchState = state;

  // iOS Safari ignores user-scalable=no, so a fast second tap in the same spot
  // still zooms the page. Swallow it — never on a control, whose second click
  // (market BUY, TAP TO START) has to get through.
  let lastTap = { t: 0, x: 0, y: 0 };
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    const t = e.changedTouches[0];
    if (blocksDoubleTap(now, lastTap, t.clientX, t.clientY, e.target)) e.preventDefault();
    lastTap = { t: now, x: t.clientX, y: t.clientY };
  }, { passive: false });

  const stickL = el('stickL');
  const knobL = el('stickL-knob');
  if (stickL) makeStick(stickL, knobL, (x, y) => { state.yaw = -x; state.pitch = y; });

  // throttle slider: vertical drag sets absolute throttle target
  const slider = el('throttle');
  const knob = el('throttle-knob');
  throttleKnob = knob;
  if (slider) {
    let active = null;
    const setFromEvent = (e) => {
      const r = slider.getBoundingClientRect();
      const v = 1 - (e.clientY - r.top) / r.height;
      state.throttleSet = Math.max(0, Math.min(1, v));
      placeKnob(knob, state.throttleSet);
    };
    slider.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      slider.setPointerCapture(e.pointerId);
      setFromEvent(e);
      e.preventDefault();
    });
    slider.addEventListener('pointermove', (e) => { if (e.pointerId === active) setFromEvent(e); });
    const stop = (e) => {
      if (e.pointerId !== active) return;
      active = null;
      // value already applied; clear it so F/R and W/S can drive again
      state.throttleSet = null;
    };
    slider.addEventListener('pointerup', stop);
    slider.addEventListener('pointercancel', stop);
    slider.addEventListener('pointerleave', stop);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
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
  // One path for both gestures: the GYRO button's pointerdown and the keyboard
  // G keydown are each a real user gesture, which is what iOS requires to
  // grant DeviceOrientation permission — no second tap needed either way.
  const toggleGyro = async () => {
    if (ctrl.gyroOn) {
      stopGyro();
      ctrl.gyroOn = false;
      if (gyro) { gyro.classList.remove('on'); gyro.textContent = 'GYRO'; }
    } else {
      const ok = await enableGyro();
      if (ok) {
        startGyro();
        ctrl.gyroOn = true;
        if (gyro) { gyro.classList.add('on'); gyro.textContent = 'GYRO ON'; }
      } else if (gyro) {
        gyro.textContent = 'NO GYRO';
        setTimeout(() => { gyro.textContent = 'GYRO'; }, 1500);
      }
    }
    if (onGyroToggle) onGyroToggle(ctrl.gyroOn);
  };
  if (gyro) makeTapButton(gyro, toggleGyro);
  ctrl.onGyroKey = toggleGyro;

  // Fullscreen toggle. iPhone Safari has no element-fullscreen API — hide the
  // button there rather than leave a control that does nothing.
  const full = el('btnFull');
  if (full) {
    const root = document.documentElement;
    const req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (req) {
      makeTapButton(full, () => {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        const p = fs
          ? (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
          : req.call(root);
        if (p && p.catch) p.catch(() => { /* refused: no gesture or no support */ });
      });
    } else {
      full.classList.add('hidden');
    }
  }
  return state;
}

// Called each frame so one-shot touch actions clear after being read.
export function clearTouchEdges() {
  const s = ctrl.touchState;
  if (s) { s.targetNext = false; s.dock = false; }
}

// Keep the slider knob on the real throttle: W/S, F/R and the gamepad change
// it without the slider being touched (it starts at 45 %).
export function syncThrottleKnob(v) {
  if (throttleKnob) placeKnob(throttleKnob, v);
}

// A would-be double-tap zoom: the second touchend within 300 ms and 30 px of
// the last one — but never on a control, whose second click must survive.
export function blocksDoubleTap(now, last, x, y, target) {
  return now - last.t <= 300 &&
    Math.abs(x - last.x) < 30 && Math.abs(y - last.y) < 30 &&
    !target.closest?.('button, a, input');
}
