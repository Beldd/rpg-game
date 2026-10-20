# Drawing maps with Tiled

A beginner's guide for this project. It assumes you have never opened Tiled. Menu names are from Tiled 1.10, the version that last saved `assets/map.json`. A newer Tiled may word a few things differently; the ideas are the same.

Two reference pictures go with this guide:

- `docs/map_overview.png` shows the whole overworld with a coordinate grid (numbers are tile positions) and the game objects drawn on top: zones (blue), doors (orange), rooms (green), NPCs (pink dots).
- `docs/tileset_ids.png` shows every tile in the tileset with its Tiled ID. Use it to pick tiles by looking.

## 1. What Tiled is

Tiled is a free map editor (mapeditor.org). You paint a grid of small pictures, called tiles, onto a canvas. It saves the result as a JSON file, which is the format our game already reads. So Tiled is just a nicer way to edit `assets/map.json` than editing numbers by hand.

A map has three kinds of things:

| Thing | What it is | In our game |
|---|---|---|
| **Tile layer** | A grid where each cell holds one tile | The layer named `ground` is everything you see: floors, walls, doors |
| **Object layer** | Shapes (rectangles, points) with a name, a class and properties | The layer named `objects` is invisible game logic: where towns are, where doors lead, where NPCs stand |
| **Tileset** | The picture sheet the tiles come from | Kenney Tiny Dungeon: 12 columns by 11 rows, 16×16 pixels per tile |

The rule of thumb: **tiles are what the player sees, objects are what the game does.**

## 2. Before you start (do this once)

1. Download Tiled from mapeditor.org. Take the Windows installer, or the portable version if you do not want to install anything.
2. Make a safety copy. Either commit to git first, or copy `assets/map.json` to somewhere else. If a session goes wrong, you restore that copy (or run `git checkout assets/map.json`) and lose nothing.
3. Open Tiled, then File > Open and choose `C:\rpg-game\assets\map.json`.

If Tiled complains it cannot find the tileset image, see Troubleshooting at the end.

## 3. The screen

When the map opens you will see roughly this (panels can be moved, so yours may differ):

- **Centre:** the map. Mouse wheel zooms with Ctrl held. Hold the middle mouse button (or Space and drag) to pan.
- **Top right, Layers panel:** two rows, `ground` and `objects`. The one highlighted is the layer you are drawing on. Clicking a layer selects it. The eye icon hides it, which is handy for looking at one layer alone.
- **Bottom right, Tilesets panel:** the sheet of tiles. Click one to pick it up as your brush.
- **Left, Properties panel:** details of whatever is selected, including custom properties on objects.
- **Toolbar along the top:** the tools. Hover any icon for its name. The ones you will use:

| Tool | Shortcut | What it does |
|---|---|---|
| Stamp Brush | B | Paints the selected tile |
| Bucket Fill | F | Fills a whole area with the selected tile |
| Eraser | E | Clears a cell (an empty cell is the black "void") |
| Select Objects | S | Picks and moves objects on an object layer |
| Insert Rectangle | R | Draws a rectangle object |
| Insert Point | I | Places a point object |

Also turn on View > Snap to Grid (and View > Show Grid) so rectangles line up with whole tiles.

## 4. First exercise: paint something harmless

Goal: change the map and see it in the game. Nothing here can break game logic.

1. In the Layers panel, click `ground`.
2. In the Tilesets panel, click a floor tile.
3. Choose the Stamp Brush (B) and click or drag in the big empty area to the east of the town. You are painting.
4. Undo with Ctrl+Z whenever you like.
5. File > Save (Ctrl+S). It saves back into `map.json`.
6. Start your local server as usual and open the game. Press Ctrl+F5 for a hard refresh, because browsers cache the map file. Walk to where you painted.

Check: your tiles should appear in the right place. (Position check: the town is in the top-left corner; the first empty column to the east is x=40.)

## 5. Adding more tile sheets (Tiny Town, Tiny Farm)

