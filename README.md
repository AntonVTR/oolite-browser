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
  dock → buy/sell commodities → refuel → witchspace jump to the next system →
  repeat. Credits, cargo hold, bounty rewards, shields, laser heat, death.
- **Controls**: virtual stick + throttle + buttons (touch), gyro tilt steering
  with the iOS permission gesture, keyboard, mouse and gamepad.

## Not ported yet (P1/P2)

- Full Oolite galaxy generation, system descriptions and the full 256-system
  map — this build ships a fixed 8-system circuit (classic Elite names).
- Equipment / shipyard / missions / AI scripting (`.js` ship AIs) and the
  remaining ship roster.
- Cockpit view, sun/planet textures (the planet is flat-shaded), wormholes.

## Controls

| Action | Keyboard / mouse | Touch | Gamepad |
| --- | --- | --- | --- |
| Pitch / yaw | `↑ ↓ ← →` or mouse | left stick | left stick |
| Roll | `,` / `.` or `A` `D` | ⟲ ⟳ buttons | right stick X / D-pad ← → |
| Throttle | `W` / `S`, `F` full, `R` reverse | slider | right stick Y / D-pad ↑ ↓ |
| Injectors (boost) | `I` | BOOST | LT / RB / X |
| Fire | `Space` / left mouse | FIRE | RT / A |
| Next target | `Tab` | TGT | LB / B |
| Dock | `Enter` | DOCK | Back |
| Jump | `J` | JUMP | Y |
| Gyro steering | `G` | GYRO | — |

Docking: fly within 400 m of the station at under 120 m/s (or press DOCK under
1500 m). Refuel and trade from the station screen.

## Development

```bash
node tests/test-parsers.mjs   # plist + .dat mesh parsers
node tests/test-game.mjs      # headless gameplay: launch, combat, market, jump, death
node tests/test-view.mjs      # camera / coordinate-frame convention
python3 -m http.server 8099 --directory web   # local server
# headless smoke test (console errors + screenshots):
google-chrome --headless=new --virtual-time-budget=6000 --screenshot=/tmp/shot.png \
  'http://127.0.0.1:8099/?autostart=1'
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
