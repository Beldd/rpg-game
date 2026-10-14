/**
 * gameState.js
 * ------------
 * Holds data that needs to persist across scene transitions — most
 * importantly, the party's HP/MP/spells, which previously lived only
 * inside BattleScene and got recreated fresh every time a battle
 * started. That meant HP and MP silently reset to full before every
 * fight, with no way to carry damage (or recovery) between battles.
 *
 * This is a plain object, not a class — there's only ever one of it,
 * loaded once as a script before any scene runs, and every scene that
 * needs party data reads/writes GameState.party directly rather than
 * keeping its own local copy. This is intentionally the simplest
 * possible shared-state mechanism; if the game grows enough to need
 * save/load to a file or localStorage-equivalent, this object is the
 * thing that would get serialized.
 *
 * createDefaultParty()/createDefaultInventory() are factored out as
 * their own functions (rather than just being inlined into the
 * GameState object literal below) so the exact same default data can
 * be reused by resetToNewGame() — without this, "New Game" would need
 * its own separately-maintained copy of the starting party/inventory,
 * which would risk silently drifting out of sync with the real
 * defaults as new items/spells get added over time.
 */
function createDefaultParty() {
  // Read character definitions from EditorData so the character editor
  // controls names, base stats, and spell lists. Falls back to hardcoded
  // defaults if EditorData isn't available (e.g. Node.js test context).
  if (typeof EditorData !== 'undefined') {
    return EditorData.getCharacters().map((charDef, i) => ({
      name: charDef.name,
      hp: charDef.startingHp,
      maxHp: charDef.startingHp,
      mp: charDef.startingMp,
      maxMp: charDef.startingMp,
      level: 1,
      xp: 0,
      baseStats: { ...charDef.baseStats },
      spells: charDef.spells.map(s => ({ ...s })),
      equipment: { primary: null, secondary: null, body: null, head: null },
      activeDebuffs: [], // cleared on battle end, never persisted to saves
      // Front row = slots 0–1, back row = slots 2–4. Front row deals
      // and receives full damage; back row deals/receives 50%.
      row: i < 2 ? 'front' : 'back',
    }));
  }

  // Hardcoded fallback — kept in sync with the EditorData defaults
  // above for non-browser contexts (Node.js syntax checks, etc.).
  return [
    {
      name: 'Hero', hp: 30, maxHp: 30, mp: 15, maxMp: 15,
      level: 1, xp: 0,
      baseStats: { attackMin: 4, attackMax: 8, defense: 0, speed: 10 },
      spells: [
        { name: 'Fire',            cost: 6, type: 'offense',         min: 8, max: 14 },
        { name: 'Drain',           cost: 6, type: 'drain',           multiplier: 1.25, selfHealPercent: 0.2 },
        { name: 'Expose Weakness', cost: 3, type: 'debuff',          durationTurns: 3 },
      ],
      equipment: { primary: null, secondary: null, body: null, head: null },
      activeDebuffs: [],
      row: 'front',
    },
    {
      name: 'Ally', hp: 24, maxHp: 24, mp: 12, maxMp: 12,
      level: 1, xp: 0,
      baseStats: { attackMin: 3, attackMax: 7, defense: 0, speed: 10 },
      spells: [
        { name: 'Heal',  cost: 5, type: 'heal',            min: 10, max: 16 },
        { name: 'Smite', cost: 7, type: 'attackMultiplier', multiplier: 2.0 },
      ],
      equipment: { primary: null, secondary: null, body: null, head: null },
      activeDebuffs: [],
      row: 'front',
    },
  ];
}

/**
 * Placeholder inventory items. Items with a `slot` field are
 * equippable (and only ever exist with quantity 1 in this first
 * pass — no stacking of equipment, unlike Potion/Antidote which can
 * stack). Items without `slot` are plain consumables/key items with
 * no equip behavior. `bonus` defines what stats the item adds while
 * equipped — note that `slot` controls WHERE an item is worn, while
 * `bonus` controls WHAT it does; a future offhand weapon could use
 * slot: 'secondary' with an attack bonus instead of defense, without
 * needing any new item "type" concept.
 */
