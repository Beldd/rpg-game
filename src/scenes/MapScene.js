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

    // ── Overlay state ────────────────────────────────────────────────
    // The overlay is a full-screen panel split into a left sidebar menu
    // (cols 0–106) and a right content panel (cols 108–319). The sidebar
    // has four entries: Party (0), Equip (1), Items (2), Save (3).
    //
    // overlayOpen     — whether the panel is visible
    // menuIndex       — which sidebar entry has focus (0–3)
    // overlaySubState — what the right panel is currently doing:
    //   null            → sidebar has focus; Up/Down moves menuIndex
    //   'PARTY'         → browsing party list; Up/Down selects member
    //   'EQUIP_SLOTS'   → cursor on an equipment slot for equipCharIndex
    //   'EQUIP_ITEMS'   → cursor in the item list for that slot
    //   'ITEMS_SELECT'  → cursor on a consumable in the items list
    //   'ITEMS_TARGET'  → picking which party member to use item on
    //   'SAVELOAD'      → cursor on a save/load slot
    //
    // All sub-state indices reset on menu navigation so stale positions
    // never carry across different menu entries.
    this.overlayOpen = false;
    this.menuIndex = 0;        // 0=Party 1=Equip 2=Items 3=Save
    this.overlaySubState = null;

    // Party sub-state
    this.partySelectedIndex = 0;
    this.partySwapSource = null;  // index of the character "picked up" for swapping, null if none

    // Equip sub-state
    this.equipCharIndex = 0;
    this.equipSlotIndex = 0;
    this.equipItemIndex = 0;

    // Items sub-state
    this.itemsSelectedIndex = 0;
    this.itemsTargetIndex = 0;

    // Save/Load sub-state
    this.saveLoadMode = 'SAVE';
    this.saveLoadSelectedIndex = 0;
    this.pendingLoadConfirm = null;

    // ── Random encounter state ───────────────────────────────────────
    // Tile bag: 15 tokens, 1 = encounter, 14 = safe. Drawn one per step;
    // reshuffled when empty. Produces ~15 steps per encounter on average
    // without the high variance of pure per-step RNG.
    this._encounterBag    = [];
    this._encounterBagIdx = 0;
    // Which zone the player is currently in — controls which encounter
    // table to draw from (or disables random encounters entirely).
    this._currentZone = 'town';
  }

  preload() {
    // Phaser's tilemap loader needs two things:
    // 1. The Kenney tiny_dungeon packed tileset (192×176, 12×11, no spacing)
    this.load.image('tiles', 'assets/kenny/tiny_dungeon/Tilemap/tilemap_packed.png');

    // Also load the same sheet as a spritesheet so individual tiles can be
    // used as NPC/character sprites via frame index. 16×16 tiles, no margin
    // or spacing — matches the tilemap_packed layout exactly.
    // Loaded through the shared sheet registry (texture key 'characters',
    // same as before) so encounter sprites and the NPC use one source.
    EditorData.preloadSheets(this);

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
    this._loadMapObjects(map);

    // --- Player setup ---
    // Default start position: town plaza (clear floor, away from buildings).
    // Overridden by returnX/returnY if returning from DungeonScene, so
    // the player reappears just outside the dungeon entrance door.
    const sceneData = this.scene.settings.data || {};
    // returnData from BattleScene (battle return) — guard against stale
    // scene.settings.data that persists across visits without a real return.
    const rawReturn = sceneData.returnData || null;
    const returnData = (rawReturn && typeof rawReturn.victory === 'boolean') ? rawReturn : null;
    const startTileX = returnData?.spawnTileX ?? sceneData.returnX ?? 5;
    const startTileY = returnData?.spawnTileY ?? sceneData.returnY ?? 13;

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
    this.staticEncounters = EditorData.getStaticEncountersFor('map').map(enc => ({
      id: enc.id,
      tileX: enc.mapPosition.tileX,
      tileY: enc.mapPosition.tileY,
      // The encounter's chosen sprite if it has one, else the placeholder.
      sprite: EditorData.makeSpriteImage(
        this,
        enc.mapPosition.tileX * this.TILE_SIZE + this.TILE_SIZE / 2,
        enc.mapPosition.tileY * this.TILE_SIZE + this.TILE_SIZE / 2,
        enc.sprite
      ) || this.add.image(
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

    // --- Dungeon reset NPC (wizard) ---
    // Tile (35, 21): one tile east of the dungeon door exit, same row as
    // where the player lands after leaving the dungeon. Frame 84 = column 0,
    // row 7 on the 12×11 tilemap_packed spritesheet (purple-robed wizard).
    // NPC_TILE is the wizard's own tile — interaction fires when the player
    // is on any of the 8 surrounding tiles and presses Enter.
    this.NPC_TILE = this._mapObjects.npc || { x: 35, y: 21 };
    this.npcSprite = this.add.image(
      this.NPC_TILE.x * this.TILE_SIZE + this.TILE_SIZE / 2,
      this.NPC_TILE.y * this.TILE_SIZE + this.TILE_SIZE / 2,
      'characters', 84
    );

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
      .setDepth(100)        // above room covers (depth 1) so dialogue is never hidden
      .setVisible(false);

    // Building interiors: cover each room until the player steps in.
    this._setupRooms();
    this._updateRooms(this.playerTileX, this.playerTileY);

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

    // ── Overlay UI ───────────────────────────────────────────────────
    // Full-screen background covers the map while the overlay is open.
    this.overlayBg = this.add.rectangle(width / 2, height / 2, width, height, 0x101018, 0.95)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    // Vertical divider between sidebar (left 1/4, 0–79) and content (right 3/4, 81–319).
    // x=80 = Math.floor(320/4). Drawn as a 1px-wide, full-height rectangle.
    this.overlayDivider = this.add.rectangle(80, 0, 1, height, 0x334455)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setVisible(false);

    // All dynamic text elements (sidebar labels, content lines) are
    // created fresh each time the overlay opens or its state changes,
    // then removed as a group via clearOverlayContent(). This keeps
    // the render functions stateless and avoids hidden stale elements.
    this.overlayEls = [];

    // P opens/closes the overlay. I kept as an alias so muscle memory
    // from the old layout still works. ESC always closes or backs out.
    this.overlayKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.overlayKeyI = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.escKey  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Listen for a successful Load performed inside OverlayScene.
    // After a load, fade the camera out and back in so state changes
    // (party HP, inventory, etc.) are picked up cleanly on fade-in.
    // Registered per create() and removed on shutdown, so a stale listener
    // from an earlier visit can never fire against a stopped scene.
    this._onOverlayLoadComplete = () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      domText.fadeOut();
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.cameras.main.fadeIn(400, 0, 0, 0);
        domText.fadeIn();
      });
    };
    this.game.events.on('overlayLoadComplete', this._onOverlayLoadComplete);
    this.events.once('shutdown', () => {
      this.game.events.off('overlayLoadComplete', this._onOverlayLoadComplete);
    });

    console.log(`Map loaded: ${map.width}x${map.height} tiles`);
  }

  // ─── Random encounter helpers ────────────────────────────────────────────

  /**
   * Returns the zone id for a given tile coordinate. Town is defined
   * as the rectangular region covering the starting village area;
   * everything else is overworld. DungeonScene sets _currentZone to
   * 'dungeon' before triggering its own random encounters.
   *
   * Town boundary: tiles (0,0)–(44,23) — roughly the walled village
   * plus some surrounding grass buffer. Adjust as the map grows.
   */
  _getZoneForTile(tileX, tileY) {
    // Zone rectangles come from the Tiled "objects" layer (type "zone",
    // property zone=<id>). Anything outside every rectangle is overworld.
    for (const z of this._mapObjects.zones) {
      if (tileX >= z.x1 && tileX <= z.x2 && tileY >= z.y1 && tileY <= z.y2) return z.zone;
    }
    return 'overworld';
  }

  /**
   * Creates one black cover per room. Covers sit at depth 1: above the
   * map, enemies and NPCs (depth 0) so everything inside is hidden, and
   * below the dialogue box (depth 100). The player is never under a cover
   * because a room is revealed before the player moves into it.
   */
  _setupRooms() {
    const T = this.TILE_SIZE;
    this._roomCovers = this._mapObjects.rooms.map(r => ({
      room: r,
      cover: this.add.rectangle(r.x1 * T, r.y1 * T, (r.x2 - r.x1 + 1) * T, (r.y2 - r.y1 + 1) * T, 0x000000, 1)
        .setOrigin(0, 0)
        .setDepth(1),
    }));
  }

  /**
   * Shows a room while the player is inside it or standing in its doorway,
   * and covers it again otherwise. Called with the tile the player is about
   * to occupy (at the start of a move), so the room is revealed before the
   * player slides into it and hidden as soon as they step out.
   */
  _updateRooms(tileX, tileY) {
    for (const { room, cover } of this._roomCovers) {
      const inside = tileX >= room.x1 && tileX <= room.x2 && tileY >= room.y1 && tileY <= room.y2;
      const inDoorway = this._mapObjects.doors.some(d =>
        d.room === room.name && d.tiles.some(t => t.x === tileX && t.y === tileY));
      cover.setVisible(!(inside || inDoorway));
    }
  }

  /**
   * Reads the Tiled object layer "objects" into tile coordinates:
   *   zones  – rectangles (type "zone", property zone)
   *   doors  – rectangles (type "door", property target) -> list of tiles
   *   rooms  – rectangles (type "room"): interiors hidden until entered.
   *            A door (property target="room", room=<name>) marks the
   *            doorway tiles that reveal that room.
   *   npc    – point (type "npc") -> tile
   * Falls back to the original hard-coded values if the layer is missing,
   * so an older map.json still plays the same.
   */
  _loadMapObjects(map) {
    const T = this.TILE_SIZE || 16;
    const out = {
      zones: [{ zone: 'town', x1: 0, y1: 0, x2: 44, y2: 23 }],
      doors: [{ target: 'dungeon', tiles: [{ x: 31, y: 20 }, { x: 32, y: 20 }, { x: 33, y: 20 }] }],
      rooms: [],
      npc: null,
    };
    const layer = map.getObjectLayer && map.getObjectLayer('objects');
    if (layer && layer.objects) {
      const zones = [], doors = [];
      const prop = (o, n) => { const p = (o.properties || []).find(q => q.name === n); return p ? p.value : undefined; };
      for (const o of layer.objects) {
        if (o.type === 'zone' && o.width) {
          zones.push({ zone: prop(o, 'zone') || o.name,
            x1: Math.floor(o.x / T), y1: Math.floor(o.y / T),
            x2: Math.ceil((o.x + o.width) / T) - 1, y2: Math.ceil((o.y + o.height) / T) - 1 });
        } else if (o.type === 'door' && o.width) {
          const tiles = [];
          for (let ty = Math.floor(o.y / T); ty < Math.ceil((o.y + o.height) / T); ty++)
            for (let tx = Math.floor(o.x / T); tx < Math.ceil((o.x + o.width) / T); tx++) tiles.push({ x: tx, y: ty });
          doors.push({ target: prop(o, 'target') || o.name, room: prop(o, 'room'), tiles });
        } else if (o.type === 'room' && o.width) {
          out.rooms.push({ name: o.name,
            x1: Math.floor(o.x / T), y1: Math.floor(o.y / T),
            x2: Math.ceil((o.x + o.width) / T) - 1, y2: Math.ceil((o.y + o.height) / T) - 1 });
        } else if (o.type === 'npc') {
          out.npc = { x: Math.floor(o.x / T), y: Math.floor(o.y / T) };
        }
      }
      if (zones.length) out.zones = zones;
      if (doors.length) out.doors = doors;
    }
    this._mapObjects = out;
  }

  /**
   * Fills the tile bag with 15 tokens (1 encounter, 14 safe) and
   * shuffles them randomly using Fisher-Yates. Called once when the
   * bag is empty to reshuffle.
   */
  _refillEncounterBag() {
    // 1 encounter token per bag of 15 = ~15 steps average between fights
    this._encounterBag = [true, ...Array(14).fill(false)];
    for (let i = this._encounterBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this._encounterBag[i], this._encounterBag[j]] = [this._encounterBag[j], this._encounterBag[i]];
    }
    this._encounterBagIdx = 0;
  }

  /**
   * Draws one token from the bag. Returns true if this step triggers
   * a random encounter, false otherwise. Reshuffles the bag
   * automatically when all tokens have been drawn.
   */
  _drawEncounterToken() {
    if (this._encounterBagIdx >= this._encounterBag.length) {
      this._refillEncounterBag();
    }
    return this._encounterBag[this._encounterBagIdx++];
  }

  /**
   * Called on each completed step. Checks the current zone, draws a
   * token if encounters are enabled, and triggers a random encounter
   * if the token says so. Returns true if an encounter was started.
   */
  _checkRandomEncounter(tileX, tileY) {
    const zoneId = this._getZoneForTile(tileX, tileY);
    this._currentZone = zoneId;

    const encounterIds = EditorData.getRandomEncounterIds(zoneId);
    if (!encounterIds.length) return false; // zone has no random encounters

    if (!this._drawEncounterToken()) return false; // safe step

    // Pick a random encounter from this zone's table
    const encId = encounterIds[Math.floor(Math.random() * encounterIds.length)];
    this.activeEncounterId = encId;
    this._triggerRandomEncounter();
    return true;
  }

  _triggerRandomEncounter() {
    if (this.encounterTriggered) return;
    this.encounterTriggered = true;

    if (GameState.party.every(m => m.hp <= 0)) {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      domText.fadeOut();
      this.cameras.main.once('camerafadeoutcomplete', () => {
        domText.clearAll();
        this.scene.start('GameOverScene');
      });
      return;
    }

    // Snapshot position now, before the fade, so returnData carries the
    // tile where the fight started and MapScene restores it on return.
    const spawnX = this.playerTileX;
    const spawnY = this.playerTileY;

    this.cameras.main.fadeOut(400, 0, 0, 0);
    domText.fadeOut();
    this.cameras.main.once('camerafadeoutcomplete', () => {
      domText.clearAll();
      this.scene.start('BattleScene', {
        encounterId: this.activeEncounterId,
        returnScene: 'MapScene',
        returnData: {
          spawnTileX: spawnX,
          spawnTileY: spawnY,
          isStaticEncounter: false,
        },
      });
    });
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

    // Check dungeon entrance trigger — stepping onto the door tiles
    // at the south face of the dungeon building transitions to DungeonScene.
    const dungeonDoor = this._mapObjects.doors.find(d => d.target === 'dungeon');
    if (dungeonDoor && dungeonDoor.tiles.some(t => t.x === targetTileX && t.y === targetTileY)) {
      this.enterDungeon();
      return;
    }

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
    this._updateRooms(targetTileX, targetTileY);

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
        // Check for a random encounter now that the step is complete.
        // Static encounters are checked above (before movement) and
        // handled separately; this is for zone-based random fights.
        if (!this.encounterTriggered) {
          this._checkRandomEncounter(this.playerTileX, this.playerTileY);
        }
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

    // If the overlay is open behind this dialogue (e.g. a Load
    // confirmation triggered from Save/Load view), clear its text so
    // DOM elements don't show through the dialogue box — the overlay
    // background stays visible to avoid a jarring flash to the map.
    if (this.overlayOpen) {
      this.clearOverlayContent();
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
    // dialogue (see openChoiceDialogue).
    if (this.overlayOpen) {
      this.renderOverlay();
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

  // ─── Overlay open / close / clear ───────────────────────────────────────

  openOverlay() {
    this.overlayOpen = true;
    this.overlaySubState = null;
    this.overlayBg.setVisible(true);
    this.overlayDivider.setVisible(true);
    // Hide world-layer DOM text (HUD, NPC labels, portraits) so it doesn't
    // bleed through the Phaser overlay background rectangles.
    document.getElementById('text-overlay').style.visibility = 'hidden';
    try {
      this.renderOverlay();
    } catch (e) {
      console.error('[Overlay] renderOverlay() threw on open:', e);
      this.overlayOpen = false;
      this.overlayBg.setVisible(false);
      this.overlayDivider.setVisible(false);
      document.getElementById('text-overlay').style.visibility = 'visible';
    }
  }

  closeOverlay() {
    this.overlayOpen = false;
    this.overlaySubState = null;
    this.partySwapSource = null;
    this.overlayBg.setVisible(false);
    this.overlayDivider.setVisible(false);
    this._destroyPortraits();
    this.clearOverlayContent();
    // Restore world-layer DOM text now that the overlay is closed.
    document.getElementById('text-overlay').style.visibility = 'visible';
  }

  /** Removes all dynamic text elements created by the current render pass. */
  clearOverlayContent() {
    this._stopSwapBlink();
    this._destroyPortraits(); // always clean up Phaser portrait rects, regardless of which panel was active
    this.overlayEls.forEach(el => domText.remove(el));
    this.overlayEls = [];
  }

  // ─── Top-level render dispatcher ────────────────────────────────────────

  /**
   * Clears all overlay DOM elements and redraws the sidebar + right panel
   * from scratch. Keeps render functions stateless — every open/navigate
   * call funnels here and the state variables on `this` are the source
   * of truth for what gets drawn.
   */
  renderOverlay() {
    try {
      this.clearOverlayContent();
      this.renderSidebar();

      switch (this.menuIndex) {
        case 0: this.renderPartyPanel();    break;
        case 1: this.renderEquipPanel();    break;
        case 2: this.renderItemsPanel();    break;
        case 3: this.renderSaveLoadPanel(); break;
      }
    } catch (e) {
      console.error('[Overlay] render error (menuIndex=' + this.menuIndex
        + ', subState=' + this.overlaySubState + '):', e);
    }
  }

  // ─── Sidebar ─────────────────────────────────────────────────────────────

  /**
   * Left-column (x 0–106) menu with four entries. The selected entry is
   * highlighted in white; others in dim grey. When overlaySubState is
   * null the sidebar has focus (cursor in the left column); otherwise
   * focus has passed to the right panel and the sidebar is just decorative.
   */
  renderSidebar() {
    // Layout constants — sidebar lives in cols 0–79 (1/4 of 320px canvas).
    const LABELS = ['Party', 'Equip', 'Items', 'Save'];
    const SX = 6;       // left edge for cursor / text
    const startY = 30;
    const rowH = 22;
    const sidebarFocused = (this.overlaySubState === null);

    this.overlayEls.push(
      domText.menu(SX, 14, 'MENU', { fontSize: 8, color: '#334455', align: 'left' })
    );

    LABELS.forEach((label, i) => {
      const y = startY + i * rowH;
      const isActive = (this.menuIndex === i);
      const color = isActive ? '#ffffff' : '#4a5a6a';

      if (sidebarFocused && isActive) {
        this.overlayEls.push(
          domText.menu(SX, y, '▶', { fontSize: 10, color: '#ffff00', align: 'left' })
        );
      }
      this.overlayEls.push(
        domText.menu(SX + 12, y, label, { fontSize: 11, color, align: 'left' })
      );
    });

    // Hint at bottom of sidebar
    const hint = sidebarFocused ? '↑↓ Enter' : '← Esc back';
    this.overlayEls.push(
      domText.menu(SX, 128, hint, { fontSize: 7, color: '#2a3a4a', align: 'left' })
    );
  }

  // ─── Party panel ─────────────────────────────────────────────────────────

  /**
   * Right panel for menu index 0. Shows all party members stacked
   * vertically; each row has a portrait placeholder box on the left,
   * then name / HP / MP stacked to its right. Up/Down navigates (unused
   * in this version — listed for future party-order editing).
   */
  renderPartyPanel() {
    // Right panel: cols 88–316 (3/4 of canvas). RX = first usable column.
    const RX = 88;
    const startY = 22;
    const rowH = 38;

    this.overlayEls.push(
      domText.menu(RX, 10, 'PARTY', { fontSize: 8, color: '#334455', align: 'left' })
    );

    GameState.party.forEach((member, i) => {
      const y = startY + i * rowH;
      const isSelected = (this.overlaySubState === 'PARTY' && this.partySelectedIndex === i);
      const stats = GameState.getEffectiveStats(member);

      // Cursor
      if (isSelected) {
        this.overlayEls.push(
          domText.menu(RX - 8, y + 12, '▶', { fontSize: 9, color: '#ffff00', align: 'left' })
        );
      }

      // Name — swap source pulses yellow; KO'd members are dimmed red
      const isSwapSource = (this.partySwapSource === i);
      const nameColor = member.hp <= 0 ? '#884444' : isSwapSource ? '#ffff00' : '#ffffff';
      const nameEl = domText.menu(RX + 28, y + 2, member.name, { fontSize: 11, color: nameColor, align: 'left' });
      // Store the name element so the blink interval can toggle it
      if (isSwapSource) { this._blinkEl = nameEl; }
      this.overlayEls.push(nameEl);

      // Row indicator [F] / [B]
      const rowLabel = (member.row || 'front') === 'front' ? '[F]' : '[B]';
      const rowColor = (member.row || 'front') === 'front' ? '#88cc88' : '#8888cc';
      this.overlayEls.push(
        domText.menu(RX + 110, y + 2, rowLabel, { fontSize: 10, color: rowColor, align: 'left' })
      );

      // HP
      const hpColor = member.hp / member.maxHp > 0.4 ? '#33cc66' : '#cc4444';
      this.overlayEls.push(
        domText.menu(RX + 28, y + 15, `HP ${member.hp}/${member.maxHp}`, { fontSize: 10, color: hpColor, align: 'left' })
      );

      // MP
      this.overlayEls.push(
        domText.menu(RX + 28, y + 26, `MP ${member.mp}/${member.maxMp}`, { fontSize: 10, color: '#5599ff', align: 'left' })
      );

      // Level / XP — pushed to right side of the wide panel
      this.overlayEls.push(
        domText.menu(RX + 140, y + 2, `Lv ${member.level}`, { fontSize: 10, color: '#ffcc33', align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(RX + 140, y + 15, `XP ${member.xp}/${GameState.xpThresholdForLevel(member.level)}`, { fontSize: 9, color: '#776633', align: 'left' })
      );

      // Attack / Defense mini stats
      this.overlayEls.push(
        domText.menu(RX + 140, y + 26, `Atk ${stats.attackMin}-${stats.attackMax}  Def ${stats.defense}`, { fontSize: 9, color: '#99aabb', align: 'left' })
      );
    });

    // Hint line at bottom of party panel — pushed below last row dynamically
    const partyHintY = Math.max(120, startY + GameState.party.length * rowH + 8);
    const partyHint = this.partySwapSource !== null
      ? '↑↓ select  Enter swap / same=row toggle  Esc cancel'
      : '↑↓ browse  Enter select  (same char toggles row)';
    this.overlayEls.push(
      domText.menu(RX, partyHintY, partyHint, { fontSize: 7, color: '#7788aa', align: 'left' })
    );

    // Restart the blink now that the element has been (re)created
    if (this.partySwapSource !== null) this._startSwapBlink();

    // Portrait placeholders (Phaser rectangles, not DOM — must be cleaned up separately).
    this._destroyPortraits();
    this._overlayPortraits = GameState.party.map((member, i) => {
      const y = startY + i * rowH;
      // 22×30 portrait box in game pixels, centered in the left gutter of the right panel
      const rect = this.add.rectangle(
        RX + 11,
        y + 15,
        22, 30,
        member.hp > 0 ? 0x1a3a55 : 0x3a1a1a
      ).setScrollFactor(0).setOrigin(0.5);
      return rect;
    });
  }

  /** Applies the CSS blink animation to the swap-source name element. */
  _startSwapBlink() {
    if (this._blinkEl) this._blinkEl.classList.add('swap-blink');
  }

  /** Removes the CSS blink animation (no-op if element already gone). */
  _stopSwapBlink() {
    if (this._blinkEl) this._blinkEl.classList.remove('swap-blink');
    this._blinkEl = null;
  }

  /** Cleans up Phaser portrait rectangles from the previous render. */
  _destroyPortraits() {
    if (this._overlayPortraits) {
      this._overlayPortraits.forEach(r => r.destroy());
    }
    this._overlayPortraits = [];
  }

  // ─── Equip panel ─────────────────────────────────────────────────────────

  /**
   * Right panel for menu index 1. Two sub-states:
   *   EQUIP_SLOTS  — cursor on one of the 4 equipment slots for equipCharIndex
   *   EQUIP_ITEMS  — cursor in the available item list for that slot
   *
   * Left/Right switches between party members (equipCharIndex).
   * Up/Down navigates within the focused section.
   * Enter on a slot → move focus to item list.
   * Enter on an item → equip it, return to slot list.
   * Enter on an occupied slot (EQUIP_SLOTS) → unequip, stay on slot list.
   */
  renderEquipPanel() {
    // Right panel: cols 88–316. Two columns within it:
    //   slot labels start at RX+14, equipped item name at RX+90, available items at RX+14.
    const RX = 88;
    const SLOT_LABELS = [
      { key: 'primary',   label: 'Primary'   },
      { key: 'secondary', label: 'Secondary' },
      { key: 'body',      label: 'Body'      },
      { key: 'head',      label: 'Head'      },
    ];

    const character = GameState.party[this.equipCharIndex];
    if (!character) return;

    // Panel header + character switcher
    this.overlayEls.push(
      domText.menu(RX, 10, 'EQUIP', { fontSize: 8, color: '#334455', align: 'left' })
    );
    this.overlayEls.push(
      domText.menu(RX + 48, 10, `◄ ${character.name} ►`, { fontSize: 10, color: '#ffcc33', align: 'left' })
    );
    this.overlayEls.push(
      domText.menu(RX + 160, 10, '←/→ switch', { fontSize: 8, color: '#2a3a4a', align: 'left' })
    );

    // Slot list
    const slotStartY = 28;
    const slotRowH = 18;

    this.overlayEls.push(
      domText.menu(RX, slotStartY - 10, 'Equipped:', { fontSize: 8, color: '#8899aa', align: 'left' })
    );

    SLOT_LABELS.forEach((slot, i) => {
      const y = slotStartY + i * slotRowH;
      const equipped = character.equipment[slot.key];
      const isSelected = this.overlaySubState === 'EQUIP_SLOTS' && this.equipSlotIndex === i;

      if (isSelected) {
        this.overlayEls.push(domText.menu(RX, y, '▶', { fontSize: 9, color: '#ffff00', align: 'left' }));
      }
      this.overlayEls.push(domText.menu(RX + 12, y, `${slot.label}:`, { fontSize: 10, color: '#aabbcc', align: 'left' }));
      this.overlayEls.push(domText.menu(RX + 90, y, equipped ? equipped.name : '—', { fontSize: 10, color: equipped ? '#ffffff' : '#667788', align: 'left' }));

      // Show stat bonuses for equipped item inline
      if (equipped && equipped.bonus) {
        const bonuses = Array.isArray(equipped.bonus)
          ? equipped.bonus.map(b => `+${b.amount} ${b.stat}`).join(' ')
          : Object.entries(equipped.bonus).map(([k, v]) => `+${v} ${k}`).join(' ');
        this.overlayEls.push(domText.menu(RX + 170, y, bonuses, { fontSize: 8, color: '#88aacc', align: 'left' }));
      }
    });

    // Available items section (shown always, active/browsable only in EQUIP_ITEMS)
    const itemsStartY = slotStartY + SLOT_LABELS.length * slotRowH + 16;
    const itemRowH = 14;
    const targetSlot = SLOT_LABELS[this.equipSlotIndex].key;
    const available = GameState.inventory.filter(it => it.slot === targetSlot);

    this.overlayEls.push(
      domText.menu(RX, itemsStartY - 10,
        `Available (${SLOT_LABELS[this.equipSlotIndex].label}):`,
        { fontSize: 8, color: this.overlaySubState === 'EQUIP_ITEMS' ? '#ffffff' : '#8899aa', align: 'left' })
    );

    if (available.length === 0) {
      this.overlayEls.push(
        domText.menu(RX + 12, itemsStartY, '(none in inventory)', { fontSize: 10, color: '#667788', align: 'left' })
      );
    } else {
      available.forEach((item, i) => {
        const y = itemsStartY + i * itemRowH;
        const isSelected = this.overlaySubState === 'EQUIP_ITEMS' && this.equipItemIndex === i;
        if (isSelected) {
          this.overlayEls.push(domText.menu(RX, y, '▶', { fontSize: 9, color: '#ffff00', align: 'left' }));
        }
        this.overlayEls.push(domText.menu(RX + 12, y, item.name, { fontSize: 10, color: isSelected ? '#ffffff' : '#aabbcc', align: 'left' }));

        // Show bonus inline
        if (item.bonus) {
          const bonuses = Array.isArray(item.bonus)
            ? item.bonus.map(b => `+${b.amount} ${b.stat}`).join(' ')
            : Object.entries(item.bonus).map(([k, v]) => `+${v} ${k}`).join(' ');
          this.overlayEls.push(domText.menu(RX + 120, y, bonuses, { fontSize: 8, color: '#88aacc', align: 'left' }));
        }
      });
    }

    if (this.overlaySubState === 'EQUIP_SLOTS') {
      this.overlayEls.push(
        domText.menu(RX, 120, 'Enter: equip/unequip slot', { fontSize: 7, color: '#7788aa', align: 'left' })
      );
    }
  }

  /** Confirm action in EQUIP_SLOTS: move to item list, or unequip if slot is occupied. */
  _equipConfirmSlot() {
    const character = GameState.party[this.equipCharIndex];
    const slotKeys = ['primary', 'secondary', 'body', 'head'];
    const slot = slotKeys[this.equipSlotIndex];
    if (character.equipment[slot]) {
      GameState.unequipItem(character, slot);
      this.renderOverlay();
    } else {
      this.overlaySubState = 'EQUIP_ITEMS';
      this.equipItemIndex = 0;
      this.renderOverlay();
    }
  }

  /** Confirm action in EQUIP_ITEMS: equip the selected item. */
  _equipConfirmItem() {
    const character = GameState.party[this.equipCharIndex];
    const slotKeys = ['primary', 'secondary', 'body', 'head'];
    const targetSlot = slotKeys[this.equipSlotIndex];
    const available = GameState.inventory.filter(it => it.slot === targetSlot);
    const item = available[this.equipItemIndex];
    if (item) {
      GameState.equipItem(character, item);
    }
    this.overlaySubState = 'EQUIP_SLOTS';
    this.equipItemIndex = 0;
    this.renderOverlay();
  }

  // ─── Items panel ─────────────────────────────────────────────────────────

  /**
   * Right panel for menu index 2. Two sub-states:
   *   ITEMS_SELECT — cursor on a consumable in inventory
   *   ITEMS_TARGET — picking which party member to use the item on
   */
  renderItemsPanel() {
    const RX = 88;

    this.overlayEls.push(
      domText.menu(RX, 10, 'ITEMS', { fontSize: 9, color: '#99aabb', align: 'left' })
    );

    if (this.overlaySubState === 'ITEMS_TARGET') {
      this._renderItemsTargetView(RX);
      return;
    }

    // Consumables only
    const consumables = GameState.inventory.filter(it => !it.slot);

    if (consumables.length === 0) {
      this.overlayEls.push(
        domText.menu(RX + 10, 30, '(no items)', { fontSize: 10, color: '#445566', align: 'left' })
      );
      return;
    }

    const startY = 24;
    const rowH = 16;

    consumables.forEach((item, i) => {
      const y = startY + i * rowH;
      const isSelected = (this.overlaySubState === 'ITEMS_SELECT') && this.itemsSelectedIndex === i;
      if (isSelected) {
        this.overlayEls.push(domText.menu(RX, y, '▶', { fontSize: 10, color: '#ffff00', align: 'left' }));
      }
      this.overlayEls.push(
        domText.menu(RX + 12, y, item.name, { fontSize: 10, color: '#ffffff', align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(RX + 140, y, `x${item.quantity}`, { fontSize: 10, color: '#aabbcc', align: 'left' })
      );
    });

    const itemsHintY = Math.max(120, startY + consumables.length * rowH + 8);
    if (this.overlaySubState !== 'ITEMS_SELECT') {
      this.overlayEls.push(
        domText.menu(RX, itemsHintY, 'Enter to use', { fontSize: 7, color: '#7788aa', align: 'left' })
      );
    } else {
      this.overlayEls.push(
        domText.menu(RX, itemsHintY, '↑↓ select  Enter use', { fontSize: 7, color: '#7788aa', align: 'left' })
      );
    }
  }

  _renderItemsTargetView(RX) {
    const startY = 30;
    const rowH = 26;

    this.overlayEls.push(
      domText.menu(RX, 14, 'Use on who?', { fontSize: 10, color: '#ffcc33', align: 'left' })
    );

    GameState.party.forEach((member, i) => {
      const y = startY + i * rowH;
      const isSelected = this.itemsTargetIndex === i;
      const hpColor = member.hp / member.maxHp > 0.4 ? '#33cc66' : '#cc4444';

      if (isSelected) {
        this.overlayEls.push(domText.menu(RX, y + 6, '▶', { fontSize: 10, color: '#ffff00', align: 'left' }));
      }
      this.overlayEls.push(
        domText.menu(RX + 14, y, member.name, { fontSize: 11, color: isSelected ? '#ffffff' : '#778899', align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(RX + 14, y + 14, `HP ${member.hp}/${member.maxHp}`, { fontSize: 10, color: hpColor, align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(RX + 120, y + 14, `MP ${member.mp ?? 0}/${member.maxMp ?? 0}`, { fontSize: 10, color: '#5599ff', align: 'left' })
      );
    });

    const targetHintY = Math.max(120, startY + GameState.party.length * rowH + 8);
    this.overlayEls.push(
      domText.menu(RX, targetHintY, '↑↓ select  Enter confirm  Esc cancel', { fontSize: 7, color: '#7788aa', align: 'left' })
    );
  }

  /** Applies a consumable item to the selected party member. */
  applyConsumable() {
    const consumables = GameState.inventory.filter(it => !it.slot);
    const item = consumables[this.itemsSelectedIndex];
    if (!item) return;

    const def = EditorData.getConsumableByName(item.name);
    if (!def || !def.effect) {
      this._showOverlayMessage(`Can't use ${item.name} yet.`);
      return;
    }

    const target = GameState.party[this.itemsTargetIndex];

    if (def.effect.type === 'heal') {
      if (target.hp >= target.maxHp) {
        this.overlaySubState = 'ITEMS_SELECT';
        this._showOverlayMessage(`${target.name} is already at full HP!`);
        return;
      }
      const healAmount = Math.floor(
        Math.random() * (def.effect.maxAmount - def.effect.minAmount + 1)
      ) + def.effect.minAmount;
      target.hp = Math.min(target.maxHp, target.hp + healAmount);

      item.quantity -= 1;
      if (item.quantity <= 0) {
        const idx = GameState.inventory.indexOf(item);
        if (idx !== -1) GameState.inventory.splice(idx, 1);
        this.itemsSelectedIndex = Math.max(0, this.itemsSelectedIndex - 1);
      }

      this.overlaySubState = 'ITEMS_SELECT';
      this._showOverlayMessage(`${target.name} recovered ${healAmount} HP!`);
    }
  }

  /** Shows a brief message in the right panel, then restores the current view. */
  _showOverlayMessage(msg) {
    this.clearOverlayContent();
    this.renderSidebar();

    // Centre within the right panel (RX=88 to right edge 316, width=228)
    const RX = 88;
    const panelW = 316 - RX;
    this.overlayEls.push(
      domText.menu(RX + panelW / 2, 72, msg, { fontSize: 11, color: '#ffcc33', align: 'center' })
    );

    this.time.delayedCall(1200, () => {
      if (this.overlayOpen) this.renderOverlay();
    });
  }

  // ─── Save/Load panel ─────────────────────────────────────────────────────

  /**
   * Right panel for menu index 3. Space toggles SAVE/LOAD mode;
   * Up/Down picks a slot; Enter performs the action.
   */
  renderSaveLoadPanel() {
    const RX = 88;

    // Header row: mode label left, toggle hint right
    this.overlayEls.push(
      domText.menu(RX, 10, 'SAVE / LOAD', { fontSize: 9, color: '#556677', align: 'left' })
    );

    const modeColor = this.saveLoadMode === 'SAVE' ? '#ffcc33' : '#33aaff';
    this.overlayEls.push(
      domText.menu(RX, 22, this.saveLoadMode, { fontSize: 12, color: modeColor, align: 'left' })
    );
    this.overlayEls.push(
      domText.menu(RX + 60, 24, '[Space] toggle', { fontSize: 9, color: '#445566', align: 'left' })
    );

    const slotStartY = 42;
    const slotRowH = 22;

    for (let i = 0; i < SaveSystem.NUM_SLOTS; i++) {
      const slotNumber = i + 1;
      const y = slotStartY + i * slotRowH;
      const isSelected = (this.overlaySubState === 'SAVELOAD') && this.saveLoadSelectedIndex === i;
      const isAuto = slotNumber === SaveSystem.AUTO_SAVE_SLOT;

      const snapshot = SaveSystem.readSlot(slotNumber);
      let statusText = '(empty)';
      let timeText = '';
      if (snapshot) {
        const secs = Math.floor((Date.now() - snapshot.savedAt) / 1000);
        timeText = secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
        statusText = snapshot.playerName ? snapshot.playerName : 'Save data';
      }

      const slotLabel = `Slot ${slotNumber}${isAuto ? ' ★' : ''}`;
      const rowColor = isSelected ? '#ffffff' : '#778899';

      if (isSelected) {
        this.overlayEls.push(domText.menu(RX, y + 4, '▶', { fontSize: 10, color: '#ffff00', align: 'left' }));
      }
      this.overlayEls.push(
        domText.menu(RX + 14, y, slotLabel, { fontSize: 10, color: rowColor, align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(RX + 14, y + 12, statusText, { fontSize: 9, color: snapshot ? '#aaccaa' : '#445566', align: 'left' })
      );
      if (timeText) {
        this.overlayEls.push(
          domText.menu(RX + 160, y + 12, timeText, { fontSize: 9, color: '#556677', align: 'left' })
        );
      }
    }

    if (this.overlaySubState === 'SAVELOAD') {
      this.overlayEls.push(
        domText.menu(RX, 120, '↑↓ select  Enter confirm', { fontSize: 7, color: '#7788aa', align: 'left' })
      );
    }
  }

  confirmSaveLoadSelection() {
    const slotNumber = this.saveLoadSelectedIndex + 1;

    if (this.saveLoadMode === 'SAVE') {
      SaveSystem.saveToSlot(slotNumber);
      this.renderOverlay();
      return;
    }

    if (!SaveSystem.slotExists(slotNumber)) return;

    this.openChoiceDialogue(`Load Slot ${slotNumber}? Current progress will be overwritten.`, [
      { label: 'Load', action: () => this.performLoad(slotNumber) },
      { label: 'Cancel', action: () => this.closeDialogue() },
    ]);
  }

  performLoad(slotNumber) {
    SaveSystem.loadFromSlot(slotNumber);

    // Tear down dialogue manually (don't call closeDialogue — that
    // would re-render the overlay, but we want our own message instead).
    this.dialogueState = null;
    this.dialogueBoxBg.setVisible(false);
    this.dialogueTextEl.style.display = 'none';
    this.dialogueChoiceTexts.forEach(el => domText.remove(el));
    this.dialogueChoiceTexts = [];
    if (this.dialogueCursorEl) { domText.remove(this.dialogueCursorEl); this.dialogueCursorEl = null; }

    // Show "Loaded!" message briefly, then fade → close overlay → fade back.
    this.clearOverlayContent();
    this.renderSidebar();
    this.overlayEls.push(
      domText.menu(202, 72, `Loaded Slot ${slotNumber}!`, { fontSize: 13, color: '#33cc66', align: 'center' })
    );

    this.time.delayedCall(900, () => {
      this.cameras.main.fadeOut(400, 0, 0, 0);
      domText.fadeOut();
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.closeOverlay();
        this.cameras.main.fadeIn(400, 0, 0, 0);
        domText.fadeIn();
      });
    });
  }

  /**
   * Triggered when the player walks into the enemy's tile. Rather than
   * cutting straight to battle, this now opens a choice dialogue —
   * the monster issues its challenge, and the player picks Fight or
   * Flee. Only "Fight" proceeds to actually fade into BattleScene;
   * "Flee" closes the dialogue and lets the player carry on walking.
   */
  /**
   * Fades out and launches DungeonScene. The player will reappear
   * at the dungeon entrance vestibule on the dungeon map.
   */
  enterDungeon() {
    this.encounterTriggered = true; // reuse this flag to block further input
    this.cameras.main.fadeOut(400, 0, 0, 0);
    domText.fadeOut();
    this.cameras.main.once('camerafadeoutcomplete', () => {
      domText.clearAll();
      // Pass an explicit empty object so Phaser clears any stale
      // scene.settings.data from a previous dungeon visit. Without this,
      // the old battle returnData (victory=true, spawnTileX/Y, etc.)
      // persists in settings and causes DungeonScene to re-apply it on
      // every subsequent entry — hiding defeated enemies even after a
      // reset, and spawning the player at the old encounter tile.
      this.scene.start('DungeonScene', { fromMap: true });
    });
  }

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

    // Snapshot position before the fade so we can restore it on return.
    const spawnX = this.playerTileX;
    const spawnY = this.playerTileY;

    this.cameras.main.fadeOut(400, 0, 0, 0);
    domText.fadeOut();

    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('BattleScene', {
        encounterId: this.activeEncounterId,
        returnScene: 'MapScene',
        returnData: {
          spawnTileX: spawnX,
          spawnTileY: spawnY,
          encounterId: this.activeEncounterId,
          isStaticEncounter: true,
        },
      });
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

  // ─── NPC interaction ──────────────────────────────────────────────────────

  /**
   * Returns true if the player is on any of the 8 tiles adjacent to the
   * wizard NPC. Called each frame when Enter is pressed and no dialogue
   * is open, so the player doesn't need to be facing a specific direction.
   */
  _isAdjacentToNpc() {
    const dx = Math.abs(this.playerTileX - this.NPC_TILE.x);
    const dy = Math.abs(this.playerTileY - this.NPC_TILE.y);
    return dx <= 1 && dy <= 1 && (dx + dy > 0); // within 1 tile in any direction, not on the NPC itself
  }

  /**
   * Opens the dungeon-reset dialogue. First step is a Yes/No choice;
   * each branch resolves to a single dismissable message.
   */
  openNpcDialogue() {
    this.openChoiceDialogue('Reset the dungeon?', [
      {
        label: 'Yes',
        action: () => {
          GameState.resetDungeon();
          this.closeDialogue();
          this.showMessageDialogue('The dungeon has been reset.');
        },
      },
      {
        label: 'No',
        action: () => {
          this.closeDialogue();
          this.showMessageDialogue('Talk to me again if you change your mind.');
        },
      },
    ]);
  }

  update() {
    // P / I open the overlay — check FIRST, before the isActive guard,
    // so the keypress isn't lost on the frame the overlay is launching.
    // Mirror DungeonScene's pattern exactly: check P/I, launch if not
    // already active, then return. The isActive guard below handles
    // suppressing all other input while the overlay is running.
    if (Phaser.Input.Keyboard.JustDown(this.overlayKey)
        || Phaser.Input.Keyboard.JustDown(this.overlayKeyI)) {
      if (!this.scene.isActive('OverlayScene')) {
        this.scene.launch('OverlayScene', { callerKey: 'MapScene' });
      }
      return;
    }

    // While OverlayScene is running on top of us, suppress ALL input —
    // movement, dialogue, everything. OverlayScene owns the keyboard.
    if (this.scene.isActive('OverlayScene')) return;

    // Dialogue (NPC message/choice) takes priority over movement.
    // Note: this comes AFTER the OverlayScene guard above, so MapScene
    // dialogue input is only active when the overlay is fully closed.
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

    // Legacy overlay block — overlayOpen is never true via the new OverlayScene
    // path, so this block is dead code kept only to avoid a JS error if somehow
    // reached. It will be cleaned up in a future refactor.
    if (this.overlayOpen) {
      const jdUp    = Phaser.Input.Keyboard.JustDown(this.cursors.up);
      const jdDown  = Phaser.Input.Keyboard.JustDown(this.cursors.down);
      const jdLeft  = Phaser.Input.Keyboard.JustDown(this.cursors.left);
      const jdRight = Phaser.Input.Keyboard.JustDown(this.cursors.right);
      const jdEnter = Phaser.Input.Keyboard.JustDown(this.enterKey);
      const jdEsc   = Phaser.Input.Keyboard.JustDown(this.escKey);
      const jdP     = Phaser.Input.Keyboard.JustDown(this.overlayKey);
      const jdI     = Phaser.Input.Keyboard.JustDown(this.overlayKeyI);
      const jdSpace = Phaser.Input.Keyboard.JustDown(this.spaceKey);

      // P / I / Esc always close or back out one level.
      if (jdP || jdI) { this.closeOverlay(); return; }

      // ── No sub-state: sidebar has focus ──────────────────────────────
      if (this.overlaySubState === null) {
        if (jdEsc) { this.closeOverlay(); return; }

        if (jdUp) {
          this.menuIndex = (this.menuIndex - 1 + 4) % 4;
          // Reset all sub-indices when navigating the sidebar so stale
          // positions from a previous panel don't carry over.
          this.partySelectedIndex = 0;
          this.equipSlotIndex = 0; this.equipItemIndex = 0;
          this.itemsSelectedIndex = 0; this.itemsTargetIndex = 0;
          this.saveLoadSelectedIndex = 0;
          this.renderOverlay();
        } else if (jdDown) {
          this.menuIndex = (this.menuIndex + 1) % 4;
          this.partySelectedIndex = 0;
          this.equipSlotIndex = 0; this.equipItemIndex = 0;
          this.itemsSelectedIndex = 0; this.itemsTargetIndex = 0;
          this.saveLoadSelectedIndex = 0;
          this.renderOverlay();
        } else if (jdEnter || jdRight) {
          // Descend into the right panel for the current menu item.
          const subStates = ['PARTY', 'EQUIP_SLOTS', 'ITEMS_SELECT', 'SAVELOAD'];
          this.overlaySubState = subStates[this.menuIndex];
          this.renderOverlay();
        }
        return;
      }

      // ── PARTY sub-state ───────────────────────────────────────────────
      if (this.overlaySubState === 'PARTY') {
        if (jdEsc || jdLeft) {
          if (this.partySwapSource !== null) {
            // Cancel the pending swap
            this.partySwapSource = null;
            this.renderOverlay();
          } else {
            this.overlaySubState = null;
            this.renderOverlay();
          }
          return;
        }
        if (jdUp) {
          this.partySelectedIndex = (this.partySelectedIndex - 1 + GameState.party.length) % GameState.party.length;
          this.renderOverlay();
          if (this.partySwapSource !== null) this._startSwapBlink();
        } else if (jdDown) {
          this.partySelectedIndex = (this.partySelectedIndex + 1) % GameState.party.length;
          this.renderOverlay();
          if (this.partySwapSource !== null) this._startSwapBlink();
        } else if (jdEnter) {
          if (this.partySwapSource === null) {
            // Pick up this character for swapping
            this.partySwapSource = this.partySelectedIndex;
            this.renderOverlay();
            this._startSwapBlink();
          } else if (this.partySwapSource === this.partySelectedIndex) {
            // Confirmed on same character — toggle front/back row
            const member = GameState.party[this.partySwapSource];
            member.row = (member.row === 'front') ? 'back' : 'front';
            this.partySwapSource = null;
            this.renderOverlay();
          } else {
            // Swap the two characters in the party array
            const a = this.partySwapSource;
            const b = this.partySelectedIndex;
            [GameState.party[a], GameState.party[b]] = [GameState.party[b], GameState.party[a]];
            this.partySwapSource = null;
            this.renderOverlay();
          }
        }
        return;
      }

      // ── EQUIP_SLOTS sub-state ─────────────────────────────────────────
      if (this.overlaySubState === 'EQUIP_SLOTS') {
        if (jdEsc) { this.overlaySubState = null; this.renderOverlay(); return; }
        if (jdLeft) {
          // Left/Right cycle through party members for equipment management.
          this.equipCharIndex = (this.equipCharIndex - 1 + GameState.party.length) % GameState.party.length;
          this.equipSlotIndex = 0; this.renderOverlay();
        } else if (jdRight) {
          this.equipCharIndex = (this.equipCharIndex + 1) % GameState.party.length;
          this.equipSlotIndex = 0; this.renderOverlay();
        } else if (jdUp) {
          this.equipSlotIndex = (this.equipSlotIndex - 1 + 4) % 4;
          this.renderOverlay();
        } else if (jdDown) {
          this.equipSlotIndex = (this.equipSlotIndex + 1) % 4;
          this.renderOverlay();
        } else if (jdEnter) {
          this._equipConfirmSlot();
        }
        return;
      }

      // ── EQUIP_ITEMS sub-state ─────────────────────────────────────────
      if (this.overlaySubState === 'EQUIP_ITEMS') {
        if (jdEsc || jdLeft) { this.overlaySubState = 'EQUIP_SLOTS'; this.renderOverlay(); return; }
        const slotKeys = ['primary', 'secondary', 'body', 'head'];
        const targetSlot = slotKeys[this.equipSlotIndex];
        const available = GameState.inventory.filter(it => it.slot === targetSlot);
        if (jdUp) {
          this.equipItemIndex = (this.equipItemIndex - 1 + Math.max(1, available.length)) % Math.max(1, available.length);
          this.renderOverlay();
        } else if (jdDown) {
          this.equipItemIndex = (this.equipItemIndex + 1) % Math.max(1, available.length);
          this.renderOverlay();
        } else if (jdEnter) {
          this._equipConfirmItem();
        }
        return;
      }

      // ── ITEMS_SELECT sub-state ────────────────────────────────────────
      if (this.overlaySubState === 'ITEMS_SELECT') {
        if (jdEsc || jdLeft) { this.overlaySubState = null; this.renderOverlay(); return; }
        const consumables = GameState.inventory.filter(it => !it.slot);
        if (jdUp) {
          this.itemsSelectedIndex = (this.itemsSelectedIndex - 1 + Math.max(1, consumables.length)) % Math.max(1, consumables.length);
          this.renderOverlay();
        } else if (jdDown) {
          this.itemsSelectedIndex = (this.itemsSelectedIndex + 1) % Math.max(1, consumables.length);
          this.renderOverlay();
        } else if (jdEnter && consumables.length > 0) {
          const def = EditorData.getConsumableByName(consumables[this.itemsSelectedIndex].name);
          if (def && def.effect) {
            this.overlaySubState = 'ITEMS_TARGET';
            this.itemsTargetIndex = 0;
            this.renderOverlay();
          } else {
            this._showOverlayMessage(`Can't use ${consumables[this.itemsSelectedIndex].name} yet.`);
          }
        }
        return;
      }

      // ── ITEMS_TARGET sub-state ────────────────────────────────────────
      if (this.overlaySubState === 'ITEMS_TARGET') {
        if (jdEsc || jdLeft) { this.overlaySubState = 'ITEMS_SELECT'; this.renderOverlay(); return; }
        if (jdUp) {
          this.itemsTargetIndex = (this.itemsTargetIndex - 1 + GameState.party.length) % GameState.party.length;
          this.renderOverlay();
        } else if (jdDown) {
          this.itemsTargetIndex = (this.itemsTargetIndex + 1) % GameState.party.length;
          this.renderOverlay();
        } else if (jdEnter) {
          this.applyConsumable();
        }
        return;
      }

      // ── SAVELOAD sub-state ────────────────────────────────────────────
      if (this.overlaySubState === 'SAVELOAD') {
        if (jdEsc || jdLeft) { this.overlaySubState = null; this.renderOverlay(); return; }
        if (jdSpace) {
          this.saveLoadMode = this.saveLoadMode === 'SAVE' ? 'LOAD' : 'SAVE';
          this.renderOverlay();
        } else if (jdUp) {
          this.saveLoadSelectedIndex = (this.saveLoadSelectedIndex - 1 + SaveSystem.NUM_SLOTS) % SaveSystem.NUM_SLOTS;
          this.renderOverlay();
        } else if (jdDown) {
          this.saveLoadSelectedIndex = (this.saveLoadSelectedIndex + 1) % SaveSystem.NUM_SLOTS;
          this.renderOverlay();
        } else if (jdEnter) {
          this.confirmSaveLoadSelection();
        }
        return;
      }

      return; // unknown sub-state — consume input to avoid leaking to movement
    }

    // Enter while adjacent to the wizard NPC opens the dungeon-reset dialogue.
    if (Phaser.Input.Keyboard.JustDown(this.enterKey) && !this.isMoving && !this.encounterTriggered) {
      if (this._isAdjacentToNpc()) {
        this.openNpcDialogue();
        return;
      }
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
