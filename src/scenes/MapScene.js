/**
 * MapScene
 * --------
 * Loads a tileset image + a Tiled-format JSON map, and renders it.
 * This is intentionally static — no player, no movement yet. The goal
 * of this step is just to prove the tilemap pipeline works in isolation,
 * so if something looks wrong, we know it's a tileset/map problem and
 * not tangled up with player/sprite code.
 */
class MapScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MapScene' });

    // Tile size in pixels — must match tileset.png and map.json
    this.TILE_SIZE = 16;

    // Which tile values count as "blocked" (can't walk onto them).
    // Kenney tiny_dungeon tile IDs (1-based, but 0 = empty/void):
    //   0  = empty (no tile) → border void, treated as blocked
    //  27  = wall divider row  → blocked
    //  41  = detailed floor    → walkable
    //  50  = stone floor       → walkable
    this.BLOCKED_TILES = [0, 27];

    // Tracks whether the player is currently mid-slide between tiles.
    // While true, new movement input is ignored — this is what makes
    // movement feel "grid-locked" rather than letting inputs queue up
    // and cause the player to drift off-grid.
    this.isMoving = false;

    // Dialogue system state. While a dialogue box is showing, normal
    // movement input is suppressed (see update()) and dialogue-specific
    // input (Enter, Up/Down for choices) takes over instead.
    // dialogueState is one of: null (no dialogue), 'MESSAGE' (text +
    // dismiss-on-Enter), or 'CHOICE' (text + navigable Accept/Decline
    // style options).
    this.dialogueState = null;
    this.dialogueOptions = [];
    this.dialogueSelectedIndex = 0;

    // Status/Inventory overlay state. statusOverlayOpen gates input
    // the same way dialogueState does — while open, movement and
    // dialogue input are both suppressed (see update()). activeView
    // tracks which of the two pages is currently shown.
    this.statusOverlayOpen = false;
    this.activeView = 'STATUS'; // 'STATUS' | 'INVENTORY' | 'SAVELOAD'

    // Which party member (index into GameState.party) the overlay is
    // currently showing/equipping for. Q/E cycles this in both views.
    this.activeCharacterIndex = 0;

    // Within Inventory view only: which of the two sections currently
    // has navigation focus, and which row is selected within each.
    // Kept as two separate indices (not one shared index) so moving
    // into Items and back to Equipped doesn't lose your place in
    // either list.
    this.inventoryFocusedSection = 'EQUIPPED'; // 'EQUIPPED' | 'ITEMS'
    this.equippedSelectedIndex = 0;
    this.itemsSelectedIndex = 0;

    // Save/Load view state. saveLoadMode is toggled with Space;
    // saveLoadSelectedIndex picks among the 3 slots (0-indexed here,
    // converted to 1-indexed slot numbers when calling SaveSystem).
    // pendingLoadConfirm holds the slot number awaited confirmation
    // for for an in-progress Load (via the reused dialogue-choice
    // system) — null when no confirmation is pending.
    this.saveLoadMode = 'SAVE'; // 'SAVE' | 'LOAD'
    this.saveLoadSelectedIndex = 0;
    this.pendingLoadConfirm = null;

    // Consumable use state: set when a consumable with an effect is
    // selected from the Items list, waiting for target selection.
    // null when not in target-selection mode.
    // Shape: { item, selectedTargetIndex }
    this.consumableTargetState = null;
  }

  preload() {
    // Phaser's tilemap loader needs two things:
    // 1. The Kenney tiny_dungeon packed tileset (192×176, 12×11, no spacing)
    this.load.image('tiles', 'assets/kenny/tiny_dungeon/Tilemap/tilemap_packed.png');

    // 2. The map JSON describing which tile goes where
    //    'tilemapTiledJSON' tells Phaser to parse it as Tiled-format data
    this.load.tilemapTiledJSON('map', 'assets/map.json');

    // 3. The player sprite (placeholder red square for now)
    this.load.image('player', 'assets/player.png');

    // 4. The enemy sprite (placeholder purple diamond for now)
    this.load.image('enemy', 'assets/enemy.png');
  }

  create() {
    // Defensive reset: ensure the text overlay is fully visible,
    // regardless of what opacity the previous scene left it at.
    domText.fadeIn();

    // Black background so empty (void) tile borders show as black rather
    // than the default Phaser grey.
    this.cameras.main.setBackgroundColor('#000000');

    // Build the tilemap object from the loaded JSON
    const map = this.make.tilemap({ key: 'map' });

    // Tell the map which loaded image corresponds to which tileset
    // name referenced inside the JSON (we called it "placeholder" there)
    const tileset = map.addTilesetImage('kenney_tiny_dungeon', 'tiles');

    // Create a visual layer from the "ground" layer defined in the JSON.
    // Store it on `this` so update() can later ask it "what tile is at
    // this position?" for collision checks.
    this.groundLayer = map.createLayer('ground', tileset, 0, 0);
    this.map = map;

    // --- Player setup ---
    // Start the player in the town plaza (clear floor, away from buildings).
    // Tile coords -> pixel coords: multiply by TILE_SIZE.
    // We add TILE_SIZE/2 to center the sprite within the tile rather
    // than aligning its top-left corner to the tile's top-left corner.
    const startTileX = 5;
    const startTileY = 13;
    this.player = this.add.image(
      startTileX * this.TILE_SIZE + this.TILE_SIZE / 2,
      startTileY * this.TILE_SIZE + this.TILE_SIZE / 2,
      'player'
    );

    // Track the player's current position in TILE coordinates (not
    // pixels) — this is the source of truth for collision checks and
    // grid-snapping. Pixel position is just a visual side effect.
    this.playerTileX = startTileX;
    this.playerTileY = startTileY;

    // --- Camera setup ---
    // startFollow() tells Phaser to keep the camera centered on the
    // player sprite as it moves. The lerp values (0.1, 0.1) make the
    // camera ease toward the target rather than snapping instantly —
    // lower = smoother/slower follow. For grid-locked movement a
    // slightly higher value (0.15) keeps it tight without feeling laggy.
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    // setBounds clamps the camera so it never shows outside the map.
    // Arguments: x, y, width, height — all in pixels.
    this.cameras.main.setBounds(
      0, 0,
      map.widthInPixels,
      map.heightInPixels
    );

    // --- Input setup ---
    // Phaser's built-in helper for arrow key state tracking
    this.cursors = this.input.keyboard.createCursorKeys();

    // --- Encounter setup ---
    // Load all static encounters from EditorData and spawn a sprite
    // for each one. Each encounter is tracked as an object with its
    // id (for BattleScene to look up the full definition), tile
    // position (for collision detection), and a sprite reference.
    // This replaces the single hardcoded enemyTileX/Y pair — any
    // number of encounters can now be placed via the editor without
    // touching this code.
    this.staticEncounters = EditorData.getStaticEncounters().map(enc => ({
      id: enc.id,
      tileX: enc.mapPosition.tileX,
      tileY: enc.mapPosition.tileY,
      sprite: this.add.image(
        enc.mapPosition.tileX * this.TILE_SIZE + this.TILE_SIZE / 2,
        enc.mapPosition.tileY * this.TILE_SIZE + this.TILE_SIZE / 2,
        'enemy'
      ),
    }));

    // The id of whichever encounter was triggered — passed to
    // BattleScene so it knows which definition to load.
    this.activeEncounterId = null;

    // Guard flag so we don't trigger the battle transition more than
    // once if update() fires again before the scene actually switches.
    this.encounterTriggered = false;

    // --- Dialogue box UI ---
    // Built once here, hidden by default, and shown/repositioned by
    // showDialogue() when needed. A dark semi-opaque box behind the
    // text makes it readable over the map regardless of what tiles
    // are underneath it. Centered vertically (not bottom-anchored)
    // since a bottom-anchored box was easy to miss when it first
    // appeared — center placement is much harder not to notice.
    const { width, height } = this.cameras.main;
    const dialogueBoxY = height / 2;
    const dialogueBoxW = width - 60;
    const dialogueBoxH = 90;

    this.dialogueBoxBg = this.add.rectangle(width / 2, dialogueBoxY, dialogueBoxW, dialogueBoxH, 0x000000, 0.85)
      .setOrigin(0.5)
      .setScrollFactor(0)   // stays fixed on screen regardless of camera position
      .setVisible(false);

    this.dialogueTextEl = domText.create(width / 2, dialogueBoxY - 14, '', {
      fontSize: 12,
      color: '#ffffff',
      align: 'center',
    });
    this.dialogueTextEl.style.display = 'none';
    // Allow the dialogue text to wrap onto multiple lines rather than
    // overflowing off the sides of the box — our other text elements
    // are all short single-line labels, but dialogue lines are
    // genuinely long sentences.
    this.dialogueTextEl.style.whiteSpace = 'normal';
    this.dialogueTextEl.style.width = `${(dialogueBoxW - 20) * domText.ZOOM}px`;

    // Choice menu elements (Accept/Decline) are created fresh each
    // time a choice dialogue opens, same pattern as BattleScene's
    // renderMenu() — see openChoiceDialogue().
    this.dialogueChoiceTexts = [];
    this.dialogueCursorEl = null;

    // Enter is reused for both "dismiss message" and "confirm choice."
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // --- Status/Inventory overlay UI ---
    // A larger full-screen-ish panel, built once and hidden by
    // default. Unlike the dialogue box (which is small, anchored to
    // the bottom, and meant to coexist with seeing the map), this
    // overlay covers most of the screen since the player isn't meant
    // to be doing anything else while it's open.
    this.statusOverlayBg = this.add.rectangle(width / 2, height / 2, width, height, 0x101018, 0.95)
      .setOrigin(0.5)
      .setScrollFactor(0)   // stays fixed on screen regardless of camera position
      .setVisible(false);

    this.statusTitleEl = domText.create(20, 16, 'STATUS', { fontSize: 14, color: '#ffff00', align: 'left' });
    this.statusTitleEl.style.display = 'none';

    this.statusHintEl = domText.create(20, 32, 'Q/E:char  TAB:view  I/ESC:close', { fontSize: 8, color: '#888888', align: 'left' });
    this.statusHintEl.style.display = 'none';

    // Content elements (character stat lines, inventory item lines)
    // are rebuilt every time the overlay opens or switches views,
    // same pattern as the battle/dialogue menus — see
    // renderStatusView() and renderInventoryView() below.
    this.statusContentEls = [];

    // I opens/closes the overlay; Tab switches views while it's open;
    // Q/E switches the active character in either view.
    this.statusKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.tabKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.qKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.eKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    console.log(`Map loaded: ${map.width}x${map.height} tiles`);
  }

  /**
   * Returns true if the given tile coordinate is outside the map
   * bounds or contains a tile we've marked as blocked.
   */
  isTileBlocked(tileX, tileY) {
    // Outside the map entirely counts as blocked, so the player can't
    // walk off the edge of the world.
    if (tileX < 0 || tileY < 0 || tileX >= this.map.width || tileY >= this.map.height) {
      return true;
    }

    // getTileAt returns a Phaser Tile object; .index is the same
    // 1-based value we wrote into map.json's data array.
    const tile = this.groundLayer.getTileAt(tileX, tileY);
    if (!tile) return true; // no tile here at all = treat as blocked

    return this.BLOCKED_TILES.includes(tile.index);
  }

  /**
   * Attempts to move the player by one tile in the given direction.
   * Does nothing if already mid-move, or if the destination is blocked.
   */
  tryMove(dx, dy) {
    if (this.isMoving || this.encounterTriggered) return; // ignore input mid-slide or after a battle trigger

    const targetTileX = this.playerTileX + dx;
    const targetTileY = this.playerTileY + dy;

    // Check all static encounters BEFORE the wall/water check.
    // Walking into any encounter's tile triggers a battle for that
    // specific encounter — activeEncounterId is stored so BattleScene
    // knows which definition to load.
    const hitEncounter = this.staticEncounters.find(
      enc => enc.tileX === targetTileX && enc.tileY === targetTileY
    );
    if (hitEncounter) {
      this.activeEncounterId = hitEncounter.id;
      this.startEncounter();
      return;
    }

    if (this.isTileBlocked(targetTileX, targetTileY)) {
      return; // blocked — don't move, don't even start an animation
    }

    this.isMoving = true;
    this.playerTileX = targetTileX;
    this.playerTileY = targetTileY;

    // Animate the slide from current pixel position to the new tile's
    // pixel position over a short duration, rather than teleporting —
    // this is what makes grid-locked movement still look smooth.
    this.tweens.add({
      targets: this.player,
      x: targetTileX * this.TILE_SIZE + this.TILE_SIZE / 2,
      y: targetTileY * this.TILE_SIZE + this.TILE_SIZE / 2,
      duration: 150,
      onComplete: () => {
        this.isMoving = false;
      },
    });
  }

  /**
   * Shows a single-line (or wrapped multi-line) message with no
   * choices — the player presses Enter to dismiss it and movement
   * resumes. Used for the NPC's dialogue.
   */
  showMessageDialogue(text) {
    this.dialogueState = 'MESSAGE';
    this.dialogueBoxBg.setVisible(true);
    this.dialogueTextEl.style.display = 'block';
    domText.setText(this.dialogueTextEl, text);
  }

  /**
   * Shows a message with a navigable list of choices (e.g.
   * Accept/Decline). Each option is { label, action }, same pattern
   * as BattleScene's menu — action is called when Enter confirms that
   * choice. Used for the monster's challenge.
   */
  openChoiceDialogue(text, options) {
    this.dialogueState = 'CHOICE';
    this.dialogueOptions = options;
    this.dialogueSelectedIndex = 0;

    // If the status overlay is open behind this dialogue (e.g. a Load
    // confirmation triggered from Save/Load view), its text content
    // is DOM-rendered and sits in a layer ABOVE the canvas-based
    // dialogue box — no amount of dialogue background opacity can
    // cover DOM text, since opacity only affects the canvas layer
    // beneath it. Clearing the overlay's text (but leaving its dark
    // background visible) avoids both problems: no see-through text,
    // and no jarring flash back to the map while the dialogue is up.
    if (this.statusOverlayOpen) {
      this.clearStatusContent();
    }

    this.dialogueBoxBg.setVisible(true);
    this.dialogueTextEl.style.display = 'block';
    domText.setText(this.dialogueTextEl, text);

    this.renderDialogueChoices();
  }

  /**
   * Builds (or rebuilds) the choice option text elements and cursor.
   * Called once when a choice dialogue opens — unlike BattleScene's
   * menu, these choices don't change after being shown, so this only
   * needs to run a single time per dialogue rather than per navigation.
   */
  renderDialogueChoices() {
    const { width, height } = this.cameras.main;
    const slotWidth = 70;
    const startX = width / 2 - (this.dialogueOptions.length * slotWidth) / 2 + 16;
    const y = height / 2 + 28; // below the message text, still inside the centered box

    this.dialogueChoiceTexts = this.dialogueOptions.map((opt, i) =>
      domText.create(startX + i * slotWidth, y, opt.label, {
        fontSize: 12,
        color: '#ffffff',
        align: 'left',
      })
    );

    this.dialogueCursorEl = domText.create(startX - 16, y, '>', {
      fontSize: 12,
      color: '#ffff00',
      align: 'left',
    });
    this.updateDialogueCursorPosition();
  }

  /** Moves the choice cursor to sit just left of the selected option's slot. */
  updateDialogueCursorPosition() {
    const { width } = this.cameras.main;
    const slotWidth = 70;
    const startX = width / 2 - (this.dialogueOptions.length * slotWidth) / 2 + 16;
    const x = startX - 16 + this.dialogueSelectedIndex * slotWidth;
    this.dialogueCursorEl.style.left = `${x * domText.ZOOM}px`;
  }

  /**
   * Hides the dialogue box and clears any choice elements, returning
   * control to normal map movement. Called after a message is
   * dismissed, or after a choice's action has been triggered.
   */
  closeDialogue() {
    this.dialogueState = null;
    this.dialogueBoxBg.setVisible(false);
    this.dialogueTextEl.style.display = 'none';

    this.dialogueChoiceTexts.forEach((el) => domText.remove(el));
    this.dialogueChoiceTexts = [];
    if (this.dialogueCursorEl) {
      domText.remove(this.dialogueCursorEl);
      this.dialogueCursorEl = null;
    }

    // Restore the overlay's content if it's still open behind this
    // dialogue (see openChoiceDialogue) — otherwise the player would
    // be left looking at a blank overlay (background visible, no
    // text) until some unrelated input happened to trigger a re-render.
    if (this.statusOverlayOpen) {
      this.renderActiveView();
    }
  }

  /**
   * Returns true if the player's name, pluralized correctly, accounts
   * for party size — "interloper" vs "interlopers" depending on
   * whether there's 1 or more than 1 party member. The party's actual
   * composition lives in BattleScene, not here, so for now this checks
   * a simple constant; if party size ever becomes dynamic/persistent
   * across scenes, this should read from shared game state instead.
   */
  getInterloperText() {
    const partySize = 2; // Hero + Ally, matches BattleScene's party array
    return partySize > 1 ? 'interlopers' : 'interloper';
  }

  /**
   * Opens the status/inventory overlay, showing whichever view was
   * last active (defaults to STATUS the very first time). Movement
   * and dialogue input are both blocked while this is open — see the
   * early-return check at the top of update().
   */
  openStatusOverlay() {
    this.statusOverlayOpen = true;
    this.statusOverlayBg.setVisible(true);
    this.statusTitleEl.style.display = 'block';
    this.statusHintEl.style.display = 'block';
    this.renderActiveView();
  }

  closeStatusOverlay() {
    this.statusOverlayOpen = false;
    this.statusOverlayBg.setVisible(false);
    this.statusTitleEl.style.display = 'none';
    this.statusHintEl.style.display = 'none';
    this.clearStatusContent();
    this.consumableTargetState = null; // clear any pending target selection
  }

  /** Removes whatever content elements the current view created, without touching the title/hint/background. */
  clearStatusContent() {
    this.statusContentEls.forEach((el) => domText.remove(el));
    this.statusContentEls = [];
  }

  /** Cycles to the next view (Status -> Inventory -> Save/Load -> Status) and re-renders. Called when Tab is pressed while the overlay is open. */
  switchView() {
    const order = ['STATUS', 'INVENTORY', 'SAVELOAD'];
    const currentIndex = order.indexOf(this.activeView);
    this.activeView = order[(currentIndex + 1) % order.length];

    // Reset Inventory navigation to a known state each time we enter
    // it, rather than carrying over a section focus that might no
    // longer make sense (e.g. if Items was empty before but isn't now).
    this.inventoryFocusedSection = 'EQUIPPED';
    this.equippedSelectedIndex = 0;
    this.itemsSelectedIndex = 0;

    // Save/Load view always starts in Save mode with slot 1 selected,
    // regardless of what was selected last time — predictable default
    // rather than carrying over potentially-stale state.
    this.saveLoadMode = 'SAVE';
    this.saveLoadSelectedIndex = 0;

    this.renderActiveView();
  }

  /** Switches the active character (Q/E) and re-renders whichever view is currently showing. */
  switchCharacter(delta) {
    const count = GameState.party.length;
    this.activeCharacterIndex = (this.activeCharacterIndex + delta + count) % count;
    // Same reset rationale as switchView() — a different character's
    // equipment/items are a different list, so stale selection
    // indices from the previous character don't carry meaning.
    this.equippedSelectedIndex = 0;
    this.itemsSelectedIndex = 0;
    this.renderActiveView();
  }

  renderActiveView() {
    this.clearStatusContent();
    const character = GameState.party[this.activeCharacterIndex];

    let title;
    if (this.activeView === 'STATUS') {
      title = `STATUS (${character.name})`;
    } else if (this.activeView === 'INVENTORY') {
      title = `INVENTORY (${character.name})`;
    } else {
      title = 'SAVE / LOAD'; // not per-character, no name suffix
    }
    domText.setText(this.statusTitleEl, title);

    if (this.activeView === 'STATUS') {
      this.renderStatusView(character);
    } else if (this.activeView === 'INVENTORY') {
      this.renderInventoryView(character);
    } else {
      this.renderSaveLoadView();
    }
  }

  /**
   * Shows the active character's core stats. Always renders just one
   * character now (the one selected via Q/E) rather than the whole
   * party at once — this keeps Status and Inventory views consistent
   * in what "active character" means across both.
   */
  renderStatusView(character) {
    const startY = 50;
    const contentStartY = startY + 20;
    const stats = GameState.getEffectiveStats(character);
    const xpNeeded = GameState.xpThresholdForLevel(character.level);

    this.statusContentEls.push(
      domText.create(20, startY, `Level: ${character.level}  (XP: ${character.xp}/${xpNeeded})`, { fontSize: 12, color: '#ffcc33', align: 'left' })
    );
    this.statusContentEls.push(
      domText.create(20, contentStartY, `HP: ${character.hp}/${character.maxHp}`, { fontSize: 12, color: '#33cc66', align: 'left' })
    );
    this.statusContentEls.push(
      domText.create(20, contentStartY + 20, `MP: ${character.mp}/${character.maxMp}`, { fontSize: 12, color: '#3366cc', align: 'left' })
    );
    this.statusContentEls.push(
      domText.create(20, contentStartY + 40, `Attack: ${stats.attackMin}-${stats.attackMax}`, { fontSize: 12, color: '#cccccc', align: 'left' })
    );
    this.statusContentEls.push(
      domText.create(160, contentStartY + 40, `Defense: ${stats.defense}`, { fontSize: 12, color: '#cccccc', align: 'left' })
    );

    // Equipped items, shown for reference only — this view has no
    // cursor/selection of its own. Editing equipment is still done
    // exclusively from Inventory view; this just lets the player see
    // current loadout without switching views.
    const equipStartY = contentStartY + 70;
    const slotLabels = [
      { key: 'primary', label: 'Primary' },
      { key: 'secondary', label: 'Secondary' },
      { key: 'body', label: 'Body' },
      { key: 'head', label: 'Head' },
    ];

    this.statusContentEls.push(
      domText.create(20, equipStartY - 14, 'Equipped:', { fontSize: 10, color: '#888888', align: 'left' })
    );

    slotLabels.forEach((slot, i) => {
      const y = equipStartY + i * 16;
      const item = character.equipment[slot.key];
      this.statusContentEls.push(
        domText.create(32, y, `${slot.label}:`, { fontSize: 12, color: '#aaaaaa', align: 'left' })
      );
      this.statusContentEls.push(
        domText.create(140, y, item ? item.name : '-', { fontSize: 12, color: '#ffffff', align: 'left' })
      );
    });
  }

  /**
   * Shows the active character's equipped items (4 fixed slots) above
   * their available inventory items (equippable items already worn
   * by ANYONE are excluded, since they're not in GameState.inventory
   * anymore — see GameState.equipItem). Enter equips/unequips
   * whichever row has the cursor, depending on which section has
   * focus (this.inventoryFocusedSection).
   */
  renderInventoryView(character) {
    const slotLabels = [
      { key: 'primary', label: 'Primary' },
      { key: 'secondary', label: 'Secondary' },
      { key: 'body', label: 'Body' },
      { key: 'head', label: 'Head' },
    ];

    const equippedStartY = 54;
    const equippedRowHeight = 15;

    this.statusContentEls.push(
      domText.create(20, equippedStartY - 14, 'Equipped:', { fontSize: 10, color: '#888888', align: 'left' })
    );

    slotLabels.forEach((slot, i) => {
      const y = equippedStartY + i * equippedRowHeight;
      const equippedItem = character.equipment[slot.key];
      const isSelected = this.inventoryFocusedSection === 'EQUIPPED' && this.equippedSelectedIndex === i;

      this.statusContentEls.push(
        domText.create(20, y, isSelected ? '>' : ' ', { fontSize: 12, color: '#ffff00', align: 'left' })
      );
      this.statusContentEls.push(
        domText.create(34, y, `${slot.label}:`, { fontSize: 12, color: '#aaaaaa', align: 'left' })
      );
      this.statusContentEls.push(
        domText.create(140, y, equippedItem ? equippedItem.name : '-', { fontSize: 12, color: '#ffffff', align: 'left' })
      );
    });

    // --- Items section ---
    const itemsStartY = equippedStartY + slotLabels.length * equippedRowHeight + 14;
    const itemsRowHeight = 12;

    this.statusContentEls.push(
      domText.create(20, itemsStartY - 14, 'Items:', { fontSize: 10, color: '#888888', align: 'left' })
    );

    if (GameState.inventory.length === 0) {
      this.statusContentEls.push(
        domText.create(34, itemsStartY, '(empty)', { fontSize: 12, color: '#888888', align: 'left' })
      );
      return;
    }

    GameState.inventory.forEach((item, i) => {
      const y = itemsStartY + i * itemsRowHeight;
      const isSelected = this.inventoryFocusedSection === 'ITEMS' && this.itemsSelectedIndex === i;
      const label = item.slot ? item.name : `${item.name} x${item.quantity}`;

      this.statusContentEls.push(
        domText.create(20, y, isSelected ? '>' : ' ', { fontSize: 12, color: '#ffff00', align: 'left' })
      );
      this.statusContentEls.push(
        domText.create(34, y, label, { fontSize: 12, color: '#ffffff', align: 'left' })
      );
    });
  }

  /**
   * Called when Enter is pressed while Inventory view is open. Acts
   * on whichever row currently has the cursor, in whichever section
   * has focus. Equipping and unequipping both go through
   * GameState.equipItem/unequipItem so the inventory-list/slot
   * bookkeeping always happens in one place.
   */
  confirmInventorySelection() {
    const character = GameState.party[this.activeCharacterIndex];
    const slotKeys = ['primary', 'secondary', 'body', 'head'];

    if (this.inventoryFocusedSection === 'EQUIPPED') {
      const slot = slotKeys[this.equippedSelectedIndex];
      GameState.unequipItem(character, slot);
      this.renderActiveView();
      return;
    }

    const item = GameState.inventory[this.itemsSelectedIndex];
    if (!item) return;

    if (item.slot) {
      // Equippable item — existing behavior unchanged.
      GameState.equipItem(character, item);
      this.itemsSelectedIndex = Math.min(
        this.itemsSelectedIndex,
        Math.max(0, GameState.inventory.length - 1)
      );
      this.renderActiveView();
      return;
    }

    // Consumable item — look up its effect definition from EditorData.
    const def = EditorData.getConsumableByName(item.name);
    if (!def || !def.effect) {
      // No wired effect yet (e.g. Antidote) — tell the player rather
      // than silently doing nothing.
      this.showConsumableMessage(`Can't use ${item.name} yet.`);
      return;
    }

    // Open target selection. Left/Right navigates targets, Enter confirms.
    this.consumableTargetState = { item, def, selectedTargetIndex: 0 };
    this.renderConsumableTargetSelection();
  }

  /**
   * Moves the selection cursor within whichever section currently has
   * focus (Equipped's 4 fixed slots, or the Items list's variable
   * length). Wraps around at each section's own boundary rather than
   * sharing a single index across both, since the two sections have
   * different, independent lengths.
   */
  moveInventorySelection(delta) {
    if (this.inventoryFocusedSection === 'EQUIPPED') {
      const slotCount = 4;
      this.equippedSelectedIndex = (this.equippedSelectedIndex + delta + slotCount) % slotCount;
    } else {
      const itemCount = GameState.inventory.length;
      if (itemCount === 0) return; // nothing to navigate to
      this.itemsSelectedIndex = (this.itemsSelectedIndex + delta + itemCount) % itemCount;
    }
    this.renderActiveView();
  }

  /**
   * Shows the current Save/Load mode and 3 slot rows. Each row shows
   * either "(empty)" or a human-readable relative time since that
   * slot was last saved, so the player has some sense of which save
   * is which without needing exact timestamps.
   */
  renderSaveLoadView() {
    const startY = 50;

    this.statusContentEls.push(
      domText.create(20, startY, `Mode: ${this.saveLoadMode}  (Space to switch)`, { fontSize: 12, color: '#ffcc33', align: 'left' })
    );

    const slotStartY = startY + 30;
    const slotRowHeight = 20;

    for (let i = 0; i < SaveSystem.NUM_SLOTS; i++) {
      const slotNumber = i + 1;
      const y = slotStartY + i * slotRowHeight;
      const isSelected = this.saveLoadSelectedIndex === i;
      const isAutoSlot = slotNumber === SaveSystem.AUTO_SAVE_SLOT;

      const snapshot = SaveSystem.readSlot(slotNumber);
      let statusText;
      if (!snapshot) {
        statusText = '(empty)';
      } else {
        const secondsAgo = Math.floor((Date.now() - snapshot.savedAt) / 1000);
        statusText = secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.floor(secondsAgo / 60)}m ago`;
      }

      const label = `Slot ${slotNumber}${isAutoSlot ? ' (auto)' : ''}: ${statusText}`;

      this.statusContentEls.push(
        domText.create(20, y, isSelected ? '>' : ' ', { fontSize: 12, color: '#ffff00', align: 'left' })
      );
      this.statusContentEls.push(
        domText.create(34, y, label, { fontSize: 12, color: '#ffffff', align: 'left' })
      );
    }
  }

  /** Moves the slot selection cursor up/down, wrapping within the 3 slots. */
  moveSaveLoadSelection(delta) {
    const count = SaveSystem.NUM_SLOTS;
    this.saveLoadSelectedIndex = (this.saveLoadSelectedIndex + delta + count) % count;
    this.renderActiveView();
  }

  /**
   * Called when Enter is pressed in Save/Load view. In Save mode,
   * writes immediately (saving is low-risk — at worst you overwrite a
   * slot you didn't mean to, but current progress is untouched). In
   * Load mode, opens a confirmation dialogue first, reusing the same
   * choice-dialogue system built for the monster encounter, since
   * loading destructively overwrites current progress and deserves a
   * deliberate confirm step.
   */
  confirmSaveLoadSelection() {
    const slotNumber = this.saveLoadSelectedIndex + 1;

    if (this.saveLoadMode === 'SAVE') {
      SaveSystem.saveToSlot(slotNumber);
      this.renderActiveView(); // refresh so the slot's "just now" timestamp shows immediately
      return;
    }

    // LOAD mode
    if (!SaveSystem.slotExists(slotNumber)) return; // nothing to load, Enter does nothing

    this.openChoiceDialogue(`Load Slot ${slotNumber}? Current progress will be overwritten.`, [
      { label: 'Load', action: () => this.performLoad(slotNumber) },
      { label: 'Cancel', action: () => this.closeDialogue() },
    ]);
  }

  /**
   * Actually performs the load after confirmation. Gives real visual
   * feedback rather than silently swapping data: closes the
   * confirmation dialogue, shows a "Loaded!" message in place of the
   * slot list, briefly holds so the player can register it succeeded,
   * then fades the whole screen out, closes the overlay entirely, and
   * fades back in on the map with the loaded state already active.
   */
  performLoad(slotNumber) {
    SaveSystem.loadFromSlot(slotNumber);

    // Close just the confirmation dialogue's own UI (not the overlay
    // behind it) — closeDialogue() would normally also restore the
    // Save/Load view via renderActiveView(), but we want to show our
    // own temporary message instead, so we replicate only the
    // dialogue-teardown part here rather than calling closeDialogue().
    this.dialogueState = null;
    this.dialogueBoxBg.setVisible(false);
    this.dialogueTextEl.style.display = 'none';
    this.dialogueChoiceTexts.forEach((el) => domText.remove(el));
    this.dialogueChoiceTexts = [];
    if (this.dialogueCursorEl) {
      domText.remove(this.dialogueCursorEl);
      this.dialogueCursorEl = null;
    }

    this.clearStatusContent();
    domText.setText(this.statusTitleEl, 'SAVE / LOAD');
    this.statusContentEls.push(
      domText.create(this.cameras.main.width / 2, 110, `Loaded Slot ${slotNumber}!`, {
        fontSize: 14,
        color: '#33cc66',
      })
    );

    this.time.delayedCall(900, () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      domText.fadeOut();
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.closeStatusOverlay();
        this.cameras.main.fadeIn(400, 0, 0, 0);
        domText.fadeIn();
      });
    });
  }

  /**
   * Renders a target-selection view over the current Inventory panel,
   * showing all party members with a cursor on the currently selected
   * one. Left/Right moves the cursor, Enter confirms, Escape cancels
   * back to the normal Inventory view.
   */
  renderConsumableTargetSelection() {
    if (!this.consumableTargetState) return;
    const { item, selectedTargetIndex } = this.consumableTargetState;

    this.clearStatusContent();
    domText.setText(this.statusTitleEl, `Use ${item.name} on who?`);

    const startY = 54;
    const rowH = 24;

    this.statusContentEls.push(
      domText.create(20, startY - 16, 'Left/Right: select  Enter: use  Esc: cancel', {
        fontSize: 9, color: '#888888', align: 'left',
      })
    );

    GameState.party.forEach((member, i) => {
      const y = startY + i * rowH;
      const isSelected = selectedTargetIndex === i;
      const hpText = `HP: ${member.hp}/${member.maxHp}`;

      this.statusContentEls.push(
        domText.create(20, y, isSelected ? '>' : ' ', { fontSize: 12, color: '#ffff00', align: 'left' })
      );
      this.statusContentEls.push(
        domText.create(34, y, member.name, { fontSize: 12, color: isSelected ? '#ffffff' : '#888888', align: 'left' })
      );
      this.statusContentEls.push(
        domText.create(140, y, hpText, { fontSize: 12, color: '#33cc66', align: 'left' })
      );
    });
  }

  /** Shows a brief status message in place of the overlay content, then restores after a short delay. */
  showConsumableMessage(msg) {
    this.clearStatusContent();
    this.statusContentEls.push(
      domText.create(this.cameras.main.width / 2, 110, msg, {
        fontSize: 12, color: '#ffcc33',
      })
    );
    this.time.delayedCall(1200, () => {
      if (this.statusOverlayOpen) this.renderActiveView();
    });
  }

  /**
   * Applies the consumable's effect to the selected target, consumes
   * one unit of the item, then closes target selection and refreshes
   * the inventory view.
   */
  applyConsumable() {
    if (!this.consumableTargetState) return;
    const { item, def, selectedTargetIndex } = this.consumableTargetState;
    const target = GameState.party[selectedTargetIndex];

    if (def.effect.type === 'heal') {
      if (target.hp >= target.maxHp) {
        this.consumableTargetState = null;
        this.showConsumableMessage(`${target.name} is already at full HP!`);
        return;
      }
      const healAmount = Math.floor(
        Math.random() * (def.effect.maxAmount - def.effect.minAmount + 1)
      ) + def.effect.minAmount;
      target.hp = Math.min(target.maxHp, target.hp + healAmount);

      // Consume one unit — remove the entry entirely if it hits 0.
      item.quantity -= 1;
      if (item.quantity <= 0) {
        const idx = GameState.inventory.indexOf(item);
        if (idx !== -1) GameState.inventory.splice(idx, 1);
        this.itemsSelectedIndex = Math.max(0, this.itemsSelectedIndex - 1);
      }

      this.consumableTargetState = null;
      this.showConsumableMessage(`${target.name} recovered ${healAmount} HP!`);
    }
  }

  /**
   * Moves the target-selection cursor left or right, wrapping within
   * the party list.
   */
  moveConsumableTarget(delta) {
    if (!this.consumableTargetState) return;
    const count = GameState.party.length;
    this.consumableTargetState.selectedTargetIndex =
      (this.consumableTargetState.selectedTargetIndex + delta + count) % count;
    this.renderConsumableTargetSelection();
  }

  /**
   * Triggered when the player walks into the enemy's tile. Rather than
   * cutting straight to battle, this now opens a choice dialogue —
   * the monster issues its challenge, and the player picks Fight or
   * Flee. Only "Fight" proceeds to actually fade into BattleScene;
   * "Flee" closes the dialogue and lets the player carry on walking.
   */
  startEncounter() {
    this.encounterTriggered = true;

    // Guard against entering a fight with an already-wiped party.
    // Under normal play this shouldn't be reachable — GameOverScene
    // now resets the party to full on restart — but this stays as a
    // defensive check in case some future feature (status effects, a
    // damage tile, etc.) reintroduces a path to 0 HP outside of
    // battle. Redirecting straight to Game Over here is simpler and
    // more correct than opening a "Fight?" dialogue for a fight that
    // literally cannot happen.
    if (GameState.party.every((m) => m.hp <= 0)) {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      domText.fadeOut();
      this.cameras.main.once('camerafadeoutcomplete', () => {
        domText.clearAll();
        this.scene.start('GameOverScene');
      });
      return;
    }

    const encounterDef = EditorData.getEncounter(this.activeEncounterId);
    const rawChallenge = encounterDef
      ? encounterDef.dialogue.challenge
      : "Halt, {interlopers}! You've ruined your own lands, you'll not ruin mine! I, {name}, will knock you all down!";

    // Apply template substitutions: {name} → monster name,
    // {interlopers} → "interloper" or "interlopers" based on party size.
    const encounterName = encounterDef ? encounterDef.name : 'Slime';
    const challengeText = rawChallenge
      .replace(/{name}/g, encounterName)
      .replace(/{interlopers}/g, this.getInterloperText());

    this.openChoiceDialogue(challengeText, [
      { label: 'Fight', action: () => this.acceptChallenge() },
      { label: 'Flee', action: () => this.declineChallenge() },
    ]);
  }

  /** Player chose to fight: close the dialogue, then fade into battle exactly as before. */
  acceptChallenge() {
    this.closeDialogue();

    this.cameras.main.fadeOut(400, 0, 0, 0);
    domText.fadeOut();

    // 'camerafadeoutcomplete' fires once the fade animation finishes.
    // We wait for it rather than using a fixed timer so the fade
    // duration and the scene switch always stay in sync, even if we
    // change the fade duration later.
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('BattleScene', { encounterId: this.activeEncounterId });
    });
  }

  /**
   * Player chose to decline: close the dialogue and reset
   * encounterTriggered so movement resumes and the player can walk
   * away. Unlike accepting, there's no scene transition at all here.
   */
  declineChallenge() {
    this.closeDialogue();
    this.encounterTriggered = false;
  }

  update() {
    // Dialogue (e.g. a Load confirmation opened from within the
    // Save/Load overlay view) takes priority over the overlay itself.
    // This check has to come BEFORE the statusOverlayOpen check below
    // — otherwise, since that block returns unconditionally, a
    // dialogue opened while the overlay is open would never receive
    // its own input at all, leaving Fight/Flee-style confirmations
    // completely unusable from inside the overlay.
    if (this.dialogueState === 'MESSAGE') {
      if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.closeDialogue();
      }
      return;
    }

    if (this.dialogueState === 'CHOICE') {
      if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) {
        this.dialogueSelectedIndex = (this.dialogueSelectedIndex - 1 + this.dialogueOptions.length) % this.dialogueOptions.length;
        this.updateDialogueCursorPosition();
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
        this.dialogueSelectedIndex = (this.dialogueSelectedIndex + 1) % this.dialogueOptions.length;
        this.updateDialogueCursorPosition();
      } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.dialogueOptions[this.dialogueSelectedIndex].action();
      }
      return;
    }

    // The status/inventory overlay takes top priority over normal
    // movement — if it's open (and no dialogue is, per the checks
    // above), it owns all input.
    if (this.statusOverlayOpen) {
      if (Phaser.Input.Keyboard.JustDown(this.qKey)) {
        this.switchCharacter(-1);
      } else if (Phaser.Input.Keyboard.JustDown(this.eKey)) {
        this.switchCharacter(1);
      } else if (Phaser.Input.Keyboard.JustDown(this.tabKey)) {
        this.switchView();
      } else if (Phaser.Input.Keyboard.JustDown(this.statusKey)
        || Phaser.Input.Keyboard.JustDown(this.escKey)) {
        this.closeStatusOverlay();
      } else if (this.activeView === 'INVENTORY') {
        // If we're in consumable target-selection mode, that sub-state
        // owns Left/Right/Enter/Escape — normal inventory navigation is
        // suspended until the player confirms or cancels.
        if (this.consumableTargetState) {
          if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) {
            this.moveConsumableTarget(-1);
          } else if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
            this.moveConsumableTarget(1);
          } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
            this.applyConsumable();
          } else if (Phaser.Input.Keyboard.JustDown(this.escKey)) {
            this.consumableTargetState = null;
            this.renderActiveView();
          }
        } else {
          // Normal inventory navigation.
          if (Phaser.Input.Keyboard.JustDown(this.cursors.left) || Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
            this.inventoryFocusedSection = this.inventoryFocusedSection === 'EQUIPPED' ? 'ITEMS' : 'EQUIPPED';
            this.renderActiveView();
          } else if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
            this.moveInventorySelection(-1);
          } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
            this.moveInventorySelection(1);
          } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
            this.confirmInventorySelection();
          }
        }
      } else if (this.activeView === 'SAVELOAD') {
        // Space toggles Save<->Load mode; Up/Down pick a slot;
        // Enter performs the active mode's action on that slot.
        if (Phaser.Input.Keyboard.JustDown(this.spaceKey)) {
          this.saveLoadMode = this.saveLoadMode === 'SAVE' ? 'LOAD' : 'SAVE';
          this.renderActiveView();
        } else if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
          this.moveSaveLoadSelection(-1);
        } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
          this.moveSaveLoadSelection(1);
        } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
          this.confirmSaveLoadSelection();
        }
      }
      return;
    }

    // I opens the status overlay from normal movement state. Checked
    // here (not earlier) so it only fires when nothing else owns
    // input — pressing I mid-dialogue, for instance, does nothing.
    if (Phaser.Input.Keyboard.JustDown(this.statusKey)) {
      this.openStatusOverlay();
      return;
    }

    // Phaser calls update() every frame. We check arrow key state and
    // attempt a move — tryMove() itself handles ignoring input while
    // a slide is already in progress, so holding a key down won't
    // cause the player to drift off-grid.
    if (this.cursors.left.isDown) {
      this.tryMove(-1, 0);
    } else if (this.cursors.right.isDown) {
      this.tryMove(1, 0);
    } else if (this.cursors.up.isDown) {
      this.tryMove(0, -1);
    } else if (this.cursors.down.isDown) {
      this.tryMove(0, 1);
    }
  }
}
