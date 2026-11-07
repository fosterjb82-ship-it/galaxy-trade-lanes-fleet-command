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

- **Seeds:** type any seed (or press *Random seed*) and choose 2–6 players. The URL updates to `#seed=…&players=…`, so *Copy share link* reproduces the same map exactly.
- **Generation** follows the six steps in DESIGN.md. Nodes are scattered with minimum spacing in one player's wedge, then mirrored into every other wedge with a small random jitter. Maps look random but come out close to symmetric, so few candidates fail.
- **Fairness checks:** fully connected; every home has 2+ exits; every home is the same number of jumps from its nearest key planet and from its nearest station; the galactic core is within ±1 jump of being equidistant from all homes (2–3 contested central planets at 5–6 players); 2 × players + 1 trade nodes; choke-point intersections sit on at least 1.5× the average share of shortest paths. A failed candidate is thrown away and the next attempt is generated from the same seed. The Map Lab lists the rejected attempts and lets you open each one to see which check failed.
- **Extras:** hazard lanes (asteroid fields, nebulas; never on a home's lanes), hidden nodes (derelict, pirate nest, bonus), and neutral pirate fleets placed 2+ jumps from every home.

## Rendering

Pixel art is used for images only: sprites and the starfield are drawn at whole-number scale with smoothing off. Text, numbers, lanes and rings are drawn at native device resolution (canvas sized by `devicePixelRatio`, plus HTML for panels), so they stay sharp on high-DPI screens.

## Layout

```
src/rng.js              seeded RNG (mulberry32) + readable seeds
src/map/generator.js    map generation steps 1–6
src/map/fairness.js     independent fairness checks
src/map/graph.js        BFS, components, betweenness, geometry
src/render/sprites.js   pixel-art sprites (procedural + hand-drawn)
src/render/board.js     canvas board: pan/zoom, hit testing, crisp text
src/ui/                 screens (Map Lab)
tests/                  node --test suites
```
