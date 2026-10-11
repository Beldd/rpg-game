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

    domText.fadeIn();
    this.cameras.main.setBackgroundColor('#000000');

    const map = this.make.tilemap({ key: 'dungeon' });
    const tileset = map.addTilesetImage('kenney_tiny_dungeon', 'tiles');
    this.groundLayer = map.createLayer('ground', tileset, 0, 0);
    this.map = map;

    // --- Player spawn ---
    // Place the player just inside the entrance vestibule (below the
    // north-wall door gap, which is the exit back to town).
    const startTileX = 14;
    const startTileY = 3;
    this.player = this.add.image(
      startTileX * this.TILE_SIZE + this.TILE_SIZE / 2,
      startTileY * this.TILE_SIZE + this.TILE_SIZE / 2,
      'player'
    );
    this.playerTileX = startTileX;
    this.playerTileY = startTileY;

    // --- Camera ---
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // --- Encounters ---
    // Only load encounters whose mapPosition falls inside the dungeon
    // map bounds — the editor stores a single position per encounter,
    // so the same slime definition drives a dungeon encounter here.
    this.staticEncounters = EditorData.getStaticEncounters().map(enc => {
      // Prefer dungeonPosition if defined, fall back to mapPosition.
      const pos = enc.dungeonPosition || enc.mapPosition;
      return {
        id: enc.id,
        tileX: pos.tileX,
        tileY: pos.tileY,
        sprite: this.add.image(
          pos.tileX * this.TILE_SIZE + this.TILE_SIZE / 2,
          pos.tileY * this.TILE_SIZE + this.TILE_SIZE / 2,
          'enemy'
        ),
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

    // Check encounters
    const hitEncounter = this.staticEncounters.find(
      enc => enc.tileX === targetTileX && enc.tileY === targetTileY
    );
    if (hitEncounter) {
      this.activeEncounterId = hitEncounter.id;
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
      onComplete: () => { this.isMoving = false; },
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
      // Pass 'DungeonScene' as the returnScene so BattleScene knows
      // where to go after the battle ends.
      this.scene.start('BattleScene', {
        encounterId: this.activeEncounterId,
        returnScene: 'DungeonScene',
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