You can mix tiles from any registered sheet in one map. There is one rule that must be followed, or the game will not load the map:

**Every tileset must be embedded in the map file, not saved as a separate file.** If you see `External tilesets unsupported. Use Embed Tileset and re-export` in the browser console, this is what went wrong.

**The right way to add a sheet:**

1. Map > New Tileset (or the New Tileset button in the Tilesets panel).
2. Type: "Based on Tileset Image".
3. **Name:** give it a clear name, for example `kenney_tiny_town`. Tiled's default is `tilemap_packed` for every Kenney sheet, which is confusing. The game can still tell them apart by the image path, but a real name keeps you sane.
4. **Tick "Embed in map".** This is the important box.
5. Image: browse to `assets/kenny/tiny_town/Tilemap/tilemap_packed.png` (or `tiny_farm`).
6. Tile width 16, tile height 16, margin 0, spacing 0. Click OK.
7. Save.

**If you already added one and got the error:** in the Tilesets panel, click the tab of that tileset to select it. Look in the Tilesets panel's toolbar (the small buttons along the bottom or top of the panel) for **Embed Tileset**, and click it. Tiled copies the tileset into the map. Then save. Newer or older versions of Tiled place this button slightly differently. If you cannot find it, delete that tileset (select it, use Remove Tileset), and add it again using the steps above with "Embed in map" ticked. Tiles you already painted with it will go blank when you remove it, so do this before painting much.

**To check:** run `npm.cmd run validate`. It reports an external tileset as an error and tells you what to do. You can also open `map.json` in a text editor and look at the `"tilesets"` list: every entry should contain an `"image"` line and none should contain `"source"`.

Registered sheets are Tiny Dungeon, Tiny Town and Tiny Farm. A sheet from anywhere else needs a line added in `src/tilesets.js` first, or its tiles will not be drawn (the validator gives a warning).

**Layers.** A map can have any number of tile layers (Layer > New > Tile Layer). They are drawn in the order shown in the Layers panel, bottom to top. A good pattern is `ground` for grass, floors and paths, then `decor` above it for trees, fences and buildings, so the trees' see-through edges show grass behind them. Keep the layer called `ground` first. Layers whose names you choose are all drawn.

**Transparent tiles (wells, trees, signs) and the black background.** Many tiles have see-through parts. The game draws whatever is underneath, and if nothing is painted underneath, you get black. In Tiled it can look fine because Tiled shows its own background. The fix is always the same: paint a solid tile (grass, floor) on the `ground` layer first, then paint the see-through tile on the layer above it (`decor`). For a well: grass on `ground` in both cells, then the two well tiles on `decor` on the same two cells.

Note that an empty cell on `ground` is void and blocks walking, so every cell you use needs something on `ground` anyway.

**Roofs that disappear when you walk in.** Today the interior of a building is hidden by a plain black box until you step through its door. You can replace that with real roof tiles:

1. Make a tile layer named `roof` (Layer > New > Tile Layer). Any name that starts with `roof` works, for example `roof` or `roof_2`. Keep it above the others in the Layers panel.
2. Paint the roof tiles on that layer over the whole building, covering the floor you want hidden. The `ground` layer underneath keeps the floor and walls.
3. On the `objects` layer, draw a rectangle over the roof tiles. Set its Class to `roof` and add a string property `room` with the building's room name (for example `inn`). This ties the roof to the room object that already exists for that building.
4. Save and test. From outside you see the roof. When you step into the doorway the roof tiles disappear and you see the interior, with its NPC. When you leave, the roof comes back.

A few details: roofs are drawn above everything, including NPCs and the player, and the game ignores the roof layer for walking, so you can walk under a roof tile. A room with no `roof` object keeps the old black cover, so you can convert buildings one at a time. If a `roof` object covers no painted tiles, the black cover is used.

## 6. Which tiles block walking

The game decides this from lists in `src/tilesets.js`, one list per sheet:

