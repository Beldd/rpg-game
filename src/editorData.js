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
  defaults: {
    encounters: [
      {
        id: 'slime_01',
        name: 'Slime',
        type: 'static',
        mapPosition: { tileX: 14, tileY: 9 },
        stats: {
          hp: 25,
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

  load() {
    try {
      const raw = localStorage.getItem(EDITOR_STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(this.defaults));
      const stored = JSON.parse(raw);
      this._migrateEncounters(stored);
      this._migrateConsumables(stored);
      this._migrateEquipment(stored);
      this._migrateCharacters(stored);
      return stored;
    } catch (err) {
      console.error('EditorData.load failed, returning defaults:', err);
      return JSON.parse(JSON.stringify(this.defaults));
    }
  },

  _migrateEncounters(data) {
    if (!data.encounters) return;
    const defaultEnc = this.defaults.encounters[0];
    data.encounters.forEach(enc => {
      if (enc.type === undefined) enc.type = 'static';
      if (enc.mapPosition === undefined) enc.mapPosition = { tileX: 14, tileY: 9 };
      if (!enc.abilities || enc.abilities.length === 0) {
        enc.abilities = JSON.parse(JSON.stringify(defaultEnc.abilities));
      }
      if (enc.stats.speed === undefined) enc.stats.speed = 8;
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

