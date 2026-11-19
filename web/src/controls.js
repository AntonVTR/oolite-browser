// Input aggregation: keyboard + mouse + gamepad + touch controls + gyro.
// Every source writes its own slot; ctrl.update() combines them once per frame.
//
// Sign conventions (match the ported Oolite flight model):
//   pitch   +1 = nose up (climb),   -1 = nose down
//   yaw     +1 = yaw left,          -1 = yaw right
//   roll    +1 = roll right,        -1 = roll left
//   throttle axis: +1 speed up, -1 slow down; throttleSet: absolute 0..1 target

import { logInput } from './inputlog.js';

// Standard gamepad (Chrome "standard mapping") button actions. Rebindable on
// the CONTROLS page (ctrl.padMap); axes and the D-pad are not.
export const DEFAULT_PAD = {
  fire: [7, 0],        // RT or A
  injectors: [6, 5, 2], // LT, RB or X
  target: [4, 1],      // LB or B
  jump: [3],           // Y
  dock: [8],           // Back
  missile: [9],        // Start
};
export const PAD_ACTIONS = Object.keys(DEFAULT_PAD);
export const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT',
  'BACK', 'START', 'L3', 'R3', 'D-UP', 'D-DOWN', 'D-LEFT', 'D-RIGHT'];

export const ctrl = {
  pitch: 0, yaw: 0, roll: 0, throttle: 0, throttleSet: null,
  fire: false, injectors: false,
  launchMissile: false, ecm: false,
  targetNext: false, dockRequest: false, pause: false, jump: false,
  gyroOn: false,
  onGyroKey: null, // keyboard G → toggleGyro() installed by touch.js
  // Gamepad bindings, rebound on the CONTROLS setup page. Axes and the D-pad
  // stay fixed; every button action is a list of indexes (several buttons may
  // share one action, as the defaults do).
  padMap: { ...DEFAULT_PAD },
  padCapture: null, // action name while the page waits for the next press
  onPadBind: null,  // setup.js: save + repaint once a rebind lands
  sources: { kb: {}, mouse: {}, touch: {}, gyro: {}, pad: {} },
};

const keys = new Set();

export function setupKeyboard(target = window) {
  const kb = ctrl.sources.kb;
  target.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    logInput('kb', e.code, 'down');
    keys.add(e.code);
    if (e.code === 'Tab') { ctrl.targetNext = true; e.preventDefault(); }
    if (e.code === 'KeyM') ctrl.launchMissile = true; // Oolite's missile key
    if (e.code === 'KeyX') ctrl.ecm = true;
    if (e.code === 'Enter') ctrl.dockRequest = true;
    if (e.code === 'KeyG' && ctrl.onGyroKey) ctrl.onGyroKey(); // keydown = iOS gesture
    if (e.code === 'Escape') ctrl.pause = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown'].includes(e.code)) {
      e.preventDefault();
    }
  });
  target.addEventListener('keyup', (e) => keys.delete(e.code));
  target.addEventListener('blur', () => keys.clear());

  kb.poll = () => {
    const has = (c) => keys.has(c);
    let pitch = 0, yaw = 0, roll = 0, thr = 0;
    if (has('ArrowUp')) pitch -= 1;
    if (has('ArrowDown')) pitch += 1;
    if (has('ArrowLeft')) yaw += 1;
    if (has('ArrowRight')) yaw -= 1;
    if (has('KeyQ')) yaw += 1;
    if (has('KeyE')) yaw -= 1;
    if (has('KeyA') || has('Comma')) roll -= 1;
    if (has('KeyD') || has('Period')) roll += 1;
    if (has('KeyW') || has('PageUp') || has('Equal') || has('NumpadAdd')) thr += 1;
    if (has('KeyS') || has('PageDown') || has('Minus') || has('NumpadSubtract')) thr -= 1;
    // F = full throttle, R = reverse (cut to zero) — absolute targets
    const throttleSet = has('KeyF') ? 1 : has('KeyR') ? 0 : null;
    return {
      pitch, yaw, roll, throttle: thr, throttleSet,
      fire: has('Space'),
      injectors: has('ShiftLeft') || has('ShiftRight') || has('KeyI'),
    };
  };
}

export function setupMouse(glCanvas) {
  const m = ctrl.sources.mouse;
  m.pitch = 0; m.yaw = 0; m.fire = false; m.dragging = false;
  let lastX = 0, lastY = 0;
  glCanvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // touch goes to the virtual sticks
    m.dragging = true;
    m.fire = e.button === 0;
    logInput('mouse', 'canvas', 'down');
    lastX = e.clientX; lastY = e.clientY;
    glCanvas.setPointerCapture(e.pointerId);
  });
  glCanvas.addEventListener('pointermove', (e) => {
    if (!m.dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    m.pitch = clamp(m.pitch + dy * 0.012, -1, 1);
    m.yaw = clamp(m.yaw - dx * 0.012, -1, 1);
  });
  const end = () => { m.dragging = false; m.fire = false; };
  glCanvas.addEventListener('pointerup', end);
  glCanvas.addEventListener('pointercancel', end);
  glCanvas.addEventListener('wheel', (e) => {
    ctrl.sources.kb.wheel = clamp((ctrl.sources.kb.wheel || 0) - Math.sign(e.deltaY) * 0.5, -1, 1);
    e.preventDefault();
  }, { passive: false });
  m.poll = () => {
    // stick returns to centre shortly after the mouse stops
    const decay = 1 / 30;
    if (!m.dragging) { m.pitch = decayToward(m.pitch, 0, decay); m.yaw = decayToward(m.yaw, 0, decay); }
    return { pitch: m.pitch, yaw: m.yaw, fire: m.fire, throttle: ctrl.sources.kb.wheel || 0 };
  };
}

