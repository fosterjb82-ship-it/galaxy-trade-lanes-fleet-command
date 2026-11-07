# Galaxy Trade Lanes: Fleet Command — Game Design Document

Nov 7, 2026 · @Justin Foster

## Overview

Fleet Command is a 2–6 player, sequential-turn space strategy game that combines a generated map board with deck-building. It is the combat-focused companion to Galaxy Trade Lanes: Cargo & Credits.

- **Platform:** desktop browser first; a locally installed (Steam) build later.
- **Players:** 2–6, all starting with the same deck.
- **Win condition:** most victory points (VP) when the game ends, with an uncertain final round.

**Core loop:** draw a hand of 5, play Ship, Move, Attack, Upgrade and Credit cards, spend credits on new cards and ships, then score VP for territory, kills, trade agreements and secret missions.

**Design pillars**

- **Fleet command:** you have more ships than orders, so choosing which ships act each turn is the core decision.
- **Predictable combat:** fixed weapon damage; skill is in setting up the right fight, not luck.
- **Many paths to victory:** fighters, traders and territory holders can all win.
- **Bluffing and tension:** secret missions and held reaction cards keep everyone engaged off-turn.
- **Losses cost tempo, not elimination:** destroyed ships return to your discard pile.

## Victory and game end

The player with the most VP when the game ends wins. The game runs at least 7 rounds and at most 10, and players never know exactly which round is last.

**VP sources**

| Source | VP | When scored |
| --- | --- | --- |
| Controlled key planet | 2 per planet | End of each round |
| Active trade agreement (with another player) | 1 per agreement | End of each round |
| Enemy ship destroyed | 1 per ship | Immediately |
| Immediate mission completed | 2–3 | When completed and revealed |
| End-of-game mission completed | 2–4 | Final scoring |

**Uncertain ending** (checked at the end of each round)

| After round | Chance the game ends |
| --- | --- |
| 1–6 | 0% |
| 7 | 1 in 3 |
| 8 | 1 in 2 |
| 9 | 1 in 2 (to be tuned) |
| 10 | Always ends |

The digital version presents the end roll dramatically, e.g. an "Imperial Ceasefire" alert.

**Final scoring**

1. Total VP from round scoring, kills and immediate missions.
2. Reveal and score end-of-game missions.
3. Tiebreakers: most key planets controlled, then most ships on the board.

## Map

Every game uses a newly generated map of nodes connected by lanes, with fixed guarantees that keep it fair. Ships move along lanes from node to node.

**Node types**

| Node | Effect |
| --- | --- |
| Home sector | Each player's starting point; ships can deploy here |
| Key planet | 2 VP per round to its controller |
| Lane intersection | Crossroads and choke point; possible toll income |
| Space station | Deploy ships here, ships cost 1 less to buy, full repair for ships starting a turn here |
| Trade node | Endpoints for trade routes |
| Empty / hidden | Plain space, or revealed when a ship arrives (derelict, pirate nest, bonus) |

**Control:** a player with the only ships at a node controls it. If several players have ships there, the player with the highest total hull controls it. A tie means nobody controls the node.

**Guarantees for every map**

- **Fair homes:** every home sector is the same number of jumps from its nearest key planet and nearest station.
- **Contested center:** at least one high-value key planet roughly equidistant from all players; 2–3 contested key planets at 5–6 players.
- **Trade nodes scale:** about 2 per player plus 1.
- **No dead-end homes:** every home sector has at least 2 exit lanes.
- **Choke points:** a few intersections that sit on many shortest paths.
- **Fully connected:** every node can reach every other node.

**Generation steps**

1. Place home sectors evenly around the edge.
2. Place the central key planet(s).
3. Scatter the remaining nodes with minimum spacing.
4. Connect each node to its 2–3 nearest neighbors, then add lanes until everything is connected.
5. Assign node types following the guarantees.
6. Run the fairness checks; if any fail, discard and regenerate.

**Extras**

- **Hazard lanes** (asteroid fields, nebulas) cost extra movement or deal damage.
- **Hidden nodes** are revealed when a ship arrives.
- **Shareable map seeds** let players replay or share a specific map.
- **Neutral pirate fleets** start on the map as early targets.

## Turn structure

Turns are sequential. A round is every player taking one turn, and the first player rotates each round.

**A player's turn**

