import type MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token';

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

function parsePermalink(url: string): PermalinkInfo | null {
  const m = PERMALINK_RE.exec(url.trim());
  if (!m) return null;
  const [, owner, repo, sha, path, startLine, endLine] = m;
  return { owner, repo, sha, path, startLine, endLine, url };
}

function extractSoleUrl(children: Token[]): string | null {
  // Filter out empty/whitespace-only text tokens.
  const meaningful = children.filter(
    (c) => !(c.type === 'text' && c.content.trim() === '')
  );

  // Linkify-produced shape: link_open, text(url), link_close
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

  // Plain text token containing a URL (linkify off).
  if (meaningful.length === 1 && meaningful[0].type === 'text') {
    const t = meaningful[0].content.trim();
    if (/^https:\/\/github\.com\//.test(t)) return t;
  }

  return null;
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

function renderPlaceholder(info: PermalinkInfo): string {
  const attrs = [
    `data-owner="${escapeAttr(info.owner)}"`,
    `data-repo="${escapeAttr(info.repo)}"`,
    `data-sha="${escapeAttr(info.sha)}"`,
    `data-path="${escapeAttr(info.path)}"`,
    `data-url="${escapeAttr(info.url)}"`,
  ];
  if (info.startLine) attrs.push(`data-start-line="${info.startLine}"`);
  if (info.endLine) attrs.push(`data-end-line="${info.endLine}"`);

  const fallback = `<a href="${escapeAttr(info.url)}">${escapeHtml(info.url)}</a>`;
  return `<div class="gh-permalink-embed" ${attrs.join(' ')}>${fallback}</div>\n`;
}

export function permalinksPlugin(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'github_permalinks', (state) => {
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

      const placeholder = new state.Token('html_block', '', 0);
      placeholder.content = renderPlaceholder(info);
      placeholder.block = true;

      tokens.splice(i - 1, 3, placeholder);
      // Re-check the spliced index next iteration.
      i -= 1;
    }
  });
}
