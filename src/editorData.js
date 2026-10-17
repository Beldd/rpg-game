/**
 * editorData.js
 * -------------
 * The shared data contract between the design tool and the game.
 *
 * The editor writes encounter/item/ability definitions here. The game
 * reads from here instead of (or before falling back to) its hardcoded
 * values. This is the seam that will eventually become a server API
 * call on both sides — for now, localStorage is the transport.
 *
 * Key separation from SaveSystem:
 *   rpg-save-slot-N   → player's save game state (party, inventory)
 *   rpg-editor-data   → designer's content definitions (encounters, items, abilities)
 *
 * Encounter schema: see existing comment block above defaults.
 *
 * Consumable schema:
 * {
 *   id: string               — stable key
 *   name: string             — display name
 *   type: 'consumable'
 *   effect: {
 *     type: 'heal',          — only type wired up for now
 *     minAmount: number,
 *     maxAmount: number,
 *   } | null                 — null for items with no wired effect yet (Antidote)
 *   startingQuantity: number — how many the player starts with (0 = in catalog
 *                              but not in starting inventory)
 * }
 */
const EDITOR_STORAGE_KEY = 'rpg-editor-data';

const EditorData = {
  /**
   * Sprite sheets that encounters can pick frames from. An encounter's
   * `sprite` is { sheet: <id from here>, frame: <index> } or null (null =
   * the generic placeholder). `path` is relative to index.html; the editor
   * prefixes "../". `textureKey` is the Phaser texture name the game uses.
   * Adding a sheet here makes it available to the loader; the editor's
   * picker currently shows only the first one.
   */
  SPRITE_SHEETS: {
    tiny_dungeon: {
      label: 'Kenney Tiny Dungeon',
      path: 'assets/kenny/tiny_dungeon/Tilemap/tilemap_packed.png',
      textureKey: 'characters',
      frameWidth: 16,
      frameHeight: 16,
      cols: 12,
      rows: 11,
    },
  },

  /** True if `sprite` points at a real frame of a registered sheet. */
  isValidSprite(sprite) {
    if (!sprite || typeof sprite !== 'object') return false;
    const sheet = this.SPRITE_SHEETS[sprite.sheet];
    return !!sheet && Number.isInteger(sprite.frame) &&
      sprite.frame >= 0 && sprite.frame < sheet.cols * sheet.rows;
  },

  /** Queues every registered sheet for loading; skips ones already loaded. Call from a scene's preload(). */
  preloadSheets(scene) {
    Object.values(this.SPRITE_SHEETS).forEach(sheet => {
      if (!scene.textures.exists(sheet.textureKey)) {
        scene.load.spritesheet(sheet.textureKey, sheet.path, {
          frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight,
        });
      }
    });
  },

  /**
   * Adds an image for `sprite` ({sheet, frame}) to `scene` at x,y, or returns
   * null if the sprite is unset, invalid, or its texture/frame isn't loaded.
   * Callers fall back to their own placeholder on null, so bad content never
   * breaks a scene.
   */
  makeSpriteImage(scene, x, y, sprite) {
    if (!this.isValidSprite(sprite)) return null;
    const sheet = this.SPRITE_SHEETS[sprite.sheet];
    if (!scene.textures.exists(sheet.textureKey)) return null;
    if (!scene.textures.get(sheet.textureKey).has(sprite.frame)) return null;
    return scene.add.image(x, y, sheet.textureKey, sprite.frame);
  },

  /**
   * What an NPC service can do. `label` is for the editor, `short` is the
   * one-word choice shown in the game when an NPC offers several things.
   * The game implements each effect in MapScene; adding a new one means
   * adding it here and there.
   */
  NPC_EFFECTS: {
    restore_party: { label: 'Restore HP/MP', short: 'Rest' },
    resurrect:     { label: 'Resurrect',     short: 'Revive' },
    reset_dungeon: { label: 'Reset Dungeon', short: 'Reset' },
  },

  /** Most things (services plus one shop) an NPC may offer; the choice row fits four options plus Leave. */
  NPC_MAX_ENTRIES: 3,

  defaults: {
    npcs: [
      { id: 'wizard', name: 'Wizard', sprite: { sheet: 'tiny_dungeon', frame: 84 },
        services: [{ effect: 'reset_dungeon', cost: 0 }], sells: [] },
      { id: 'innkeeper', name: 'Inn Keeper', sprite: { sheet: 'tiny_dungeon', frame: 85 },
        services: [{ effect: 'restore_party', cost: 100 }], sells: [] },
      { id: 'potion_master', name: 'Potion Master', sprite: { sheet: 'tiny_dungeon', frame: 86 },
        services: [], sells: [{ item: 'Potion', price: 50, perVisit: null }] },
      { id: 'doctor', name: 'Doctor', sprite: { sheet: 'tiny_dungeon', frame: 99 },
        services: [{ effect: 'resurrect', cost: 200 }], sells: [] },
    ],
    encounters: [
      {
        id: 'slime_01',
        name: 'Slime',
        type: 'static',
        mapPosition: { tileX: 32, tileY: 10 },
        dungeonPosition: { tileX: 14, tileY: 10 },
        stats: {
          hp: 20,
          attackMin: 2,
          attackMax: 6,
          xpReward: 10,
          speed: 8,
        },
        abilities: [
          {
            id: 'basic_attack',
            name: 'Attack',
            type: 'attack',
            weight: 100,
            params: {
              damageMultiplier: 1.0,
              message: '{name} attacks {target} for {damage} damage!',
            },
          },
        ],
        rewards: {
          dropPool: [
            { name: 'Potion', stackable: true, weight: 1 },
            { name: 'Antidote', stackable: true, weight: 1 },
            { name: 'Sword', slot: 'primary', bonus: { attackMin: 3, attackMax: 3 }, weight: 1 },
            { name: 'Shield', slot: 'secondary', bonus: { defense: 3 }, weight: 1 },
          ],
          dropChance: 0.5,
        },
        dialogue: {
          challenge: "Halt, {interlopers}! You've ruined your own lands, you'll not ruin mine! I, {name}, will knock you all down!",
        },
      },
    ],

    consumables: [
      {
        id: 'potion_01',
        name: 'Potion',
        type: 'consumable',
        effect: { type: 'heal', minAmount: 15, maxAmount: 25 },
        startingQuantity: 3,
      },
      {
        id: 'antidote_01',
        name: 'Antidote',
        type: 'consumable',
        effect: null, // no effect until status effects are implemented
        startingQuantity: 1,
      },
    ],

    // Equipment items. bonus is an array of {stat, amount} pairs
    // rather than a plain object — this makes open-ended stat editing
    // possible in a form without dynamic object-key manipulation.
    equipment: [
      { id: 'sword_01',   name: 'Sword',   slot: 'primary',   startingOwned: true, bonus: [{ stat: 'attackMin', amount: 3 }, { stat: 'attackMax', amount: 3 }] },
      { id: 'shield_01',  name: 'Shield',  slot: 'secondary', startingOwned: true, bonus: [{ stat: 'defense', amount: 3 }] },
      { id: 'mail_01',    name: 'Mail',    slot: 'body',      startingOwned: true, bonus: [{ stat: 'defense', amount: 2 }] },
      { id: 'helm_01',    name: 'Helm',    slot: 'head',      startingOwned: true, bonus: [{ stat: 'defense', amount: 2 }] },
      { id: 'mace_01',    name: 'Mace',    slot: 'primary',   startingOwned: true, bonus: [{ stat: 'attackMin', amount: 3 }, { stat: 'attackMax', amount: 3 }] },
      { id: 'buckler_01', name: 'Buckler', slot: 'secondary', startingOwned: true, bonus: [{ stat: 'defense', amount: 3 }] },
      { id: 'robes_01',   name: 'Robes',   slot: 'body',      startingOwned: true, bonus: [{ stat: 'defense', amount: 2 }] },
      { id: 'kippah_01',  name: 'Kippah',  slot: 'head',      startingOwned: true, bonus: [{ stat: 'defense', amount: 2 }] },
    ],

    /**
     * Zone definitions. Each zone controls whether random encounters
     * are enabled for that region, and which encounter table to draw
     * from when they are.
     *
     * randomEncounters: array of encounter ids that can be drawn from
     *   the bag. An empty array with enabled:true would be valid but
     *   would silently never trigger anything — keep at least one entry.
     * enabled: false means the tile bag never advances (safe zone).
     */
    zones: [
      {
        id: 'town',
        name: 'Town',
        enabled: false,
        randomEncounters: [],
      },
      {
        id: 'overworld',
        name: 'Overworld',
        enabled: true,
        randomEncounters: ['slime_01'],
      },
      {
        id: 'dungeon',
        name: 'Dungeon',
        enabled: true,
        randomEncounters: ['slime_01'],
      },
    ],

    characters: [
      {
        id: 'hero_01',
        name: 'Hero',
        startingHp: 30,
        startingMp: 15,
        baseStats: { attackMin: 4, attackMax: 8, defense: 0, speed: 10 },
        spells: [
          { id: 'fire_01',    name: 'Fire',            cost: 6, type: 'offense',         min: 8, max: 14 },
          { id: 'drain_01',   name: 'Drain',           cost: 6, type: 'drain',           multiplier: 1.25, selfHealPercent: 0.2 },
          { id: 'expose_01',  name: 'Expose Weakness', cost: 3, type: 'debuff',          durationTurns: 3 },
        ],
      },
      {
        id: 'ally_01',
        name: 'Ally',
        startingHp: 24,
        startingMp: 12,
        baseStats: { attackMin: 3, attackMax: 7, defense: 0, speed: 10 },
        spells: [
          { id: 'heal_01',  name: 'Heal',  cost: 5, type: 'heal',            min: 10, max: 16 },
          { id: 'smite_01', name: 'Smite', cost: 7, type: 'attackMultiplier', multiplier: 2.0 },
        ],
      },
      {
        // Placeholder 3: high HP/defense, low speed — tank archetype.
        // Rename and redesign in the Characters editor.
        id: 'char_03',
        name: 'Char3',
        startingHp: 40,
        startingMp: 6,
        baseStats: { attackMin: 4, attackMax: 8, defense: 3, speed: 6 },
        spells: [],
      },
      {
        // Placeholder 4: high speed, moderate attack, low HP — rogue archetype.
        id: 'char_04',
        name: 'Char4',
        startingHp: 20,
        startingMp: 8,
        baseStats: { attackMin: 5, attackMax: 10, defense: 0, speed: 14 },
        spells: [],
      },
      {
        // Placeholder 5: low HP/attack, high MP, strong spells — mage archetype.
        id: 'char_05',
        name: 'Char5',
        startingHp: 16,
        startingMp: 20,
        baseStats: { attackMin: 2, attackMax: 4, defense: 0, speed: 8 },
        spells: [
          { id: 'fire2_01', name: 'Fire', cost: 6, type: 'offense', min: 12, max: 20 },
        ],
      },
    ],
  },

  // ── Content sources ────────────────────────────────────────────────
  // Priority, highest first:
  //   1. 'local'    — the editor's localStorage override (this browser only)
  //   2. 'repo'     — game-content.json fetched at boot (shared, versioned)
  //   3. 'defaults' — the built-in data below (always available)
  CONTENT_URL: 'game-content.json', // relative to the page; the editor overrides this
  repoContent: null,                // validated + migrated contents of the file, once fetched
  repoMeta: null,                   // { exportedAt, build } from the file's header
  repoStatus: 'not loaded',         // human-readable result of the fetch, for troubleshooting

  /**
   * Fetches game-content.json once, before the game boots. Never rejects:
   * any failure (missing file, offline, file:// page, bad JSON) leaves
   * repoContent null so the game falls back to the built-in defaults.
   * cache:'no-store' skips the browser cache so a fresh deploy is seen.
   */
  async init() {
    try {
      const res = await fetch(this.CONTENT_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await res.json();
      const wrapped = parsed && parsed.format === 'arcadia-content';
      const data = wrapped ? parsed.data : parsed;
      const problem = this.validate(data);
      if (problem) throw new Error(problem);
      this.repoContent = this.migrate(data);
      this.repoMeta = wrapped ? { exportedAt: parsed.exportedAt || null, build: parsed.build || null } : {};
      this.repoStatus = 'loaded';
    } catch (err) {
      this.repoContent = null;
      this.repoMeta = null;
      this.repoStatus = `unavailable (${err.message})`;
      console.warn('[EditorData] game-content.json not used:', err.message);
    }
  },

  hasLocalOverride() {
    try { return localStorage.getItem(EDITOR_STORAGE_KEY) !== null; }
    catch (err) { return false; }
  },

  /** Which source load() will use right now: 'local' | 'repo' | 'defaults'. */
  source() {
    if (this.hasLocalOverride()) return 'local';
    return this.repoContent ? 'repo' : 'defaults';
  },

  /** Removes the local override so the repo file (or defaults) takes over again. */
  clearOverride() {
    try { localStorage.removeItem(EDITOR_STORAGE_KEY); return true; }
    catch (err) { console.error('EditorData.clearOverride failed:', err); return false; }
  },

  load() {
    try {
      const raw = localStorage.getItem(EDITOR_STORAGE_KEY);
      if (raw) return this.migrate(JSON.parse(raw));
    } catch (err) {
      console.error('EditorData.load: local override unreadable, ignoring it:', err);
    }
    // Deep copy so callers (the editor) can mutate without touching the cache.
    const base = this.repoContent || this.defaults;
    return JSON.parse(JSON.stringify(base));
  },

  /**
   * Brings content data of any age up to the current schema, in place.
   * Shared by load() (localStorage) and the editor's JSON import, so a file
   * exported from an older version of the editor still imports cleanly.
   */
  migrate(data) {
    this._migrateEncounters(data);
    this._migrateConsumables(data);
    this._migrateEquipment(data);
    this._migrateCharacters(data);
    this._migrateZones(data);
    this._migrateNpcs(data);
    return data;
  },

  /**
   * Returns an error string if `data` is clearly not editor content,
   * or null if it looks usable. Deliberately shallow: it guards against
   * importing the wrong file, not against every possible typo.
   */
  validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'File is not a content object.';
    for (const key of ['encounters', 'consumables', 'equipment', 'characters', 'zones']) {
      if (data[key] !== undefined && !Array.isArray(data[key])) return `"${key}" must be a list.`;
    }
    if (!Array.isArray(data.encounters)) return 'Missing "encounters" list; this does not look like game content.';
    const bad = data.encounters.find(e => !e || typeof e.id !== 'string' || !e.stats || typeof e.stats !== 'object');
    if (bad) return 'An encounter is missing its id or stats.';
    return null;
  },

  _migrateEncounters(data) {
    if (!data.encounters) return;
    const defaultEnc = this.defaults.encounters[0];
    data.encounters.forEach(enc => {
      if (enc.type === undefined) enc.type = 'static';
      if (enc.mapPosition === undefined) enc.mapPosition = { tileX: 14, tileY: 9 };
      if (enc.dungeonPosition === undefined) {
        // Default dungeon position for encounters that predate this field.
        const defaultEnc2 = this.defaults.encounters.find(d => d.id === enc.id);
        enc.dungeonPosition = defaultEnc2 ? defaultEnc2.dungeonPosition : { tileX: 14, tileY: 10 };
      }
      if (!enc.abilities || enc.abilities.length === 0) {
        enc.abilities = JSON.parse(JSON.stringify(defaultEnc.abilities));
      }
      if (enc.stats.speed === undefined) enc.stats.speed = 8;
      if (!['regular', 'rare', 'elite', 'boss'].includes(enc.tier)) enc.tier = 'regular';
      if (!this.isValidSprite(enc.sprite)) enc.sprite = null;
      // Which maps a static encounter appears on. Missing = both, which is
      // what happened before this field existed, so old content is unchanged.
      if (!Array.isArray(enc.appearsIn)) enc.appearsIn = ['map', 'dungeon'];
      enc.appearsIn = enc.appearsIn.filter(m => m === 'map' || m === 'dungeon');
      if (!enc.rewards) enc.rewards = { dropPool: [], dropChance: 0.5 };
      if (!Number.isFinite(enc.rewards.gold)) enc.rewards.gold = 0;
    });
  },

  /**
   * Forward-migration for consumables: if stored data predates the
   * consumables section (first schema version), seed it from defaults.
   * Like encounter migration, existing customizations are never touched.
   */
  _migrateConsumables(data) {
    if (!data.consumables) {
      data.consumables = JSON.parse(JSON.stringify(this.defaults.consumables));
    }
  },

  _migrateEquipment(data) {
    if (!data.equipment) {
      data.equipment = JSON.parse(JSON.stringify(this.defaults.equipment));
      return;
    }
    const existingIds = new Set(data.equipment.map(e => e.id));
    this.defaults.equipment.forEach(defaultItem => {
      if (!existingIds.has(defaultItem.id)) {
        data.equipment.push(JSON.parse(JSON.stringify(defaultItem)));
      }
    });
  },

  /**
   * NPCs are seeded from the defaults only when the list does not exist yet
   * (content from before NPCs were editable). After that the designer owns
   * the list, so deleting an NPC sticks. Malformed entries are repaired, not
   * rejected, in the same spirit as the other migrations.
   */
  _migrateNpcs(data) {
    if (!Array.isArray(data.npcs)) {
      data.npcs = JSON.parse(JSON.stringify(this.defaults.npcs));
      return;
    }
    const money = v => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
    data.npcs = data.npcs.filter(n => n && typeof n.id === 'string' && n.id);
    data.npcs.forEach(n => {
      if (typeof n.name !== 'string' || !n.name) n.name = n.id;
      if (!this.isValidSprite(n.sprite)) n.sprite = null;
      const seen = new Set();
      n.services = (Array.isArray(n.services) ? n.services : [])
        .filter(s => s && this.NPC_EFFECTS[s.effect] && !seen.has(s.effect) && seen.add(s.effect))
        .map(s => ({ effect: s.effect, cost: money(s.cost) }));
      n.sells = (Array.isArray(n.sells) ? n.sells : [])
        .filter(s => s && typeof s.item === 'string' && s.item)
        .map(s => ({
          item: s.item,
          price: money(s.price),
          perVisit: Number.isInteger(s.perVisit) && s.perVisit >= 1 ? s.perVisit : null,
        }));
    });
  },

  _migrateZones(data) {
    if (!data.zones) {
      data.zones = JSON.parse(JSON.stringify(this.defaults.zones));
      return;
    }
    const existingIds = new Set(data.zones.map(z => z.id));
    this.defaults.zones.forEach(defaultZone => {
      if (!existingIds.has(defaultZone.id)) {
        data.zones.push(JSON.parse(JSON.stringify(defaultZone)));
      }
    });
  },

  _migrateCharacters(data) {
    if (!data.characters) {
      data.characters = JSON.parse(JSON.stringify(this.defaults.characters));
      return;
    }
    const existingIds = new Set(data.characters.map(c => c.id));
    this.defaults.characters.forEach(defaultChar => {
      if (!existingIds.has(defaultChar.id)) {
        data.characters.push(JSON.parse(JSON.stringify(defaultChar)));
      }
    });
    // Migration: add speed to existing characters that predate this field.
    data.characters.forEach(c => {
      if (c.baseStats.speed === undefined) c.baseStats.speed = 10;
    });
  },

  save(data) {
    try {
      localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error('EditorData.save failed:', err);
      return false;
    }
  },

  reset() {
    return this.save(JSON.parse(JSON.stringify(this.defaults)));
  },

  getStaticEncounters() {
    const data = this.load();
    return data.encounters.filter(e => e.type === 'static');
  },

  /**
   * Static encounters placed on the given map: 'map' (MapScene) or
   * 'dungeon' (DungeonScene). Defaults to both when appearsIn is absent
   * (e.g. the built-in defaults, which skip migration).
   */
  getStaticEncountersFor(mapId) {
    return this.getStaticEncounters().filter(e =>
      !Array.isArray(e.appearsIn) || e.appearsIn.includes(mapId));
  },

  getEncounter(id) {
    const data = this.load();
    return data.encounters.find(e => e.id === id) || null;
  },

  /**
   * Builds the starting inventory array from the editor's consumables
   * catalog — any consumable with startingQuantity > 0 gets included.
   * Used by createDefaultInventory() in gameState.js so New Game
   * always reflects the current editor state.
   */
  getStartingConsumables() {
    const data = this.load();
    return (data.consumables || [])
      .filter(c => c.startingQuantity > 0)
      .map(c => ({ name: c.name, quantity: c.startingQuantity }));
  },

  /**
   * Returns the full consumable definition for a given id, or null.
   * Used when a consumable is actually used (e.g. Potion) to look up
   * its effect parameters rather than hardcoding heal amounts.
   */
  getConsumable(id) {
    const data = this.load();
    return (data.consumables || []).find(c => c.id === id) || null;
  },

  /**
   * Returns a consumable definition by name (less stable than by id,
   * but useful when resolving items already in the player's inventory
   * which are stored by name, not id).
   */
  getConsumableByName(name) {
    const data = this.load();
    return (data.consumables || []).find(c => c.name === name) || null;
  },

  /**
   * Returns equipment items with startingOwned: true, converted to
   * the inventory shape the game expects. The bonus array is kept as-
   * is — getEffectiveStats() now handles both the old object format
   * (from save files) and the new array format (from EditorData).
   */
  getStartingEquipment() {
    const data = this.load();
    return (data.equipment || [])
      .filter(e => e.startingOwned)
      .map(e => ({
        name: e.name,
        quantity: 1,
        slot: e.slot,
        bonus: e.bonus, // array of {stat, amount}
      }));
  },

  getEquipmentByName(name) {
    const data = this.load();
    return (data.equipment || []).find(e => e.name === name) || null;
  },

  /**
   * Returns all character definitions — used by createDefaultParty()
   * in gameState.js to build the starting party from EditorData
   * rather than hardcoded values.
   */
  getCharacters() {
    const data = this.load();
    return data.characters || JSON.parse(JSON.stringify(this.defaults.characters));
  },

  getCharacter(id) {
    const data = this.load();
    return (data.characters || []).find(c => c.id === id) || null;
  },

  getNpcs() {
    return this.load().npcs || JSON.parse(JSON.stringify(this.defaults.npcs));
  },

  getNpc(id) {
    return this.getNpcs().find(n => n.id === id) || null;
  },

  getZone(id) {
    const data = this.load();
    return (data.zones || []).find(z => z.id === id) || null;
  },

  /**
   * Returns the array of encounter ids for random encounters in the
   * given zone, or an empty array if the zone is disabled or not found.
   */
  getRandomEncounterIds(zoneId) {
    const zone = this.getZone(zoneId);
    if (!zone || !zone.enabled) return [];
    return zone.randomEncounters || [];
  },

  /**
   * Returns a random encounter id from the given zone's table, or null
   * if the zone has no random encounters configured.
   */
  pickRandomEncounterId(zoneId) {
    const ids = this.getRandomEncounterIds(zoneId);
    if (!ids.length) return null;
    return ids[Math.floor(Math.random() * ids.length)];
  },

  selectAbility(abilities) {
    if (!abilities || abilities.length === 0) return null;
    const totalWeight = abilities.reduce((sum, a) => sum + (a.weight || 1), 0);
    let roll = Math.random() * totalWeight;
    for (const ability of abilities) {
      roll -= (ability.weight || 1);
      if (roll <= 0) return ability;
    }
    return abilities[abilities.length - 1];
  },
};

