(function () {
  'use strict';

  const cache = new Map();

  const LANG_BY_EXT = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    nim: 'nim', java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
    cs: 'csharp', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash',
    md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
    html: 'html', htm: 'html', css: 'css', scss: 'scss',
    sql: 'sql', toml: 'toml', xml: 'xml',
  };

  function detectLanguage(path) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    return LANG_BY_EXT[ext] || 'plaintext';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function rawUrl(owner, repo, sha, path) {
    return (
      'https://raw.githubusercontent.com/' +
      encodeURIComponent(owner) + '/' +
      encodeURIComponent(repo) + '/' +
      encodeURIComponent(sha) + '/' +
      path.split('/').map(encodeURIComponent).join('/')
    );
  }

  function fetchRaw(owner, repo, sha, path) {
    const key = owner + '/' + repo + '/' + sha + '/' + path;
    if (cache.has(key)) return cache.get(key);
    const url = rawUrl(owner, repo, sha, path);
    const promise = fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
    cache.set(key, promise);
    return promise;
  }

  function renderCard(el, info, slice, start, end) {
    const filename = info.path.split('/').pop();
    const lineRange = end > start ? 'L' + start + '-L' + end : 'L' + start;
    const lang = detectLanguage(info.path);

    const rows = slice
      .map(function (line, i) {
        const lineNum = start + i;
        const codeHtml = escapeHtml(line) || '&nbsp;';
        return (
          '<tr>' +
          '<td class="gh-ln" data-line="' + lineNum + '"></td>' +
          '<td class="gh-lc"><pre><code class="language-' +
          escapeHtml(lang) +
          '">' +
          codeHtml +
          '</code></pre></td>' +
          '</tr>'
        );
      })
      .join('');

    el.innerHTML =
      '<div class="gh-permalink-card">' +
      '<div class="gh-permalink-header">' +
      '<a href="' + escapeHtml(info.url) + '" class="gh-permalink-link">' +
      '<span class="gh-permalink-repo">' + escapeHtml(info.owner) + '/' + escapeHtml(info.repo) + '</span>' +
      '<span class="gh-permalink-sep"> · </span>' +
      '<span class="gh-permalink-path" title="' + escapeHtml(info.path) + '">' + escapeHtml(filename) + '</span>' +
      '<span class="gh-permalink-lines">' + escapeHtml(lineRange) + '</span>' +
      '</a>' +
      '</div>' +
      '<table class="gh-permalink-code"><tbody>' + rows + '</tbody></table>' +
      '</div>';
  }

  function renderError(el, info, message) {
    el.innerHTML =
      '<div class="gh-permalink-card gh-permalink-card-error">' +
      '<div class="gh-permalink-error">' +
      'Failed to load <a href="' + escapeHtml(info.url) + '">' + escapeHtml(info.url) + '</a>: ' +
      escapeHtml(message) +
      '</div>' +
      '</div>';
  }

  function renderLoading(el, info) {
    el.innerHTML =
      '<div class="gh-permalink-card gh-permalink-card-loading">' +
      '<div class="gh-permalink-loading">' +
      'Loading <code>' + escapeHtml(info.path) + '</code>…' +
      '</div>' +
      '</div>';
  }

  function readInfo(el) {
    return {
      owner: el.dataset.owner || '',
      repo: el.dataset.repo || '',
      sha: el.dataset.sha || '',
      path: el.dataset.path || '',
      url: el.dataset.url || '',
      startLine: el.dataset.startLine ? parseInt(el.dataset.startLine, 10) : null,
      endLine: el.dataset.endLine ? parseInt(el.dataset.endLine, 10) : null,
    };
  }

  function renderEmbed(el) {
    const info = readInfo(el);
    if (!info.owner || !info.repo || !info.sha || !info.path) return;

    renderLoading(el, info);

    fetchRaw(info.owner, info.repo, info.sha, info.path)
      .then(function (text) {
        const lines = text.split('\n');
        // Trim a trailing empty line that comes from a final newline in the file.
        if (lines.length > 0 && lines[lines.length - 1] === '') {
          lines.pop();
        }
        const start = info.startLine ? Math.max(1, info.startLine) : 1;
        const end = info.endLine
          ? Math.min(lines.length, info.endLine)
          : info.startLine
            ? start
            : lines.length;
        const slice = lines.slice(start - 1, end);
        renderCard(el, info, slice, start, end);
      })
      .catch(function (err) {
        renderError(el, info, err && err.message ? err.message : String(err));
      });
  }

  function renderAll(root) {
    const nodes = root.querySelectorAll
      ? root.querySelectorAll('.gh-permalink-embed')
      : [];
    nodes.forEach(function (el) {
      if (el.dataset.ghRendered === '1') return;
      el.dataset.ghRendered = '1';
      renderEmbed(el);
    });
  }

  function init() {
    renderAll(document);

    // VS Code's markdown preview re-renders on edits; watch for new placeholders.
    const observer = new MutationObserver(function (muts) {
      for (let i = 0; i < muts.length; i++) {
        const m = muts[i];
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.classList && n.classList.contains('gh-permalink-embed')) {
            if (n.dataset.ghRendered !== '1') {
              n.dataset.ghRendered = '1';
              renderEmbed(n);
            }
          } else {
            renderAll(n);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
