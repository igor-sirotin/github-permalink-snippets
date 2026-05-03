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
 * Computed slice + open/close HTML that brackets a real `fence` token.
 * Emitting an actual fence (rather than rendering the snippet ourselves)
 * means the preview's `renderer.rules.fence` runs on our content — the
 * same path any organic fenced code block takes — preserving theme,
 * `<pre><code class="language-X">` structure, and any other fence-hooking
 * preview plugins.
 */
interface FenceSnippet {
  outerClass: string;
  openHtml: string;
  closeHtml: string;
  fenceContent: string;
  fenceInfo: string;
}

/**
 * Whether this card stacks immediately on top of another card we just
 * emitted (no paragraph between them). When true, the card gets the
 * `-follows-snippet` class so the inter-card collapse lands at 8px
 * instead of the default 16px. The previous card's open token is
 * separately tagged with `-precedes-snippet` so both halves of the
 * collapse are reduced.
 */
function cardClass(followsSnippet: boolean, extra = ''): string {
  const mod = followsSnippet ? ' gh-permalink-card-follows-snippet' : '';
  return 'gh-permalink-card' + mod + (extra ? ' ' + extra : '');
}

function buildFenceSnippet(
  info: PermalinkInfo,
  content: string,
  followsSnippet: boolean
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

  // The outer `<div>` is intentionally bare here. The token's `class` attr
  // (set by the caller) plus VS Code's source-map attrs are spliced in by
  // the renderer, producing a single merged `class=` attribute.
  const openHtml =
    '<div>' +
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

  return {
    outerClass: cardClass(followsSnippet),
    openHtml,
    closeHtml,
    fenceContent,
    fenceInfo: lang,
  };
}

interface PlaceholderHtml {
  outerClass: string;
  html: string;
}

function renderLoading(info: PermalinkInfo, followsSnippet: boolean): PlaceholderHtml {
  return {
    outerClass: cardClass(followsSnippet, 'gh-permalink-card-loading'),
    html:
      '<div>' +
      renderHeader(info, '') +
      '<div class="gh-permalink-loading">Loading…</div>' +
      '</div>\n',
  };
}

function renderError(
  info: PermalinkInfo,
  message: string,
  followsSnippet: boolean
): PlaceholderHtml {
  return {
    outerClass: cardClass(followsSnippet, 'gh-permalink-card-error'),
    html:
      '<div>' +
      renderHeader(info, '') +
      '<div class="gh-permalink-error">Failed to load: ' + escapeHtml(message) + '</div>' +
      '</div>\n',
  };
}

/**
 * Custom block token type for snippet card chunks. We deliberately avoid
 * `html_block` here: VS Code's preview installs a `pluginSourceMap` that
 * *wraps* the existing `html_block` renderer with an empty `<div></div>`
 * marker (so scroll-sync attrs can hang somewhere — markdown-it's normal
 * attr rendering can't reach into raw HTML content). That wrapper is
 * applied *after* `extendMarkdownIt` runs, so we can't unwrap it from
 * here. Our own token type isn't touched by VS Code's renderer rules,
 * so we own the rendering completely and bake the scroll-sync attrs
 * directly into our card's outer `<div>` instead.
 */
const PERMALINK_TOKEN_TYPE = 'gh_permalink_html';

/**
 * Build the token sequence that replaces a recognised permalink — fenced
 * snippet on cache hit, single placeholder otherwise.
 *
 * Only the *opening* token carries `.map` — that's the one whose attrs
 * get baked into the card's outer `<div>` as the scroll-sync anchor.
 * The card's own class is set via `attrJoin` so it merges with VS Code's
 * later-added `code-line`/`dir`/`data-line` attrs into a single attribute
 * (rather than emitting two `class=` attributes that browsers dedupe by
 * keeping only the first).
 */
function buildSnippetTokens(
  state: StateCore,
  info: PermalinkInfo,
  entry: CacheEntry,
  level: number,
  followsSnippet: boolean,
  sourceMap: [number, number] | null
): Token[] {
  if (entry.status === 'fulfilled' && typeof entry.content === 'string') {
    const snippet = buildFenceSnippet(info, entry.content, followsSnippet);

    const open = new state.Token(PERMALINK_TOKEN_TYPE, '', 0);
    open.content = snippet.openHtml;
    open.block = true;
    open.level = level;
    open.map = sourceMap;
    open.attrJoin('class', snippet.outerClass);

    const fence = new state.Token('fence', 'code', 0);
    fence.info = snippet.fenceInfo;
    fence.content = snippet.fenceContent;
    fence.markup = '```';
    fence.block = true;
    fence.level = level;
    // No `.map` — the open token already carries the source-line anchor;
    // a second one on the fence triggers VS Code's source-map plugin to
    // add a redundant `code-line` class that shows as a visible row.

    const close = new state.Token(PERMALINK_TOKEN_TYPE, '', 0);
    close.content = snippet.closeHtml;
    close.block = true;
    close.level = level;
    // No `.map` — only the open carries the scroll-sync anchor.

    return [open, fence, close];
  }

  const placeholder = new state.Token(PERMALINK_TOKEN_TYPE, '', 0);
  placeholder.block = true;
  placeholder.level = level;
  placeholder.map = sourceMap;

  const rendered =
    entry.status === 'rejected'
      ? renderError(info, entry.error || 'unknown error', followsSnippet)
      : renderLoading(info, followsSnippet);
  placeholder.content = rendered.html;
  placeholder.attrJoin('class', rendered.outerClass);

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
  level: number,
  sourceMap: [number, number] | null
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
  popen.map = sourceMap;

  const inlineTok = new state.Token('inline', '', 0);
  inlineTok.children = trimmed;
  inlineTok.level = level + 1;
  inlineTok.map = sourceMap;

  const pclose = new state.Token('paragraph_close', 'p', -1);
  pclose.block = true;
  pclose.level = level;
  pclose.map = sourceMap;

  return [popen, inlineTok, pclose];
}