function createDefaultInventory() {
  // Both consumables and equipment now come from EditorData so the
  // items editor controls what the player starts with. The typeof
  // guard handles the case where this runs before EditorData loads
  // (e.g. in a Node.js test context).
  const consumables = (typeof EditorData !== 'undefined')
    ? EditorData.getStartingConsumables()
    : [
        { name: 'Potion', quantity: 3 },
        { name: 'Antidote', quantity: 1 },
      ];

  const equipment = (typeof EditorData !== 'undefined')
    ? EditorData.getStartingEquipment()
    : [
        { name: 'Sword',    quantity: 1, slot: 'primary',   bonus: [{ stat: 'attackMin', amount: 3 }, { stat: 'attackMax', amount: 3 }] },
        { name: 'Shield',   quantity: 1, slot: 'secondary', bonus: [{ stat: 'defense', amount: 3 }] },
        { name: 'Mail',     quantity: 1, slot: 'body',      bonus: [{ stat: 'defense', amount: 2 }] },
        { name: 'Helm',     quantity: 1, slot: 'head',      bonus: [{ stat: 'defense', amount: 2 }] },
        { name: 'Mace',     quantity: 1, slot: 'primary',   bonus: [{ stat: 'attackMin', amount: 3 }, { stat: 'attackMax', amount: 3 }] },
        { name: 'Buckler',  quantity: 1, slot: 'secondary', bonus: [{ stat: 'defense', amount: 3 }] },
        { name: 'Robes',    quantity: 1, slot: 'body',      bonus: [{ stat: 'defense', amount: 2 }] },
        { name: 'Kippah',   quantity: 1, slot: 'head',      bonus: [{ stat: 'defense', amount: 2 }] },
      ];

  return [...consumables, ...equipment];
}

