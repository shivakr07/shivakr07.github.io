# Shiva Gautam — portfolio

A static, dependency-free portfolio. Every pixel scene is a small simulation rendered live on `<canvas>`.

## Run locally

```powershell
cd portfolio
python -m http.server 5507
```

Open http://127.0.0.1:5507. Opening `index.html` directly from disk also works.

## Write a blog post

Posts live in [`js/posts.js`](js/posts.js). Add an object to `window.BLOG_POSTS`:

```js
{
  slug: 'my-new-post',            // URL: blog.html?post=my-new-post
  category: 'ai',                 // 'ai' | 'data' | 'software'
  date: '2026-10-01',
  title: 'My new post',
  summary: 'One or two sentences shown on the cards.',
  body: `
Markdown goes here: ## headings, paragraphs, - lists, 1. lists, > quotes,
**bold**, *italic*, \`code\`, [links](https://example.com) and fenced code blocks.
`
}
```

Posts are sorted newest first; the homepage shows the latest six, and `blog.html` lists everything with category filters. Inside `body`, escape backticks as `` \` ``.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html`, `blog.html` | Pages |
| `styles.css` | Light and dark themes, layout |
| `js/engine.js` | Pixel grid renderer, theme palettes |
| `js/scenes.js` | Diffusion, attention, lakehouse, services, stream and agents scenes |
| `js/copilot.js` | Multi-agent demo scenarios (illustrative data) |
| `js/blog.js`, `js/posts.js` | Blog rendering and content |
| `assets/` | Photo, favicon and resumes |

## Deploy

It is plain static files, so any static host works — for example GitHub Pages (push the folder and enable Pages), Netlify or Vercel.
