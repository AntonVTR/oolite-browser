# Missing features vs. the original *Elite*

What the original 1984 *Elite* has that this port does not, ranked by how much
each gap hurts the "this is Elite" feeling.

Sources studied:

- https://www.elite-games.ru/elite/zxbegin.shtml — ZX Spectrum beginner's guide
  (status screen, controls, instruments, docking, hyperspace, galactic jump)
- https://en.wikipedia.org/wiki/Elite_(video_game) — gameplay, development,
  versions, mission and equipment overview

Checked against the port on 2026-11-13 (`web/src`, `README.md`). File references
are to this repo. Items 1–3 were closed on 2026-11-14 (branch `iter/status`) and
item 4 the same day (branch `iter/market`); item 5 closed on 2026-11-15 (branch
`iter/equipment`, which also closed the sun half of item 11); item 6 closed the
same day (branch `iter/docking`); item 7 closed 2026-11-15 (branch
`iter/missions`); their sections
below keep the original description for the record. Items 8–10 closed
2026-11-15 (branch `iter/travel`), likewise with their original descriptions
kept below.

**Ranking:** P1 = core identity of the game, P2 = universe & travel depth,
P3 = flight/combat depth, P4 = fidelity polish.

---

## P1 — core game systems

### 1. Combat rating ladder (Harmless → Elite)
The game is literally named after this rank. Original: kills are reported to
the Galactic Federal Centre and advance you Harmless → Mostly Harmless → Poor
→ Average → Above Average → Competent → Dangerous → Deadly → Elite
(both sources). Port: a bare `kills` counter (`web/src/game.js` `g.kills`,
shown on the death and dock screens). No rank, no progression, no display on
the status screen.

