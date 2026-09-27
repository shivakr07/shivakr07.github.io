/*
 * Pixel engine — renders small simulations onto a tiled pixel grid.
 * Scenes write palette indices into a Grid; the Stage paints each cell as a
 * crisp square with a thin grout gap, giving the stitched-tile look.
 */
(function (global) {
  'use strict';

  const PALETTE = {
    paper: '#f4f1ea', grout: '#e3dccb', ink: '#14161f', slate: '#3b4058', mist: '#9aa0b4',
    navy: '#16225a', blue: '#2747c7', sky: '#79a3f4', magenta: '#ad1f66', pink: '#ec80b1',
    green: '#11784a', mint: '#5dd39e', orange: '#f0861b', yellow: '#f7cb46', red: '#d63c2c',
    white: '#fcfbf7', bronze: '#a9602a', silver: '#b4bccb', gold: '#d6a21f', plum: '#4a1f55'
  };
  // Neutral tones that must invert on dark backgrounds; accents stay the same.
  const DARK = {
    paper: '#151823', grout: '#2a2f40', ink: '#eceae3', slate: '#9aa0b8', mist: '#5d6378',
    navy: '#2b3f9e', plum: '#6d2f7c', silver: '#6f7892'
  };
  const NAMES = Object.keys(PALETTE);
  const C = {};
  NAMES.forEach((n, i) => { C[n] = i; });
  const COLORS = NAMES.map((n) => PALETTE[n]);
  const toRgb = (hex) => [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
  const RGB = COLORS.map(toRgb);

  // 4x4 ordered-dither thresholds in (0, 1).
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

  // 3x5 bitmap font, rows top to bottom.
  const GLYPHS = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
    E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
    I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
    M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
    Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
    Y: '101101010010010', Z: '111001010100111',
    0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
    8: '111101111101111', 9: '111101111001110',
    ' ': '000000000000000', '-': '000000111000000', '=': '000111000111000', '>': '100010001010100',
    '<': '001010100010001', '.': '000000000000010', '/': '001001010100100', ':': '000010000010000',
    '(': '010100100100010', ')': '010001001001010', '+': '000010111010000', '%': '101001010100101',
    '_': '000000000000111', '#': '101111101111101'
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rand) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function nearestColor(r, g, b, candidates) {
    let best = candidates[0];
    let bestD = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const c = RGB[candidates[i]];
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bestD) { bestD = d; best = candidates[i]; }
    }
    return best;
  }

  class Grid {
    constructor(cols, rows) {
      this.cols = cols;
      this.rows = rows;
      this.buf = new Int16Array(cols * rows).fill(-1);
    }

    clear(c = -1) { this.buf.fill(c); }

    set(x, y, c) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows || c < 0) return;
      this.buf[y * this.cols + x] = c;
    }

    get(x, y) {
      if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
      return this.buf[y * this.cols + x];
    }

    rect(x, y, w, h, c) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
    }

    stroke(x, y, w, h, c) {
      for (let i = 0; i < w; i++) { this.set(x + i, y, c); this.set(x + i, y + h - 1, c); }
      for (let j = 0; j < h; j++) { this.set(x, y + j, c); this.set(x + w - 1, y + j, c); }
    }

    hline(x0, x1, y, c, step = 1) {
      const a = Math.min(x0, x1);
      const b = Math.max(x0, x1);
      for (let x = a; x <= b; x += step) this.set(x, y, c);
    }

    vline(x, y0, y1, c, step = 1) {
      const a = Math.min(y0, y1);
      const b = Math.max(y0, y1);
      for (let y = a; y <= b; y += step) this.set(x, y, c);
    }

    // Maps v in [0, 1] onto a colour ramp using ordered dithering.
    dither(x, y, v, ramp) {
      const n = ramp.length - 1;
      const p = Math.max(0, Math.min(1, v)) * n;
      const i = Math.floor(p);
      const threshold = BAYER[(y & 3) * 4 + (x & 3)];
      const idx = p - i > threshold ? i + 1 : i;
      this.set(x, y, ramp[Math.min(idx, n)]);
    }

    textWidth(str) { return String(str).length * 4 - 1; }

    text(str, x, y, c, align = 'left') {
      const s = String(str).toUpperCase();
      let cx = align === 'right' ? x - this.textWidth(s) + 1 : align === 'center' ? x - Math.floor(this.textWidth(s) / 2) : x;
      for (const ch of s) {
        const glyph = GLYPHS[ch] || GLYPHS[' '];
        for (let k = 0; k < 15; k++) if (glyph[k] === '1') this.set(cx + (k % 3), y + Math.floor(k / 3), c);
        cx += 4;
      }
    }
  }

  const reducedMotion = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const stages = [];

  class Stage {
    constructor(canvas, scene, options) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true });
      this.scene = scene;
      this.baseCell = options.cell || 8;
      this.gap = options.gap == null ? 1 : options.gap;
      this.fps = options.fps || 15;
      this.minCols = scene.minCols || 0;
      this.time = 0;
      this.acc = 0;
      this.visible = false;
      this.ready = false;
      this.dirty = true;
      this.activeUntil = 0;
      this.listeners = [];
      this.buckets = COLORS.map(() => []);
      this.reduced = reducedMotion.matches;
      this.bindPointer();
    }

    get animating() { return !this.reduced || performance.now() < this.activeUntil; }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w < 16 || h < 16) return;
      let cell = this.baseCell;
      if (this.minCols && w / cell < this.minCols) cell = Math.max(3, w / this.minCols);
      const cols = Math.floor(w / cell);
      const rows = Math.floor(h / cell);
      const dpr = Math.min(global.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.cell = cell;
      this.dpr = dpr;
      this.offX = (w - cols * cell) / 2;
      this.offY = (h - rows * cell) / 2;
      if (!this.grid || this.grid.cols !== cols || this.grid.rows !== rows) {
        this.grid = new Grid(cols, rows);
        this.scene.init(this.grid, this);
        const warm = this.scene.warmup || 0;
        for (let s = 0; s < warm * 15; s++) { this.time += 1 / 15; this.scene.update(1 / 15, this.time); }
      }
      this.ready = true;
      this.draw();
    }

    step(dt) {
      this.time += dt;
      this.scene.update(dt, this.time);
    }

    draw() {
      if (!this.ready) return;
      this.grid.clear();
      this.scene.draw(this.grid, this.time);
      this.render();
      this.dirty = false;
    }

    render() {
      const { ctx, grid, cell, dpr, offX, offY, gap, buckets } = this;
      for (const b of buckets) b.length = 0;
      const buf = grid.buf;
      for (let i = 0; i < buf.length; i++) if (buf[i] >= 0) buckets[buf[i]].push(i);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const cols = grid.cols;
      for (let c = 0; c < buckets.length; c++) {
        const list = buckets[c];
        if (!list.length) continue;
        ctx.fillStyle = COLORS[c];
        for (let k = 0; k < list.length; k++) {
          const idx = list[k];
          const x = idx % cols;
          const y = (idx - x) / cols;
          const px = Math.round((offX + x * cell) * dpr);
          const py = Math.round((offY + y * cell) * dpr);
          const pw = Math.round((offX + (x + 1) * cell - gap) * dpr) - px;
          const ph = Math.round((offY + (y + 1) * cell - gap) * dpr) - py;
          ctx.fillRect(px, py, Math.max(1, pw), Math.max(1, ph));
        }
      }
    }

    toGrid(event) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: Math.floor((event.clientX - rect.left - this.offX) / this.cell),
        y: Math.floor((event.clientY - rect.top - this.offY) / this.cell)
      };
    }

    bindPointer() {
      if (!this.scene.pointer) return;
      const handler = (type) => (event) => {
        if (!this.ready) return;
        const p = this.toGrid(event);
        this.scene.pointer(p.x, p.y, type, this.time);
        this.dirty = true;
      };
      this.canvas.addEventListener('pointermove', handler('move'));
      this.canvas.addEventListener('pointerdown', handler('down'));
      this.canvas.addEventListener('pointerleave', handler('leave'));
    }

    action(name, value) {
      if (this.scene.action) this.scene.action(name, value, this.time);
      this.activeUntil = performance.now() + (this.scene.activeMs || 6000);
      this.dirty = true;
    }

    emit(status) {
      this.lastStatus = status;
      for (const fn of this.listeners) fn(status);
    }

    onStatus(fn) {
      this.listeners.push(fn);
      if (this.lastStatus) fn(this.lastStatus);
    }
  }

  let last = 0;
  function loop(now) {
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0);
    last = now;
    for (const s of stages) {
      if (!s.visible || !s.ready) continue;
      if (s.animating) {
        s.acc += dt;
        if (s.acc >= 1 / s.fps) {
          s.step(s.acc);
          s.acc = 0;
          s.draw();
        }
      } else if (s.dirty) {
        s.draw();
      }
    }
    global.requestAnimationFrame(loop);
  }

  const visibility = 'IntersectionObserver' in global
    ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const stage = stages.find((s) => s.canvas === entry.target);
        if (stage) stage.visible = entry.isIntersecting;
      }
    }, { rootMargin: '120px' })
    : null;

  const sizing = 'ResizeObserver' in global
    ? new ResizeObserver((entries) => {
      for (const entry of entries) {
        const stage = stages.find((s) => s.canvas === entry.target);
        if (stage) stage.resize();
      }
    })
    : null;

  function mount(canvas, scene, options = {}) {
    const stage = new Stage(canvas, scene, options);
    stages.push(stage);
    if (visibility) visibility.observe(canvas); else stage.visible = true;
    if (sizing) sizing.observe(canvas); else global.addEventListener('resize', () => stage.resize());
    stage.resize();
    return stage;
  }

  if (reducedMotion.addEventListener) {
    reducedMotion.addEventListener('change', (e) => { for (const s of stages) { s.reduced = e.matches; s.dirty = true; } });
  }
  global.requestAnimationFrame(loop);

  function setTheme(theme) {
    const dark = theme === 'dark';
    NAMES.forEach((n, i) => {
      COLORS[i] = dark && DARK[n] ? DARK[n] : PALETTE[n];
      RGB[i] = toRgb(COLORS[i]);
    });
    for (const s of stages) {
      if (!s.ready) continue;
      if (s.scene.onTheme) s.scene.onTheme();
      s.draw();
    }
  }

  global.Pixel = { C, RGB, COLORS, BAYER, Grid, mount, setTheme, mulberry32, gaussian, nearestColor };
})(window);
