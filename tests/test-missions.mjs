// Mission checks (MISSING-FEATURES #7): the Navy chain offer order, accepting
// a mission, progress across hyperspace jumps, the reward on completion, and
// the save round trip (including saves from before missions existed).
// Run: node tests/test-missions.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { createGame, launch, stepGame, jump, dock, spawnPirate, SYSTEMS } =
  await import(join(root, 'web/src/game.js'));
const {
  MISSIONS, missionState, offerMission, acceptMission, activeMission,
  missionSpawnKey, missionOnJump, missionOnKill, missionOnDock, missionView,
} = await import(join(root, 'web/src/missions.js'));
const { serializeSave, parseSave, applySave, SAVE_VERSION } =
  await import(join(root, 'web/src/save.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const shipdata = parsePlist(read('config/shipdata.plist'));
const shipyard = parsePlist(read('config/shipyard.plist'));
const tradeGoods = parsePlist(read('config/trade-goods.plist'));
// no meshes: radiusOf() falls back to 60 m, which is all the mission logic needs
const assets = { plists: { shipyard, shipdata, 'trade-goods': tradeGoods }, parsedMeshes: {} };
const newGame = () => {
  const g = createGame(assets);
  g.rand = () => 1; // pin the jump rolls: no mis-jump may fire by chance (#10)
  return g;
};

// ---- chain order and accepting ---------------------------------------------
const g = newGame();
assert.deepStrictEqual(g.mission, missionState(), 'a fresh game starts with no mission');
const first = offerMission(g);
assert.strictEqual(first.id, 'conhunt', 'the hunt is the first briefing on offer');
assert.strictEqual(acceptMission(g, 'thargplans'), null, 'the second mission cannot be taken first');
assert.strictEqual(activeMission(g), null, 'and nothing started');
assert.ok(acceptMission(g, first.id), 'accepting the offered mission');
assert.strictEqual(g.mission.active, 'conhunt', 'it is now running');
assert.strictEqual(offerMission(g), null, 'no second briefing while one runs');
assert.strictEqual(acceptMission(g, first.id), null, 'a running mission cannot be accepted again');
assert.strictEqual(missionView(g).mode, 'active', 'the docked screen shows the run, not the offer');
assert.ok(missionView(g).text.includes('Constrictor'), 'with its instruction');

// ---- the hunt puts the stolen ship in the sky ------------------------------
assert.strictEqual(missionSpawnKey(g), 'constrictor', 'the pirate roster spawns the target');
const quarry = spawnPirate(g);
assert.strictEqual(quarry.shipKey, 'constrictor', 'spawnPirate delivers the stolen ship');
assert.strictEqual(missionSpawnKey(g), null, 'not while one is already alive');
launch(g); // the hunt is fought in flight, not on the title screen
quarry.pos = [g.player.pos[0], g.player.pos[1], g.player.pos[2] + 1800];
quarry.quat = [0, 0, 0, 1];
quarry.energy = 60; // one beam away from wrecked
g.entities = g.entities.filter((e) => e === quarry || e.type === 'station');
g.spawnTimer = 1e9; // no fresh contacts mid-check: the laser must find the quarry

// ---- reward on completion (the kill) ---------------------------------------
const credits0 = g.player.credits;
const kills0 = g.kills;
for (let i = 0; i < 60 && g.kills === kills0; i++) stepGame(g, { fire: true }, 1 / 60);
assert.strictEqual(g.kills, kills0 + 1, 'laser destroys the Constrictor');
assert.ok(g.mission.done.includes('conhunt'), 'the kill completes the hunt');
assert.strictEqual(g.mission.active, null, 'and nothing is running any more');
assert.strictEqual(g.player.credits, credits0 + quarry.bounty + MISSIONS[0].reward,
  'the reward is paid on top of the bounty');
assert.ok(g.messages.some((m) => m.text === `MISSION COMPLETE — ${MISSIONS[0].reward} CR REWARD`),
  'and the HUD is told');
assert.strictEqual(offerMission(g).id, 'thargplans', 'the next briefing opens after the first');

// ---- progress across hyperspace jumps --------------------------------------
const g2 = newGame();
g2.mission.done = ['conhunt']; // as if the hunt were already won
assert.ok(acceptMission(g2, 'thargplans'), 'the carry mission accepts');
g2.player.fuel = 70;
launch(g2);
const jumps = MISSIONS[1].jumps;
for (let n = 1; n <= jumps; n++) {
  g2.player.fuel = 70;
  assert.ok(jump(g2), `jump ${n} succeeds`);
  assert.strictEqual(g2.mission.jumps, n, `progress recorded on jump ${n}`);
  const expect = n < jumps
    ? `CARRIED ${n}/${jumps} HYPERSPACE JUMPS`
    : `CARRIED ${jumps}/${jumps} JUMPS — DOCK TO DELIVER`;
  assert.strictEqual(g2.messages[0].text, expect, `the HUD tracks jump ${n}`);

  if (n === 1) {
    // docking between jumps must not deliver the run
    dock(g2);
    assert.strictEqual(g2.mission.active, 'thargplans', 'the run survives an early dock');
    assert.ok(!g2.mission.done.includes('thargplans'), 'nothing completed by docking early');
    launch(g2); // back into space for the rest of the run
  }
}
assert.strictEqual(g2.mission.active, 'thargplans', 'jumps alone do not finish the run');

const credits1 = g2.player.credits;
dock(g2); // the jumps are all in — this dock delivers
assert.ok(g2.mission.done.includes('thargplans'), 'docking delivers the intelligence');
assert.strictEqual(g2.mission.active, null);
assert.strictEqual(g2.player.credits, credits1 + MISSIONS[1].reward, 'reward paid on delivery');
assert.ok(g2.messages.some((m) => m.text === `MISSION COMPLETE — ${MISSIONS[1].reward} CR REWARD`),
  'and reported');
assert.strictEqual(offerMission(g2), null, 'the chain is finished');

// ---- hooks stay quiet with no mission running ------------------------------
const idle = newGame();
assert.strictEqual(missionSpawnKey(idle), null);
assert.strictEqual(missionOnJump(idle), null);
assert.strictEqual(missionOnDock(idle), null);
assert.strictEqual(missionOnKill(idle, { shipKey: 'constrictor' }), null);
assert.strictEqual(missionView(idle).mode, 'offer', 'an idle game shows the first briefing');
assert.strictEqual(offerMission(idle).id, 'conhunt', 'and it is the hunt');
// only a finished chain hides the panel (g2 completed both missions above)
assert.strictEqual(missionView(g2), null, 'the docked screen hides the panel when done');
idle.mission.active = 'conhunt';
assert.strictEqual(missionOnJump(idle), null, 'a hunt does not count jumps');

// ---- save round trip --------------------------------------------------------
const s = newGame();
s.phase = 'docked';
s.mission.active = 'thargplans';
s.mission.jumps = 2;
s.mission.done = ['conhunt'];
const back = newGame();
assert.strictEqual(applySave(back, parseSave(serializeSave(s))), true, 'save applies');
assert.deepStrictEqual(back.mission, { active: 'thargplans', jumps: 2, done: ['conhunt'] },
  'mission state survives the round trip');
assert.strictEqual(parseSave(serializeSave(s)).v, SAVE_VERSION);

// a save from before missions existed still loads, with a clean slate
const legacy = JSON.parse(serializeSave(s));
delete legacy.mission;
assert.deepStrictEqual(parseSave(JSON.stringify(legacy)).mission, missionState(),
  'old saves load without a mission');
const legacyBack = newGame();
legacyBack.mission = { active: 'conhunt', jumps: 1, done: ['thargplans'] };
assert.strictEqual(applySave(legacyBack, parseSave(JSON.stringify(legacy))), true);
assert.deepStrictEqual(legacyBack.mission, missionState(), 'and replace the stale one');

// corrupt mission state refuses the whole save
const base = JSON.parse(serializeSave(s));
const bad = [
  JSON.stringify({ ...base, mission: null }),
  JSON.stringify({ ...base, mission: 'conhunt' }),
  JSON.stringify({ ...base, mission: { ...base.mission, active: 'bogus' } }),
  JSON.stringify({ ...base, mission: { ...base.mission, active: 42 } }),
  JSON.stringify({ ...base, mission: { ...base.mission, jumps: -1 } }),
  JSON.stringify({ ...base, mission: { ...base.mission, jumps: 'two' } }),
  JSON.stringify({ ...base, mission: { ...base.mission, done: 'conhunt' } }),
  JSON.stringify({ ...base, mission: { ...base.mission, done: ['nope'] } }),
];
for (const text of bad) {
  assert.strictEqual(parseSave(text), null, `rejects ${text.slice(-70)}`);
}
// duplicate completions collapse rather than fail
const dupe = JSON.stringify({ ...base, mission: { active: null, jumps: 0, done: ['conhunt', 'conhunt'] } });
assert.deepStrictEqual(parseSave(dupe).mission.done, ['conhunt']);

console.log('missions: all checks passed');
