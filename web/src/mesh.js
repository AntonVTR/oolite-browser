// Parser for Oolite's plain-text .dat mesh format (see upstream/src/Core/OOMesh.m).
// Produces a non-indexed triangle soup grouped by material, ready for WebGL.

/**
 * @param {string} text raw .dat file contents
 * @param {number} scale model_scale_factor (OOMesh scaleFactor:), normally 1
 */
export function parseMesh(text, scale = 1) {
  // Preprocess exactly like OOMesh: strip // and # comments, commas → spaces.
  const words = [];
  for (const rawLine of text.split('\n')) {
    let line = rawLine;
    let p = line.indexOf('#');
    if (p >= 0) line = line.slice(0, p);
    p = line.indexOf('//');
    if (p >= 0) line = line.slice(0, p);
    line = line.replace(/,/g, ' ');
    for (const w of line.split(/\s+/)) if (w) words.push(w);
  }

  let idx = 0;
  const section = (key) => {
    const p = words.indexOf(key, idx);
    if (p < 0) throw new Error(`mesh: missing section ${key}`);
    idx = p + 1;
  };
  const findSection = (key) => words.indexOf(key, idx);

  section('NVERTS');
  const nVerts = parseInt(words[idx++], 10);
  section('NFACES');
  const nFaces = parseInt(words[idx++], 10);

  section('VERTEX');
  const verts = new Float32Array(nVerts * 3);
  for (let k = 0; k < nVerts * 3; k++) verts[k] = parseFloat(words[idx++]) * scale;

  // FACES: r g b (r = smooth group), face normal nx ny nz, n_v, then vertex indices.
  section('FACES');
  const faceNormal = new Float32Array(nFaces * 3);
  const faceVert = new Int32Array(nFaces * 3);
  for (let f = 0; f < nFaces; f++) {
    idx += 3; // colour / smooth group — unused
    faceNormal[f * 3] = parseFloat(words[idx++]);
    faceNormal[f * 3 + 1] = parseFloat(words[idx++]);
    faceNormal[f * 3 + 2] = parseFloat(words[idx++]);
    const nv = parseInt(words[idx++], 10);
    if (nv < 3) throw new Error(`mesh: face ${f} has ${nv} vertices`);
    faceVert[f * 3] = parseInt(words[idx++], 10);
    faceVert[f * 3 + 1] = parseInt(words[idx++], 10);
    faceVert[f * 3 + 2] = parseInt(words[idx++], 10);
    for (let k = 3; k < nv; k++) idx++; // quads+: only first three used (as in OOMesh)
  }

  // TEXTURES: materialKey max_x max_y then 3 (s,t) pairs. UVs stored per face.
  const uv = new Float32Array(nFaces * 6);
  let materials = ['_oo_placeholder_material'];
  const faceMat = new Int32Array(nFaces);
  const texStart = findSection('TEXTURES');
  if (texStart >= 0) {
    idx = texStart + 1;
    materials = [];
    const matIndex = new Map();
    for (let f = 0; f < nFaces; f++) {
      const key = words[idx++];
      let mi = matIndex.get(key);
      if (mi === undefined) {
        mi = materials.length;
        materials.push(key);
        matIndex.set(key, mi);
      }
      faceMat[f] = mi;
      const maxX = parseFloat(words[idx++]);
      const maxY = parseFloat(words[idx++]);
      for (let v = 0; v < 3; v++) {
        uv[f * 6 + v * 2] = parseFloat(words[idx++]) / maxX;
        uv[f * 6 + v * 2 + 1] = parseFloat(words[idx++]) / maxY;
      }
    }
  }

  // NAMES n … renames material "0" → first name, "1" → second, etc.
  const namesStart = findSection('NAMES');
  if (namesStart >= 0) {
    idx = namesStart + 1;
    const count = parseInt(words[idx++], 10);
    for (let j = 0; j < count && j < materials.length; j++) {
      if (materials[j] === String(j)) materials[j] = words[idx++];
      else idx++; // keep in sync even if the key doesn't match an index
    }
  }

  // NORMALS: explicit per-vertex normals (optional).
  let vertNormals = null;
  const normStart = findSection('NORMALS');
  if (normStart >= 0) {
    idx = normStart + 1;
    vertNormals = new Float32Array(nVerts * 3);
    for (let k = 0; k < nVerts * 3; k++) vertNormals[k] = parseFloat(words[idx++]);
    for (let v = 0; v < nVerts; v++) {
      const x = vertNormals[v * 3], y = vertNormals[v * 3 + 1], z = vertNormals[v * 3 + 2];
      const len = Math.hypot(x, y, z) || 1;
      vertNormals[v * 3] = x / len;
      vertNormals[v * 3 + 1] = y / len;
      vertNormals[v * 3 + 2] = z / len;
    }
  }

  // Bucket faces per material.
  const counts = new Int32Array(materials.length);
  for (let f = 0; f < nFaces; f++) counts[faceMat[f]]++;
  const groups = [];
  const groupByMat = new Array(materials.length).fill(null);
  for (let m = 0; m < materials.length; m++) {
    if (!counts[m]) continue;
    const g = {
      material: m,
      positions: new Float32Array(counts[m] * 9),
      normals: new Float32Array(counts[m] * 9),
      uvs: new Float32Array(counts[m] * 6),
      count: counts[m] * 3,
    };
    groups.push(g);
    groupByMat[m] = g;
  }
  const cursor = new Int32Array(materials.length);

  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;

  for (let f = 0; f < nFaces; f++) {
    const g = groupByMat[faceMat[f]];
    if (!g) continue;
    const tri = cursor[faceMat[f]]++;
    const pBase = tri * 9;
    const uvBase = tri * 6;

    // Face normal from file, or computed from winding when the file has 0 0 0.
    let nx = faceNormal[f * 3], ny = faceNormal[f * 3 + 1], nz = faceNormal[f * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len === 0) {
      const a = faceVert[f * 3] * 3, b = faceVert[f * 3 + 1] * 3, c = faceVert[f * 3 + 2] * 3;
      const ux = verts[b] - verts[a], uy = verts[b + 1] - verts[a + 1], uz = verts[b + 2] - verts[a + 2];
      const vx = verts[c] - verts[a], vy = verts[c + 1] - verts[a + 1], vz = verts[c + 2] - verts[a + 2];
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const l2 = Math.hypot(nx, ny, nz) || 1;
      nx /= l2; ny /= l2; nz /= l2;
    } else {
      nx /= len; ny /= len; nz /= len;
    }

    for (let v = 0; v < 3; v++) {
      const vi = faceVert[f * 3 + v] * 3;
      const px = verts[vi], py = verts[vi + 1], pz = verts[vi + 2];
      g.positions[pBase + v * 3] = px;
      g.positions[pBase + v * 3 + 1] = py;
      g.positions[pBase + v * 3 + 2] = pz;
      if (vertNormals) {
        g.normals[pBase + v * 3] = vertNormals[vi];
        g.normals[pBase + v * 3 + 1] = vertNormals[vi + 1];
        g.normals[pBase + v * 3 + 2] = vertNormals[vi + 2];
      } else {
        g.normals[pBase + v * 3] = nx;
        g.normals[pBase + v * 3 + 1] = ny;
        g.normals[pBase + v * 3 + 2] = nz;
      }
      g.uvs[uvBase + v * 2] = uv[f * 6 + v * 2];
      g.uvs[uvBase + v * 2 + 1] = uv[f * 6 + v * 2 + 1];
      if (px < minx) minx = px; if (px > maxx) maxx = px;
      if (py < miny) miny = py; if (py > maxy) maxy = py;
      if (pz < minz) minz = pz; if (pz > maxz) maxz = pz;
    }
  }

  const center = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];
  let radius = 0;
  for (let v = 0; v < nVerts; v++) {
    const d = Math.hypot(
      verts[v * 3] - center[0],
      verts[v * 3 + 1] - center[1],
      verts[v * 3 + 2] - center[2]
    );
    if (d > radius) radius = d;
  }

  return {
    materials,
    groups,
    vertices: verts,
    bbox: { min: [minx, miny, minz], max: [maxx, maxy, maxz], center, radius },
  };
}
