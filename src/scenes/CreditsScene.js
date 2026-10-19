/**
 * CreditsScene
 * ------------
 * Shows the pages in CREDITS (src/credits.js), one at a time.
 * Left/Right (or Enter) turns the page; Escape, or Enter on the last page,
 * returns to the title screen.
 */
class CreditsScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CreditsScene' });
  }

  create() {
    const { width, height } = this.cameras.main;
    this.add.rectangle(0, 0, width, height, 0x0a0a2e).setOrigin(0, 0);

    this.page = 0;
    this.pageEls = [];
    this.leaving = false;
    this.cursors = this.input.keyboard.createCursorKeys();
    this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.escKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    this.renderPage();
    this.cameras.main.fadeIn(300, 0, 0, 0);
    domText.fadeIn();
  }

  /** Draws the current page, replacing whatever was on screen. */
  renderPage() {
    const { width, height } = this.cameras.main;
    this.pageEls.forEach(el => el.remove());
    this.pageEls = [];

    const page = CREDITS[this.page];
    this.pageEls.push(domText.create(width / 2, 40, page.title, { fontSize: 12, color: '#ffff66' }));

    page.lines.forEach((line, i) => {
      // Short lines like "Created by" read as labels; the rest as names.
      const isLabel = line === 'Created by' || line === 'Development';
      this.pageEls.push(domText.create(width / 2, 78 + i * 16, line, {
        fontSize: 8,
        color: isLabel ? '#99aabb' : '#ffffff',
      }));
    });

    const last = this.page === CREDITS.length - 1;
    this.pageEls.push(domText.create(width / 2, height - 24, `${this.page + 1} / ${CREDITS.length}`, {
      fontSize: 7, color: '#99aabb',
    }));
    this.pageEls.push(domText.create(width / 2, height - 12,
      last ? '< Back   Enter: title' : '< >  Enter: next   Esc: title', {
        fontSize: 6, color: '#667788',
      }));
  }

  turn(delta) {
    const next = this.page + delta;
    if (next < 0 || next >= CREDITS.length) return;
    this.page = next;
    this.renderPage();
  }

  backToTitle() {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    domText.fadeOut();
    this.cameras.main.once('camerafadeoutcomplete', () => {
      domText.clearAll();
      this.scene.start('TitleScene');
    });
  }

  update() {
    if (this.leaving) return;
    const JD = Phaser.Input.Keyboard.JustDown;
    if (JD(this.escKey)) return this.backToTitle();
    if (JD(this.cursors.left)) return this.turn(-1);
    if (JD(this.cursors.right)) return this.turn(1);
    if (JD(this.enterKey)) {
      if (this.page === CREDITS.length - 1) this.backToTitle();
      else this.turn(1);
    }
  }
}