1. **Start of turn**
   - Collect trade route income as bonus credits for this turn.
   - Ships starting at a controlled station repair fully; ships at your carrier's node repair 2 hull.
   - Disabled ships (from ion attacks) recover.
   - Repair Drones trigger.
2. **Action phase** — play cards in any order:
   - Deploy ships, Move, Attack, play Upgrades and Credits.
   - Buy from the Shipyard or Market Row at any point in this phase.
   - Opponents may answer your attacks with reaction cards.
   - Reveal and score immediate missions as soon as they are completed.
3. **End of turn**
   - Unspent credits are lost.
   - Keep up to 2 cards as reactions; discard the rest of your hand.
   - Draw back up to 5 cards (holding 2 reactions means drawing only 3).

**End of round**

1. **Scoring:** VP for each controlled key planet and each active trade agreement.
2. **Pirate phase:** neutral pirate fleets move 1 node toward the nearest freighter and attack.
3. **End check:** roll for the uncertain ending (see Victory and game end).

At 6 players, waiting time is a risk. Options to test: a turn timer, or a cap on cards played per turn.

## Deck and cards

Every player starts with the same 10-card deck and a hand size of 5. Factions and commanders with different starting cards are saved for expansions.

**Starting deck**

| Card | Count | Effect |
| --- | --- | --- |
| Fighter (ship) | 1 | Deploy a fighter to the board |
| Credits | 4 | +1 credit each |
| Move | 3 | Move one ship up to its speed |
| Attack | 2 | One ship fires its weapons |

The fighter is always in each player's opening hand, so no one starts with nothing to move.

**Card types**

- **Ship:** deploys a ship at any node you control.
- **Command:** Move, Attack and similar orders.
- **Credit:** money for buying cards and ships.
- **Upgrade:** attaches to a ship on the board.
- **Reaction:** played on an opponent's turn in response to an attack.
- **Utility:** repairs, scrapping and other effects.

**How ships cycle**

1. A bought ship card goes to your discard pile.
2. When drawn and played, the ship deploys to the board and leaves your hand. Your deck gets thinner as your fleet grows.
3. When a ship is destroyed, its card returns to your discard pile, along with any attached upgrade cards. The attacker scores 1 VP.

Losing a ship costs tempo, not the ship itself, so no one is eliminated early.

## Market

Players buy from two shops during their action phase: a fixed Shipyard and a random Market Row of 6 cards.

- **Shipyard (always available):** Fighter, Freighter, Frigate, Destroyer.
- **Market Row:** 6 face-up cards from a shuffled market deck (upgrades, better commands, reactions, credit cards, rare ships). A bought card is replaced immediately. There is no way to pay to clear the row.

**Buying rules**

- Play Credit cards and add route income; spend the total on any number of affordable cards.
- Unspent credits are lost at end of turn.
- Bought cards go to your discard pile.
- Ships cost 1 less if you control a station.

**Better credit cards (examples)**

| Card | Effect |
| --- | --- |
| Trade Contract | +2 credits |
| Smuggler's Cache | +3 credits, discard a card |

**Scrapping:** permanently removing a card from your deck is only possible through cards that allow it, e.g. Refit Dock (scrap 1 card from your hand). Thinning out basic Credits and weak cards is a key upgrade path.

## Ships

Eight ship types trade speed against power: nothing is fast, tough and strong at once. All numbers are first-pass values for playtesting.

| Ship | Source | Cost | Speed | Weapon | Hull | Slots | Special |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fighter | Shipyard | 2 | 3 | Laser 1 | 2 | 1 | Can use Evasive Maneuvers |
| Freighter | Shipyard | 3 | 2 | — | 3 | 2 | Sets up trade routes |
| Frigate | Shipyard | 4 | 2 | Laser 2 | 4 | 2 | Can use Evasive Maneuvers |
| Destroyer | Shipyard | 6 | 1 | Cannon 4 | 6 | 3 | Armor 1 built in |
| Missile Corvette | Market | 4 | 2 | Missile 2 (range 1) | 3 | 1 | Hits adjacent nodes |
| Interceptor | Market | 5 | 3 | Ion (disable) | 3 | 1 | Freighter hunter |
| Blockade Runner | Market | 4 | 3 | Laser 1 | 3 | 2 | Sets up trade routes |
| Carrier | Market | 8 | 1 | — | 8 | 3 | Mobile deploy point; repairs 2 hull |

