# Galaxy Trade Lanes: Fleet Command

Browser prototype of the 2–6 player deck-building space strategy game described in [DESIGN.md](DESIGN.md). Single player: you against 1–5 CPU opponents.

## Run it

```sh
npm start        # serves the game at http://localhost:8080
npm test         # runs the logic tests (Node 20+, no dependencies)
```

There is no build step: plain ES modules, no dependencies.

### Play it on GitHub Pages

The repo is set up to publish itself to GitHub Pages
(`.github/workflows/pages.yml`). Every push to `main` runs the tests and, if
they pass, deploys `index.html`, `styles.css` and `src/` to
`https://<owner>.github.io/galaxy-trade-lanes-fleet-command/`.

One-time setup: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. To redeploy without a push, run the workflow by hand from the
Actions tab.

All paths in the game are relative, so it works from the repo's subfolder.
Saved games live in the browser's local storage, per browser.

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
- **Zoom and details:** zoom with *+ / −* (also the keyboard, or the scroll wheel). Zoom moves in smooth 20% steps, and the art is redrawn at each size so it stays sharp. *Fit* (or `0`) shows the whole board, and dragging pans. Click any tile to open its details pane, which shows:
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
  - Playing a Ship card highlights every tile where you may deploy: planets and stations you control, plus your carrier's tile. Click one to deploy.
  - The card leaves your hand and stays with the ship until the ship is destroyed.
  - Ships are drawn on their tiles with hull badges, and each tile's details pane lists the ships on it.
- **Control:**
  - The player with the only ships on a tile, or the most total hull there, has the upper hand.
  - Homes, key planets, stations, trade nodes and intersections are *held*: once you have the upper hand you keep them after your ships leave, through ties and while pirates sit there, until another player has the upper hand. Homes start held by their owners.
  - Open space, asteroid fields and nebulas are only controlled while your ships are there.
  - Pirates never control tiles.
  - Controlled tiles are outlined in the controller's colour.
- **Command Points:** capacity comes from your home (6), each key planet (2) and each station (2). The sidebar shows a meter and where your capacity comes from. Deploying over capacity is refused with the reason. Losing territory never removes ships, but it blocks new deploys until you are back under capacity.

The engine (`src/game/`) is a pure, JSON-serialisable state that only changes through `applyAction()`, which validates every action.

### Stage 3: Turn flow

- **Turns:** originally hot-seat with "Pass the device" screens. The game is now single player against CPU opponents (see "You against the CPU" below).
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
  - A freighter or blockade runner on a trade node or planet (home or key planet) can set up a route up to 8 jumps away, along the shortest open path. One end must be a trade node: trade node to trade node, or trade node to planet. A ship sitting in its own home can't set up a route; it has to leave home first. The route is drawn on the board in your colour.
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
- **Pirate phase (end of each round, once pirates have arrived):** each pirate fleet moves 1 tile toward the nearest freighter or blockade runner, then attacks a player ship on its tile, preferring traders.
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
  - Stars twinkle, ship engines flicker, and ships hover gently.
- **Event animations:**
  - The engine records each action's visual events (`state.fx`); `src/render/fx.js` plays them back in order.
  - Ships fly along their path, and Retreat and pirate moves animate too.
  - Weapons: laser beams, cannon shells with tracers, arcing missiles with smoke trails, and ion lightning.
  - Hits show impact sparks, a white flash and a floating damage number.
  - Destroyed ships explode in a fireball with debris and screen shake; the wreck stays visible until the explosion.
  - Deploys warp in. Repairs, hidden-tile reveals and trade income each have their own effect.
  - Dialogs (combat report, mission reveal, round summary) wait until the effects finish.
  - Start-of-turn repairs and income play once the next player reveals their hand.
- **Interface motion:** cards deal into your hand, dialogs and handoff screens rise in, and the Imperial Ceasefire banner shines.
- **Rendering:** effects are glowing vector shapes (beams, tracers, smoke trails, fireballs, warp rings), and numbers stay as sharp text.
- **Toggle:** an *Animations* switch in the top bar turns everything off. It defaults to off when the system asks for reduced motion.

### High-resolution art

All artwork is drawn procedurally at the exact device-pixel size it is shown at (`src/render/art/`). It stays sharp at every zoom level and on high-DPI screens:

