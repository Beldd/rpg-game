/**
 * TitleScene
 * ----------
 * The very first thing the player sees. Shows the game's title and a
 * Continue/New Game menu — Continue loads the most recently used save
 * slot (via SaveSystem.mostRecentSlot()), New Game resets GameState to
 * fresh defaults (via GameState.resetToNewGame()) before proceeding.
 *
 * Continue is shown grayed-out and non-selectable-but-visible if no
 * save exists at all, per the agreed design — the menu always has the
 * same two options in the same place, rather than changing shape
 * depending on hidden save-state, which would be less predictable.
 */
class TitleScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TitleScene' });
  }

  create() {
    const { width, height } = this.cameras.main;

    this.add.rectangle(0, 0, width, height, 0x0a0a2e).setOrigin(0, 0);

    domText.create(width / 2, height / 2 - 50, 'FANTASY OF ARCADIA', {
      fontSize: 14,
      color: '#ffffff',
    });

    const hasSave = SaveSystem.anySaveExists();

    this.menuOptions = [
      {
        label: 'Continue',
        disabled: !hasSave,
        action: () => this.handleContinue(),
      },
      {
        label: 'New Game',
        disabled: false,
        action: () => this.handleNewGame(),
      },
    ];
    this.selectedIndex = hasSave ? 0 : 1; // default to whichever option is actually usable

    const menuBaseY = height / 2;
    this.menuTexts = this.menuOptions.map((opt, i) =>
      domText.create(width / 2 - 30, menuBaseY + i * 20, opt.label, {
        fontSize: 12,
        color: opt.disabled ? '#777777' : '#ffffff',
        align: 'left',
      })
    );

    this.menuCursorEl = domText.create(width / 2 - 50, menuBaseY, '>', {
      fontSize: 12,
      color: '#ffff00',
      align: 'left',
    });
    this.updateCursorPosition();

    this.cursors = this.input.keyboard.createCursorKeys();
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    this.cameras.main.fadeIn(400, 0, 0, 0);
    domText.fadeIn();
  }

  updateCursorPosition() {
    const menuBaseY = this.cameras.main.height / 2;
    this.menuCursorEl.style.top = `${(menuBaseY + this.selectedIndex * 20) * domText.ZOOM}px`;
  }

  /**
   * Loads the most recently saved slot, then proceeds to the map.
   * Only reachable if Continue isn't disabled (see update()'s guard),
   * so mostRecentSlot() should never actually return null here — but
   * the null check stays in regardless, since silently doing nothing
   * is a safer failure mode than crashing if that assumption is ever
   * wrong (e.g. due to a future refactor).
   */
  handleContinue() {
    const slot = SaveSystem.mostRecentSlot();
    if (slot === null) return;

    SaveSystem.loadFromSlot(slot);
    this.proceedToMap();
  }

  /** Resets to fresh defaults, then proceeds to the map. */
  handleNewGame() {
    GameState.resetToNewGame();
    this.proceedToMap();
  }

  proceedToMap() {
    this.cameras.main.fadeOut(400, 0, 0, 0);
    domText.fadeOut();
    this.cameras.main.once('camerafadeoutcomplete', () => {
      domText.clearAll();
      this.scene.start('MapScene');
    });
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.cursors.up)) {
      this.selectedIndex = (this.selectedIndex - 1 + this.menuOptions.length) % this.menuOptions.length;
      this.updateCursorPosition();
    } else if (Phaser.Input.Keyboard.JustDown(this.cursors.down)) {
      this.selectedIndex = (this.selectedIndex + 1) % this.menuOptions.length;
      this.updateCursorPosition();
    } else if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      const option = this.menuOptions[this.selectedIndex];
      if (option.disabled) return; // Continue with no save: Enter does nothing, same convention as other disabled options in this game
      option.action();
    }
  }
}
