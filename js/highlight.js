/* Minimal, escape-first syntax highlighter for KQL, SQL, DAX, Python, JS and C#. */
(function (global) {
  'use strict';

  const words = (s) => new Set(s.split(/\s+/).filter(Boolean));
  const KEYWORDS = {
    kql: words('where summarize by project extend order sort top take limit join on kind union let as and or not in between has contains startswith endswith desc asc evaluate pivot render count distinct mv-expand parse datatable range with'),
    sql: words('select from where group by order having join inner left right full outer on as and or not in is null limit desc asc case when then else end with union all distinct insert into values update set delete create table view merge using matched over partition'),
    dax: words('evaluate define measure var return order by asc desc true false'),
    python: words('def return if elif else for while in not and or import from as class with try except finally raise yield lambda none true false is pass break continue'),
    js: words('const let var function return if else for while of in new class extends import from export default async await try catch finally throw typeof null undefined true false this'),
    csharp: words('public private protected internal class record struct interface void var return if else for foreach in while new using namespace async await static readonly const bool int long double string true false null this')
  };
  const COMMENTS = { kql: '\\/\\/[^\\n]*', sql: '--[^\\n]*', dax: '--[^\\n]*|\\/\\/[^\\n]*', python: '#[^\\n]*' };

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function highlight(code, lang) {
    const key = (lang || '').toLowerCase();
    const kw = KEYWORDS[key] || new Set();
    const caseInsensitive = key === 'sql' || key === 'dax';
    const comment = COMMENTS[key] || '\\/\\/[^\\n]*';
    const re = new RegExp(
      `(${comment})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|(\\b\\d+(?:\\.\\d+)?(?:e\\d+|[a-z]{1,2})?\\b)|([A-Za-z_][\\w-]*)|(\\||==|!=|>=|<=|=>)`,
      'g'
    );
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const [tok, cmt, str, num, word, op] = m;
      if (cmt) out += `<span class="tok-c">${esc(tok)}</span>`;
      else if (str) out += `<span class="tok-s">${esc(tok)}</span>`;
      else if (num) out += `<span class="tok-n">${esc(tok)}</span>`;
      else if (word) {
        const probe = caseInsensitive ? word.toLowerCase() : word;
        if (kw.has(probe)) out += `<span class="tok-k">${esc(word)}</span>`;
        else if (/^\s*\(/.test(code.slice(re.lastIndex))) out += `<span class="tok-f">${esc(word)}</span>`;
        else out += esc(word);
      } else if (op) out += `<span class="tok-o">${esc(tok)}</span>`;
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }

  global.highlight = highlight;
  global.escapeHtml = esc;
})(window);