// Gamepad polling. Buttons read through ctrl.padMap (rebound on the CONTROLS
// page); axes and the D-pad are fixed. Every press also feeds the tester's
// log and the rebind capture.
export function setupGamepad() {
  const pad = ctrl.sources.pad;
  let jumpWasDown = false;
  let missileWasDown = false;
  let targetWasDown = false;
  let padWas = new Array(16).fill(false); // raw edges for the tester + rebind
  pad.poll = () => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(Boolean);
    // Edge flags persist across a dropout: reconnecting while a button is
    // still held must not fire an edge that no new press created.
    if (!gp) return null;
    const ax = (i) => (typeof gp.axes[i] === 'number' ? gp.axes[i] : 0);
    const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const bound = (action) => (ctrl.padMap[action] || []).some((i) => btn(i));

    // Raw presses: the tester logs every new one, and a pending rebind takes
    // the first button pressed after REBIND was clicked.
    for (let i = 0; i < 16; i++) {
      if (!btn(i) || padWas[i]) continue;
      if (ctrl.padCapture) {
        const action = ctrl.padCapture;
        ctrl.padMap[action] = [i];
        ctrl.padCapture = null;
        logInput('pad', PAD_NAMES[i], 'bind');
        if (ctrl.onPadBind) ctrl.onPadBind(action, i);
      } else {
        logInput('pad', PAD_NAMES[i], 'down');
      }
    }
    for (let i = 0; i < 16; i++) padWas[i] = btn(i);

    const jumpDown = bound('jump');
    const jump = jumpDown && !jumpWasDown; // one jump per press
    jumpWasDown = jumpDown;
    const missileDown = bound('missile');
    const missile = missileDown && !missileWasDown; // one missile per press
    missileWasDown = missileDown;
    // One target cycle per press — level-triggering here made a held (or
    // drifting) button hop the target every frame, which no debounce can catch.
    const targetDown = bound('target');
    const target = targetDown && !targetWasDown;
    targetWasDown = targetDown;
    let roll = dz(ax(2));
    if (btn(14)) roll = -1; else if (btn(15)) roll = 1;
    let throttle = dz(-ax(3));
    if (btn(12)) throttle = 1; else if (btn(13)) throttle = -1;
    return {
      pitch: dz(-ax(1)),
      yaw: dz(-ax(0)),
      roll, throttle,
      fire: bound('fire'),
      injectors: bound('injectors'),
      target,
      jump,
      dock: bound('dock'),
      missile,
    };
  };
}

// ---- gyro (DeviceOrientation) ---------------------------------------------
export async function enableGyro() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return false;
  if (typeof DOE.requestPermission === 'function') {
    try {
      const res = await DOE.requestPermission();
      return res === 'granted';
    } catch (e) { return false; }
  }
  return true;
}

export function startGyro() {
  const g = ctrl.sources.gyro;
  g.pitch = 0; g.roll = 0; g.calBeta = null; g.calGamma = null; g.on = true;
  if (g.handler) return;
  g.handler = (e) => {
    if (!g.on) return;
    const beta = e.beta, gamma = e.gamma;
    if (beta == null || gamma == null) return;
    if (g.calBeta === null) { g.calBeta = beta; g.calGamma = gamma; }
    const dBeta = beta - g.calBeta;
    const dGamma = gamma - g.calGamma;
    // Tilt top of device away → nose up; tilt right → roll right.
    g.pitch = clamp(dBeta / 25, -1, 1);
    g.roll = clamp(-dGamma / 25, -1, 1);
  };
  window.addEventListener('deviceorientation', g.handler);
}

export function stopGyro() {
  const g = ctrl.sources.gyro;
  g.on = false;
  g.pitch = 0; g.roll = 0;
}

// ---- aggregation -----------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function decayToward(v, target, amount) {
  if (v > target) return Math.max(target, v - amount);
  return Math.min(target, v + amount);
}
const sum = (...vals) => clamp(vals.reduce((s, v) => s + (v || 0), 0), -1, 1);

export function updateCtrl() {
  const kb = ctrl.sources.kb.poll ? ctrl.sources.kb.poll() : {};
  const ms = ctrl.sources.mouse.poll ? ctrl.sources.mouse.poll() : {};
  const pad = ctrl.sources.pad.poll ? ctrl.sources.pad.poll() : null;
  const t = ctrl.touchState || {};
  const g = ctrl.sources.gyro;

  ctrl.pitch = sum(kb.pitch, ms.pitch, t.pitch, g.on ? g.pitch : 0, pad && pad.pitch);
  ctrl.yaw = sum(kb.yaw, ms.yaw, t.yaw, pad && pad.yaw);
  ctrl.roll = sum(kb.roll, t.roll, g.on ? g.roll : 0, pad && pad.roll);
  const kbThr = kb.throttle || ms.throttle || pad?.throttle || 0;
  ctrl.throttle = kbThr;
  // slider drags win while held; F/R (keyboard) otherwise set the target
  ctrl.throttleSet = t.throttleSet != null ? t.throttleSet : (kb.throttleSet ?? null);
  ctrl.fire = !!(kb.fire || ms.fire || t.fire || (pad && pad.fire));
  ctrl.injectors = !!(kb.injectors || t.injectors || (pad && pad.injectors));
  if (pad && pad.target) ctrl.targetNext = true;
  if (pad && pad.jump) ctrl.jump = true;
  if (pad && pad.dock) ctrl.dockRequest = true;
  if (pad && pad.missile) ctrl.launchMissile = true;
  if (t.targetNext) ctrl.targetNext = true;
  if (t.dock) ctrl.dockRequest = true;
  if (t.launchMissile) ctrl.launchMissile = true;
  if (t.ecm) ctrl.ecm = true;
  return ctrl;
}
