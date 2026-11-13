# Missing features vs. the original *Elite*

What the original 1984 *Elite* has that this port does not, ranked by how much
each gap hurts the "this is Elite" feeling.

Sources studied:

- https://www.elite-games.ru/elite/zxbegin.shtml — ZX Spectrum beginner's guide
  (status screen, controls, instruments, docking, hyperspace, galactic jump)
- https://en.wikipedia.org/wiki/Elite_(video_game) — gameplay, development,
  versions, mission and equipment overview

Checked against the port on 2026-11-13 (`web/src`, `README.md`). File references
are to this repo.

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

### 2. Legal status and police
Original: status runs Clear → Offender → Fugitive; crimes (killing traders or
police, selling illegal goods) make Vipers hunt you, and firing inside a
station's protection zone brings reprisal (ZX guide). Port: no legal state at
all — `damageShip()` credits the player for *any* kill with no penalty
(`web/src/game.js`), and **Vipers spawn as hostile pirates**
(`PIRATE_KEYS` in `web/src/game.js`) instead of being the police. This also
gates illegal commodities (see #4).

### 3. Status screen with all fields (and one in flight)
Original status page: commander name, Present system, Hyperspace system, Fuel,
Cash, **Legal status**, **Rating** (ZX guide). Port: the docked screen shows
credits / fuel / cargo / kills / system description only
(`buildMarketScreen()` in `web/src/main.js`), and there is **no status screen
while flying** — you must dock to see your situation. "Hyperspace system"
(nav target) is not tracked either: the chart jumps immediately.

### 4. Full commodity market (17 goods + legality)
Original/Oolite: 17 commodities from `trade-goods.plist` (food, textiles,
radioactives, slaves, luxuries, narcotics, computers, machinery, alloys,
firearms, furs, minerals, gold, platinum, …) with per-system price and
quantity formulas and export/import legality. Port: 6 hardcoded goods with
invented prices (`GOODS` in `web/src/game.js`); `trade-goods.plist` is not
even copied into `web/assets/config/`. No slaves/narcotics → no illegal-trade
hook for #2.

### 5. Equipment range (2 of ~41 items)
Original upgrades: better lasers, more missiles, cargo bay, **docking
computer**, **fuel scoops**, extra energy bank, shield boosters, fuel
injection, **escape pod**, **galactic drive**, cloak, passenger berth (both
sources; full list in `web/assets/config/equipment.plist`). Port sells only
`EQ_ECM` and `EQ_MISSILE` (`EQUIPMENT_KEYS` in `web/src/game.js`). Notably
fuel injectors are *free and always on* instead of a purchase, and death is
always a game over because there is no escape pod.

### 6. Real docking and launch
User note: make it a setup **easy-mode checkbox on the start screen** — off by
default, on = assisted docking as it works today.

Original: you must match the station's rotation, thread the docking tunnel at
low speed (collision can kill or shred cargo), launch is a 10-second trip
through the force-field tube, and the docking computer does it for you
(ZX guide). Port: auto-dock when within 400 m under 120 m/s, or a DOCK button
within 1500 m (`stepGame()` docking block in `web/src/game.js`); launch
teleports the ship clear (`launch()`). The skill moment of the original is
gone.

### 7. Missions
Original: Galactic Navy jobs — track down a stolen experimental ship, carry
Thargoid intelligence across several jumps, the ZX-version **supernova
rescue**; rewards range from cash to gems to a **cloaking device**
(Wikipedia). Port: none — mission scripts are explicitly skipped in
`README.md` ("Not ported yet"), and no hand-rolled equivalents exist.

---

## P2 — universe & travel

### 8. Galactic hyperspace — all 8 galaxies
Original: an expensive `EQ_GAL_DRIVE` lets you jump between 8 galaxies × 256
systems; some systems are only reachable that way (both sources). Port:
`makeGalaxy(n)` in `web/src/galaxy.js` already generates every galaxy, but
`web/src/game.js` hardcodes `SYSTEMS = makeGalaxy(1)` and no G+H jump exists.

### 9. Long-range chart and per-system data screen
Original: `I` galaxy map with cursor browsing, `P` data on any system
(Distance, Economy, Government, Tech level, Population, Gross productivity,
Average radius, plus the flavour description), `O` local map, `D` distance to
the cursor system (ZX guide). Port: short-range chart only, listing name / ly
/ TL / government / economy (`chartRows()` in `web/src/chart.js`); population,
productivity, radius and description are generated by `web/src/galaxy.js` but
never shown for other systems. No galaxy-wide view.

### 10. Witchspace interception
Original: a Thargoid can cut the jump short and dump you in witchspace to
fight invasion ships — with the jump's fuel already spent (Wikipedia). Port:
`jump()` in `web/src/game.js` always arrives cleanly.

### 11. Fuel scooping: sun skimming and cargo collection
Original: `EQ_FUEL_SCOOPS` lets you skim a star's corona for fuel and pick up
free-floating cargo canisters / escape capsules from wrecks (Wikipedia). Port:
`drawScoopStatus:` is a no-op stub (`web/src/hud.js`), no scoop equipment, no
canisters drop from kills.

### 12. Asteroid mining
Original: mining is one of the four income routes, with a mining laser and
rocks to break up (Wikipedia; Archimedes version shows miners at work). Port:
no asteroids exist in `web/src/game.js`.

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
