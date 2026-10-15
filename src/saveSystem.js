/**
 * saveSystem.js
 * -------------
 * Handles writing/reading GameState snapshots to persistent storage.
 * Currently backed by localStorage, but every method here is written
 * against an abstract "slot" concept rather than localStorage
 * specifics — the intent is that swapping to a server-backed save
 * system later (per the roadmap) means rewriting the bodies of these
 * functions, not changing every call site across the codebase that
 * uses them.
 *
 * Save data shape (the "snapshot"):
 *   {
 *     party: [...],       // same shape as GameState.party
 *     inventory: [...],   // same shape as GameState.inventory
 *     savedAt: <timestamp> // when this slot was last written
 *   }
 *
 * Deliberately NOT included: player map position, current scene,
 * or anything battle-in-progress — per the agreed scope, loading a
 * save always resumes from the default map start point.
 */
const SaveSystem = {
  NUM_SLOTS: 3,               // manual slots, numbered 1..NUM_SLOTS
  AUTO_SAVE_SLOT: 'auto',     // dedicated autosave slot — never shared with a manual slot
                              // (stored under the key rpg-save-slot-auto)

  /** Every slot id that can hold a save: the manual slots, then the autosave. */
  slotIds() {
    const ids = [];
    for (let i = 1; i <= this.NUM_SLOTS; i++) ids.push(i);
    ids.push(this.AUTO_SAVE_SLOT);
    return ids;
  },

  /** Builds the localStorage key for a given slot number (1-indexed). */
  _keyForSlot(slotNumber) {
    return `rpg-save-slot-${slotNumber}`;
  },

  /**
   * Writes the current GameState into the given slot. Stores a deep
   * copy (via JSON stringify/parse) rather than a live reference —
   * once saved, a slot's data should never silently change just
   * because GameState kept mutating afterward.
   */
  saveToSlot(slotNumber) {
    const snapshot = {
      party: GameState.party,
      inventory: GameState.inventory,
      savedAt: Date.now(),
      gameVersion: (typeof BUILD_INFO !== 'undefined') ? BUILD_INFO.version : null, // for troubleshooting old saves
    };

    try {
      localStorage.setItem(this._keyForSlot(slotNumber), JSON.stringify(snapshot));
      return true;
    } catch (err) {
      // Can genuinely fail (storage disabled, quota exceeded, private
      // browsing restrictions in some browsers) — callers should
      // check the return value rather than assume success.
      console.error('Save failed:', err);
      return false;
    }
  },

  /**
   * Reads a slot's snapshot without modifying GameState. Returns null
   * if the slot is empty or its data can't be parsed (e.g. corrupted
   * or from an incompatible older save format).
   */
  readSlot(slotNumber) {
    try {
      const raw = localStorage.getItem(this._keyForSlot(slotNumber));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      console.error('Read failed for slot', slotNumber, err);
      return null;
    }
  },

  /**
   * Loads a slot's snapshot INTO GameState, replacing current party
   * and inventory entirely. Returns true on success, false if the
   * slot was empty/corrupted (GameState is left untouched in that
   * case, rather than partially overwritten).
   */
  loadFromSlot(slotNumber) {
    const snapshot = this.readSlot(slotNumber);
    if (!snapshot) return false;

    GameState.party = snapshot.party;
    GameState.inventory = snapshot.inventory;

    // Forward-migration: add row field to party members saved before
    // front/back row was added. Preserve existing row values if present
    // (player may have changed them); only fill in the default when absent.
    GameState.party.forEach((member, i) => {
      if (member.row === undefined) {
        member.row = i < 2 ? 'front' : 'back';
      }
    });

    return true;
  },

  /** Returns true if the given slot has any saved data at all. */
  slotExists(slotNumber) {
    return this.readSlot(slotNumber) !== null;
  },

  /**
   * Returns true if ANY slot has data — used by TitleScene to decide
   * whether to offer "Continue" at all.
   */
  anySaveExists() {
    return this.slotIds().some((id) => this.slotExists(id));
  },

  /**
   * Returns the slot number with the most recent savedAt timestamp,
   * or null if no slots have data. Used by "Continue" on the title
   * screen to pick the right save without the player needing to
   * remember which slot they last used.
   */
  mostRecentSlot() {
    let bestSlot = null;
    let bestTime = -Infinity;

    for (const id of this.slotIds()) {
      const snapshot = this.readSlot(id);
      if (snapshot && snapshot.savedAt > bestTime) {
        bestTime = snapshot.savedAt;
        bestSlot = id;
      }
    }

    return bestSlot;
  },
};
