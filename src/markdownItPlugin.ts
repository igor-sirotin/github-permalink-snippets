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

/**
 * Compute the line slice + the open/close HTML that wraps a real `fence`
 * token. We emit three tokens (html_block, fence, html_block) so the
 * markdown-it `renderer.rules.fence` runs on our content — the same path
 * any organic fenced code block in the preview takes — preserving theme,
 * `<pre><code class="language-X">` structure, and any other fence-hooking
 * preview plugins.
 */
interface FenceSnippet {
  openHtml: string;
  closeHtml: string;
  fenceContent: string;
  fenceInfo: string;
}

function buildFenceSnippet(info: PermalinkInfo, content: string): FenceSnippet {
  const allLines = content.split('\n');
  if (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();

  const startNum = info.startLine ? Math.max(1, parseInt(info.startLine, 10)) : 1;
  const endNum = info.endLine
    ? Math.min(allLines.length, parseInt(info.endLine, 10))
    : info.startLine
      ? startNum
      : allLines.length;
  const slice = allLines.slice(startNum - 1, endNum);

  const lang = detectLanguage(info.path);
  const lineLabel = endNum > startNum ? 'L' + startNum + '-L' + endNum : 'L' + startNum;

  // Gutter content: line numbers separated by newlines. white-space:pre in
  // CSS keeps each on its own row, aligning with the code's lines as long
  // as the gutter and code share font-size + line-height.
  const gutterContent = slice
    .map((_, i) => String(startNum + i))
    .join('\n');

  const openHtml =
    '<div class="gh-permalink-card">' +
    renderHeader(info, lineLabel) +
    '<div class="gh-permalink-body">' +
    '<div class="gh-permalink-gutter" aria-hidden="true">' +
    escapeHtml(gutterContent) +
    '</div>' +
    '<div class="gh-permalink-code-host">';

  const closeHtml = '</div></div></div>\n';

  // No trailing newline: a `<pre>` would render the trailing \n as an extra
  // blank visual line, misaligning with the gutter (which is also \n-joined
  // without a trailing \n).
  const fenceContent = slice.join('\n');

  return { openHtml, closeHtml, fenceContent, fenceInfo: lang };
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

      if (entry.status === 'fulfilled' && typeof entry.content === 'string') {
        const snippet = buildFenceSnippet(info, entry.content);

        const openToken = new state.Token('html_block', '', 0);
        openToken.content = snippet.openHtml;
        openToken.block = true;

        const fenceToken = new state.Token('fence', 'code', 0);
        fenceToken.info = snippet.fenceInfo;
        fenceToken.content = snippet.fenceContent;
        fenceToken.markup = '```';
        fenceToken.block = true;

        const closeToken = new state.Token('html_block', '', 0);
        closeToken.content = snippet.closeHtml;
        closeToken.block = true;

        tokens.splice(i - 1, 3, openToken, fenceToken, closeToken);
        // The three replacement tokens (html_block, fence, html_block) are
        // none of them inline paragraph content, so the loop's type check
        // skips them on subsequent iterations — no index adjustment needed.
        continue;
      }

      const html =
        entry.status === 'rejected'
          ? renderError(info, entry.error || 'unknown error')
          : renderLoading(info);

      const placeholder = new state.Token('html_block', '', 0);
      placeholder.content = html;
      placeholder.block = true;

      tokens.splice(i - 1, 3, placeholder);
      i -= 1;
    }
  });
}
