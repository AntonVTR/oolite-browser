// The auto-dock music (#21): the waltz phrase is pure data, so node checks
// the table — every note inside the six bars, sane pitches and volumes, and
// a phrase length that matches the bars it is scheduled against.
// Run: node tests/test-audio.mjs
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { WALTZ_BARS, WALTZ_MELODY, WALTZ_LEN } = await import(join(root, 'web/src/audio.js'));

assert.strictEqual(WALTZ_BARS.length, 6, 'six bars of waltz');
assert.ok(Math.abs(WALTZ_LEN - 18 * (60 / 160)) < 1e-9, 'six bars at 160 bpm, 3/4');

const midiOk = (m) => Number.isFinite(m) && m >= 40 && m <= 96;
for (const [i, bar] of WALTZ_BARS.entries()) {
  assert.ok(midiOk(bar.bass), `bar ${i + 1} has a bass in range`);
  assert.strictEqual(bar.chord.length, 3, `bar ${i + 1} is a triad`);
  for (const m of bar.chord) assert.ok(midiOk(m), `bar ${i + 1} chord in range`);
}

let lastBeat = 0;
for (const [beat, midi, len, vol] of WALTZ_MELODY) {
  assert.ok(beat >= 0 && beat + len <= 18, `note at beat ${beat} stays inside the phrase`);
  assert.ok(beat >= lastBeat, 'the melody is written in time order');
  lastBeat = beat;
  assert.ok(midiOk(midi), 'melody pitch in range');
  assert.ok(vol > 0 && vol <= 1, 'melody volume is a sane gain');
}
assert.ok(WALTZ_MELODY.some(([, , len]) => len >= 3), 'the phrase ends on a held note');

console.log('audio: all checks passed');
