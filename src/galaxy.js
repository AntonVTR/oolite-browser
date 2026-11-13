// Galaxy / system generation — a port of Oolite's seed-based generator.
//
// API: makeGalaxy(galaxyNumber = 1) -> { systems }  (256 systems)
//      systemAt(galaxy, index)        -> one system (index wraps at 256, as upstream)
//      distanceLy(a, b)               -> distance in light years (jump limit is 7)
// Each system: { index, name, government, economy, productivity, population,
//                radius, description, techLevel, x, y }  (x/y = chart coordinates)
//
// Upstream sources this ports (read-only, see ../upstream):
//   src/Core/legacy_random.c   rotate_seed(), gen_rnd_number(), seed_RNG_only_for_planet_description()
//   src/Core/legacy_random.h   distanceBetweenPlanetPositions()
//   src/Core/OOStringExpander.m  OOGenerateSystemDescription() — the description text
//   src/Core/Universe.m @ tag 1.80  -setGalaxySeed:andReinit:, -generateSystemData:, -generateSystemName:
//   src/Core/PlayerEntity.m @ tag 1.80  rotate_byte_left() — galactic hyperspace
//   Resources/Config/descriptions.plist  digrams + system_description tables (embedded below)
// Verified against Resources/Config/planetinfo.plist for all 8 x 256 systems:
// names, government, economy, tech level, population, productivity, radius and
// coordinates reproduce upstream exactly (see tests/test-galaxy.mjs).
//
// Pure functions, no DOM and no I/O — runs in the browser and in node.

// descriptions.plist: pairs of letters used to build system names. The index
// maths below needs at least 88 characters ((31 + 12) * 2 + 1 = 87 is the last
// index read); the table is exactly that long.
const DIGRAMS = 'ABOUSEITILETSTONLONUTHNOALLEXEGEZACEBISOUSESARMAINDIREA’ERATENBERALAVETIEDORQUANTEISRION';
const DIGRAM_APOSTROPHE = '’';
const DESCRIPTION_STRING = '[14] is [22].';

// descriptions.plist string keys reachable from system_description (%I path).
const STRING_KEYS = {
  'planetname-possessive': '%H[planetname-derivative-suffix]', // %I expands to this
  'planetname-derivative-suffix': 'ian',
};

// descriptions.plist "system_description": 36 groups of five alternatives.
// "\177" (plist octal escape) is the delete character: it eats the character
// that follows it once expanded.
const SYSTEM_DESCRIPTION = [
  ['fabled', 'notable', 'well known', 'famous', 'noted'],
  ['very', 'mildly', 'most', 'reasonably', '\x7F'],
  ['ancient', '[20]', 'great', 'vast', 'pink'],
  ['[29] [28] plantations', 'mountains', '[27]', '[19] forests', 'oceans'],
  ['shyness', 'silliness', 'mating traditions', 'loathing of [5]', 'love for [5]'],
  ['food blenders', 'tourists', 'poetry', 'discos', '[13]'],
  ['talking tree', 'crab', 'bat', 'lobst', '%R'],
  ['beset', 'plagued', 'ravaged', 'cursed', 'scourged'],
  ['[21] civil war', '[26] [23] [24]s', '[26] disease', '[21] earthquakes', '[21] solar activity'],
  ['its [2] [3]', 'the %I [23] [24]', 'its inhabitants’ [25] [4]', '[32]', 'its [12] [13]'],
  ['juice', 'brandy', 'water', 'brew', 'gargle blasters'],
  ['%R', '%I [24]', '%I %R', '%I [26]', '[26] %R'],
  ['fabulous', 'exotic', 'hoopy', 'unusual', 'exciting'],
  ['cuisine', 'night life', 'casinos', 'sit coms', '[32]'],
  ['%H', 'The planet %H', 'The world %H', 'This planet', 'This world'],
  ['n unremarkable', ' boring', ' dull', ' tedious', ' revolting'],
  ['planet', 'world', 'place', 'little planet', 'dump'],
  ['wasp', 'moth', 'grub', 'ant', '%R'],
  ['poet', 'arts graduate', 'yak', 'snail', 'slug'],
  ['tropical', 'dense', 'rain', 'impenetrable', 'exuberant'],
  ['funny', 'weird', 'unusual', 'strange', 'peculiar'],
  ['frequent', 'occasional', 'unpredictable', 'dreadful', 'deadly'],
  ['[1] [0] for [9]', '[1] [0] for [9] and [9]', '[7] by [8]', '[1] [0] for [9] but [7] by [8]', 'a[15] [16]'],
  ['[26]', 'mountain', 'edible', 'tree', 'spotted'],
  ['[30]', '[31]', '[6]oid', '[18]', '[17]'],
  ['ancient', 'exceptional', 'eccentric', 'ingrained', '[20]'],
  ['killer', 'deadly', 'evil', 'lethal', 'vicious'],
  ['parking meters', 'dust clouds', 'ice bergs', 'rock formations', 'volcanoes'],
  ['plant', 'tulip', 'banana', 'corn', '%Rweed'],
  ['%R', '%I %R', '%I [26]', 'inhabitant', '%I %R'],
  ['shrew', 'beast', 'bison', 'snake', 'wolf'],
  ['leopard', 'cat', 'monkey', 'goat', 'fish'],
  ['[11] [10]', '%I [30] [33]', 'its [12] [31] [33]', '[34] [35]', '[11] [10]'],
  ['meat', 'cutlet', 'steak', 'burgers', 'soup'],
  ['ice', 'mud', 'Zero-G', 'vacuum', '%I ultra'],
  ['hockey', 'cricket', 'karate', 'polo', 'tennis'],
];

