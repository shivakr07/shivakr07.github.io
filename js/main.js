(function () {
  'use strict';

  const { mount, setTheme } = window.Pixel;
  const scenes = window.PixelScenes;
  const stages = {};
  window.__stages = stages;

  const root = document.documentElement;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const toggleTheme = document.querySelector('.theme-toggle');
  function applyTheme(theme, persist) {
    root.setAttribute('data-theme', theme);
    setTheme(theme);
    if (themeColor) themeColor.setAttribute('content', theme === 'dark' ? '#0f1117' : '#f4f1ea');
    if (toggleTheme) {
      toggleTheme.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      toggleTheme.setAttribute('aria-pressed', String(theme === 'dark'));
    }
    if (persist) { try { localStorage.setItem('theme', theme); } catch (e) { /* storage unavailable */ } }
  }
  applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light', false);
  if (toggleTheme) {
    toggleTheme.addEventListener('click', () => applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true));
  }

  document.querySelectorAll('canvas[data-scene]').forEach((canvas) => {
    const factory = scenes[canvas.dataset.scene];
    if (!factory) return;
    const scene = factory({ seed: Number(canvas.dataset.seed) || undefined });
    const stage = mount(canvas, scene, {
      cell: Number(canvas.dataset.cell) || 8,
      gap: canvas.dataset.gap == null ? 1 : Number(canvas.dataset.gap),
      fps: Number(canvas.dataset.fps) || 15
    });
    if (canvas.id) stages[canvas.id] = stage;
  });

  const text = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  // Hero diffusion: live timestep readout and scrubber.
  const slider = document.getElementById('diffusion-t');
  let scrubbing = false;
  if (stages['scene-diffusion']) {
    stages['scene-diffusion'].onStatus(({ t, step, signal }) => {
      text('diffusion-step', String(step).padStart(4, '0'));
      text('diffusion-signal', Math.round(signal * 100) + '%');
      if (slider && !scrubbing) slider.value = String(Math.round(t * 1000));
    });
  }
  if (slider) {
    const apply = () => stages['scene-diffusion'] && stages['scene-diffusion'].action('setT', Number(slider.value) / 1000);
    slider.addEventListener('input', () => { scrubbing = true; apply(); });
    slider.addEventListener('change', () => { scrubbing = false; });
    slider.addEventListener('pointerup', () => { scrubbing = false; });
  }

  if (stages['scene-attention']) {
    stages['scene-attention'].onStatus(({ head, name, count }) => {
      text('attention-head', `Head ${head + 1} of ${count}`);
      text('attention-name', name);
    });
  }
  if (stages['scene-lakehouse']) {
    stages['scene-lakehouse'].onStatus(({ version, quarantined }) => {
      text('lake-version', `v${version}`);
      text('lake-quarantine', String(quarantined));
    });
  }
  if (stages['scene-services']) {
    stages['scene-services'].onStatus(({ rps, rejected, hitRate }) => {
      text('svc-rps', String(rps));
      text('svc-429', String(rejected));
      text('svc-hit', `${hitRate}%`);
    });
  }

  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const stage = stages[button.dataset.target];
      if (stage) stage.action(button.dataset.action, button.dataset.value);
    });
  });

  // Mobile navigation.
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.getElementById('nav-menu');
  if (toggle && menu) {
    const close = () => { toggle.setAttribute('aria-expanded', 'false'); menu.classList.remove('open'); };
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      menu.classList.toggle('open', !open);
    });
    menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  // Header state and active section highlighting.
  const header = document.querySelector('.site-header');
  const onScroll = () => header && header.classList.toggle('scrolled', window.scrollY > 12);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const links = Array.from(document.querySelectorAll('.nav-links a[href^="#"]'));
  const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id));
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => spy.observe(s));
  }

  // Reveal-on-scroll, skipped entirely for reduced motion.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveal = document.querySelectorAll('.reveal');
  if (!reduce && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('js-reveal');
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    reveal.forEach((el) => io.observe(el));
  }

  text('year', String(new Date().getFullYear()));
})();
