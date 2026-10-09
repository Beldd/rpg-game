/**
 * domText.js
 * ----------
 * Replaces textStyle.js. Phaser's Text game objects render to an
 * internal canvas, and on this project's scaled-up (zoom: 4), DPI-
 * scaled (devicePixelRatio: 1.5) setup, that internal canvas text
 * stays blurry even with the `resolution` property set correctly —
 * a known limitation of Phaser/WebGL's text rendering pipeline in
 * this kind of configuration, not a bug in our code.
 *
 * The fix: render text as real HTML elements absolutely positioned
 * on top of the canvas (in the #text-overlay div from index.html),
 * instead of as Phaser game objects. Real browser text is always
 * crisp, regardless of canvas zoom/scaling — it's a completely
 * separate rendering path that doesn't go through WebGL at all.
 *
 * Coordinate system: we keep writing position code in the same
 * 160x128 "game pixel" coordinates we've used everywhere else
 * (e.g. domText.create(80, 64, ...) for the center of the screen).
 * This helper multiplies by ZOOM internally so the DOM element lands
 * in the right spot in real (CSS) pixels. This means existing
 * position math elsewhere in our scenes doesn't need to change.
 */
const domText = {
  ZOOM: 2, // must match the zoom value in main.js's config

  /**
   * Creates a new overlay text element.
   * gameX, gameY: position in our 160x128 game-coordinate system
   * text: the string to display
   * options: {
   *   fontSize (in game px, e.g. 8),
   *   color (CSS color string),
   *   align ('center' | 'left', default 'center')
   * }
   *
   * align controls what gameX/gameY actually anchor to:
   *   'center' — gameX/gameY is the text's center point (matches
   *              Phaser's .setOrigin(0.5), used by titles/messages
   *              that should be centered on a point)
   *   'left'   — gameX/gameY is the text's top-left corner (matches
   *              Phaser's default text origin, used by left-aligned
   *              UI like the menu list). Using 'center' for these by
   *              mistake is what caused wider labels like "Attack" to
   *              visually overlap the cursor — the box was expanding
   *              outward from its center rather than its left edge.
   *
   * Returns the created DOM element so the caller can update/remove it later.
   */
  create(gameX, gameY, text, options = {}) {
    const el = document.createElement('div');
    el.className = 'overlay-text';
    el.textContent = text;
    el.style.left = `${gameX * this.ZOOM}px`;
    el.style.top = `${gameY * this.ZOOM}px`;
    // Font size is specified in "game pixels" for consistency with
    // how we think about everything else, then scaled to real CSS
    // pixels the same way positions are.
    const fontSizeGamePx = options.fontSize || 8;
    el.style.fontSize = `${fontSizeGamePx * this.ZOOM}px`;
    el.style.color = options.color || '#ffffff';

    const align = options.align || 'center';
    el.style.transform = align === 'left' ? 'translate(0, -50%)' : 'translate(-50%, -50%)';

    document.getElementById('text-overlay').appendChild(el);
    return el;
  },

  /** Updates the text content of an element created via domText.create(). */
  setText(el, text) {
    el.textContent = text;
  },

  /** Removes an element from the overlay. Call this in scene shutdown
   *  to avoid leftover text piling up when switching scenes. */
  remove(el) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  },

  /** Removes every overlay text element at once — useful in a scene's
   *  shutdown handler to guarantee a clean slate, even if we forgot
   *  to track a reference to something we created. */
  clearAll() {
    document.getElementById('text-overlay').innerHTML = '';
  },

  /**
   * Fades the entire text overlay out, matching the duration of our
   * Phaser camera fades (see the CSS transition on #text-overlay).
   * Call this at the same moment you call cameras.main.fadeOut() so
   * text and canvas fade together instead of text popping abruptly.
   */
  fadeOut() {
    document.getElementById('text-overlay').style.opacity = '0';
  },

  /**
   * Restores the text overlay to fully visible. Call this after
   * clearAll() + creating new text in the next scene, alongside
   * cameras.main.fadeIn(), so the new scene's text fades in rather
   * than appearing instantly.
   */
  fadeIn() {
    document.getElementById('text-overlay').style.opacity = '1';
  },
};