// Galaxy 1's seed (the "galaxy_seed" of a vanilla save). Galactic hyperspace
// rotates every byte left one bit to reach the next galaxy (8 in total).
const MASTER_SEED = [74, 90, 72, 2, 83, 183];

// ---------------------------------------------------------------------------
// legacy_random.c
// ---------------------------------------------------------------------------

// rotate_seed(): each byte of the seed moves along and the last two are
// recomputed; e/f are stored in 8-bit fields, hence the masks.
function rotateSeed(s) {
  const x = (s.a + s.c + s.e) & 0xFFFF;
  const y = (s.b + s.d + s.f) & 0xFFFF;
  return {
    a: s.c, b: s.d, c: s.e, d: s.f,
    e: x & 0xFF,
    f: (y + (x >> 8)) & 0xFF,
  };
}

function rol8(v) {
  return ((v << 1) | (v >> 7)) & 0xFF;
}

function galaxySeed(galaxyIndex0) {
  const b = MASTER_SEED.map(v => {
    for (let i = 0; i < galaxyIndex0; i++) v = rol8(v);
    return v;
  });
  return { a: b[0], b: b[1], c: b[2], d: b[3], e: b[4], f: b[5] };
}

// gen_rnd_number(): the classic Elite RNG, state lives in r.
function genRndNumber(r) {
  const x = (r.a * 2) & 0xFF;
  let a = x + r.c;
  if (r.a > 127) a++;
  r.a = a & 0xFF;
  r.c = x;
  a = a >> 8; // carry out of a = x + c (+1)
  const b = r.b;
  a = (a + b + r.d) & 0xFF;
  r.b = a;
  r.d = b;
  return a;
}

// ---------------------------------------------------------------------------
// -generateSystemName: (Universe.m @ 1.80)
// ---------------------------------------------------------------------------

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

function generateName(seed) {
  let s = seed;
  let name = '';
  const pairs = (s.a & 0x40) === 0 ? 3 : 4;
  for (let i = 0; i < pairs; i++) {
    const x = s.f & 0x1F;
    if (x !== 0) {
      const p = (x + 12) * 2;
      name += DIGRAMS[p];
      if (DIGRAMS[p + 1] !== DIGRAM_APOSTROPHE) name += DIGRAMS[p + 1];
    }
    s = rotateSeed(s);
  }
  return capitalize(name);
}

// ---------------------------------------------------------------------------
// -generateSystemData: (Universe.m @ 1.80)
// ---------------------------------------------------------------------------

function systemData(seed) {
  const government = (seed.c >> 3) & 7;
  let economy = seed.b & 7;
  if (government < 2) economy |= 2;
  const techLevel = (economy ^ 7) + (seed.d & 3) + (government >> 1) + (government & 1);
  const population = techLevel * 4 + government + economy + 1;
  const productivity = ((economy ^ 7) + 3) * (government + 4) * population * 8;
  const radius = ((seed.f & 15) + 11) * 256 + seed.d;
  return { government, economy, techLevel, population, productivity, radius };
}

// ---------------------------------------------------------------------------
// OOGenerateSystemDescription() (OOStringExpander.m): expand "[14] is [22]."
// against system_description with the RNG seeded from the system's seed.
// ---------------------------------------------------------------------------

const isDigit = c => c >= '0' && c <= '9';

function expandStringKey(key, ctx) {
  const value = STRING_KEYS[key];
  return value === undefined ? null : expand(value, ctx);
}

function expandDigitKey(key, ctx) {
  const entry = SYSTEM_DESCRIPTION[Number(key)];
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const rnd = genRndNumber(ctx.rnd);
  // Five-way groups use Elite's classic thresholds, everything else the
  // plain (rnd * count) / 256 split — exactly as ExpandDigitKey does.
  const selection = entry.length === 5
    ? (rnd >= 0xCC ? 4 : rnd >= 0x99 ? 3 : rnd >= 0x66 ? 2 : rnd >= 0x33 ? 1 : 0)
    : Math.floor((rnd * entry.length) / 256);
  return expand(entry[selection], ctx);
}

