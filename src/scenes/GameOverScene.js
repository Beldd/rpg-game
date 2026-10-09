/**
 * GameOverScene
 * -------------
 * Shown when the player loses a battle. Offers a restart, which simply
 * re-starts MapScene from scratch — since we don't have persistent
 * save data yet, "restart" just means "go back to the beginning,"
 * which is consistent with how the original SNES-era games handled it
 * before save points became common.
 */
class GameOverScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameOverScene' });
  }

  create() {
    const { width, height } = this.cameras.main;

    domText.create(width / 2, height / 2 - 20, 'GAME OVER', {
      fontSize: 20,
      color: '#cc3333',
    });

    domText.create(width / 2, height / 2 + 10, 'Press ENTER to restart', {
      fontSize: 8,
      color: '#ffffff',
    });

    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    this.add.rectangle(0, 0, width, height, 0x000000).setOrigin(0, 0);

    this.cameras.main.fadeIn(400, 0, 0, 0);
    domText.fadeIn();
  }

  update() {
    if (Phaser.Input.Keyboard.JustDown(this.enterKey)) {
      // Restore the party before transitioning back to the map —
      // otherwise GameState.party would stay at 0 HP/MP forever,
      // since nothing else ever resets it after a wipe.
      GameState.resetParty();

      this.cameras.main.fadeOut(400, 0, 0, 0);
      domText.fadeOut();
      this.cameras.main.once('camerafadeoutcomplete', () => {
        domText.clearAll();
        this.scene.start('MapScene');
      });
    }
  }
}
