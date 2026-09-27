/* Blog rendering: home-page listing with category filters, post index and post pages. */
(function () {
  'use strict';

  const POSTS = (window.BLOG_POSTS || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const CATS = window.BLOG_CATEGORIES || {};
  const esc = window.escapeHtml;

  const safeUrl = (u) => /^(https?:\/\/|mailto:|#|\.{0,2}\/|[\w-]+\.html)/i.test(u);
  const readMinutes = (md) => Math.max(1, Math.round(md.split(/\s+/).length / 220));
  const formatDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  function inline(src) {
    const codes = [];
    let s = src.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
      if (!safeUrl(url)) return text;
      const ext = /^https?:/i.test(url) ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${url}"${ext}>${text}</a>`;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
  }

  function markdown(src) {
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [];
    let list = null;
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^```\s*([\w+-]*)\s*$/);
      if (fence) {
        flushPara(); flushList();
        const lang = fence[1] || '';
        const body = [];
        while (++i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i]);
        out.push(`<pre class="code" data-lang="${esc(lang.toUpperCase())}"><code>${window.highlight(body.join('\n'), lang)}</code></pre>`);
        continue;
      }
      const heading = line.match(/^(#{1,3})\s+(.*)$/);
      if (heading) {
        flushPara(); flushList();
        const level = heading[1].length + 1;
        const id = heading[2].toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');
        out.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);
        continue;
      }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) { flushPara(); flushList(); out.push(`<blockquote><p>${inline(quote[1])}</p></blockquote>`); continue; }
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ul || ol) {
        flushPara();
        const tag = ul ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
        list.items.push((ul || ol)[1]);
        continue;
      }
      if (!line.trim()) { flushPara(); flushList(); continue; }
      if (list) flushList();
      para.push(line.trim());
    }
    flushPara(); flushList();
    return out.join('\n');
  }

  function card(p) {
    const cat = CATS[p.category] || { label: p.category };
    return `
      <li class="post-card reveal in" data-category="${esc(p.category)}">
        <a class="post-link" href="blog.html?post=${encodeURIComponent(p.slug)}">
          <p class="post-meta mono"><span class="cat-chip cat-${esc(p.category)}">${esc(cat.label)}</span>
            <span>${formatDate(p.date)} · ${readMinutes(p.body)} min read</span></p>
          <h3 class="post-title">${esc(p.title)}</h3>
          <p class="post-summary">${esc(p.summary)}</p>
          <span class="post-cta">Read post <span aria-hidden="true">→</span></span>
        </a>
      </li>`;
  }

  function filters(active, counts) {
    const all = [['all', 'All', POSTS.length]].concat(Object.keys(CATS).map((k) => [k, CATS[k].label, counts[k] || 0]));
    return all.map(([key, label, n]) => `
      <button type="button" class="filter" data-filter="${key}" aria-pressed="${key === active}">
        ${esc(label)} <span class="filter-count mono">${n}</span>
      </button>`).join('');
  }

  function mountListing(root, { limit, linkFilters } = {}) {
    const bar = root.querySelector('.filters');
    const grid = root.querySelector('.posts');
    const counts = POSTS.reduce((acc, p) => { acc[p.category] = (acc[p.category] || 0) + 1; return acc; }, {});
    const params = new URLSearchParams(location.search);
    let active = linkFilters && CATS[params.get('c')] ? params.get('c') : 'all';

    const render = () => {
      bar.innerHTML = filters(active, counts);
      const list = POSTS.filter((p) => active === 'all' || p.category === active);
      const shown = limit ? list.slice(0, limit) : list;
      grid.innerHTML = shown.length
        ? shown.map(card).join('')
        : `<li class="post-empty">Posts on ${esc(CATS[active].long.toLowerCase())} are on the way.</li>`;
    };
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('.filter');
      if (!b) return;
      active = b.dataset.filter;
      render();
      if (linkFilters) history.replaceState(null, '', active === 'all' ? 'blog.html' : `blog.html?c=${active}`);
      bar.querySelector(`[data-filter="${active}"]`).focus();
    });
    render();
  }

  function mountPost(root, post) {
    const cat = CATS[post.category] || { label: post.category };
    document.title = `${post.title} · Shiva Gautam`;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', post.summary);
    const related = POSTS.filter((p) => p.slug !== post.slug).slice(0, 2);
    root.innerHTML = `
      <article class="article" aria-labelledby="post-title">
        <a class="back-link mono" href="blog.html">← All writing</a>
        <p class="post-meta mono"><a class="cat-chip cat-${esc(post.category)}" href="blog.html?c=${esc(post.category)}">${esc(cat.label)}</a>
          <span>${formatDate(post.date)} · ${readMinutes(post.body)} min read</span></p>
        <h1 id="post-title" class="article-title">${esc(post.title)}</h1>
        <p class="article-lede">${esc(post.summary)}</p>
        <div class="prose">${markdown(post.body)}</div>
        <footer class="article-foot">
          <p>Written by <strong>Shiva Gautam</strong> — software engineer working across data platforms, applied AI and backend systems.</p>
          <p><a href="index.html#contact">Get in touch</a> · <a href="https://www.linkedin.com/in/shivakumar07/" target="_blank" rel="noopener">LinkedIn</a></p>
        </footer>
      </article>
      ${related.length ? `<section class="related" aria-labelledby="related-title"><h2 id="related-title" class="h4 sub-head">Keep reading</h2><ul class="posts">${related.map(card).join('')}</ul></section>` : ''}`;
  }

  const home = document.getElementById('writing');
  if (home) mountListing(home, { limit: 6 });

  const page = document.getElementById('blog-root');
  if (page) {
    const slug = new URLSearchParams(location.search).get('post');
    const post = slug && POSTS.find((p) => p.slug === slug);
    if (post) mountPost(page, post);
    else {
      page.innerHTML = `
        <header class="section-head">
          <p class="kicker">Writing</p>
          <h1 class="h2">Notes on AI, data and software.</h1>
          <p class="section-lede">Explanations and lessons from building data platforms, AI systems and backends.</p>
        </header>
        ${slug ? '<p class="post-empty">That post could not be found. Here is everything else.</p>' : ''}
        <div class="filters" role="group" aria-label="Filter posts by category"></div>
        <ul class="posts posts--list"></ul>`;
      mountListing(page, { linkFilters: true });
    }
  }
})();