function expandKey(str, idx, ctx) {
  const size = str.length;
  let end = idx + 1;
  let balance = 1;
  let allDigits = true;
  for (; end < size && balance > 0; end++) {
    const c = str[end];
    if (c === ']') balance--;
    else if (c === '[') { balance++; allDigits = false; }
    else if (!isDigit(c)) allDigits = false;
  }
  if (balance !== 0) return null; // unbalanced: upstream warns and keeps the text
  const length = end - idx;
  const key = str.slice(idx + 1, end - 1);
  if (key.length === 0) return null;
  // shortcut: keys with '|' operators ([population|multiply:0.1]) are not
  //           expanded; system_description never uses them.
  const text = allDigits ? expandDigitKey(key, ctx) : expandStringKey(key, ctx);
  return text === null ? null : { text, length };
}

function expandPercent(str, idx, ctx) {
  const selector = str[idx + 1];
  if (selector === 'H') return { text: ctx.name, length: 2 };
  if (selector === 'I') {
    const text = expandStringKey('planetname-possessive', ctx);
    return text === null ? null : { text, length: 2 };
  }
  if (selector === 'R') {
    ctx.hasPercentR = true;
    return { text: '%R', length: 2 }; // replaced in a second pass, once for all
  }
  if (selector === '%') return { text: '%', length: 2 };
  if (selector === '[') return { text: '[', length: 2 };
  if (selector === ']') return { text: ']', length: 2 };
  // shortcut: %N/%G/%J (random name / galaxy escapes) are unused by
  //           system_description and stay literal.
  return null;
}

function expand(str, ctx) {
  const size = str.length;
  if (size === 0 || ctx.depth >= 100) return str;
  let out = null;
  let copyStart = 0;
  ctx.depth++;
  try {
    for (let idx = 0; idx < size - 1; idx++) {
      let rep = null;
      let repLen = 0;
      const c = str[idx];
      if (c === '[') {
        const r = expandKey(str, idx, ctx);
        if (r) { rep = r.text; repLen = r.length; }
      } else if (c === '%') {
        const r = expandPercent(str, idx, ctx);
        if (r) { rep = r.text; repLen = r.length; }
      } else {
        continue; // ']' and ordinary characters need no work
      }
      if (rep !== null) {
        if (rep === '\x7F' && repLen < size) { repLen++; rep = ''; } // delete-char eats the next one
        if (copyStart === 0 && repLen === size) return rep;
        if (out === null) out = '';
        out += str.slice(copyStart, idx) + rep;
        idx += repLen - 1;
        copyStart = idx + 1;
      }
    }
  } finally {
    ctx.depth--;
  }
  if (out !== null) return out + str.slice(copyStart);
  return str;
}

// OldRandomDigrams(): one random name for every %R in the string.
function oldRandomDigrams(ctx) {
  const len = genRndNumber(ctx.rnd) & 3;
  let name = '';
  for (let i = 0; i <= len; i++) {
    const x = genRndNumber(ctx.rnd) & 0x3E;
    name += DIGRAMS.slice(x, x + 2);
  }
  return capitalize(name);
}

function generateDescription(seed, name) {
  // seed_RNG_only_for_planet_description(): state = seed bytes c, d, e, f.
  const ctx = {
    name,
    rnd: { a: seed.c, b: seed.d, c: seed.e, d: seed.f },
    depth: 0,
    hasPercentR: false,
  };
  let out = expand(DESCRIPTION_STRING, ctx);
  if (ctx.hasPercentR) {
    const r = oldRandomDigrams(ctx);
    out = out.split('%R').join(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Galaxy numbers are 1-based (makeGalaxy(1) is the galaxy Lave is in);
// wrapping at 8 matches upstream's galaxy_number &= 7.
export function makeGalaxy(galaxyNumber = 1) {
  let seed = galaxySeed((galaxyNumber - 1) & 7);
  const systems = [];
  for (let index = 0; index < 256; index++) {
    const name = generateName(seed);
    const data = systemData(seed);
    systems.push({
      index,
      // Oolite's data spells names "Lave"; the port shows them upper case
      // (chart style, as the previous SYSTEMS fixture did). Descriptions keep
      // Oolite's own text, so they use the original casing.
      name: name.toUpperCase(),
      government: data.government,
      economy: data.economy,
      productivity: data.productivity,
      population: data.population,
      radius: data.radius,
      description: generateDescription(seed, name),
      techLevel: data.techLevel,
      x: seed.d, // chart coordinates, upstream: (seed.d, seed.b)
      y: seed.b,
    });
    // Every system's seed is the previous one rotated four times.
    seed = rotateSeed(rotateSeed(rotateSeed(rotateSeed(seed))));
  }
  return { systems };
}

// Upstream -systemSeedForSystemNumber: masks the index at 0xFF.
export function systemAt(galaxy, index) {
  return galaxy.systems[index & 0xFF];
}

// distanceBetweenPlanetPositions() from legacy_random.h: light years, where
// the vertical coordinate counts half. Jumps are limited to MAX_JUMP_RANGE
// (7 ly); since distances are multiples of 0.4 the furthest reachable hop is
// 6.8 ly.
export function distanceLy(a, b) {
  const dx = a.x - b.x;
  const dy = Math.trunc((a.y - b.y) / 2);
  return 0.4 * Math.trunc(Math.sqrt(dx * dx + dy * dy));
}
