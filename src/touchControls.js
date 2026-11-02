/**
 * touchControls.js
 * ----------------
 * On-screen D-pad + A / B / Menu buttons for phones and tablets.
 *
 * Design: the game already reads the keyboard through Phaser, so the
 * buttons don't talk to any scene. They dispatch synthetic keydown /
 * keyup events on `window` (where Phaser listens). Mapping:
 *   D-pad -> arrow keys     A -> Enter     B -> Escape     Menu -> P
 *
 * Touch mode turns on when the primary pointer is coarse (finger), or
 * with ?touch=1 in the URL; ?touch=0 forces it off. On desktop nothing
 * here runs and the page layout is unchanged.
 *
 * In touch mode the 640x480 #game-wrapper is scaled with a CSS
 * transform (canvas and DOM text scale together) to fit the screen:
 * landscape puts the D-pad left and A/B right of the game; portrait
 * puts the game on top and the controls underneath.
 */
(function () {
  const params = new URLSearchParams(location.search);
  const forced = params.get('touch');
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const enabled = forced === '1' ? true : forced === '0' ? false : coarse;
  if (!enabled) return;

  const GAME_W = 640, GAME_H = 480;
  const GUTTER = 150;        // landscape: width reserved per side for controls
  const PORTRAIT_PAD = 190;  // portrait: minimum height reserved for controls

  const KEYS = {
    up:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
    down:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
    left:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
    right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    a:     { key: 'Enter',      code: 'Enter',      keyCode: 13 },
    b:     { key: 'Escape',     code: 'Escape',     keyCode: 27 },
    menu:  { key: 'p',          code: 'KeyP',       keyCode: 80 },
  };

  function fire(type, def) {
    const ev = new KeyboardEvent(type, { key: def.key, code: def.code, bubbles: true, cancelable: true });
    // WebKit builds KeyboardEvent with keyCode 0; Phaser reads keyCode.
    Object.defineProperty(ev, 'keyCode', { get: () => def.keyCode });
    Object.defineProperty(ev, 'which',   { get: () => def.keyCode });
    window.dispatchEvent(ev);
  }

  const down = new Map();   // pointerId -> button name
  const downAt = {};        // button name -> time of last keydown
  const MIN_HOLD = 60;      // ms. Phaser samples keys once per frame, so a
                            // down+up inside one frame is lost; hold at least this long.

  function press(name, id) {
    if (down.has(id)) return;
    down.set(id, name);
    downAt[name] = performance.now();
    fire('keydown', KEYS[name]);
  }
  function release(id) {
    const name = down.get(id);
    if (!name) return;
    down.delete(id);
    // Only send keyup if no other finger still holds the same button.
    if ([...down.values()].includes(name)) return;
    const wait = Math.max(0, MIN_HOLD - (performance.now() - downAt[name]));
    if (wait === 0) fire('keyup', KEYS[name]);
    else setTimeout(() => {
      if (![...down.values()].includes(name)) fire('keyup', KEYS[name]);
    }, wait);
  }
  function releaseAll() { [...down.keys()].forEach(release); }

  // ---- styles ----
  const css = document.createElement('style');
  css.textContent = `
    html.touch, html.touch body { margin:0; height:100%; overflow:hidden; overscroll-behavior:none;
      position:fixed; width:100%; background:#000; touch-action:none;
      -webkit-user-select:none; user-select:none; -webkit-touch-callout:none;
      -webkit-tap-highlight-color:transparent; }
    html.touch body { display:block; min-height:0; }
    html.touch #game-wrapper { position:absolute; left:0; top:0; transform-origin:0 0; }
    #touch-controls { position:fixed; left:0; top:0; width:100%; height:100%; z-index:50; pointer-events:none; }
    #touch-controls .tc-btn { position:absolute; pointer-events:auto; touch-action:none;
      display:flex; align-items:center; justify-content:center;
      font:bold 18px monospace; color:#e8e8f0; background:rgba(60,64,110,.75);
      border:2px solid rgba(200,205,255,.55); box-sizing:border-box;
      -webkit-user-select:none; user-select:none; }
    #touch-controls .tc-btn.active { background:rgba(150,160,255,.85); color:#000; }
    #touch-controls .tc-round { border-radius:50%; }
    #touch-controls .tc-pill { border-radius:14px; }
  `;
  document.head.appendChild(css);
  document.documentElement.classList.add('touch');

  // ---- buttons ----
  const root = document.createElement('div');
  root.id = 'touch-controls';
  root.addEventListener('contextmenu', e => e.preventDefault());
  const els = {};

  function makeBtn(name, label, shape) {
    const b = document.createElement('div');
    b.className = 'tc-btn ' + shape;
    b.textContent = label;
    b.dataset.btn = name;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { b.setPointerCapture(e.pointerId); } catch (_) {}
      b.classList.add('active');
      press(name, e.pointerId);
      if (navigator.vibrate) { try { navigator.vibrate(8); } catch (_) {} }
    });
    const up = e => {
      if (down.get(e.pointerId) !== name) return;
      release(e.pointerId);
      if (![...down.values()].includes(name)) b.classList.remove('active');
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    root.appendChild(b);
    els[name] = b;
    return b;
  }

  makeBtn('up',    '▲', 'tc-round');
  makeBtn('down',  '▼', 'tc-round');
  makeBtn('left',  '◀', 'tc-round');
  makeBtn('right', '▶', 'tc-round');
  makeBtn('a',     'A', 'tc-round');
  makeBtn('b',     'B', 'tc-round');
  makeBtn('menu',  'MENU', 'tc-pill');

  function place(el, x, y, w, h) {
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    el.style.width = Math.round(w) + 'px';
    el.style.height = Math.round(h) + 'px';
  }

  // D-pad centred on (cx, cy) with button size s.
  function layoutDpad(cx, cy, s) {
    const gap = s * 0.08;
    place(els.up,    cx - s / 2, cy - s * 1.5 - gap, s, s);
    place(els.down,  cx - s / 2, cy + s * 0.5 + gap, s, s);
    place(els.left,  cx - s * 1.5 - gap, cy - s / 2, s, s);
    place(els.right, cx + s * 0.5 + gap, cy - s / 2, s, s);
  }
  // A / B cluster centred on (cx, cy): A lower-right, B upper-left (SNES-like).
  function layoutAB(cx, cy, s) {
    place(els.a, cx + s * 0.05, cy - s * 0.15, s, s);
    place(els.b, cx - s * 1.05, cy - s * 0.85, s, s);
  }

  function layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const wrap = document.getElementById('game-wrapper');
    if (!wrap) return;
    const landscape = W > H;
    let scale, ox, oy;
    if (landscape) {
      const g = Math.min(GUTTER, W * 0.2);
      scale = Math.min((W - 2 * g) / GAME_W, H / GAME_H);
      ox = (W - GAME_W * scale) / 2;
      oy = (H - GAME_H * scale) / 2;
      const s = Math.max(38, Math.min(52, H * 0.14));
      layoutDpad(g / 2 + 4, H * 0.58, s * 0.92);
      layoutAB(W - g / 2 - 4, H * 0.58, s * 1.05);
      place(els.menu, W - g + 6, Math.max(8, H * 0.06), g - 12, 34);
    } else {
      scale = W / GAME_W;
      ox = 0; oy = 0;
      const gameH = GAME_H * scale;
      const top = gameH + 8;
      const avail = Math.max(PORTRAIT_PAD, H - top);
      const s = Math.min(58, avail / 4.4, W * 0.15);
      const cy = top + avail * 0.52;
      layoutDpad(W * 0.24, cy, s);
      layoutAB(W * 0.76, cy, s * 1.1);
      place(els.menu, W / 2 - 40, top + 4, 80, 30);
    }
    wrap.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
  }

  function init() {
    document.body.appendChild(root);
    layout();
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);

  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 150));
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
  // iOS pinch / double-tap zoom guards
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t =>
    document.addEventListener(t, e => e.preventDefault()));
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  window.TouchControls = { layout, press: (n) => { press(n, 'api'); }, release: () => release('api') };
})();
