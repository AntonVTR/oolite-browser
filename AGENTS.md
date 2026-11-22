# AGENTS.md

Browser port of Oolite: plain ES modules + WebGL1, **no bundler, no npm
dependencies** — there is no `package.json`; Node is only there to run tests.

## Layout

- `web/src/` — the game. `main.js` boots it; `assets.js` fetches and parses;
  `game.js` state; `render.js` / `hud.js` drawing; `plist.js` / `mesh.js` are
  the port's own Oolite parsers.
- `web/assets/` — real Oolite data (`.plist` configs, `.dat` meshes, PNGs, `.ogg`).
- `tests/` — one plain `node tests/*.mjs` script per feature, no framework.
- `tools/deploy.sh` — runs the whole suite, then force-pushes `web/` to
  `gh-pages`. Nothing ships on a red suite.
- `upstream/` — the original Oolite sources; cite file/method when porting
  behaviour (`ShipEntity.m`, `OOCommodities.m`, …).

## Code graph

`graphify-out/` holds a knowledge graph of the code (tree-sitter AST, local, no
API cost). Prefer it over grepping for structural questions — what calls X, how
A reaches B:

```bash
graphify explain "createGame"     # node, source line, top connections
graphify path "Hud" "jump"        # shortest path between two concepts
graphify update .                 # after code changes — keeps it current
```

`graphify-out/GRAPH_REPORT.md` gives broad orientation (communities, god
nodes). Do not treat the graph as evidence about its own correctness, and fall
back to `grep`/`read` for content questions — `.plist`/`.dat` assets are not in
the graph (33 files have no supported extractor).

## Git

Follow https://docs.github.com/en/get-started/using-github/github-flow

## Code principles

Apply KISS, YAGNI, DRY, and SOLID principles

## Before you commit

```bash
for t in tests/*.mjs; do node "$t"; done   # what deploy.sh gates on
```

A behavioural change needs its own test in `tests/` (assert-based, prints
`… ok`, exits non-zero on failure) and a line in the README test list if you
add a file. Headless smoke of the real page:

```bash
python3 -m http.server 8099 --directory web
google-chrome --headless=new --virtual-time-budget=6000 --screenshot=/tmp/shot.png \
  'http://127.0.0.1:8099/?autostart=1'
```

`?autostart=1` plus flags (`&dock`, `&thargoid`, `&chart`, `&slots=1`, …) drive
each screen for the smoke; failures log `console.error`, which the smoke greps.

## Conventions

- Comments say **why**, in the port's voice, naming the original's source when
  the behaviour comes from there. A known limit is marked
  `shortcut: <limit>, <when to upgrade>`.
- Keep the existing layers: no new dependencies, no build step, no config
  nobody asked for. The shortest working diff wins.
- Element ids in `index.html` are checked by `tests/test-page.mjs` — renaming
  one breaks a screen silently, so keep the id audit green.

## Sync

Work happens on `main`. After tests pass: `git add -A`, commit with a short
imperative message (`fix: …`, `feat: …`), then `git push origin main`.
Deploy is separate: `tools/deploy.sh`.
