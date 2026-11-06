// WebGL renderer for the port. WebGL1 only (works on every iPad/Android browser),
// plain shaders, no dependencies.

import {
  mat4, mat4Mul, mat4Perspective, mat4FromQuatPos, mat4FromQuatPosScale, mat4InvertRigid,
} from './math.js';

const MESH_VS = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec2 aUV;
uniform mat4 uProj;
uniform mat4 uMV;
varying vec3 vN;
varying vec2 vUV;
void main() {
  vN = mat3(uMV[0].xyz, uMV[1].xyz, uMV[2].xyz) * aNor;
  vUV = aUV;
  gl_Position = uProj * uMV * vec4(aPos, 1.0);
}`;

const MESH_FS = `
precision mediump float;
uniform vec3 uSunDir;      // view space, points from surface towards sun
uniform vec3 uAmbient;
uniform vec3 uSunCol;
uniform vec4 uTint;
uniform sampler2D uTex;
uniform float uUseTex;
uniform float uEmissive;
varying vec3 vN;
varying vec2 vUV;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec4 base = uTint;
  if (uUseTex > 0.5) base *= texture2D(uTex, vUV);
  float d = max(dot(n, uSunDir), 0.0);
  vec3 col = base.rgb * (uAmbient + uSunCol * d) + base.rgb * uEmissive;
  gl_FragColor = vec4(col, base.a);
}`;

const POINTS_VS = `
attribute vec3 aPos;
attribute vec3 aCol;
attribute float aSize;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uScale;
varying vec3 vCol;
void main() {
  vCol = aCol;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
  gl_PointSize = aSize * uScale;
}`;

const POINTS_FS = `
precision mediump float;
varying vec3 vCol;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(vCol, uAlpha);
}`;

const SPRITE_VS = `
attribute vec2 aCorner;
uniform mat4 uProj;
uniform vec3 uCenter;   // view space
uniform vec2 uSize;     // view-space half extents
varying vec2 vUV;
void main() {
  vUV = aCorner * 0.5 + 0.5;
  gl_Position = uProj * vec4(uCenter.xy + aCorner * uSize, uCenter.z, 1.0);
}`;

const SPRITE_FS = `
precision mediump float;
uniform sampler2D uTex;
uniform vec4 uColor;
varying vec2 vUV;
void main() {
  vec4 t = texture2D(uTex, vUV);
  gl_FragColor = vec4(t.rgb * uColor.rgb, t.a * uColor.a);
}`;

const BEAM_VS = `
attribute vec3 aPos;
attribute vec2 aUV;
uniform mat4 uProj;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = uProj * vec4(aPos, 1.0);
}`;

const BEAM_FS = `
precision mediump float;
uniform vec4 uColor;
varying vec2 vUV;
void main() {
  float edge = 1.0 - abs(vUV.y * 2.0 - 1.0);
  gl_FragColor = vec4(uColor.rgb, uColor.a * edge * edge);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh) + '\n' + src);
  }
  return sh;
}