const GameState = {
  party: createDefaultParty(),
  inventory: createDefaultInventory(),

  /**
   * Tracks which static dungeon encounters the player has defeated in the
   * current dungeon "run". Stored here (not on DungeonScene) so it survives
   * the scene being destroyed and recreated on re-entry after a battle.
   * Cleared by resetDungeon() when the player talks to the reset NPC.
   */
  dungeonDefeatedIds: new Set(),

  /**
   * Clears all defeated encounter records, making every static encounter
   * reappear on the next dungeon visit. Called by the reset NPC in MapScene.
   */
  resetDungeon() {
    this.dungeonDefeatedIds = new Set();
  },

  // Templates for what battle victories can drop — NOT live inventory
  // items. Each entry here is a fresh blueprint; dropping one creates
  // a brand new item object (see rollForDrop), never a reference to
  // anything already in the party's inventory or equipped slots. Per
  // the agreed scope, duplicates (e.g. a second Sword) are allowed —
  // not handled specially yet.
  dropPool: [
    { name: 'Potion', stackable: true },
    { name: 'Antidote', stackable: true },
    { name: 'Sword', slot: 'primary', bonus: { attackMin: 3, attackMax: 3 } },
    { name: 'Shield', slot: 'secondary', bonus: { defense: 3 } },
  ],

  /**
   * Rolls a chance for a victory drop and, if successful, adds a
   * fresh item to GameState.inventory. Returns the dropped item's
   * name (for the caller to show a message) or null if nothing
   * dropped this time.
   */
  rollForDrop() {
    const DROP_CHANCE = 0.5;
    if (Math.random() >= DROP_CHANCE) return null;

    const template = this.dropPool[Math.floor(Math.random() * this.dropPool.length)];

    if (template.stackable) {
      // If the player already has a stack of this consumable, add to
      // it rather than creating a second separate entry for the same
      // item — keeps the inventory list from accumulating duplicate
      // "Potion" rows over time.
      const existing = this.inventory.find((i) => i.name === template.name);
      if (existing) {
        existing.quantity += 1;
      } else {
        this.inventory.push({ name: template.name, quantity: 1 });
      }
    } else {
      // Equipment: always a fresh object, quantity 1, per the
      // existing convention for equippable items.
      this.inventory.push({
        name: template.name,
        quantity: 1,
        slot: template.slot,
        bonus: { ...template.bonus },
      });
    }

    return template.name;
  },

  /**
   * Same as rollForDrop but uses an externally-supplied pool and
   * chance value (from the editor's encounter definition) rather than
   * the hardcoded global dropPool. This is what makes per-encounter
   * drop tables defined in the design tool actually take effect.
   */
  rollForDropFromPool(pool, dropChance) {
    if (!pool || pool.length === 0) return null;
    if (Math.random() >= dropChance) return null;

    const template = pool[Math.floor(Math.random() * pool.length)];

    if (template.stackable) {
      const existing = this.inventory.find((i) => i.name === template.name);
      if (existing) {
        existing.quantity += 1;
      } else {
        this.inventory.push({ name: template.name, quantity: 1 });
      }
    } else {
      // Non-stackable item (equipment). The drop pool entry only stores
      // name/weight/stackable — it doesn't carry slot or bonus. Look up
      // the full definition from EditorData so the dropped item has the
      // correct slot and bonus array and can actually be equipped.
      const def = EditorData.getEquipmentByName(template.name);
      this.inventory.push({
        name: template.name,
        quantity: 1,
        slot: def ? def.slot : template.slot,
        bonus: def ? def.bonus : (template.bonus || undefined),
      });
    }

    return template.name;
  },

  /**
   * Computes a character's effective stats — base stats plus the sum
   * of bonuses from everything currently equipped. This is the ONLY
   * place battle code should get attackMin/attackMax/defense from;
   * reading character.baseStats directly anywhere else would silently
   * ignore equipment bonuses.
   *
   * Returns a fresh plain object each call rather than mutating
   * anything, so callers can't accidentally corrupt baseStats by
   * modifying the result.
   */
  getEffectiveStats(character) {
    const effective = { ...character.baseStats };

    Object.values(character.equipment).forEach((item) => {
      if (!item || !item.bonus) return;

      // Support both the new array format from EditorData
      // ({ bonus: [{stat, amount}] }) and the old plain-object format
      // that may exist in older save files ({ bonus: {attackMin: 3} }).
      if (Array.isArray(item.bonus)) {
        item.bonus.forEach(({ stat, amount }) => {
          effective[stat] = (effective[stat] || 0) + amount;
        });
      } else {
        Object.entries(item.bonus).forEach(([stat, amount]) => {
          effective[stat] = (effective[stat] || 0) + amount;
        });
      }
    });

    // Apply active battle debuffs. These are temporary, combat-only
    // effects stored directly on the character (same pattern as
    // equipment bonuses) so getEffectiveStats picks them up without
    // needing extra parameters. BattleScene clears them on returnToMap
    // so they never persist outside combat.
    (character.activeDebuffs || []).forEach(({ stat, amount }) => {
      effective[stat] = (effective[stat] || 0) - amount; // debuffs reduce stats
    });

    return effective;
  },

  /**
   * XP needed to advance FROM the given level to the next one. Flat
   * threshold per the current design (always 50, regardless of
   * level) — level 2 always takes exactly 5 kills at 10 XP each,
   * forever. Kept as its own function (rather than a bare constant
   * inlined elsewhere) so switching to a scaling curve later is a
   * one-place change.
   */
  xpThresholdForLevel(level) {
    return 50;
  },

  /**
   * Adds XP to a character and triggers a level-up if the threshold
   * is crossed. Loops (not a single if-check) so a character who
   * somehow gains enough XP to cross multiple thresholds in one grant
   * still levels up the correct number of times, rather than only
   * advancing once and stranding leftover XP that should have
   * triggered a second level-up.
   *
   * Returns { levelUps, newLevel, statGains } where statGains is the
   * CUMULATIVE total across every level-up that happened in this call
   * (e.g. two level-ups in one grant report +10 maxHp, not +5) — the
   * caller only needs one combined message regardless of how many
   * thresholds were crossed.
   */
  awardXp(character, amount) {
    character.xp += amount;
    const statGains = { maxHp: 0, maxMp: 0, attackMin: 0, attackMax: 0 };
    let levelUps = 0;

    while (character.xp >= this.xpThresholdForLevel(character.level)) {
      character.xp -= this.xpThresholdForLevel(character.level);
      const gain = this.levelUp(character);
      statGains.maxHp += gain.maxHp;
      statGains.maxMp += gain.maxMp;
      statGains.attackMin += gain.attackMin;
      statGains.attackMax += gain.attackMax;
      levelUps += 1;
    }

    return { levelUps, newLevel: character.level, statGains };
  },

  /**
   * Applies one level-up's stat growth. Per the current design: fixed
   * amounts every level (no scaling), and only MAX hp/mp increase —
   * current hp/mp are left untouched, consistent with how victory
   * doesn't restore anything either, so leveling doesn't become a
   * sneaky free-heal.
   *
   * Returns the deltas applied, so awardXp() can accumulate them into
   * a single cumulative report across multiple level-ups.
   */
  levelUp(character) {
    const gain = { maxHp: 5, maxMp: 2, attackMin: 1, attackMax: 1 };

    character.level += 1;
    character.maxHp += gain.maxHp;
    character.maxMp += gain.maxMp;
    character.baseStats.attackMin += gain.attackMin;
    character.baseStats.attackMax += gain.attackMax;

    return gain;
  },

  /**
   * Restores every party member to full HP/MP. Called on Game Over
   * restart — a full party wipe is the one point in this game where
   * "reset to a known-good state" is the correct behavior, since
   * there's no save/checkpoint system yet to revive to anything else.
   */
  resetParty() {
    this.party.forEach((member) => {
      member.hp = member.maxHp;
      member.mp = member.maxMp;
    });
  },

  /**
   * Fully resets to a brand-new game: fresh party (level 1, full HP/MP,
   * no equipment) and fresh starting inventory, discarding whatever
   * the current session's state was. Used by the Title screen's "New
   * Game" option — unlike resetParty() (which only restores HP/MP on
   * an existing party after a wipe), this replaces party/inventory
   * entirely, since "New Game" needs to mean a true restart, not a
   * partial recovery.
   */
  resetToNewGame() {
    this.party = createDefaultParty();
    this.inventory = createDefaultInventory();
  },

  /**
   * Equips the given item (an object reference from GameState.inventory)
   * onto the given character's matching slot. If that slot already has
   * something equipped, it's automatically unequipped back to the
   * inventory first — swapping rather than requiring the player to
   * manually unequip before equipping something new.
   *
   * The item is removed from inventory by decrementing its quantity
   * (and removing the entry entirely if it hits 0), since equipment
   * items in this pass only ever have quantity 1 — there's no
   * "equip one of three Potions" scenario to worry about yet.
   */
  equipItem(character, item) {
    const slot = item.slot;
    if (!slot) return; // not an equippable item, do nothing

    if (character.equipment[slot]) {
      this.unequipItem(character, slot);
    }

    character.equipment[slot] = item;
    this.removeFromInventory(item);
  },

  /**
   * Unequips whatever is in the given slot for the given character,
   * returning it to the inventory list. Does nothing if the slot is
   * already empty.
   */
  unequipItem(character, slot) {
    const item = character.equipment[slot];
    if (!item) return;

    character.equipment[slot] = null;
    this.addToInventory(item);
  },

  /**
   * Removes one unit of the given item from inventory. Since
   * equipment items always have quantity 1 in this pass, this simply
   * removes the entry entirely rather than implementing general
   * stack-decrementing logic that nothing else currently needs.
   */
  removeFromInventory(item) {
    const index = this.inventory.indexOf(item);
    if (index !== -1) {
      this.inventory.splice(index, 1);
    }
  },

  /** Adds an item back to the inventory list (used by unequipItem). */
  addToInventory(item) {
    this.inventory.push(item);
  },
};