**Done** (branch `iter/status`): `rankName()` in `web/src/game.js` maps kills
through Oolite's thresholds (8 → 6400); the rank shows on the docked screen,
the death screen, the save slots and the status screen (#3).

### 2. Legal status and police
Original: status runs Clear → Offender → Fugitive; crimes (killing traders or
police, selling illegal goods) make Vipers hunt you, and firing inside a
station's protection zone brings reprisal (ZX guide). Port: no legal state at
all — `damageShip()` credits the player for *any* kill with no penalty
(`web/src/game.js`), and **Vipers spawn as hostile pirates**
(`PIRATE_KEYS` in `web/src/game.js`) instead of being the police. This also
gates illegal commodities (see #4).

**Done** (branch `iter/status`): `legalStatus()` / `addCrime()` and
`spawnPolice()` in `web/src/game.js` — firing on innocents in the protection
zone and killing traders or police raise the record (Clear → Offender →
Fugitive), Vipers patrol and turn on a wanted commander, docking forgives the
record (shortcut), and `crime` travels in the save. Illegal commodities stay
gated by #4.

### 3. Status screen with all fields (and one in flight)
Original status page: commander name, Present system, Hyperspace system, Fuel,
Cash, **Legal status**, **Rating** (ZX guide). Port: the docked screen shows
credits / fuel / cargo / kills / system description only
(`buildMarketScreen()` in `web/src/main.js`), and there is **no status screen
while flying** — you must dock to see your situation. "Hyperspace system"
(nav target) is not tracked either: the chart jumps immediately.

**Done** (branch `iter/status`): in-flight status overlay (`web/src/status.js`,
`5` / STATUS) with present system, fuel, cash, legal status and rating, and
the docked screen shows legal status too. Commander name (#19) and the
hyperspace nav target are still missing — the chart jumps immediately, so
there is no selection to persist.

### 4. Full commodity market (17 goods + legality)
Original/Oolite: 17 commodities from `trade-goods.plist` (food, textiles,
radioactives, slaves, luxuries, narcotics, computers, machinery, alloys,
firearms, furs, minerals, gold, platinum, …) with per-system price and
quantity formulas and export/import legality. Port: 6 hardcoded goods with
invented prices (`GOODS` in `web/src/game.js`); `trade-goods.plist` is not
even copied into `web/assets/config/`. No slaves/narcotics → no illegal-trade
hook for #2.

**Done** (branch `iter/market`): `trade-goods.plist` now ships in
`web/assets/config/` and `goodsFrom()` (`web/src/game.js`) turns its 17
entries into the market — display names from `descriptions.plist`, units from
`quantity_unit`, order from `sort_order`. `generateMarket()` follows
`OOCommodities.m`: `economicBiasForGood()` distances the system from each
good's `peak_export`/`peak_import` economies, the price (decicredits → credits)
and the quantity come from the plist averages with the source's two-draw random
term, so every system has its own numbers and trades move the stock (127-unit
market limit). Contraband is tagged in the market and selling it calls
`addCrime()` (#2): one point per tonne, two for narcotics. The docked screen
keeps all 17 rows and the BUY/SELL pair on one line down to 320 px.

### 5. Equipment range (9 of ~41 items)
Original upgrades: better lasers, more missiles, cargo bay, **docking
computer**, **fuel scoops**, extra energy bank, shield boosters, fuel
injection, **escape pod**, **galactic drive**, cloak, passenger berth (both
sources; full list in `web/assets/config/equipment.plist`).

**Done** (branch `iter/equipment`): `EQUIPMENT_KEYS` in `web/src/game.js`
sells nine items at their real `equipment.plist` prices, in the plist's own
tech-level order — Large Cargo Bay 4 000, Missile 300, E.C.M. 6 000, Fuel
Scoops 5 250, Escape Pod 10 000, Extra Energy Unit 15 000, Docking Computer
15 000, Witchdrive Fuel Injectors 6 000, Shield Boosters 147 500.
`applyEquipmentStats()` applies the three stat items from the same numbers
Oolite uses (`extra_cargo` +15 t, `oolite_shield_increase` +128,
`oolite_energy_recharge_multiplier` ×1.8) and re-derives them after a hull
swap, so the gear follows the commander to a new ship. Missiles bought past
the hull's pylon count bring their own rack — the port's answer to "more
missiles" (shortcut: Oolite hulls have a fixed pylon count and sell no extra
racks) — and `player.pylons` is saved as an optional field, so saves from
before it existed still load. A DOCK request with the docking computer
fitted is an autopilot from any range (`g.autoDock` in `stepGame()`): it
turns onto the station and closes on a distance-based throttle that is under
the 120 m/s contact limit well before the hull; `steerToward()` also lost
its exactly-astern dead-lock. Fuel scoops refill the tank at 20 units/s
inside the sun's corona (that half of #11). BOOST does nothing until the
injectors are bought, and dying with an escape pod docks you at the station
with the ship and the fitted gear intact but the manifest gone.

**Still open here**: lasers (they need a damage/rate table and a weapon
priming UI — the port fires one hardcoded beam — and the mining laser also
needs #12), cloak (needs invisibility rules for NPC targeting plus a readout
so the player can tell it is on) and passenger berth (needs passengers and
missions, #7). None of those is a cheap mechanic, so iteration 3 skipped
them explicitly; the galactic drive closed with #8 on `iter/travel`.

### 6. Real docking and launch
User note: make it a setup **easy-mode checkbox on the start screen** — off by
default, on = assisted docking as it works today.

Original: you must match the station's rotation, thread the docking tunnel at
low speed (collision can kill or shred cargo), launch is a 10-second trip
through the force-field tube, and the docking computer does it for you
(ZX guide). Port: auto-dock when within 400 m under 120 m/s, or a DOCK button
within 1500 m (`stepGame()` docking block in `web/src/game.js`) — and with a
bought Docking Computer (#5) the same request is an autopilot from any range;
launch teleports the ship clear (`launch()`). The tunnel, the rotation match
and the 10-second launch trip of the original are still missing, so the
skill moment of the original is gone.

**Done** (branch `iter/docking`): the start screen carries the **EASY MODE**
checkbox (off by default, remembered in `localStorage` as `oolite.easyDock`),
and with it off docking is judged against the spinning Coriolis slot
(`dockFrame()` / `lane()` in `web/src/game.js`): face into the slot, roll
with the station and stay under 120 m/s to thread the sleeve — anything else
costs 25 shield and a tonne of cargo per scrape, while the HUD coaches
`SLOW TO <120 m/s TO DOCK` / `MATCH THE STATION ROTATION` /
`LINE UP WITH THE DOCKING SLOT`. The old shortcut is exactly what the
checkbox turns on. Without it, DOCK only answers with the Docking Computer
(#5) fitted, and that autopilot now flies the slot itself — swing wide onto
the side you came in on, sit on the axis a kilometre out, match the roll,
pace the speed to the slot — instead of aiming at the station's centre.
Launch is the original's 10-second ride out of the force-field tube
(`launchTrip()` / `stepLaunch()`): a fixed path carried by the station's
rotation that hands over framed the way the instant launch always framed
you. Tests and smokes keep the instant `launch()`; `?trip=1` takes the ride.

### 7. Missions
Original: Galactic Navy jobs — track down a stolen experimental ship, carry
Thargoid intelligence across several jumps, the ZX-version **supernova
rescue**; rewards range from cash to gems to a **cloaking device**
(Wikipedia). Port: none — mission scripts are explicitly skipped in
`README.md` ("Not ported yet"), and no hand-rolled equivalents exist.

**Done** (branch `iter/missions`): `web/src/missions.js` holds both Navy jobs
as plain data in `MISSIONS` — no script engine, no `mission.*` host objects.
State is three fields on `g.mission` (`active`, `jumps`, `done`) and every
transition is one function game.js already had a moment for: `missionOnKill()`
from `damageShip()`, `missionOnJump()` from `jump()`, `missionOnDock()` from
`dock()`, each returning HUD text for `pushMessage()`. Mission 1 is the
Constrictor hunt (briefing, target ship, and the original's 5 000 CR reward
from `Resources/Scripts/oolite-constrictor-hunt-mission.js`): while it runs,
`spawnPirate()` puts the stolen ship in the sky instead of the round-robin.
Mission 2 opens only after it and carries Thargoid intelligence (briefing from
`Resources/Config/missiontext.plist`): `g.mission.jumps` counts hyperspace
jumps with a `CARRIED n/3` HUD line, and docking at the end pays 15 000 CR.
The **briefing sits on the docked screen** (`#dock-mission`, between the status
block and the tabs) with an ACCEPT MISSION button — the offer shows the full
text and reward, an accepted mission shows its instruction and progress. Save
data gained an optional `mission` field: pre-mission saves load with a clean
slate and a malformed one refuses the whole save, like `crime` above.

**Skipped here**: the ZX-version **supernova rescue** — it needs a sun that
explodes on a timer, a doomed system and an evacuation choice, none of which
fit the three-field mission state cheaply; and the original's non-cash
rewards — the **cloaking device** (500 000 CR in `equipment.plist`, and its
NPC-invisibility rules are still open under #5) and gems, so both missions
**pay cash only**.

---

## P2 — universe & travel

### 8. Galactic hyperspace — all 8 galaxies
Original: an expensive `EQ_GAL_DRIVE` lets you jump between 8 galaxies × 256
systems; some systems are only reachable that way (both sources). Port:
`makeGalaxy(n)` in `web/src/galaxy.js` already generates every galaxy, but
`web/src/game.js` hardcodes `SYSTEMS = makeGalaxy(1)` and no G+H jump exists.

**Done** (branch `iter/travel`): `EQ_GAL_DRIVE` joined `EQUIPMENT_KEYS` at its
real `equipment.plist` price (50 000 CR, tech level 10) and `galacticJump()`
in `web/src/game.js` follows the original's `Ghy` routine (elite.bbcelite.com):
the drive is **one-shot** (consumed on use, as `Ghy` zeroes `GHYP`), the jump
costs **no fuel** (the original only checks fuel for system jumps), galaxy 8
wraps back to 1, you arrive at the system nearest the galaxy's centre
coordinates **(96, 96)**, and the jump clears the criminal record (`Ghy` sets
FIST to 0). The galaxy lives in `g.galaxy`; every screen reads its systems
through `systemsIn(g)` / `galaxySystems()` instead of the old galaxy-1
`SYSTEMS`, the market cache is keyed by (galaxy, system), and the save gained
an optional `galaxy` field — old saves load in galaxy 1, a save with a ninth
galaxy is refused. The chart's **GALACTIC JUMP** button takes a **second
press** to cross (`CONFIRM — GALAXY n`), so a 50 000 CR one-shot is never
spent by one stray tap; the armed state dies with the chart.

### 9. Long-range chart and per-system data screen
Original: `I` galaxy map with cursor browsing, `P` data on any system
(Distance, Economy, Government, Tech level, Population, Gross productivity,
Average radius, plus the flavour description), `O` local map, `D` distance to
the cursor system (ZX guide). Port: short-range chart only, listing name / ly
/ TL / government / economy (`chartRows()` in `web/src/chart.js`); population,
productivity, radius and description are generated by `web/src/galaxy.js` but
never shown for other systems. No galaxy-wide view.

**Done** (branch `iter/travel`): the chart overlay gained a **LONG RANGE**
view next to the short one — the whole galaxy plotted the way Oolite's
compact `drawStarChart` draws it (x over 256 units, y over 512, centred on
128/128, the same projection as the short view zoomed out 4×) with all 256
systems tappable — and the original's **data screen** (its `P` key) as a
panel under the map for the selected system: Distance, Economy, Government,
Tech level, Population (Oolite's ×0.1 "billion" format), Gross productivity,
Average radius and the description, every field straight from `galaxy.js`.
`longRangeRows()`, `systemReadout()` and `ringSize()` in `web/src/chart.js`
are pure and tested in `tests/test-chart.mjs`; the fuel ring now draws at its
true size (it was twice too large) in both views. `?chart=long` opens the
galaxy-wide view for the headless smoke.

### 10. Witchspace interception
Original: a Thargoid can cut the jump short and dump you in witchspace to
fight invasion ships — with the jump's fuel already spent (Wikipedia). Port:
`jump()` in `web/src/game.js` always arrives cleanly.

**Done** (branch `iter/travel`): `jump()` rolls the original's mis-jump
chance — **0.78%** per jump, the exact odds the BBC Elite source documents
for calling MJP from TT18 instead of arriving — and strands you in
witchspace: the jump's fuel is already spent, **no station exists anywhere**
(a DOCK request answers `NO STATION TO DOCK AT`, the status screen reads
`WITCHSPACE (no station)`), and **three Thargoids** are on you, as MJP
spawns. Escape follows the original: a jump the tank can still afford takes
you out (only possible when the intercepted jump cost less than your tank
held); dry, the JUMP action gets one luck roll per press — 25%, doubled to
50% with the Witchdrive Fuel Injectors fitted (they tap the witch-drive's
own fuel). **shortcut**: the original strands you until you reload and its
escape pod is fatal in witchspace — the port keeps the fatal pod (a stranded
commander dies honestly instead of docking a station that is not there) but
adds the luck roll so an auto-save-only browser session can always get out.
The stranded state is not saved — reloading a save is the original's own way
out — and both rolls run through `g.rand`, a seam the tests pin
(`tests/test-travel.mjs`).

### 11. Fuel scooping: sun skimming and cargo collection
Original: `EQ_FUEL_SCOOPS` lets you skim a star's corona for fuel and pick up
free-floating cargo canisters / escape capsules from wrecks (Wikipedia). Port:
sun skimming is done (#5 — the scoops refill the tank inside the sun's
corona); still open are the `drawScoopStatus:` HUD dial (a no-op stub in
`web/src/hud.js`, feedback is by message only) and canisters dropping from
kills, so there is nothing yet to pick up.

**Done** (branch `iter/space`): every kill now leaves loot — `releaseDebris()`
in `web/src/game.js` drops one or two cargo canisters on the wreck, and hulls
whose shipdata `has_escape_pod` says so (a probability on most ships) also
leave an escape capsule; both drift and tumble on their real Oolite meshes
(`oolite_barrel`, `oolite_escape_capsule`) as `type: 'cargo'` entities. With
`EQ_FUEL_SCOOPS` fitted, anything within 200 m **ahead of the nose** is taken
on the spot: canisters add their tonnes to the hold (`HOLD FULL` turns them
away), an escape capsule is a rescue that reports `ESCAPE POD RESCUED` and
carries no cargo. `drawScoopStatus:` is implemented from Oolite's
`HeadUpDisplay.m`: three stacked chevrons — steady green while the scoops are
free, breathing while they work (sun fuel or a canister going in), dark green
with a red foot when the hold is full — hidden entirely without the scoops,
driven by the new `g.scoopStatus` state (`none | okay | active | full`).
**shortcut**: no tractor-beam animation and no underside-only pickup rule —
Oolite tractors cargo in from further out and only on the ship's lower side;
the port collects within 200 m in front, which a touch stick can line up.

### 12. Asteroid mining
Original: mining is one of the four income routes, with a mining laser and
rocks to break up (Wikipedia; Archimedes version shows miners at work). Port:
no asteroids exist in `web/src/game.js`.

**Done** (branch `iter/space`): asteroids are `type: 'rock'` entities on the
real `oolite_template_asteroid` data (energy 100, no recharge, bounty 10) and
the real `oolite_asteroid` mesh; `spawnAsteroidField()` in `web/src/game.js`
scatters a deterministic field of 1–7 rocks 8–20 km ahead of the nose on
every launch and arrival, and they tumble and drift as white, unpowered
contacts on the scanner. Shots break them: the standard beam needs two
(60 damage vs the rock's 100 energy — the same maths as Oolite's pulse laser
against `max_energy` 100), and the **Mining Laser** joined the shop at its
real `equipment.plist` price (8 000 CR, tech level 10) — fitting it gives the
beam the weapon's real `weapon_info` numbers (range 12 500 m, shot
temperature 10, so it never overheats) and breaks a rock in one shot. A
broken rock pays its 10 CR bounty ("a small fee paid for their destruction",
`descriptions.plist`) and releases 1–2 ore canisters rolled from minerals,
gold, platinum or gem-stones — scoop them (#11) and sell them at the market.
**shortcut**: upstream breaks an asteroid into boulders, the boulders into
splinters, and only scooping a splinter yields 1 t of minerals — three stages
over as many shots; the port collapses that to one stage with the four ore
goods, so mining actually pays. Also not ported: rock hermits and Oolite's
lane-based script populator (`oolite-populator.js`) — the port's field is one
deterministic handful per system, near the player.

### 13. Dodo stations
Original: besides Coriolis there are dodecahedron "Dodo" stations (ZX guide).
Port: Coriolis only (`spawnStation()` in `web/src/game.js`, one model in
`web/assets/models`).

---

## P3 — flight & combat depth

### 14. Changeable views and cockpit (pospond)
Original: keys 1–4 give front / aft / left / right views in flight, and every
version has a cockpit/dashboard frame (ZX guide describes the panel). Port:
single fixed chase camera, no cockpit (`README.md` lists both as not ported).

### 15. NPC ecosystem
Original: police patrol, traders go about their business, other pilots attack
traders to farm their own rating (ZX guide; the Archimedes version took this
furthest). Port: traders fly straight lines and never engage, only the player
is ever attacked (`updateNPC()` in `web/src/game.js`).

### 16. Laser types and mounts
Original: pulse / burst / mining / military lasers, fore and aft mounts,
upgrades sold by tech level (Wikipedia equipment list). Port: one fixed
forward beam laser for everyone.

### 17. Live instruments
Original dials that are currently dead or absent in the port
(`web/src/hud.js` / `web/src/game.js`):

- **Altitude** — `altitudeFraction` is never updated (always 0), so flying
  into the planet is harmless.
- **Cabin temperature** — fixed at 60; no heating near the sun.
- **Yellow / flashing alert state** — only green and red are ever set
  (`g.alert` in `web/src/game.js`), though the HUD can draw yellow.
- **Energy banks 1–4 + "ENERGY LOW"** — single gauge, no warning text.

### 18. Missile lock states
Original: the missile indicator shows unarmed / locked / armed colours and
missile status at a glance (ZX guide). Port: one standard missile per press,
no lock-on state (documented `shortcut:` in `web/src/game.js`).

---

## P4 — fidelity polish

### 19. Commander name and named saves
Original: you are Commander Jameson, and `LOAD NEW COMMANDER (Y/N)` plus tape
saves ask for a name (both sources). Port: no name anywhere; save slots show
system / credits / kills only (`web/src/slots.js`).

### 20. In-system J-drive with interference
ZX guide: `J` makes a fast in-system hop that fails with an audible warning
when a star, planet or ship is nearby. Port: only Oolite-style injectors
(BOOST). *Note: Oolite itself dropped the J-drive, so this is ZX-original
only — implement last, or explicitly skip.*

### 21. Docking computer music
Some versions play "The Blue Danube" during auto-docking (Wikipedia). Port
already ships `.ogg` UI sounds (`web/assets/sounds`); no music at all.

### 22. Wireframe display mode
The original's signature look is wireframe 3D with hidden-line removal
(Wikipedia). Port draws textured polygon meshes (Oolite style, deliberate).
A toggleable wireframe mode would be a cheap nod to the original.

### 23. Trumbles (C64 novelty)
The Commodore 64 version's tribble-like pets that eat your cargo
(Wikipedia). Pure flavour — only worth it if everything above is done.

---

## Already present (checked, do not re-add)

Flight model, shields/energy, forward laser with heat, missiles + ECM,
Thargoids, scanner with zoom, compass, target reticle, clock, fuel gauge,
7 ly jump limit and fuel cost, short-range chart with fuel ring, real galaxy
seed data (names, governments, economies, tech levels, descriptions),
market / shipyard / trade-in, save slots + auto-save, touch/gyro/gamepad,
sound. See `README.md` for the authoritative "what is ported" list.
