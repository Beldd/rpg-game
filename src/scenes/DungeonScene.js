/**
 * DungeonScene
 * ------------
 * A self-contained dungeon floor. Loaded when the player steps through
 * the dungeon entrance in MapScene, and returns to MapScene when the
 * player steps back through the exit at the top of the map.
 *
 * Shares the same Kenney tileset and tile-index conventions as MapScene:
 *   0  = void (empty / border)  → blocked
 *   27 = wall                   → blocked
 *   41 = detailed floor         → walkable
 *   50 = stone floor            → walkable
 *
 * Keeps the same grid-locked movement, camera follow, and encounter
 * trigger pattern as MapScene. The status/inventory overlay and
 * save/load system are intentionally absent here — the player handles
 * those in town. (They can be added later if needed.)
 *
 * EXIT TRIGGER — tiles (13, 1), (14, 1), (15, 1): the door gap in the
 * north wall of the dungeon map. Stepping onto any of these fades out
 * and returns the player to MapScene, placing them just outside the
 * dungeon building entrance.
 */
class DungeonScene extends Phaser.Scene {
  constructor() {
    super({ key: 'DungeonScene' });

    this.TILE_SIZE = 16;
    this.BLOCKED_TILES = [0, 27];

    this.isMoving = false;

    // Exit trigger tile positions (door gap in north wall of dungeon.json)
    this.EXIT_TILES = [
      { x: 13, y: 1 },
      { x: 14, y: 1 },
      { x: 15, y: 1 },
    ];

    // Same dialogue-state fields as MapScene (used for encounter challenge)
    this.dialogueState = null;
    this.dialogueOptions = [];
    this.dialogueSelectedIndex = 0;

    this.encounterTriggered = false;
    this.activeEncounterId = null;
    this.transitionTriggered = false;

    // Tile bag for random encounters — same pattern as MapScene.
    // 15 tokens, 1 encounter, 14 safe. Bag is filled on first draw.
    this._encounterBag    = [];
    this._encounterBagIdx = 0;
  }

  preload() {
    // Reuse the same tileset image — Phaser caches it after MapScene
    // loads it, so this is effectively free on subsequent visits.
    this.load.image('tiles', 'assets/kenny/tiny_dungeon/Tilemap/tilemap_packed.png');
    this.load.tilemapTiledJSON('dungeon', 'assets/dungeon.json');
    this.load.image('player', 'assets/player.png');
    this.load.image('enemy', 'assets/enemy.png');
  }

