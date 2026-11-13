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
- **Gameplay loop**: launch from a Coriolis station → fly → shoot pirates →
  dock → buy/sell commodities → trade your ship in at the shipyard → refuel →
  witchspace jump to the next system → repeat. Credits, cargo hold, bounty
  rewards, shields, laser heat, death.
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
  rest for 5 s. Extra missiles (300 CR) fill free pylons.
- **Thargoid warship** on its real mesh and texture: hostile, fast, it never
  breaks off and shoots missiles often. The Constrictor and the Adder join the
  pirate and trader rosters — 14 ship types in the sky now.

## Not ported yet

- Mission scripts from `Resources/Scripts/*.js` — skipped: they need Oolite's
  own JavaScript engine (ship/player host objects, mission variables, priority
  AI), which this port does not have.
- 39 of the 41 equipment types (only E.C.M. and missiles are modelled), ship
  AI scripts (`.js`), mines, cloak, escape pod, missile-vs-missile interception.
- Cockpit view, real sun/planet textures (both are shaded spheres), wormholes.

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
| Scanner zoom | `Z` / `Shift+Z` | tap the radar | — |
| Gyro steering | `G` | GYRO | — |
| Fullscreen | `F11` (browser) | FULL | — |

Docking: fly within 400 m of the station at under 120 m/s (or press DOCK under
1500 m). The station screen has two tabs: **Market** (six commodities plus an
**Equipment** section — the E.C.M. System for 6 000 CR and extra missiles for
300 CR each, up to the hull's pylon count) and **Shipyard** (eleven hulls with
real `shipyard.plist` prices; your current ship is traded in at ~71% of its
price, cargo is sold off automatically, and a bought hull leaves the stock for
good). Refuel from the same screen.

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
node tests/test-view.mjs      # camera / coordinate-frame convention
node tests/test-touch.mjs     # double-tap zoom guard
node tests/test-save.mjs      # auto-save round trip, bad saves rejected, manual slots
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
