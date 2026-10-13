/**
 * OverlayScene
 * ------------
 * A Phaser "additive" scene that renders the party/equip/items/save
 * overlay on top of whatever exploration scene is currently running
 * (MapScene, DungeonScene, or any future zone). It owns all the overlay
 * state, input handling, and DOM text elements that previously lived
 * inside MapScene.
 *
 * Usage from any exploration scene:
 *
 *   // Open — launches OverlayScene on top without stopping this scene
 *   this.scene.launch('OverlayScene', { callerKey: this.scene.key });
 *
 *   // The caller scene should guard its own P/I key while the overlay
 *   // is active (see _overlayIsActive() helper below in each caller).
 *
 * OverlayScene closes itself (this.scene.stop()) when:
 *   - P, I, or Esc is pressed at the sidebar level
 *
 * Load complete:
 *   After a successful Load, OverlayScene emits 'overlayLoadComplete'
 *   on this.game.events (the global bus). Exploration scenes listen for
 *   this to fade their cameras and reload scene state if needed.
 *
 * Save disabled in dungeon:
 *   Pass { callerKey, disableSave: true } when launching from DungeonScene.
 *   The Save tab is replaced with a greyed-out "(in dungeon)" label.
 */
class OverlayScene extends Phaser.Scene {
  constructor() {
    super({ key: 'OverlayScene' });
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  init(data) {
    // Which scene opened us — used to re-focus input after closing.
    this.callerKey = (data && data.callerKey) ? data.callerKey : 'MapScene';
    // Whether to hide the Save/Load tab (e.g. while inside the dungeon).
    this.disableSave = !!(data && data.disableSave);

    // Overlay navigation state — reset fresh every open.
    this.menuIndex             = 0;   // 0=Party 1=Equip 2=Items 3=Save
    this.overlaySubState       = null;

    this.partySelectedIndex    = 0;
    this.partySwapSource       = null;

    this.equipCharIndex        = 0;
    this.equipSlotIndex        = 0;
    this.equipItemIndex        = 0;

    this.itemsSelectedIndex    = 0;
    this.itemsTargetIndex      = 0;

    this.saveLoadMode          = 'SAVE';
    this.saveLoadSelectedIndex = 0;
    this.pendingLoadConfirm    = null;

    this.overlayEls            = [];
    this._overlayPortraits     = [];
    this._blinkEl              = null;

    // Choice dialogue (for Load confirmation)
    this.dialogueState         = null;
    this.dialogueOptions       = [];
    this.dialogueSelectedIndex = 0;
  }

  create() {
    const { width, height } = this.cameras.main;

    // Semi-opaque full-screen background
    this.overlayBg = this.add.rectangle(width / 2, height / 2, width, height, 0x101018, 0.95)
      .setOrigin(0.5)
      .setScrollFactor(0);

    // Divider between sidebar (left 1/4) and content (right 3/4)
    this.overlayDivider = this.add.rectangle(80, 0, 1, height, 0x334455)
      .setOrigin(0, 0)
      .setScrollFactor(0);

    // Hide world-layer DOM text so it doesn't bleed through
    document.getElementById('text-overlay').style.visibility = 'hidden';

    // Input
    this.cursors   = this.input.keyboard.createCursorKeys();
    this.enterKey  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.escKey    = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.overlayKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.overlayKeyI = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.spaceKey  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // One-frame grace period: the P/I keypress that launched this scene from
    // the caller is still JustDown on this scene's very first update() call
    // (Phaser's JustDown state is shared across additive scenes for that frame).
    // If we read it immediately, we'd close ourselves the same frame we opened.
    // Setting this flag suppresses all key input until the next frame.
    this._inputEnabled = false;

    // Dialogue box (for Load confirmation)
    // NOTE: Use domText.menu() (not domText.create()) so all overlay elements
    // live in #menu-overlay, not #text-overlay. This is critical: create() hides
    // #text-overlay during open, so any element placed there via create() would be
    // invisible while the overlay is open and then leak visible after close.
    const dialogueBoxY = height / 2;
    const dialogueBoxW = width - 60;
    const dialogueBoxH = 90;
    this.dialogueBoxBg = this.add.rectangle(width / 2, dialogueBoxY, dialogueBoxW, dialogueBoxH, 0x000000, 0.92)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setVisible(false);
    this.dialogueTextEl = domText.menu(width / 2, dialogueBoxY - 14, '', {
      fontSize: 12, color: '#ffffff', align: 'center',
    });
    this.dialogueTextEl.style.display = 'none';
    this.dialogueTextEl.style.whiteSpace = 'normal';
    this.dialogueTextEl.style.width = `${(dialogueBoxW - 20) * domText.ZOOM}px`;
    this.dialogueChoiceTexts = [];
    this.dialogueCursorEl = null;

    try {
      this.renderOverlay();
    } catch (e) {
      console.error('[OverlayScene] renderOverlay() threw on open:', e);
      this._closeOverlay();
    }
  }

  shutdown() {
    // _closeOverlay() should have already run cleanup eagerly.
    // This is a safety net for any path that stops the scene without
    // going through _closeOverlay() (e.g. the scene manager stopping it
    // externally, or a scene restart). It's safe to call twice.
    this._stopSwapBlink();
    this._destroyPortraits();
    if (this.overlayEls) { this.overlayEls.forEach(el => domText.remove(el)); this.overlayEls = []; }
    if (this.dialogueTextEl) { domText.remove(this.dialogueTextEl); this.dialogueTextEl = null; }
    if (this.dialogueChoiceTexts) { this.dialogueChoiceTexts.forEach(el => domText.remove(el)); this.dialogueChoiceTexts = []; }
    if (this.dialogueCursorEl) { domText.remove(this.dialogueCursorEl); this.dialogueCursorEl = null; }

    // Nuclear fallback — wipe both layers
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuOverlay) menuOverlay.innerHTML = '';
    const textOverlay = document.getElementById('text-overlay');
    if (textOverlay) { textOverlay.style.visibility = 'visible'; textOverlay.style.opacity = '1'; }
  }