  create() {
    // Reset all per-visit state here (not in the constructor) because
    // Phaser reuses the scene instance across scene.start() calls —
    // the constructor only runs once, so any state left dirty from a
    // previous visit (e.g. encounterTriggered=true after a battle)
    // would carry over and freeze the player on re-entry.
    this.isMoving = false;
    this.encounterTriggered = false;
    this.transitionTriggered = false;
    this.dialogueState = null;
    this.dialogueOptions = [];
    this.dialogueSelectedIndex = 0;
    this.activeEncounterId = null;
    // Reset bag so each dungeon visit starts with a fresh shuffle.
    this._encounterBag    = [];
    this._encounterBagIdx = 0;

    domText.fadeIn();
    this.cameras.main.setBackgroundColor('#000000');

    const map = this.make.tilemap({ key: 'dungeon' });
    const tileset = map.addTilesetImage('kenney_tiny_dungeon', 'tiles');
    this.groundLayer = map.createLayer('ground', tileset, 0, 0);
    this.map = map;

    // --- Return data (from BattleScene) ---
    // When returning from a battle, BattleScene passes back a returnData
    // object with the tile the player was on when the encounter triggered,
    // plus whether it was a victory and (for static encounters) which
    // encounter was defeated. We use this to restore position and hide
    // defeated static encounter sprites.
    const sceneData  = this.scene.settings.data || {};

    // Only trust returnData that genuinely came from BattleScene this
    // transition. BattleScene always merges a `victory` boolean into the
    // data it passes back; a fresh entry from MapScene (or stale settings
    // data from a previous visit) will never have that field. Without this
    // guard, Phaser's scene.settings.data persistence causes old battle
    // results to re-apply on every subsequent dungeon entry.
    const rawReturn  = sceneData.returnData || null;
    const returnData = (rawReturn && typeof rawReturn.victory === 'boolean') ? rawReturn : null;

    // If returning from a static encounter victory, record it as defeated
    // so it stays hidden for the rest of this dungeon run.
    if (returnData && returnData.victory && returnData.isStaticEncounter) {
      GameState.dungeonDefeatedIds.add(returnData.encounterId);
    }

    // --- Player spawn ---
    // Default: entrance vestibule just inside the north-wall door gap.
    // Override with the tile stored in returnData when returning from any
    // battle (random or static) — this puts the player back where the fight
    // started rather than resetting them to the entrance every time.
    // Exception: static encounter LOSS — return to entrance so the player
    // can re-equip/heal before trying again; sprite persists (no defeat record).
    const defaultSpawnX = 14;
    const defaultSpawnY = 3;
    let spawnX = defaultSpawnX;
    let spawnY = defaultSpawnY;
    if (returnData && returnData.spawnTileX !== undefined) {
      // Use the saved position for victories and random encounter losses.
      // For static encounter losses (victory=false, isStaticEncounter=true),
      // reset to entrance so the player isn't immediately re-challenged.
      const isStaticLoss = returnData.isStaticEncounter && !returnData.victory;
      if (!isStaticLoss) {
        spawnX = returnData.spawnTileX;
        spawnY = returnData.spawnTileY;
      }
    }

    this.player = this.add.image(
      spawnX * this.TILE_SIZE + this.TILE_SIZE / 2,
      spawnY * this.TILE_SIZE + this.TILE_SIZE / 2,
      'player'
    );
    this.playerTileX = spawnX;
    this.playerTileY = spawnY;

    // --- Camera ---
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // --- Encounters ---
    // Build static encounter list. Encounters already in GameState.dungeonDefeatedIds
    // are spawned with their sprite hidden (defeated this run) so the player can't
    // re-trigger them until the dungeon is reset.
    this.staticEncounters = EditorData.getStaticEncounters().map(enc => {
      const pos = enc.dungeonPosition || enc.mapPosition;
      const defeated = GameState.dungeonDefeatedIds.has(enc.id);
      const sprite = this.add.image(
        pos.tileX * this.TILE_SIZE + this.TILE_SIZE / 2,
        pos.tileY * this.TILE_SIZE + this.TILE_SIZE / 2,
        'enemy'
      ).setVisible(!defeated);
      return {
        id: enc.id,
        tileX: pos.tileX,
        tileY: pos.tileY,
        sprite,
        defeated,
      };
    });

    // --- Dialogue box (for encounter challenge) ---
    const { width, height } = this.cameras.main;
    const dialogueBoxY = height / 2;
    const dialogueBoxW = width - 60;
    const dialogueBoxH = 90;

    this.dialogueBoxBg = this.add.rectangle(width / 2, dialogueBoxY, dialogueBoxW, dialogueBoxH, 0x000000, 0.85)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);

    this.dialogueTextEl = domText.create(width / 2, dialogueBoxY - 14, '', {
      fontSize: 12,
      color: '#ffffff',
      align: 'center',
    });
    this.dialogueTextEl.style.display = 'none';
    this.dialogueTextEl.style.whiteSpace = 'normal';
    this.dialogueTextEl.style.width = `${(dialogueBoxW - 20) * domText.ZOOM}px`;

    this.dialogueChoiceTexts = [];
    this.dialogueCursorEl = null;

