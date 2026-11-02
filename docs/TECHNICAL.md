# Technical notes

A short orientation for a developer. The game is plain HTML and JavaScript on Phaser 3.80.1 (loaded from a CDN) with no build step.

## Run it

Serve the repository root with any static server and open `index.html` (game) and `tools/editor.html` (editor). Use the same address and browser profile for both, since local editor edits live in that browser's localStorage.

Controls: arrows move, Enter confirms or talks, Esc goes back, P or I opens the menu (town and dungeon).

## Layout

| Path | Purpose |
|---|---|
| `index.html` | Page shell, script load order, the two HTML text layers |
| `game-content.json` | Exported content, loaded at start-up as the base content |
| `src/main.js` | Fetches content, then creates the Phaser game |
| `src/buildInfo.js` | Hand-bumped version shown on the title screen, in the editor and in saves |
| `src/editorData.js` | Content defaults, migrations, validation, sprite-sheet registry, content source selection |
| `src/gameState.js` | Live party, inventory, gold, XP and equip rules |
| `src/saveSystem.js` | Save slots in localStorage |
| `src/domText.js` | Draws crisp HTML text over the canvas |
| `src/scenes/` | One file per screen: Title, Map (town), Dungeon, Overlay (menus), Battle, GameOver |
| `tools/editor.html` | The design editor, a single self-contained page |
| `assets/` | Tiled maps, tile sheet, placeholder images |

Script order matters: `buildInfo.js` and `editorData.js` load before `gameState.js`, because the default party and inventory are built from content data at load time.

## Content pipeline

Content is six lists of plain objects (encounters, consumables, equipment, characters, zones, npcs). The game picks the first available source:

1. The editor's local edits (localStorage key `rpg-editor-data`), on that browser only.
2. `game-content.json`, fetched once before the game starts.
3. The built-in defaults in `editorData.js`.

The fetch never fails the game: a missing file, a network error or a malformed file falls back to the defaults and logs a warning. Content of any age passes through `EditorData.migrate()` on load and on import, so older files keep working. Save games use separate keys (`rpg-save-slot-1` to `-3`, plus `rpg-save-slot-auto`), so editing content never touches a save.

Sprites are referenced as `{ sheet, frame }` against a registry of tile sheets in `editorData.js`; adding a sheet is one registry entry.

## Things that are easy to get wrong

- **Phaser reuses scene objects.** The constructor runs once, so per-visit state must be reset in `create()`.
- **Scene data is sticky.** `scene.start('X')` with no data reuses the previous data. Pass an explicit `{}`.
- **Text is HTML, not Phaser text.** Scenes must clear the overlay layers when they change and restore visibility on arrival.
- **The menu overlay is an additive scene** reading the same keyboard as the scene beneath it, so a key press can be consumed by the wrong scene in the same frame. Each exploration scene checks the menu keys first, and the overlay ignores its first frame.
- **Listeners on the global event bus must be removed on shutdown**, or a stale one from an earlier visit can run against a stopped scene.
- **Items are matched by name**, not id, in inventory, drop pools and saves.
- **Browsers cache aggressively.** When a fix seems to do nothing, check that the served file is the new one.

## Building interiors

A `room` object marks an interior. A `door` object with property `target=room` and `room=<room name>` marks the doorway tile(s). `MapScene._setupRooms` puts a black cover (depth 1) over each room; `_updateRooms` hides the cover while the player's destination tile is inside the room or on its doorway, and shows it again as soon as the player steps out. It runs at the start of each move so the room is revealed before the player slides in. The dialogue box is at depth 100 so covers never hide it. To make another building a room, draw a `room` rectangle over its interior tiles and a `door` over the gap in its wall. Anything inside, such as enemies and NPCs, is hidden with it.

## NPCs and town services

Who an NPC is lives in the content (`npcs`, the sixth content list); where they stand lives in the map. An `npc` point in the map's `objects` layer has one property, `npc=<id>`, and `MapScene` joins it to `EditorData.getNpc(id)`. A map NPC whose id is not in the content is skipped with a console warning.

An NPC has a `name` (shown as the speaker), a `sprite`, a list of `services` (`{ effect, cost }`, one per effect) and a list of `sells` (`{ item, price, perVisit }`; `perVisit` is a per-conversation purchase cap, blank means unlimited). Effects are defined in `EditorData.NPC_EFFECTS`: `restore_party` (living members to full HP and MP), `resurrect` (one member from 0 to 1 HP) and `reset_dungeon`. Adding an effect means adding it there and handling it in `MapScene._runService`.

An NPC that offers one thing goes straight to it; one that offers several (services plus a shop counts as one) shows a short menu. At most three things per NPC (`NPC_MAX_ENTRIES`) so the choice row fits. A shop opens a vertical panel (`dialogueState` `SHOP`): Up/Down choose, Enter buys one, Esc leaves. Items can be consumables or equipment; equipment is added with its slot and bonus so it can be equipped. Stock is unlimited; `perVisit` caps reset each time you start talking to the vendor, and nothing about stock is saved.

