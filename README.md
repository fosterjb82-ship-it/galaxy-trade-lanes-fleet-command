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
| 2 | Core game state: decks, hands, ships on the board, Command Points | ✅ |
| 3 | Turn flow: draw, play, buy, end turn, end-of-round scoring | ✅ Hot-seat turns |
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

### Stage 2: Core game state

- **Setup screen:** pick 2–6 players, name them and choose a map seed. The game saves to this browser automatically; *Continue* resumes it.
- **Decks and hands:**
  - Everyone starts with the same 10 cards: Fighter, 4 × Credits, 3 × Move, 2 × Attack.
  - Everyone draws 5 cards, and the Fighter is always in the opening hand.
  - When a deck runs out, the discard pile is shuffled to form a new one.
- **Ships on the board:**
  - Playing a Ship card highlights every tile where you may deploy: tiles you control, plus your carrier's tile. Click one to deploy.
  - The card leaves your hand and stays with the ship until the ship is destroyed.
  - Ships are drawn on their tiles with hull badges, and each tile's details pane lists the ships on it.
- **Control:**
  - A player with the only ships on a tile controls it.
  - When several players have ships there, the highest total hull wins; a tie means nobody controls it.
  - An empty home stays with its owner.
  - Pirates never control tiles, but they can stop others from controlling them.
  - Controlled tiles are outlined in the controller's colour.
- **Command Points:** capacity comes from your home (6), each key planet (2) and each station (2). The sidebar shows a meter and where your capacity comes from. Deploying over capacity is refused with the reason. Losing territory never removes ships, but it blocks new deploys until you are back under capacity.

The engine (`src/game/`) is a pure, JSON-serialisable state that only changes through `applyAction()`, which validates every action.

### Stage 3: Turn flow

- **Hot-seat handoff:** each turn starts on a "Pass the device to …" screen that hides the hand until that player confirms. The previous player's hand is never shown to the next player.
- **Play cards in any order:**
  - **Credits** add to your credits for this turn.
  - **Ship** cards deploy (see Stage 2).
  - **Move** cards move one ship up to its speed:
    - pick the ship, then a highlighted destination;
    - badges show the movement used, and hovering previews the path;
    - asteroid fields cost 2 and void is impassable;
    - ships must stop when they enter a tile with enemy ships or pirates (they can't fly through), so choke points can be held;
    - each nebula entered deals 1 damage, which can destroy the ship; its card returns to the discard pile.
  - **Attack** cards unlock in Stage 4.
- **Hidden tiles** are revealed when a ship ends its move there:
  - a derelict gives +2 credits;
  - a bonus cache draws 1 card;
  - a pirate nest spawns a pirate fleet.
- **Shipyard:** buy a Fighter, Freighter, Frigate or Destroyer at any point in your turn, as many as you can afford. Bought cards go to your discard pile. Ships cost 1 less while you control a station.
- **End turn:**
  - unspent credits are lost (the dialog warns you);
  - choose up to 2 cards to keep;
  - the rest of your hand and your played cards are discarded, and you draw back up to 5.
- **End of round:** each controlled key planet scores 2 VP, a round summary is shown, and the first player rotates. The pirate phase, trade agreements and the uncertain ending arrive in Stage 5.

## Layout

```
src/rng.js              seeded RNG (mulberry32) + readable seeds
src/map/generator.js    map generation steps 1–6
src/map/fairness.js     independent fairness checks
src/map/hex.js          axial hex maths, rotations, pixel <-> tile
src/map/graph.js        BFS, Dijkstra, components, betweenness
src/render/sprites.js   pixel-art hex tiles and sprites (procedural + hand-drawn)
src/render/board.js     canvas hex board: integer zoom, pan, hit testing, crisp text
src/game/ships.js       ship stats, CP costs, pirate fleets
src/game/cards.js       card definitions and the starting deck
src/game/state.js       game state, control, CP, turn flow, actions
src/game/movement.js    movement range and paths on the hex board
src/render/units.js     ships, control outlines and deploy targets on the board
src/ui/                 screens: setup, game, Map Lab; cards; details pane
tests/                  node --test suites
```