    // --- Input ---
    this.cursors = this.input.keyboard.createCursorKeys();
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    // P / I open the inventory/status overlay (Save is disabled mid-dungeon)
    this.overlayKey  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.overlayKeyI = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);

    // After a Load performed in OverlayScene, fade the camera so state updates cleanly.
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

    // Fade in from black on entry
    this.cameras.main.fadeIn(400, 0, 0, 0);

    console.log(`Dungeon loaded: ${map.width}x${map.height} tiles`);
  }

  // ─── Collision ───────────────────────────────────────────────────────────

  isTileBlocked(tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= this.map.width || tileY >= this.map.height) {
      return true;
    }
    const tile = this.groundLayer.getTileAt(tileX, tileY);
    if (!tile) return true;
    return this.BLOCKED_TILES.includes(tile.index);
  }

  // ─── Random encounter helpers ────────────────────────────────────────────

  _refillEncounterBag() {
    this._encounterBag = [true, ...Array(14).fill(false)];
    for (let i = this._encounterBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this._encounterBag[i], this._encounterBag[j]] = [this._encounterBag[j], this._encounterBag[i]];
    }
    this._encounterBagIdx = 0;
  }

  _drawEncounterToken() {
    if (this._encounterBagIdx >= this._encounterBag.length) this._refillEncounterBag();
    return this._encounterBag[this._encounterBagIdx++];
  }

  /**
   * Called after each completed step. The dungeon is always zone 'dungeon',
   * so no coordinate-based zone lookup is needed here.
   */
  _checkRandomEncounter() {
    const encounterIds = EditorData.getRandomEncounterIds('dungeon');
    if (!encounterIds.length) return false;
    if (!this._drawEncounterToken()) return false;

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

    // Capture current tile BEFORE the scene transitions — this is where
    // the player will reappear after the random encounter resolves.
    const spawnX = this.playerTileX;
    const spawnY = this.playerTileY;

    this.cameras.main.fadeOut(400, 0, 0, 0);
    domText.fadeOut();
    this.cameras.main.once('camerafadeoutcomplete', () => {
      domText.clearAll();
      this.scene.start('BattleScene', {
        encounterId: this.activeEncounterId,
        returnScene: 'DungeonScene',
        returnData: {
          spawnTileX: spawnX,
          spawnTileY: spawnY,
          isStaticEncounter: false,
        },
      });
    });
  }

  // ─── Movement ────────────────────────────────────────────────────────────

  tryMove(dx, dy) {
    if (this.isMoving || this.encounterTriggered || this.transitionTriggered) return;
    if (this.dialogueState) return;

    const targetTileX = this.playerTileX + dx;
    const targetTileY = this.playerTileY + dy;

    // Check exit trigger first
    const isExit = this.EXIT_TILES.some(t => t.x === targetTileX && t.y === targetTileY);
    if (isExit) {
      this.returnToTown();
      return;
    }

    // Check encounters — skip any that have already been defeated this run.
    const hitEncounter = this.staticEncounters.find(
      enc => !enc.defeated && enc.tileX === targetTileX && enc.tileY === targetTileY
    );
    if (hitEncounter) {
      this.activeEncounterId = hitEncounter.id;
      // Store the tile the player is stepping FROM (current position before
      // the move commits) as the spawn-back point after the battle.
      this._pendingSpawnTile = { x: this.playerTileX, y: this.playerTileY };
      this.startEncounter();
      return;
    }

    if (this.isTileBlocked(targetTileX, targetTileY)) return;

    this.isMoving = true;
    this.playerTileX = targetTileX;
    this.playerTileY = targetTileY;

    this.tweens.add({
      targets: this.player,
      x: targetTileX * this.TILE_SIZE + this.TILE_SIZE / 2,
      y: targetTileY * this.TILE_SIZE + this.TILE_SIZE / 2,
      duration: 150,
      onComplete: () => {
        this.isMoving = false;
        if (!this.encounterTriggered) {
          this._checkRandomEncounter();
        }
      },
    });
  }

  // ─── Scene transitions ───────────────────────────────────────────────────

  /**
   * Returns the player to MapScene, placing them just outside the
   * dungeon building entrance (tile 32, 21 — one tile south of the door).
   * MapScene reads the 'returnX' / 'returnY' data passed via scene.start()
   * to know where to spawn the player.
   */
  returnToTown() {
    this.transitionTriggered = true;
    this.cameras.main.fadeOut(400, 0, 0, 0);
    domText.fadeOut();
    this.cameras.main.once('camerafadeoutcomplete', () => {
      domText.clearAll();
      this.scene.start('MapScene', { returnX: 32, returnY: 21 });
    });
  }

  /**
   * Shows the encounter's challenge dialogue before starting the battle,
   * same pattern as MapScene.startEncounter().
   */
  startEncounter() {
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

    const enc = EditorData.getEncounter(this.activeEncounterId);
    if (!enc) {
      this.encounterTriggered = false;
      return;
    }

    const interlopers = GameState.party.filter(m => m.hp > 0).map(m => m.name).join(' and ');
    const challenge = (enc.dialogue?.challenge || '{name} wants to fight!')
      .replace('{name}', enc.name)
      .replace('{interlopers}', interlopers);

    this.openChoiceDialogue(challenge, [
      { label: 'Fight', action: () => this.acceptChallenge() },
      { label: 'Flee',  action: () => {
          this.closeDialogue();
          this.encounterTriggered = false;
        }
      },
    ]);
  }

  acceptChallenge() {
    this.closeDialogue();
    this.cameras.main.fadeOut(400, 0, 0, 0);
    domText.fadeOut();
    this.cameras.main.once('camerafadeoutcomplete', () => {
      const spawn = this._pendingSpawnTile || { x: 14, y: 3 };
      this.scene.start('BattleScene', {
        encounterId: this.activeEncounterId,
        returnScene: 'DungeonScene',
        returnData: {
          spawnTileX: spawn.x,
          spawnTileY: spawn.y,
          encounterId: this.activeEncounterId,
          isStaticEncounter: true,
        },
      });
    });
  }

  // ─── Dialogue (shared with MapScene pattern) ─────────────────────────────

  openChoiceDialogue(text, options) {
    this.dialogueState = 'CHOICE';
    this.dialogueOptions = options;
    this.dialogueSelectedIndex = 0;
    this.dialogueBoxBg.setVisible(true);
    this.dialogueTextEl.style.display = 'block';
    domText.setText(this.dialogueTextEl, text);
    this.renderDialogueChoices();
  }

  renderDialogueChoices() {
    const { width, height } = this.cameras.main;
    const slotWidth = 70;
    const startX = width / 2 - (this.dialogueOptions.length * slotWidth) / 2 + 16;
    const y = height / 2 + 28;

    this.dialogueChoiceTexts = this.dialogueOptions.map((opt, i) =>
      domText.create(startX + i * slotWidth, y, opt.label, { fontSize: 12, color: '#ffffff', align: 'left' })
    );
    this.dialogueCursorEl = domText.create(startX - 16, y, '>', { fontSize: 12, color: '#ffff00', align: 'left' });
    this.updateDialogueCursorPosition();
  }

  updateDialogueCursorPosition() {
    const { width } = this.cameras.main;
    const slotWidth = 70;
    const startX = width / 2 - (this.dialogueOptions.length * slotWidth) / 2 + 16;
    const x = startX - 16 + this.dialogueSelectedIndex * slotWidth;
    this.dialogueCursorEl.style.left = `${x * domText.ZOOM}px`;
  }

  closeDialogue() {
    this.dialogueState = null;
    this.dialogueBoxBg.setVisible(false);
    this.dialogueTextEl.style.display = 'none';
    this.dialogueChoiceTexts.forEach(el => domText.remove(el));
    this.dialogueChoiceTexts = [];
    if (this.dialogueCursorEl) {
      domText.remove(this.dialogueCursorEl);
      this.dialogueCursorEl = null;
    }
  }

  // ─── Update loop ─────────────────────────────────────────────────────────

  update() {
    // P / I open the overlay (Save disabled mid-dungeon).
    if (Phaser.Input.Keyboard.JustDown(this.overlayKey)
        || Phaser.Input.Keyboard.JustDown(this.overlayKeyI)) {
      if (!this.scene.isActive('OverlayScene')) {
        this.scene.launch('OverlayScene', { callerKey: 'DungeonScene', disableSave: true });
      }
      return;
    }

    // While OverlayScene is active on top, suppress all dungeon input.
    if (this.scene.isActive('OverlayScene')) return;

    if (this.dialogueState === 'CHOICE') {
      if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) {
        this.dialogueSelectedIndex = Math.max(0, this.dialogueSelectedIndex - 1);
        this.updateDialogueCursorPosition();
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
        this.dialogueSelectedIndex = Math.min(this.dialogueOptions.length - 1, this.dialogueSelectedIndex + 1);
        this.updateDialogueCursorPosition();
      } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.dialogueOptions[this.dialogueSelectedIndex].action();
      }
      return;
    }

    if (this.cursors.left.isDown)  this.tryMove(-1,  0);
    else if (this.cursors.right.isDown) this.tryMove( 1,  0);
    else if (this.cursors.up.isDown)    this.tryMove( 0, -1);
    else if (this.cursors.down.isDown)  this.tryMove( 0,  1);
  }
}