export function permalinksPlugin(md: MarkdownIt, options: PluginOptions): void {
  const fetcher = options.fetcher;
  const getTokenFingerprint = options.getTokenFingerprint;

  // Renderer for our custom snippet-card token type. VS Code's
  // `source_map_data_attribute` core rule joins `code-line` (and adds
  // `dir`/`data-line`) onto any block token with `.map` — it doesn't
  // care about token `type`, only its map. We splice the merged attrs
  // into the first bare `<div>` of our content so the card's own outer
  // element becomes the scroll-sync anchor (no empty wrapper, unlike
  // `html_block` which gets wrapped by VS Code's source-map override).
  // Tokens without attrs (the close half) emit their content as-is.
  md.renderer.rules[PERMALINK_TOKEN_TYPE] = (tokens, idx, _opts, _env, self) => {
    const tok = tokens[idx];
    const attrs = self.renderAttrs(tok);
    if (attrs) {
      return tok.content.replace(/^<div>/, `<div ${attrs}>`);
    }
    return tok.content;
  };

  // Run AFTER the core `linkify` rule so bare URLs are guaranteed to be
  // tokenised as link_open/text/link_close triples with their `href`
  // populated — regardless of whether the running markdown-it version
  // performs linkification during inline parsing or only in the core rule.
  md.core.ruler.after('linkify', 'github_permalinks', (state) => {
    const tokenFingerprint = getTokenFingerprint();
    const tokens = state.tokens;
    // Map each card's close token to its open token so when a later
    // paragraph emits another card directly after, we can both detect
    // the stack (close exists in this map) and tag the previous card's
    // outer div with `-precedes-snippet` to shrink its bottom margin.
    const ourCardOpenByClose = new WeakMap<Token, Token>();

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
      const sourceMap = popen.map;
      const replacement: Token[] = [];
      let cursor = 0;

      // Across-paragraph check: if the block-level token immediately
      // preceding popen is a closer we emitted for a previous card, then
      // the first card from THIS paragraph is stacking on top of that
      // earlier card with no prose paragraph between them. We also keep
      // a handle on that previous card's open token so we can retro-tag
      // it once we know its successor is another card.
      const tokenBeforePopen = tokens[i - 2];
      let prevCardOpen: Token | null = tokenBeforePopen
        ? ourCardOpenByClose.get(tokenBeforePopen) || null
        : null;

      for (const m of matches) {
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
          level,
          sourceMap
        );
        if (beforeTokens.length > 0) {
          // A real paragraph just landed between the previous card and
          // the next one, so the next card isn't card-on-card.
          prevCardOpen = null;
        }
        replacement.push(...beforeTokens);

        const followsSnippet = !!prevCardOpen;

        const entry = fetcher.get(
          m.info.owner,
          m.info.repo,
          m.info.sha,
          m.info.path,
          tokenFingerprint
        );
        const cardTokens = buildSnippetTokens(
          state,
          m.info,
          entry,
          level,
          followsSnippet,
          sourceMap
        );
        // Two cards stacking — tag the earlier one so its bottom margin
        // also collapses to 8px. Without this the larger default margin
        // of the previous card would dominate the collapse and the gap
        // would never actually shrink.
        if (prevCardOpen) {
          prevCardOpen.attrJoin('class', 'gh-permalink-card-precedes-snippet');
        }
        // The closing token is always the last in the sequence (the
        // close for a fulfilled [open, fence, close] triple, or the
        // single placeholder for pending/rejected).
        const openTok = cardTokens[0];
        const closeTok = cardTokens[cardTokens.length - 1];
        ourCardOpenByClose.set(closeTok, openTok);
        replacement.push(...cardTokens);
        prevCardOpen = openTok;

        // Advance past the link triple, then past any whitespace-only text
        // and the trailing line break that followed it.
        cursor = m.idx + 3;
        while (cursor < children.length && isWhitespaceText(children[cursor])) cursor++;
        if (cursor < children.length && isLineBreak(children[cursor])) cursor++;
      }

      // Whatever's left of the original inline becomes a trailing paragraph.
      if (cursor < children.length) {
        replacement.push(
          ...emitInlineParagraph(state, children.slice(cursor), level, sourceMap)
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
