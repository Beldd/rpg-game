/**
 * BootScene
 * ---------
 * The very first scene Phaser runs. Its only job right now is to prove
 * the rendering pipeline works: Phaser loads, a scene runs, something
 * draws on screen. Later, this scene will become responsible for
 * pre-loading assets (tilesets, sprite sheets) before the real game
 * scenes start, which is why it's called "Boot" and not "Game" or "Title".
 *
 * Every Phaser scene is a JS class extending Phaser.Scene with up to
 * three lifecycle methods Phaser calls automatically:
 *   - preload(): load images/assets before anything renders
 *   - create():  runs once, set up the initial scene contents
 *   - update():  runs every frame (~60x/sec), for anything that changes
 *                over time (movement, animation, input)
 */
class BootScene extends Phaser.Scene {
  constructor() {
    // 'key' string lets Phaser's scene manager refer to this scene by name
    super({ key: 'BootScene' });
  }

  create() {
    // this.add.* methods create visual objects and add them to the scene.
    // We're not loading any image assets yet, so we'll draw simple shapes
    // and text to confirm everything is wired up correctly.

    const { width, height } = this.cameras.main;

    // A colored rectangle filling the screen, just so we see *something*
    this.add.rectangle(0, 0, width, height, 0x1a1a2e).setOrigin(0, 0);

    // Text confirming the pipeline is alive
    domText.create(width / 2, height / 2, 'Phaser is running ✅', {
      fontSize: 24,
      color: '#ffffff',
    });
  }
}
