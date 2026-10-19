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

## 5. The rule you must know: which tiles block walking

This is the one place where drawing freely does not work yet.

The game decides whether you can walk onto a tile using a short fixed list in the code:

- **Empty cells** (nothing painted) block movement. They are the black void around the edge.
- **Tile ID 26** blocks movement. This is the stone-frame wall piece you can see used for every building wall.
- **Every other tile is walkable**, including tiles that look like walls (the brick tiles, for example).

So if you paint a wall from, say, the brick tiles, the player will walk straight through it. For now, build walls with ID 26 (highlighted red in `tileset_ids.png`), and use the other tiles for decoration, floors, doors and furniture.

**The off-by-one gotcha.** Tiled numbers tiles starting at 0. The saved file and the game's own comments number them starting at 1, because 0 means "empty" there. So the wall tile is **ID 26 in Tiled** and **27 in the code, docs and map data**. The pictures in this repo use Tiled's numbering. If you read the number 27 anywhere else, it means the same tile as 26 here.

This limit is the next thing I plan to fix, so that you can mark any tile as a wall yourself. Until then, walls are ID 26.

## 6. Objects: the game logic

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
| `npc` | Point | `npc` = an NPC id from the editor's NPCs tab, for example `innkeeper` | Places that NPC. The NPC stands on the tile the point falls in |

Two more classes exist only inside a dungeon's own map file (they are not in `map.json`):

| Class | Shape | What it does |
|---|---|---|
| `exit` | Rectangle over the doorway tiles | Walking onto it leaves the dungeon |
| `spawn` | Point | Where the player appears when entering |

A dungeon map with no `objects` layer falls back to fixed values (this is how the original `dungeon.json` works).

**Position tips.** Zone, door and room rectangles should cover whole tiles, so keep Snap to Grid on. A rectangle's X, Y, width and height appear in the Properties panel in pixels; divide by 16 to get tiles. For a point, the NPC stands on the tile at (X ÷ 16, Y ÷ 16), rounded down.

## 7. Second exercise: add a test zone

Goal: practise objects without risk.

1. Select the `objects` layer. Draw a rectangle over about 6×6 tiles of the empty eastern area.
2. Set its Class to `zone` and Name to `test`. Add a string property `zone` with the value `town`.
3. Save, refresh the game, and walk into that area. You should see no random battles there, because it is now part of the town zone.
4. Delete the rectangle (select it, press Delete), then save again.

## 8. Checking your work

After saving in Tiled, open a terminal in the repo and run:

    npm.cmd run validate

It reads the map and catches the common mistakes: an NPC object that points to an NPC id that does not exist, an NPC standing inside a wall, a door with no matching room, a zone that points to a zone id that does not exist. It only checks the data; it cannot see whether the map looks good.

`npm.cmd test` should still report all tests passing.

## 9. Making a new map (a dungeon)

Do not start from Tiled's New Map dialog, because the tileset name and settings have to match the game exactly. Instead:

1. Open `assets/dungeon.json` in Tiled.
2. File > Save As, and save it as `assets/dungeon_2.json`. The file name (without `.json`) is the dungeon's id.
3. Repaint the `ground` layer. Add an `objects` layer if it has none (Layer > New > Object Layer, named exactly `objects`) and add one `exit` rectangle and one `spawn` point.
4. A door in `map.json` with `target` = `dungeon` and `dungeon` = `dungeon_2` leads there.

Always keep the tileset name `kenney_tiny_dungeon` and the layer name `ground`.

## 10. Where things are on the current map

The overworld is now **64 wide by 48 tall**. Everything that existed before is in the same place; the empty space was added to the right and bottom. In `map_overview.png`:

- The three small buildings in the top-left and left are the inn, the shop and the hospital, with their rooms (green) and doors (orange).
- The large building on the right of the town is the dungeon entrance, with its door at the bottom.
- The tall wall at x=22–23 is a divider with a gap in the middle.
- The big empty area to the east and south is yours to fill. The black outer edge is the void border and stays.

A suggested split, which is entirely your call: Town 2 in the east (around x 44–60, y 2–22), Dungeon 2's door somewhere in the south, and open ground between for the overworld.

## 11. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Tiled says the tileset image is missing | Click the broken tileset, choose Browse, and select `assets/kenny/tiny_dungeon/Tilemap/tilemap_packed.png` |
| The game shows a black screen after a save | A layer was renamed or deleted. They must be called `ground` and `objects`. Restore your backup copy and redo the change |
| Changes do not show up | Hard refresh with Ctrl+F5, and make sure you saved in Tiled |
| The player walks through a wall you painted | The tile is not ID 26 (see section 5) |
| The player cannot walk where you expect | There is an empty cell or a wall tile there. Check the `ground` layer with the eye icon on the `objects` layer turned off |
| An object does nothing | Check the Class spelling, the property name and its type (string), and that it is on the `objects` layer |
| Tiled saved a `.tmx` file | You used a new map, not the JSON. Use File > Save As and pick the JSON map format, or work from the existing `.json` file |
| The file looks very different in git after saving | Normal: Tiled rewrites the whole file in its own layout. Check that the game still works and that `npm.cmd run validate` is clean |

## 12. Words you will see

- **Tile:** one 16×16 picture.
- **Tileset:** the sheet of tiles.
- **Layer:** a stack level of the map. Ours are `ground` (tiles) and `objects` (shapes).
- **Object:** a shape on an object layer. It carries a name, a class and properties.
- **Class (or Type):** the kind of object; the game reads it to decide what the object does.
- **Property:** a name and value attached to an object, for example `npc` = `innkeeper`.
- **Gid / ID:** a tile's number. Tiled's panel counts from 0. The saved file counts from 1.