The state changes (`spendGold`, `restParty`, `reviveMember`, `buyItem`) live in `GameState` and are unit tested. NPC content is seeded from the defaults only when the list is missing, so deleting an NPC in the editor sticks. The hospital-style revive menu shows up to three downed members per visit.

## Tests

Needs Node 18+ and no installs.

- `npm test` runs `tests/*.test.js` (Node's built-in runner): content rules, migration and content-source priority, XP and equipment, save/load round trips including old-format saves.
- `npm run validate` checks `game-content.json` (or any file: `node tools/validate-content.js path.json`) for problems the game would hit silently: unknown drop items, zones pointing at missing enemies, bad sprite frames, positions outside the map, duplicate names, unassigned random enemies.
- Browser scripts are loaded into a Node `vm` sandbox (`tests/loadEditorData.js`), so the game code is tested unmodified.
- Not covered yet: scenes, menus and rendering. These are checked by playing.

## Tilesets and tile layers

`src/tilesets.js` registers the tile sheets the game can draw (Kenney Tiny Dungeon, Tiny Town, Tiny Farm) and, for each, a list of LOCAL tile ids that block walking. `Tilesets.preload` loads every sheet; `Tilesets.build` attaches the right image to each tileset in a map and creates every tile layer, in file order. A tileset is recognised by its name or, because every Kenney sheet is called `tilemap_packed.png`, by the folder in its image path. Blocking works on global tile ids: each map's own `firstgid` is added to the local ids, so the order tilesets were added in Tiled does not matter. A cell is blocked if the base layer has nothing there, or if any layer holds a tile in a blocked list. Tilesets must be embedded in the map (Phaser cannot read external ones); `npm run validate` reports external or unregistered tilesets. The blocked lists for Tiny Town and Tiny Farm are first guesses to be tuned by walking them.

Roofs: a tile layer whose name starts with `roof` is drawn at depth 2 (above players, NPCs and room covers, below the dialogue UI) and ignored for walking. A `roof` object in `map.json` with a `room` property names the room whose roof it is; `MapScene._setupRooms` collects the roof tiles inside it, and `_updateRooms` sets their `alpha` to 0 while the player is inside that room or in its doorway. A room with roof tiles gets no black cover; a room without them keeps the cover.

## Credits

`src/credits.js` holds the Credits screen as data (a list of pages, each with a title and lines). `CreditsScene` shows them one page at a time; the title menu opens it. Add a line there for anything that needs attribution.

## Dungeons

A dungeon is a small map of its own, `assets/<id>.json`. The id doubles as the zone id for random encounters and as the map id in an encounter's `appearsIn` for static ones. A `door` object in `map.json` with `target=dungeon` and `dungeon=<id>` (default `dungeon`) leads in; the player reappears one tile south of that door's middle tile. Inside, an optional `objects` layer in the dungeon's own map holds an `exit` rectangle (the doorway tiles) and a `spawn` point; a map without it, like the original `dungeon.json`, uses the old fixed values. `DungeonScene.init` reads the id from the scene data (fresh entry) or from the battle's `returnData` (coming back from a fight), so the scene needs no other state to know which dungeon it is. The defeated-enemy set is shared and keyed by encounter id, and "Reset Dungeon" clears all of it.

## Known gaps

Zone borders, the dungeon door and the NPC position now come from the `objects` layer of `assets/map.json` (Tiled rectangles/points typed `zone`, `door`, `npc`, `room`; `MapScene._loadMapObjects` reads them and falls back to the old values if the layer is missing). The level curve is not data-driven yet. Scene and UI behavior has no automated tests; some files are leftovers (`src/domText2.js`, `assets/tileset.png`, `BootScene`).


## Touch controls

`src/touchControls.js` adds an on-screen D-pad plus A / B / Menu buttons. It does not touch any scene: each button dispatches synthetic `keydown` / `keyup` events on `window` (where Phaser listens), with `keyCode` set explicitly because WebKit leaves it 0. Mapping: D-pad = arrow keys, A = Enter, B = Escape, Menu = P.

- **When it runs:** only if `(pointer: coarse)` matches, or `?touch=1`. `?touch=0` forces it off. Desktop layout is unchanged.
- **Layout:** the 640x480 `#game-wrapper` is scaled with a CSS transform (canvas and DOM text scale together). Landscape: D-pad left, A/B right, game centred. Portrait: game on top, controls below.
- **Minimum hold:** keyup is delayed so each press lasts at least 60 ms. Phaser samples keys once per frame, and a down+up inside one frame is dropped (found in testing).
- **Not covered:** hold-to-repeat in menus (menus use JustDown, same as a keyboard); text that says "Press ENTER" still says Enter (it means A).
