/**
 * main.js
 * -------
 * This is the entry point. It defines the Phaser game "config" object
 * (canvas size, rendering mode, which scenes exist) and creates the
 * single global Phaser.Game instance that runs everything.
 *
 * There is only ever one Phaser.Game per page. Scenes are how Phaser
 * organizes different "screens" or "modes" of the game (title screen,
 * overworld, battle, etc.) — think of them like separate mini-programs
 * that the game switches between, similar in spirit to pages in a
 * single-page app.
 */

const config = {
  type: Phaser.AUTO,        // let Phaser pick WebGL if available, else Canvas
  width: 320,                // doubled from 160 — more room for UI/text/lists
  height: 240,                // doubled from 128
  parent: 'game-container',  // the <div> in index.html Phaser will render into
  pixelArt: true,            // disables smoothing, keeps pixel art crisp when scaled
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: 2,                 // halved from 4 — keeps on-screen window size roughly the same (320*2=640 vs old 160*4=640)
  },
  scene: [TitleScene, MapScene, DungeonScene, OverlayScene, BattleScene, GameOverScene, BootScene],        // TitleScene runs first now; MapScene starts after Enter is pressed
};

// Creating this instance starts the game loop immediately.
// Fetch game-content.json first (never fails; falls back to built-in
// defaults), then boot. Scenes read content synchronously, so it must
// be in place before any scene's create() runs.
let game;
EditorData.init().then(() => {
  console.log(`[Arcadia] v${BUILD_INFO.version} (${BUILD_INFO.label}) | content: ${EditorData.source()}` +
    ` | repo file: ${EditorData.repoStatus}` +
    (EditorData.repoMeta && EditorData.repoMeta.exportedAt ? ` (exported ${EditorData.repoMeta.exportedAt})` : ''));
  game = new Phaser.Game(config);
});
