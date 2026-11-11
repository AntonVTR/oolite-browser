// HUD: a 2D canvas overlay drawn from the real Resources/Config/hud.plist and
// crosshairs.plist, using Oolite's HUD coordinate system (HeadUpDisplay.m):
// origin at screen centre, y up, half-height = 240 HUD units (see
// MyOpenGLView.m updateGLSize:), so scale = min(w/640, h/480).

const RED = [1, 0, 0];
const YELLOW = [1, 1, 0];
const GREEN = [0, 1, 0];
const DARKGREEN = [0, 0.75, 0];
const BLUE = [0, 0, 1];
const WHITE = [1, 1, 1];

export class Hud {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hud = assets.plists.hud;
    this.crosshairs = assets.plists.crosshairs;
    this.alpha = typeof this.hud.overall_alpha === 'number' ? this.hud.overall_alpha : 1;
    this.s = 1; // HUD units → css px
    this.cx = 0;
    this.cy = 0;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.fontPx = 12;
    this.selectors = {
      'drawScanner:': (i) => this.drawScanner(i),
      'drawSpeedBar:': (i) => this.drawSpeedBar(i),
      'drawRollBar:': (i) => this.drawIndicatorBar(i, (g) => g.dialRoll, 'roll'),
      'drawPitchBar:': (i) => this.drawIndicatorBar(i, (g) => g.dialPitch, 'pitch'),
      'drawEnergyGauge:': (i) => this.drawEnergyGauge(i),
      'drawForwardShieldBar:': (i) => this.drawShieldBar(i, 'fwd'),
      'drawAftShieldBar:': (i) => this.drawShieldBar(i, 'aft'),
      'drawFuelBar:': (i) => this.drawFuelBar(i),
      'drawCabinTempBar:': (i) => this.drawTempBar(i, 'cabin'),
      'drawWeaponTempBar:': (i) => this.drawTempBar(i, 'weapon'),
      'drawAltitudeBar:': (i) => this.drawAltitudeBar(i),
      'drawSurround:': (i) => this.drawSurround(i, YELLOW),
      'drawCompass:': (i) => this.drawCompass(i),
      'drawScannerZoomIndicator:': (i) => this.drawScannerZoomIndicator(i),
      'drawMissileDisplay:': (i) => this.drawMissileDisplay(i),
      'drawStatusLight:': (i) => this.drawStatusLight(i),
      'drawClock:': (i) => this.drawClock(i),
      'drawTargetReticle:': () => {}, // drawn separately, always visible
      'drawFPSInfoCounter:': (i) => this.drawFPS(i),
      'drawAegis:': () => {},
      'drawStickSensitivityIndicator:': () => {},
      'drawScoopStatus:': () => {},
      'drawPrimedEquipment:': () => {},
      'drawWaypoints:': () => {},
      'drawASCTarget:': () => {},
      'drawWeaponsOfflineText:': () => {},
      'drawDirectionCue:': () => {},
    };
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.s = Math.min(w / 640, h / 480);
    this.cx = w / 2;
    this.cy = h / 2;
    this.xoff = (w / this.s) / 2;
    this.yoff = (h / this.s) / 2;
  }

  // HUD unit → css pixel
  X(ux) { return this.cx + ux * this.s; }
  Y(uy) { return this.cy - uy * this.s; }
  L(u) { return u * this.s; }

  rgba(c, a = 1) {
    return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
  }

  setFont(sizeUnits) {
    const px = Math.max(8, this.L(sizeUnits));
    this.ctx.font = `bold ${px}px "Courier New", monospace`;
    this.ctx.textBaseline = 'middle';
  }

  // Draw one text legend (align = 1 → right-aligned, as in Oolite).
  text(str, ux, uy, sizeUnits, color, align = 0, alpha = 1) {
    const ctx = this.ctx;
    this.setFont(sizeUnits);
    ctx.fillStyle = this.rgba(color || GREEN, alpha);
    ctx.textAlign = align === 1 ? 'right' : 'left';
    ctx.fillText(str, this.X(ux), this.Y(uy));
  }

  // Resolve a dial's position/size the way HeadUpDisplay's prefetchData does.
  place(info, defX, defY, defW, defH) {
    const x = (typeof info.x === 'number' ? info.x : defX) + (info.x_origin || 0) * this.xoff;
    const y = (typeof info.y === 'number' ? info.y : defY) + (info.y_origin || 0) * this.yoff;
    const w = typeof info.width === 'number' ? info.width : defW;
    const h = typeof info.height === 'number' ? info.height : defH;
    return { x, y, w, h, a: (typeof info.alpha === 'number' ? info.alpha : 1) * this.alpha };
  }

  surround(x, y, w, h, color, a) {
    const ctx = this.ctx;
    ctx.strokeStyle = this.rgba(color, a);
    ctx.lineWidth = Math.max(1, this.L(1));
    const pad = this.L(2);
    ctx.strokeRect(
      this.X(x - w / 2) - pad,
      this.Y(y + h / 2) - pad,
      this.L(w) + pad * 2,
      this.L(h) + pad * 2
    );
  }

  bar(x, y, w, h, amount, color, a) {
    const ctx = this.ctx;
    const px = this.X(x - w / 2);
    const py = this.Y(y + h / 2);
    ctx.fillStyle = this.rgba(color, a);
    ctx.fillRect(px, py, Math.max(0, this.L(w) * Math.min(1, amount)), this.L(h));
  }

  // ---- individual dials ----------------------------------------------------
  drawSpeedBar(info) {
    const p = this.place(info, 200, -145, 80, 8);
    if (info.draw_surround !== false) this.surround(p.x, p.y, p.w, p.h, GREEN, p.a);
    const ds = this.g.dialSpeed;
    const col = ds > 0.8 ? RED : ds > 0.25 ? YELLOW : GREEN;
    this.bar(p.x, p.y, p.w, p.h, ds, col, p.a);
  }

  // Roll / pitch centre-zero indicators (hudDrawIndicatorAt).
  drawIndicatorBar(info, getter, label) {
    const p = this.place(info, 200, -160, 80, 6);
    if (info.draw_surround !== false) this.surround(p.x, p.y, p.w, p.h, GREEN, p.a);
    const amount = getter(this.g);
    const ctx = this.ctx;
    ctx.fillStyle = this.rgba(YELLOW, p.a);
    const dialOx = this.X(p.x - p.w / 2);
    const dialOy = this.Y(p.y + p.h / 2);
    const pos = this.X(p.x + amount * p.w / 2);
    const hh = this.L(p.h);
    ctx.beginPath();
    ctx.moveTo(pos, dialOy);
    ctx.lineTo(pos + this.L(2), dialOy - hh / 2);
    ctx.lineTo(pos, dialOy - hh);
    ctx.lineTo(pos - this.L(2), dialOy - hh / 2);
    ctx.closePath();
    ctx.fill();
  }

  drawEnergyGauge(info) {
    const p = this.place(info, 200, -205, 80, 48);
    const g = this.g;
    let nBars = Math.floor(g.player.maxEnergy / 64);
    if (typeof info.n_bars === 'number') nBars = info.n_bars;
    if (nBars < 1) nBars = 1;
    const energy = (g.player.energy / g.player.maxEnergy) * nBars;
    if (info.draw_surround !== false) this.surround(p.x, p.y, p.w, p.h, YELLOW, p.a);
    const bankH = p.h / nBars;
    const barH = bankH - 2;
    const ctx = this.ctx;
    const critical = g.player.energy < 64 && g.player.energy < g.player.maxEnergy * 0.8;
    const col = critical ? RED : YELLOW;
    let bankY = p.y - (nBars - 1) * (bankH / 2) - 1;
    if (info.labelled !== false && nBars <= 8) {
      this.ctx.fillStyle = this.rgba(GREEN, p.a);
      for (let i = 0; i < nBars; i++) {
        this.setFont(Math.min(18, bankH));
        this.ctx.textAlign = 'left';
        this.ctx.fillText(
          'E' + (nBars - i).toString(16).toUpperCase(),
          this.X(p.x + p.w / 2 + 3),
          this.Y(bankY)
        );
        bankY += bankH;
      }
      bankY = p.y - (nBars - 1) * (bankH / 2) - 1;
    }
    let e = energy;
    for (let i = 0; i < nBars; i++) {
      const amount = Math.max(0, Math.min(1, e));
      if (amount > 0) {
        this.bar(p.x, bankY, p.w, barH, amount, col, p.a);
      }
      e -= 1;
      bankY += bankH;
    }
  }

  drawShieldBar(info, which) {
    const defY = which === 'fwd' ? -146 : -162;
    const p = this.place(info, -200, defY, 80, 8);
    const g = this.g;
    const shield = which === 'fwd'
      ? g.player.fwdShield / g.player.maxShield
      : g.player.aftShield / g.player.maxShield;
    if (info.draw_surround !== false) this.surround(p.x, p.y, p.w, p.h, GREEN, p.a);
    const col = shield < 0.25 ? RED : shield < 0.8 ? YELLOW : GREEN;
    this.bar(p.x, p.y, p.w, p.h, shield, col, p.a);
  }

  drawFuelBar(info) {
    const p = this.place(info, -200, -179, 80, 8);
    const g = this.g;
    if (info.draw_surround) this.surround(p.x, p.y, p.w, p.h, GREEN, p.a);
    this.bar(p.x, p.y, p.w, p.h, g.player.fuel / 70, YELLOW, p.a);
  }

  drawTempBar(info, which) {
    const defY = which === 'cabin' ? -189 : -199;
    const p = this.place(info, -200, defY, 80, 8);
    const g = this.g;
    const value = which === 'cabin'
      ? (g.player.cabinTemp - 60) / (256 - 60)
      : g.player.weaponTemp / 256;
    if (info.draw_surround) this.surround(p.x, p.y, p.w, p.h, GREEN, p.a);
    const col = value > 0.85 ? RED : value > 0.5 ? YELLOW : GREEN;
    this.bar(p.x, p.y, p.w, p.h, value, col, p.a);
  }

  drawAltitudeBar(info) {
    const p = this.place(info, -200, -209, 80, 8);
    if (info.draw_surround) this.surround(p.x, p.y, p.w, p.h, GREEN, p.a);
    this.bar(p.x, p.y, p.w, p.h, this.g.altitudeFraction, GREEN, p.a);
  }

  drawSurround(info, color) {
    const p = this.place(info, -200, -194, 80, 40);
    this.surround(p.x, p.y, p.w, p.h, color, p.a);
  }

  drawMissileDisplay(info) {
    const p = this.place(info, -228, -224, 12, 12);
    const ctx = this.ctx;
    const n = this.g.player.missiles;
    ctx.strokeStyle = this.rgba(GREEN, p.a);
    ctx.fillStyle = this.rgba(GREEN, p.a);
    ctx.lineWidth = Math.max(1, this.L(1));
    for (let i = 0; i < 4; i++) {
      const ux = p.x + i * (info.spacing || 16);
      const px = this.X(ux);
      const py = this.Y(p.y);
      const w = this.L(p.w), h = this.L(p.h);
      ctx.beginPath();
      ctx.moveTo(px - w / 2, py + h / 2);
      ctx.lineTo(px, py - h / 2);
      ctx.lineTo(px + w / 2, py + h / 2);
      ctx.closePath();
      if (i < n) ctx.fill();
      else ctx.stroke();
    }
  }

  drawStatusLight(info) {
    const p = this.place(info, -108, -32, 8, 8);
    const g = this.g;
    let col = GREEN;
    if (g.alert === 'red') col = RED;
    else if (g.alert === 'yellow') col = YELLOW;
    const ctx = this.ctx;
    const r = this.L(Math.max(p.w, p.h) / 2);
    ctx.fillStyle = this.rgba(col, p.a);
    ctx.beginPath();
    ctx.arc(this.X(p.x), this.Y(p.y), r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawClock(info) {
    const p = this.place(info, -41, -18, 12, 12);
    const t = Math.floor(this.g.time);
    const hh = String(Math.floor(t / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor(t / 60) % 60).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    this.text(`${hh}:${mm}:${ss}`, p.x - this.L(10), p.y, p.h, GREEN, 1, p.a);
  }

  drawFPS(info) {
    const p = this.place(info, -300, -20, 18, 18);
    this.text(`${this.g.fps.toFixed(0)} fps`, p.x, p.y, 10, GREEN, 0, p.a);
  }

  // ---- scanner -------------------------------------------------------------
  drawScanner(info) {
    const p = this.place(info, 0, -180, 288, 64);
    const ctx = this.ctx;
    const color = Array.isArray(info.rgb_color) ? info.rgb_color : [1, 0, 0];
    const a = p.a;
    const cx = this.X(p.x);
    const cy = this.Y(p.y);
    const rw = this.L(p.w) / 2;
    const rh = this.L(p.h) / 2;

    ctx.strokeStyle = this.rgba(color, a);
    ctx.lineWidth = Math.max(1, this.L(2));
    ctx.beginPath();
    ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, this.L(1));
    ctx.beginPath();
    ctx.moveTo(cx, cy - rh); ctx.lineTo(cx, cy + rh);
    ctx.moveTo(cx - rw, cy); ctx.lineTo(cx + rw, cy);
    ctx.stroke();

    // zoom: narrower range — ladder divisions and blip spread both scale with
    // it (HeadUpDisplay.m: km_scan = 0.001 * SCANNER_MAX_RANGE / zoom)
    const z = this.g.scannerZoom || 1;
    const kmScan = 25.6 / z;
    const hdiv = (0.5 * p.h) / kmScan; // HUD units per km-scan
    const wdiv = 0.25 * p.w / kmScan;
    let w1 = wdiv;
    let ii = 1;
    if (wdiv < 4) { w1 = wdiv * 2; ii = 5; }
    ctx.beginPath();
    for (let i = ii; 2 * hdiv * i < p.h; i += ii) {
      const yy = i * hdiv;
      let ww = w1;
      if (i % 10 === 0) ww = w1 * 2;
      else if (i % 5 === 0) ww = w1 * 2.5;
      if (ww > 3.5) {
        ctx.moveTo(cx - this.L(ww), cy - this.L(yy));
        ctx.lineTo(cx + this.L(ww), cy - this.L(yy));
        ctx.moveTo(cx - this.L(ww), cy + this.L(yy));
        ctx.lineTo(cx + this.L(ww), cy + this.L(yy));
      }
    }
    ctx.stroke();

    // view-cone markers (forward view)
    const tanfov = 0.5;
    const cosfov = 1 / Math.sqrt(1 + tanfov * tanfov);
    const sinfov = tanfov * cosfov;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - rw * sinfov, cy - rh * cosfov);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + rw * sinfov, cy - rh * cosfov);
    ctx.stroke();

    // blips
    const zFactor = p.h / p.w;
    const yFactor = 1 - Math.sqrt(zFactor);
    const upscale = (1 * 1.25) / ((25600 * 2.5) / p.w);
    const rot = this.g.playerRel; // world → ship space transform
    for (const e of this.g.scannerEntities()) {
      const dx = e.pos[0] - this.g.player.pos[0];
      const dy = e.pos[1] - this.g.player.pos[1];
      const dz = e.pos[2] - this.g.player.pos[2];
      const rx = rot[0] * dx + rot[1] * dy + rot[2] * dz;
      const ry = rot[3] * dx + rot[4] * dy + rot[5] * dz;
      const rz = rot[6] * dx + rot[7] * dy + rot[8] * dz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > (25600 / z) * 1.4) continue;
      const s = upscale * z;
      const x1 = rx * s;
      const y1 = zFactor * rz * s;
      const y2 = y1 + yFactor * ry * s;
      const col = e.color || GREEN;
      const bx = cx + this.L(x1);
      const by1 = cy - this.L(y1);
      const by2 = cy - this.L(y2);
      ctx.fillStyle = this.rgba(col, a);
      // lollipop head + tail
      ctx.globalAlpha = a * 0.34;
      ctx.fillRect(bx, Math.min(by1, by2), Math.max(1, this.L(2)), Math.abs(by2 - by1));
      ctx.globalAlpha = a;
      ctx.fillRect(bx - this.L(3), by2 - this.L(3), this.L(5), this.L(3));
    }
    ctx.globalAlpha = 1;
  }

  // Tap target: the scanner ellipse in CSS px — same math as drawScanner.
  scannerHit(x, y) {
    const info = (this.hud.dials || []).find((d) => d.selector === 'drawScanner:');
    if (!info) return false;
    const p = this.place(info, 0, -180, 288, 64);
    const nx = (x - this.X(p.x)) / (this.L(p.w) / 2);
    const ny = (y - this.Y(p.y)) / (this.L(p.h) / 2);
    return nx * nx + ny * ny <= 1;
  }

  // Zoom level as "N:1", dimmed at 1× (Oolite prints the same from its atlas).
  drawScannerZoomIndicator(info) {
    const z = Math.max(1, Math.round(this.g.scannerZoom || 1));
    const p = this.place(info, 100, 36, 0, 0);
    const color = Array.isArray(info.rgb_color) ? info.rgb_color : YELLOW;
    this.text(`${z}:1`, p.x, p.y, 10, color, 0, p.a * (z === 1 ? 0.75 : 1));
  }

  // ---- compass -------------------------------------------------------------
  drawCompass(info) {
    const p = this.place(info, 132, -216, 28, 28);
    const ctx = this.ctx;
    const color = Array.isArray(info.rgb_color) ? info.rgb_color : BLUE;
    const a = p.a;
    const cx = this.X(p.x);
    const cy = this.Y(p.y);
    const r = this.L(p.w);
    ctx.strokeStyle = this.rgba(color, a);
    ctx.lineWidth = Math.max(1, this.L(2));
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = a * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.125, cy); ctx.lineTo(cx - r * 0.375, cy);
    ctx.moveTo(cx + r * 0.125, cy); ctx.lineTo(cx + r * 0.375, cy);
    ctx.moveTo(cx, cy - r * 0.125); ctx.lineTo(cx, cy - r * 0.375);
    ctx.moveTo(cx, cy + r * 0.125); ctx.lineTo(cx, cy + r * 0.375);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const target = this.g.compass;
    if (!target) return;
    const dx = target.pos[0] - this.g.player.pos[0];
    const dy = target.pos[1] - this.g.player.pos[1];
    const dz = target.pos[2] - this.g.player.pos[2];
    const rot = this.g.playerRel;
    const rz = rot[6] * dx + rot[7] * dy + rot[8] * dz;
    let rx = rot[0] * dx + rot[1] * dy + rot[2] * dz;
    let ry = rot[3] * dx + rot[4] * dy + rot[5] * dz;
    const l = Math.hypot(rx, ry) || 1;
    rx = (rx / l) * r * 0.4;
    ry = (ry / l) * r * 0.4;
    ctx.fillStyle = rz >= 0 ? this.rgba(GREEN, a) : this.rgba(RED, a);
    const dot = this.L(r * 0.2);
    ctx.beginPath();
    ctx.arc(cx + rx, cy - ry, dot, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- target reticle (screen-space, computed by the game) -----------------
  drawTargetReticle() {
    const t = this.g.target;
    if (!t || !t.onScreen) return;
    const ctx = this.ctx;
    const x = t.sx * this.w;
    const y = t.sy * this.h;
    const r = Math.max(10, Math.min(this.h * 0.4, t.rpx * this.s));
    const col = t.hostile ? RED : GREEN;
    ctx.strokeStyle = this.rgba(col, 0.9);
    ctx.lineWidth = Math.max(1, this.L(1.5));
    const arm = Math.max(4, r * 0.35);
    ctx.beginPath();
    ctx.moveTo(x - r, y - r + arm); ctx.lineTo(x - r, y - r); ctx.lineTo(x - r + arm, y - r);
    ctx.moveTo(x + r - arm, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x + r, y - r + arm);
    ctx.moveTo(x + r, y + r - arm); ctx.lineTo(x + r, y + r); ctx.lineTo(x + r - arm, y + r);
    ctx.moveTo(x - r + arm, y + r); ctx.lineTo(x - r, y + r); ctx.lineTo(x - r, y + r - arm);
    ctx.stroke();
    // range + name
    this.text(`${t.name}  ${Math.round(t.range)} m`, x + r + this.L(6), y + r, 10, col, 0, 0.9);
  }

  // ---- crosshair -----------------------------------------------------------
  drawCrosshair() {
    const g = this.g;
    if (!g.showCrosshair) return;
    const scale = this.hud.crosshair_scale || 32;
    const defs = this.crosshairs[g.weaponKey] || this.crosshairs.OTHER;
    if (!defs) return;
    const ctx = this.ctx;
    const col = g.weaponsOnline ? [0.1, 1, 0.1] : [0.4, 0.6, 0.4];
    ctx.strokeStyle = this.rgba(col, this.alpha * (g.weaponsOnline ? 1 : 0.5));
    ctx.lineWidth = Math.max(1, this.L(this.hud.crosshair_width || 1.5));
    ctx.beginPath();
    for (const seg of defs) {
      // crosshair entries are 6-tuples: (alpha1, x1, y1, alpha2, x2, y2),
      // y up in Oolite — see OOCrosshairs.m setUpDataForOnePoint:
      ctx.globalAlpha = this.alpha * (seg[0] + seg[3]) * 0.5;
      ctx.moveTo(this.X(seg[1] * scale), this.Y(seg[2] * scale));
      ctx.lineTo(this.X(seg[4] * scale), this.Y(seg[5] * scale));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- MFDs: target status (left), messages (right) ------------------------
  drawMFDs() {
    const mfd = (this.hud.multi_function_displays || [])[0];
    if (mfd) {
      const x = mfd.x + (mfd.x_origin || 0) * this.xoff;
      const y = mfd.y + (mfd.y_origin || 0) * this.yoff;
      this.drawTargetPanel(x, y, mfd.width, mfd.height);
    }
    const msg = this.hud.message_gui;
    if (msg) {
      const x = msg.x + (msg.x_origin || 0) * this.xoff;
      const y = msg.y + (msg.y_origin || 0) * this.yoff;
      this.drawMessages(x, y, msg.width, msg.height, msg.row_height || 14);
    }
  }

  drawTargetPanel(ux, uy, uw, uh) {
    const t = this.g.target;
    const x = this.X(ux - uw / 2);
    const y = this.Y(uy + uh / 2);
    const w = this.L(uw);
    const h = this.L(uh);
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,13,115,0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = this.rgba(GREEN, 0.35);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    if (!t) {
      this.text('NO TARGET', ux - uw / 2 + 6, uy + uh / 2 - 12, 11, DARKGREEN, 0, this.alpha);
      return;
    }
    const line = (s, i, color) =>
      this.text(s, ux - uw / 2 + 6, uy + uh / 2 - 12 - i * 16, 11, color || GREEN, 0, this.alpha);
    line(t.name, 0);
    line(`RANGE ${Math.round(t.range)} m`, 1);
    if (typeof t.energy === 'number') {
      line(`SHIELDS ${Math.round((t.energy / t.maxEnergy) * 100)}%`, 2,
        t.energy < t.maxEnergy * 0.3 ? YELLOW : GREEN);
    }
    if (t.weaponHot) line('LASER HOT', 3, RED);
    if (this.g.targetBounty) line(`BOUNTY ${this.g.targetBounty} CR`, 4, YELLOW);
  }

  drawMessages(ux, uy, uw, uh, rowH) {
    const msgs = this.g.messages;
    if (!msgs.length) return;
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,13,115,0.25)';
    ctx.fillRect(this.X(ux - uw / 2), this.Y(uy + uh / 2), this.L(uw), this.L(uh));
    let row = 0;
    for (const m of msgs) {
      const fade = Math.min(1, m.life * 2);
      this.text(m.text, ux - uw / 2 + 6, uy + uh / 2 - 14 - row * rowH, 11,
        m.color || YELLOW, 0, this.alpha * fade);
      row++;
    }
  }

  // ---- legends -------------------------------------------------------------
  drawLegends() {
    for (const legend of this.hud.legends || []) {
      const x = (typeof legend.x === 'number' ? legend.x : 0) + (legend.x_origin || 0) * this.xoff;
      const y = (typeof legend.y === 'number' ? legend.y : 0) + (legend.y_origin || 0) * this.yoff;
      this.text(legend.text, x, y, legend.height || 12, GREEN, legend.align || 0, this.alpha);
    }
  }

  // ---- entry point ---------------------------------------------------------
  draw(game) {
    this.g = game;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!game.hudVisible) return;

    this.drawCrosshair();
    this.drawLegends();
    for (const info of this.hud.dials || []) {
      const eq = info.equipment_required;
      if (eq && !game.hasEquipment(eq)) continue;
      const fn = this.selectors[info.selector];
      if (fn) fn(info);
    }
    this.drawTargetReticle();
    this.drawMFDs();
  }
}
