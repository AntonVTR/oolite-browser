# oolite-browser

A browser port of [Oolite](https://github.com/OoliteProject/oolite) — a classic
space trading combat game — playable on desktop, iPad and Android with touch,
gyro, keyboard/mouse and gamepad.

**Play it: https://antonvtr.github.io/oolite-browser/**

## What is ported (P0)

- **Real Oolite assets**: `.dat` meshes, PNG textures, `.ogg` sounds and the
  old-style NeXTSTEP `.plist` configs are parsed by this repo's own parsers
  (`web/src/mesh.js`, `web/src/plist.js`) and drawn with WebGL1. No bundler,
  no npm dependencies — plain ES modules.
- **HUD** drawn from Oolite's real `Resources/Config/hud.plist` and
  `crosshairs.plist`: scanner, shields, energy, fuel, compass, clock, target
  panel, alerts and messages.
- **Flight model** ported from `src/Core/Entities/ShipEntity.m`, using the real
  per-ship numbers from `shipdata.plist` (`max_flight_speed`, `max_flight_pitch`,
  `max_flight_roll`, `max_energy`, `max_cargo`, …).
- **Gameplay loop**: launch from a Coriolis or Dodecahedron (Dodo) station →
  fly → shoot pirates →
  dock → buy/sell commodities → trade your ship in at the shipyard → refuel →
  witchspace jump to the next system → repeat. Credits, cargo hold, bounty
  rewards, shields, laser heat, death.
- **Real docking and launch**: dock the original's way — face into the slot,
  roll with the spinning station and arrive under 120 m/s — or tick
  **EASY MODE** on the start screen for the old assisted shortcut (the
  preference is remembered in `localStorage`). LAUNCH rides the original's
  10-second trip out of the force-field tube instead of teleporting.
- **Dodo stations**: which systems get a Coriolis and which a dodecahedron
  **Dodo** comes from the real `planetinfo.plist` (`station = "dodecahedron"`
  — 22 of galaxy 1's 256 systems); the Dodo is Oolite's own mesh and
  textures and docks under the same slot rules on its own sleeve offset.
- **Combat rating and legal status**: kills advance you Harmless → Elite on
  the original's kill thresholds, crimes (firing on innocents in the station's
  protection zone, killing traders or police) make the Vipers hunt you as the
  police, and legal status runs Clear → Offender → Fugitive — shown on the
  status screen (`5` / STATUS while flying) and at the station. Docking
  clears the record.
- **Commodity market**: the 17 goods of the real `trade-goods.plist`, priced
  and stocked per system by Oolite's own economy formulas (`economicBiasForGood`
  from the good's peak export/import economies, then the price and quantity
  averages with the source's two-draw random term, `OOCommodities.m`). Stock
  moves with every trade (127-unit market limit), gold and gem stones keep their
  kg/g units, and slaves, narcotics and Firearms are marked **ILLEGAL** —
  selling them raises the legal status.
- **Controls**: virtual stick + throttle + buttons (touch) — the stick floats:
  touch anywhere in the left half to grab it where your finger lands; radar tap
  zooms the scanner. Gyro tilt steering with the iOS permission gesture,
  keyboard, mouse and gamepad.

## Also ported (P2)

- **Missiles**: `M` / MISSILE / Start fires one at the locked target; it
  tracks, hits and explodes on the real shipdata numbers (750 m/s, 25 m fuse,
  blastPower 180). Hostile ships loose their own at you.
- **ECM**: buy the E.C.M. System, fire it with `X` / ECM — four pulses sweep
  out to 25.6 km over 2.5 s and detonate incoming missiles, drain energy, then
  rest for 5 s. Extra missiles (300 CR) fill free pylons; past the hull's own
  count each missile brings its own rack.
- **Thargoid warship** on its real mesh and texture: hostile, fast, it never
  breaks off and shoots missiles often. The Constrictor and the Adder join the
  pirate and trader rosters — 14 ship types in the sky now.
- **Witchspace interception**: 0.78% of jumps mis-jump — the original's own
  odds — and strand you in witchspace with the jump's fuel already spent: no
  station anywhere (DOCK answers `NO STATION TO DOCK AT`, the status screen
  reads `WITCHSPACE (no station)`) and three Thargoids on you. Jump out if
  the tank still buys a hop; dry, each JUMP press gets a luck roll (25%,
  doubled by the Witchdrive Fuel Injectors), and the escape pod is fatal in
  witchspace, as in the original.
- **Missions**: the Galactic Navy chain — hunt down the stolen Constrictor,
  then carry Thargoid intelligence across three jumps. The briefing is on the
  docked screen with an ACCEPT button, progress shows in the HUD messages
  across hyperspace jumps, and each job pays cash on completion
  (`web/src/missions.js`).
- **Fuel scooping**: besides skimming the sun's corona, the scoops collect
  what kills leave behind — cargo canisters from every wreck, and an escape
  capsule from hulls that carry one (scooping it is a rescue) — within 200 m
  ahead of the nose while the hold has room. The HUD's scoop dial (Oolite's
  `drawScoopStatus:`) shows it: steady green when ready, breathing while the
  scoops work, dark green with a red foot when the hold is full.
