/**
 * tilesets.js
 * -----------
 * One place that knows which tile sheets the game can draw and which of their
 * tiles block walking. Both MapScene and DungeonScene use it, so a map may mix
 * tiles from any of these sheets and may have several tile layers.
 *
 * A map file names each tileset it uses. Tiled's default name for every Kenney
 * sheet is the file name ("tilemap_packed"), which is the same for all of
 * them, so a tileset is recognised by its NAME first and then by the folder in
 * its IMAGE PATH (assets/kenny/tiny_town/...). Either one is enough.
 *
 * `blocked` lists LOCAL tile ids, the numbers shown in Tiled's tileset panel
 * and in docs/tileset_ids*.png (they start at 0). The code adds each map's own
 * first-gid offset, so it works no matter what order the tilesets were added
 * to a map.
 *
 * Rule for walking: a cell with nothing painted on the first tile layer is
 * void and blocks; on any other layer, a tile listed in `blocked` blocks. Every
 * other tile is walkable.
 *
 * Roofs: a tile layer whose name starts with "roof" is drawn above everything
 * and ignored for walking (you walk under a roof). MapScene fades the roof
 * tiles of a building away while the player is inside it.
 * Roof layers are depth 2, above the room covers (depth 1) and below the
 * dialogue UI (depth 100).
 *
 * FIRST-PASS LISTS. The Tiny Dungeon list is the original rule (one wall
 * tile). The Tiny Town and Tiny Farm lists are a first guess made from
 * the sheets; adjust them after walking the tiles in the game.
 */
const Tilesets = {
  SETS: {
    kenney_tiny_dungeon: {
      folder: 'tiny_dungeon',
      image: 'assets/kenny/tiny_dungeon/Tilemap/tilemap_packed.png',
      blocked: [
        26,
        6, 7, 8, 18, 19, 20, 30, 57, 58, 59,                                                        // added by the designer
      ],
    },
    kenney_tiny_town: {
      folder: 'tiny_town',
      image: 'assets/kenny/tiny_town/Tilemap/tilemap_packed.png',
      blocked: [
        3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 18, 19, 20, 21, 22, 23, 27, 28, 30, 31, 32, 33, 34, 35, // trees and bushes
        44, 45, 46, 47, 56, 57, 58, 59, 68, 69, 70, 71, 80, 81, 82, 83,                             // fences and signs
        92, 104,                                                                                    // well
        48, 49, 50, 51, 52, 53, 54, 55, 60, 61, 62, 63, 64, 65, 66, 67,                             // roofs
        72, 73, 75, 76, 77, 79, 84, 88,                                                             // building walls and windows
        96, 97, 98, 99, 100, 101, 102, 108, 109, 110, 111, 112, 113, 114, 120, 121, 122, 125, 126,  // castle walls
      ],
    },
    kenney_tiny_farm: {
      folder: 'tiny_farm',
      image: 'assets/kenny/tiny_farm/Tilemap/tilemap_packed.png',
      blocked: [
        2, 3, 14, 15, 26, 27, 38, 39,                                                               // trees
        82, 90, 91, 92, 93, 94, 95, 102, 103, 104, 105, 106, 107, 114, 115, 116, 117, 118, 119,     // barn walls and roof
        126, 128, 129,                                                                              // barn base (127 is the door)
        98, 99, 100, 101, 110, 111, 112, 113,                                                       // troughs and benches
        77, 89,                                                                                     // rocks
      ],
    },
  },

  ROOF_DEPTH: 2,

  /** Layer names that mean "roof": roof, roofs, Roof_2, ... */
  isRoofName(name) { return /^roof/i.test(name || ''); },

  textureKey(name) { return `tileset_${name}`; },

  /** Queue every registered sheet for loading. Call from a scene's preload(). */
  preload(scene) {
    for (const [name, def] of Object.entries(this.SETS)) {
      if (!scene.textures.exists(this.textureKey(name))) scene.load.image(this.textureKey(name), def.image);
    }
  },

  /** Finds the registry entry for a tileset from a map file, or null. */
  resolve(rawTileset) {
    if (!rawTileset) return null;
    if (this.SETS[rawTileset.name]) return { name: rawTileset.name, def: this.SETS[rawTileset.name] };
    const img = (rawTileset.image || '').replace(/\\/g, '/');
    for (const [name, def] of Object.entries(this.SETS)) {
      if (img.includes(`/${def.folder}/`)) return { name, def };
    }
    return null;
  },

  /**
   * Attaches the right image to every tileset in the map and creates every
   * tile layer, in file order. Returns { layers, roofLayers, blockedGids }.
   *   layers[0] is the base layer ("ground" if there is one, else the first);
   *   blockedGids is a Set of global tile ids that block walking.
   * `mapKey` is the key the tilemap JSON was loaded under (used to read each
   * tileset's image path, which Phaser does not keep).
   */
  build(scene, map, mapKey) {
    const raw = (scene.cache.tilemap.get(mapKey) || {}).data;
    const rawSets = (raw && raw.tilesets) || [];
    const blockedGids = new Set();
    const usable = [];
    map.tilesets.forEach((ts, i) => {
      const r = this.resolve(rawSets.length === map.tilesets.length ? rawSets[i] : { name: ts.name });
      if (!r) {
        console.warn(`[Tilesets] Map tileset "${ts.name}" is not in src/tilesets.js; its tiles will not be drawn.`);
        return;
      }
      ts.setImage(scene.textures.get(this.textureKey(r.name)));
      usable.push(ts);
      r.def.blocked.forEach(local => blockedGids.add(ts.firstgid + local));
    });

    const layers = [], roofLayers = [];
    for (const l of map.layers) {
      const layer = map.createLayer(l.name, usable, 0, 0);
      if (!layer) continue;
      if (this.isRoofName(l.name)) { layer.setDepth(this.ROOF_DEPTH); roofLayers.push(layer); }
      else layers.push(layer);
    }
    const base = layers.find(l => l.layer.name === 'ground') || layers[0];
    if (base && layers[0] !== base) { layers.splice(layers.indexOf(base), 1); layers.unshift(base); }
    return { layers, roofLayers, blockedGids };
  },

  /** True if (x, y) is void on the base layer or holds a blocking tile on any layer. */
  isBlocked(layers, blockedGids, x, y) {
    if (!layers.length || !layers[0].getTileAt(x, y)) return true;
    for (const layer of layers) {
      const t = layer.getTileAt(x, y);
      if (t && blockedGids.has(t.index)) return true;
    }
    return false;
  },
};
