// Missions (MISSING-FEATURES.md #7) — the Galactic Navy chain, as plain data
// and plain functions. No script engine: a mission is a record in MISSIONS,
// its state is three fields on `g.mission`, and game.js calls one hook at the
// moment a mission cares about — a kill, a hyperspace jump, a docking. Each
// hook returns the text to push through game.js's pushMessage() (or null), so
// this module imports nothing and runs anywhere.
//
// The chain follows the original's Space Navy missions (upstream
// Resources/Scripts/oolite-constrictor-hunt-mission.js and
// oolite-thargoid-plans-mission.js; briefing text adapted from
// Resources/Config/missiontext.plist).

export const MISSIONS = [
  {
    id: 'conhunt',
    title: 'GALACTIC NAVY — THE STOLEN SHIP',
    kind: 'hunt',
    completeOn: 'kill',
    target: 'constrictor',
    instruction: 'Destroy the stolen Constrictor.',
    reward: 5000, // the original's reward in oolite-constrictor-hunt-mission.js
    brief:
      '---INCOMING MESSAGE\n\n' +
      'Greetings Commander,\n\n' +
      "I am Captain Curruthers of Her Imperial Majesty's Space Navy and I beg " +
      'a moment of your valuable time. We would like you to do a little job ' +
      'for us. The ship you see here is a new model, the Constrictor, ' +
      'equipped with a top secret new shield generator.\n\n' +
      "Unfortunately it's been stolen. Your mission, should you decide to " +
      'accept it, is to seek and destroy this ship.\n\n' +
      'Good Luck, Commander.\n\n' +
      '---MESSAGE ENDS',
  },
  {
    id: 'thargplans',
    requires: 'conhunt',
    kind: 'carry',
    completeOn: 'dock',
    jumps: 3,
    reward: 15000,
    brief:
      '---INCOMING MESSAGE\n\n' +
      "Attention Commander, I am Captain Fortesque of Her Imperial Majesty's " +
      'Space Navy.\n\n' +
      'We have need of your services again. I have obtained the defence ' +
      "plans for the Thargoid Hive Worlds and I need a ship to make the run. " +
      "You're elected.\n\n" +
      'The plans are unipulse coded within this transmission. Jump clear ' +
      "three times to shake any shadow, then dock and we'll take it from " +
      'there. You will be paid.\n\n' +
      'Good luck Commander.\n\n' +
      '---MESSAGE ENDS',
  },
];

export const MISSION_IDS = MISSIONS.map((m) => m.id);

const byId = (id) => MISSIONS.find((m) => m.id === id) || null;

// Fresh state: nothing running, nothing finished. The save carries exactly
// these three fields (save.js), so a save from before missions existed loads
// with this same default.
export function missionState() {
  return { active: null, jumps: 0, done: [] };
}

export function activeMission(g) {
  return g.mission && g.mission.active ? byId(g.mission.active) : null;
}

// The next briefing on offer: the first mission of the chain that is neither
// finished nor running and whose predecessor is finished. One at a time.
export function offerMission(g) {
  const st = g.mission;
  if (!st || st.active) return null;
  for (const def of MISSIONS) {
    if (st.done.includes(def.id)) continue;
    if (def.requires && !st.done.includes(def.requires)) continue;
    return def;
  }
  return null;
}

// Returns the mission if it was the one on offer, null otherwise — so a stale
// or forged id can never start a mission out of order.
export function acceptMission(g, id) {
  const offer = offerMission(g);
  if (!offer || offer.id !== id) return null;
  g.mission.active = id;
  g.mission.jumps = 0;
  return offer;
}

// --- hooks game.js calls ----------------------------------------------------

// While a hunt runs, the stolen ship is what the pirate roster puts in the
// sky — until it is destroyed. Returns the ship key to spawn, or null for the
// ordinary round-robin.
export function missionSpawnKey(g) {
  const def = activeMission(g);
  if (!def || def.completeOn !== 'kill') return null;
  if (g.entities.some((e) => e.alive && e.shipKey === def.target)) return null;
  return def.target;
}

// A carry mission counts hyperspace jumps. Text for the HUD, or null.
export function missionOnJump(g) {
  const def = activeMission(g);
  if (!def || def.completeOn !== 'dock') return null;
  if (g.mission.jumps >= def.jumps) return null; // already delivered-ready
  g.mission.jumps++;
  return g.mission.jumps >= def.jumps
    ? `CARRIED ${def.jumps}/${def.jumps} JUMPS — DOCK TO DELIVER`
    : `CARRIED ${g.mission.jumps}/${def.jumps} HYPERSPACE JUMPS`;
}

// Killing the mission's target completes a hunt. Text for the HUD, or null.
export function missionOnKill(g, ship) {
  const def = activeMission(g);
  if (!def || def.completeOn !== 'kill' || ship.shipKey !== def.target) return null;
  return completeMission(g, def);
}

// Docking delivers a carried mission (once its jumps are in). Text, or null.
export function missionOnDock(g) {
  const def = activeMission(g);
  if (!def || def.completeOn !== 'dock') return null;
  if (g.mission.jumps < def.jumps) return null;
  return completeMission(g, def);
}

function completeMission(g, def) {
  g.mission.active = null;
  g.mission.jumps = 0;
  if (!g.mission.done.includes(def.id)) g.mission.done.push(def.id);
  g.player.credits += def.reward;
  return `MISSION COMPLETE — ${def.reward} CR REWARD`;
}

// --- the docked screen ------------------------------------------------------
// What main.js renders in #dock-mission: the offer (brief + ACCEPT button) or
// the progress of the run under way, or null to hide the panel.
export function missionView(g) {
  const offer = offerMission(g);
  if (offer) return { mode: 'offer', def: offer, text: `${offer.brief}\nReward: ${offer.reward} CR` };
  const def = activeMission(g);
  if (!def) return null;
  let status;
  if (def.kind === 'hunt') {
    status = def.instruction;
  } else if (g.mission.jumps >= def.jumps) {
    status = `Thargoid intelligence carried across ${def.jumps} jumps — dock to deliver it.`;
  } else {
    status = `Carrying the Thargoid intelligence: ${g.mission.jumps}/${def.jumps} hyperspace jumps made.`;
  }
  return { mode: 'active', def, text: `IN PROGRESS\n${status}\nReward: ${def.reward} CR` };
}
