# Oolite → Browser port — brief

Repo: https://github.com/AntonVTR/oolite-browser (public, GitHub Pages = the "cloud" target)
Upstream: https://github.com/OoliteProject/oolite (BSD-ish license, see `upstream/LICENSE.md`)

## What this is

A browser port of the classic space trading game **Oolite** (an Elite-inspired game, ~241 Objective-C
files + Cocoa/OpenGL/SDL). The native codebase cannot be compiled for the web (it needs Cocoa,
GNUstep, OpenGL and a full POSIX app stack), so the port **reimplements the engine in JavaScript
while reusing Oolite's real game data and assets** from `upstream/Resources/`:

- 3D ship models — `Resources/Models/*.dat` (plain-text mesh format, parser in `src/Core/OOMesh.m`)
- Textures — `Resources/Textures/*.png`
- Ship / equipment / market / HUD data — `Resources/Config/*.plist` (old-style NeXTSTEP plists:
  `key = value;`, `(...)` arrays, `{...}` dicts, unquoted strings, `yes/no`, `/* */` comments)
- Sounds — `Resources/Sounds/*.ogg`
- Game logic reference — `src/Core/*.m` (flight model, HUD, AI, docking, market, galaxy)

Honest scope: this is **not** feature parity with Oolite. It is a faithful, playable subset —
the real ships, the real textures, the real market/economy numbers, the real flight feel —
running in a browser on iPad and Android.

## Repository layout

```
upstream/          shallow clone of OoliteProject/oolite — GITIGNORED, read-only reference
web/               the game — this is what gets deployed
  index.html
  src/*.js         ES modules, no bundler, no framework, no npm deps
  assets/          small subset copied from upstream/Resources (models, textures, sounds, config)
tools/             deploy.sh, asset-copy script
BRIEF.md           this file
```

No build step: plain ES modules served statically. Keep `web/` under ~60 MB (copy only the assets
actually used — do not ship the 199 MB texture folder).

## Acceptance criteria (in priority order)

**P0 — must ship, deployed and playable on an iPad:**
1. Title screen → launch from a Coriolis station → fly in normal space.
2. Real Oolite assets: at least the player ship (Cobra Mk III) and 4–6 NPC ships rendered from
   `.dat` meshes with their real PNG textures; starfield + planet/sun; station model.
3. Flight model ported from `src/Core/PlayerEntity.m` / `ShipEntity.m`: pitch/yaw/roll, throttle,
   speed, energy/recharge, forward laser with recharge, collision, boost/injectors.
4. HUD from `Resources/Config/hud.plist` + `HeadUpDisplay.m`: scanner with blips, speed bar,
   energy bar, target shield/laser status, crosshair, compass.
5. Combat: 1–2 hostile pirate types with simple AI, laser hits, explosions, credits on kill.
6. Docking: approach station, request/clearance-free dock, launch again.
7. **Touch controls**: left virtual joystick (pitch/yaw), right virtual joystick or slider
   (throttle), fire button, injectors button. Must work in mobile Safari and Chrome Android.
8. **Gyro**: `DeviceOrientation` tilt-to-steer, behind a button that calls
   `DeviceOrientationEvent.requestPermission()` (iOS 13+ requires a user gesture). Falls back
   cleanly where unsupported; a toggle in settings to turn it off.
9. Keyboard + mouse for desktop. Gamepad API (`GamepadEvent` polling) if trivially available.
10. Sound: laser, explosion, engine, UI beeps from `Resources/Sounds/*.ogg` via `AudioContext`.
11. Deployed to GitHub Pages and reachable as a working URL, no console errors, `>= 30 fps` on a
    mid-range Android in Chrome.

**P1 — after P0 is live:**
12. Witchspace jump between systems, short-range chart (`Resources/Images/oolite-short-range-chart.png`),
    system name/tech-level/government/economy read from the real galaxy data
    (port the seed-based galaxy generator in `src/Core/Universe.m` / `legacy_random.c`).
13. Market: buy/sell cargo at `Resources/Config/trade-goods.plist` prices with the real economy
    formula; credits, cargo hold, fuel.
14. Save/load to `localStorage`.
15. Docked station screen: status, market, shipyard (buy a second ship type), options.

**P2 — only if P0+P1 are done:**
16. More ships, missiles, ECM, thargoids, sun/skybox, mission scripts from `Resources/Scripts/*.js`
    (the JS in the repo runs in a sandboxed interpreter only if cheap — otherwise skip and say so).

## Definition of done for this task

- P0 items 1–11 all work on a real iPad or Android tablet (or, failing device access, verified in
  Chrome DevTools device emulation with a clear note of what was NOT hardware-verified).
- `tools/deploy.sh` pushes `web/` to the `gh-pages` branch, Pages is enabled via
  `gh api repos/AntonVTR/oolite-browser/pages`, and the public URL is posted in the Discord thread.
- A short `README.md` in the repo root: what was ported, what was not, controls, license notice
  ("Oolite © 2003–2024 Giles Williams and contributors, BSD license — see upstream/LICENSE.md").

## Rules

- Commit after every working slice (small commits, working tree always shippable).
- Keep `upstream/` out of git (`.gitignore` it) — it is 484 MB of reference material.
- No npm dependencies, no bundler, no TypeScript build. Vanilla ES modules.
- Do not weaken the deployment: the game must load from a plain static host over HTTPS.
- If something in P0 turns out to be infeasible, do the closest working version, document the
  shortcut in a `// shortcut:` comment, and say so explicitly in the final report.