**Deployment:** a played ship card deploys at any node you control, including stations and your home sector, or at your carrier's node.

**Destruction:** at 0 hull the ship is removed; its card and attached upgrades go to its owner's discard pile, and the attacker scores 1 VP.

**Command Points (fleet limit)**

Each player has a Command Points (CP) capacity, earned from the nodes they control. Every ship on the board uses CP, and you can't deploy a ship that would take you over your capacity.

| CP source | Capacity |
| --- | --- |
| Home sector | 6 |
| Each controlled key planet | 2 |
| Each controlled station | 2 |

| Ship | CP cost |
| --- | --- |
| Fighter | 1 |
| Freighter | 1 |
| Frigate | 2 |
| Missile Corvette | 2 |
| Interceptor | 2 |
| Blockade Runner | 2 |
| Destroyer | 3 |
| Carrier | 4 |

- **Only deployed ships count.** Extra ship cards you can't deploy just clog your hand, which limits over-buying on its own.
- **Losing territory:** if your capacity drops below the CP your fleet uses, no ships are removed, but you can't deploy new ships until you're back under capacity.
- Taking an enemy's planet or station both grows your fleet and shrinks theirs.

## Combat

Combat uses fixed damage set by the weapon, so players can calculate exactly what an attack will do. Defenders respond with reaction cards rather than automatic return fire.

**Attacking**

1. Play an Attack card on one of your ships.
2. Target an enemy ship in the same node, or within the weapon's range.
3. Damage = weapon value + any bonus on the Attack card, reduced by the target's shields and armor.
4. Damage comes off hull; at 0 hull the ship is destroyed.

When several ships share a node, each Attack card fires one ship, so focusing fire versus spreading damage is a real choice.

**Weapons**

| Weapon | Damage | Range | Notes |
| --- | --- | --- | --- |
| Laser | Low (1–2) | 0 | Cheap; weak against shields |
| Cannon | High (3–4) | 0 | Expensive; punches through shields |
| Missile | Medium (2) | 1 | Can hit an adjacent node; stopped by point defense |
| Ion | None | 0 | Disables the target: no move or attack on its next turn |

**Defenses**

- **Shields:** absorb a fixed amount of damage per attack.
- **Armor:** reduces every hit by a fixed amount.

**Reaction cards**

At the end of your turn you may keep up to 2 cards to play as reactions on opponents' turns. A reaction is played after an attack is declared and before damage resolves. Only 1 reaction may be played per attack. Opponents can see how many cards you hold, but not which.

| Reaction | Effect |
| --- | --- |
| Return Fire | After damage resolves, if your ship survives, it hits back with its weapon |
| Evasive Maneuvers | Reduce incoming damage by 2 (fighters and frigates only) |
| Point Defense | Cancel one missile attack |
| Emergency Shields | +3 shields for this attack only |
| Retreat | Move the targeted ship 1 node away; the attack misses |
| Ambush (rare) | When an enemy moves into your node, deal damage before it can act |

**Repair**

Damage stays on a ship until it is repaired.

| Method | Repair |
| --- | --- |
| Repair card | 2 hull to one ship, anywhere |
| Field Repairs card (market) | 4 hull to one ship, anywhere |
| Start turn at a controlled station | Full repair, free |
| Start turn at your carrier's node | 2 hull |

## Upgrades

Upgrades are cards played onto a ship on the board. Each uses one slot and stays until the ship is destroyed, then returns to the discard pile with the ship.

| Upgrade | Type | Effect | Restriction |
| --- | --- | --- | --- |
| Laser Battery | Weapon | +1 laser damage | — |
| Heavy Cannon | Weapon | Weapon becomes Cannon 3 | Frigates and destroyers |
| Missile Rack | Weapon | Adds a Missile 2 (range 1) attack | — |
| Ion Emitter | Weapon | Adds an ion (disable) attack | — |
| Deflector Shields | Defense | Absorb 2 damage per attack | — |
| Armor Plating | Defense | Reduce each hit by 1 | — |
| Point Defense Grid | Defense | Missiles do nothing against this ship | — |
| Afterburners | Utility | +1 speed | — |
| Cargo Pod | Utility | Trade routes run by this ship pay +1 credit | Freighters and blockade runners |
| Cloaking Device | Utility | Can only be attacked from the same node | — |
| Targeting Computer | Utility | Ignore 1 point of enemy armor or shields | — |
| Repair Drones | Utility | Repair 1 hull at the start of each of your turns | — |