- **Asteroid mining**: every system scatters a field of rocks on the real
  asteroid mesh and shipdata; break them with the laser (two shots) or buy
  the **Mining Laser** (8 000 CR) for 12.5 km range, cool running and one-shot
  rocks. Broken rocks pay a 10 CR bounty and release ore canisters — minerals,
  gold, platinum or gem-stones — for the scoops to collect and the market to
  buy.
- **Views and live instruments**: `1`–`4` (or the **VIEW** button) switch the
  front, aft, port and starboard views inside a canopy frame drawn on the HUD
  canvas — the crosshair only shows in the view that points where the laser
  fires — and the dials are fed for real: altitude that fills over 40 km and
  hurts when you fly into the planet, a cabin temperature that cooks you near
  the sun, the yellow/red alert light with its warning states, and the
  `ENERGY LOW` warning.

## Not ported yet

- Mission scripts from `Resources/Scripts/*.js` as scripts — skipped: they need
  Oolite's own JavaScript engine (ship/player host objects, mission variables,
  priority AI), which this port does not have. The Galactic Navy chain itself
  is hand-rolled as plain data instead (see below, #7); the rest of Oolite's
  script content is untouched.
- 30 of the 41 equipment types — the shop sells eleven of them (cargo bay,
  extra energy unit, shield boosters, docking computer, fuel scoops, escape
  pod, fuel injectors, E.C.M., missiles, galactic hyperdrive, mining laser),
  while the other laser types, cloak, passenger berth and the rest are not
  modelled — plus ship AI scripts
  (`.js`), mines and missile-vs-missile interception.
- Real sun/planet textures (both are shaded spheres), a textured cockpit
  interior (the HUD draws a canopy frame instead), wormholes.

## Controls

| Action | Keyboard / mouse | Touch | Gamepad |
| --- | --- | --- | --- |
| Pitch / yaw | `↑ ↓ ← →` or mouse | left stick | left stick |
| Roll | `,` / `.` or `A` `D` | ⟲ ⟳ buttons | right stick X / D-pad ← → |
| Throttle | `W` / `S`, `F` full, `R` stop | slider (top-right) | right stick Y / D-pad ↑ ↓ |
| Injectors (boost) | `I` | BOOST | LT / RB / X |
| Fire | `Space` / left mouse | FIRE | RT / A |
| Launch missile | `M` | MISSILE | Start |
| ECM (jam missiles) | `X` | ECM | — |
| Next target | `Tab` | TGT | LB / B |
| Dock | `Enter` | DOCK | Back |
| Jump | `J` | JUMP | Y |
| Chart (pick jump target) | `C` | CHART | — |
| Status screen (in flight) | `5` | STATUS | — |
| View: front / aft / port / starboard | `1` `2` `3` `4` | VIEW (cycles) | — |
| Scanner zoom | `Z` / `Shift+Z` | tap the radar | — |
| Gyro steering | `G` | GYRO | — |
| Fullscreen | `F11` (browser) | FULL | — |

Docking: the start screen's **EASY MODE** checkbox picks the rules (kept in
`localStorage`). **On** — the old shortcut: fly within 400 m of the station at
under 120 m/s, or press DOCK under 1500 m; with a **Docking Computer** fitted
the same request is an autopilot that turns onto the station from any range
and slows itself for the contact. **Off** (the default) — the original's
skill: face into the slot, roll with the spinning station and arrive under
120 m/s; the HUD coaches `SLOW TO <120 m/s TO DOCK`,
`MATCH THE STATION ROTATION` and `LINE UP WITH THE DOCKING SLOT`, and a rough
or too-fast approach costs 25 shield plus a tonne of cargo per scrape. In
this mode DOCK only answers with the Docking Computer fitted, and its
autopilot then flies the real approach itself. LAUNCH takes the 10-second
tube ride in both modes (`?autostart` smokes keep the instant launch;
`?trip=1` takes the ride, `?easy=1` forces easy mode).
The station screen has two tabs: **Market** (the 17 commodities of
`trade-goods.plist`, each with the price and stock the current system's
economy gives it — food is cheap where it is grown, computers where they are
built — and contraband tagged **ILLEGAL**; selling it is a crime. Below them
an **Equipment** section with eleven items at their real `equipment.plist`
prices: Large Cargo Bay (+15 t hold), Extra Energy Unit (recharge ×1.8),
Shield Boosters (+128 shields), E.C.M. System, missiles (300 CR each — past
the hull's pylons every missile brings its own rack), Fuel Scoops (skim the
sun's corona to refill the tank), Escape Pod (destruction becomes a rescue:
same ship, cargo lost), Witchdrive Fuel Injectors (BOOST does nothing until
they are bought), the Docking Computer, the **Galactic Hyperdrive**
(50 000 CR — one jump to the next galaxy, fired from the chart, see below)
and the **Mining Laser** (8 000 CR — 12.5 km range, cool running, breaks an
asteroid in one shot). The other tab is **Shipyard**
(eleven hulls with
real `shipyard.plist` prices; your current ship is traded in at ~71% of its
price, cargo is sold off automatically, and a bought hull leaves the stock for
good). Refuel from the same screen.

**Chart** (`C` / CHART): a **SHORT RANGE** view — everything inside the 7 ly
ring with its real data — and a **LONG RANGE** view of the whole galaxy, each
with a tap-to-select **system data** panel under the map: distance, economy,
government, tech level, population, gross productivity, average radius and
the system description, the same fields the original's data screen shows.
Tapping a star or a row moves the panel; JUMP still flies the hop. With the
**Galactic Hyperdrive** fitted (50 000 CR) the chart also carries a
**GALACTIC JUMP** button — press it **twice** (first arms it,
`CONFIRM — GALAXY n`) to cross into the next galaxy: one-shot drive, no fuel
cost, galaxy 8 wraps to 1, you land on the system nearest the galaxy's centre
(96, 96) and your legal record is cleared, exactly as the original's
galactic jump works.

**Save / load**: docking still writes the auto-save that **CONTINUE** on the
title screen loads. On top of that, the station screen has a **SAVE** button
next to LAUNCH and the title screen a **LOAD** button next to CONTINUE — both
open a three-slot menu. Each row shows what is in the slot (system, credits,
phase, kills) or `empty`; an occupied slot needs a second tap (**CONFIRM**)
before it is overwritten, and a slot holding an old or corrupt save reads as
empty, so it can only be replaced, never loaded. `Esc` closes either menu.

## Development

```bash
node tests/test-parsers.mjs   # plist + .dat mesh parsers
node tests/test-game.mjs      # headless gameplay: launch, combat, market, shipyard, jump, death
node tests/test-status.mjs    # status screen rows: system, fuel, cash, legal status, rating
node tests/test-view.mjs      # camera / coordinate-frame convention
node tests/test-touch.mjs     # double-tap zoom guard
node tests/test-save.mjs      # auto-save round trip, bad saves rejected, manual slots
node tests/test-missions.mjs  # Navy missions: offer order, accept, jump progress, reward, save
node tests/test-chart.mjs     # short/long chart views, system data screen, fuel ring, jump range
node tests/test-travel.mjs    # galactic hyperspace and witchspace: crossing, stranding, escape
node tests/test-scoop.mjs     # fuel scooping: canisters, escape capsules, the scoop dial
node tests/test-mining.mjs    # asteroids, the mining laser, ore that pays at the market
node tests/test-dodo.mjs      # planetinfo picks Coriolis vs Dodo, and the Dodo docks
node tests/test-instruments.mjs  # live instruments: altitude/impact, cabin heat, alert ladder
python3 -m http.server 8099 --directory web   # local server
# headless smoke test (console errors + screenshots):
google-chrome --headless=new --virtual-time-budget=6000 --screenshot=/tmp/shot.png \
  'http://127.0.0.1:8099/?autostart=1'
# ...with the thargoid warship parked ahead of the nose:
google-chrome --headless=new --virtual-time-budget=1500 --screenshot=/tmp/thargoid.png \
  'http://127.0.0.1:8099/?autostart=1&thargoid=1'
# save-at-station → load-from-title smoke: expect exactly the two "slots smoke:"
# logs and no ERROR:CONSOLE line (WebGL/AudioContext notices are pre-existing):
google-chrome --headless=new --enable-logging=stderr --virtual-time-budget=20000 \
  --user-data-dir=/tmp/oolite-slots-smoke --screenshot=/tmp/slots.png \
  'http://127.0.0.1:8099/?autostart=1&dock=1&slots=1' 2>&1 | grep CONSOLE
# ?slots=save / ?slots=load open one menu and leave it up for a screenshot
# the Navy mission briefing on the docked screen, and ACCEPT pressed for you:
google-chrome --headless=new --virtual-time-budget=9000 --window-size=760,900 \
  --user-data-dir=/tmp/oolite-mission --screenshot=/tmp/mission.png \
  'http://127.0.0.1:8099/?autostart=1&dock=1&mission=1' 2>&1 | grep CONSOLE
# easy mode and the 10 s launch ride must stay console-clean too:
google-chrome --headless=new --virtual-time-budget=6000 --screenshot=/tmp/easy.png \
  'http://127.0.0.1:8099/?autostart=1&easy=1'
google-chrome --headless=new --virtual-time-budget=13000 --screenshot=/tmp/trip.png \
  'http://127.0.0.1:8099/?autostart=1&trip=1'
# the long-range chart: whole galaxy + system data panel, console-clean:
google-chrome --headless=new --enable-logging=stderr --virtual-time-budget=6000 \
  --window-size=760,1400 --user-data-dir=/tmp/oolite-long \
  --screenshot=/tmp/long.png \
  'http://127.0.0.1:8099/?autostart=1&chart=long' 2>&1 | grep CONSOLE
# the forced mis-jump: stranded in witchspace with three Thargoids, console-clean:
google-chrome --headless=new --enable-logging=stderr --virtual-time-budget=8000 \
  --user-data-dir=/tmp/oolite-witch --screenshot=/tmp/witch.png \
  'http://127.0.0.1:8099/?autostart=1&witchspace=1' 2>&1 | grep CONSOLE
# a dodecahedron station in a system whose real planetinfo says so (#13):
google-chrome --headless=new --enable-logging=stderr --virtual-time-budget=6000 \
  --user-data-dir=/tmp/oolite-dodo --screenshot=/tmp/dodo.png \
  'http://127.0.0.1:8099/?autostart=1&dodo=1' 2>&1 | grep CONSOLE
# another view with the cockpit frame around it, console-clean (#14):
google-chrome --headless=new --enable-logging=stderr --virtual-time-budget=6000 \
  --user-data-dir=/tmp/oolite-view --screenshot=/tmp/view.png \
  'http://127.0.0.1:8099/?autostart=1&view=aft' 2>&1 | grep CONSOLE
```

`tools/copy-assets.sh` copies the used subset of `upstream/Resources` into
`web/assets` (textures downscaled to 1024 px). `upstream/` is a shallow clone of
the Oolite repository and is **not** tracked by git.

Deploy: `tools/deploy.sh` force-pushes `web/` to the `gh-pages` branch that
GitHub Pages serves.

## Licence

Game assets, artwork, sounds and the design are © Oolite contributors, licensed
under the [GPLv2](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) (see
`upstream/LICENSE` and `upstream/README.md`). This port reuses those assets and
re-implements gameplay behaviour from Oolite's Objective-C sources in
JavaScript; it is not affiliated with or endorsed by the Oolite project.
