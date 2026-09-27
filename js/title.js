/*
 * Pixel title: the hero name is drawn as a lit pixel board. Glyph cells light up
 * in a colour gradient, a halo of dim tiles surrounds them, a few pixels twinkle,
 * and the board glows around the pointer. The real <h1> text stays in the DOM
 * (visually transparent) for assistive technology, search engines and selection.
 */
(function () {
  'use strict';

  const root = document.documentElement;
  const title = document.getElementById('hero-title');
  if (!title) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
  const HALO = 4;

  let board = null;
  let canvas = null;
  let ctx = null;
  let start = 0;
  let visible = true;
  let pointer = null;
  let lastFrame = 0;
  const twinkles = [];

  const hash = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  function palette() {
    const css = getComputedStyle(root);
    const v = (n) => css.getPropertyValue(n).trim();
    return { stops: [v('--magenta'), v('--orange'), v('--green'), v('--blue')], tile: v('--line'), spark: v('--yellow') };
  }

  // Rasterises the heading's text, using the browser's own layout for each character.
  function glyphMask(width, height, pad, box, style) {
    const mask = document.createElement('canvas');
    mask.width = width;
    mask.height = height;
    const m = mask.getContext('2d', { willReadFrequently: true });
    m.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    m.fillStyle = '#000';
    const ascent = m.measureText('Hg').fontBoundingBoxAscent;
    if (ascent == null) m.textBaseline = 'top';
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent;
      for (let i = 0; i < text.length; i++) {
        if (!text[i].trim()) continue;
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const r = range.getClientRects()[0];
        if (!r) continue;
        const x = r.left - box.left + pad;
        const y = r.top - box.top + pad + (ascent == null ? 0 : ascent);
        m.fillText(text[i], x, y);
      }
    }
    return m.getImageData(0, 0, width, height).data;
  }

  function build() {
    const style = getComputedStyle(title);
    const box = title.getBoundingClientRect();
    if (box.width < 20) return null;
    const cell = Math.max(4, Math.round(parseFloat(style.fontSize) / 18));
    const pad = cell * 2;
    const width = Math.ceil(box.width + pad * 2);
    const height = Math.ceil(box.height + pad * 2);
    const alpha = glyphMask(width, height, pad, box, style);
    const cols = Math.floor(width / cell);
    const rows = Math.floor(height / cell);
    const lit = new Uint8Array(cols * rows);

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        let covered = 0;
        for (let sy = 0; sy < 3; sy++) {
          for (let sx = 0; sx < 3; sx++) {
            const px = Math.floor((cx + (sx + 0.5) / 3) * cell);
            const py = Math.floor((cy + (sy + 0.5) / 3) * cell);
            covered += alpha[(py * width + px) * 4 + 3];
          }
        }
        if (covered / (9 * 255) >= 0.42) lit[cy * cols + cx] = 1;
      }
    }

    // Chebyshev distance from each cell to the nearest lit cell, capped at the halo radius.
    const dist = new Uint8Array(cols * rows).fill(255);
    for (let i = 0; i < lit.length; i++) if (lit[i]) dist[i] = 0;
    for (let pass = 0; pass < HALO; pass++) {
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          const i = cy * cols + cx;
          if (dist[i] !== 255) continue;
          for (let dy = -1; dy <= 1 && dist[i] === 255; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
              if (dist[ny * cols + nx] === pass) { dist[i] = pass + 1; break; }
            }
          }
        }
      }
    }

    const glyphs = [];
    const halo = [];
    let minX = cols;
    let maxX = 0;
    for (let i = 0; i < lit.length; i++) if (lit[i]) { const x = i % cols; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    const span = Math.max(1, maxX - minX);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        if (lit[i]) {
          const t = Math.min(0.999, Math.max(0, ((cx - minX) / span) * 0.85 + (cy / rows) * 0.15));
          glyphs.push({ cx, cy, t, delay: ((cx - minX) / span) * 0.75 + hash(cx, cy) * 0.3 });
        } else if (dist[i] <= HALO && hash(cx + 17, cy + 31) > 0.3 + (dist[i] / (HALO + 1)) * 0.7) {
          halo.push({ cx, cy, d: dist[i], delay: hash(cx, cy + 7) * 0.35 });
        }
      }
    }
    return { cell, pad, width, height, cols, rows, lit, glyphs, halo, colors: palette() };
  }

  // Colour along the gradient: solid bands, ordered-dithered only near each boundary.
  function gradient(t, cx, cy, stops) {
    const p = t * (stops.length - 1);
    const i = Math.floor(p);
    const f = p - i;
    if (f < 0.38) return stops[i];
    if (f > 0.62) return stops[Math.min(stops.length - 1, i + 1)];
    const mix = (f - 0.38) / 0.24;
    return stops[Math.min(stops.length - 1, mix > BAYER[(cy & 3) * 4 + (cx & 3)] ? i + 1 : i)];
  }

  function mount() {
    // Apply pixel-mode typography before measuring so the layout matches the board.
    root.classList.add('pixel-title-on');
    board = build();
    if (!board) { root.classList.remove('pixel-title-on'); return; }
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'title-pixels';
      canvas.setAttribute('aria-hidden', 'true');
      title.appendChild(canvas);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(board.width * dpr);
    canvas.height = Math.round(board.height * dpr);
    Object.assign(canvas.style, {
      left: `${-board.pad}px`, top: `${-board.pad}px`, width: `${board.width}px`, height: `${board.height}px`
    });
    ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    root.classList.remove('title-loading');
    draw(performance.now());
  }

  function draw(now) {
    if (!board || !ctx) return;
    const { cell, glyphs, halo, colors } = board;
    const t = reduce ? 99 : (now - start) / 1000;
    const size = cell - 1;
    ctx.clearRect(0, 0, board.width, board.height);

    for (const h of halo) {
      if (t < h.delay) continue;
      ctx.globalAlpha = 0.55 - h.d * 0.07;
      ctx.fillStyle = colors.tile;
      ctx.fillRect(h.cx * cell, h.cy * cell, size, size);
    }

    // Spotlight: tiles around the pointer light up in the gradient colours.
    if (pointer) {
      const R = 7;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const cx = pointer.x + dx;
          const cy = pointer.y + dy;
          if (cx < 0 || cy < 0 || cx >= board.cols || cy >= board.rows || board.lit[cy * board.cols + cx]) continue;
          const d = Math.hypot(dx, dy) / R;
          if (d > 1 || hash(cx + 3, cy + 5) < d * 0.9) continue;
          ctx.globalAlpha = 0.95 * (1 - d * 0.65);
          ctx.fillStyle = gradient(cx / board.cols, cx, cy, colors.stops);
          ctx.fillRect(cx * cell, cy * cell, size, size);
        }
      }
    }
    ctx.globalAlpha = 1;

    for (const g of glyphs) {
      if (t < g.delay) {
        if (t > g.delay - 0.2) { ctx.fillStyle = colors.tile; ctx.fillRect(g.cx * cell, g.cy * cell, size, size); }
        continue;
      }
      ctx.fillStyle = t < g.delay + 0.12 ? colors.spark : gradient(g.t, g.cx, g.cy, colors.stops);
      ctx.fillRect(g.cx * cell, g.cy * cell, size, size);
    }

    for (let k = twinkles.length - 1; k >= 0; k--) {
      const w = twinkles[k];
      if (now > w.until) { twinkles.splice(k, 1); continue; }
      ctx.fillStyle = w.color;
      ctx.fillRect(w.cx * cell, w.cy * cell, size, size);
    }
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!board || !visible || now - lastFrame < 50) return;
    lastFrame = now;
    if ((now - start) / 1000 > 1.3 && Math.random() < 0.45) {
      const pool = Math.random() < 0.7 ? board.glyphs : board.halo;
      const c = pool[Math.floor(Math.random() * pool.length)];
      if (c) twinkles.push({ cx: c.cx, cy: c.cy, until: now + 180 + Math.random() * 220, color: pool === board.glyphs ? board.colors.spark : gradient(c.cx / board.cols, c.cx, c.cy, board.colors.stops) });
    }
    draw(now);
  }

  function onPointer(e) {
    if (!board || !canvas) return;
    const r = canvas.getBoundingClientRect();
    pointer = { x: Math.floor((e.clientX - r.left) / board.cell), y: Math.floor((e.clientY - r.top) / board.cell) };
    if (reduce) draw(performance.now());
  }

  const fontsReady = document.fonts && document.fonts.ready
    ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))])
    : Promise.resolve();

  fontsReady.then(() => {
    start = performance.now();
    mount();
    if (!board) { root.classList.remove('title-loading'); return; }

    title.addEventListener('pointermove', onPointer);
    title.addEventListener('pointerleave', () => { pointer = null; if (reduce) draw(performance.now()); });

    let width = title.getBoundingClientRect().width;
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        const w = title.getBoundingClientRect().width;
        if (Math.abs(w - width) < 1) return;
        width = w;
        start = performance.now() - 5000;
        mount();
      }).observe(title);
    }
    new MutationObserver(() => { if (board) { board.colors = palette(); draw(performance.now()); } })
      .observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(title);
    }
    if (!reduce) requestAnimationFrame(tick);
  }).catch(() => root.classList.remove('title-loading'));
})();
