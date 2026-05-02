# Markdown GitHub Permalinks

A VS Code extension that renders GitHub permalinks as inline code snippets in
the Markdown preview — the same way GitHub itself does in issue comments and
pull request descriptions.

## What it does

Drop a GitHub permalink on its own line in any Markdown file:

```
https://github.com/microsoft/vscode/blob/af28b32d7e553898b2a91af498b1fb666fdebe0c/src/vs/base/common/strings.ts#L20-L35
```

Open the Markdown preview and the URL is replaced with a snippet card showing
the file path, the requested line range, and the actual code at that revision.

Supported URL shapes (must be on their own paragraph):

| Shape | Example |
|---|---|
| Single line  | `…/blob/<sha>/<path>#L16` |
| Range        | `…/blob/<sha>/<path>#L20-L35` |
| Whole file   | `…/blob/<sha>/<path>` |

The SHA must be a 7-40 character hex commit SHA (true permalinks). Branch- or
tag-based URLs are intentionally not transformed, since they are not stable.

Inline links (`[text](url)`) and non-permalink GitHub URLs are left untouched.

## How it works

- A `markdown-it` plugin in the extension host scans the token stream and
  replaces qualifying paragraphs with a placeholder `<div>` carrying the parsed
  permalink data in `data-*` attributes.
- A small preview-side script runs inside the Markdown preview webview, finds
  the placeholders, fetches the relevant file from
  `https://raw.githubusercontent.com/`, and renders the card with line
  numbers.
- A `MutationObserver` re-renders new placeholders when VS Code re-runs the
  preview after edits. Fetched files are cached per `owner/repo/sha/path` for
  the lifetime of the preview.

## Limitations

- **Public repos only.** The preview fetches from `raw.githubusercontent.com`
  unauthenticated. Permalinks to private repositories will render a "Failed to
  load" error card. Adding GitHub OAuth flow for private content is out of
  scope for v0.1.
- **No syntax highlighting (yet).** Code is rendered with the editor's
  monospace font but without colorization. The language is detected from the
  file extension and applied as a `language-*` class so a follow-up can plug
  in `highlight.js` or Shiki.
- **Bare-URL paragraphs only.** Permalinks must be on their own line, with no
  surrounding text in the same paragraph (this matches GitHub's own behavior).

## Try it locally

You need Node.js and a recent VS Code.

```bash
git clone https://github.com/igor-sirotin/vscode-md-github-permalinks.git
cd vscode-md-github-permalinks
npm install
npm run compile
```

Then open the folder in VS Code and press <kbd>F5</kbd> ("Run Extension"). A
second VS Code window — the **Extension Development Host** — opens with this
extension loaded.

In that window:

1. Open `sample.md` from this repo (or any Markdown file with a GitHub
   permalink on its own line).
2. Open the Markdown preview: <kbd>⌘K V</kbd> on macOS, <kbd>Ctrl+K V</kbd>
   elsewhere — or run **Markdown: Open Preview to the Side**.
3. The permalink should render as a code snippet card. Edit the file; the
   preview updates live.

If you don't see the snippet, check:

- The URL is on its own paragraph (blank lines above and below).
- The ref is a commit SHA, not a branch or tag.
- The repo is public (private repos surface as "Failed to load").
- VS Code's Markdown preview hasn't been blocked by a strict CSP. If a
  workspace overrides `markdown.preview` security, snippets may fail to fetch
  — toggle it via the lock icon in the preview tab.

### Iterating

- `npm run watch` rebuilds on save.
- After changes to the extension's TypeScript, reload the Extension
  Development Host (<kbd>⌘R</kbd> / <kbd>Ctrl+R</kbd>).
- Changes to `preview/permalinks.js` and `preview/permalinks.css` are picked
  up by re-opening the preview.

## Repository layout

```
src/
  extension.ts            entry point — exports extendMarkdownIt
  markdownItPlugin.ts     core ruler that swaps permalink paragraphs
                          for placeholder html_blocks
preview/
  permalinks.js           runs in the preview webview; fetches raw files
                          and renders snippet cards
  permalinks.css          styling, theme-aware via VS Code CSS variables
sample.md                 demo file with a few permalinks
```

## License

MIT — see `LICENSE`.
