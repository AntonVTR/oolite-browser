// Missile lock states (MISSING-FEATURES #18): lock progress on your own
// target, dumbfire without a lock, break-lock, the incoming missile's own
// lock, and the indicator that reads all of it out.
// Run: node tests/test-missiles.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parsePlist } = await import(join(root, 'web/src/plist.js'));
const { createGame, stepGame, launch, launchMissileAt, launchMissile } =
  await import(join(root, 'web/src/game.js'));
const { Hud } = await import(join(root, 'web/src/hud.js'));

const read = (p) => readFileSync(join(root, 'web/assets', p), 'utf8');
const shipdata = parsePlist(read('config/shipdata.plist'));
const shipyard = parsePlist(read('config/shipyard.plist'));
const equipment = parsePlist(read('config/equipment.plist'));
const tradeGoods = parsePlist(read('config/trade-goods.plist'));
// no meshes: radiusOf() falls back to 60 m, which is plenty for a missile
const assets = { plists: { shipyard, shipdata, equipment, 'trade-goods': tradeGoods },
  parsedMeshes: {} };

const newGame = () => {
  const g = createGame(assets);
  g.rand = () => 1;
  launch(g);
  g.entities = g.entities.filter((e) => e.type === 'station');
  g.spawnTimer = 1e9;
  return g;
};
const run = (g, n, input = {}) => {
  for (let i = 0; i < n; i++) stepGame(g, input, 1 / 60);
};
const noInput = () => ({});
const ahead = (g, m) => [g.player.pos[0], g.player.pos[1], g.player.pos[2] + m];
const makeShip = (g, pos, over = {}) => ({
  type: 'ship', shipKey: 'python', name: 'Python Trader', role: 'trader',
  pos, quat: [0, 0, 0, 1], vel: [0, 0, 0], radius: 60,
  speed: 0, maxSpeed: 200, thrust: 20, pitchRate: 0.8, rollRate: 2, yawRate: 0.2,
  energy: 450, maxEnergy: 450, bounty: 0, hostile: false, fireCooldown: 0, think: 1e9,
  strafePhase: 0, alive: true, color: [0, 1, 0],
  ...over,
});

// ---- the lock builds on the target in front of you -------------------------
const g = newGame();
const quarry = makeShip(g, ahead(g, 1800));
g.entities.push(quarry);
g.target = quarry;
assert.strictEqual(g.lockProgress, 0, 'a fresh target starts unlocked');
run(g, 150); // 2.5 s > the 1.5 s lock time
assert.strictEqual(g.lockProgress, 1, 'holding it in the forward arc locks on');
assert.ok(g.messages.some((m) => m.text === 'MISSILE LOCKED'), 'and the HUD says so');

// ---- break-lock: off the arc, or onto another target -----------------------
quarry.pos = ahead(g, -2000); // behind the nose now
run(g, 2);
assert.strictEqual(g.lockProgress, 0, 'leaving the arc breaks the lock');
assert.ok(g.messages.some((m) => m.text === 'MISSILE LOCK BROKEN'), 'and says so too');

quarry.pos = ahead(g, 1800);
run(g, 150);
assert.strictEqual(g.lockProgress, 1, 'back on the nose it locks again');
const other = makeShip(g, ahead(g, 2200));
g.entities.push(other);
g.target = other;
run(g, 1);
assert.strictEqual(g.lockProgress, 0, 'switching targets breaks the lock');
assert.ok(g.messages.filter((m) => m.text === 'MISSILE LOCK BROKEN').length >= 2,
  'each break is reported');
run(g, 150);
assert.strictEqual(g.lockProgress, 1, 'the new target locks too');

// ---- a locked launch tracks, an unlocked one goes dumb ---------------------
const lockedG = newGame();
// one blastPower 180 warhead away from wrecked, as in test-game
const target = makeShip(lockedG, ahead(lockedG, 1800), { energy: 150 });
lockedG.entities.push(target);
lockedG.target = target;
run(lockedG, 150);
assert.strictEqual(lockedG.lockProgress, 1);
assert.ok(launchMissile(lockedG), 'the locked missile launches');
assert.strictEqual(lockedG.missiles[0].homing, true, 'and it homing');
assert.strictEqual(lockedG.missiles[0].target, target, 'on the locked target');
assert.strictEqual(lockedG.lockProgress, 0, 'the next missile must lock again');
run(lockedG, 300);
assert.strictEqual(target.alive, false, 'the locked missile tracks and hits');
assert.strictEqual(lockedG.kills, 1, 'the kill counts');

const dumbG = newGame();
// the intended target sits off to one side: a dumbfire cannot reach it
const offside = makeShip(dumbG, [dumbG.player.pos[0] + 1500, dumbG.player.pos[1],
  dumbG.player.pos[2] + 1800], { energy: 150 });