**Limits**

- A ship can't hold more upgrades than it has slots.
- No duplicate upgrades on the same ship.
- Upgrades can't move between ships unless a card allows it (e.g. a Refit market card).

## Trade and economy

Trade gives steady income each turn, paid as bonus credits at the start of your turn. Only player-to-player agreements give VP, so peaceful trading alone can't dominate the game.

| Source | Requirement | Reward |
| --- | --- | --- |
| Trade route | Freighter or blockade runner on a lane between two trade nodes | +1 credit per turn |
| Long trade route | Route of 3+ lanes | +2 credits per turn |
| Trade agreement | Two players agree to link a route (offer/accept prompt) | +1 credit per turn and 1 VP per round, each |
| Lane intersection (optional) | Control the intersection | +1 credit per turn |

**Breaking an agreement:** either player may break it on their own turn; the breaker gets a one-time bonus of 2 credits.

**Blockade:** an enemy ship on any lane of your route cuts off that route's income until it leaves.

## Mission cards

Each player is dealt 3 mission cards at the start, keeps 2 and keeps them secret until scored. Immediate missions score the moment they are completed; end-of-game missions are checked at final scoring.

| # | Mission | Type | Timing | VP | Requirement |
| --- | --- | --- | --- | --- | --- |
| 1 | Ace Squadron | Combat | Immediate | 3 | Destroy 3 enemy ships |
| 2 | Big Game Hunter | Combat | Immediate | 3 | Destroy an enemy destroyer or carrier |
| 3 | Pirate Purge | Combat | Immediate | 2 | Destroy 2 neutral pirate fleets |
| 4 | Freighter Raider | Combat | Immediate | 3 | Destroy 2 enemy freighters or blockade runners |
| 5 | Unbroken Line | Combat | End of game | 4 | Lose no more than 2 ships all game |
| 6 | Galactic Core | Territory | End of game | 4 | Control the central key planet |
| 7 | Twin Worlds | Territory | Immediate | 3 | Control 2 key planets at once |
| 8 | Crossroads Baron | Territory | End of game | 3 | Control 3 lane intersections |
| 9 | Station Network | Territory | End of game | 3 | Control 2 stations |
| 10 | Deep Strike | Territory | Immediate | 3 | Move a ship into an opponent's home sector and survive until your next turn |
| 11 | Trade Magnate | Economy | End of game | 4 | Have 3 active trade routes |
| 12 | Long Haul | Economy | Immediate | 2 | Set up a trade route 4+ lanes long |
| 13 | Diplomat | Economy | End of game | 3 | Have active trade agreements with 2 different players |
| 14 | War Chest | Economy | Immediate | 2 | Spend 12+ credits in a single turn |
| 15 | Merchant Fleet | Economy | End of game | 2 | Have 3 freighters or blockade runners on the board |
| 16 | Backstabber | Wildcard | Immediate | 3 | Break a trade agreement, then destroy one of that player's ships within your next turn |
| 17 | Armada | Wildcard | End of game | 3 | Have 6+ ships on the board |
| 18 | Fully Loaded | Wildcard | Immediate | 2 | Fill every upgrade slot on one ship |

Missions involving other players (Diplomat, Backstabber) are much easier at 6 players than at 2; remove or scale them for 2-player games.

## Open questions and notes

**Open questions**

- [ ] Command Points: tune capacity values and ship CP costs in playtesting.
- [ ] End roll after round 9: 1 in 2, or higher?
- [ ] Fewer rounds at 5–6 players to keep game length reasonable?
- [ ] Turn timer or card cap for 6-player games?
- [ ] Full market deck list and card counts.

**Balance notes**

- All costs, stats and VP values are first-pass numbers for playtesting.
- Two completed missions should roughly equal a few rounds of holding key planets.
- Watch that trade income doesn't let a peaceful player outscore everyone.

**Expansion ideas**

- Factions or commanders that swap 1–2 starting cards or add a passive ability.
- New ship types, upgrades and missions.

**Tech notes**

- Build for desktop browser first; wrap later as a desktop app for Steam (e.g. Electron or Tauri).
- Map generator should support shareable seeds and regenerate maps that fail fairness checks.
- Trade agreements need an offer/accept prompt between players.