  // ─── Close ───────────────────────────────────────────────────────────────

  _closeOverlay() {
    // Do ALL DOM cleanup here, eagerly, before stopping the scene.
    // Relying solely on shutdown() is fragile: Phaser doesn't guarantee
    // shutdown() fires synchronously on scene.stop() in all edge cases,
    // and any pending time.delayedCall that creates elements after shutdown
    // would leave orphans. Cleaning up here is the guaranteed path.

    // Cancel any pending delayed callbacks so they can't recreate elements
    // after we've wiped the DOM.
    this.time.removeAllEvents();

    // Tracked element cleanup
    this._stopSwapBlink();
    this._destroyPortraits();
    this.overlayEls.forEach(el => domText.remove(el));
    this.overlayEls = [];
    if (this.dialogueTextEl) { domText.remove(this.dialogueTextEl); this.dialogueTextEl = null; }
    this.dialogueChoiceTexts.forEach(el => domText.remove(el));
    this.dialogueChoiceTexts = [];
    if (this.dialogueCursorEl) { domText.remove(this.dialogueCursorEl); this.dialogueCursorEl = null; }

    // Nuclear fallback: wipe both overlay layers entirely
    const menuOverlay = document.getElementById('menu-overlay');
    if (menuOverlay) menuOverlay.innerHTML = '';

    // Restore world-layer visibility and opacity so HUD, NPC dialogue,
    // and BattleScene text all become visible again immediately.
    const textOverlay = document.getElementById('text-overlay');
    textOverlay.style.visibility = 'visible';
    textOverlay.style.opacity = '1';

    // Now stop the scene — shutdown() will run too (a no-op at this point
    // since everything is already cleaned up, which is fine).
    this.scene.stop();
  }

