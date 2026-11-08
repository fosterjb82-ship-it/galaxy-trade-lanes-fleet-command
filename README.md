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
| 4 | Combat, reactions and repair | ✅ |
| 5 | Market, trade routes, missions, pirates and the uncertain ending | ✅ Full game |

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

### Stage 4: Combat, reactions and repair

- **Attack cards:** pick one of your armed ships, then a target. Every option shows the exact damage and the hull it leaves, e.g. "Bo frigate 4/4: 4 dmg (destroyed)". There are no dice.
- **Damage** = weapon + Attack card bonus − shields − armor (− 2 for Evasive Maneuvers):
  - **Lasers** suffer shields in full.
  - **Cannons** ignore up to 2 points of shields.
  - **Missiles** reach adjacent tiles but are stopped by point defense.
  - **Ion** weapons deal no damage; they disable the target so it can't move or attack on its owner's next turn.
- **Firing limits:** each ship fires at most once per turn, and unarmed ships (freighter, carrier) can't attack.
- **Kills:** destroying a ship (pirates included) scores 1 VP immediately. The wreck's card and upgrades go back to its owner's discard pile.
- **Reactions:**
  - Cards kept at the end of your turn become a face-down reserve. Opponents only see the count ("Held").
  - When you're attacked and hold cards, the game hands the device to you with a private prompt: play one reaction or take the hit. Only one reaction is allowed per attack.
  - The reactions are Return Fire, Evasive Maneuvers (fighters and frigates), Point Defense, Emergency Shields (+3) and Retreat (choose a neighbouring tile).
  - **Ambush** triggers when an enemy moves onto your tile: one of your ships there hits it first.
  - The combat report is then shown to everyone and the device goes back to the attacker.
- **Repairs:**
  - Repair (+2 hull) and Field Repairs (+4) cards work on any of your ships.
  - At the start of your turn, ships at a station you control repair fully, and ships sharing a tile with your carrier repair 2.

### Stage 5: Market, trade, missions, pirates and the ending

- **Market Row:**
  - 6 face-up cards drawn from a shuffled 61-card market deck. A bought card is replaced immediately, and there is no paying to clear the row.
  - The deck holds the 12 upgrades, Focused Strike (Attack +2), Full Burn (Move +1 speed), Trade Contract (+2), Smuggler's Cache (+3, then discard a card), Refit Dock (scrap a card for good), Repair and Field Repairs, all 6 reactions, and the rare ships (Missile Corvette, Interceptor, Blockade Runner, Carrier).
  - Ship cards cost 1 less with a station.
- **Upgrades:**
  - Fit an upgrade to one of your ships anywhere on the board.
  - Each uses a slot, duplicates aren't allowed, and some are restricted to certain ships (Heavy Cannon, Cargo Pod, Laser Battery).
  - Effects feed straight into movement and the combat preview. Upgrades return to the discard pile with a destroyed ship.
- **Trade routes:**
  - A freighter or blockade runner on a trade node can set up a route to another trade node up to 8 jumps away, along the shortest open path. The route is drawn on the board in your colour.
  - The ship must stay on the route's path, or the route closes.
  - Income arrives at the start of your turn: +1, or +2 for routes of 3+ jumps, and +1 more with a Cargo Pod.
  - Any enemy ship or pirate on the path is a blockade, and that route pays nothing.
- **Trade agreements:**
  - Offer one to a player who also runs a route. The game hands them the device to accept or decline in private.
  - While both players run a route, each gets +1 credit per turn and 1 VP per round.
  - Either player can break it on their own turn for a one-time 2 credits.
- **Secret missions:**
  - All 18 from the design. Everyone is dealt 3 and keeps 2 on their first turn.
  - Your sidebar shows their progress, which is private.
  - Immediate missions are revealed with a public announcement the moment they're done. End-of-game missions are revealed at final scoring.
  - Diplomat and Backstabber are left out of 2-player games.
- **Pirate phase (end of each round):** each pirate fleet moves 1 tile toward the nearest freighter or blockade runner, then attacks a player ship on its tile, preferring traders.
- **Uncertain ending:**
  - After round 7 there is a 1 in 3 chance the game ends; after rounds 8 and 9, 1 in 2; round 10 always ends it.
  - The round summary shows the roll, with an "Imperial Ceasefire" alert when the war ends.
  - A *Quick test* game length (end after round 3 or 4) lets you see the ending fast.
- **Final scoring:**
  - End-of-game missions are revealed and scored.
  - Players are ranked on VP, then most key planets controlled, then most ships on the board.
  - The results show each player's VP from planets, trade, kills and missions.

### Art and animation polish

- **Ambient motion** (the board redraws only about 8 times a second for it):
  - Planets turn: continents and polar caps drift across rocky worlds, and a storm rotates on the gas-giant core.
  - Station lights chase around the ring, jump gates turn and pulse, and trade beacons blink.
  - Nebulas shimmer, hidden tiles churn, and void rifts sparkle.
  - Stars twinkle, ship engines flicker, and ships hover by a pixel.
- **Event animations:**
  - The engine records each action's visual events (`state.fx`); `src/render/fx.js` plays them back in order.
  - Ships fly along their path, and Retreat and pirate moves animate too.
  - Weapons: laser beams, cannon shells with tracers, arcing missiles with smoke trails, and ion lightning.
  - Hits show impact sparks, a white flash and a floating damage number.
  - Destroyed ships explode in pixel debris with screen shake; their sprite stays until the explosion.
  - Deploys warp in. Repairs, hidden-tile reveals and trade income each have their own effect.
  - Dialogs (combat report, mission reveal, round summary) wait until the effects finish.
  - Start-of-turn repairs and income play once the next player reveals their hand.
- **Interface motion:** cards deal into your hand, dialogs and handoff screens rise in, and the Imperial Ceasefire banner shines.
- **Rendering rules:** every effect is pixel art on the whole-pixel grid, and numbers stay as sharp text. Screen shake moves by whole art pixels so the grid never blurs.
- **Toggle:** an *Animations* switch in the top bar turns everything off. It defaults to off when the system asks for reduced motion.

## Rules decided where the design was silent or didn't fit the hex board

- Control needs ships present (your empty home stays yours). Pirates block control but never hold it.
- Ships stop when they enter a tile holding enemy ships or pirates.
- Nebulas deal 1 damage on entry. Hidden tiles reveal when a ship ends its move on them.
- Any 2 cards can be kept at the end of a turn. They form a hidden reserve, and only reaction cards in it can be played.
- Each ship fires once per turn. Pirate kills score 1 VP. Cannons ignore 2 shield points.
- Reaction prompts only appear when the defender holds reserve cards (the count is public).
- Trade routes are paths between two trade nodes that the trader ship must stay on. Agreements need both players to run a route.
- Defenders get no reaction prompt against pirate attacks, because the pirate phase runs automatically.

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
src/game/cards.js       card definitions, starting deck, market deck
src/game/state.js       game state, control, CP, turn flow, actions
src/game/movement.js    movement range and paths on the hex board
src/game/combat.js      ship stats, upgrades, damage maths, range, attack options
src/game/trade.js       trade routes, blockades, agreements
src/game/missions.js    the 18 secret missions and their progress
src/game/pirates.js     end-of-round pirate phase
src/render/units.js     ships, control outlines and deploy targets on the board
src/render/fx.js        effects player: moves, shots, explosions, warp-ins, floating numbers
src/ui/                 screens: setup, game, Map Lab; cards; details pane
tests/                  node --test suites
```
