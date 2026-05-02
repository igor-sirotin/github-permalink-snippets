import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token';
import type { CacheEntry } from './fetcher';

const PERMALINK_RE =
  /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/blob\/([0-9a-f]{7,40})\/([^#?\s]+?)(?:\?[^#\s]*)?(?:#L(\d+)(?:-L(\d+))?)?$/;

interface PermalinkInfo {
  owner: string;
  repo: string;
  sha: string;
  path: string;
  startLine?: string;
  endLine?: string;
  url: string;
}

export interface Fetcher {
  get(
    owner: string,
    repo: string,
    sha: string,
    path: string,
    tokenFingerprint: string
  ): CacheEntry;
}

export interface PluginOptions {
  fetcher: Fetcher;
  /** The fingerprint of the currently-resolved token (or empty string for
   *  unauthenticated). Included in cache keys so a sign-in invalidates
   *  previously-rejected entries automatically. */
  getTokenFingerprint: () => string;
}

const LANG_BY_EXT: Record<string, string> = {
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

function detectLanguage(path: string): string {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return LANG_BY_EXT[ext] || 'plaintext';
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parsePermalink(url: string): PermalinkInfo | null {
  const m = PERMALINK_RE.exec(url.trim());
  if (!m) return null;
  const [, owner, repo, sha, path, startLine, endLine] = m;
  return { owner, repo, sha, path, startLine, endLine, url };
}

function extractSoleUrl(children: Token[]): string | null {
  const meaningful = children.filter(
    (c) => !(c.type === 'text' && c.content.trim() === '')
  );

  if (
    meaningful.length === 3 &&
    meaningful[0].type === 'link_open' &&
    meaningful[1].type === 'text' &&
    meaningful[2].type === 'link_close'
  ) {
    const href = meaningful[0].attrGet('href');
    const text = meaningful[1].content;
    if (href && href === text) return href;
  }

  if (meaningful.length === 1 && meaningful[0].type === 'text') {
    const t = meaningful[0].content.trim();
    if (/^https:\/\/github\.com\//.test(t)) return t;
  }

  return null;
}

function renderHeader(info: PermalinkInfo, lineLabel: string): string {
  const filename = info.path.split('/').pop() || info.path;
  return (
    '<div class="gh-permalink-header">' +
    '<a href="' + escapeAttr(info.url) + '" class="gh-permalink-link">' +
    '<span class="gh-permalink-repo">' + escapeHtml(info.owner) + '/' + escapeHtml(info.repo) + '</span>' +
    '<span class="gh-permalink-sep"> · </span>' +
    '<span class="gh-permalink-path" title="' + escapeAttr(info.path) + '">' + escapeHtml(filename) + '</span>' +
    (lineLabel ? '<span class="gh-permalink-lines">' + escapeHtml(lineLabel) + '</span>' : '') +
    '</a>' +
    '</div>'
  );
}

function renderSnippet(info: PermalinkInfo, content: string): string {
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const startNum = info.startLine ? Math.max(1, parseInt(info.startLine, 10)) : 1;
  const endNum = info.endLine
    ? Math.min(lines.length, parseInt(info.endLine, 10))
    : info.startLine
      ? startNum
      : lines.length;
  const slice = lines.slice(startNum - 1, endNum);

  const lineLabel = endNum > startNum ? 'L' + startNum + '-L' + endNum : 'L' + startNum;
  const lang = detectLanguage(info.path);

  const rows = slice
    .map((line, i) => {
      const lineNum = startNum + i;
      const codeHtml = escapeHtml(line) || '&nbsp;';
      return (
        '<tr>' +
        '<td class="gh-ln" data-line="' + lineNum + '"></td>' +
        '<td class="gh-lc"><pre><code class="language-' + escapeHtml(lang) + '">' +
        codeHtml +
        '</code></pre></td>' +
        '</tr>'
      );
    })
    .join('');

  return (
    '<div class="gh-permalink-card">' +
    renderHeader(info, lineLabel) +
    '<table class="gh-permalink-code"><tbody>' + rows + '</tbody></table>' +
    '</div>\n'
  );
}

function renderLoading(info: PermalinkInfo): string {
  return (
    '<div class="gh-permalink-card gh-permalink-card-loading">' +
    renderHeader(info, '') +
    '<div class="gh-permalink-loading">Loading…</div>' +
    '</div>\n'
  );
}

function renderError(info: PermalinkInfo, message: string): string {
  return (
    '<div class="gh-permalink-card gh-permalink-card-error">' +
    renderHeader(info, '') +
    '<div class="gh-permalink-error">Failed to load: ' + escapeHtml(message) + '</div>' +
    '</div>\n'
  );
}

export function permalinksPlugin(md: MarkdownIt, options: PluginOptions): void {
  const fetcher = options.fetcher;
  const getTokenFingerprint = options.getTokenFingerprint;

  md.core.ruler.after('inline', 'github_permalinks', (state) => {
    const tokenFingerprint = getTokenFingerprint();
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type !== 'inline' || !tok.children) continue;

      const open = tokens[i - 1];
      const close = tokens[i + 1];
      if (
        !open ||
        !close ||
        open.type !== 'paragraph_open' ||
        close.type !== 'paragraph_close'
      ) {
        continue;
      }

      const url = extractSoleUrl(tok.children);
      if (!url) continue;

      const info = parsePermalink(url);
      if (!info) continue;

      const entry = fetcher.get(info.owner, info.repo, info.sha, info.path, tokenFingerprint);
      let html: string;
      if (entry.status === 'fulfilled' && typeof entry.content === 'string') {
        html = renderSnippet(info, entry.content);
      } else if (entry.status === 'rejected') {
        html = renderError(info, entry.error || 'unknown error');
      } else {
        html = renderLoading(info);
      }

      const placeholder = new state.Token('html_block', '', 0);
      placeholder.content = html;
      placeholder.block = true;

      tokens.splice(i - 1, 3, placeholder);
      i -= 1;
    }
  });
}
