/*
 * Scenes — each is a small, faithful simulation of the concept it depicts.
 *   diffusion : cosine-schedule forward/reverse diffusion, x_t = √ᾱ·x₀ + √(1−ᾱ)·ε
 *   attention : causal multi-head self-attention, softmax(QKᵀ/√d)·V
 *   lakehouse : medallion ETL with schema validation, quarantine, aggregation,
 *               Delta commits and OPTIMIZE-style compaction
 *   services  : API gateway with a token-bucket rate limiter, microservices,
 *               cache-aside reads and an async message queue
 *   stream    : a data stream refined across bronze, silver and gold layers
 */
(function (global) {
  'use strict';

  const { C, RGB, BAYER, mulberry32, gaussian, nearestColor } = global.Pixel;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ------------------------------------------------------------------ */
  /* Diffusion                                                           */
  /* ------------------------------------------------------------------ */

  function petal(u, v, angleDeg, length, width) {
    const dx = u - 0.5;
    const dy = 0.7 - v;
    const a = (angleDeg * Math.PI) / 180;
    const along = dx * Math.sin(a) + dy * Math.cos(a);
    if (along < 0 || along > length) return null;
    const across = dx * Math.cos(a) - dy * Math.sin(a);
    const s = along / length;
    const half = width * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.9);
    if (Math.abs(across) > half) return null;
    return { s, edge: Math.abs(across) / half };
  }

  // The clean sample x₀: a lotus over water at dusk, built from geometry.
  function lotus(u, v) {
    if (v < 0.075) {
      const tri = Math.abs(((u * 9) % 1) - 0.5);
      return v < 0.075 - tri * 0.12 ? C.magenta : C.navy;
    }
    const horizon = 0.72;
    if (v > horizon) {
      const leaves = [[0.21, 0.8, 0.2, 0.055], [0.8, 0.81, 0.17, 0.05]];
      for (const [lx, ly, rx, ry] of leaves) {
        const ex = (u - lx) / rx;
        const ey = (v - ly) / ry;
        const e = ex * ex + ey * ey;
        if (e < 1) return e > 0.62 || Math.abs(ey) < 0.14 ? C.green : C.mint;
      }
      const depth = (v - horizon) / (1 - horizon);
      const ripple = Math.sin(v * 95 + Math.sin(u * 14) * 2);
      if (Math.abs(u - 0.5) < 0.26 * (1 - depth) && ripple > 0.25) return C.orange;
      if (ripple > 0.6) return C.sky;
      return depth > 0.55 ? C.navy : C.blue;
    }
    const cx = (u - 0.5) / 0.06;
    const cy = (v - 0.665) / 0.028;
    if (cx * cx + cy * cy < 1) return Math.sin(u * 180) > 0.3 ? C.orange : C.yellow;
    const inner = [-44, -15, 15, 44];
    for (let i = 0; i < inner.length; i++) {
      const p = petal(u, v, inner[i], 0.3, 0.066);
      if (p) {
        if (p.edge > 0.74) return C.magenta;
        return p.s < 0.5 ? C.white : C.pink;
      }
    }
    const outer = [-80, -54, -27, 0, 27, 54, 80];
    for (let i = 0; i < outer.length; i++) {
      const p = petal(u, v, outer[i], 0.41, 0.078);
      if (p) {
        const deep = i % 2 === 1;
        if (p.edge > 0.76) return deep ? C.plum : C.magenta;
        if (p.s < 0.24) return C.white;
        return deep ? C.magenta : C.pink;
      }
    }
    const r = Math.hypot(u - 0.5, (v - 0.5) * 1.05);
    if (r < 0.21) return C.yellow;
    if (r < 0.3) return r > 0.285 ? C.magenta : C.orange;
    const star = Math.abs(Math.sin(u * 1291.7 + v * 7933.1) * 43758.5) % 1;
    if (star > 0.985) return C.white;
    return v < 0.4 ? C.navy : C.plum;
  }

  function diffusionScene(options = {}) {
    const QUANT = [C.paper, C.ink, C.navy, C.blue, C.sky, C.magenta, C.pink, C.green, C.mint,
      C.orange, C.yellow, C.red, C.white, C.plum, C.slate];
    const NOISE_RAMP = [C.navy, C.blue, C.sky, C.paper, C.pink, C.magenta, C.plum];
    const THUMBS = [1, 0.75, 0.5, 0.25, 0];
    const CYCLE = 11;
    let W, H, L, x0, eps, stage;
    let seed = options.seed || 5;
    let t = 1;
    let cycle = 0;
    let manualT = null;
    let manualUntil = 0;
    let lastStep = -1;

    function alphaBar(tt) {
      const s = 0.008;
      const f = (x) => Math.cos(((x + s) / (1 + s)) * (Math.PI / 2)) ** 2;
      return clamp(f(tt) / f(0), 0, 1);
    }

    function timeline(c) {
      if (c < 1.2) return 1;
      if (c < 7.2) {
        const p = (c - 1.2) / 6;
        const e = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
        return 1 - e;
      }
      if (c < 10) return 0;
      return c - 10;
    }

    function layout() {
      const m = 2;
      const labelH = 8;
      const auxW = clamp(Math.floor(W * 0.27), 23, 30);
      // Largest main image that still leaves room for the thumbnail strip, where
      // five thumbnails and four 3-cell gaps span the full composition width.
      const fit = (aux, thumbs) => {
        const extra = aux ? auxW + 3 : 0;
        const vBase = H - 2 * m - labelH - 4;
        let S = W - 2 * m - extra;
        S = thumbs ? Math.min(S, Math.floor((5 * (vBase - 11) - (extra - 12)) / 6)) : Math.min(S, vBase);
        const th = thumbs ? Math.floor((S + extra - 12) / 5) : 0;
        return { S, th, aux, extra };
      };
      let r = fit(true, true);
      if (r.S < 40) r = fit(false, true);
      if (r.th < 6) r = fit(r.aux, false);
      const S = Math.max(8, r.S);
      const totalW = S + r.extra;
      const totalH = labelH + S + 4 + (r.th ? r.th + 11 : 0);
      const ox = Math.floor((W - totalW) / 2);
      const oy = Math.max(m, Math.floor((H - totalH) / 2));
      L = {
        S, th: r.th, aux: r.aux, auxW, totalW,
        labelY: oy, mainX: ox, mainY: oy + labelH, auxX: ox + S + 3
      };
      L.barY = L.mainY + S + 1;
      L.thumbY = L.barY + 4;
      L.thumbGap = r.th ? Math.floor((totalW - 5 * r.th) / 4) : 0;
      if (r.aux) {
        L.noiseS = Math.min(auxW, Math.floor(S * 0.5));
        L.plotY = L.mainY + L.noiseS + 9;
        L.plotH = Math.max(0, Math.min(auxW, S - L.noiseS - 9));
      }
    }

    function buildTarget() {
      const S = L.S;
      x0 = new Float32Array(S * S * 3);
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          const rgb = RGB[lotus((i + 0.5) / S, (j + 0.5) / S)];
          const k = (j * S + i) * 3;
          x0[k] = rgb[0]; x0[k + 1] = rgb[1]; x0[k + 2] = rgb[2];
        }
      }
    }

    function reseed() {
      const rand = mulberry32(seed++);
      eps = new Float32Array(L.S * L.S * 3);
      for (let k = 0; k < eps.length; k++) eps[k] = gaussian(rand);
    }

    function drawSample(g, ox, oy, size, tt) {
      const S = L.S;
      const ab = alphaBar(tt);
      const sa = Math.sqrt(ab);
      const sn = Math.sqrt(1 - ab);
      for (let j = 0; j < size; j++) {
        const mj = Math.min(S - 1, Math.floor(((j + 0.5) / size) * S));
        for (let i = 0; i < size; i++) {
          const mi = Math.min(S - 1, Math.floor(((i + 0.5) / size) * S));
          const k = (mj * S + mi) * 3;
          const jitter = (BAYER[((oy + j) & 3) * 4 + ((ox + i) & 3)] - 0.5) * 0.14;
          const r = (sa * (2 * x0[k] - 1) + sn * eps[k] + 1) / 2 + jitter;
          const gg = (sa * (2 * x0[k + 1] - 1) + sn * eps[k + 1] + 1) / 2 + jitter;
          const b = (sa * (2 * x0[k + 2] - 1) + sn * eps[k + 2] + 1) / 2 + jitter;
          g.set(ox + i, oy + j, nearestColor(r, gg, b, QUANT));
        }
      }
    }

    function drawNoise(g, ox, oy, size, tt) {
      const S = L.S;
      const sn = Math.sqrt(1 - alphaBar(tt));
      for (let j = 0; j < size; j++) {
        const mj = Math.min(S - 1, Math.floor(((j + 0.5) / size) * S));
        for (let i = 0; i < size; i++) {
          const mi = Math.min(S - 1, Math.floor(((i + 0.5) / size) * S));
          const k = (mj * S + mi) * 3;
          const e = (eps[k] + eps[k + 1] + eps[k + 2]) / 3;
          g.dither(ox + i, oy + j, 0.5 + 0.3 * sn * e, NOISE_RAMP);
        }
      }
    }

    function drawSchedule(g, ox, oy, w, h, tt) {
      g.stroke(ox, oy, w, h, C.grout);
      const pw = w - 2;
      const ph = h - 2;
      for (let px = 0; px < pw; px++) {
        const ab = alphaBar(px / (pw - 1));
        const cy = oy + 1 + (ph - 1) - Math.round(ab * (ph - 1));
        for (let y = cy + 1; y < oy + h - 1; y++) if ((px + y) % 3 === 0) g.set(ox + 1 + px, y, C.pink);
        g.set(ox + 1 + px, cy, C.magenta);
      }
      const mx = ox + 1 + Math.round(tt * (pw - 1));
      g.vline(mx, oy + 1, oy + h - 2, C.slate, 2);
      const my = oy + 1 + (ph - 1) - Math.round(alphaBar(tt) * (ph - 1));
      g.rect(mx - 1, my - 1, 2, 2, C.ink);
    }

    return {
      minCols: 80,
      init(g, st) {
        stage = st;
        W = g.cols; H = g.rows;
        layout();
        buildTarget();
        reseed();
        t = stage.reduced ? 0 : 1;
      },
      update(dt, time) {
        if (manualT !== null && time < manualUntil) {
          t = manualT;
        } else {
          if (manualT !== null) { cycle = 1.2 + (1 - manualT) * 6; manualT = null; }
          cycle += dt;
          if (cycle >= CYCLE) { cycle = 0; reseed(); }
          t = timeline(cycle);
        }
        const step = Math.round(t * 1000);
        if (step !== lastStep) { lastStep = step; stage.emit({ t, step, signal: alphaBar(t) }); }
      },
      draw(g) {
        const tt = t;
        const stepLabel = 'T=' + Math.round(tt * 1000);
        const title = L.S >= g.textWidth('REVERSE DIFFUSION T=1000') + 2 ? 'REVERSE DIFFUSION' : 'DENOISE';
        g.text(title, L.mainX, L.labelY, C.ink);
        if (L.S >= g.textWidth(title + ' T=1000') + 2) g.text(stepLabel, L.mainX + L.S - 1, L.labelY, C.magenta, 'right');
        drawSample(g, L.mainX, L.mainY, L.S, tt);
        g.hline(L.mainX, L.mainX + L.S - 1, L.barY, C.grout);
        const filled = Math.round((1 - tt) * L.S);
        if (filled > 0) g.hline(L.mainX, L.mainX + filled - 1, L.barY, C.magenta);

        if (L.aux) {
          g.text('NOISE', L.auxX, L.labelY, C.ink);
          drawNoise(g, L.auxX, L.mainY, L.noiseS, tt);
          if (L.plotH >= 10) {
            g.text('SIGNAL', L.auxX, L.plotY - 7, C.ink);
            drawSchedule(g, L.auxX, L.plotY, L.auxW, L.plotH, tt);
          }
        }

        if (L.th) {
          const active = Math.round((1 - tt) * 4);
          for (let k = 0; k < THUMBS.length; k++) {
            const x = L.mainX + k * (L.th + L.thumbGap);
            drawSample(g, x, L.thumbY, L.th, THUMBS[k]);
            if (k === active) g.stroke(x - 1, L.thumbY - 1, L.th + 2, L.th + 2, C.ink);
            if (k < 4 && L.thumbGap >= 5) {
              g.text('>', x + L.th + Math.floor(L.thumbGap / 2) - 1, L.thumbY + Math.floor(L.th / 2) - 2, C.slate);
            }
            if (L.th >= 15) g.text(String(Math.round(THUMBS[k] * 1000)), x, L.thumbY + L.th + 3, C.slate);
          }
        }
      },
      pointer(x, y, type, time) {
        if (type !== 'down' || !L.th) return;
        if (y < L.thumbY || y >= L.thumbY + L.th) return;
        for (let k = 0; k < THUMBS.length; k++) {
          const tx = L.mainX + k * (L.th + L.thumbGap);
          if (x >= tx && x < tx + L.th) { manualT = THUMBS[k]; manualUntil = time + 4; }
        }
      },
      action(name, value, time) {
        if (name === 'setT') { manualT = clamp(Number(value), 0, 1); manualUntil = time + 4; }
        if (name === 'replay') { manualT = null; cycle = 0; reseed(); }
      },
      onTheme() { buildTarget(); }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Self-attention                                                      */
  /* ------------------------------------------------------------------ */

  function attentionScene(options = {}) {
    const n = 12;
    const d = 8;
    const TOKEN_COLORS = [C.blue, C.magenta, C.green, C.orange, C.navy, C.pink, C.mint, C.yellow, C.plum, C.sky, C.red, C.slate];
    const Z_RAMP = [C.navy, C.blue, C.sky, C.paper, C.pink, C.magenta, C.plum];
    const HEADS = [
      { name: 'Previous-token head', ramp: [C.paper, C.sky, C.blue, C.navy], bias: (i, j) => (j === i - 1 ? 3.4 : 0) },
      { name: 'Attention-sink head', ramp: [C.paper, C.pink, C.magenta, C.plum], bias: (i, j) => (j === 0 ? 2.8 : 0) },
      { name: 'Local-window head', ramp: [C.paper, C.mint, C.green, C.navy], bias: (i, j) => (i - j <= 2 ? 1.8 - 0.6 * (i - j) : -1.2) },
      { name: 'Content-routing head', ramp: [C.paper, C.yellow, C.orange, C.red], bias: () => 0 }
    ];
    let W, H, L, stage;
    let A = [];
    let Z = [];
    let head = 0;
    let prevHead = 0;
    let switchedAt = -10;
    let q = 0;
    let qTimer = 0;
    let headTimer = 0;
    let manualUntil = 0;

    function matmul(a, w) {
      return a.map((row) => w[0].map((_, c) => row.reduce((s, v, r) => s + v * w[r][c], 0)));
    }

    function compute() {
      const rand = mulberry32(options.seed || 21);
      const randMat = (r, c, scale) => Array.from({ length: r }, () => Array.from({ length: c }, () => gaussian(rand) * scale));
      const E = randMat(n, d, 1).map((row, pos) => row.map((v, k) => {
        const freq = 1 / Math.pow(100, (2 * Math.floor(k / 2)) / d);
        return v + (k % 2 === 0 ? Math.sin(pos * freq) : Math.cos(pos * freq));
      }));
      A = []; Z = [];
      HEADS.forEach((h) => {
        const Q = matmul(E, randMat(d, d, 1 / Math.sqrt(d)));
        const K = matmul(E, randMat(d, d, 1 / Math.sqrt(d)));
        const V = matmul(E, randMat(d, d, 1 / Math.sqrt(d)));
        const weights = [];
        for (let i = 0; i < n; i++) {
          const row = [];
          let max = -Infinity;
          for (let j = 0; j <= i; j++) {
            const s = Q[i].reduce((acc, v, k) => acc + v * K[j][k], 0) / Math.sqrt(d) + h.bias(i, j);
            row.push(s);
            max = Math.max(max, s);
          }
          const exps = row.map((s) => Math.exp(s - max));
          const sum = exps.reduce((a, b) => a + b, 0);
          weights.push(exps.map((e) => e / sum));
        }
        const out = weights.map((row) => V[0].map((_, k) => row.reduce((acc, w, j) => acc + w * V[j][k], 0)));
        const peak = Math.max(...out.flat().map(Math.abs)) || 1;
        A.push(weights);
        Z.push(out.map((row) => row.map((v) => 0.5 + 0.5 * (v / peak))));
      });
    }

    function layout() {
      const m = 2;
      const mx = m + 7;
      const my = m + 13;
      let zc = 2;
      let b = Math.floor(Math.min((W - mx - m - 3 - d * zc) / n, (H - my - m) / n));
      if (b < 4) { zc = 1; b = Math.floor(Math.min((W - mx - m - 3 - d * zc) / n, (H - my - m) / n)); }
      b = Math.max(2, b);
      const used = mx + n * b + 3 + d * zc;
      const shift = Math.max(0, Math.floor((W - m - used) / 2));
      L = { m, b, zc, mx: mx + shift, my, qx: m + 4 + shift, labelX: m + shift };
      L.zx = L.mx + n * b + 3;
    }

    function weight(i, j, mix) {
      const a = A[head][i][j];
      const p = A[prevHead][i][j];
      return p + (a - p) * mix;
    }

    function selectHead(next, time) {
      prevHead = head;
      head = next;
      switchedAt = time;
      stage.emit({ head, name: HEADS[head].name, count: HEADS.length });
    }

    return {
      minCols: 60,
      init(g, st) {
        stage = st;
        W = g.cols; H = g.rows;
        compute();
        layout();
        q = stage.reduced ? n - 1 : 0;
        stage.emit({ head, name: HEADS[head].name, count: HEADS.length });
      },
      update(dt, time) {
        headTimer += dt;
        if (headTimer > 4.2) { headTimer = 0; selectHead((head + 1) % HEADS.length, time); }
        if (time > manualUntil) {
          qTimer += dt;
          if (qTimer > 0.42) { qTimer = 0; q = (q + 1) % n; }
        }
      },
      draw(g, time) {
        const { m, b, zc, mx, my, qx, zx, labelX } = L;
        const mix = clamp((time - switchedAt) / 0.6, 0, 1);
        const ramp = (mix < 0.5 ? HEADS[prevHead] : HEADS[head]).ramp;

        g.text('HEAD ' + (head + 1), labelX, m, C.ink);
        for (let k = 0; k < HEADS.length; k++) {
          g.rect(zx + d * zc - (HEADS.length - k) * 4 + 1, m + 1, 3, 3, k === head ? C.ink : C.grout);
        }
        g.text('K', labelX, m + 7, C.slate);
        g.text('Q', labelX, my + Math.floor((n * b) / 2) - 3, C.slate);
        g.text(d * zc >= 15 ? 'Z=AV' : 'Z', zx, m + 7, C.slate);

        for (let j = 0; j < n; j++) {
          const on = j <= q;
          g.rect(mx + j * b, m + 9, Math.max(1, b - 1), 2, on ? TOKEN_COLORS[j] : C.grout);
        }
        for (let i = 0; i < n; i++) g.rect(qx, my + i * b, 2, Math.max(1, b - 1), TOKEN_COLORS[i]);

        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const x = mx + j * b;
            const y = my + i * b;
            if (j > i) {
              for (let yy = 0; yy < b; yy++) for (let xx = 0; xx < b; xx++) {
                if ((x + xx + y + yy) % 3 === 0) g.set(x + xx, y + yy, C.grout);
              }
              continue;
            }
            const v = Math.sqrt(weight(i, j, mix));
            for (let yy = 0; yy < b; yy++) for (let xx = 0; xx < b; xx++) g.dither(x + xx, y + yy, v, ramp);
          }
          for (let k = 0; k < d; k++) {
            const a = Z[head][i][k];
            const p = Z[prevHead][i][k];
            const v = p + (a - p) * mix;
            for (let yy = 0; yy < Math.max(1, b - 1); yy++) for (let xx = 0; xx < zc; xx++) {
              g.dither(zx + k * zc + xx, my + i * b + yy, v, Z_RAMP);
            }
          }
        }
        g.stroke(mx - 1, my + q * b - 1, (q + 1) * b + 2, b + 2, C.ink);
        g.stroke(zx - 1, my + q * b - 1, d * zc + 2, b + 1, C.ink);
      },
      pointer(x, y, type, time) {
        const { b, mx, my } = L;
        if (type === 'down') { headTimer = 0; selectHead((head + 1) % HEADS.length, time); return; }
        if (type === 'move' && x >= mx - 3 && x < L.zx + d * L.zc && y >= my && y < my + n * b) {
          q = clamp(Math.floor((y - my) / b), 0, n - 1);
          manualUntil = time + 2.5;
        }
      },
      action(name, value, time) {
        if (name === 'nextHead') { headTimer = 0; selectHead((head + 1) % HEADS.length, time); }
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Lakehouse — medallion architecture                                  */
  /* ------------------------------------------------------------------ */

  function lakehouseScene(options = {}) {
    const RAW = [C.orange, C.bronze, C.pink, C.yellow, C.magenta];
    const SCHEMA = [C.navy, C.blue, C.sky, C.blue];
    const KEYS = [C.gold, C.yellow, C.orange, C.mint];
    const rand = mulberry32(options.seed || 33);
    let W, H, L, stage;
    let records = [];
    let agg = [0, 0, 0, 0];
    let flash = [0, 0, 0, 0];
    let quarantined = 0;
    let arrived = 0;
    let version = 0;
    let optimizeFlash = 0;
    let spawnTimer = 0;
    let badBurst = 0;

    function layout() {
      const m = 2;
      const g = 5;
      const srcW = 5;
      const zoneW = Math.floor((W - 2 * m - srcW - 2 - 2 * g) / 3);
      const bx = m + srcW + 2;
      const sx = bx + zoneW + g;
      const gx = sx + zoneW + g;
      const zy = m + 8;
      const zh = Math.max(16, Math.floor((H - zy - m) * 0.64));
      const lanes = [];
      for (let y = zy + 3; y <= zy + zh - 4; y += 4) lanes.push(y);
      const by = zy + zh + 3;
      L = { m, g, zoneW, bx, sx, gx, zy, zh, lanes, by, bh: H - by - m, srcW };
    }

    function spawn(count, badRate) {
      for (let i = 0; i < count; i++) {
        const len = 2 + Math.floor(rand() * 5);
        const bad = rand() < badRate;
        const cells = Array.from({ length: len }, () => RAW[Math.floor(rand() * RAW.length)]);
        if (bad) cells[Math.floor(rand() * len)] = C.red;
        records.push({
          lane: L.lanes[Math.floor(rand() * L.lanes.length)],
          x: L.m + L.srcW - rand() * 6,
          y: 0,
          len, cells, bad,
          key: Math.floor(rand() * KEYS.length),
          speed: 7 + rand() * 4,
          stage: 0
        });
      }
    }

    return {
      minCols: 84,
      warmup: 10,
      init(g, st) {
        stage = st;
        W = g.cols; H = g.rows;
        layout();
        records = [];
      },
      update(dt) {
        spawnTimer -= dt;
        if (spawnTimer <= 0) {
          spawnTimer = 0.7 + rand() * 0.4;
          spawn(4 + Math.floor(rand() * 4), badBurst > 0 ? 0.65 : 0.14);
          badBurst = Math.max(0, badBurst - 1);
        }
        const { bx, sx, gx, zoneW, by } = L;
        for (const r of records) {
          if (r.stage === 0) {
            r.x += r.speed * dt;
            if (r.x >= bx + zoneW) {
              if (r.bad) { r.stage = 3; r.y = r.lane; } else { r.stage = 1; r.len = 4; r.cells = SCHEMA; }
            }
          } else if (r.stage === 1) {
            r.x += r.speed * dt;
            if (r.x >= gx) {
              r.dead = true;
              agg[r.key] += 1;
              flash[r.key] = 0.35;
              arrived += 1;
              if (arrived % 5 === 0) {
                version += 1;
                stage.emit({ version, quarantined });
              }
              if (Math.max(...agg) > 26) {
                agg = agg.map((a) => Math.floor(a * 0.45));
                optimizeFlash = 1.4;
              }
            }
          } else if (r.stage === 3) {
            r.y += 16 * dt;
            r.x += 3 * dt;
            if (r.y >= by + 1) {
              r.dead = true;
              quarantined += 1;
              stage.emit({ version, quarantined });
            }
          }
        }
        records = records.filter((r) => !r.dead);
        for (let k = 0; k < flash.length; k++) flash[k] = Math.max(0, flash[k] - dt);
        optimizeFlash = Math.max(0, optimizeFlash - dt);
      },
      draw(g, time) {
        const { m, zoneW, bx, sx, gx, zy, zh, by, bh, srcW, g: gap } = L;
        const fits = (s) => g.textWidth(s) <= zoneW;
        g.text(fits('BRONZE') ? 'BRONZE' : 'BRZ', bx, m, C.bronze);
        g.text(fits('SILVER') ? 'SILVER' : 'SLV', sx, m, C.slate);
        g.text(optimizeFlash > 0 && fits('OPTIMIZE') ? 'OPTIMIZE' : 'GOLD', gx, m, C.gold);

        g.stroke(bx, zy, zoneW, zh, C.bronze);
        g.stroke(sx, zy, zoneW, zh, C.silver);
        g.stroke(gx, zy, zoneW, zh, C.gold);
        g.hline(bx + 1, bx + zoneW - 2, zy + 1, C.bronze, 2);
        g.hline(sx + 1, sx + zoneW - 2, zy + 1, C.silver, 2);

        // Sources: stream partitions, an API and landed files.
        const third = Math.floor(zh / 3);
        const s0 = zy + 2;
        for (let p = 0; p < 3; p++) {
          g.hline(m, m + srcW - 1, s0 + p * 2, C.slate);
          g.set(m + ((Math.floor(time * 6) + p) % srcW), s0 + p * 2, C.orange);
        }
        const s1 = zy + third + 1;
        g.stroke(m, s1, srcW, 5, C.slate);
        g.set(m + 2, s1 + 2, C.blue);
        const s2 = zy + 2 * third;
        g.rect(m, s2, srcW - 1, 6, C.silver);
        g.hline(m + 1, m + srcW - 3, s2 + 2, C.slate);
        g.hline(m + 1, m + srcW - 3, s2 + 4, C.slate);

        // Validation and aggregation gates.
        g.vline(bx + zoneW + Math.floor(gap / 2), zy, zy + zh - 1, C.ink, 2);
        g.vline(sx + zoneW + Math.floor(gap / 2), zy, zy + zh - 1, C.ink, 2);

        // Gold: per-key aggregates.
        const barMax = zoneW - 4;
        for (let k = 0; k < KEYS.length; k++) {
          const y = zy + 3 + k * Math.max(3, Math.floor((zh - 5) / KEYS.length));
          const len = Math.min(barMax, Math.round((agg[k] / 26) * barMax));
          g.hline(gx + 2, gx + 1 + barMax, y, C.grout, 2);
          if (len > 0) { g.hline(gx + 2, gx + 1 + len, y, KEYS[k]); g.hline(gx + 2, gx + 1 + len, y + 1, KEYS[k]); }
          if (flash[k] > 0) g.rect(gx + 2 + len, y, 2, 2, C.ink);
        }

        for (const r of records) {
          if (r.stage === 3) {
            g.set(Math.floor(r.x), Math.floor(r.y), C.red);
            continue;
          }
          const hx = Math.floor(r.x);
          for (let i = 0; i < r.len; i++) {
            g.set(hx - i, r.lane, r.cells[i % r.cells.length]);
            g.set(hx - i, r.lane + 1, r.cells[(r.len - 1 - i) % r.cells.length]);
          }
        }

        // Quarantine bin and Delta transaction log.
        if (bh >= 7) {
          const qw = zoneW + gap;
          g.text(g.textWidth('INVALID') < qw - 2 ? 'INVALID' : 'BAD', bx, by, C.red);
          const binY = by + 6;
          const binH = Math.max(2, bh - 6);
          g.stroke(bx, binY, qw, binH, C.slate);
          const cap = (qw - 2) * Math.max(1, binH - 2);
          const fill = quarantined % (cap + 1);
          for (let k = 0; k < fill; k++) {
            g.set(bx + 1 + (k % (qw - 2)), binY + binH - 2 - Math.floor(k / (qw - 2)), C.red);
          }
          const lx = sx;
          const lw = gx + zoneW - sx;
          g.text('DELTA LOG', lx, by, C.ink);
          g.text('V' + version, lx + lw - 1, by, C.ink, 'right');
          const slots = Math.floor(lw / 4);
          const first = Math.max(0, version - slots + 1);
          for (let v = first; v <= version; v++) {
            const x = lx + (v - first) * 4;
            g.rect(x, by + 6, 3, Math.min(3, binH), v === version ? C.ink : v % 2 ? C.gold : C.silver);
          }
        }
      },
      action(name) {
        if (name === 'inject') { spawn(8, 0.7); badBurst = 2; }
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Services — gateway, rate limiting, cache-aside and async messaging  */
  /* ------------------------------------------------------------------ */

  function servicesScene(options = {}) {
    const rand = mulberry32(options.seed || 45);
    const CAPACITY = 10;
    const REFILL = 5;
    let W, H, L, stage;
    let packets = [];
    let tokens = CAPACITY;
    let spawnTimer = 0;
    let spikeUntil = 0;
    let rejected = 0;
    let hits = 0;
    let lookups = 0;
    let queue = 0;
    let workerTimer = 0;
    let recent = [];
    let statusTimer = 0;
    const flash = {};

    function layout() {
      const m = 2;
      const s = Math.max(0, Math.floor((W - 94) / 3));
      const boxTop = m + 14;
      const gw = 22;
      const gx = m + 9 + s;
      const busX = gx + gw + 3 + s;
      const sx = busX + 3;
      const sw = 26;
      const rx = sx + sw + 3 + s;
      const rw = Math.max(20, W - m - rx);
      const area = H - m - boxTop;
      const rowY = [0, 1, 2].map((k) => boxTop + Math.floor(k * (area / 3) + (area / 3 - 7) / 2));
      const clients = [0, 1, 2, 3].map((k) => boxTop + 1 + Math.floor(k * ((area - 4) / 3)));
      L = { m, gx, gw, busX, sx, sw, rx, rw, boxTop, rowY, clients, gy: boxTop, gh: area };
    }

    const service = { auth: 0, search: 1, book: 2 };

    function mid(k) { return L.rowY[k] + 3; }

    function send(path, color, speed, done) {
      packets.push({ path, seg: 0, x: path[0][0], y: path[0][1], color, speed, done });
    }

    function respond(forward, color) {
      send(forward.slice().reverse(), color, 30, (p) => { flash['c' + p.client] = { c: color, t: 0.3 }; });
      packets[packets.length - 1].client = forward.client;
    }

    function request(time) {
      recent.push(time);
      const k = Math.floor(rand() * L.clients.length);
      const cy = L.clients[k];
      const roll = rand();
      const type = roll < 0.25 ? 'auth' : roll < 0.75 ? 'search' : 'book';
      const start = [[L.m + 4, cy], [L.gx, cy]];
      send(start, C.blue, 26, () => {
        if (tokens < 1) {
          rejected += 1;
          flash.gw = { c: C.red, t: 0.25 };
          const back = [[L.gx, cy], [L.m + 4, cy]];
          send(back, C.red, 26, () => { flash['c' + k] = { c: C.red, t: 0.3 }; });
          return;
        }
        tokens -= 1;
        const row = service[type];
        const forward = [[L.m + 4, cy], [L.gx, cy], [L.gx + L.gw - 1, cy], [L.busX, cy], [L.busX, mid(row)], [L.sx, mid(row)]];
        forward.client = k;
        send(forward.slice(1), C.blue, 30, () => {
          flash['s' + row] = { c: C.blue, t: 0.3 };
          const out = [L.sx + L.sw - 1, mid(row)];
          const right = [L.rx, mid(row)];
          const lane = L.rx + L.rw - 4;
          if (type === 'book') {
            respond(forward, C.mint);
            send([out, right], C.magenta, 22, () => { queue = Math.min(queue + 1, 12); });
            return;
          }
          if (type === 'auth') {
            send([out, right], C.blue, 30, () => {
              flash.r0 = { c: C.blue, t: 0.3 };
              send([right, out], C.mint, 30, () => respond(forward, C.mint));
            });
            return;
          }
          send([out, right], C.blue, 30, () => {
            lookups += 1;
            if (rand() < 0.68) {
              hits += 1;
              flash.r1 = { c: C.mint, t: 0.3 };
              send([right, out], C.mint, 30, () => respond(forward, C.mint));
            } else {
              flash.r1 = { c: C.orange, t: 0.3 };
              send([[lane, mid(1)], [lane, mid(0)]], C.orange, 26, () => {
                flash.r0 = { c: C.orange, t: 0.3 };
                send([[lane, mid(0)], [lane, mid(1)], right, out], C.mint, 30, () => respond(forward, C.mint));
              });
            }
          });
        });
      });
    }

    function box(g, x, y, w, h, label, color, key) {
      g.stroke(x, y, w, h, color);
      g.text(label, x + 2, y + 1, C.ink);
      const f = flash[key];
      if (f && f.t > 0) g.rect(x + w - 4, y + h - 3, 2, 1, f.c);
    }

    return {
      minCols: 94,
      warmup: 6,
      init(g, st) {
        stage = st;
        W = g.cols; H = g.rows;
        layout();
        packets = [];
      },
      update(dt, time) {
        tokens = Math.min(CAPACITY, tokens + REFILL * dt);
        const rate = time < spikeUntil ? 17 : 3.2;
        spawnTimer -= dt;
        while (spawnTimer <= 0) { spawnTimer += 1 / rate + (rand() - 0.5) * (0.4 / rate); request(time); }

        for (const p of packets) {
          let budget = p.speed * dt;
          while (budget > 0 && !p.finished) {
            const target = p.path[p.seg + 1];
            if (!target) { p.finished = true; break; }
            const dx = target[0] - p.x;
            const dy = target[1] - p.y;
            const dist = Math.abs(dx) + Math.abs(dy);
            if (dist <= budget) {
              p.x = target[0]; p.y = target[1]; p.seg += 1; budget -= dist;
            } else {
              p.x += Math.sign(dx) * Math.min(Math.abs(dx), budget);
              if (Math.abs(dx) < budget) p.y += Math.sign(dy) * (budget - Math.abs(dx));
              budget = 0;
            }
          }
        }
        const done = packets.filter((p) => p.finished);
        packets = packets.filter((p) => !p.finished);
        for (const p of done) if (p.done) p.done(p);

        workerTimer += dt;
        if (workerTimer > 0.7 && queue > 0) { workerTimer = 0; queue -= 1; flash.worker = { c: C.mint, t: 0.3 }; }
        for (const key of Object.keys(flash)) flash[key].t -= dt;

        recent = recent.filter((ts) => time - ts < 1);
        statusTimer -= dt;
        if (statusTimer <= 0) {
          statusTimer = 0.5;
          stage.emit({ rps: recent.length, rejected, hitRate: lookups ? Math.round((hits / lookups) * 100) : 0 });
        }
      },
      draw(g) {
        const { m, gx, gw, busX, sx, sw, rx, rw, boxTop, rowY, clients, gy, gh } = L;
        g.text('RPS ' + recent.length, m, m, C.ink);
        const hit = 'HIT ' + (lookups ? Math.round((hits / lookups) * 100) : 0) + '%';
        g.text(hit, Math.floor(W / 2), m, C.green, 'center');
        g.text('429 ' + rejected, W - m - 1, m, rejected ? C.red : C.slate, 'right');

        // Wires.
        for (const cy of clients) g.hline(m + 4, gx - 1, cy, C.grout);
        g.vline(busX, Math.min(clients[0], mid(0)), Math.max(clients[3], mid(2)), C.grout);
        for (const cy of clients) g.hline(gx + gw, busX, cy, C.grout);
        for (let k = 0; k < 3; k++) { g.hline(busX, sx - 1, mid(k), C.grout); g.hline(sx + sw, rx - 1, mid(k), C.grout); }
        g.vline(rx + rw - 4, mid(0), mid(1), C.grout);

        // Clients.
        clients.forEach((cy, k) => {
          const f = flash['c' + k];
          g.rect(m, cy - 1, 4, 2, f && f.t > 0 ? f.c : C.slate);
          g.set(m + 1, cy + 1, C.slate);
          g.set(m + 2, cy + 1, C.slate);
        });

        // Gateway with its token bucket.
        g.text('API GW', gx, boxTop - 7, C.ink);
        const gf = flash.gw;
        g.stroke(gx, gy, gw, gh, gf && gf.t > 0 ? C.red : C.ink);
        const bh = Math.min(16, gh - 8);
        const bx = gx + gw - 8;
        const by = gy + Math.floor((gh - bh) / 2);
        g.stroke(bx, by, 6, bh, C.slate);
        const level = Math.round((tokens / CAPACITY) * (bh - 2));
        for (let y = 0; y < level; y++) g.hline(bx + 1, bx + 4, by + bh - 2 - y, C.yellow);
        if (gw >= 20) g.text('JWT', gx + 2, gy + 2, C.slate);

        box(g, sx, rowY[0], sw, 7, 'AUTH', C.ink, 's0');
        box(g, sx, rowY[1], sw, 7, 'SEARCH', C.ink, 's1');
        box(g, sx, rowY[2], sw, 7, 'BOOK', C.ink, 's2');
        box(g, rx, rowY[0], rw, 7, 'SQL', C.navy, 'r0');
        box(g, rx, rowY[1], rw, 7, 'CACHE', C.green, 'r1');

        g.stroke(rx, rowY[2], rw, 7, C.magenta);
        g.text('MQ', rx + 2, rowY[2] + 1, C.ink);
        const slots = Math.floor((rw - 13) / 2);
        for (let k = 0; k < slots; k++) g.rect(rx + 10 + k * 2, rowY[2] + 2, 1, 3, k < queue ? C.magenta : C.grout);
        const wf = flash.worker;
        g.rect(rx + rw - 3, rowY[2] + 2, 1, 3, wf && wf.t > 0 ? C.mint : C.slate);

        for (const p of packets) {
          g.set(Math.round(p.x), Math.round(p.y), p.color);
          g.set(Math.round(p.x) + 1, Math.round(p.y), p.color);
        }
      },
      action(name, value, time) {
        if (name === 'spike') spikeUntil = time + 3;
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Stream band                                                         */
  /* ------------------------------------------------------------------ */

  function streamScene(options = {}) {
    const rand = mulberry32(options.seed || 7);
    const RAW = [C.orange, C.bronze, C.pink, C.yellow, C.magenta];
    let W, H, zoneA, zoneB, patternH, lanes;
    let records = [];
    let drops = [];
    let spawnTimer = 0;

    function spawn() {
      const len = 2 + Math.floor(rand() * 5);
      const bad = rand() < 0.12;
      const cells = Array.from({ length: len }, () => RAW[Math.floor(rand() * RAW.length)]);
      if (bad) cells[0] = C.red;
      records.push({ x: -1, lane: lanes[Math.floor(rand() * lanes.length)], len, cells, bad, speed: 7 + rand() * 6, stage: 0 });
    }

    function motif(x, y, t) {
      const zone = x < zoneA ? 0 : x < zoneB ? 1 : 2;
      const sx = x + Math.floor(t * 1.5);
      if (zone === 0) {
        const checker = ((sx >> 1) + (y >> 1)) & 1;
        return checker ? C.orange : C.magenta;
      }
      if (zone === 1) {
        const lx = ((sx % 8) + 8) % 8;
        const cy = (patternH - 1) / 2;
        return Math.abs(lx - 3.5) + Math.abs(y - cy) < Math.min(3, cy + 0.5) ? C.sky : C.navy;
      }
      const col = Math.floor(sx / 3);
      const height = 1 + Math.floor((Math.sin(col * 1.7) * 0.5 + 0.5) * (patternH - 1));
      return y >= patternH - height && sx % 3 !== 2 ? C.yellow : C.green;
    }

    return {
      minCols: 30,
      warmup: 12,
      init(g) {
        W = g.cols; H = g.rows;
        zoneA = Math.floor(W / 3);
        zoneB = Math.floor((2 * W) / 3);
        patternH = Math.max(3, Math.floor(H * 0.42));
        lanes = [];
        for (let y = patternH + 2; y < H - 1; y += 2) lanes.push(y);
        if (!lanes.length) lanes.push(H - 1);
        records = [];
        drops = [];
      },
      update(dt) {
        spawnTimer -= dt;
        while (spawnTimer <= 0) { spawnTimer += 0.12 + rand() * 0.2; spawn(); }
        for (const r of records) {
          r.x += r.speed * dt;
          if (r.stage === 0 && r.x >= zoneA) {
            if (r.bad) { r.dead = true; drops.push({ x: r.x, y: r.lane, vy: 0 }); } else { r.stage = 1; r.len = 4; r.cells = [C.navy, C.blue, C.sky, C.blue]; }
          } else if (r.stage === 1 && r.x >= zoneB) {
            r.stage = 2; r.len = 3; r.cells = [C.gold, C.yellow, C.gold];
          }
          if (r.x - r.len > W) r.dead = true;
        }
        records = records.filter((r) => !r.dead);
        for (const d of drops) { d.vy += 40 * dt; d.y += d.vy * dt; }
        drops = drops.filter((d) => d.y < H);
      },
      draw(g, t) {
        for (let y = 0; y < patternH; y++) for (let x = 0; x < W; x++) g.set(x, y, motif(x, y, t));
        for (const y of lanes) for (let x = (y % 4 === 0 ? 0 : 2); x < W; x += 4) g.set(x, y, C.grout);
        for (let y = patternH + 1; y < H; y += 2) { g.set(zoneA, y, C.ink); g.set(zoneB, y, C.ink); }
        for (const r of records) {
          const hx = Math.floor(r.x);
          for (let i = 0; i < r.len; i++) g.set(hx - i, r.lane, r.cells[i % r.cells.length]);
        }
        for (const d of drops) g.set(Math.floor(d.x), Math.floor(d.y), C.red);
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Multi-agent orchestration                                           */
  /* ------------------------------------------------------------------ */

  function agentsScene() {
    const AGENTS = [
      { label: 'KUSTO', color: C.blue, glyph: 'cylinder' },
      { label: 'LAKE', color: C.green, glyph: 'delta' },
      { label: 'MODEL', color: C.orange, glyph: 'cube' }
    ];
    const PHASES = [['route', 0.9], ['think', 1.8], ['dispatch', 1.0], ['query', 1.7], ['validate', 1.2], ['answer', 1.0]];
    let W, H, L, stage;
    let run = null;
    let lastPhase = null;

    function layout() {
      const m = 2;
      const oy = Math.max(1, Math.floor((H - 56) / 2));
      const userW = 20;
      const orchW = 53;
      const gap = 4;
      const agentW = Math.floor((W - 2 * m - 2 * gap) / 3);
      const orchX = Math.max(m + userW + 7, Math.floor((W - orchW) / 2));
      const yA = oy;
      const busTop = yA + 13;
      const yB = yA + 17;
      const ySrc = yB + 11;
      const busBot = ySrc + 10;
      const yC = busBot + 3;
      const vW = 41;
      const ansX = m + vW + 6;
      L = {
        m, yA, busTop, yB, ySrc, busBot, yC, userW, orchW, orchX, agentW, gap, vW, ansX,
        ansW: W - m - ansX,
        orchCx: orchX + Math.floor(orchW / 2),
        vCx: m + Math.floor(vW / 2),
        agentX: (k) => m + k * (agentW + gap),
        agentCx: (k) => m + k * (agentW + gap) + Math.floor(agentW / 2)
      };
    }

    function pathFor(phase, a) {
      const { m, yA, busTop, yB, ySrc, busBot, yC, userW, orchX, orchCx, vCx, vW, ansX } = L;
      const ax = L.agentCx(a);
      switch (phase) {
        case 'route': return [[m + userW, yA + 4], [orchX - 1, yA + 4]];
        case 'dispatch': return [[orchCx, yA + 9], [orchCx, busTop], [ax, busTop], [ax, yB - 1]];
        case 'query': return [[ax, yB + 9], [ax, ySrc - 1]];
        case 'validate': return [[ax, ySrc + 8], [ax, busBot], [vCx, busBot], [vCx, yC - 1]];
        case 'answer': return [[m + vW, yC + 7], [ansX - 1, yC + 7]];
        default: return null;
      }
    }

    // Walks a Manhattan polyline and returns the portion covered at fraction f.
    function partialPath(path, f) {
      let total = 0;
      for (let i = 0; i < path.length - 1; i++) {
        total += Math.abs(path[i + 1][0] - path[i][0]) + Math.abs(path[i + 1][1] - path[i][1]);
      }
      let d = clamp(f, 0, 1) * total;
      const points = [path[0]];
      for (let i = 0; i < path.length - 1; i++) {
        const [x0, y0] = path[i];
        const [x1, y1] = path[i + 1];
        const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
        if (d >= len) { points.push(path[i + 1]); d -= len; continue; }
        const k = len ? d / len : 1;
        points.push([Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k)]);
        break;
      }
      return { points, end: points[points.length - 1] };
    }

    function drawPath(g, path, color) {
      for (let i = 0; i < path.length - 1; i++) {
        const [x0, y0] = path[i];
        const [x1, y1] = path[i + 1];
        if (y0 === y1) g.hline(x0, x1, y0, color); else g.vline(x0, y0, y1, color);
      }
    }

    function phaseState(time) {
      if (!run) return null;
      const speed = stage.reduced ? 0.35 : 1;
      let t = time - run.start;
      for (let i = 0; i < PHASES.length; i++) {
        const dur = PHASES[i][1] * speed;
        if (t < dur) return { name: PHASES[i][0], index: i, f: t / dur };
        t -= dur;
      }
      return { name: 'done', index: PHASES.length, f: 1 };
    }

    function glyph(g, kind, cx, y, on, color, time) {
      const x = cx - 5;
      if (kind === 'cylinder') {
        g.hline(x + 1, x + 9, y, color);
        for (let r = 1; r < 7; r++) { g.set(x, y + r, color); g.set(x + 10, y + r, color); }
        g.hline(x + 1, x + 9, y + 7, color);
        for (let r = 2; r < 7; r += 2) {
          const lit = on && Math.floor(time * 8) % 3 === (r / 2 - 1);
          g.hline(x + 2, x + 8, y + r, lit ? C.ink : C.grout);
        }
      } else if (kind === 'delta') {
        for (let k = 0; k < 3; k++) {
          const lit = on && Math.floor(time * 6) % 3 === k;
          g.stroke(x + k * 2, y + k * 2, 6, 4, lit ? C.ink : color);
        }
      } else {
        g.stroke(x + 2, y, 7, 5, color);
        g.stroke(x, y + 3, 7, 5, color);
        if (on) g.rect(x + 1 + (Math.floor(time * 5) % 5), y + 4, 1, 3, C.ink);
      }
    }

    return {
      minCols: 100,
      activeMs: 12000,
      init(g, st) {
        stage = st;
        W = g.cols; H = g.rows;
        layout();
      },
      update(dt, time) {
        const p = phaseState(time);
        const name = p ? p.name : null;
        if (name && name !== lastPhase) {
          lastPhase = name;
          stage.emit({ phase: name, agent: run.agent, id: run.id });
        }
      },
      draw(g, time) {
        const { m, yA, busTop, yB, ySrc, busBot, yC, userW, orchW, orchX, orchCx, vCx, vW, ansX, ansW, agentW } = L;
        const p = phaseState(time);
        const active = run ? run.agent : -1;
        const reached = (name) => p && p.index >= PHASES.findIndex((x) => x[0] === name);

        // Base wiring.
        g.hline(m + userW, orchX - 1, yA + 4, C.grout);
        g.vline(orchCx, yA + 9, busTop, C.grout);
        g.hline(L.agentCx(0), L.agentCx(2), busTop, C.grout);
        g.hline(Math.min(vCx, L.agentCx(0)), L.agentCx(2), busBot, C.grout);
        g.vline(vCx, busBot, yC - 1, C.grout);
        g.hline(m + vW, ansX - 1, yC + 7, C.grout);
        for (let k = 0; k < 3; k++) {
          const cx = L.agentCx(k);
          g.vline(cx, busTop, yB - 1, C.grout);
          g.vline(cx, yB + 9, ySrc - 1, C.grout);
          g.vline(cx, ySrc + 8, busBot, C.grout);
        }

        // Trace of the path taken so far.
        if (run) {
          const color = AGENTS[active].color;
          for (const [name] of PHASES) {
            if (!reached(name)) break;
            const path = pathFor(name, active);
            if (!path) continue;
            if (p.name === name) {
              const { points, end } = partialPath(path, p.f);
              drawPath(g, points, name === 'route' ? C.ink : color);
              g.rect(end[0] - 1, end[1] - 1, 3, 3, C.magenta);
            } else {
              drawPath(g, path, name === 'route' ? C.ink : color);
            }
          }
        }

        // User.
        g.stroke(m, yA, userW, 9, C.slate);
        g.text('USER', m + 3, yA + 2, C.ink);

        // Orchestrator.
        const thinking = p && p.name === 'think';
        g.stroke(orchX, yA, orchW, 9, thinking ? C.magenta : C.ink);
        if (thinking) g.stroke(orchX - 1, yA - 1, orchW + 2, 11, C.pink);
        g.text('ORCHESTRATOR', orchX + 3, yA + 2, C.ink);
        if (thinking) {
          const n = 1 + (Math.floor(time * 6) % 3);
          for (let k = 0; k < n; k++) g.set(orchX + 3 + k * 2, yA + 7, C.magenta);
        } else if (Math.floor(time * 2) % 2 === 0) {
          g.set(orchX + 3, yA + 7, C.slate);
        }

        // Domain agents and their sources.
        for (let k = 0; k < 3; k++) {
          const a = AGENTS[k];
          const x = L.agentX(k);
          const dim = run && k !== active;
          const color = dim ? C.grout : a.color;
          const working = !dim && p && p.name === 'query';
          g.stroke(x, yB, agentW, 9, color);
          if (!dim && run && reached('dispatch')) g.rect(x + 1, yB + 1, 2, 7, a.color);
          g.text(a.label, x + 4, yB + 2, dim ? C.grout : C.ink);
          if (working) {
            const span = agentW - 8;
            const pos = Math.floor(time * 24) % span;
            g.hline(x + 4 + pos, Math.min(x + 4 + pos + 4, x + agentW - 3), yB + 7, a.color);
          }
          glyph(g, a.glyph, L.agentCx(k), ySrc, working, color, time);
        }

        // Validator.
        const validating = p && p.name === 'validate';
        const validated = run && reached('answer');
        g.stroke(m, yC, vW, 14, validating || validated ? C.green : C.ink);
        g.text('VALIDATOR', m + 3, yC + 2, C.ink);
        g.text('KQL', m + 3, yC + 8, C.slate);
        if (validating || validated) {
          const tick = [[0, 2], [1, 3], [2, 4], [3, 3], [4, 2], [5, 1], [6, 0]];
          const upto = validated ? tick.length : Math.ceil(p.f * tick.length);
          for (let i = 0; i < upto; i++) g.rect(m + vW - 12 + tick[i][0], yC + 7 + tick[i][1], 1, 2, C.green);
        }

        // Answer with a chart of the returned values.
        g.stroke(ansX, yC, ansW, 14, validated ? C.ink : C.slate);
        g.text('ANSWER', ansX + 3, yC + 2, C.ink);
        if (run && validated && run.values && run.values.length) {
          const vals = run.values;
          const max = Math.max(...vals.map(Math.abs)) || 1;
          const grow = p.name === 'answer' ? p.f : 1;
          const bw = Math.max(2, Math.floor((ansW - 30) / vals.length) - 1);
          const baseX = ansX + ansW - 3 - vals.length * (bw + 1);
          const peak = vals.reduce((best, v, i) => (Math.abs(v) > Math.abs(vals[best]) ? i : best), 0);
          vals.forEach((v, i) => {
            const h = Math.max(1, Math.round((Math.abs(v) / max) * 10 * grow));
            g.rect(baseX + i * (bw + 1), yC + 12 - h, bw, h, i === peak ? C.magenta : AGENTS[active].color);
          });
        }
      },
      action(name, value, time) {
        if (name === 'run') {
          run = { agent: value.agent, values: value.values, id: value.id, start: time };
          lastPhase = null;
        }
        if (name === 'reset') { run = null; lastPhase = null; }
      }
    };
  }

  global.PixelScenes = {
    diffusion: diffusionScene,
    attention: attentionScene,
    lakehouse: lakehouseScene,
    services: servicesScene,
    stream: streamScene,
    agents: agentsScene
  };
})(window);
