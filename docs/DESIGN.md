# Fantasy of Arcadia: design and production notes

This document explains what the project is trying to be, what has been decided and why, how the work is run, and what is next. It is written for someone judging the product and process, not the code (see [TECHNICAL.md](TECHNICAL.md) for that).

## Goal

Build a finished, polished 2D proof of concept that doubles as a design reference for any later rebuild. "Polished" means the rules, menus, tools and one complete slice of content feel good. It does not mean final art.

## What "complete 2D" means

Without a written definition, scope has no edge. The definition is three parts, built in this order:

1. **Zones.** An overworld (a zoomed-out map for travelling) with random encounters only; towns with no random encounters and possibly a static one; dungeons with both.
2. **Procedurally generated dungeons.** Each takes 10 to 15 minutes including fights. Each has 3 to 5 regular monster types plus rare, elite and boss monsters. Rare and elite monsters are static sub-bosses guarding the stairs down; the boss ends the dungeon. Target layout: 4 floors, 2 rare guards, 1 elite guard, 1 boss.
3. **Character progression.** Levels, abilities and items. It is last on purpose: it needs the most design thinking and does not depend on the first two parts.

**Difficulty targets** (relative to a regular monster): rare 35–50% harder, elite 75–100%, boss 125%. These are guidelines for hand-tuned stats for now; an automatic stat helper was considered and deferred until real play shows whether the numbers feel right.

**Towns.** Enterable buildings (inn, shop, hospital) whose interiors stay hidden until the player opens the door and steps in. Services are free for now, and gold exists as a reward but nothing costs it yet, so economy balance does not block building the functionality.

**Out of scope for this version:** training centers and recruiting, end-game content (damage tests, very hard bosses, leaderboards), battles with several monsters at once, and a full story campaign. A single story chapter may come once everything else is complete.

## Decision log

| Decision | Options considered | Choice and reason | Status |
|---|---|---|---|
| Combat model | Round-based; real-time (ATB) | Round-based, Final Fantasy 1 style. Real-time (ATB) combat is deferred. | Built |
| Random encounter pacing | Pure chance per step; a "bag" of tokens | A 15-token bag per zone (one fight token), reshuffled when empty. Roughly one fight per 15 steps without the streaks of pure chance. | Built |
| Content authoring | Edit code; build a tool | A data-driven editor, so design changes do not need code changes. | Built |
| Sharing content | A server the game writes to; a file in the repository | A JSON file committed to the repo and loaded as base content, with browser-local edits as an override. No server to run or keep online, and content is versioned with the code. | Built |
| Where content comes from | Silent override; visible source | The active source (repo file, local edits or built-in defaults) is shown on the title screen and in the editor, because an invisible override would make "why does it look different on my machine" hard to answer. | Built |
| Saving | Position and scene; party and inventory only | Party, inventory and gold only, by agreed scope; loading resumes at the town start. | Built |
| Autosave | Reuse a manual slot; its own slot | A dedicated autosave slot after each victory, load-only from the menu. A "Continue" button loads the newest of the autosave and manual slots. | Built |
| One sprite field per enemy | Separate battle and map art; one shared sprite | One sprite used for battle, town and dungeon. Simpler to author; can be split later if needed. | Built |
| Static encounter placement | Always on every map; per-encounter choice | An "appears on" setting per encounter. Simple now, and will become a list of real map ids when more maps exist. | Built |
| Town interiors | Always visible; hidden until entered | Hidden until the player opens the door, as in Final Fantasy 1. A room is revealed while the player is inside and hidden again when they leave. First pass is a cover over the interior on the same map; separate interior maps were not needed yet. | Built (one test room) |
| Training centers | In this version; later | Later. Not needed to prove the 2D game. | Deferred |
| Image upload for monster art | In this version; later | Later. A sprite picker over a licensed tile sheet covers the proof of concept, and uploads would bloat the shared content file. | Deferred |

## How the work is run

- **Checkpoints.** Each change is a small step with one purpose (for example: gold reward, then tier, then sprite, then map placement). Each is played and checked before the next starts.
- **Verify, then move on.** Where practical, logic is checked outside the game first, then the change is checked in the running game and the editor. Logic and content are covered by automated tests (`npm test`) and a content validator; scenes and menus are still checked by playing.
- **Bugs are written down.** Real examples:
  - *Loot that could not be equipped.* A weapon added to a loot table dropped but could not be equipped. Cause: drop entries lacked slot and bonus data. Fix: look the item up in the equipment list by name when it drops.
  - *Editor changes missing in a private window.* Content was stored per browser, so another browser saw defaults. This led to the export, import and repo-file pipeline above.
  - *Load froze after loading the autosave.* The likely cause was stale event listeners from earlier scene visits; the fix removes them on scene shutdown and closes the menu before announcing the load. Confirmed fixed in play.
- **Docs stay current.** Roadmap, known issues and decisions are updated at each step.

## The editor as a product

| | |
|---|---|
| Users | A designer changing game content (enemies, drops, zones, gear, characters) without a developer. |
| Jobs | Add or tune content; see the result quickly; share it; recover from mistakes. |
| What exists | Forms for five content types, an enemy sprite picker, export, import, reset to repo content, reset to defaults, a raw data view. |
| Safeguards | Import checks the file looks like game content and asks before replacing; old content is upgraded automatically on load; missing or broken content falls back to defaults instead of breaking the game. |
| Known gaps | No warning when a random enemy is not assigned to any zone; items are matched by name rather than id; equipment bonuses cannot raise speed. |

## Where things stand

| Step | State |
|---|---|
| Drop weights and autosave slot | Done |
| Content export, import and repo file | Done |
| Encounter fields: gold, tier, sprite, map placement | Done |
| Zones, doors and NPC as map data | Done |
| Hidden building interiors (one test room) | Done, being played |
| Part 1: zones | Planned |
| Part 2: procedural dungeons | Planned |
| Part 3: character progression | Planned |

## Risks and open questions

- Automated tests cover logic and content, not scenes, so scene and menu regressions are still caught by playing. Scene transitions and the menu overlay needed several rounds of fixes, which is where care is needed.
- Some design values are still in code (the level curve, dungeon map objects), so changing them needs a developer. Town zone border, dungeon door and NPC position are now map data.
- Open: how many towns and dungeons make up the finished slice; what the art direction is, since almost everything player-facing besides the world tiles is a placeholder.