dumbG.entities.push(offside);
dumbG.target = offside;
assert.strictEqual(dumbG.lockProgress, 0, 'no time to lock yet');
assert.ok(launchMissile(dumbG), 'a missile still launches without a lock');
assert.strictEqual(dumbG.missiles[0].homing, false, 'but it goes out dumb');
assert.strictEqual(dumbG.missiles[0].target, null, 'with nothing to steer on');
assert.ok(dumbG.messages.some((m) => m.text.includes('NO LOCK (DUMBFIRE)')), 'and says so');
run(dumbG, 300);
assert.ok(offside.alive, 'the dumbfire flies straight past the target it cannot see');
assert.strictEqual(dumbG.missiles.length, 1, 'and is still on its way out');

// straight and blind still kills what is dead ahead
const straightG = newGame();
const deadAhead = makeShip(straightG, ahead(straightG, 1800), { energy: 150 });
straightG.entities.push(deadAhead);
straightG.target = deadAhead;
launchMissile(straightG);
run(straightG, 300);
assert.strictEqual(deadAhead.alive, false, 'a dumbfire kills what it runs into');
assert.strictEqual(straightG.kills, 1, 'and that kill counts too');

// ---- the incoming missile has its own lock ---------------------------------
// It locks while you sit still; turning out of its cone while it is still
// locking leaves it blind. Once it has you it holds — the ECM is the answer
// then (see tests/test-game.mjs for the sweep).
const blindG = newGame();
blindG.player.throttle = 0;
blindG.player.speed = 0; // sit still: the seeker can hold you
const shooter = makeShip(blindG, [blindG.player.pos[0] + 3000, blindG.player.pos[1],
  blindG.player.pos[2]], { hostile: true, role: 'pirate' });
launchMissileAt(blindG, shooter, blindG.player, true);
assert.strictEqual(blindG.missiles[0].lock, 0, 'an incoming missile starts blind');
assert.ok(blindG.messages.some((m) => m.text === 'INCOMING MISSILE'), 'and is announced');
run(blindG, 60); // 1 s of steady aim — not enough to lock
assert.ok(blindG.missiles[0].lock > 0 && blindG.missiles[0].lock < 1,
  'it is locking on in flight');
blindG.player.pos = [blindG.player.pos[0], blindG.player.pos[1] + 6000,
  blindG.player.pos[2]]; // climb out of its 60° seeker cone (still in range)
run(blindG, 2);
assert.strictEqual(blindG.missiles[0].lock, 0, 'turning out of the cone breaks the lock');
assert.ok(blindG.missiles[0].life > 0, 'the blind missile flies on');

const holdG = newGame();
holdG.player.throttle = 0;
holdG.player.speed = 0;
const shooter2 = makeShip(holdG, [holdG.player.pos[0] + 3000, holdG.player.pos[1],
  holdG.player.pos[2]], { hostile: true, role: 'pirate' });
launchMissileAt(holdG, shooter2, holdG.player, true);
run(holdG, 150); // 2.5 s of steady aim, well before it arrives
assert.ok(holdG.missiles.length === 1, 'still on its way in');
assert.strictEqual(holdG.missiles[0].lock, 1, 'it locks on while you sit still');
holdG.player.pos = [holdG.player.pos[0], holdG.player.pos[1] + 6000,
  holdG.player.pos[2]]; // too late: it already has you
run(holdG, 2);
assert.strictEqual(holdG.missiles[0].lock, 1, 'once locked it holds');

// ---- the indicator reads the states out ------------------------------------
const log = [];
const ctx = new Proxy({}, {
  get: (t, k) => (typeof k === 'symbol' ? undefined : (...args) => { log.push([k, ...args]); }),
  set: () => true,
});
const hud = new Hud({ width: 0, height: 0, getContext: () => ctx },
  { plists: { hud: parsePlist(read('config/hud.plist')), crosshairs: {} } });
hud.resize(1280, 800, 1);
const info = { x: -228, y: -224, spacing: 16 };
const states = () => log.filter((e) => e[0] === 'fillText').map((e) => e[1]);

hud.g = newGame();
log.length = 0;
hud.drawMissileDisplay(info);
assert.ok(states().includes('UNARMED'), 'no target reads UNARMED');

hud.g = g; // the game locked at the top of this file
log.length = 0;
hud.drawMissileDisplay(info);
assert.ok(states().includes('MISSILE LOCKED'), 'a finished lock reads MISSILE LOCKED');

hud.g = blindG; // still locking onto the commander
log.length = 0;
hud.drawMissileDisplay(info);
assert.ok(states().includes('INCOMING — LOCKING'), 'a half-made inbound lock reads INCOMING — LOCKING');

hud.g = holdG; // one locked onto the commander
log.length = 0;
hud.drawMissileDisplay(info);
assert.ok(states().includes('INCOMING — LOCKED'), 'a finished inbound lock reads INCOMING — LOCKED');

// half-built lock reads its progress
const partial = newGame();
const partialTarget = makeShip(partial, ahead(partial, 1800));
partial.entities.push(partialTarget);
partial.target = partialTarget;
run(partial, 60);
assert.ok(partial.lockProgress > 0 && partial.lockProgress < 1, 'a lock on the way in');
hud.g = partial;
log.length = 0;
hud.drawMissileDisplay(info);
assert.ok(states().some((s) => /^LOCK \d+%$/.test(s)), `progress reads out (${states()})`);

console.log('missiles: all checks passed');