  // ─── Update loop ─────────────────────────────────────────────────────────

  update() {
    // Skip the very first frame so the P/I keypress that opened us from the
    // caller scene doesn't immediately close us (same-frame JustDown sharing).
    if (!this._inputEnabled) { this._inputEnabled = true; return; }

    // Dialogue (Load confirmation) takes priority
    if (this.dialogueState === 'CHOICE') {
      if (Phaser.Input.Keyboard.JustDown(this.cursors.left)) {
        this.dialogueSelectedIndex = (this.dialogueSelectedIndex - 1 + this.dialogueOptions.length) % this.dialogueOptions.length;
        this._updateDialogueCursor();
      } else if (Phaser.Input.Keyboard.JustDown(this.cursors.right)) {
        this.dialogueSelectedIndex = (this.dialogueSelectedIndex + 1) % this.dialogueOptions.length;
        this._updateDialogueCursor();
      } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
        this.dialogueOptions[this.dialogueSelectedIndex].action();
      }
      return;
    }

    const jdUp    = Phaser.Input.Keyboard.JustDown(this.cursors.up);
    const jdDown  = Phaser.Input.Keyboard.JustDown(this.cursors.down);
    const jdLeft  = Phaser.Input.Keyboard.JustDown(this.cursors.left);
    const jdRight = Phaser.Input.Keyboard.JustDown(this.cursors.right);
    const jdEnter = Phaser.Input.Keyboard.JustDown(this.enterKey);
    const jdEsc   = Phaser.Input.Keyboard.JustDown(this.escKey);
    const jdP     = Phaser.Input.Keyboard.JustDown(this.overlayKey);
    const jdI     = Phaser.Input.Keyboard.JustDown(this.overlayKeyI);
    const jdSpace = Phaser.Input.Keyboard.JustDown(this.spaceKey);

    // P / I always close
    if (jdP || jdI) { this._closeOverlay(); return; }

    // ── No sub-state: sidebar has focus ──────────────────────────────────
    if (this.overlaySubState === null) {
      if (jdEsc) { this._closeOverlay(); return; }
      const tabCount = this.disableSave ? 3 : 4;
      if (jdUp) {
        this.menuIndex = (this.menuIndex - 1 + tabCount) % tabCount;
        this._resetSubIndices();
        this.renderOverlay();
      } else if (jdDown) {
        this.menuIndex = (this.menuIndex + 1) % tabCount;
        this._resetSubIndices();
        this.renderOverlay();
      } else if (jdEnter || jdRight) {
        const subStates = ['PARTY', 'EQUIP_SLOTS', 'ITEMS_SELECT', 'SAVELOAD'];
        this.overlaySubState = subStates[this.menuIndex];
        this.renderOverlay();
      }
      return;
    }

    // ── PARTY ─────────────────────────────────────────────────────────────
    if (this.overlaySubState === 'PARTY') {
      if (jdEsc || jdLeft) {
        if (this.partySwapSource !== null) {
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
          this.partySwapSource = this.partySelectedIndex;
          this.renderOverlay();
          this._startSwapBlink();
        } else if (this.partySwapSource === this.partySelectedIndex) {
          const member = GameState.party[this.partySwapSource];
          member.row = (member.row === 'front') ? 'back' : 'front';
          this.partySwapSource = null;
          this.renderOverlay();
        } else {
          const a = this.partySwapSource;
          const b = this.partySelectedIndex;
          [GameState.party[a], GameState.party[b]] = [GameState.party[b], GameState.party[a]];
          this.partySwapSource = null;
          this.renderOverlay();
        }
      }
      return;
    }

