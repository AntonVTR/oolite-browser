// Input aggregation: keyboard + mouse + gamepad + touch controls + gyro.
// Every source writes its own slot; ctrl.update() combines them once per frame.
//
// Sign conventions (match the ported Oolite flight model):
//   pitch   +1 = nose up (climb),   -1 = nose down
//   yaw     +1 = yaw left,          -1 = yaw right
//   roll    +1 = roll right,        -1 = roll left
//   throttle axis: +1 speed up, -1 slow down; throttleSet: absolute 0..1 target

export const ctrl = {
  pitch: 0, yaw: 0, roll: 0, throttle: 0, throttleSet: null,
  fire: false, injectors: false,
  targetNext: false, dockRequest: false, pause: false, jump: false,
  gyroOn: false,
  onGyroKey: null, // keyboard G → toggleGyro() installed by touch.js
  sources: { kb: {}, mouse: {}, touch: {}, gyro: {}, pad: {} },
};

const keys = new Set();

export function setupKeyboard(target = window) {
  const kb = ctrl.sources.kb;
  target.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Tab') { ctrl.targetNext = true; e.preventDefault(); }
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

// Standard gamepad (Chrome "standard mapping"):
//   left stick  = pitch / yaw        right stick = roll / throttle
//   D-pad       = roll / throttle    A or RT = fire   X / LT / RB = injectors
//   B or LB     = next target        Y = jump         Back = dock request
export function setupGamepad() {
  const pad = ctrl.sources.pad;
  let jumpWasDown = false;
  pad.poll = () => {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(Boolean);
    if (!gp) { jumpWasDown = false; return null; }
    const ax = (i) => (typeof gp.axes[i] === 'number' ? gp.axes[i] : 0);
    const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const jumpDown = btn(3);
    const jump = jumpDown && !jumpWasDown; // one jump per press
    jumpWasDown = jumpDown;
    let roll = dz(ax(2));
    if (btn(14)) roll = -1; else if (btn(15)) roll = 1;
    let throttle = dz(-ax(3));
    if (btn(12)) throttle = 1; else if (btn(13)) throttle = -1;
    return {
      pitch: dz(-ax(1)),
      yaw: dz(-ax(0)),
      roll, throttle,
      fire: btn(7) || btn(0),
      injectors: btn(6) || btn(5) || btn(2),
      target: btn(4) || btn(1),
      jump,
      dock: btn(8),
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
  if (t.targetNext) ctrl.targetNext = true;
  if (t.dock) ctrl.dockRequest = true;
  return ctrl;
}