- **Planets** are shaded spheres mapped from seamless noise textures: continents, oceans with a sun glint, polar ice, drifting clouds, atmosphere glow and rings. The six looks are a terran world for each home, jungle, rust (cratered), ice, violet, and a banded gas giant for the core. They turn slowly.
- **Ships** are vector illustrations: metallic hulls, panel lines, glass cockpits, turrets, missile pods and flight decks. Each has player-colour trim and flickering engine flames. Pirates have gunmetal hulls, red trim and spikes.
- **Tiles** are smooth hexes with starfields and bevelled rims. Nebulas are soft, shifting clouds. Asteroid fields hold shaded rocks with craters. Void rifts have glowing cracks.
- **Features:** ring stations with docking arms and a gold hub, turning jump gates, solar-panel trade beacons and swirling hidden anomalies.
- **Card icons** are drawn the same way.

Images are cached by key, size and animation frame. Text, numbers, outlines and effects are drawn as vectors at native resolution.

### The card table, ship details and illustrations

- **Card table:** the Shipyard and the Market Row sit on a table beside the map as illustrated cards. Prices are on gold coins, the market deck shows how many cards are left, and unaffordable cards are dimmed. Clicking a card shows it large with its full text and a **Buy** button.
- **Always-on economy:** the Shipyard always sells a Credits card (+1) for 2, so the economy never stalls when no credit card comes up in the market.
- **Every card is illustrated:** each of the 30 cards has its own scene built from the game's art, and so does each of the 18 missions. Illustrations show on the table, in your hand, in the card inspector, in the mission draft, in the sidebar and on mission reveals.
- **Ship details:** click any ship on the board (or in a tile's ship list or your fleet list). The details pane shows:
  - large artwork, the owner and a hull bar;
  - effective speed, weapons, shields and armor (upgrades included), plus CP and other systems;
  - its status (ion-disabled, already fired), location and trade route;
  - every upgrade slot, filled with the fitted card or marked empty. On your turn, upgrades in your hand that fit can be fitted from there.

### Opening balance

Changes after playtesting, to soften the opening and stop early rushes:

- **Held territory:** planets, stations, homes, trade nodes and intersections stay yours after your ships move on, until an enemy takes them. One fighter can claim tiles one after another instead of sitting on each.
- **Pirates arrive later:** see "Faster start and combat close-ups" below.
- **Bigger maps:** one more ring of hexes at every player count. Radius 5 for 2 players, 6 for 3–4 players and 7 for 5–6 players. Homes sit 5–8 moves from the galactic core.
- **Home defences:** any enemy ship (or pirate) that ends a move in someone's home sector takes 2 damage. A lone fighter is shot down, so taking a home needs a real fleet.

### Hover tooltips

Rest the pointer on something for **1 second** to see a magnified picture with its details and the rules behind it. Moving off, clicking, scrolling or pressing a key hides it again.

- **Cards** (hand, table, dialogs, upgrade slots): illustration, cost, type, ship stats, restrictions, and how the card works in play (damage maths, reaction timing, slot rules…).
- **Missions:** illustration, VP, timing, how scoring works, and your progress if it is one of yours.
- **Tiles** (board, Map Lab, neighbour lists, CP sources): movement cost, CP and VP value, who controls it, ships present, hidden-tile and terrain rules.
- **Ships** (board, ship lists, fleet list): artwork, hull, speed, weapons, shields, armor, CP, fitted upgrades, status and repair rules (pirate behaviour for pirate fleets).

### Playtest fixes and sound

- **Intersection tolls:** each lane intersection you control pays +1 credit at the start of your turn (DESIGN.md's optional toll). The start-of-turn message lists it, and a "+1 cr" floats over each intersection.
- **Trade routes to planets:** routes can now run from a trade node to a home or key planet, as well as between trade nodes.
- **Deploying:** ships deploy only at planets (your home, key planets) and stations you control, plus at your carriers. Trade nodes, intersections and open space are no longer deploy points.
- **Tooltips** appear after 1 second.
- **Music and sound effects**, generated live with the Web Audio API (no audio files):
  - slow generative ambient music: pads, sub bass, a sparse echoing arpeggio and distant bells, cycling through three chord progressions;
  - effects for engines, each weapon (laser, cannon, missile, ion), hits and shields, explosions, warp-ins, repairs, reveals, income, buying and playing cards, turn handoffs, round scoring, missions, victory, errors and button clicks.
  - The **🔊 Sound** button (top bar, and top-right of the setup screen) turns sound on or off and sets music and effects volume separately. It stays usable over dialogs, and the settings are remembered.
  - Browsers only allow audio after you interact with the page, so the music starts on your first click.

### Faster start and combat close-ups

- **Starting freighter:** every player starts with a freighter already at home, so trade can begin on turn 1. Its card isn't in your deck; if the freighter is destroyed, the card goes to your discard pile like any other ship.
- **Pirates arrive in round 3 or 4:** there are no pirates at the start. Each game rolls whether they arrive at the start of round 3 or 4 (round 2 in quick games).
  - **Warning:** for the whole round before, the tiles where they'll appear pulse red with a ☠ PIRATES marker. The round summary announces it, and the tile tooltip says so too.
  - **Arrival:** at the end of that round, the pirates warp in (one fleet per pirate spot on the map: 2–4 by player count). They hunt from the end of the following round.
  - Pirate nests in hidden tiles still spawn pirates when revealed.
- **Scout the market:** a face-down card at the end of the market row.
  - Once per turn, for free, click it to flip the top card of the market deck. It opens straight away so you can buy it at its normal price.
  - If you don't buy it this turn, it goes to the bottom of the deck when your turn ends.
- **Credits pay themselves:** buying a card plays the Credit cards in your hand that you need, picking the set that wastes the fewest credits. The buy dialog says which cards it will use, and card prices count the credits still in your hand.
  - Smuggler's Cache is never played automatically, because it needs you to choose a discard.
  - **Play all credits** (next to your credits on the table) plays every other Credit card at once.
- **Targeting on the board:** when you attack, every ship in range gets a spinning red target marker. A ship alone on its tile also shows the damage it would take (☠ when the shot would destroy it). On crowded tiles the damage shows on the ship you point at.
  - Pointing at a target draws an aim line from your ship and opens a preview: hull before and after, with the hull you'd remove flashing, a DESTROY badge for kills, the damage maths for each weapon, and a note if the defender holds reaction cards.
  - Click the target to fire. With more than one weapon, it uses the best one; the bar above the map still lists every option.
- **Hull bars and smoke:** ships show a segmented hull bar under them (and the number when zoomed in close). Ships at half hull or less trail smoke.
- **Battle close-ups:** attacks and reactions play as a short side-on scene. Ships slide in, any reaction card flips in, shots fly (laser bolts, cannon slugs, arcing missiles, ion arcs), shields shimmer when they soak damage, hull bars drain and destroyed ships explode.
  - The result (−2, BLOCKED, EVADED, ION, DESTROYED) stays on screen with the combat log. Click, Space or Enter skips; Continue moves on.
  - **Battles** in the top bar picks *Close-up*, *Close-up on kills* or *Board only*, which keeps the old on-board effects and report.

### Routes, blocking and buying in bulk

- **Leave home first:** a freighter or blockade runner sitting in its own home sector can't set up a trade route. Routes can still end at your home, and an enemy home works as a starting point.
- **Ships you don't control block movement:** this rule was already in the engine. While choosing a move, any tile in range holding ships you don't control (another player's or pirates) gets an amber dashed outline and a ✋ badge. You can stop there, but you can't fly through it, so tiles beyond it are only reachable by another way round.
- **Buy several copies:** Shipyard cards (Credits and the four basic ships) have a − / + copies selector in the buy dialog, up to what you can afford with your credits and the Credit cards in hand. Market row and scouted cards are single cards, so they stay one at a time.

### Pickers, routes from the ship, deck viewer

- **Graphic ship pickers:** when several ships could move, fire or take an upgrade, or there are several targets, the bar above the map shows ship tiles instead of names.
  - Each tile has the ship's art, owner, hull bar, fitted upgrades and a line of detail: speed for moves, weapons for attackers, slots for upgrades.
  - For targets, the tile shows the damage maths, the hull it would lose (flashing) and a −N / DESTROY / ION badge.
  - Pointing at a tile highlights that ship on the board.
- **Trade routes from the ship:** click a freighter or blockade runner to see its route in its details pane.
  - On your turn the pane lists every destination it can run to, with jumps and income. Pointing at one draws the route on the map; clicking sets it up or replaces the old one.
  - If it can't start a route where it is, the pane says why. After you move a trader onto a tile where it can start a route, its pane opens on its own.
- **Deck viewer:** click the Deck or Discard pile next to your hand to see every card you own: draw pile, hand, reserve, played this turn, discard pile, and the ship and upgrade cards on the board, grouped with counts.
- **Pirates and reactions:** see "Rules decided" below. If a pirate hit would destroy your ship, a Retreat, Emergency Shields or Evasive Maneuvers card in your reserve is played for you.
- **Active routes score at the end:** at final scoring, each trade route still running (not blockaded) is worth 1 VP. The final table's Trade column adds it to agreement VP.

### You against the CPU

The game is now single player: you against 1–5 CPU opponents. There is no hot-seat play.

- **Setup:** enter your name and pick 1–5 opponents (Admiral Vex, Commander Orla, Captain Rusk, Warden Sela, Marshal Toren), the map seed and the game length. The CPUs choose their secret missions straight away.
- **Your turn:** your hand is always visible. The turn chips in the top bar mark you with ★ and highlight whoever is playing.
- **CPU turns:** these play automatically, one animated action at a time. A short message says what each CPU did, and your hand stays on screen, dimmed, for your next turn.
  - You can still click tiles and ships to inspect them.
  - **⚙ Options → CPU speed** sets the pace: Slow, Normal or Fast.
- **Answering CPUs:** when a CPU attacks one of your ships and you hold reaction cards, the reaction dialog opens for you straight away. When a CPU moves onto your ships, you get the Ambush prompt. When a CPU offers a trade agreement, you accept or decline.
- **CPUs answering you:** when you attack a CPU, offer it a deal or move onto its ships, it answers at once.
- **Battle close-ups** play for fights involving your ships. Fights between CPUs (or against pirates) show on the board only.
- **⚙ Options** also holds the Animations switch and the battle close-up setting.
- **How the CPU plays** (`src/game/ai.js`): it decides one action at a time using rules of thumb, not a search.
  - It deploys ships, fits upgrades and repairs, and fires at the best target in range, kills first.
  - It sets up trade routes first: freighters without a route move before anything else. Warships head for key planets, stations, intersections and weaker enemies, and avoid enemy home defences.
  - It scouts the market, buys what helps most (ships within its Command Points, Trade Contracts, fitting upgrades), offers trade agreements to players who aren't far ahead, and keeps reaction cards at the end of its turn.
  - It plays reactions sensibly when attacked: Point Defense against missiles, Retreat, Shields or Evasive against lethal hits, Return Fire otherwise.
  - CPU-only test games run to the end at every player count.
- **Every reaction works against pirates** (played for you automatically):
  - Ambush when a pirate moves onto your armed ship's tile;
  - Retreat, Emergency Shields or Evasive Maneuvers when a hit would destroy your ship;
  - Return Fire after a hit your ship survives.
  - Point Defense never applies, because pirates fire lasers.

## Rules decided where the design was silent or didn't fit the hex board

- Holdable tiles (homes, planets, stations, trade nodes, intersections) stay with their holder until an enemy has the upper hand there; open space needs ships present. Pirates never hold tiles.
- Ships stop when they enter a tile holding enemy ships or pirates.
- Nebulas deal 1 damage on entry. Hidden tiles reveal when a ship ends its move on them.
- Any 2 cards can be kept at the end of a turn. They form a hidden reserve, and only reaction cards in it can be played.
- Each ship fires once per turn. Pirate kills score 1 VP. Cannons ignore 2 shield points.
- Reaction prompts only appear when the defender holds reserve cards (the count is public).
- Trade routes are paths from a trade node to another trade node or a planet, and the trader ship must stay on them. Agreements need both players to run a route.
- Defenders get no reaction prompt against pirate attacks, because the pirate phase runs automatically. Instead, reactions are played automatically: Ambush when a pirate arrives, Retreat / Emergency Shields / Evasive Maneuvers (whichever saves the ship) against a lethal hit, and Return Fire after a hit the ship survives. Retreat goes to a safe neighbouring tile, staying on the ship's trade route if it can.

## Layout

```
src/rng.js              seeded RNG (mulberry32) + readable seeds
src/map/generator.js    map generation steps 1–6
src/map/fairness.js     independent fairness checks
src/map/hex.js          axial hex maths, rotations, pixel <-> tile
src/map/graph.js        BFS, Dijkstra, components, betweenness
src/render/sprites.js   art facade: any image by key at an exact pixel size, cached
src/render/art/         high-res procedural art: planets, ships, tiles, features, icons, card and mission scenes
src/render/board.js     canvas hex board: smooth zoom, pan, hit testing, crisp text
src/game/ships.js       ship stats, CP costs, pirate fleets
src/game/cards.js       card definitions, starting deck, market deck
src/game/state.js       game state, control, CP, turn flow, actions
src/game/movement.js    movement range and paths on the hex board
src/game/combat.js      ship stats, upgrades, damage maths, range, attack options
src/game/trade.js       trade routes, blockades, agreements
src/game/missions.js    the 18 secret missions and their progress
src/game/pirates.js     end-of-round pirate phase
src/game/ai.js          CPU opponents: one action at a time, plus answers to attacks and offers
src/render/units.js     ships, control outlines and deploy targets on the board
src/render/fx.js        effects player: moves, shots, explosions, warp-ins, floating numbers
src/audio/sound.js      synthesised music and sound effects, volume settings
src/ui/                 screens: setup, game, Map Lab; cards; details pane; hover tooltips; sound menu
tests/                  node --test suites
```
