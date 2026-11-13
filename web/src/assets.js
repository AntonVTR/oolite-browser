// Asset loading: plists, meshes, textures, sounds. Everything is fetched from
// web/assets and parsed with the port's own parsers.

import { parsePlist } from './plist.js';
import { parseMesh } from './mesh.js';

// Which real Oolite ships the port ships (key = shipdata template key).
export const SHIP_DEFS = {
  cobra3: { shipKey: 'oolite_template_cobra3', model: 'oolite_cobra3' },
  mamba: { shipKey: 'oolite_template_mamba', model: 'oolite_mamba' },
  krait: { shipKey: 'oolite_template_krait', model: 'oolite_krait' },
  python: { shipKey: 'oolite_template_python', model: 'oolite_python' },
  cobramk1: { shipKey: 'oolite_template_cobramk1', model: 'oolite_cobramk1' },
  asp: { shipKey: 'oolite_template_asp', model: 'oolite_asp' },
  // heavy haulers — spawned as peaceful NPC traders
  anaconda: { shipKey: 'oolite_template_anaconda', model: 'oolite_anaconda' },
  boa: { shipKey: 'oolite_template_boa', model: 'oolite_boa' },
  'boa-mk2': { shipKey: 'oolite_template_boa-mk2', model: 'oolite_boa-mk2' },
  adder: { shipKey: 'oolite_template_adder', model: 'oolite_adder' },
  // fighters — spawned as hostile pirates
  gecko: { shipKey: 'oolite_template_gecko', model: 'oolite_gecko' },
  viper: { shipKey: 'oolite_template_viper', model: 'oolite_viper' },
  constrictor: { shipKey: 'oolite_template_constrictor', model: 'oolite_constrictor' },
  // the hostile alien, with its real warship mesh and hull texture
  thargoid: { shipKey: 'oolite_template_thargoid', model: 'oolite_thargoid' },
  coriolis: {
    shipKey: 'oolite_template_coriolis-station',
    model: 'oolite_coriolis',
    subentities: ['oolite_coriolis_faceplate', 'oolite_coriolis_tris', 'oolite_coriolis_dock'],
  },
};

export const SOUND_FILES = [
  'laser', 'laserhits', 'hit', 'hullbang', 'bigbang', 'beep', 'boop',
  'guiclick', 'afterburner1', 'warning', 'missile', 'buy', 'sell',
];

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  return r.text();
}

async function fetchImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${url}`));
    img.src = url;
  });
}

// Resolve the PNG for one mesh material name using a shipdata entry's materials dict.
export function resolveTextureName(matName, entry, modelBase) {
  const mats = entry && entry.materials;
  if (mats && mats[matName]) {
    const dm = mats[matName].diffuse_map;
    if (typeof dm === 'string') return dm;
    if (dm && typeof dm === 'object' && dm.name) return dm.name;
  }
  if (/\.png$/i.test(matName)) return matName;
  if (modelBase) return `${modelBase}_diffuse.png`;
  return null;
}

/**
 * Load everything. onProgress(done, total, label) is called as work completes.
 * @returns {Promise<object>} assets bag
 */
export async function loadAssets(onProgress = () => {}) {
  const A = { plists: {}, meshes: {}, textures: {}, sounds: {}, parsedMeshes: {} };
  let done = 0;
  let total = 0;
  const tick = (label) => { done++; onProgress(done, total, label); };

  // config plists
  const plistNames = ['shipdata', 'hud', 'crosshairs', 'planetinfo', 'equipment', 'shipyard'];
  total += plistNames.length;
  for (const name of plistNames) {
    A.plists[name] = parsePlist(await fetchText(`assets/config/${name}.plist`));
    tick(`config/${name}`);
  }

  // models (main hull + station subentities)
  total += Object.keys(SHIP_DEFS).length;
  for (const [key, def] of Object.entries(SHIP_DEFS)) {
    A.parsedMeshes[key] = parseMesh(await fetchText(`assets/models/${def.model}.dat`));
    for (const sub of def.subentities || []) {
      A.parsedMeshes[sub] = parseMesh(await fetchText(`assets/models/${sub}.dat`));
    }
    tick(`model/${def.model}`);
  }

  // textures: every material used by every mesh, resolved through shipdata
  const texJobs = new Map(); // png name -> url
  const addJob = (png) => { if (png) texJobs.set(png, `assets/textures/${png}`); };
  for (const [key, def] of Object.entries(SHIP_DEFS)) {
    const entry = A.plists.shipdata[def.shipKey];
    const meshesToScan = [[key, def.model], ...(def.subentities || []).map((s) => [s, s])];
    for (const [meshId, modelName] of meshesToScan) {
      const parsed = A.parsedMeshes[meshId];
      if (!parsed) continue;
      const subEntry = A.plists.shipdata[modelName] || entry;
      for (const mat of parsed.materials) {
        addJob(resolveTextureName(mat, subEntry, modelName));
      }
    }
  }
  total += texJobs.size;
  for (const [png, url] of texJobs) {
    A.textures[png] = await fetchImage(url);
    tick(`texture/${png}`);
  }

  // sounds
  total += SOUND_FILES.length;
  for (const s of SOUND_FILES) {
    try {
      const r = await fetch(`assets/sounds/${s}.ogg`);
      if (r.ok) A.sounds[s] = await r.arrayBuffer();
    } catch (e) { /* sound is optional */ }
    tick(`sound/${s}`);
  }

  onProgress(done, total, 'ready');
  return A;
}
