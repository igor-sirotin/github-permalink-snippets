import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token';
import type StateCore from 'markdown-it/lib/rules_core/state_core';
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

function isLineBreak(tok: Token | undefined): boolean {
  if (!tok) return false;
  return tok.type === 'softbreak' || tok.type === 'hardbreak';
}

function isWhitespaceText(tok: Token | undefined): boolean {
  return !!tok && tok.type === 'text' && tok.content.trim() === '';
}

// Linkify can greedily include trailing sentence-punctuation in a URL when
// text follows immediately (`…#L26: caption` → href ends in `:`). Strip it
// before regex-matching so those URLs still register as permalinks.
const TRAILING_PUNCT_RE = /[.,;:!?)\]}>]+$/;

/**
 * Try to recognise a linkified GitHub permalink at `children[j]` — i.e.
 * the [link_open, text(url), link_close] triple that markdown-it's linkify
 * pass produces for a bare URL whose link text equals its href. Returns
 * the parsed permalink info on a hit.
 */
function tryMatchPermalinkAt(children: Token[], j: number): PermalinkInfo | null {
  if (j + 2 >= children.length) return null;
  const a = children[j];
  const b = children[j + 1];
  const c = children[j + 2];
  if (a.type !== 'link_open' || b.type !== 'text' || c.type !== 'link_close') {
    return null;
  }
  const href = a.attrGet('href');
  if (!href || href !== b.content) return null;
  return parsePermalink(href.replace(TRAILING_PUNCT_RE, ''));
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

/**
 * What sat immediately before the URL in the source — picked by walking
 * the inline children backward, skipping whitespace text. Used to tune
 * the gap between the prefix paragraph and the snippet card so an
 * `text: URL` / `text URL` line feels visually attached, while a
 * blank-line-separated permalink keeps its full block spacing.
 *
 * `snippet` is special: the card immediately follows another card we
 * emitted (no paragraph in between). VS Code's preview injects line-
 * tracking divs between block elements, so a CSS `+` adjacent-sibling
 * selector won't catch this case — we need an explicit class on the
 * second card.
 */
type PrevSep = 'paragraph' | 'softbreak' | 'inline';
type CardSep = PrevSep | 'snippet';

function classifyPrev(
  children: Token[],
  cursor: number,
  matchIdx: number
): PrevSep {
  let k = matchIdx - 1;
  while (k >= cursor && isWhitespaceText(children[k])) k--;
  if (k < cursor) return 'paragraph';
  if (isLineBreak(children[k])) return 'softbreak';
  return 'inline';
}

function cardClass(prevSep: CardSep, extra = ''): string {
  let mod = '';
  if (prevSep === 'inline') mod = ' gh-permalink-card-tight';
  else if (prevSep === 'snippet') mod = ' gh-permalink-card-follows-snippet';
  return 'gh-permalink-card' + mod + (extra ? ' ' + extra : '');
}

function buildFenceSnippet(
  info: PermalinkInfo,
  content: string,
  prevSep: CardSep
): FenceSnippet {
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
    '<div class="' + cardClass(prevSep) + '">' +
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

function renderLoading(info: PermalinkInfo, prevSep: CardSep): string {
  return (
    '<div class="' + cardClass(prevSep, 'gh-permalink-card-loading') + '">' +
    renderHeader(info, '') +
    '<div class="gh-permalink-loading">Loading…</div>' +
    '</div>\n'
  );
}

function renderError(
  info: PermalinkInfo,
  message: string,
  prevSep: CardSep
): string {
  return (
    '<div class="' + cardClass(prevSep, 'gh-permalink-card-error') + '">' +
    renderHeader(info, '') +
    '<div class="gh-permalink-error">Failed to load: ' + escapeHtml(message) + '</div>' +
    '</div>\n'
  );
}

/**
 * Build the token sequence that replaces a recognised permalink — fenced
 * snippet on cache hit, single html_block placeholder otherwise.
 */
function buildSnippetTokens(
  state: StateCore,
  info: PermalinkInfo,
  entry: CacheEntry,
  level: number,
  prevSep: CardSep
): Token[] {
  if (entry.status === 'fulfilled' && typeof entry.content === 'string') {
    const snippet = buildFenceSnippet(info, entry.content, prevSep);

    const open = new state.Token('html_block', '', 0);
    open.content = snippet.openHtml;
    open.block = true;
    open.level = level;

    const fence = new state.Token('fence', 'code', 0);
    fence.info = snippet.fenceInfo;
    fence.content = snippet.fenceContent;
    fence.markup = '```';
    fence.block = true;
    fence.level = level;

    const close = new state.Token('html_block', '', 0);
    close.content = snippet.closeHtml;
    close.block = true;
    close.level = level;

    return [open, fence, close];
  }

  const html =
    entry.status === 'rejected'
      ? renderError(info, entry.error || 'unknown error', prevSep)
      : renderLoading(info, prevSep);

  const placeholder = new state.Token('html_block', '', 0);
  placeholder.content = html;
  placeholder.block = true;
  placeholder.level = level;
  return [placeholder];
}

/**
 * Wrap a slice of the original inline token's children in a fresh
 * paragraph_open / inline / paragraph_close triple. Trims leading and
 * trailing softbreak/hardbreak tokens (those acted as the line separators
 * to the permalink, not as content of the surrounding prose). Returns an
 * empty array if the segment has no real content.
 */
function emitInlineParagraph(
  state: StateCore,
  segment: Token[],
  level: number
): Token[] {
  let start = 0;
  let end = segment.length;
  while (start < end && isLineBreak(segment[start])) start++;
  while (end > start && isLineBreak(segment[end - 1])) end--;
  if (start >= end) return [];

  // If everything left is whitespace-only text, drop it too.
  const trimmed = segment.slice(start, end);
  const allWhitespace = trimmed.every(
    (t) => t.type === 'text' && t.content.trim() === ''
  );
  if (allWhitespace) return [];

  const popen = new state.Token('paragraph_open', 'p', 1);
  popen.block = true;
  popen.level = level;

  const inlineTok = new state.Token('inline', '', 0);
  inlineTok.children = trimmed;
  inlineTok.level = level + 1;

  const pclose = new state.Token('paragraph_close', 'p', -1);
  pclose.block = true;
  pclose.level = level;

  return [popen, inlineTok, pclose];
}

export function permalinksPlugin(md: MarkdownIt, options: PluginOptions): void {
  const fetcher = options.fetcher;
  const getTokenFingerprint = options.getTokenFingerprint;

  // Run AFTER the core `linkify` rule so bare URLs are guaranteed to be
  // tokenised as link_open/text/link_close triples with their `href`
  // populated — regardless of whether the running markdown-it version
  // performs linkification during inline parsing or only in the core rule.
  md.core.ruler.after('linkify', 'github_permalinks', (state) => {
    const tokenFingerprint = getTokenFingerprint();
    const tokens = state.tokens;
    // Track tokens we've emitted as a snippet card's closer; checking
    // this set against the token preceding a subsequent paragraph_open
    // tells us whether two cards are stacked back-to-back.
    const ourCloseTokens = new WeakSet<Token>();

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type !== 'inline' || !tok.children) continue;

      const popen = tokens[i - 1];
      const pclose = tokens[i + 1];
      if (
        !popen ||
        !pclose ||
        popen.type !== 'paragraph_open' ||
        pclose.type !== 'paragraph_close'
      ) {
        continue;
      }

      const children = tok.children;
      const matches: { idx: number; info: PermalinkInfo }[] = [];

      // Find every permalink that sits on its own line — i.e. preceded
      // and followed by a softbreak/hardbreak (or by the paragraph
      // boundary itself). Multiple permalinks per paragraph are allowed.
      for (let j = 0; j < children.length; j++) {
        const info = tryMatchPermalinkAt(children, j);
        if (!info) continue;

        // Match every linkified permalink, regardless of what surrounds it
        // in the source. A `text: URL`-style line still becomes a snippet —
        // the prefix gets emitted as its own paragraph, the snippet card
        // follows, and any trailing prose becomes a third paragraph.
        // Markdown links with custom text (`[label](url)`) are filtered out
        // by `tryMatchPermalinkAt` because the link's text != href.
        matches.push({ idx: j, info });
        j += 2; // skip past the link_open/text/link_close triple we matched
      }

      if (matches.length === 0) continue;

      const level = popen.level;
      const replacement: Token[] = [];
      let cursor = 0;

      // Across-paragraph check: if the block-level token immediately
      // preceding popen is a closer we emitted for a previous card, then
      // the first card from THIS paragraph is stacking on top of that
      // earlier card with no prose paragraph between them.
      const tokenBeforePopen = tokens[i - 2];
      let priorWasCard =
        !!tokenBeforePopen && ourCloseTokens.has(tokenBeforePopen);

      for (const m of matches) {
        const prevSep = classifyPrev(children, cursor, m.idx);

        // Pre-segment ends at the line break immediately before the link
        // (if any) — that break was the line separator, not content. Walk
        // back over any whitespace-only text noise between the break and
        // the link.
        let segEnd = m.idx;
        while (segEnd > cursor && isWhitespaceText(children[segEnd - 1])) segEnd--;
        if (segEnd > cursor && isLineBreak(children[segEnd - 1])) segEnd--;

        const beforeTokens = emitInlineParagraph(
          state,
          children.slice(cursor, segEnd),
          level
        );
        // When the URL was on the same source line as its prefix
        // (`text: URL`), tag the prefix paragraph so CSS can shrink the
        // gap between it and the snippet card that follows.
        if (beforeTokens.length > 0 && prevSep === 'inline') {
          beforeTokens[0].attrJoin('class', 'gh-permalink-prefix-tight');
        }
        if (beforeTokens.length > 0) {
          // A real paragraph just landed between the previous card and
          // the next one, so the next card isn't card-on-card.
          priorWasCard = false;
        }
        replacement.push(...beforeTokens);

        const cardSep: CardSep = priorWasCard ? 'snippet' : prevSep;

        const entry = fetcher.get(
          m.info.owner,
          m.info.repo,
          m.info.sha,
          m.info.path,
          tokenFingerprint
        );
        const cardTokens = buildSnippetTokens(state, m.info, entry, level, cardSep);
        // The closing html_block is always the last token in the sequence
        // (whether it's the [open, fence, close] triple for a fulfilled
        // snippet or the single placeholder for pending/rejected).
        ourCloseTokens.add(cardTokens[cardTokens.length - 1]);
        replacement.push(...cardTokens);
        priorWasCard = true;

        // Advance past the link triple, then past any whitespace-only text
        // and the trailing line break that followed it.
        cursor = m.idx + 3;
        while (cursor < children.length && isWhitespaceText(children[cursor])) cursor++;
        if (cursor < children.length && isLineBreak(children[cursor])) cursor++;
      }

      // Whatever's left of the original inline becomes a trailing paragraph.
      if (cursor < children.length) {
        replacement.push(
          ...emitInlineParagraph(state, children.slice(cursor), level)
        );
      }

      tokens.splice(i - 1, 3, ...replacement);
      // Skip the loop ahead past the inserted tokens so we don't re-scan
      // any new `inline` tokens we just emitted (they have no permalinks
      // by construction, but skipping is cheaper than re-scanning).
      i = i - 1 + replacement.length - 1;
    }
  });
}