    // ── EQUIP_SLOTS ───────────────────────────────────────────────────────
    if (this.overlaySubState === 'EQUIP_SLOTS') {
      if (jdEsc) { this.overlaySubState = null; this.renderOverlay(); return; }
      if (jdLeft) {
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

    // ── EQUIP_ITEMS ───────────────────────────────────────────────────────
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

    // ── ITEMS_SELECT ──────────────────────────────────────────────────────
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

    // ── ITEMS_TARGET ──────────────────────────────────────────────────────
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

    // ── SAVELOAD ──────────────────────────────────────────────────────────
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
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _resetSubIndices() {
    this.partySelectedIndex = 0;
    this.equipSlotIndex = 0; this.equipItemIndex = 0;
    this.itemsSelectedIndex = 0; this.itemsTargetIndex = 0;
    this.saveLoadSelectedIndex = 0;
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  /** Clears and redraws the entire overlay from current state. */
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
      console.error('[OverlayScene] render error:', e);
    }
  }

  clearOverlayContent() {
    this._stopSwapBlink();
    this._destroyPortraits();
    this.overlayEls.forEach(el => domText.remove(el));
    this.overlayEls = [];
  }

  // ─── Sidebar ─────────────────────────────────────────────────────────────

  renderSidebar() {
    const LABELS = this.disableSave ? ['Party', 'Equip', 'Items'] : ['Party', 'Equip', 'Items', 'Save'];
    const SX = 6;
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

    if (this.disableSave) {
      const saveY = startY + LABELS.length * rowH;
      this.overlayEls.push(
        domText.menu(SX + 12, saveY, 'Save', { fontSize: 11, color: '#2a3a4a', align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(SX + 12, saveY + 10, '(in dungeon)', { fontSize: 7, color: '#2a3a4a', align: 'left' })
      );
    }

    const hint = sidebarFocused ? '↑↓ Enter' : '← Esc back';
    this.overlayEls.push(
      domText.menu(SX, 128, hint, { fontSize: 7, color: '#2a3a4a', align: 'left' })
    );
  }

  // ─── Party panel ─────────────────────────────────────────────────────────

  renderPartyPanel() {
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

      if (isSelected) {
        this.overlayEls.push(
          domText.menu(RX - 8, y + 12, '▶', { fontSize: 9, color: '#ffff00', align: 'left' })
        );
      }

      const isSwapSource = (this.partySwapSource === i);
      const nameColor = member.hp <= 0 ? '#884444' : isSwapSource ? '#ffff00' : '#ffffff';
      const nameEl = domText.menu(RX + 28, y + 2, member.name, { fontSize: 11, color: nameColor, align: 'left' });
      if (isSwapSource) { this._blinkEl = nameEl; }
      this.overlayEls.push(nameEl);

      const rowLabel = (member.row || 'front') === 'front' ? '[F]' : '[B]';
      const rowColor = (member.row || 'front') === 'front' ? '#88cc88' : '#8888cc';
      this.overlayEls.push(
        domText.menu(RX + 110, y + 2, rowLabel, { fontSize: 10, color: rowColor, align: 'left' })
      );

      const hpColor = member.hp / member.maxHp > 0.4 ? '#33cc66' : '#cc4444';
      this.overlayEls.push(
        domText.menu(RX + 28, y + 15, `HP ${member.hp}/${member.maxHp}`, { fontSize: 10, color: hpColor, align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(RX + 28, y + 26, `MP ${member.mp}/${member.maxMp}`, { fontSize: 10, color: '#5599ff', align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(RX + 140, y + 2, `Lv ${member.level}`, { fontSize: 10, color: '#ffcc33', align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(RX + 140, y + 15, `XP ${member.xp}/${GameState.xpThresholdForLevel(member.level)}`, { fontSize: 9, color: '#776633', align: 'left' })
      );
      this.overlayEls.push(
        domText.menu(RX + 140, y + 26, `Atk ${stats.attackMin}-${stats.attackMax}  Def ${stats.defense}`, { fontSize: 9, color: '#99aabb', align: 'left' })
      );
    });

    const partyHintY = Math.max(120, startY + GameState.party.length * rowH + 8);
    const partyHint = this.partySwapSource !== null
      ? '↑↓ select  Enter swap / same=row toggle  Esc cancel'
      : '↑↓ browse  Enter select  (same char toggles row)';
    this.overlayEls.push(
      domText.menu(RX, partyHintY, partyHint, { fontSize: 7, color: '#7788aa', align: 'left' })
    );

    if (this.partySwapSource !== null) this._startSwapBlink();

    this._destroyPortraits();
    this._overlayPortraits = GameState.party.map((member, i) => {
      const y = startY + i * rowH;
      return this.add.rectangle(
        RX + 11, y + 15, 22, 30,
        member.hp > 0 ? 0x1a3a55 : 0x3a1a1a
      ).setScrollFactor(0).setOrigin(0.5);
    });
  }

  _startSwapBlink() {
    if (this._blinkEl) this._blinkEl.classList.add('swap-blink');
  }
  _stopSwapBlink() {
    if (this._blinkEl) this._blinkEl.classList.remove('swap-blink');
    this._blinkEl = null;
  }
  _destroyPortraits() {
    if (this._overlayPortraits) {
      this._overlayPortraits.forEach(r => r.destroy());
    }
    this._overlayPortraits = [];
  }

  // ─── Equip panel ─────────────────────────────────────────────────────────

  renderEquipPanel() {
    const RX = 88;
    const SLOT_LABELS = [
      { key: 'primary',   label: 'Primary'   },
      { key: 'secondary', label: 'Secondary' },
      { key: 'body',      label: 'Body'      },
      { key: 'head',      label: 'Head'      },
    ];

    const character = GameState.party[this.equipCharIndex];
    if (!character) return;

    this.overlayEls.push(domText.menu(RX, 10, 'EQUIP', { fontSize: 8, color: '#334455', align: 'left' }));
    this.overlayEls.push(domText.menu(RX + 48, 10, `◄ ${character.name} ►`, { fontSize: 10, color: '#ffcc33', align: 'left' }));
    this.overlayEls.push(domText.menu(RX + 160, 10, '←/→ switch', { fontSize: 8, color: '#2a3a4a', align: 'left' }));

    const slotStartY = 28;
    const slotRowH = 18;
    this.overlayEls.push(domText.menu(RX, slotStartY - 10, 'Equipped:', { fontSize: 8, color: '#8899aa', align: 'left' }));

    SLOT_LABELS.forEach((slot, i) => {
      const y = slotStartY + i * slotRowH;
      const equipped = character.equipment[slot.key];
      const isSelected = this.overlaySubState === 'EQUIP_SLOTS' && this.equipSlotIndex === i;

      if (isSelected) {
        this.overlayEls.push(domText.menu(RX, y, '▶', { fontSize: 9, color: '#ffff00', align: 'left' }));
      }
      this.overlayEls.push(domText.menu(RX + 12, y, `${slot.label}:`, { fontSize: 10, color: '#aabbcc', align: 'left' }));
      this.overlayEls.push(domText.menu(RX + 90, y, equipped ? equipped.name : '—', { fontSize: 10, color: equipped ? '#ffffff' : '#667788', align: 'left' }));

      if (equipped && equipped.bonus) {
        const bonuses = Array.isArray(equipped.bonus)
          ? equipped.bonus.map(b => `+${b.amount} ${b.stat}`).join(' ')
          : Object.entries(equipped.bonus).map(([k, v]) => `+${v} ${k}`).join(' ');
        this.overlayEls.push(domText.menu(RX + 170, y, bonuses, { fontSize: 8, color: '#88aacc', align: 'left' }));
      }
    });

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

  _equipConfirmItem() {
    const character = GameState.party[this.equipCharIndex];
    const slotKeys = ['primary', 'secondary', 'body', 'head'];
    const targetSlot = slotKeys[this.equipSlotIndex];
    const available = GameState.inventory.filter(it => it.slot === targetSlot);
    const item = available[this.equipItemIndex];
    if (item) GameState.equipItem(character, item);
    this.overlaySubState = 'EQUIP_SLOTS';
    this.equipItemIndex = 0;
    this.renderOverlay();
  }

  // ─── Items panel ─────────────────────────────────────────────────────────

  renderItemsPanel() {
    const RX = 88;
    this.overlayEls.push(domText.menu(RX, 10, 'ITEMS', { fontSize: 9, color: '#99aabb', align: 'left' }));

    if (this.overlaySubState === 'ITEMS_TARGET') {
      this._renderItemsTargetView(RX);
      return;
    }

    const consumables = GameState.inventory.filter(it => !it.slot);
    if (consumables.length === 0) {
      this.overlayEls.push(domText.menu(RX + 10, 30, '(no items)', { fontSize: 10, color: '#445566', align: 'left' }));
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
      this.overlayEls.push(domText.menu(RX + 12, y, item.name, { fontSize: 10, color: '#ffffff', align: 'left' }));
      this.overlayEls.push(domText.menu(RX + 140, y, `x${item.quantity}`, { fontSize: 10, color: '#aabbcc', align: 'left' }));
    });

    const itemsHintY = Math.max(120, startY + consumables.length * rowH + 8);
    const hint = this.overlaySubState === 'ITEMS_SELECT'
      ? '↑↓ select  Enter use'
      : 'Enter to use';
    this.overlayEls.push(domText.menu(RX, itemsHintY, hint, { fontSize: 7, color: '#7788aa', align: 'left' }));
  }

  _renderItemsTargetView(RX) {
    const startY = 30;
    const rowH = 26;
    this.overlayEls.push(domText.menu(RX, 14, 'Use on who?', { fontSize: 10, color: '#ffcc33', align: 'left' }));

    GameState.party.forEach((member, i) => {
      const y = startY + i * rowH;
      const isSelected = this.itemsTargetIndex === i;
      const hpColor = member.hp / member.maxHp > 0.4 ? '#33cc66' : '#cc4444';
      if (isSelected) {
        this.overlayEls.push(domText.menu(RX, y + 6, '▶', { fontSize: 10, color: '#ffff00', align: 'left' }));
      }
      this.overlayEls.push(domText.menu(RX + 14, y, member.name, { fontSize: 11, color: isSelected ? '#ffffff' : '#778899', align: 'left' }));
      this.overlayEls.push(domText.menu(RX + 14, y + 14, `HP ${member.hp}/${member.maxHp}`, { fontSize: 10, color: hpColor, align: 'left' }));
      this.overlayEls.push(domText.menu(RX + 120, y + 14, `MP ${member.mp ?? 0}/${member.maxMp ?? 0}`, { fontSize: 10, color: '#5599ff', align: 'left' }));
    });

    const targetHintY = Math.max(120, startY + GameState.party.length * rowH + 8);
    this.overlayEls.push(domText.menu(RX, targetHintY, '↑↓ select  Enter confirm  Esc cancel', { fontSize: 7, color: '#7788aa', align: 'left' }));
  }

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

  _showOverlayMessage(msg) {
    this.clearOverlayContent();
    this.renderSidebar();
    const RX = 88;
    const panelW = 316 - RX;
    this.overlayEls.push(
      domText.menu(RX + panelW / 2, 72, msg, { fontSize: 11, color: '#ffcc33', align: 'center' })
    );
    this.time.delayedCall(1200, () => {
      if (this.scene.isActive()) this.renderOverlay();
    });
  }

  // ─── Save / Load panel ───────────────────────────────────────────────────

  renderSaveLoadPanel() {
    const RX = 88;
    this.overlayEls.push(domText.menu(RX, 10, 'SAVE / LOAD', { fontSize: 9, color: '#556677', align: 'left' }));

    const modeColor = this.saveLoadMode === 'SAVE' ? '#ffcc33' : '#33aaff';
    this.overlayEls.push(domText.menu(RX, 22, this.saveLoadMode, { fontSize: 12, color: modeColor, align: 'left' }));
    this.overlayEls.push(domText.menu(RX + 60, 24, '[Space] toggle', { fontSize: 9, color: '#445566', align: 'left' }));

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
      this.overlayEls.push(domText.menu(RX + 14, y, slotLabel, { fontSize: 10, color: rowColor, align: 'left' }));
      this.overlayEls.push(domText.menu(RX + 14, y + 12, statusText, { fontSize: 9, color: snapshot ? '#aaccaa' : '#445566', align: 'left' }));
      if (timeText) {
        this.overlayEls.push(domText.menu(RX + 160, y + 12, timeText, { fontSize: 9, color: '#556677', align: 'left' }));
      }
    }

    if (this.overlaySubState === 'SAVELOAD') {
      this.overlayEls.push(domText.menu(RX, 120, '↑↓ select  Enter confirm', { fontSize: 7, color: '#7788aa', align: 'left' }));
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

    this._openChoiceDialogue(`Load Slot ${slotNumber}? Current progress will be overwritten.`, [
      { label: 'Load', action: () => this.performLoad(slotNumber) },
      { label: 'Cancel', action: () => this._closeChoiceDialogue() },
    ]);
  }

  performLoad(slotNumber) {
    SaveSystem.loadFromSlot(slotNumber);
    this._closeChoiceDialogue();
    this.clearOverlayContent();
    this.renderSidebar();
    this.overlayEls.push(
      domText.menu(202, 72, `Loaded Slot ${slotNumber}!`, { fontSize: 13, color: '#33cc66', align: 'center' })
    );

    this.time.delayedCall(900, () => {
      // Emit on the global event bus so the caller scene can fade its camera
      this.game.events.emit('overlayLoadComplete');
      this._closeOverlay();
    });
  }

  // ─── Inline choice dialogue (for Load confirmation) ───────────────────────

  _openChoiceDialogue(text, options) {
    this.dialogueState = 'CHOICE';
    this.dialogueOptions = options;
    this.dialogueSelectedIndex = 0;
    this.dialogueBoxBg.setVisible(true);
    this.dialogueTextEl.style.display = 'block';
    domText.setText(this.dialogueTextEl, text);
    this._renderDialogueChoices();
  }

  _closeChoiceDialogue() {
    this.dialogueState = null;
    this.dialogueBoxBg.setVisible(false);
    this.dialogueTextEl.style.display = 'none';
    this.dialogueChoiceTexts.forEach(el => domText.remove(el));
    this.dialogueChoiceTexts = [];
    if (this.dialogueCursorEl) {
      domText.remove(this.dialogueCursorEl);
      this.dialogueCursorEl = null;
    }
    this.renderOverlay();
  }

  _renderDialogueChoices() {
    const { width, height } = this.cameras.main;
    const slotWidth = 70;
    const startX = width / 2 - (this.dialogueOptions.length * slotWidth) / 2 + 16;
    const y = height / 2 + 28;
    // Use domText.menu() so these go into #menu-overlay, not #text-overlay.
    // Elements in #text-overlay are hidden while the overlay is open and leak
    // visible after close — using menu() keeps them in the correct layer.
    this.dialogueChoiceTexts = this.dialogueOptions.map((opt, i) =>
      domText.menu(startX + i * slotWidth, y, opt.label, { fontSize: 12, color: '#ffffff', align: 'left' })
    );
    this.dialogueCursorEl = domText.menu(startX - 16, y, '>', { fontSize: 12, color: '#ffff00', align: 'left' });
    this._updateDialogueCursor();
  }

  _updateDialogueCursor() {
    const { width } = this.cameras.main;
    const slotWidth = 70;
    const startX = width / 2 - (this.dialogueOptions.length * slotWidth) / 2 + 16;
    const x = startX - 16 + this.dialogueSelectedIndex * slotWidth;
    if (this.dialogueCursorEl) {
      this.dialogueCursorEl.style.left = `${x * domText.ZOOM}px`;
    }
  }
}