- **Empty cells on the first (`ground`) layer** are void and block movement.
- **Tiles in a sheet's blocked list** block movement, on any layer.
- **Everything else is walkable.**

So painting a tile does not make it solid by itself; the tile has to be in its sheet's list. Currently:

- **Tiny Dungeon:** only the stone-frame wall piece (ID 26).
- **Tiny Town and Tiny Farm:** a first guess I made by looking at the sheets: trees, fences, roofs, building and castle walls, windows, barn pieces, troughs, rocks. Doors and doorways are walkable on purpose.

Walk around your new buildings and trees in the game. Where something blocks that should not, or lets you walk through something solid, tell me the tile ID (the numbers in `docs/tileset_ids_tiny_town.png` and `docs/tileset_ids_tiny_farm.png`) and I will change the list. It is a one-line edit.

**Which number is which.** Tiled's Tilesets panel counts each sheet's tiles from 0, and so do the pictures in this repo. The saved map file stores a different number (the sheet's local ID plus an offset that depends on the order the tilesets were added) and the game works that out for you. You never need the saved number. The old docs sometimes said "tile 27" for the dungeon wall; that is the same tile as Tiled's ID 26.

## 7. Objects: the game logic

Objects live on the `objects` layer. Click that layer first, or the tools below will not work.

**How to make one:**

1. Select the `objects` layer.
2. Choose Insert Rectangle (R) and drag over the tiles, or Insert Point (I) and click.
3. Select it with Select Objects (S). In the Properties panel, set the **Name** and the **Class** (a text box near the top; older Tiled calls it Type).
4. Add custom properties: at the bottom of the Properties panel, click the **+** button. Choose the type **string**, give it a name, then type the value into the new row.

Spelling and capital letters matter. The game looks for exactly these words.

| Class | Shape | Properties | What it does |
|---|---|---|---|
| `zone` | Rectangle | `zone` = a zone id from the editor's Zones list, for example `town` | Walking inside it uses that zone's random encounters. Anything outside every zone counts as `overworld`. If rectangles overlap, the one earlier in the list wins |
| `door` | Rectangle over the doorway tile(s) | `target` = `room`, plus `room` = the room's name | Stepping on it reveals that room's interior |
| `door` | Rectangle over the doorway tile(s) | `target` = `dungeon`, plus `dungeon` = the dungeon's id, for example `dungeon` | Stepping on it enters that dungeon. You reappear one tile south of the door's middle tile when you come out |
| `room` | Rectangle covering the interior | none; the **Name** is the room's name, which the door's `room` property must match | Hidden under black until you step into its doorway |
| `roof` | Rectangle over the building's roof tiles | `room` = the name of that building's room | Hides the roof tiles on the `roof` layer inside that rectangle while the player is in the room |
| `npc` | Point | `npc` = an NPC id from the editor's NPCs tab, for example `innkeeper` | Places that NPC. The NPC stands on the tile the point falls in |

Two more classes exist only inside a dungeon's own map file (they are not in `map.json`):

| Class | Shape | What it does |
|---|---|---|
| `exit` | Rectangle over the doorway tiles | Walking onto it leaves the dungeon |
| `spawn` | Point | Where the player appears when entering |

A dungeon map with no `objects` layer falls back to fixed values (this is how the original `dungeon.json` works).

**Position tips.** Zone, door and room rectangles should cover whole tiles, so keep Snap to Grid on. A rectangle's X, Y, width and height appear in the Properties panel in pixels; divide by 16 to get tiles. For a point, the NPC stands on the tile at (X ÷ 16, Y ÷ 16), rounded down.

## 8. Second exercise: add a test zone

Goal: practise objects without risk.

1. Select the `objects` layer. Draw a rectangle over about 6×6 tiles of the empty eastern area.
2. Set its Class to `zone` and Name to `test`. Add a string property `zone` with the value `town`.
3. Save, refresh the game, and walk into that area. You should see no random battles there, because it is now part of the town zone.
4. Delete the rectangle (select it, press Delete), then save again.

## 9. Checking your work

After saving in Tiled, open a terminal in the repo and run:

    npm.cmd run validate

It reads the map and catches the common mistakes: an NPC object that points to an NPC id that does not exist, an NPC standing inside a wall, a door with no matching room, a zone that points to a zone id that does not exist. It only checks the data; it cannot see whether the map looks good.

`npm.cmd test` should still report all tests passing.

## 10. Making a new map (a dungeon)

Do not start from Tiled's New Map dialog, because the tileset name and settings have to match the game exactly. Instead:

1. Open `assets/dungeon.json` in Tiled.
2. File > Save As, and save it as `assets/dungeon_2.json`. The file name (without `.json`) is the dungeon's id.
3. Repaint the `ground` layer. Add an `objects` layer if it has none (Layer > New > Object Layer, named exactly `objects`) and add one `exit` rectangle and one `spawn` point.
4. A door in `map.json` with `target` = `dungeon` and `dungeon` = `dungeon_2` leads there.

Keep the first tile layer named `ground`. Any tileset in the map must be embedded and be one of the registered sheets (section 5).

## 11. Where things are on the current map

The overworld is now **64 wide by 48 tall**. Everything that existed before is in the same place; the empty space was added to the right and bottom. In `map_overview.png`:

- The three small buildings in the top-left and left are the inn, the shop and the hospital, with their rooms (green) and doors (orange).
- The large building on the right of the town is the dungeon entrance, with its door at the bottom.
- The tall wall at x=22–23 is a divider with a gap in the middle.
- The big empty area to the east and south is yours to fill. The black outer edge is the void border and stays.

A suggested split, which is entirely your call: Town 2 in the east (around x 44–60, y 2–22), Dungeon 2's door somewhere in the south, and open ground between for the overworld.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Tiled says the tileset image is missing | Click the broken tileset, choose Browse, and select `assets/kenny/tiny_dungeon/Tilemap/tilemap_packed.png` |
| The game shows a black screen after a save | A layer was renamed or deleted. They must be called `ground` and `objects`. Restore your backup copy and redo the change |
| Changes do not show up | Hard refresh with Ctrl+F5, and make sure you saved in Tiled |
| The player walks through a wall or tree you painted | That tile is not in its sheet's blocked list (see section 6) |
| The player cannot walk where you expect | There is an empty cell or a wall tile there. Check the `ground` layer with the eye icon on the `objects` layer turned off |
| An object does nothing | Check the Class spelling, the property name and its type (string), and that it is on the `objects` layer |
| The browser console says `External tilesets unsupported` | A tileset was saved as a separate file. Embed it (section 5), save, and run `npm.cmd run validate` |
| A see-through tile has a black box behind it | Nothing is painted under it. Paint a grass or floor tile on `ground`, and the see-through tile on a layer above (`decor`) |
| A roof never disappears | The `roof` object's `room` property does not match the room's name, or the roof tiles are not on a layer whose name starts with `roof`. `npm.cmd run validate` reports an unknown room |
| Tiles from a new sheet are blank in the game | The sheet is not registered in `src/tilesets.js`. The validator warns about this |
| Tiled saved a `.tmx` file | You used a new map, not the JSON. Use File > Save As and pick the JSON map format, or work from the existing `.json` file |
| The file looks very different in git after saving | Normal: Tiled rewrites the whole file in its own layout. Check that the game still works and that `npm.cmd run validate` is clean |

## 13. Words you will see

- **Tile:** one 16×16 picture.
- **Tileset:** the sheet of tiles.
- **Layer:** a stack level of the map. Ours are `ground` (tiles) and `objects` (shapes).
- **Object:** a shape on an object layer. It carries a name, a class and properties.
- **Class (or Type):** the kind of object; the game reads it to decide what the object does.
- **Property:** a name and value attached to an object, for example `npc` = `innkeeper`.
- **Gid / ID:** a tile's number. Tiled's panel counts from 0. The saved file counts from 1.
