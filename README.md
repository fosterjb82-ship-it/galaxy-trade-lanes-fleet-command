# Galaxy Trade Lanes: Fleet Command

Browser prototype of the 2–6 player deck-building space strategy game described in [DESIGN.md](DESIGN.md). Hot-seat multiplayer: everyone plays on one screen.

## Run it

```sh
npm start        # serves the game at http://localhost:8080
npm test         # runs the logic tests (Node 20+, no dependencies)
```

There is no build step: plain ES modules, no dependencies.

## Build stages

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Map generator with seeds and fairness checks | ✅ Map Lab |
| 2 | Core game state: decks, hands, ships on the board, Command Points | — |
| 3 | Turn flow: draw, play, buy, end turn, end-of-round scoring | — |
| 4 | Combat, reactions and repair | — |
| 5 | Market, trade routes, missions, pirates and the uncertain ending | — |

### Stage 1: Map Lab

- **Hex board:** every space is a hex tile. Ships move to any tile that shares an edge with theirs. Tile types:
  - home sector, key planet, space station, trade node, lane intersection (choke point), open space;
  - **asteroid field**: costs 2 movement to enter;
  - **nebula**: 1 damage to a ship entering it;
  - **void rift**: impassable.
- **Seeds:** type any seed (or press *Random seed*) and choose 2–6 players. The URL updates to `#seed=…&players=…`, so *Copy share link* reproduces the same board exactly.
- **Generation** follows the six steps in DESIGN.md, adapted to hexes:
  - Homes sit on the rim, with the galactic core in the centre. At 5–6 players, 1–2 more contested key planets sit next to the core.
  - Terrain is scattered in one player's wedge and copied into every wedge: exact hex rotations at 2, 3 and 6 players, the board's two mirror reflections at 4, and snapped 72° rotations at 5.
  - Pockets cut off from the rest of the board become void.
- **Fairness checks**, measured in movement cost:
  - the board is fully connected;
  - every home has 2+ open exits;
  - every home is equally far from its nearest key planet and its nearest station;
  - the core is within ±1 move of being equidistant from every home;
  - there are 2 × players + 1 trade nodes;
  - choke-point intersections carry at least 1.5× the average share of shortest paths.

  A candidate that fails any check is discarded. The Map Lab lists rejected attempts and lets you open each one to see the failure.
- **Zoom and details:** zoom with *+ / −* (also the keyboard, or the scroll wheel). Zoom always steps between whole-number pixel scales so the art stays sharp. *Fit* (or `0`) shows the whole board, and dragging pans. Click any tile to open its details pane, which shows:
  - its effect;
  - movement cost;
  - Command Points and VP value;
  - control;
  - moves from each home;
  - any hidden contents or pirates on it;
  - its neighbouring tiles (click one to open it).

## Layout

```
src/rng.js              seeded RNG (mulberry32) + readable seeds
src/map/generator.js    map generation steps 1–6
src/map/fairness.js     independent fairness checks
src/map/hex.js          axial hex maths, rotations, pixel <-> tile
src/map/graph.js        BFS, Dijkstra, components, betweenness
src/render/sprites.js   pixel-art hex tiles and sprites (procedural + hand-drawn)
src/render/board.js     canvas hex board: integer zoom, pan, hit testing, crisp text
src/ui/                 screens (Map Lab)
tests/                  node --test suites
```