function program(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  const uniforms = {};
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < nu; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  const attributes = {};
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < na; i++) {
    const info = gl.getActiveAttrib(p, i);
    attributes[info.name] = gl.getAttribLocation(p, info.name);
  }
  return { prog: p, u: uniforms, a: attributes };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {
      antialias: true, alpha: false, depth: true, powerPreference: 'high-performance',
    }) || canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL not available');
    this.gl = gl;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.meshProg = program(gl, MESH_VS, MESH_FS);
    this.pointsProg = program(gl, POINTS_VS, POINTS_FS);
    this.spriteProg = program(gl, SPRITE_VS, SPRITE_FS);
    this.beamProg = program(gl, BEAM_VS, BEAM_FS);

    this.proj = mat4();
    this.view = mat4();
    this.model = mat4();
    this.mv = mat4();

    // static quad corners for billboards
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this.beamBuf = gl.createBuffer();
    this.beamVerts = new Float32Array(16); // 4 verts * (3 pos + 2 uv)

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE); // Oolite meshes are not consistently wound; skipping culling
                              // is safe at these triangle counts.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 1);
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.gl.viewport(0, 0, cw, ch);
    // Oolite's frustum: (-0.5, 0.5, -aspect*0.5, aspect*0.5, 1.0, far)
    mat4Perspective(this.proj, 2 * Math.atan(0.5), w / h, 1.0, 1.5e6);
  }

  // ---- textures ------------------------------------------------------------
  makeTexture(source) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    const w = source.width || 1, h = source.height || 1;
    const pot = (w & (w - 1)) === 0 && (h & (h - 1)) === 0;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, pot ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (pot) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return tex;
  }

  // Upload a parsed mesh (from mesh.js) as GPU buffers.
  uploadMesh(parsed) {
    const gl = this.gl;
    const groups = parsed.groups.map((g) => {
      const pb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, pb);
      gl.bufferData(gl.ARRAY_BUFFER, g.positions, gl.STATIC_DRAW);
      const nb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, nb);
      gl.bufferData(gl.ARRAY_BUFFER, g.normals, gl.STATIC_DRAW);
      const ub = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, ub);
      gl.bufferData(gl.ARRAY_BUFFER, g.uvs, gl.STATIC_DRAW);
      return { material: g.material, pos: pb, nor: nb, uv: ub, count: g.count };
    });
    return { groups, materials: parsed.materials, bbox: parsed.bbox };
  }

  // Unit sphere as a single-material mesh (planets, suns).
  uploadSphere() {
    const s = sphereSoup();
    const gl = this.gl;
    const mk = (data) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    };
    return {
      groups: [{ material: 0, pos: mk(s.positions), nor: mk(s.normals), uv: mk(s.uvs), count: s.count }],
      materials: ['sphere'],
      bbox: null,
    };
  }

  // Build an RGBA buffer of arbitrary world-space points (stars / dust).
  makePoints(positions, colors, sizes) {
    const gl = this.gl;
    const n = positions.length / 3;
    const data = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) {
      data[i * 7] = positions[i * 3];
      data[i * 7 + 1] = positions[i * 3 + 1];
      data[i * 7 + 2] = positions[i * 3 + 2];
      data[i * 7 + 3] = colors[i * 3];
      data[i * 7 + 4] = colors[i * 3 + 1];
      data[i * 7 + 5] = colors[i * 3 + 2];
      data[i * 7 + 6] = sizes[i];
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return { buf, count: n };
  }

  // ---- frame ---------------------------------------------------------------
  beginFrame(camPos, camQuat) {
    const gl = this.gl;
    const cam = mat4();
    mat4FromQuatPos(cam, camQuat, camPos);
    mat4InvertRigid(this.view, cam);
    this.camQuat = camQuat;
    this.camPos = camPos;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  // World-space direction to the sun, expressed in view space.
  sunDirView(sunPos) {
    const dx = sunPos[0] - this.camPos[0];
    const dy = sunPos[1] - this.camPos[1];
    const dz = sunPos[2] - this.camPos[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    // rotate by inverse camera orientation: conjugate of camQuat
    const q = this.camQuat;
    const cq = [-q[0], -q[1], -q[2], q[3]];
    const [x, y, z] = [dx / l, dy / l, dz / l];
    const tx = 2 * (cq[1] * z - cq[2] * y);
    const ty = 2 * (cq[2] * x - cq[0] * z);
    const tz = 2 * (cq[0] * y - cq[1] * x);
    return [
      x + cq[3] * tx + (cq[1] * tz - cq[2] * ty),
      y + cq[3] * ty + (cq[2] * tx - cq[0] * tz),
      z + cq[3] * tz + (cq[0] * ty - cq[1] * tx),
    ];
  }

  drawPoints(points, view, alpha) {
    const gl = this.gl;
    const p = this.pointsProg;
    gl.useProgram(p.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, points.buf);
    const stride = 28;
    gl.enableVertexAttribArray(p.a.aPos);
    gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(p.a.aCol);
    gl.vertexAttribPointer(p.a.aCol, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(p.a.aSize);
    gl.vertexAttribPointer(p.a.aSize, 1, gl.FLOAT, false, stride, 24);
    gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(p.u.uView, false, view);
    gl.uniform1f(p.u.uScale, this.dpr);
    gl.uniform1f(p.u.uAlpha, alpha);
    gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, points.count);
    gl.depthMask(true);
  }

  drawStars(stars) {
    // Stars rotate with the camera but never translate (infinite distance).
    const rot = mat4();
    mat4FromQuatPos(rot, this.camQuat, [0, 0, 0]);
    const view = mat4();
    mat4InvertRigid(view, rot);
    this.drawPoints(stars, view, 1.0);
  }

  drawMesh(gpu, model, opts = {}) {
    const gl = this.gl;
    const p = this.meshProg;
    gl.useProgram(p.prog);
    mat4Mul(this.mv, this.view, model);
    gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(p.u.uMV, false, this.mv);
    const sd = opts.sunDir || [0, 0, 1];
    gl.uniform3f(p.u.uSunDir, sd[0], sd[1], sd[2]);
    const amb = opts.ambient || [0.3, 0.3, 0.34];
    const sc = opts.sunCol || [0.85, 0.85, 0.8];
    gl.uniform3f(p.u.uAmbient, amb[0], amb[1], amb[2]);
    gl.uniform3f(p.u.uSunCol, sc[0], sc[1], sc[2]);
    gl.uniform1f(p.u.uEmissive, opts.emissive || 0);
    const tint = opts.tint || [1, 1, 1, 1];
    gl.uniform4f(p.u.uTint, tint[0], tint[1], tint[2], tint.length > 3 ? tint[3] : 1);
    gl.uniform1i(p.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    for (const g of gpu.groups) {
      const tex = opts.textures && opts.textures[g.material];
      gl.bindTexture(gl.TEXTURE_2D, tex || null);
      gl.uniform1f(p.u.uUseTex, tex ? 1 : 0);
      if (!tex) {
        const c = opts.fallbackColor || [0.6, 0.6, 0.6, 1];
        gl.uniform4f(p.u.uTint, c[0], c[1], c[2], c.length > 3 ? c[3] : 1);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, g.pos);
      gl.enableVertexAttribArray(p.a.aPos);
      gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.nor);
      gl.enableVertexAttribArray(p.a.aNor);
      gl.vertexAttribPointer(p.a.aNor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.uv);
      gl.enableVertexAttribArray(p.a.aUV);
      gl.vertexAttribPointer(p.a.aUV, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, g.count);
    }
  }

  // A world-space quad facing the camera (explosions, glows, exhaust plumes).
  drawBillboard(pos, halfW, halfH, tex, color) {
    const gl = this.gl;
    const p = this.spriteProg;
    // view-space centre
    const v = this.view;
    const cx = v[0] * pos[0] + v[4] * pos[1] + v[8] * pos[2] + v[12];
    const cy = v[1] * pos[0] + v[5] * pos[1] + v[9] * pos[2] + v[13];
    const cz = v[2] * pos[0] + v[6] * pos[1] + v[10] * pos[2] + v[14];
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
    gl.uniform3f(p.u.uCenter, cx, cy, cz);
    gl.uniform2f(p.u.uSize, halfW, halfH);
    gl.uniform4f(p.u.uColor, color[0], color[1], color[2], color[3]);
    gl.uniform1i(p.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(p.a.aCorner);
    gl.vertexAttribPointer(p.a.aCorner, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  // Beam between two world-space points (laser fire).
  drawBeam(a, b, width, color) {
    const gl = this.gl;
    const v = this.view;
    const toView = (p) => [
      v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12],
      v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13],
      v[2] * p[0] + v[6] * p[1] + v[10] * p[2] + v[14],
    ];
    const av = toView(a), bv = toView(b);
    const dx = bv[0] - av[0], dy = bv[1] - av[1], dz = bv[2] - av[2];
    const dl = Math.hypot(dx, dy, dz) || 1;
    const dir = [dx / dl, dy / dl, dz / dl];
    // perpendicular in the view plane (camera looks down -Z at origin)
    const mx = (av[0] + bv[0]) / 2, my = (av[1] + bv[1]) / 2, mz = (av[2] + bv[2]) / 2;
    const ml = Math.hypot(mx, my, mz) || 1;
    const toCam = [-mx / ml, -my / ml, -mz / ml];
    let px = dir[1] * toCam[2] - dir[2] * toCam[1];
    let py = dir[2] * toCam[0] - dir[0] * toCam[2];
    let pz = dir[0] * toCam[1] - dir[1] * toCam[0];
    const pl = Math.hypot(px, py, pz) || 1;
    px = (px / pl) * width; py = (py / pl) * width; pz = (pz / pl) * width;

    const d = this.beamVerts;
    const put = (i, p, u, vv) => {
      d[i * 5] = p[0]; d[i * 5 + 1] = p[1]; d[i * 5 + 2] = p[2];
      d[i * 5 + 3] = u; d[i * 5 + 4] = vv;
    };
    put(0, [av[0] - px, av[1] - py, av[2] - pz], 0, 0);
    put(1, [av[0] + px, av[1] + py, av[2] + pz], 0, 1);
    put(2, [bv[0] - px, bv[1] - py, bv[2] - pz], 1, 0);
    put(3, [bv[0] + px, bv[1] + py, bv[2] + pz], 1, 1);

    const p = this.beamProg;
    gl.useProgram(p.prog);
    gl.uniformMatrix4fv(p.u.uProj, false, this.proj);
    gl.uniform4f(p.u.uColor, color[0], color[1], color[2], color[3]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf);
    gl.bufferData(gl.ARRAY_BUFFER, d, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(p.a.aPos);
    gl.vertexAttribPointer(p.a.aPos, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(p.a.aUV);
    gl.vertexAttribPointer(p.a.aUV, 2, gl.FLOAT, false, 20, 12);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.depthMask(true);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
}

// ---- procedural geometry ---------------------------------------------------
// Unit sphere as a non-indexed triangle soup so it can go through drawMesh().
function sphereSoup(latBands = 40, lonBands = 64) {
  const pos = [], nor = [], uv = [];
  const vert = (la, lo) => {
    const theta = (la * Math.PI) / latBands;
    const phi = (lo * 2 * Math.PI) / lonBands;
    const x = Math.sin(theta) * Math.sin(phi);
    const y = Math.cos(theta);
    const z = Math.sin(theta) * Math.cos(phi);
    pos.push(x, y, z);
    nor.push(x, y, z);
    uv.push(lo / lonBands, 1 - la / latBands);
  };
  for (let la = 0; la < latBands; la++) {
    for (let lo = 0; lo < lonBands; lo++) {
      vert(la, lo); vert(la + 1, lo); vert(la, lo + 1);
      vert(la + 1, lo); vert(la + 1, lo + 1); vert(la, lo + 1);
    }
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nor),
    uvs: new Float32Array(uv),
    count: pos.length / 3,
  };
}
